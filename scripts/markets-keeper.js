// scripts/markets-keeper.js
// Доводит рынки oracle-prophecy до выплат без человека.
//
// Каждый проход:
//   1. объявляет исход ончейн-рынков, у которых наступил срок: читает метрику
//      на высоте из спеки, сравнивает с порогом, отправляет propose. Только
//      если ключ керпера - резолвер рынка, и только для ончейн-метрик;
//      свободные критерии остаются людям
//   2. рассчитывает рынки, у которых прошло окно оспаривания (settle).
//      Без этого исход верный, а выплаты так и не открываются
//   3. закрывает дела суда после конца голосования
//   4. аннулирует зависшее: спор без решения после окна арбитра, рынок без
//      объявления после grace-периода
//
// Подпись, симуляция и отправка - те же, что в oracle-score-attest.js: чистый
// HTTP и protobuf руками, без cosmjs.
//
// DRY_RUN=1 - только напечатать, что было бы сделано, ничего не подписывая.

import { createHash } from 'crypto';

const MNEMONIC  = process.env.KEEPER_MNEMONIC;
const PROPHECY  = process.env.PROPHECY_CONTRACT;
const COURT     = process.env.COURT_CONTRACT || '';
const CHAIN_ID  = process.env.CHAIN_ID || 'columbus-5';
const DRY       = process.env.DRY_RUN === '1';
// Адрес, который обязан получиться из мнемоники. Не совпал - значит в
// секретах не тот ключ, и подписывать им нельзя.
const EXPECTED  = process.env.EXPECTED_KEEPER || '';

const LCD_URLS = (process.env.LCD_URLS || [
  'https://terra-classic-lcd.publicnode.com',
  'https://lcd.terrarebels.net',
  'https://terra-classic-lcd.everstake.one',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const GAS_PRICE = 28.325;
const FEE_HEADROOM = 1.05;
const GAS_HEADROOM = 1.4;
const GAS_PROVISIONAL = 600_000;
// Проход раз в 10 минут, который делает сотни транзакций, - это проход,
// который наезжает сам на себя.
const MAX_ACTIONS_PER_RUN = 20;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ── http ────────────────────────────────────────────────────────────────────

async function safeFetch(url, opts = {}, timeoutMs = 20000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
}

async function lcdGet(path, height) {
  let lastErr;
  const headers = height ? { 'x-cosmos-block-height': String(height) } : {};
  for (const base of LCD_URLS) {
    try {
      const res = await safeFetch(base + path, { headers });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        lastErr = new Error(`${base}${path} → ${res.status} ${body?.message || ''}`.trim());
        continue;
      }
      return body;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all LCD endpoints failed for ' + path);
}

async function smart(contract, msg) {
  const q = Buffer.from(JSON.stringify(msg)).toString('base64');
  const body = await lcdGet(`/cosmwasm/wasm/v1/contract/${contract}/smart/${q}`);
  return body.data;
}

async function chainTip() {
  const b = await lcdGet('/cosmos/base/tendermint/v1beta1/blocks/latest');
  return {
    height: Number(b.block.header.height),
    time: Math.floor(Date.parse(b.block.header.time) / 1000),
  };
}

// ── подпись: из oracle-score-attest.js без изменений ───────────────────────

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

function encodeVarint(n) { n = Number(n); const b = []; while (n > 127) { b.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } b.push(n & 0x7f); return Buffer.from(b); }
function encodeField(f, w, d) { const t = encodeVarint((f << 3) | w); if (w === 2) { return Buffer.concat([t, encodeVarint(d.length), d]); } return t; }

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

async function buildTx(privateKey, publicKey, sender, anyMsgs, memo, accountNumber, sequence, gasLimit) {
  const enc = s => Buffer.from(s);
  const fee = Math.ceil(gasLimit * GAS_PRICE * FEE_HEADROOM);
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
      if (res.ok && data?.gas_info?.gas_used) return { ok: true, gasUsed: parseInt(data.gas_info.gas_used) };
      return { ok: false, log: data?.message || data?.error || JSON.stringify(data).slice(0, 400) };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all LCD endpoints failed to simulate');
}

// Один узел намеренно: повтор отправки на другой узел после неясной ошибки
// рискует провести ту же транзакцию дважды.
async function broadcastRaw(txBytes, expectedHash) {
  const res = await safeFetch(`${LCD_URLS[0]}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBytes, mode: 'BROADCAST_MODE_SYNC' }),
  });
  if (!res.ok) throw new Error(`LCD broadcast → ${res.status}`);
  const data = await res.json();
  const code = data?.tx_response?.code ?? data?.code ?? 0;
  if (code !== 0) throw new Error('broadcast rejected: ' + (data?.tx_response?.raw_log || JSON.stringify(data)).slice(0, 300));
  const txHash = data?.tx_response?.txhash || data?.txhash;
  if (!txHash || txHash.toUpperCase() !== expectedHash) throw new Error(`hash mismatch: node ${txHash}, local ${expectedHash}`);
  return txHash;
}

async function confirm(txHash) {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const body = await lcdGet(`/cosmos/tx/v1beta1/txs/${txHash}`);
      const r = body?.tx_response;
      if (r?.txhash) {
        if ((r.code ?? 0) !== 0) throw new Error('tx failed on chain: ' + String(r.raw_log).slice(0, 300));
        return true;
      }
    } catch (e) {
      if (e.message.startsWith('tx failed')) throw e;
    }
  }
  throw new Error('timed out waiting for ' + txHash);
}

async function readAccount(sender) {
  const body = await lcdGet(`/cosmos/auth/v1beta1/accounts/${sender}`);
  const acct = body?.account || {};
  return { accountNumber: parseInt(acct.account_number || '0'), sequence: parseInt(acct.sequence || '0') };
}

/** Симуляция, настоящий лимит газа, отправка, ожидание блока. Симуляция
 *  бесплатна: если действие уже выполнил кто-то другой, газ не сгорит. */
async function execute(kp, sender, contract, msg, memo) {
  if (DRY) { log('   [dry run] not sent'); return null; }
  const acct = await readAccount(sender);
  const any = buildExecuteMsg(sender, contract, msg);
  const prov = await buildTx(kp.privateKey, kp.publicKey, sender, [any], memo, acct.accountNumber, acct.sequence, GAS_PROVISIONAL);
  const sim = await simulate(prov.txBytes);
  if (!sim.ok) throw new Error('simulation: ' + sim.log);
  const tx = await buildTx(kp.privateKey, kp.publicKey, sender, [any], memo,
    acct.accountNumber, acct.sequence, Math.ceil(sim.gasUsed * GAS_HEADROOM));
  await broadcastRaw(tx.txBytes, tx.txHash);
  await confirm(tx.txHash);
  return tx.txHash;
}

// ── чтение метрик ───────────────────────────────────────────────────────────
//
// Всё сравнивается в BigInt с масштабом 10^18. Саплай 6.45×10^18 uluna не
// помещается в число JavaScript без потери точности, а у порога ошибка в
// последних знаках перевернула бы исход.

const ONE = 10n ** 18n;

function toScaled(s) {
  s = String(s).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('not a number: ' + s);
  const [i, f = ''] = s.split('.');
  return BigInt(i) * ONE + BigInt((f + '0'.repeat(18)).slice(0, 18));
}

function fromScaled(v, dp = 6) {
  const i = v / ONE;
  const f = (v % ONE).toString().padStart(18, '0').slice(0, dp).replace(/0+$/, '');
  return f ? `${i}.${f}` : `${i}`;
}

function holds(cmp, v, t) {
  switch (cmp) {
    case 'gt': return v > t;
    case 'gte': return v >= t;
    case 'lt': return v < t;
    case 'lte': return v <= t;
    case 'eq': return v === t;
    default: throw new Error('unknown comparator ' + cmp);
  }
}

const CMP_WORD = { gt: 'above', gte: 'at least', lt: 'below', lte: 'at most', eq: 'equal to' };

function luncText(scaledUluna) {
  const lunc = Number(scaledUluna / ONE) / 1e6;
  if (lunc >= 1e12) return ` (${(lunc / 1e12).toFixed(2)}T LUNC)`;
  if (lunc >= 1e9) return ` (${(lunc / 1e9).toFixed(2)}B LUNC)`;
  if (lunc >= 1e6) return ` (${(lunc / 1e6).toFixed(2)}M LUNC)`;
  return ` (${Math.floor(lunc).toLocaleString('en-US')} LUNC)`;
}

/** Метрика на высоте. Пути совпадают с METRIC_PATHS на сайте: проверяющий
 *  вручную должен получить то же число, что прочитал керпер. */
async function readMetric(spec, height) {
  const p = spec.param;
  switch (spec.metric) {
    case 'total_supply': {
      const b = await lcdGet('/cosmos/bank/v1beta1/supply/by_denom?denom=uluna', height);
      const v = toScaled(b.amount.amount);
      return { v, text: `${b.amount.amount} uluna${luncText(v)}` };
    }
    case 'community_pool': {
      const b = await lcdGet('/cosmos/distribution/v1beta1/community_pool', height);
      const c = (b.pool || []).find((x) => x.denom === 'uluna');
      if (!c) throw new Error('no uluna in the community pool');
      const v = toScaled(c.amount);
      return { v, text: `${c.amount} uluna${luncText(v)}` };
    }
    case 'validator_power': {
      const b = await lcdGet(`/cosmos/staking/v1beta1/validators/${p}`, height);
      const v = toScaled(b.validator.tokens);
      return { v, text: `${b.validator.tokens} uluna delegated${luncText(v)}` };
    }
    case 'oracle_rate': {
      const b = await lcdGet('/terra/oracle/v1beta1/denoms/exchange_rates', height);
      const r = (b.exchange_rates || []).find((x) => x.denom === p);
      if (!r) throw new Error(`no oracle rate for ${p}`);
      return { v: toScaled(r.amount), text: `${r.amount} ${p} per LUNC` };
    }
    case 'staking_ratio': {
      const b = await lcdGet('/cosmos/staking/v1beta1/pool', height);
      const bonded = BigInt(b.pool.bonded_tokens), free = BigInt(b.pool.not_bonded_tokens);
      if (bonded + free === 0n) throw new Error('empty staking pool');
      const v = (bonded * 100n * ONE) / (bonded + free);
      return { v, text: `${fromScaled(v, 4)}% staked (bonded ${bonded} / ${bonded + free})` };
    }
    case 'proposal_passed': {
      const b = await lcdGet(`/cosmos/gov/v1beta1/proposals/${p}`, height);
      return { status: b.proposal.status, text: `proposal #${p} status ${b.proposal.status}` };
    }
    default:
      throw new Error('unknown metric ' + spec.metric);
  }
}

/** Исход по спеке. Текст reading уходит в контракт и виден людям, поэтому
 *  в нём число из ответа узла и высота, а не пересказ. */
async function resolveSpec(m) {
  const spec = m.spec;
  const h = Number(spec.height);
  const r = await readMetric(spec, h);
  if (spec.metric === 'proposal_passed') {
    const yes = r.status === 'PROPOSAL_STATUS_PASSED';
    return { outcome: yes, reading: `${r.text} at height ${h} - ${yes ? 'passed' : 'not passed'}` };
  }
  const t = toScaled(spec.threshold);
  const yes = holds(spec.comparator, r.v, t);
  const word = CMP_WORD[spec.comparator] || spec.comparator;
  return {
    outcome: yes,
    reading: `${spec.metric} at height ${h} = ${r.text}; ${yes ? '' : 'not '}${word} the threshold ${spec.threshold}`,
  };
}

// ── рынки ───────────────────────────────────────────────────────────────────

async function listMarkets(status) {
  const out = [];
  let startAfter;
  for (let page = 0; page < 20; page++) {
    const q = { markets: { status, limit: 50 } };
    if (startAfter !== undefined) q.markets.start_after = startAfter;
    const r = await smart(PROPHECY, q);
    const list = r?.markets || [];
    out.push(...list);
    if (list.length < 50) break;
    startAfter = list[list.length - 1].id;
  }
  return out;
}

// ── дрейф блоков ────────────────────────────────────────────────────────────
//
// Высота в спеке посчитана по среднему времени блока, а блоки плывут. Если
// блок с этой высотой наступил раньше закрытия приёма, исход можно было
// увидеть, пока приём ещё шёл. Предсказание, сделанное на этой высоте или
// позже, могло опираться на известный ответ - такой рынок честно не
// рассчитать, его аннулируют и возвращают всем деньги.
async function blockTime(height) {
  const b = await lcdGet(`/cosmos/base/tendermint/v1beta1/blocks/${height}`);
  const t = Date.parse(b?.block?.header?.time);
  if (!Number.isFinite(t)) throw new Error(`no time in block ${height}`);
  return Math.floor(t / 1000);
}

/** Были ли предсказания на рынке в блоках от height и позже. */
async function predictionsFrom(marketId, height) {
  const q = `wasm._contract_address='${PROPHECY}' AND wasm.action='bet'`
    + ` AND wasm.market_id=${Number(marketId)} AND tx.height>=${Number(height)}`;
  const body = await lcdGet('/cosmos/tx/v1beta1/txs?query=' + encodeURIComponent(q)
    + '&order_by=ORDER_BY_ASC&pagination.limit=50');
  // Узел мог проигнорировать условие по высоте - проверяем сами.
  for (const r of body?.tx_responses || []) {
    if (Number(r.height) < Number(height)) continue;
    for (const ev of r.events || []) {
      if (ev.type !== 'wasm') continue;
      const a = {};
      for (const x of ev.attributes || []) a[x.key] = x.value;
      if (a._contract_address === PROPHECY && a.action === 'bet' && Number(a.market_id) === Number(marketId)) {
        return { found: true, height: Number(r.height), hash: r.txhash };
      }
    }
  }
  return { found: false };
}

/** null - дрейфа нет или он безвреден; { void } - аннулировать; { note } - ждать. */
async function driftCheck(m) {
  const h = Number(m.spec.height);
  const close = Number(m.bets_close_at);
  let t;
  try { t = await blockTime(h); } catch (e) {
    return { note: `#${m.id}: could not read block ${h} to check drift: ${e.message}` };
  }
  if (t >= close) return null;
  let p;
  try { p = await predictionsFrom(m.id, h); } catch (e) {
    return { note: `#${m.id}: block ${h} came ${close - t}s before predictions closed; tx search failed, retry next run: ${e.message}` };
  }
  if (!p.found) {
    log('·', `#${m.id}: block ${h} came ${close - t}s before predictions closed, but no prediction at or after it`);
    return null;
  }
  const reason = `height ${h} reached ${close - t}s before predictions closed; prediction at height ${p.height}`;
  return {
    void: {
      what: `void #${m.id}: ${reason}`,
      contract: PROPHECY,
      msg: { void: { market_id: m.id, bad_spec: false, reason: reason.slice(0, 480) } },
    },
  };
}

/** Что сделать с рынком сейчас. Возвращает план, ничего не отправляя. */
async function planFor(m, ctx) {
  const { now, tip, pcfg, isResolver } = ctx;
  const id = m.id;
  const due = Number(m.resolve_after);

  if (m.status === 'open' || m.status === 'locked') {
    if (now >= due + Number(pcfg.resolve_grace_secs)) {
      return { what: `expire #${id}: no outcome within the grace period`, contract: PROPHECY, msg: { expire: { market_id: id } } };
    }
    if (now < due) return null;
    if (!m.spec?.metric) return { note: `#${id}: free criterion, waiting for a person to resolve` };
    if (!isResolver) return { note: `#${id}: due, but this key is not the resolver` };
    if (tip.height < Number(m.spec.height)) {
      return { note: `#${id}: due by time, chain at ${tip.height}, spec height ${m.spec.height} not reached yet` };
    }
    const drift = await driftCheck(m);
    if (drift?.note) return { note: drift.note };
    if (drift?.void) return drift.void;
    try {
      const r = await resolveSpec(m);
      return {
        what: `propose #${id}: ${r.outcome ? 'YES' : 'NO'} - ${r.reading}`,
        contract: PROPHECY,
        msg: { propose: { market_id: id, outcome: r.outcome, reading: r.reading.slice(0, 480) } },
      };
    } catch (e) {
      // Узлы не хранят состояние вечно. Если высоту уже вычистили, объявлять
      // по догадке нельзя - нужен архивный узел или человек.
      return { note: `#${id}: could not read the metric at height ${m.spec.height}: ${e.message}` };
    }
  }

  if (m.status === 'proposed') {
    if (now >= Number(m.proposed_at) + Number(pcfg.challenge_secs)) {
      return { what: `settle #${id}: challenge window passed`, contract: PROPHECY, msg: { settle: { market_id: id } } };
    }
    return null;
  }

  if (m.status === 'disputed') {
    const arbEnd = Number(m.disputed_at) + Number(pcfg.arbiter_secs);
    if (now >= arbEnd) {
      return { what: `expire #${id}: the court did not rule in time`, contract: PROPHECY, msg: { expire: { market_id: id } } };
    }
    if (!COURT) return null;
    const kase = await smart(COURT, { case: { market_id: id } });
    if (kase && !kase.closed && now >= Number(kase.ends_at)) {
      return { what: `close case #${id}: voting ended`, contract: COURT, msg: { close: { market_id: id } } };
    }
    return null;
  }
  return null;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!PROPHECY) throw new Error('PROPHECY_CONTRACT is not set');
  if (!DRY && !MNEMONIC) throw new Error('KEEPER_MNEMONIC is not set (or run with DRY_RUN=1)');

  let kp = null, sender = '';
  if (MNEMONIC) {
    kp = await deriveKeypair(MNEMONIC);
    sender = pubkeyToAddress(kp.publicKey);
    if (EXPECTED && sender !== EXPECTED) {
      throw new Error(`mnemonic derives ${sender}, expected ${EXPECTED} - refusing to sign`);
    }
  }

  const tip = await chainTip();
  const pcfg = await smart(PROPHECY, { config: {} });
  const isResolver = !!sender && sender === pcfg.resolver;
  log(`chain ${CHAIN_ID} at ${tip.height}, keeper ${sender || '(no key, dry run)'}${isResolver ? ' = resolver' : ''}${DRY ? ', DRY RUN' : ''}`);

  const ctx = { now: tip.time, tip, pcfg, isResolver };
  const markets = [];
  for (const st of ['open', 'locked', 'proposed', 'disputed']) markets.push(...await listMarkets(st));
  log(`${markets.length} market(s) not yet final`);

  const plans = [];
  for (const m of markets) {
    const p = await planFor(m, ctx);
    if (!p) continue;
    if (p.note) log('·', p.note);
    else plans.push(p);
  }

  let done = 0, failed = 0;
  for (const p of plans.slice(0, MAX_ACTIONS_PER_RUN)) {
    log('→', p.what);
    try {
      const hash = await execute(kp, sender, p.contract, p.msg, 'markets-keeper');
      if (hash) log('   ok', hash);
      done++;
    } catch (e) {
      // Одна неудача не должна останавливать остальные рынки.
      log('   FAILED', e.message);
      failed++;
    }
  }
  if (plans.length > MAX_ACTIONS_PER_RUN) log(`${plans.length - MAX_ACTIONS_PER_RUN} action(s) left for the next run`);
  log(`done: ${done}, failed: ${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error('keeper error:', e.message); process.exit(1); });
