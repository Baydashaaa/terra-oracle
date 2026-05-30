// scripts/streak-payout.js
// Runs every hour via GitHub Actions
// Pure HTTP — no cosmjs, no feather.js

import fetch from 'node-fetch';
import { createHmac, createHash } from 'crypto';

const WORKER_URL     = process.env.WORKER_URL;
const ACTIONS_SECRET = process.env.ACTIONS_SECRET;
const MNEMONIC       = process.env.RESERVE_MNEMONIC;
const LCD_URL        = 'https://terra-classic-lcd.publicnode.com';
const CHAIN_ID       = 'columbus-5';
const GAS_LIMIT      = 300000;
const GAS_PRICE      = 28.325;

async function safeFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch(e) { clearTimeout(t); throw e; }
}

// Derive secp256k1 keypair from mnemonic using bip32/bip39
async function deriveKeypair(mnemonic) {
  // Use tiny-secp256k1 + bip39 + bip32
  const { mnemonicToSeedSync } = await import('bip39');
  const { BIP32Factory } = await import('bip32');
  const ecc = await import('tiny-secp256k1');
  const bip32 = BIP32Factory(ecc.default || ecc);

  const seed = mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed);
  const child = root.derivePath("m/44'/330'/0'/0/0");

  return {
    privateKey: child.privateKey,
    publicKey:  child.publicKey,
  };
}

// Bech32 encode
function bech32encode(prefix, words) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  function polymod(values) {
    let chk = 1;
    for (const v of values) {
      const top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= gen[i];
    }
    return chk;
  }
  function hrpExpand(hrp) {
    const ret = [];
    for (const c of hrp) ret.push(c.charCodeAt(0) >> 5);
    ret.push(0);
    for (const c of hrp) ret.push(c.charCodeAt(0) & 31);
    return ret;
  }
  const checksum = polymod([...hrpExpand(prefix), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const cs = [];
  for (let i = 0; i < 6; i++) cs.push((checksum >> (5 * (5 - i))) & 31);
  return prefix + '1' + [...words, ...cs].map(x => CHARSET[x]).join('');
}

function convertbits(data, frombits, tobits, pad = true) {
  let acc = 0, bits = 0;
  const ret = [];
  const maxv = (1 << tobits) - 1;
  for (const v of data) {
    acc = ((acc << frombits) | v) & 0xffffffff;
    bits += frombits;
    while (bits >= tobits) { bits -= tobits; ret.push((acc >> bits) & maxv); }
  }
  if (pad && bits > 0) ret.push((acc << (tobits - bits)) & maxv);
  return ret;
}

function pubkeyToAddress(pubkey) {
  const sha256 = createHash('sha256').update(pubkey).digest();
  const ripemd160 = createHash('ripemd160').update(sha256).digest();
  const words = convertbits(ripemd160, 8, 5);
  return bech32encode('terra', words);
}

// Protobuf helpers
function encodeVarint(n) {
  n = Number(n);
  const b = [];
  while (n > 127) { b.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  b.push(n & 0x7f);
  return Buffer.from(b);
}
function encodeField(f, w, d) {
  const t = encodeVarint((f << 3) | w);
  if (w === 2) {
    const l = encodeVarint(d.length);
    return Buffer.concat([t, l, d]);
  }
  return t;
}
function concat(...a) { return Buffer.concat(a); }

async function sendTokens(privateKey, publicKey, fromAddr, toAddr, amountUluna, memo) {
  const enc = (s) => Buffer.from(s);

  // Get account info
  const accRes  = await safeFetch(`${LCD_URL}/cosmos/auth/v1beta1/accounts/${fromAddr}`);
  const accData = await accRes.json();
  const acct    = accData?.account || {};
  const accountNumber = parseInt(acct.account_number || '0');
  const sequence      = parseInt(acct.sequence || '0');

  const gasFee   = Math.ceil(GAS_LIMIT * GAS_PRICE);
  const taxFee   = Math.ceil(amountUluna * 0.005);
  const totalFee = gasFee + taxFee;

  // Build MsgSend
  const coinP   = concat(encodeField(1, 2, enc('uluna')), encodeField(2, 2, enc(String(amountUluna))));
  const msgSP   = concat(encodeField(1, 2, enc(fromAddr)), encodeField(2, 2, enc(toAddr)), encodeField(3, 2, coinP));
  const anyMsg  = concat(encodeField(1, 2, enc('/cosmos.bank.v1beta1.MsgSend')), encodeField(2, 2, msgSP));
  const txBodyP = concat(encodeField(1, 2, anyMsg), encodeField(2, 2, enc(memo || '')));

  // AuthInfo
  const pubkeyAny = concat(
    encodeField(1, 2, enc('/cosmos.crypto.secp256k1.PubKey')),
    encodeField(2, 2, encodeField(1, 2, publicKey))
  );
  const modeInfoP = encodeField(1, 2, concat(encodeVarint((1 << 3) | 0), encodeVarint(1)));
  const signerP   = concat(
    encodeField(1, 2, pubkeyAny),
    encodeField(2, 2, modeInfoP),
    encodeVarint((3 << 3) | 0), encodeVarint(sequence)
  );
  const feeCoinP  = concat(encodeField(1, 2, enc('uluna')), encodeField(2, 2, enc(String(totalFee))));
  const feeP      = concat(encodeField(1, 2, feeCoinP), encodeVarint((2 << 3) | 0), encodeVarint(GAS_LIMIT));
  const authInfoP = concat(encodeField(1, 2, signerP), encodeField(2, 2, feeP));

  // SignDoc
  const signDocP = concat(
    encodeField(1, 2, txBodyP),
    encodeField(2, 2, authInfoP),
    encodeField(3, 2, enc(CHAIN_ID)),
    encodeVarint((4 << 3) | 0), encodeVarint(accountNumber)
  );

  // Sign
  const eccMod = await import('tiny-secp256k1');
  const secp256k1 = eccMod.default || eccMod;
  const msgHash = createHash('sha256').update(signDocP).digest();
  const sigObj  = secp256k1.sign(msgHash, privateKey);
  const sig     = Buffer.from(sigObj);

  // TxRaw
  const txRawP = concat(
    encodeField(1, 2, txBodyP),
    encodeField(2, 2, authInfoP),
    encodeField(3, 2, sig)
  );

  // Broadcast
  const res  = await safeFetch(`${LCD_URL}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txRawP.toString('base64'), mode: 'BROADCAST_MODE_SYNC' }),
  });
  const data   = await res.json();
  const txHash = data?.tx_response?.txhash || data?.txhash;
  const code   = data?.tx_response?.code ?? data?.code ?? 0;
  if (code !== 0) throw new Error('TX failed: ' + (data?.tx_response?.raw_log || JSON.stringify(data)));
  return txHash;
}

async function main() {
  console.log('🔥 Streak payout starting...');
  console.log(`📅 Date: ${new Date().toISOString()}`);

  if (!WORKER_URL || !ACTIONS_SECRET || !MNEMONIC) {
    console.error('❌ Missing env vars');
    process.exit(1);
  }

  // 1. Fetch pending payouts
  const res = await safeFetch(`${WORKER_URL}/streak/pending-payouts?secret=${ACTIONS_SECRET}`);
  if (!res.ok) { console.error('❌ Failed:', await res.text()); process.exit(1); }
  const { payouts } = await res.json();

  if (!payouts || payouts.length === 0) {
    console.log('✅ No pending streak payouts.');
    return;
  }
  console.log(`📋 Found ${payouts.length} pending payout(s).`);

  // 2. Derive keypair
  const { privateKey, publicKey } = await deriveKeypair(MNEMONIC);
  const sender = pubkeyToAddress(publicKey);
  console.log(`👛 Reserve wallet: ${sender}`);

  // 3. Check balance
  const balRes  = await safeFetch(`${LCD_URL}/cosmos/bank/v1beta1/balances/${sender}`);
  const balData = await balRes.json();
  const balAmt  = parseInt(balData.balances?.find(b => b.denom === 'uluna')?.amount || '0');
  console.log(`💰 Balance: ${(balAmt / 1e6).toFixed(3)} LUNC`);

  const totalNeeded = payouts.reduce((s, p) => s + (p.amount || 0), 0);
  if (balAmt < totalNeeded + 2_000_000) {
    console.error(`❌ Insufficient balance`);
    process.exit(1);
  }

  // 4. Process payouts
  let successCount = 0, failCount = 0;

  for (const payout of payouts) {
    try {
      console.log(`\n⏳ ${payout.wallet.slice(0,20)}... milestone=${payout.milestone} amount=${(payout.amount/1e6).toFixed(3)} LUNC`);

      const txHash = await sendTokens(
        privateKey, publicKey, sender, payout.to,
        payout.amount,
        `streak:milestone:${payout.milestone}`
      );

      console.log(`✅ Paid → ${payout.to} | tx: ${txHash}`);

      const markRes = await safeFetch(`${WORKER_URL}/streak/mark-paid`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key: payout.key, txHash, secret: ACTIONS_SECRET }),
      });
      if (!markRes.ok) console.error(`⚠️ mark-paid failed`);
      else console.log(`📝 Marked as paid.`);

      successCount++;
      await new Promise(r => setTimeout(r, 3000));

    } catch(err) {
      console.error(`❌ Error: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n🎉 Done! ✅ ${successCount} paid, ❌ ${failCount} failed.`);
}

main().catch(e => { console.error('💥 Fatal:', e); process.exit(1); });
