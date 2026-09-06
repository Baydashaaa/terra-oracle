// scripts/streak-payout.js
// Runs every hour via GitHub Actions
// Pure HTTP - no cosmjs, no feather.js

import fetch from 'node-fetch';
import { createHmac, createHash } from 'crypto';

// Записи, созданные до 1 сентября 2026, указывают на прежний операторский
// кошелёк недельного пула. Деньги на нём в розыгрыше больше не участвуют,
// поэтому такие выплаты переадресуются на контракт.
const WEEKLY_WALLET_LEGACY = 'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz';
const WEEKLY_POOL          = 'terra19w39c3qz6kc756hap92x374reptah9kp5825f5c67hmquy383r5qd7dmd8';
function payoutTarget(to) {
  return to === WEEKLY_WALLET_LEGACY ? WEEKLY_POOL : to;
}

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

// Секрет уходит заголовком, а не в адресе: URL целиком попадает в логи
// прокси и в историю команд, заголовок - нет.
function authHeaders() {
  return { 'Content-Type': 'application/json', 'X-Actions-Secret': ACTIONS_SECRET };
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

async function buildSignedTx(privateKey, publicKey, fromAddr, toAddr, amountUluna, memo, accountNumber, sequence) {
  const enc = (s) => Buffer.from(s);

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

  // Хеш транзакции - это sha256 от тех же байт, что уходят в сеть. Значит он
  // известен ДО отправки, и его можно записать в очередь заранее. Именно это
  // превращает выплату из "отправил и надеюсь" в операцию, которую можно
  // сверить с цепочкой после любого сбоя.
  const txBytes = txRawP.toString('base64');
  const txHash  = createHash('sha256').update(txRawP).digest('hex').toUpperCase();
  return { txBytes, txHash };
}

async function broadcastTx(txBytes) {
  const res  = await safeFetch(`${LCD_URL}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBytes, mode: 'BROADCAST_MODE_SYNC' }),
  });
  const data = await res.json();
  const code = data?.tx_response?.code ?? data?.code ?? 0;
  // Ненулевой код здесь означает отказ на приёме: транзакция в мемпул не
  // попала. Включение в блок это ещё не подтверждает - за этим waitForTx.
  if (code !== 0) throw new Error('broadcast rejected: ' + (data?.tx_response?.raw_log || JSON.stringify(data)));
  return data?.tx_response?.txhash || data?.txhash;
}

// Ищет транзакцию в цепочке. Возвращает 'ok', 'failed' или 'missing'.
async function lookupTx(txHash) {
  try {
    const r = await safeFetch(`${LCD_URL}/cosmos/tx/v1beta1/txs/${txHash}`);
    if (r.status === 404) return 'missing';
    const j = await r.json();
    const resp = j?.tx_response;
    if (!resp || !resp.height || resp.height === '0') return 'missing';
    return (resp.code ?? 0) === 0 ? 'ok' : 'failed';
  } catch { return 'missing'; }
}

// Ждёт включения в блок. Без этого мы отмечаем оплаченным то, что узел лишь
// принял в мемпул и мог отбросить.
async function waitForTx(txHash, tries = 20, delayMs = 4000) {
  for (let i = 0; i < tries; i++) {
    const st = await lookupTx(txHash);
    if (st !== 'missing') return st;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return 'missing';
}

async function setStatus(key, status, txHash, note) {
  const r = await safeFetch(`${WORKER_URL}/streak/set-status`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ key, status, txHash, note }),
  });
  if (!r.ok) throw new Error('set-status failed: ' + (await r.text()).slice(0, 200));
}

async function markPaid(key, txHash) {
  const r = await safeFetch(`${WORKER_URL}/streak/mark-paid`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ key, txHash }),
  });
  return r.ok;
}

// Сверка зависших. Запись в inflight значит: транзакцию мы подписали, хеш
// знаем, а чем кончилось - нет. Три исхода, и все три безопасны:
//   ok      - в блоке, помечаем оплаченной, второй раз не платим;
//   failed  - в блоке с ошибкой, деньги не ушли, возвращаем в очередь;
//   missing - в цепочке нет, возвращаем в очередь.
// missing - единственный, где остаётся теоретический риск: транзакция могла
// висеть в мемпуле и попасть в блок позже. Поэтому в очередь возвращаем не
// сразу, а только спустя запас по времени.
const INFLIGHT_GRACE_MS = 30 * 60 * 1000;

async function reconcileInflight() {
  const res = await safeFetch(`${WORKER_URL}/streak/pending-payouts?status=inflight`, { headers: authHeaders() });
  if (!res.ok) { console.error('⚠️ Не удалось прочитать зависшие выплаты'); return; }
  const { payouts } = await res.json();
  if (!payouts || !payouts.length) return;

  console.log(`🔍 Сверяю ${payouts.length} зависших выплат(ы)...`);
  for (const p of payouts) {
    if (!p.txHash) { await setStatus(p.key, 'pending', null, 'inflight without hash'); continue; }
    const st = await lookupTx(p.txHash);
    if (st === 'ok') {
      await markPaid(p.key, p.txHash);
      console.log(`  ✅ ${p.txHash.slice(0,12)} в блоке - помечена оплаченной`);
    } else if (st === 'failed') {
      await setStatus(p.key, 'pending', p.txHash, 'tx failed on chain');
      console.log(`  ↩️ ${p.txHash.slice(0,12)} завершилась ошибкой - вернул в очередь`);
    } else {
      const age = Date.now() - new Date(p.statusAt || 0).getTime();
      if (age > INFLIGHT_GRACE_MS) {
        await setStatus(p.key, 'pending', p.txHash, 'tx never landed');
        console.log(`  ↩️ ${p.txHash.slice(0,12)} не найдена - вернул в очередь`);
      } else {
        console.log(`  ⏳ ${p.txHash.slice(0,12)} ещё не видна, жду следующего запуска`);
      }
    }
  }
}

async function main() {
  console.log('🔥 Streak payout starting...');
  console.log(`📅 Date: ${new Date().toISOString()}`);

  if (!WORKER_URL || !ACTIONS_SECRET || !MNEMONIC) {
    console.error('❌ Missing env vars');
    process.exit(1);
  }

  // 0. Сверка зависших с прошлого раза - ДО выборки очереди, иначе выплата,
  // которая на самом деле уже прошла, попадёт в текущий заход второй раз.
  await reconcileInflight();

  // 1. Fetch pending payouts
  const res = await safeFetch(`${WORKER_URL}/streak/pending-payouts`, { headers: authHeaders() });
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

  // Read account ONCE; increment sequence manually per tx (SYNC broadcast
  // returns before the node updates sequence - re-reading between fast sends
  // gives a stale value → "account sequence mismatch").
  const accRes2 = await safeFetch(`${LCD_URL}/cosmos/auth/v1beta1/accounts/${sender}`);
  const acct2   = (await accRes2.json())?.account || {};
  const accountNumber = parseInt(acct2.account_number || '0');
  let   sequence      = parseInt(acct2.sequence || '0');

  for (const payout of payouts) {
    try {
      console.log(`\n⏳ ${payout.wallet.slice(0,20)}... milestone=${payout.milestone} amount=${(payout.amount/1e6).toFixed(3)} LUNC`);

      const { txBytes, txHash } = await buildSignedTx(
        privateKey, publicKey, sender, payoutTarget(payout.to),
        payout.amount,
        `streak:milestone:${payout.milestone}`,
        accountNumber, sequence
      );

      // Записываем хеш ДО отправки. Если процесс умрёт на любом следующем
      // шаге, запись останется в inflight, и сверка на следующем запуске
      // спросит у цепочки, что с ней стало, вместо повторной выплаты.
      await setStatus(payout.key, 'inflight', txHash);

      await broadcastTx(txBytes);
      sequence++;   // номер израсходован даже при неудаче в блоке
      console.log(`📡 Отправлена, жду блок | tx: ${txHash}`);

      const st = await waitForTx(txHash);
      if (st === 'ok') {
        if (await markPaid(payout.key, txHash)) console.log(`✅ Оплачена → ${payout.to}`);
        else console.error(`⚠️ mark-paid не прошёл - останется inflight, сверка закроет`);
        successCount++;
      } else if (st === 'failed') {
        await setStatus(payout.key, 'pending', txHash, 'tx failed on chain');
        console.error(`❌ Транзакция завершилась ошибкой - вернул в очередь`);
        failCount++;
      } else {
        // Оставляем inflight: платить заново вслепую нельзя.
        console.error(`⚠️ Транзакция не появилась в блоке за отведённое время - оставил inflight`);
        failCount++;
      }
      await new Promise(r => setTimeout(r, 3000));

    } catch(err) {
      console.error(`❌ Error: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n🎉 Done! ✅ ${successCount} paid, ❌ ${failCount} failed.`);
}

main().catch(e => { console.error('💥 Fatal:', e); process.exit(1); });
