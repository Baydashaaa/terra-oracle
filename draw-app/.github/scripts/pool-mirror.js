#!/usr/bin/env node
/**
 * pool-mirror.js - переносит рассчитанные раунды из контрактов oracle-pool
 * в winners.json и rounds/<round_id>.json.
 *
 * Зачем: розыгрыш уехал на цепочку, а весь фронт (вкладка Winners, колесо,
 * карточка победителя) читает эти два файла. Без моста сайт после расчёта
 * не показывает ничего.
 *
 * Идемпотентен: раунд, у которого contract_round_id уже есть в winners.json,
 * пропускается. Работает от состояния контракта, поэтому пропущенный запуск
 * подхватывается следующим.
 *
 * ВАЖНО про адреса. В контракте билет принадлежит МИНТЕРУ, а приз уходит
 * тому, кто держит NFT на момент расчёта. Колесо на сайте сверяет
 * tickets[winner_index] с полем winner, поэтому winner - это минтер.
 * Если токен успели передать, реальный получатель пишется в paid_to.
 *
 * Env:
 *   POOL_DAILY, POOL_WEEKLY   адреса контрактов пулов
 *   LCD                       необязательная замена узла
 *   DRY_RUN=1                 ничего не писать, только напечатать
 */
import fs from 'fs';
import path from 'path';

const LCD = process.env.LCD || 'https://terra-classic-lcd.publicnode.com';
const WINNERS_PATH = path.resolve('winners.json');
const ROUNDS_DIR = path.resolve('rounds');
const DRY = process.env.DRY_RUN === '1';

/**
 * Первый раунд КАЖДОГО пула, который принадлежит новой схеме. Контракты
 * крутились с 20 августа параллельно со старым off-chain розыгрышем и дали
 * раунды с нулевым потом: их даты уже заняты настоящими выплатами из
 * winners.json, и переносить их означало бы затереть историю. Всё, что
 * раньше этой границы, мост не трогает никогда.
 */
const MIRROR_FROM = {
  daily: Number(process.env.MIRROR_FROM_DAILY || 23),
  weekly: Number(process.env.MIRROR_FROM_WEEKLY || 4),
};

/** Сколько раундов назад заглядывать от последнего рассчитанного. */
const MAX_BACKFILL = 10;

const POOLS = {
  daily: process.env.POOL_DAILY,
  weekly: process.env.POOL_WEEKLY,
};

// ── чтение цепочки ───────────────────────────────────────────────────────────

async function query(addr, msg) {
  const q = Buffer.from(JSON.stringify(msg)).toString('base64');
  const res = await fetch(`${LCD}/cosmwasm/wasm/v1/contract/${addr}/smart/${q}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`query ${JSON.stringify(msg)}: HTTP ${res.status}`);
  return (await res.json()).data;
}

/**
 * Хеш транзакции расчёта. Не критичен - без него запись всё равно валидна,
 * поэтому любая ошибка тут гасится и возвращается null.
 */
async function settleTxHash(addr, roundId) {
  const q = encodeURIComponent(
    `wasm._contract_address='${addr}' AND wasm.action='execute_draw' AND wasm.round_id='${roundId}'`
  );
  for (const url of [
    `${LCD}/cosmos/tx/v1beta1/txs?query=${q}&order_by=ORDER_BY_DESC&limit=1`,
    `${LCD}/cosmos/tx/v1beta1/txs?events=${q}&order_by=ORDER_BY_DESC&limit=1`,
  ]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      const body = await res.json();
      const hash = body?.tx_responses?.[0]?.txhash;
      if (hash) return hash;
    } catch (e) { /* следующий вариант */ }
  }
  return null;
}

// ── чистые преобразования (их проверяет dev/_test_mirror.cjs) ────────────────

export function tsToIso(nanos) {
  return new Date(Math.floor(Number(nanos) / 1e6)).toISOString();
}

export function roundKey(pool, closeTimeNanos) {
  return `${pool}_${tsToIso(closeTimeNanos).slice(0, 10)}`;
}

/** Тир по token_id вида "common-33". Неизвестный формат - null, не догадки. */
export function tierOf(tokenId) {
  const m = /^(common|rare|legendary)\b/i.exec(String(tokenId || ''));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Плоский массив билетов в том же порядке, в каком его строит контракт:
 * входы по возрастанию entry_id, каждый занимает `entries` подряд позиций.
 */
export function buildTickets(entries) {
  const flat = [];
  const meta = {};
  for (const { entry } of entries) {
    const w = Number(entry.entries) || 0;
    for (let i = 0; i < w; i++) flat.push(entry.minter);
    if (!meta[entry.minter]) {
      meta[entry.minter] = { tokenId: entry.token_id ?? null, tier: tierOf(entry.token_id) };
    }
  }
  return { flat, meta };
}

/** Плоский массив → пары [адрес, подряд идущих билетов, tokenId, tier]. */
export function packTickets(flat, meta) {
  const pairs = [];
  for (const address of flat) {
    const last = pairs[pairs.length - 1];
    if (last && last[0] === address) { last[1]++; continue; }
    const m = meta[address];
    pairs.push(m ? [address, 1, m.tokenId, m.tier] : [address, 1]);
  }
  return pairs;
}

export const bps = (amount, b) => (BigInt(amount) * BigInt(b)) / 10000n;
export const toLunc = (uluna) => Math.floor(Number(uluna) / 1e6);

/**
 * Запись для winners.json. Формат сохранён прежний, чтобы фронт не менять:
 * daily отдаёт winner/prize_lunc, weekly - массив winners.
 */
export function buildRecord({ pool, round, proof, cfg, txHash, flat, meta }) {
  const date = tsToIso(round.close_time).slice(0, 10);
  const base = {
    date,
    round_id: roundKey(pool, round.close_time),
    contract_round_id: Number(round.round_id),
    entries: Number(round.total_entries || 0),
    participants: new Set(flat).size,
    ticket_rule: 'oracle-pool',
    nft_contract: cfg.nft_contract,
    pool_contract: POOLS[pool],
    deadline: tsToIso(round.close_time),
    boundary_ts: Math.floor(Number(round.close_time) / 1e9),
  };

  if (round.status === 'skipped' || !round.winner_indexes.length) {
    return {
      ...base,
      skipped: true,
      reason: `Contract skipped round ${round.round_id}: entries ${round.total_entries || 0}, pot ${round.pot || 0}`,
    };
  }

  // Случайность контракта: sha256(secret, entropy, round_id). Хеша блока
  // здесь нет вовсе, поэтому старое поле randomness меняет значение, а
  // block_hash/block_height остаются пустыми - страница Verify это переживает.
  //
  // Пустой secret значит, что секрет так и не раскрыли и раунд посчитан
  // запасным путём: result = sha256("oracle-pool:stale", entropy, round_id,
  // seed_hash). Пометка обязана отличаться - иначе в данных будет написано,
  // что раскрытие было, хотя его не было, и проверка по документации не
  // сойдётся.
  const stale = !round.secret;
  const proofFields = {
    randomness: stale ? 'oracle-pool-stale-fallback' : 'oracle-pool-commit-reveal',
    seed_hash: round.seed_hash,
    secret: round.secret,
    entropy: round.entropy,
    result: round.result,
    settled_at: round.settled_at ? tsToIso(round.settled_at) : null,
    has_late_entries: !!round.has_late_entries,
    block_hash: null,
    block_height: null,
    block_time: round.settled_at ? tsToIso(round.settled_at) : null,
  };

  const minterAt = (idx) => flat[Number(idx)] ?? null;
  const pot = round.pot || '0';

  if (pool === 'weekly' && cfg.payout_bps.length > 1) {
    const winners = round.winner_indexes.map((idx, i) => {
      const minter = minterAt(idx);
      const owner = round.winners[i] ?? null;
      const w = {
        place: i + 1,
        address: minter,
        amount_lunc: toLunc(bps(pot, cfg.payout_bps[i] ?? 0)),
        tx: txHash,
        winner_index: Number(idx),
      };
      if (owner && owner !== minter) w.paid_to = owner;
      return w;
    });
    return {
      ...base,
      winners,
      nft_tickets: Number(round.total_entries || 0),
      free_tickets: 0,
      pot_lunc: toLunc(pot),
      treasury_lunc: toLunc(bps(pot, cfg.treasury_bps)),
      ...proofFields,
      tx_treasury: txHash,
    };
  }

  const idx = round.winner_indexes[0];
  const minter = minterAt(idx);
  const owner = round.winners[0] ?? null;
  const rec = {
    ...base,
    winner: minter,
    prize_lunc: toLunc(bps(pot, cfg.payout_bps[0] ?? 0)),
    pot_lunc: toLunc(pot),
    treasury_lunc: toLunc(bps(pot, cfg.treasury_bps)),
    winner_index: Number(idx),
    ...proofFields,
    tx_winner: txHash,
    tx_treasury: txHash,
  };
  if (owner && owner !== minter) rec.paid_to = owner;
  return rec;
}

export function buildSnapshot({ pool, record, round, flat, meta }) {
  return {
    _verify: [
      'Frozen entry list for this round, in the exact order the oracle-pool contract used it.',
      '1. Expand `tickets`: a pair [addr, n] means n consecutive entries for addr.',
      '2. The expanded length must equal `total` and `entries` in winners.json.',
      '3. `winner_index` is a position in that expanded array.',
      '',
      'Replaying the draw:',
      '  result = sha256(secret || entropy || round_id_be64)',
      '  place p: seed = sha256(seed_prev || p_be64), index = first16(seed) % total,',
      '  then step forward while the minter already took a place.',
      '  Query the contract for the same data: {"proof":{"round_id":N}}',
    ],
    round_id: record.round_id,
    contract_round_id: Number(round.round_id),
    pool,
    total: flat.length,
    wallets: new Set(flat).size,
    tickets: packTickets(flat, meta),
    block_hash: null,
    block_height: null,
    result: round.result ?? null,
    // seed_hash обязателен для проверки на странице Verify: без него нельзя
    // показать, что секрет был зафиксирован ДО появления участников, а это
    // вся суть commit-reveal.
    seed_hash: round.seed_hash ?? null,
    secret: round.secret ?? null,
    entropy: round.entropy ?? null,
    winner_index: pool === 'weekly' && record.winners
      ? record.winners.map((w) => w.winner_index)
      : record.winner_index,
    generated_at: new Date().toISOString(),
  };
}

// ── основной проход ──────────────────────────────────────────────────────────

function loadWinners() {
  const raw = JSON.parse(fs.readFileSync(WINNERS_PATH, 'utf8'));
  if (!Array.isArray(raw.daily) || !Array.isArray(raw.weekly)) {
    throw new Error('winners.json: ожидались массивы daily и weekly');
  }
  return raw;
}

async function mirrorPool(pool, addr, winners) {
  const cfg = await query(addr, { config: {} });
  const lastSettled = Number(cfg.next_unsettled_id) - 1;
  const done = new Set(
    winners[pool].map((r) => Number(r.contract_round_id)).filter(Number.isFinite)
  );
  // Второй рубеж, уже по дате: запись за этот день могла прийти из старой
  // системы, у неё contract_round_id нет вовсе и первая проверка её не видит.
  const seenKeys = new Set(winners[pool].map((r) => r.round_id));

  let wrote = 0;
  const floor = Math.max(1, MIRROR_FROM[pool] || 1);
  const from = Math.max(floor, lastSettled - MAX_BACKFILL + 1);
  if (lastSettled < floor) {
    console.log(`[${pool}] рассчитанных раундов новее ${floor} пока нет`);
  }
  for (let id = from; id <= lastSettled; id++) {
    if (done.has(id)) continue;

    const round = await query(addr, { round: { round_id: id } });
    if (round.status !== 'drawn' && round.status !== 'skipped') {
      console.log(`[${pool}] раунд ${id}: статус ${round.status}, пропуск`);
      continue;
    }

    const key = roundKey(pool, round.close_time);
    if (seenKeys.has(key)) {
      console.log(`[${pool}] раунд ${id}: запись ${key} уже есть, пропуск`);
      continue;
    }

    const proof = await query(addr, { proof: { round_id: id } });
    const { flat, meta } = buildTickets(proof.entries || []);
    const txHash = round.status === 'drawn' ? await settleTxHash(addr, id) : null;
    const record = buildRecord({ pool, round, proof, cfg, txHash, flat, meta });

    // Предохранитель: индекс победителя обязан указывать на живой билет.
    if (!record.skipped) {
      const idx = pool === 'weekly' && record.winners
        ? record.winners[0].winner_index
        : record.winner_index;
      if (!flat[idx]) {
        console.error(`[${pool}] раунд ${id}: winner_index ${idx} вне массива из ${flat.length} билетов - НЕ ПИШУ`);
        continue;
      }
    }

    if (seenKeys.has(record.round_id)) {
      console.warn(`[${pool}] раунд ${id} даёт ключ ${record.round_id}, ` +
        `а он уже занят в winners.json - НЕ ПИШУ, разбирайся руками`);
      continue;
    }
    seenKeys.add(record.round_id);
    winners[pool].push(record);
    console.log(`[${pool}] раунд ${id} -> ${record.round_id}` +
      (record.skipped ? ' (skipped)' : `, билетов ${flat.length}, пот ${record.pot_lunc} LUNC`));

    if (!record.skipped && flat.length) {
      const snap = buildSnapshot({ pool, record, round, flat, meta });
      if (!DRY) {
        fs.mkdirSync(ROUNDS_DIR, { recursive: true });
        fs.writeFileSync(path.join(ROUNDS_DIR, `${record.round_id}.json`),
          JSON.stringify(snap, null, 2) + '\n');
      }
    }
    wrote++;
  }
  if (!wrote) console.log(`[${pool}] новых рассчитанных раундов нет`);
  return wrote;
}

async function main() {
  const winners = loadWinners();
  let wrote = 0;
  for (const [pool, addr] of Object.entries(POOLS)) {
    if (!addr) { console.log(`[${pool}] адрес не задан - пропуск`); continue; }
    try {
      wrote += await mirrorPool(pool, addr, winners);
    } catch (e) {
      // Один пул не должен ронять второй.
      console.error(`[${pool}] ОШИБКА: ${e.message}`);
      process.exitCode = 1;
    }
  }
  if (wrote && !DRY) {
    fs.writeFileSync(WINNERS_PATH, JSON.stringify(winners, null, 2) + '\n');
    console.log(`winners.json обновлён, добавлено записей: ${wrote}`);
  } else if (DRY) {
    console.log('DRY_RUN: ничего не записано');
  }
}

if (process.argv[1] && process.argv[1].endsWith('pool-mirror.js')) {
  await main();
}
