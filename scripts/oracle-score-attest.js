// scripts/oracle-score-attest.js
// Drains the Worker's pending-rep queue into the on-chain Oracle Score contract.
// Runs hourly via GitHub Actions. Pure HTTP + hand-rolled protobuf, same approach
// as rep-rewards.js — no cosmjs.

import fetch from 'node-fetch';
import { createHash } from 'crypto';

const WORKER_URL     = process.env.WORKER_URL;
const ACTIONS_SECRET = process.env.ACTIONS_SECRET;
const MNEMONIC       = process.env.ATTESTOR_MNEMONIC;
const CONTRACT       = process.env.ORACLE_SCORE_CONTRACT;

const LCD_URL  = 'https://terra-classic-lcd.publicnode.com';
const CHAIN_ID = 'columbus-5';
const GAS_PRICE = 28.325;

// Everything earned before the seeded snapshot is already reflected in the
// on-chain balances. Recording those again would pay the same reputation twice,
// so the queue is only drained from the snapshot forward.
const SNAPSHOT_TS = Date.parse('2026-07-31T22:54:04.369Z');

// The attestor address the mnemonic must derive. A mismatch means the wrong
// secret is configured, and we stop rather than sign with an unexpected key.
const EXPECTED_ATTESTOR = 'terra1yza5m2dkhnxxrur8cc0qrwwmqztyj54fypwzy8';

// One tx per batch. Larger batches save gas but lose more work when a single
// message fails, since the whole tx reverts.
const BATCH_SIZE   = 8;
const GAS_BASE     = 180_000;
const GAS_PER_MSG  = 140_000;

// Actions the contract knows about. Anything else is skipped loudly rather than
// broadcast, so a typo in the Worker cannot burn gas on a doomed tx.
const KNOWN_ACTIONS = new Set([
  'answer', 'upvote', 'chat', 'question_basic', 'question_priority',
]);

async function safeFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch (e) { clearTimeout(t); throw e; }
}

// ── key derivation ──────────────────────────────────────────────────────────
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
  function polymod(values) { let chk = 1; for (const v of values) { const top = chk >> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= gen[i]; } return chk; }
  function hrpExpand(hrp) { const r = []; for (const c of hrp) r.push(c.charCodeAt(0) >> 5); r.push(0); for (const c of hrp) r.push(c.charCodeAt(0) & 31); return r; }
  const checksum = polymod([...hrpExpand(prefix), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const cs = []; for (let i = 0; i < 6; i++) cs.push((checksum >> (5 * (5 - i))) & 31);
  return prefix + '1' + [...words, ...cs].map(x => CHARSET[x]).join('');
}
function convertbits(data, frombits, tobits, pad = true) {
  let acc = 0, bits = 0; const ret = [], maxv = (1 << tobits) - 1;
  for (const v of data) { acc = ((acc << frombits) | v) & 0xffffffff; bits += frombits; while (bits >= tobits) { bits -= tobits; ret.push((acc >> bits) & maxv); } }
  if (pad && bits > 0) ret.push((acc << (tobits - bits)) & maxv);
  return ret;
}
function pubkeyToAddress(pubkey) {
  const sha = createHash('sha256').update(pubkey).digest();
  const rip = createHash('ripemd160').update(sha).digest();
  return bech32encode('terra', convertbits(rip, 8, 5));
}

// ── protobuf ────────────────────────────────────────────────────────────────
function encodeVarint(n) { n = Number(n); const b = []; while (n > 127) { b.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } b.push(n & 0x7f); return Buffer.from(b); }
function encodeField(f, w, d) { const t = encodeVarint((f << 3) | w); if (w === 2) { return Buffer.concat([t, encodeVarint(d.length), d]); } return t; }

// cosmwasm.wasm.v1.MsgExecuteContract — sender 1, contract 2, msg 3, funds 5.
// Funds is omitted entirely: RecordAction carries no payment.
function buildExecuteMsg(sender, contract, msgObj) {
  const enc = s => Buffer.from(s);
  const body = Buffer.concat([
    encodeField(1, 2, enc(sender)),
    encodeField(2, 2, enc(contract)),
    encodeField(3, 2, enc(JSON.stringify(msgObj))),
  ]);
  return Buffer.concat([
    encodeField(1, 2, enc('/cosmwasm.wasm.v1.MsgExecuteContract')),
    encodeField(2, 2, body),
  ]);
}

async function broadcast(privateKey, publicKey, sender, anyMsgs, memo, accountNumber, sequence) {
  const enc = s => Buffer.from(s);
  const gasLimit = GAS_BASE + GAS_PER_MSG * anyMsgs.length;
  const fee = Math.ceil(gasLimit * GAS_PRICE);   // no coins move, so no burn tax

  const txBodyP = Buffer.concat([
    ...anyMsgs.map(m => encodeField(1, 2, m)),
    encodeField(2, 2, enc(memo || '')),
  ]);

  const pubkeyAny = Buffer.concat([
    encodeField(1, 2, enc('/cosmos.crypto.secp256k1.PubKey')),
    encodeField(2, 2, encodeField(1, 2, publicKey)),
  ]);
  const modeInfoP = encodeField(1, 2, Buffer.concat([encodeVarint((1 << 3) | 0), encodeVarint(1)]));
  const signerP = Buffer.concat([
    encodeField(1, 2, pubkeyAny),
    encodeField(2, 2, modeInfoP),
    encodeVarint((3 << 3) | 0), encodeVarint(sequence),
  ]);
  const feeCoinP = Buffer.concat([encodeField(1, 2, enc('uluna')), encodeField(2, 2, enc(String(fee)))]);
  const feeP = Buffer.concat([encodeField(1, 2, feeCoinP), encodeVarint((2 << 3) | 0), encodeVarint(gasLimit)]);
  const authInfoP = Buffer.concat([encodeField(1, 2, signerP), encodeField(2, 2, feeP)]);

  const signDocP = Buffer.concat([
    encodeField(1, 2, txBodyP),
    encodeField(2, 2, authInfoP),
    encodeField(3, 2, enc(CHAIN_ID)),
    encodeVarint((4 << 3) | 0), encodeVarint(accountNumber),
  ]);

  const eccMod = await import('tiny-secp256k1');
  const secp = eccMod.default || eccMod;
  const sig = Buffer.from(secp.sign(createHash('sha256').update(signDocP).digest(), privateKey));

  const txRawP = Buffer.concat([
    encodeField(1, 2, txBodyP),
    encodeField(2, 2, authInfoP),
    encodeField(3, 2, sig),
  ]);

  const res = await safeFetch(`${LCD_URL}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txRawP.toString('base64'), mode: 'BROADCAST_MODE_SYNC' }),
  });
  const data = await res.json();
  const txHash = data?.tx_response?.txhash || data?.txhash;
  const code = data?.tx_response?.code ?? data?.code ?? 0;
  if (code !== 0) throw new Error('broadcast rejected: ' + (data?.tx_response?.raw_log || JSON.stringify(data)).slice(0, 300));
  return txHash;
}

// A tx accepted into the mempool has not executed yet. Marking records as done
// before the block confirms would drop grants on a failed tx, so we wait.
async function confirm(txHash) {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const res = await safeFetch(`${LCD_URL}/cosmos/tx/v1beta1/txs/${txHash}`);
      if (!res.ok) continue;
      const d = await res.json();
      const r = d?.tx_response;
      if (!r?.txhash) continue;
      if ((r.code ?? 0) !== 0) throw new Error('tx failed on chain: ' + String(r.raw_log).slice(0, 300));
      return true;
    } catch (e) {
      if (e.message.startsWith('tx failed')) throw e;
    }
  }
  throw new Error('timed out waiting for ' + txHash);
}

// ── queue ───────────────────────────────────────────────────────────────────
async function fetchPending() {
  const all = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const url = `${WORKER_URL}/rep/pending?limit=200${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`;
    const res = await safeFetch(url, { headers: { 'X-Actions-Secret': ACTIONS_SECRET } });
    if (!res.ok) throw new Error(`/rep/pending → ${res.status}`);
    const d = await res.json();
    all.push(...(d.records || []));
    if (d.done || !d.cursor) break;
    cursor = d.cursor;
  }
  return all;
}

async function markRecorded(keys, txHash) {
  const res = await safeFetch(`${WORKER_URL}/rep/mark-recorded`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Actions-Secret': ACTIONS_SECRET },
    body: JSON.stringify({ keys, txHash }),
  });
  if (!res.ok) throw new Error(`/rep/mark-recorded → ${res.status}`);
  return (await res.json()).marked;
}

async function main() {
  if (!WORKER_URL || !ACTIONS_SECRET || !MNEMONIC || !CONTRACT) {
    console.error('Missing env: WORKER_URL, ACTIONS_SECRET, ATTESTOR_MNEMONIC, ORACLE_SCORE_CONTRACT');
    process.exit(1);
  }

  console.log('Oracle Score attestor —', new Date().toISOString());

  const pending = await fetchPending();
  console.log(`queue: ${pending.length} pending`);

  const stale = pending.filter(r => r.ts < SNAPSHOT_TS);
  if (stale.length) {
    // Already covered by the seed. Clear them so they stop being re-read, but
    // never record them.
    console.log(`skipping ${stale.length} pre-snapshot record(s)`);
    await markRecorded(stale.map(r => r.key), 'pre-snapshot');
  }

  const unknown = pending.filter(r => r.ts >= SNAPSHOT_TS && !KNOWN_ACTIONS.has(r.action));
  for (const r of unknown) console.warn(`unknown action "${r.action}" — leaving ${r.key} queued`);

  const work = pending.filter(r => r.ts >= SNAPSHOT_TS && KNOWN_ACTIONS.has(r.action));
  if (!work.length) { console.log('nothing to record'); return; }

  const { privateKey, publicKey } = await deriveKeypair(MNEMONIC);
  const sender = pubkeyToAddress(publicKey);
  if (sender !== EXPECTED_ATTESTOR) {
    throw new Error(`address mismatch: mnemonic derives ${sender}, expected ${EXPECTED_ATTESTOR}`);
  }
  console.log(`attestor: ${sender}`);

  const accRes = await safeFetch(`${LCD_URL}/cosmos/auth/v1beta1/accounts/${sender}`);
  const acct = (await accRes.json())?.account || {};
  const accountNumber = parseInt(acct.account_number || '0');
  // Sequence is tracked locally: SYNC broadcast returns before the node updates
  // it, so re-reading between batches would give a stale value.
  let sequence = parseInt(acct.sequence || '0');

  let recorded = 0, failed = 0;
  for (let i = 0; i < work.length; i += BATCH_SIZE) {
    const batch = work.slice(i, i + BATCH_SIZE);
    const msgs = batch.map(r => buildExecuteMsg(sender, CONTRACT, {
      record_action: { user: r.wallet, action: r.action, ref_id: r.refId },
    }));

    try {
      const txHash = await broadcast(
        privateKey, publicKey, sender, msgs,
        `oracle-score:attest:${batch.length}`, accountNumber, sequence,
      );
      await confirm(txHash);
      sequence++;   // advance only on success

      const marked = await markRecorded(batch.map(r => r.key), txHash);
      recorded += marked;
      console.log(`batch ${1 + i / BATCH_SIZE}: ${batch.length} msg → ${txHash} (marked ${marked})`);
    } catch (err) {
      failed += batch.length;
      console.error(`batch ${1 + i / BATCH_SIZE} failed: ${err.message}`);
      // Records stay pending, so the next run retries them. A daily limit
      // rejection is expected and self-resolving: the grant is simply not due.
      break;   // stop on first failure — sequence is now uncertain
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`done: ${recorded} recorded, ${failed} left pending`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
