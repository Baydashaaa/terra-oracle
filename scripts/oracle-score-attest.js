// scripts/oracle-score-attest.js
// Drains the Worker's pending-rep queue into the on-chain Oracle Score contract.
// Runs hourly via GitHub Actions. Pure HTTP + hand-rolled protobuf, same approach
// as rep-rewards.js - no cosmjs.

import { createHash } from 'crypto';

const WORKER_URL     = process.env.WORKER_URL;
const ACTIONS_SECRET = process.env.ACTIONS_SECRET;
const MNEMONIC       = process.env.ATTESTOR_MNEMONIC;
const CONTRACT       = process.env.ORACLE_SCORE_CONTRACT;

// A single endpoint is a single point of failure for the whole hour. These are
// tried in order; the first one that answers wins. Broadcast deliberately does
// NOT rotate - see broadcastRaw().
const LCD_URLS = [
  'https://terra-classic-lcd.publicnode.com',
  'https://lcd.terrarebels.net',
  'https://terra-classic-lcd.everstake.one',
];
const CHAIN_ID  = 'columbus-5';
const GAS_PRICE = 28.325;
// The chain rejects anything under the minimum gas price, and the multiplication
// lands on a boundary often enough to matter. 5% costs nothing and removes a
// class of failure that looks like a bug.
const FEE_HEADROOM = 1.05;
// Applied to the figure simulation reports. Execution can cost slightly more
// than the simulated run, and out-of-gas burns the fee and reverts.
const GAS_HEADROOM = 1.4;

// Everything earned before the seeded snapshot is already reflected in the
// on-chain balances. Recording those again would pay the same reputation twice,
// so the queue is only drained from the snapshot forward.
const SNAPSHOT_TS = Date.parse('2026-08-01T14:47:53.167Z');

// The attestor address the mnemonic must derive. A mismatch means the wrong
// secret is configured, and we stop rather than sign with an unexpected key.
const EXPECTED_ATTESTOR = 'terra1yza5m2dkhnxxrur8cc0qrwwmqztyj54fypwzy8';

const BATCH_SIZE = 8;
// Only used for the provisional tx handed to the simulator; the real limit comes
// back from simulation.
const GAS_BASE           = 180_000;
const GAS_PER_MSG_GUESS  = 140_000;

// An hourly job that can run for hours is a job that overlaps itself.
const MAX_BATCHES_PER_RUN = 30;

// MUST mirror ATTESTABLE_ACTIONS in the Worker.
//
// `chat`, `question_basic` and `question_priority` carry a price but are
// configured with `attestor_may_record: true`, which is the contract's explicit
// allowance for recording an action whose payment still flows outside it. When
// an action's payment moves into PaidAction, the contract grants the score
// itself and the action must leave this set in the same deploy - otherwise it is
// paid twice.
//
// `draw` covers NFT mints, whose grant is 25, 125 or 250 by tier. It is the one
// action here that carries its own amount; see the `amount` handling below.
const ATTESTABLE_ACTIONS = new Set([
  'answer', 'upvote', 'chat', 'question_basic', 'question_priority', 'draw',
  // Granted to the answer's author when the asker marks it as the one that
  // helped. Free action, price 0, attestor_may_record true.
  'answer_accepted',
  // Circuit: one grant per round per wallet, carrying its own amount. The
  // contract's rate limit is keyed (day, user, ref_id) with daily_limit 1, so
  // a round can only ever be credited once even if the queue replays it.
  'circuit',
]);

// How to read a rejection. Strings are taken verbatim from src/error.rs; keep
// them in step with it. Anything unmatched is treated as needing a human,
// because guessing wrong in the permissive direction loses grants silently.

// The contract refused on purpose and no grant was due. Terminal, not an error.
//   ContractError::RateLimited
const DECLINED = [/Daily limit reached for this reference/];

// Nothing to do with any particular record - every message in the run would hit
// these. Isolating record-by-record would walk the entire queue into quarantine
// over a paused contract or a rotated key, so the run aborts and touches nothing.
//   ContractError::Unauthorized - sender is not the configured attestor
//   ContractError::Paused
const FATAL = [/Unauthorized/, /Contract is paused/];

// Infrastructure, not verdicts. Left queued for the next run.
const RETRY = [/sequence/i, /insufficient fee/i, /out of gas/i,
               /tx already exists/i, /mempool is full/i];

// Everything else is specific to one record and permanent until someone looks:
//   UnknownAction     - the Worker queued an action the contract has no config for
//   NotFree           - the action moved to PaidAction; recording it now would
//                       double-pay whoever already paid through the contract
//   DeltaTooLarge     - the amount, or the configured weight, exceeds max_delta
//   AmountNotAllowed  - a record carried an amount for an action the contract
//                       does not mark `variable_amount`. Quarantine is right:
//                       retrying cannot help and dropping it would hide a real
//                       disagreement between the Worker and the contract config
//   Std(...)          - malformed wallet address and similar
function classify(log) {
  if (FATAL.some(re => re.test(log)))    return 'fatal';
  if (DECLINED.some(re => re.test(log))) return 'declined';
  if (RETRY.some(re => re.test(log)))    return 'retry';
  return 'quarantine';
}

// ── http ────────────────────────────────────────────────────────────────────

async function safeFetch(url, opts = {}, timeoutMs = 20000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
}

async function lcdGet(path) {
  let lastErr;
  for (const base of LCD_URLS) {
    try {
      const res = await safeFetch(base + path);
      if (res.status === 404) return { status: 404, body: null };
      if (!res.ok) { lastErr = new Error(`${base}${path} → ${res.status}`); continue; }
      return { status: res.status, body: await res.json() };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all LCD endpoints failed for ' + path);
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

// cosmwasm.wasm.v1.MsgExecuteContract - sender 1, contract 2, msg 3, funds 5.
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

// Builds and signs, but does not send. The tx hash is sha256 of the encoded
// TxRaw, so it is known BEFORE broadcast - which is what lets the queue be
// marked in-flight with a hash the next run can look up, even if the broadcast
// response never comes back.
async function buildTx(privateKey, publicKey, sender, anyMsgs, memo, accountNumber, sequence, gasLimit) {
  const enc = s => Buffer.from(s);
  const fee = Math.ceil(gasLimit * GAS_PRICE * FEE_HEADROOM); // no coins move, so no burn tax

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

  const txHash = createHash('sha256').update(txRawP).digest('hex').toUpperCase();
  return { txBytes: txRawP.toString('base64'), txHash, fee, gasLimit };
}

// Runs the tx against a node without publishing it. Costs nothing, so a bad
// record can be found and closed without ever burning a fee on a revert - and
// the gas figure comes back measured instead of guessed.
async function simulate(txBytes) {
  let lastErr;
  for (const base of LCD_URLS) {
    try {
      const res = await safeFetch(`${base}/cosmos/tx/v1beta1/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_bytes: txBytes }),
      });
      const data = await res.json();
      if (res.ok && data?.gas_info?.gas_used) {
        return { ok: true, gasUsed: parseInt(data.gas_info.gas_used) };
      }
      const log = data?.message || data?.error || JSON.stringify(data).slice(0, 400);
      return { ok: false, log };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all LCD endpoints failed to simulate');
}

// Single endpoint on purpose: retrying a broadcast against a second node after
// an ambiguous failure risks landing the same tx twice under a different
// sequence. The in-flight marker plus reconciliation covers the failure instead.
async function broadcastRaw(txBytes, expectedHash) {
  const res = await safeFetch(`${LCD_URLS[0]}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBytes, mode: 'BROADCAST_MODE_SYNC' }),
  });
  if (!res.ok) throw new Error(`LCD broadcast → ${res.status}`);
  let data; try { data = await res.json(); }
  catch { throw new Error('LCD broadcast returned non-JSON (proxy error?)'); }

  const code = data?.tx_response?.code ?? data?.code ?? 0;
  if (code !== 0) throw new Error('broadcast rejected: ' + (data?.tx_response?.raw_log || JSON.stringify(data)).slice(0, 300));

  const txHash = data?.tx_response?.txhash || data?.txhash;
  if (!txHash) throw new Error('broadcast returned no txhash: ' + JSON.stringify(data).slice(0, 300));
  if (txHash.toUpperCase() !== expectedHash) {
    throw new Error(`hash mismatch: node ${txHash}, local ${expectedHash}`);
  }
  return txHash;
}

async function txOutcome(txHash) {
  const { status, body } = await lcdGet(`/cosmos/tx/v1beta1/txs/${txHash}`);
  if (status === 404 || !body?.tx_response?.txhash) return { state: 'unknown' };
  const r = body.tx_response;
  if ((r.code ?? 0) !== 0) return { state: 'failed', log: String(r.raw_log).slice(0, 300) };
  return { state: 'success' };
}

async function confirm(txHash) {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const out = await txOutcome(txHash);
      if (out.state === 'success') return true;
      if (out.state === 'failed') throw new Error('tx failed on chain: ' + out.log);
    } catch (e) {
      if (e.message.startsWith('tx failed')) throw e;
    }
  }
  throw new Error('timed out waiting for ' + txHash);
}

// ── queue ───────────────────────────────────────────────────────────────────

async function workerFetch(path, init = {}) {
  const res = await safeFetch(`${WORKER_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Actions-Secret': ACTIONS_SECRET, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

async function fetchQueue(status = 'pending,inflight') {
  const all = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const q = `?limit=200&status=${encodeURIComponent(status)}${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`;
    const d = await workerFetch(`/rep/pending${q}`);
    all.push(...(d.records || []));
    if (d.done || !d.cursor) break;
    cursor = d.cursor;
  }
  return all;
}

async function setStatus(keys, status, txHash, note) {
  if (!keys.length) return 0;
  let updated = 0;
  for (let i = 0; i < keys.length; i += 200) {
    const d = await workerFetch('/rep/set-status', {
      method: 'POST',
      body: JSON.stringify({ keys: keys.slice(i, i + 200), status, txHash, note }),
    });
    updated += d.updated || 0;
  }
  return updated;
}

// Retried: the call is idempotent Worker-side, and a failure here after a
// confirmed tx is the one path that could pay twice. If every attempt fails the
// records stay in-flight and the next run reconciles them against the chain.
async function markRecorded(keys, txHash, outcome, note) {
  if (!keys.length) return 0;
  let marked = 0;
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const d = await workerFetch('/rep/mark-recorded', {
          method: 'POST',
          body: JSON.stringify({ keys: chunk, txHash, outcome, note }),
        });
        marked += d.marked || 0;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
    if (lastErr) throw lastErr;
  }
  return marked;
}

async function reconcileInflight(records) {
  if (!records.length) return;
  console.log(`reconciling ${records.length} in-flight record(s)`);
  const byTx = new Map();
  const noHash = [];
  for (const r of records) {
    if (!r.txHash) { noHash.push(r); continue; }
    if (!byTx.has(r.txHash)) byTx.set(r.txHash, []);
    byTx.get(r.txHash).push(r);
  }
  if (noHash.length) {
    await setStatus(noHash.map(r => r.key), 'pending', null, 'in-flight without tx hash');
    console.log(`  ${noHash.length} requeued (no hash)`);
  }
  for (const [txHash, group] of byTx) {
    const keys = group.map(r => r.key);
    const out = await txOutcome(txHash);
    if (out.state === 'success') {
      await markRecorded(keys, txHash);
      console.log(`  ${txHash} landed → ${keys.length} marked recorded`);
    } else if (out.state === 'failed') {
      await setStatus(keys, 'pending', null, 'tx reverted: ' + out.log);
      console.log(`  ${txHash} reverted → ${keys.length} requeued`);
    } else {
      const age = Date.now() - Math.max(...group.map(r => Date.parse(r.statusAt || 0) || r.ts || 0));
      if (age > 10 * 60 * 1000) {
        await setStatus(keys, 'pending', null, 'tx never seen on chain');
        console.log(`  ${txHash} not on chain after ${Math.round(age / 60000)}m → ${keys.length} requeued`);
      } else {
        console.log(`  ${txHash} still unresolved, leaving in-flight`);
      }
    }
  }
}

async function readAccount(sender) {
  const { body } = await lcdGet(`/cosmos/auth/v1beta1/accounts/${sender}`);
  const acct = body?.account || {};
  return {
    accountNumber: parseInt(acct.account_number || '0'),
    sequence: parseInt(acct.sequence || '0'),
  };
}

async function readBalance(addr) {
  const { body } = await lcdGet(`/cosmos/bank/v1beta1/balances/${addr}`);
  const c = (body?.balances || []).find(b => b.denom === 'uluna');
  return c ? BigInt(c.amount) : 0n;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!WORKER_URL || !ACTIONS_SECRET || !MNEMONIC || !CONTRACT) {
    console.error('Missing env: WORKER_URL, ACTIONS_SECRET, ATTESTOR_MNEMONIC, ORACLE_SCORE_CONTRACT');
    process.exit(1);
  }
  console.log('Oracle Score attestor -', new Date().toISOString());

  // Before the queue is touched: a wrong secret must not get as far as writing to it.
  const { privateKey, publicKey } = await deriveKeypair(MNEMONIC);
  const sender = pubkeyToAddress(publicKey);
  if (sender !== EXPECTED_ATTESTOR) {
    throw new Error(`address mismatch: mnemonic derives ${sender}, expected ${EXPECTED_ATTESTOR}`);
  }
  console.log(`attestor: ${sender}`);

  // A dry attestor fails every tx on the fee, which reads as a contract problem
  // in the logs. Say it plainly and early instead.
  const balance = await readBalance(sender);
  const luncLeft = Number(balance / 1_000_000n);
  const grantsLeft = Math.floor(luncLeft / 5);
  if (grantsLeft < 500) {
    console.warn(`::warning::attestor balance ${luncLeft} LUNC - roughly ${grantsLeft} more grants. Top it up.`);
  } else {
    console.log(`balance: ${luncLeft} LUNC (~${grantsLeft} grants)`);
  }

  const first = await fetchQueue('pending,inflight');
  await reconcileInflight(first.filter(r => r.status === 'inflight'));

  const pending = await fetchQueue('pending');
  console.log(`queue: ${pending.length} pending`);

  const tsOf = r => (typeof r.ts === 'number' ? r.ts : Date.parse(r.ts));
  const undated = pending.filter(r => !Number.isFinite(tsOf(r)));
  for (const r of undated) console.warn(`unusable ts on ${r.key} (${JSON.stringify(r.ts)}) - leaving queued`);

  const dated = pending.filter(r => Number.isFinite(tsOf(r)));

  const stale = dated.filter(r => tsOf(r) < SNAPSHOT_TS);
  if (stale.length) {
    console.log(`skipping ${stale.length} pre-snapshot record(s)`);
    await markRecorded(stale.map(r => r.key), 'pre-snapshot');
  }

  const fresh = dated.filter(r => tsOf(r) >= SNAPSHOT_TS);
  const unknown = fresh.filter(r => !ATTESTABLE_ACTIONS.has(r.action));
  for (const r of unknown) console.warn(`non-attestable action "${r.action}" - leaving ${r.key} queued`);

  const work = fresh.filter(r => ATTESTABLE_ACTIONS.has(r.action));
  if (!work.length) { console.log('nothing to record'); return; }

  const acct = await readAccount(sender);
  const accountNumber = acct.accountNumber;
  let sequence = acct.sequence;

  let recorded = 0, declined = 0, quarantined = 0, deferred = 0;

  // `amount` is only ever present on records the Worker queued for an action the
  // contract marks `variable_amount`. Sending it for anything else is rejected
  // outright, so it is passed through exactly as queued rather than defaulted.
  const msgsFor = records => records.map(r => buildExecuteMsg(sender, CONTRACT, {
    record_action: {
      user: r.wallet,
      action: r.action,
      ref_id: r.refId,
      ...(r.amount ? { amount: String(r.amount) } : {}),
    },
  }));

  async function sign(records, gasLimit) {
    return buildTx(
      privateKey, publicKey, sender, msgsFor(records),
      `oracle-score:attest:${records.length}`, accountNumber, sequence, gasLimit,
    );
  }

  // Decides what can actually be sent, without sending anything.
  //
  // A whole tx reverts on one bad message, so a failing batch says nothing about
  // which record caused it. Simulation answers that for free: re-simulate one at
  // a time and whatever fails alone is the culprit. If every record passes alone
  // but the batch still fails, the limit is cumulative - three answers to the
  // same question against a daily_limit of 3 - and the only honest read is to
  // send them separately and let the chain draw the line.
  async function plan(records) {
    const provisional = GAS_BASE + GAS_PER_MSG_GUESS * records.length;
    const { txBytes } = await sign(records, provisional);
    const sim = await simulate(txBytes);
    if (sim.ok) {
      return { mode: 'batch', good: records, bad: [], gasLimit: Math.ceil(sim.gasUsed * GAS_HEADROOM) };
    }
    // Checked before any isolation work: a run-wide failure must not be mistaken
    // for eight bad records in a row.
    if (classify(sim.log) === 'fatal') throw new Error('FATAL ' + sim.log.slice(0, 300));
    if (records.length === 1) {
      return { mode: 'batch', good: [], bad: [{ r: records[0], log: sim.log }], gasLimit: 0 };
    }
    const good = [], bad = [];
    for (const r of records) {
      const one = await plan([r]);
      if (one.good.length) good.push(r); else bad.push(...one.bad);
    }
    if (!good.length) return { mode: 'batch', good: [], bad, gasLimit: 0 };
    if (good.length === records.length) {
      return { mode: 'singles', good, bad, gasLimit: 0 };
    }
    const retry = await plan(good);
    return { mode: retry.mode, good: retry.good, bad: [...bad, ...retry.bad], gasLimit: retry.gasLimit };
  }

  async function send(records, gasLimit) {
    const { txBytes, txHash, fee } = await sign(records, gasLimit);
    await setStatus(records.map(r => r.key), 'inflight', txHash);
    await broadcastRaw(txBytes, txHash);
    await confirm(txHash);
    sequence++;
    const marked = await markRecorded(records.map(r => r.key), txHash);
    return { txHash, marked, fee };
  }

  async function close(r, log) {
    const verdict = classify(log);
    if (verdict === 'fatal') throw new Error('FATAL ' + log.slice(0, 300));
    if (verdict === 'declined') {
      await markRecorded([r.key], null, 'declined', log.slice(0, 300));
      declined++;
      console.log(`  declined ${r.action} / ${r.wallet.slice(0, 12)} - ${log.slice(0, 120)}`);
    } else if (verdict === 'retry') {
      console.warn(`  transient on ${r.key}, staying queued - ${log.slice(0, 120)}`);
    } else {
      await setStatus([r.key], 'quarantined', null, log.slice(0, 300));
      quarantined++;
      console.error(`  quarantined ${r.key} (${r.action} / ${r.wallet.slice(0, 12)}): ${log.slice(0, 160)}`);
    }
  }

  const batches = [];
  for (let i = 0; i < work.length; i += BATCH_SIZE) batches.push(work.slice(i, i + BATCH_SIZE));
  if (batches.length > MAX_BATCHES_PER_RUN) {
    deferred = batches.slice(MAX_BATCHES_PER_RUN).reduce((n, b) => n + b.length, 0);
    batches.length = MAX_BATCHES_PER_RUN;
  }

  for (let b = 0; b < batches.length; b++) {
    const label = `batch ${b + 1}/${batches.length}`;
    try {
      const p = await plan(batches[b]);
      for (const bad of p.bad) await close(bad.r, bad.log);

      if (!p.good.length) { console.log(`${label}: nothing sendable`); continue; }

      if (p.mode === 'singles') {
        console.log(`${label}: cumulative limit, sending ${p.good.length} separately`);
        for (const r of p.good) {
          try {
            const one = await plan([r]);
            if (!one.good.length) { for (const bad of one.bad) await close(bad.r, bad.log); continue; }
            const { marked } = await send([r], one.gasLimit);
            recorded += marked;
          } catch (e) {
            sequence = (await readAccount(sender)).sequence;
            await close(r, e.message);
          }
          await new Promise(x => setTimeout(x, 2000));
        }
      } else {
        const { txHash, marked, fee } = await send(p.good, p.gasLimit);
        recorded += marked;
        console.log(`${label}: ${p.good.length} msg → ${txHash} (marked ${marked}, fee ${Math.round(fee / 1e6)} LUNC)`);
      }
    } catch (err) {
      // A fatal verdict is not this batch's problem and will repeat on every
      // remaining one. Stop while the queue is still intact.
      if (err.message.startsWith('FATAL')) throw err;
      // Anything else that escapes plan/send is infrastructure, not a bad
      // record: the local sequence is no longer trustworthy, so re-read it.
      console.error(`${label} failed: ${err.message}`);
      sequence = (await readAccount(sender)).sequence;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  const left = work.length - recorded - declined - quarantined;
  console.log(`done: ${recorded} recorded, ${declined} declined, ${quarantined} quarantined, ${left} left pending` +
              (deferred ? ` (${deferred} over the per-run cap, next run)` : ''));
  if (quarantined) process.exitCode = 1;
}

main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
