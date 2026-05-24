// ─── TREASURY DISTRIBUTION SCRIPT ───────────────────────────
// Pure HTTP + bip39/bip32/tiny-secp256k1 — no cosmjs, no feather.js
// Distributes Protocol Treasury balance to 4 wallets:
//   25% → REWARDS_WALLET   (REP weekly rewards)
//   15% → RESERVE_WALLET   (protocol stability buffer)
//   50% → LIQUIDITY_WALLET (manual liquidity provision)
//   10% → DEV_WALLET        (development & operations)

import fetch from 'node-fetch';
import { createHash } from 'crypto';

const WALLETS = {
  treasury:  'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt',
  rewards:   'terra1ty6fxd9u0jzae5lpzcs56rfclxg4q32hw5x4ce',
  reserve:   'terra10q6syec2e27x8g76a0mvm3frgvarl5dz27a2jz',
  liquidity: 'terra1gukarslv6c8n0s2259822l7059putpqxz405su',
  dev:       'terra17g55uzkm6cr5fcl3vzcrmu73v8as4yvf2kktzr',
};
const DISTRIBUTION = { rewards: 0.25, reserve: 0.15, liquidity: 0.50, dev: 0.10 };
const LCD_URL     = 'https://terra-classic-lcd.publicnode.com';
const CHAIN_ID    = 'columbus-5';
const GAS_LIMIT   = 300000;
const GAS_PRICE   = 28.325;
const GAS_RESERVE = 500_000_000n;
const MIN_BALANCE = 100_000_000_000n;

async function safeFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try { const res = await fetch(url, { ...opts, signal: ctrl.signal }); clearTimeout(t); return res; }
  catch(e) { clearTimeout(t); throw e; }
}

async function deriveKeypair(mnemonic) {
  const { mnemonicToSeedSync } = await import('bip39');
  const { BIP32Factory } = await import('bip32');
  const ecc = await import('tiny-secp256k1');
  const bip32 = BIP32Factory(ecc.default || ecc);
  const seed = mnemonicToSeedSync(mnemonic);
  const child = bip32.fromSeed(seed).derivePath("m/44'/330'/0'/0/0");
  return { privateKey: child.privateKey, publicKey: child.publicKey };
}

function bech32encode(prefix, words) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  function polymod(v) { let c=1; for(const x of v){const t=c>>25;c=((c&0x1ffffff)<<5)^x;for(let i=0;i<5;i++)if((t>>i)&1)c^=gen[i];}return c; }
  function expand(h) { const r=[]; for(const c of h)r.push(c.charCodeAt(0)>>5); r.push(0); for(const c of h)r.push(c.charCodeAt(0)&31); return r; }
  const cs=[]; const chk=polymod([...expand(prefix),...words,0,0,0,0,0,0])^1;
  for(let i=0;i<6;i++)cs.push((chk>>(5*(5-i)))&31);
  return prefix+'1'+[...words,...cs].map(x=>CHARSET[x]).join('');
}
function convertbits(data,fb,tb,pad=true){let a=0,b=0;const r=[],m=(1<<tb)-1;for(const v of data){a=((a<<fb)|v)&0xffffffff;b+=fb;while(b>=tb){b-=tb;r.push((a>>b)&m);}}if(pad&&b>0)r.push((a<<(tb-b))&m);return r;}
function pubkeyToAddress(pk) { const s=createHash('sha256').update(pk).digest(),r=createHash('ripemd160').update(s).digest(); return bech32encode('terra',[0,...convertbits(r,8,5)]); }

function encodeVarint(n) { n=Number(n);const b=[];while(n>127){b.push((n&0x7f)|0x80);n=Math.floor(n/128);}b.push(n&0x7f);return Buffer.from(b); }
function encodeField(f,w,d) { const t=encodeVarint((f<<3)|w);if(w===2){return Buffer.concat([t,encodeVarint(d.length),d]);}return t; }

async function sendTokens(privateKey, publicKey, fromAddr, toAddr, amountUluna, memo) {
  const enc = s => Buffer.from(s);
  const accRes = await safeFetch(`${LCD_URL}/cosmos/auth/v1beta1/accounts/${fromAddr}`);
  const acct = (await accRes.json())?.account || {};
  const accountNumber = parseInt(acct.account_number||'0');
  const sequence      = parseInt(acct.sequence||'0');
  const totalFee = Math.ceil(GAS_LIMIT*GAS_PRICE) + Math.ceil(Number(amountUluna)*0.005);

  const coinP   = Buffer.concat([encodeField(1,2,enc('uluna')),encodeField(2,2,enc(String(amountUluna)))]);
  const msgSP   = Buffer.concat([encodeField(1,2,enc(fromAddr)),encodeField(2,2,enc(toAddr)),encodeField(3,2,coinP)]);
  const anyMsg  = Buffer.concat([encodeField(1,2,enc('/cosmos.bank.v1beta1.MsgSend')),encodeField(2,2,msgSP)]);
  const txBodyP = Buffer.concat([encodeField(1,2,anyMsg),encodeField(2,2,enc(memo||''))]);
  const pubkeyAny = Buffer.concat([encodeField(1,2,enc('/cosmos.crypto.secp256k1.PubKey')),encodeField(2,2,encodeField(1,2,publicKey))]);
  const modeInfoP = encodeField(1,2,Buffer.concat([encodeVarint((1<<3)|0),encodeVarint(1)]));
  const signerP   = Buffer.concat([encodeField(1,2,pubkeyAny),encodeField(2,2,modeInfoP),encodeVarint((3<<3)|0),encodeVarint(sequence)]);
  const feeCoinP  = Buffer.concat([encodeField(1,2,enc('uluna')),encodeField(2,2,enc(String(totalFee)))]);
  const feeP      = Buffer.concat([encodeField(1,2,feeCoinP),encodeVarint((2<<3)|0),encodeVarint(GAS_LIMIT)]);
  const authInfoP = Buffer.concat([encodeField(1,2,signerP),encodeField(2,2,feeP)]);
  const signDocP  = Buffer.concat([encodeField(1,2,txBodyP),encodeField(2,2,authInfoP),encodeField(3,2,enc(CHAIN_ID)),encodeVarint((4<<3)|0),encodeVarint(accountNumber),encodeVarint((5<<3)|0),encodeVarint(sequence)]);

  const { default: secp256k1 } = await import('tiny-secp256k1');
  const sig = Buffer.from(secp256k1.sign(createHash('sha256').update(signDocP).digest(), privateKey));
  const txRawP = Buffer.concat([encodeField(1,2,txBodyP),encodeField(2,2,authInfoP),encodeField(3,2,sig)]);

  const res  = await safeFetch(`${LCD_URL}/cosmos/tx/v1beta1/txs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txRawP.toString('base64'), mode: 'BROADCAST_MODE_SYNC' }),
  });
  const data = await res.json();
  const code = data?.tx_response?.code ?? data?.code ?? 0;
  if (code !== 0) throw new Error('TX failed: ' + (data?.tx_response?.raw_log || JSON.stringify(data)));
  return data?.tx_response?.txhash || data?.txhash;
}

async function run() {
  const mnemonic = process.env.TREASURY_MNEMONIC;
  if (!mnemonic) throw new Error('TREASURY_MNEMONIC not set');

  console.log('=== Treasury Distribution ===');
  console.log(`Date: ${new Date().toISOString()}`);

  const balRes  = await safeFetch(`${LCD_URL}/cosmos/bank/v1beta1/balances/${WALLETS.treasury}`);
  const balData = await balRes.json();
  const balance = BigInt(balData.balances?.find(b=>b.denom==='uluna')?.amount||'0');
  console.log(`Balance: ${(Number(balance)/1_000_000).toLocaleString()} LUNC`);

  if (balance < MIN_BALANCE) { console.log('Below minimum (100,000 LUNC). Skipping.'); process.exit(0); }

  const distributable = balance - GAS_RESERVE;
  const amounts = {};
  for (const [key, pct] of Object.entries(DISTRIBUTION)) {
    amounts[key] = Math.floor(Number(distributable) * pct);
  }

  console.log('\nPlan:');
  for (const [key, amt] of Object.entries(amounts)) {
    console.log(`  ${key.padEnd(12)} ${DISTRIBUTION[key]*100}%  →  ${(amt/1_000_000).toLocaleString()} LUNC  →  ${WALLETS[key]}`);
  }

  const { privateKey, publicKey } = await deriveKeypair(mnemonic);
  const sender = pubkeyToAddress(publicKey);
  if (sender !== WALLETS.treasury) throw new Error(`Address mismatch: got ${sender}`);
  console.log(`\nSigner: ${sender}`);

  let ok = 0;
  for (const [key, to] of [['rewards',WALLETS.rewards],['reserve',WALLETS.reserve],['liquidity',WALLETS.liquidity],['dev',WALLETS.dev]]) {
    const amount = amounts[key];
    if (!amount || amount <= 0) continue;
    console.log(`\nSending ${(amount/1_000_000).toLocaleString()} LUNC → ${key}...`);
    try {
      const txHash = await sendTokens(privateKey, publicKey, sender, to, amount, `Treasury: ${key} ${DISTRIBUTION[key]*100}%`);
      console.log(`  OK: ${txHash}`);
      ok++;
    } catch(e) { console.error(`  FAILED: ${e.message}`); }
    await new Promise(r => setTimeout(r, 6000));
  }
  console.log(`\n=== Done: ${ok}/4 successful ===`);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
