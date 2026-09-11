#!/usr/bin/env node
/**
 * pool-keeper.js - opens and settles rounds in the oracle-pool contracts.
 *
 * Two jobs, both idempotent and self-healing: every run works out what is
 * actually due from on-chain state rather than assuming the previous run
 * succeeded. A missed run is caught up by the next one.
 *
 *   open   - commit the next round while the current one is still taking
 *            entries. That ordering IS the guarantee: the seed is fixed before
 *            the round's participants exist, so nobody can aim the result.
 *   settle - reveal a closed round. Permissionless on the contract, so this
 *            needs no privileged key at all; we run it only so it happens
 *            promptly.
 *
 * Secrets are derived, never stored:
 *     secret = HMAC-SHA256(ORACLE_MASTER_SEED, `${pool}:${roundId}`)
 * There is nothing on disk to lose and nothing in the repo to leak. Losing the
 * master seed means no round can ever be revealed again - funds are still
 * recoverable through RolloverRound, which anyone may call.
 *
 * Env:
 *   ORACLE_MASTER_SEED   64 hex chars
 *   POOL_KEEPER_MNEMONIC signer; only needs to be the pools' config admin,
 *                        NOT the wasm admin that can migrate contracts
 *   POOL_DAILY, POOL_WEEKLY   contract addresses
 *   LCD, RPC, CHAIN_ID   optional overrides
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { stringToPath } from '@cosmjs/crypto';

const LCD = process.env.LCD || 'https://terra-classic-lcd.publicnode.com';
const RPC = process.env.RPC || 'https://terra-classic-rpc.publicnode.com';
const CHAIN_ID = process.env.CHAIN_ID || 'columbus-5';
const DENOM = 'uluna';
const GAS_PRICE_ULUNA = 28.325;

/**
 * Нижние границы газа. Раньше это были фиксированные лимиты, и расчёт
 * недельного раунда 31 августа съел 1 407 221 из 1 500 000 - запас 6% на
 * десяти билетах. Стоимость execute_draw растёт с числом входов, поэтому
 * фиксированный лимит рано или поздно упёрся бы в потолок и раунд
 * реветился бы ПОСЛЕ всей работы, оставаясь нерассчитанным.
 *
 * Теперь газ считает симуляция, а эти числа - только пол: если узел не
 * ответил на симуляцию, работаем по старым значениям.
 */
const GAS_LIMITS = { open: 400000, settle: 1500000 };

/** Запас поверх симуляции. Симуляция считает по текущему состоянию, а к
 *  моменту исполнения входов может стать больше. */
const GAS_MULTIPLIER = 1.6;

/** Потолок на одну транзакцию. Комиссия платится за ЗАКАЗАННЫЙ газ, не за
 *  использованный, поэтому потолок ограничивает и расход кипера: 8M газа
 *  это около 227 LUNC. */
const GAS_CAP = 8_000_000;

function feeFor(kind, gasOverride) {
  const gas = gasOverride || GAS_LIMITS[kind];
  return {
    amount: [{ denom: DENOM, amount: String(Math.ceil(gas * GAS_PRICE_ULUNA)) }],
    gas: String(gas),
  };
}

/**
 * Газ под конкретное сообщение: симуляция плюс запас, но не ниже пола и не
 * выше потолка. Сообщение кодируется через реестр клиента - никаких новых
 * зависимостей в workflow добавлять не нужно.
 */
async function feeForMsg(ctx, kind, contract, msg, memo) {
  const floor = GAS_LIMITS[kind];
  let gas = floor;
  try {
    const encoded = {
      typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
      value: {
        sender: ctx.address,
        contract,
        msg: new TextEncoder().encode(JSON.stringify(msg)),
        funds: [],
      },
    };
    const simulated = await ctx.client.simulate(ctx.address, [encoded], memo);
    gas = Math.ceil(simulated * GAS_MULTIPLIER);
    console.log(`[gas] ${kind}: симуляция ${simulated}, с запасом ${gas}`);
  } catch (e) {
    console.warn(`[gas] ${kind}: симуляция не удалась (${e.message}), беру пол ${floor}`);
  }
  if (gas < floor) gas = floor;
  if (gas > GAS_CAP) {
    console.warn(`[gas] ${kind}: расчёт ${gas} выше потолка, ограничиваю ${GAS_CAP}`);
    gas = GAS_CAP;
  }
  return { fee: feeFor(kind, gas), gas };
}

/** Open the next round once the current one is within this of closing. */
const OPEN_AHEAD_SECS = 6 * 3600;
/** Never settle more than this in one run - a runaway loop should not drain gas. */
const MAX_SETTLE = 5;

const POOLS = {
  daily: process.env.POOL_DAILY,
  weekly: process.env.POOL_WEEKLY,
};

// ── chain reads ─────────────────────────────────────────────────────────────

async function query(addr, msg) {
  const q = Buffer.from(JSON.stringify(msg)).toString('base64');
  const res = await fetch(`${LCD}/cosmwasm/wasm/v1/contract/${addr}/smart/${q}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`query ${JSON.stringify(msg)}: HTTP ${res.status}`);
  const body = await res.json();
  return body.data;
}

/** Block time, not the runner's clock. */
async function chainNowMs() {
  const res = await fetch(`${LCD}/cosmos/base/tendermint/v1beta1/blocks/latest`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`latest block: HTTP ${res.status}`);
  const body = await res.json();
  return new Date(body.block.header.time).getTime();
}

// ── schedule ────────────────────────────────────────────────────────────────

/** Daily draws at 20:00 UTC every day except Monday; weekly is Monday 20:00. */
function nextDeadlineMs(pool, afterMs) {
  const d = new Date(afterMs);
  d.setUTCHours(20, 0, 0, 0);
  if (d.getTime() <= afterMs) d.setUTCDate(d.getUTCDate() + 1);
  for (;;) {
    const monday = d.getUTCDay() === 1;
    if (pool === 'weekly' ? monday : !monday) return d.getTime();
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// ── secrets ─────────────────────────────────────────────────────────────────

function secretFor(pool, roundId) {
  const master = (process.env.ORACLE_MASTER_SEED || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(master)) {
    throw new Error('ORACLE_MASTER_SEED must be 64 hex chars');
  }
  return crypto
    .createHmac('sha256', Buffer.from(master, 'hex'))
    .update(`${pool}:${roundId}`)
    .digest();
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();

// ── signing ─────────────────────────────────────────────────────────────────

async function connect() {
  const mnemonic = process.env.POOL_KEEPER_MNEMONIC;
  if (!mnemonic) throw new Error('POOL_KEEPER_MNEMONIC is not set');
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'terra',
    hdPaths: [stringToPath("m/44'/330'/0'/0/0")],
  });
  const [account] = await wallet.getAccounts();
  const client = await SigningCosmWasmClient.connectWithSigner(RPC, wallet);
  return { client, address: account.address };
}

// ── actions ─────────────────────────────────────────────────────────────────

async function openIfDue(pool, addr, ctx) {
  const cfg = await query(addr, { config: {} });
  const last = await query(addr, { round: { round_id: cfg.last_round_id } });
  const closeMs = Math.floor(Number(last.close_time) / 1e6);
  const nowMs = await chainNowMs();

  if (closeMs - nowMs > OPEN_AHEAD_SECS * 1000) {
    console.log(`[${pool}] round ${cfg.last_round_id} closes in ` +
      `${Math.round((closeMs - nowMs) / 3600000)}h - nothing to open yet`);
    return;
  }

  const nextId = Number(cfg.last_round_id) + 1;
  const closeTime = nextDeadlineMs(pool, Math.max(closeMs, nowMs));
  const seedHash = sha256(secretFor(pool, nextId)).toString('base64');

  console.log(`[${pool}] opening round ${nextId}, closes ${new Date(closeTime).toISOString()}`);
  if (nowMs >= closeMs) {
    console.warn(`[${pool}] WARNING: round ${cfg.last_round_id} already closed - ` +
      `entries arriving since then predate this commitment and the contract ` +
      `will flag the round has_late_entries`);
  }

  const openMsg = { open_round: { seed_hash: seedHash, close_time: String(closeTime * 1_000_000) } };
  const openMemo = `oracle-pool: open ${pool} round ${nextId}`;
  const openGas = await feeForMsg(ctx, 'open', addr, openMsg, openMemo);

  const res = await ctx.client.execute(
    ctx.address,
    addr,
    openMsg,
    openGas.fee,
    openMemo
  );
  console.log(`[${pool}] opened, tx ${res.transactionHash}, gas ${res.gasUsed}/${openGas.gas}`);
}

async function settleDue(pool, addr, ctx) {
  for (let i = 0; i < MAX_SETTLE; i++) {
    const cfg = await query(addr, { config: {} });
    const id = Number(cfg.next_unsettled_id);
    if (id > Number(cfg.last_round_id)) {
      console.log(`[${pool}] no round to settle`);
      return;
    }
    const round = await query(addr, { round: { round_id: id } });
    const closeMs = Math.floor(Number(round.close_time) / 1e6);
    const nowMs = await chainNowMs();
    if (nowMs < closeMs) {
      console.log(`[${pool}] round ${id} closes ${new Date(closeMs).toISOString()} - not yet`);
      return;
    }

    const secret = secretFor(pool, id).toString('base64');
    console.log(`[${pool}] settling round ${id}`);
    const drawMsg = { execute_draw: { round_id: id, secret } };
    const drawMemo = `oracle-pool: settle ${pool} round ${id}`;
    const drawGas = await feeForMsg(ctx, 'settle', addr, drawMsg, drawMemo);
    const res = await ctx.client.execute(ctx.address, addr, drawMsg, drawGas.fee, drawMemo);
    const usedPct = Math.round((Number(res.gasUsed) / drawGas.gas) * 100);
    console.log(`[${pool}] settled, tx ${res.transactionHash}, gas ${res.gasUsed}/${drawGas.gas} (${usedPct}%)`);
    if (usedPct > 85) {
      console.warn(`[${pool}] газа израсходовано ${usedPct}% от заказанного - ` +
        `поднять GAS_MULTIPLIER, пока расчёт не начал реветиться`);
    }

    const after = await query(addr, { round: { round_id: id } });
    console.log(`[${pool}] status ${after.status}, entries ${after.total_entries}, ` +
      `pot ${after.pot}, winners ${JSON.stringify(after.winners)}`);
    if (after.has_late_entries) {
      console.warn(`[${pool}] round ${id} carried entries older than its own commitment`);
    }
  }
  console.warn(`[${pool}] stopped after ${MAX_SETTLE} settlements in one run`);
}

/**
 * Поставить пороги розыгрыша обоим пулам (или одному) от имени админа.
 *
 * Зачем: при нулевом пороге контракт разыгрывает раунд с любым потом, включая
 * нулевой - так 30 августа daily-раунд 22 списал единственный вход и выдал
 * победителю ноль. С порогом такой раунд уходит в skipped, а входы
 * переносятся в следующий: контракт сдвигает last_entry_id назад.
 *
 * SET_MIN_POT - в uluna, SET_MIN_ENTRIES - в входах. Оба необязательны, но
 * хотя бы один должен быть задан. Цена минта пропорциональна входам
 * (common 1 вход и 25 000 LUNC, rare 5, legendary 10), поэтому пороги
 * взаимозаменяемы: 5 входов это те же 125 000 LUNC.
 *
 * Пул выбирается через SET_POOL: daily, weekly или both.
 */
async function setLimits(ctx) {
  const pot = (process.env.SET_MIN_POT || '').trim();
  const ent = (process.env.SET_MIN_ENTRIES || '').trim();
  if (pot && !/^\d+$/.test(pot)) throw new Error('SET_MIN_POT must be a whole number of uluna');
  if (ent && !/^\d+$/.test(ent)) throw new Error('SET_MIN_ENTRIES must be a whole number');
  if (!pot && !ent) throw new Error('set SET_MIN_POT or SET_MIN_ENTRIES (or both)');
  const which = (process.env.SET_POOL || 'both').trim();
  if (!['daily', 'weekly', 'both'].includes(which)) {
    throw new Error('SET_POOL must be daily, weekly or both');
  }

  for (const [pool, addr] of Object.entries(POOLS)) {
    if (!addr) continue;
    if (which !== 'both' && which !== pool) continue;

    const before = await query(addr, { config: {} });
    if (before.admin !== ctx.address) {
      throw new Error(`[${pool}] admin is ${before.admin}, keeper is ${ctx.address}`);
    }
    // update_config понимает частичное обновление: незаданное поле остаётся
    // прежним, поэтому в сообщение кладём только то, что реально меняется.
    const update = {};
    if (pot && String(before.min_pot) !== pot) update.min_pot = pot;
    if (ent && String(before.min_entries) !== ent) update.min_entries = Number(ent);
    if (!Object.keys(update).length) {
      console.log(`[${pool}] пороги уже такие - пропуск`);
      continue;
    }

    const msg = { update_config: update };
    const memo = `oracle-pool: set ${pool} limits ${JSON.stringify(update)}`;
    const g = await feeForMsg(ctx, 'open', addr, msg, memo);
    const res = await ctx.client.execute(ctx.address, addr, msg, g.fee, memo);
    const after = await query(addr, { config: {} });
    console.log(`[${pool}] min_pot ${before.min_pot} -> ${after.min_pot}, ` +
      `min_entries ${before.min_entries} -> ${after.min_entries}, tx ${res.transactionHash}`);
  }
}

// ── Health checks ───────────────────────────────────────────────────────────
// 14 августа keeper встал молча: кончился газ, расчёт не прошёл, и узнали об
// этом сутки спустя, случайно. Обе проверки существуют, чтобы такой прогон
// падал красным, а не заканчивался успехом.
const MIN_BALANCE_ULUNA = 500_000_000;   // 500 LUNC - примерно десять дней работы

// Очередь разобрана? Раунд, до которого дошёл указатель, либо ещё не закрыт,
// либо должен быть рассчитан. Всё остальное - незамеченный сбой.
async function checkQueue(pool, addr) {
  const cfg = await query(addr, { config: {} });
  const id = Number(cfg.next_unsettled_id);
  if (id > Number(cfg.last_round_id)) return true;
  const round = await query(addr, { round: { round_id: id } });
  const closeMs = Math.floor(Number(round.close_time) / 1e6);
  if (await chainNowMs() < closeMs) return true;
  console.error(`[${pool}] round ${id} closed ${new Date(closeMs).toISOString()} ` +
    `and is still "${round.status}" - settlement did not happen`);
  return false;
}

// Баланс ловит причину ДО того, как она остановит расчёт.
async function checkBalance(ctx) {
  const bal = await ctx.client.getBalance(ctx.address, 'uluna');
  console.log(`keeper balance ${(Number(bal.amount) / 1e6).toFixed(0)} LUNC`);
  if (Number(bal.amount) >= MIN_BALANCE_ULUNA) return true;
  console.error(`keeper balance below ${MIN_BALANCE_ULUNA / 1e6} LUNC - top it up ` +
    `before it runs out mid-round`);
  return false;
}

/// Отправляет бесплатные билеты недельного раунда в контракт.
///
/// Билеты берутся из free-entries.json как есть. Ничего не выбирается и не
/// фильтруется: файл публичный и коммитится ежечасно, так что расхождение
/// между ним и цепочкой заметит кто угодно - на этом и держится доверие,
/// потому что подписывает эту транзакцию тот же ключ, который знает секрет.
async function recordFreeEntries(addr, ctx) {
  const file = path.resolve('free-entries.json');
  if (!fs.existsSync(file)) {
    console.log('[weekly] free-entries.json не найден - нечего отправлять');
    return;
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const earned = data.entries || {};
  if (!Object.keys(earned).length) {
    console.log('[weekly] бесплатных билетов за раунд нет');
    return;
  }

  const cfg = await query(addr, { config: {} });
  const roundId = Number(cfg.last_round_id);
  const round = await query(addr, { round: { round_id: roundId } });

  // Дверь закрывается вместе с приёмом. Контракт и сам откажет, но упасть
  // здесь понятнее, чем разбирать ошибку транзакции.
  const closeMs = Math.floor(Number(round.close_time) / 1e6);
  const nowMs = await chainNowMs();
  if (nowMs >= closeMs) {
    console.error(`[weekly] раунд ${roundId} уже закрыт - билеты в него не идут, ` +
      `они попадут в следующий`);
    return;
  }

  // Что уже записано. token_id детерминирован, поэтому повторный запуск
  // ничего не задваивает - это и вся защита от двойной отправки.
  const already = new Set();
  let after = null;
  for (let page = 0; page < 50; page++) {
    const q = { entries: { limit: 100, ...(after ? { start_after: after } : {}) } };
    const res = await query(addr, q);
    const list = res.entries || [];
    if (!list.length) break;
    for (const e of list) already.add(e.entry.token_id);
    after = list[list.length - 1].entry_id;
    if (list.length < 100) break;
  }

  const items = [];
  for (const [wallet, rec] of Object.entries(earned)) {
    const tickets = Number(rec.total || 0);
    if (tickets <= 0) continue;
    const txHash = `weekly-${roundId}:${wallet}`;
    if (already.has(`free:${txHash}`)) continue;
    items.push({ wallet, tickets, tx_hash: txHash });
  }

  if (!items.length) {
    console.log(`[weekly] все билеты раунда ${roundId} уже записаны`);
    return;
  }

  console.log(`[weekly] отправляю ${items.length} кошельков, ` +
    `${items.reduce((s, i) => s + i.tickets, 0)} билетов в раунд ${roundId}`);

  // Пачками по 50: контракт принимает до 100, но газ растёт линейно, а
  // упереться в лимит блока посреди отправки хуже, чем сделать два захода.
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const msg = { record_free_entries: { entries: batch } };
    const memo = `oracle-pool: free entries weekly round ${roundId}`;
    const g = await feeForMsg(ctx, 'free-entries', addr, msg, memo);
    const res = await ctx.client.execute(ctx.address, addr, msg, g.fee, memo);
    console.log(`[weekly] пачка ${batch.length}, tx ${res.transactionHash}, ` +
      `gas ${res.gasUsed}/${g.gas}`);
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const action = process.argv[2];
// set-min-pot оставлено псевдонимом: так называется действие в уже выложенном
// воркфлоу, и ломать его ради переименования незачем.
if (!['open', 'settle', 'both', 'set-limits', 'set-min-pot', 'free-entries'].includes(action)) {
  console.error('usage: pool-keeper.js <open|settle|both|set-limits|free-entries>');
  console.error('  set-limits читает SET_MIN_POT (uluna), SET_MIN_ENTRIES и SET_POOL (daily|weekly|both)');
  process.exit(1);
}

console.log('pool-keeper build: limits-2026-09-01');
const ctx = await connect();
console.log(`keeper ${ctx.address} on ${CHAIN_ID}, action=${action}`);

// Административное действие идёт отдельной веткой: оно ничего не считает и
// не открывает, поэтому проверки очереди ниже к нему неприменимы.
if (action === 'set-limits' || action === 'set-min-pot') {
  await setLimits(ctx);
  process.exit(0);
}

// Бесплатные билеты есть только у недельного пула.
if (action === 'free-entries') {
  if (!POOLS.weekly) {
    console.error('POOL_WEEKLY не задан'); process.exit(1);
  }
  await recordFreeEntries(POOLS.weekly, ctx);
  process.exit(0);
}

let failed = false;
for (const [pool, addr] of Object.entries(POOLS)) {
  if (!addr) {
    console.log(`[${pool}] no address configured - skipped`);
    continue;
  }
  try {
    if (action === 'settle' || action === 'both') await settleDue(pool, addr, ctx);
    if (action === 'open' || action === 'both') await openIfDue(pool, addr, ctx);
  } catch (e) {
    // One pool failing must not stop the other: they are independent, and a
    // stuck weekly should never block the daily draw.
    console.error(`[${pool}] FAILED: ${e.message}`);
    failed = true;
  }
}
try {
  if (!(await checkBalance(ctx))) failed = true;
} catch (e) {
  console.error(`balance check failed: ${e.message}`);
  failed = true;
}
for (const [pool, addr] of Object.entries(POOLS)) {
  if (!addr) continue;
  try {
    if (!(await checkQueue(pool, addr))) failed = true;
  } catch (e) {
    console.error(`[${pool}] queue check failed: ${e.message}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
