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

// Вставка из Windows приносит \r и лишние пробелы, а bip39 выводит из такой
// строки другой ключ без ошибки. Схлопываем пробелы до одного.
const MNEMONIC  = (process.env.KEEPER_MNEMONIC || '').trim().split(/\s+/).filter(Boolean).join(' ') || undefined;
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

// RPC для проверки высоты (аудит MKT-04). LCD не сообщает, на какую высоту
// он ответил: проверено 30.09 на всех трёх узлах выше, заголовка в ответе
// нет. RPC abci_query возвращает высоту ответа в теле.
const RPC_URLS = (process.env.RPC_URLS || [
  'https://terra-classic-rpc.publicnode.com',
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
  const { validateMnemonic } = await import('bip39');
  if (!validateMnemonic(mnemonic)) {
    throw new Error('KEEPER_MNEMONIC is not a valid BIP39 phrase (typo or wrong word count)');
  }
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
      // gov v1, а не v1beta1: v1beta1 не отдаёт предложения с новыми типами
      // сообщений (проверено 30.09 на последнем предложении сети).
      const b = await lcdGet(`/cosmos/gov/v1/proposals/${p}`, height);
      return { status: b.proposal.status, text: `proposal #${p} status ${b.proposal.status}` };
    }
    default:
      throw new Error('unknown metric ' + spec.metric);
  }
}


// ── проверка высоты через RPC (аудит MKT-04) ────────────────────────────────
//
// LCD принимает высоту в заголовке запроса, но не подтверждает её в ответе.
// Узел или прокси, который заголовок выбросил, молча вернёт текущее
// состояние, и исход посчитается не по той высоте. Поэтому то же значение
// читается второй раз через RPC abci_query: там высота ответа приходит в теле
// и сверяется с запрошенной. Исход объявляется, только если оба чтения дали
// одно и то же число. Расхождение - рынок ждёт, керпер пишет причину в лог.

function pbField(no, bytes) { return encodeField(no, 2, Buffer.from(bytes)); }
function pbVarintField(no, n) { return Buffer.concat([encodeVarint((no << 3) | 0), encodeVarint(n)]); }

/** Разбор protobuf: номер поля -> массив значений (Buffer или BigInt). */
function pbParse(buf) {
  const out = {};
  let i = 0;
  const varint = () => {
    let r = 0n, shift = 0n;
    for (;;) {
      if (i >= buf.length) throw new Error('protobuf: truncated varint');
      const b = buf[i++];
      r |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return r;
      shift += 7n;
    }
  };
  while (i < buf.length) {
    const key = Number(varint());
    const no = key >> 3, wire = key & 7;
    let v;
    if (wire === 0) v = varint();
    else if (wire === 2) { const len = Number(varint()); v = buf.subarray(i, i + len); i += len; }
    else if (wire === 1) { v = buf.subarray(i, i + 8); i += 8; }
    else if (wire === 5) { v = buf.subarray(i, i + 4); i += 4; }
    else throw new Error('protobuf: unsupported wire type ' + wire);
    (out[no] = out[no] || []).push(v);
  }
  return out;
}
const pbStr = (f, no) => (f[no] && f[no][0] ? Buffer.from(f[no][0]).toString('utf8') : '');
const pbMsg = (f, no) => pbParse(f[no] && f[no][0] ? f[no][0] : Buffer.alloc(0));

/** sdk.Dec в protobuf - целое, умноженное на 10^18, без точки. */
function decRaw(s) {
  if (!/^\d+$/.test(s)) throw new Error('protobuf: bad Dec ' + s);
  return BigInt(s);
}

async function abciQuery(path, reqBytes, height) {
  const hex = Buffer.from(reqBytes).toString('hex');
  let lastErr;
  for (const base of RPC_URLS) {
    try {
      const url = `${base}/abci_query?path=${encodeURIComponent('"' + path + '"')}&data=0x${hex}&height=${height}&prove=false`;
      const res = await safeFetch(url);
      const body = await res.json().catch(() => null);
      const r = body?.result?.response;
      if (!res.ok || !r) { lastErr = new Error(`${base} abci_query → ${res.status}`); continue; }
      if (Number(r.code || 0) !== 0) { lastErr = new Error(`${base} abci_query: ${r.log || 'code ' + r.code}`); continue; }
      if (String(r.height) !== String(height)) {
        lastErr = new Error(`${base} answered for height ${r.height} instead of ${height}`);
        continue;
      }
      return Buffer.from(r.value || '', 'base64');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all RPC endpoints failed for ' + path);
}

const GOV_STATUS = ['PROPOSAL_STATUS_UNSPECIFIED', 'PROPOSAL_STATUS_DEPOSIT_PERIOD', 'PROPOSAL_STATUS_VOTING_PERIOD',
  'PROPOSAL_STATUS_PASSED', 'PROPOSAL_STATUS_REJECTED', 'PROPOSAL_STATUS_FAILED'];

/** То же, что readMetric, но через RPC с проверкой высоты. Возвращает
 *  { v } в той же шкале (x10^18) или { status } для голосований. */
async function readMetricAtHeight(spec, height) {
  const p = spec.param;
  switch (spec.metric) {
    case 'total_supply': {
      const f = pbParse(await abciQuery('/cosmos.bank.v1beta1.Query/SupplyOf', pbField(1, 'uluna'), height));
      return { v: toScaled(pbStr(pbMsg(f, 1), 2)) };
    }
    case 'community_pool': {
      const f = pbParse(await abciQuery('/cosmos.distribution.v1beta1.Query/CommunityPool', Buffer.alloc(0), height));
      const c = (f[1] || []).map(pbParse).find((x) => pbStr(x, 1) === 'uluna');
      if (!c) throw new Error('no uluna in the community pool');
      return { v: decRaw(pbStr(c, 2)) };
    }
    case 'validator_power': {
      const f = pbParse(await abciQuery('/cosmos.staking.v1beta1.Query/Validator', pbField(1, p), height));
      return { v: toScaled(pbStr(pbMsg(f, 1), 5)) };
    }
    case 'oracle_rate': {
      const f = pbParse(await abciQuery('/terra.oracle.v1beta1.Query/ExchangeRates', Buffer.alloc(0), height));
      const r = (f[1] || []).map(pbParse).find((x) => pbStr(x, 1) === p);
      if (!r) throw new Error(`no oracle rate for ${p}`);
      return { v: decRaw(pbStr(r, 2)) };
    }
    case 'staking_ratio': {
      const pool = pbMsg(pbParse(await abciQuery('/cosmos.staking.v1beta1.Query/Pool', Buffer.alloc(0), height)), 1);
      const free = BigInt(pbStr(pool, 1) || '0'), bonded = BigInt(pbStr(pool, 2) || '0');
      if (bonded + free === 0n) throw new Error('empty staking pool');
      return { v: (bonded * 100n * ONE) / (bonded + free) };
    }
    case 'proposal_passed': {
      const f = pbParse(await abciQuery('/cosmos.gov.v1.Query/Proposal', pbVarintField(1, Number(p)), height));
      const st = pbMsg(f, 1)[3];
      return { status: GOV_STATUS[Number(st ? st[0] : 0n)] || 'UNKNOWN' };
    }
    default:
      throw new Error('unknown metric ' + spec.metric);
  }
}

/** Оба чтения обязаны совпасть. */
function sameReading(a, b) {
  if ('status' in a || 'status' in b) return a.status === b.status;
  return a.v === b.v;
}

/** Исход по спеке. Текст reading уходит в контракт и виден людям, поэтому
 *  в нём число из ответа узла и высота, а не пересказ. */
async function resolveSpec(m) {
  const spec = m.spec;
  const h = Number(spec.height);
  const r = await readMetric(spec, h);
  const checked = await readMetricAtHeight(spec, h);
  if (!sameReading(r, checked)) {
    throw new Error(`height check failed at ${h}: LCD gave ${r.status || fromScaled(r.v, 18)}, RPC gave ${checked.status || fromScaled(checked.v, 18)}`);
  }
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
  // С 0.2.4 сроки спора хранятся в самом рынке и не меняются вместе с
  // конфигом. Конфиг - только для рынков без своей копии.
  const rules = m.rules || pcfg;

  if (m.status === 'open' || m.status === 'locked') {
    if (now >= due + Number(rules.resolve_grace_secs)) {
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
    if (now >= Number(m.proposed_at) + Number(rules.challenge_secs)) {
      return { what: `settle #${id}: challenge window passed`, contract: PROPHECY, msg: { settle: { market_id: id } } };
    }
    return null;
  }

  if (m.status === 'disputed') {
    const arbEnd = Number(m.disputed_at) + Number(rules.arbiter_secs);
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

// ── REP создателям рынков ───────────────────────────────────────────────────
//
// Рынок рассчитан, на обеих сторонах есть участники, и проигравшая сторона без
// доплаты не меньше порога - создатель получает REP. Решение принимает керпер,
// потому что оно целиком из цепочки. Worker начисляет один раз на рынок, так
// что повторный вызов на следующем проходе ничего не добавит.
//
// Порог - защита от накрутки: создатель может поставить с двух своих кошельков
// на разные стороны. Это стоит ему 7% проигравшей стороны (10% комиссии минус
// его же 3%), а REP превращается в долю недельной выплаты.
const WORKER_URL     = process.env.WORKER_URL || '';
const ACTIONS_SECRET = process.env.ACTIONS_SECRET || '';
const REP_MIN_LOSING = BigInt(process.env.MARKET_REP_MIN_LOSING || '300000000000'); // uluna
const REP_WINDOW_SECS = 30 * 86400;

function repEligible(m, now) {
  if (m.status !== 'settled' || typeof m.outcome !== 'boolean') return false;
  if (now - Number(m.resolve_after) > REP_WINDOW_SECS) return false;
  if (!(Number(m.bettors_yes) > 0 && Number(m.bettors_no) > 0)) return false;
  const losing = BigInt(m.outcome ? m.pot_no : m.pot_yes);
  return losing >= REP_MIN_LOSING;
}

async function grantCreatorRep(now) {
  // Сухой прогон показывает план на любой сети - так это проверяется на
  // rebel-2 с низким порогом. Настоящее начисление - только с mainnet.
  if (!DRY) {
    if (CHAIN_ID !== 'columbus-5') return;
    if (!WORKER_URL || !ACTIONS_SECRET) { log('· creator REP: WORKER_URL or ACTIONS_SECRET not set, skipped'); return; }
  }
  let settled;
  try { settled = await listMarkets('settled'); } catch (e) {
    log('· creator REP: could not list settled markets:', e.message);
    return;
  }
  const due = settled.filter((m) => repEligible(m, now));
  if (!due.length) return;
  for (const m of due) {
    if (DRY) { log('→', `creator REP #${m.id} to ${m.creator} [dry run]`); continue; }
    try {
      const res = await safeFetch(WORKER_URL + '/rep/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Actions-Secret': ACTIONS_SECRET },
        body: JSON.stringify({ wallet: m.creator, contract: PROPHECY, marketId: m.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { log('   creator REP FAILED', `#${m.id}`, res.status, j.error || ''); continue; }
      if (!j.already) log('   creator REP', `#${m.id}`, m.creator, `+${j.added}`);
    } catch (e) {
      // Worker недоступен - следующий проход повторит, двойного не будет.
      log('   creator REP FAILED', `#${m.id}`, e.message);
    }
  }
}

// ── уведомления совета ──────────────────────────────────────────────────────
//
// Без кворума суд аннулирует рынок и всем возвращает деньги - включая того,
// кто оспорил верный исход. Значит, живой совет - часть защиты, и о новом деле
// он должен узнавать сразу. Текст уходит в группу Oracle Eye (там же баги),
// поэтому у него свой заголовок. Формат - Markdown Telegram, как у Eye.
const SITE_URL      = process.env.SITE_URL || 'https://terraoracle.io';
const REMIND_BEFORE = 12 * 3600;

function utc(ts) {
  return new Date(Number(ts) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}
function hours(secs) {
  const h = Math.max(0, Math.round(Number(secs) / 3600));
  return h + (h === 1 ? ' hour' : ' hours');
}
function lunc(uluna) {
  return Number(BigInt(uluna || '0') / 1000000n).toLocaleString('en-US') + ' LUNC';
}
// Markdown Telegram (старый): спецсимволы в пользовательском тексте экранируются.
function md(s) {
  return String(s == null ? '' : s).replace(/([_*`\[])/g, '\\$1');
}

/** Отправить совету один раз на ключ. Worker помнит отправленное. */
async function councilOnce(key, text) {
  if (DRY) { log('→', `council message [dry run] ${key}\n${text}`); return; }
  const res = await safeFetch(WORKER_URL + '/keeper/council', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Actions-Secret': ACTIONS_SECRET },
    body: JSON.stringify({ key, text }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`council ${res.status} ${j.error || ''}`);
  if (j.sent) log('   council notified', key);
}

async function notifyCouncil(now) {
  if (!COURT) return;
  if (!DRY && (!WORKER_URL || !ACTIONS_SECRET)) return;
  let disputed, ccfg;
  try {
    disputed = await listMarkets('disputed');
    if (!disputed.length) return;
    ccfg = await smart(COURT, { config: {} });
  } catch (e) {
    log('· council notify: could not read markets or court:', e.message);
    return;
  }
  const net = CHAIN_ID === 'columbus-5' ? 'mainnet' : CHAIN_ID;
  for (const m of disputed) {
    try {
      const kase = await smart(COURT, { case: { market_id: m.id } });
      const quorum = Number(kase ? kase.quorum : ccfg.quorum);
      const votes = kase ? Number(kase.yes) + Number(kase.no) + Number(kase.void) : 0;
      const endsAt = kase ? Number(kase.ends_at) : Number(m.disputed_at) + Number(ccfg.voting_secs);
      if (kase?.closed || now >= endsAt) continue;
      const base = `court:${PROPHECY.slice(-8)}:${m.id}`;
      const posted = m.outcome === true ? 'YES' : m.outcome === false ? 'NO' : 'none';

      await councilOnce(`${base}:open`,
        `⚖️ *MARKETS COURT - new case*\n`
        + `Market #${m.id} · ${net}\n\n`
        + `${md(m.question)}\n\n`
        + `Posted outcome: *${posted}*${m.reading ? ` (${md(m.reading)})` : ''}\n`
        + `Challenged by \`${m.challenger || '?'}\`\n`
        + `Pots: YES ${lunc(m.pot_yes)} · NO ${lunc(m.pot_no)}\n\n`
        + `🗳 Vote YES, NO or VOID before *${utc(endsAt)}* (${hours(endsAt - now)} left)\n`
        + `Quorum ${quorum} · check the value on chain at block ${md(m.spec?.height)}`);

      if (votes < quorum && endsAt - now <= REMIND_BEFORE) {
        await councilOnce(`${base}:remind`,
          `⏰ *MARKETS COURT - quorum not reached*\n`
          + `Market #${m.id} · ${net}: ${votes} of ${quorum} votes, voting ends *${utc(endsAt)}* `
          + `(${hours(endsAt - now)} left).\n`
          + `Without quorum the market is voided and everyone, the challenger included, gets refunded.`);
      }
    } catch (e) {
      log('   council notify FAILED', `#${m.id}`, e.message);
    }
  }
}

// ── main ────────────────────────────────────────────────────────────────────

/** KEEPER_SELFTEST=1: читает все шесть метрик на недавней высоте обоими
 *  способами и печатает, совпали ли. Ничего не подписывает. */
async function selftest() {
  const step = async (what, fn) => {
    try { return await fn(); } catch (e) { log('ERR ', what, e.message, e.cause ? `(${e.cause.code || e.cause})` : ''); return null; }
  };
  const tip = await step('chain tip', chainTip);
  if (!tip) { process.exitCode = 1; return; }
  const h = tip.height - 100;
  // Список предложений берём из gov v1: в v1beta1 он падает целиком, если
  // хоть одно предложение не переводится в старый формат.
  const vals = await step('validator list', () => lcdGet('/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=1'));
  const props = await step('proposal list', () => lcdGet('/cosmos/gov/v1/proposals?pagination.reverse=true&pagination.limit=1'));
  const cases = [
    { metric: 'total_supply' },
    { metric: 'community_pool' },
    { metric: 'staking_ratio' },
    { metric: 'oracle_rate', param: 'uusd' },
  ];
  if (vals?.validators?.[0]) cases.push({ metric: 'validator_power', param: vals.validators[0].operator_address });
  if (props?.proposals?.[0]) cases.push({ metric: 'proposal_passed', param: String(props.proposals[0].id) });
  log(`selftest at height ${h}`);
  let bad = 0;
  for (const c of cases) {
    try {
      const a = await readMetric(c, h);
      const b = await readMetricAtHeight(c, h);
      const ok = sameReading(a, b);
      if (!ok) bad++;
      log(ok ? 'OK  ' : 'DIFF', c.metric, 'LCD', a.status || fromScaled(a.v, 18), '| RPC', b.status || fromScaled(b.v, 18));
    } catch (e) { bad++; log('ERR ', c.metric, e.message, e.cause ? `(${e.cause.code || e.cause})` : ''); }
  }
  log(bad ? `${bad} problem(s)` : `all ${cases.length} match`);
  if (bad) process.exitCode = 1;
}

async function main() {
  if (process.env.KEEPER_SELFTEST === '1') return selftest();
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
  // Ошибки начисления REP не роняют прогон: деньги рынков важнее.
  await grantCreatorRep(tip.time);
  // Уведомления тоже не роняют прогон.
  await notifyCouncil(tip.time);
  log(`done: ${done}, failed: ${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error('keeper error:', e.message); process.exit(1); });
