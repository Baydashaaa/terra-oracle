/**
 * chain-tickets.js - build the draw's ticket list from the NFT contract alone.
 *
 * Replaces fetchParticipants() + buildTickets(), which took the participant set
 * from the Worker at the moment the workflow happened to run. Two problems with
 * that: a delayed start changed who was in the round, and the ordering that
 * decides winner_index came from data only the operator could produce.
 *
 * The rule implemented here - publish it, it is the whole point:
 *
 *   1. A token enters the first draw of its pool after minted_at.
 *   2. A round with fewer than MIN_ENTRIES tickets is skipped and consumes
 *      nothing; those tokens roll into the next round.
 *   3. Tickets are ordered by (minted_at, token_id) with token_id compared as
 *      a plain string, and each token repeats `entries` times.
 *   4. Membership uses a hard cut at the deadline: minted_at < deadline.
 *      Minting at 20:00:01 means the next round, however late the draw runs.
 *   5. The owner is read at the deadline block height, so transferring an NFT
 *      after the deadline cannot move the prize.
 *
 * Given the contract address and the schedule, anyone can rebuild the same list
 * and check winner_index for themselves.
 *
 * Validated against winners.json for 2026-07-26 … 2026-08-04 (six deadlines).
 */

export const NFT_CONTRACT =
  'terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx';

export const LCD_NODES = [
  // Список из двух, где второй не существовал, стоил трёх минут ожидания на
  // розыгрыше 12 августа: бинарный поиск блока дедлайна шлёт 9–14 запросов
  // подряд, и при первом же отказе publicnode переходить было некуда.
  // Правильное имя хексагона - terra-classic-lcd, а не lcd-terra-classic.
  'https://terra-classic-lcd.publicnode.com',
  'https://rest.cosmos.directory/terraclassic',
  'https://terra-classic-lcd.hexxagon.io',
  'https://lcd.terraclassic.community',
];

export const MIN_ENTRIES = 5;

/**
 * Tokens minted at or after this instant are governed by the rule above.
 * Everything earlier was settled under the old Worker-driven flow and is not
 * replayable - the 2026-07-23 draw ran late and swept in tokens minted after
 * its own deadline. History is left alone on purpose.
 */
export const RULE_START_TS = 1784837749; // 2026-07-23 20:15 UTC

const PAGE = 30;

// ── LCD plumbing ────────────────────────────────────────────────────────────

/** base64 in Node and in the browser. TextEncoder exists in both, so only the
 *  final step differs. */
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function smartQuery(msg, { height } = {}) {
  const q = toBase64(JSON.stringify(msg));
  const path = `/cosmwasm/wasm/v1/contract/${NFT_CONTRACT}/smart/${q}`;
  const headers = { Accept: 'application/json' };
  if (height) headers['x-cosmos-block-height'] = String(height);

  let last;
  for (const base of LCD_NODES) {
    try {
      const res = await fetch(base + path, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) { last = new Error(`${base}: HTTP ${res.status}`); continue; }
      const body = await res.json();
      if (!body || !body.data) { last = new Error(`${base}: no data field`); continue; }
      return body.data;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`NFT contract query failed on every LCD: ${last && last.message}`);
}

async function allTokenIds() {
  const out = [];
  let startAfter;
  for (;;) {
    const msg = { all_tokens: { limit: PAGE } };
    if (startAfter) msg.all_tokens.start_after = startAfter;
    const { tokens } = await smartQuery(msg);
    if (!tokens || tokens.length === 0) break;
    out.push(...tokens);
    startAfter = tokens[tokens.length - 1];
    if (tokens.length < PAGE) break;
  }
  return out;
}

/** Metadata only - no owner, so this is height-independent and cacheable. */
async function loadTokenMeta() {
  const ids = await allTokenIds();
  const rows = [];
  for (const id of ids) {
    const info = await smartQuery({ nft_info: { token_id: id } });
    const ext = info.extension || {};
    rows.push({
      id,
      pool: ext.pool,
      tier: ext.tier,
      entries: Number(ext.entries || 0),
      mintedAt: Number(ext.minted_at || 0),
    });
  }
  return rows;
}

// ── Schedule ────────────────────────────────────────────────────────────────

/** Daily runs 20:00 UTC every day except Monday; Monday 20:00 is the weekly. */
export function isDeadlineDay(pool, date) {
  const monday = date.getUTCDay() === 1;
  return pool === 'weekly' ? monday : !monday;
}

/** Every deadline for `pool` in (fromMs, toMs], oldest first. */
export function* deadlines(pool, fromMs, toMs) {
  const d = new Date(fromMs);
  d.setUTCHours(20, 0, 0, 0);
  if (d.getTime() <= fromMs) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getTime() <= toMs) {
    if (isDeadlineDay(pool, d)) yield d.getTime();
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// ── The rule ────────────────────────────────────────────────────────────────

function sortTokens(tokens) {
  return tokens.slice().sort((a, b) =>
    a.mintedAt - b.mintedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Replay every past deadline to find the instant from which tokens are still
 * unconsumed. Nothing is stored anywhere: the answer follows from mint times
 * and the schedule.
 */
export function lastConsumedTs(tokens, pool, deadlineMs, minEntries = MIN_ENTRIES) {
  const sorted = sortTokens(tokens);
  let boundary = RULE_START_TS;
  let idx = 0;
  let pendingEntries = 0;

  for (const ts of deadlines(pool, RULE_START_TS * 1000, deadlineMs - 1)) {
    while (idx < sorted.length && sorted[idx].mintedAt * 1000 < ts) {
      pendingEntries += sorted[idx].entries;
      idx++;
    }
    if (pendingEntries >= minEntries) {
      boundary = Math.floor(ts / 1000);
      pendingEntries = 0;
    }
  }
  return boundary;
}

/**
 * The tickets for one round.
 *
 * @returns {{ tickets: string[], tokens: object[], boundaryTs: number }}
 *          `tickets` is the flat array to index with winner_index.
 */
export async function buildTicketsFromChain({
  pool,
  deadlineMs,
  blockHeight,
  minEntries = MIN_ENTRIES,
  boundaryTs: boundaryOverride,
}) {
  if (!pool) throw new Error('pool is required');
  if (!deadlineMs) throw new Error('deadlineMs is required');

  const meta = (await loadTokenMeta()).filter(
    (t) => t.pool === pool && t.mintedAt >= RULE_START_TS
  );

  // Граница «отыграно». Для daily она выводится из цепи: источник входов один,
  // и правило самодостаточно. Для weekly её обязан передать вызывающий - там
  // состоялся ли раунд, зависит ещё и от бесплатных входов и от баланса пула,
  // а этого в цепи нет. Молча посчитать её здесь означало бы выдать догадку
  // за проверяемый факт.
  const boundaryTs = boundaryOverride != null
    ? boundaryOverride
    : lastConsumedTs(meta, pool, deadlineMs, minEntries);

  const active = sortTokens(
    meta.filter(
      (t) => t.mintedAt >= boundaryTs && t.mintedAt * 1000 < deadlineMs
    )
  );

  // Owners are read at the deadline height. Without it, a transfer made
  // between the deadline and the draw would redirect the prize.
  const tokens = [];
  for (const t of active) {
    const info = await smartQuery(
      { owner_of: { token_id: t.id } },
      { height: blockHeight }
    );
    tokens.push({ ...t, owner: info.owner });
  }

  const tickets = [];
  for (const t of tokens) {
    for (let i = 0; i < t.entries; i++) tickets.push(t.owner);
  }

  return { tickets, tokens, boundaryTs };
}


// ── The deadline block ──────────────────────────────────────────────────────

/** LCD returns block hashes base64-encoded; winners.json records them as hex,
 *  and the winner is derived from the hex. Convert once, here. */
function hashToHex(h) {
  if (/^[0-9a-fA-F]{64}$/.test(h)) return h.toUpperCase();
  const bin = atobUniversal(h);
  let out = '';
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return out.toUpperCase();
}

function atobUniversal(b64) {
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('binary');
  return atob(b64);
}

async function blockAt(height) {
  const path = height === 'latest'
    ? '/cosmos/base/tendermint/v1beta1/blocks/latest'
    : `/cosmos/base/tendermint/v1beta1/blocks/${height}`;
  let last;
  for (const base of LCD_NODES) {
    try {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) { last = new Error(`${base}: HTTP ${res.status}`); continue; }
      const b = await res.json();
      return {
        height: Number(b.block.header.height),
        timeMs: new Date(b.block.header.time).getTime(),
        hash: hashToHex(b.block_id.hash),
      };
    } catch (e) { last = e; }
  }
  throw new Error(`block ${height}: ${last && last.message}`);
}

/**
 * The first block at or after the deadline. That block decides the winner, and
 * it is the same block whoever looks - which is why re-running the draw cannot
 * change the outcome.
 */
export async function findDeadlineBlock(deadlineMs) {
  const latest = await blockAt('latest');
  if (latest.timeMs < deadlineMs) throw new Error('deadline is still ahead of the chain');

  // Blocks are roughly 6s apart; start from an estimate and widen until the
  // lower bound really is before the deadline.
  let lo = Math.max(1, latest.height - Math.ceil((latest.timeMs - deadlineMs) / 6000) - 2000);
  let hi = latest.height;
  for (let i = 0; i < 6; i++) {
    const probe = await blockAt(lo);
    if (probe.timeMs < deadlineMs) break;
    hi = lo;
    lo = Math.max(1, lo - 20000);
  }

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const b = await blockAt(mid);
    if (b.timeMs >= deadlineMs) hi = mid; else lo = mid + 1;
  }
  return blockAt(lo);
}

/**
 * The winner, derived from nothing but the chain.
 *
 *   index = BigInt('0x' + blockHash) % tickets.length
 *
 * Same rule the draw script applies, because it is the same code. If this ever
 * disagrees with what gets published, the disagreement is a bug worth shouting
 * about - not something to paper over by trusting the published value.
 */
export async function computeWinner({ pool, deadlineMs, boundaryTs, minEntries = MIN_ENTRIES }) {
  const block = await findDeadlineBlock(deadlineMs);
  const { tickets, tokens } = await buildTicketsFromChain({
    pool,
    deadlineMs,
    blockHeight: block.height,
    minEntries,
    boundaryTs,
  });

  if (tickets.length < minEntries) {
    return { skipped: true, tickets, tokens, block, reason: `${tickets.length} < ${minEntries}` };
  }

  const index = Number(BigInt('0x' + block.hash) % BigInt(tickets.length));
  return { skipped: false, tickets, tokens, block, index, winner: tickets[index] };
}


// ── Snapshot, built locally ─────────────────────────────────────────────────

/**
 * Flat address list → [address, count] pairs, exactly as round-snapshot.js
 * packs it. A wallet appearing again later in the list gets its OWN pair: that
 * is what preserves the original order, and therefore the indexes.
 */
function packTickets(tickets, meta) {
  const pairs = [];
  for (const address of tickets) {
    const last = pairs[pairs.length - 1];
    if (last && last[0] === address) last[1]++;
    else {
      const m = meta && meta[address];
      pairs.push(m ? [address, 1, m.tokenId ?? null, m.tier ?? null] : [address, 1]);
    }
  }
  return pairs;
}

/**
 * The same object the draw script writes to rounds/<round_id>.json, derived
 * from the chain alone.
 *
 * Handing the wheel this instead of waiting for the published file is the
 * whole point: the winner is fixed by the deadline block, so there is nothing
 * to wait for except somebody writing it down.
 */
export async function buildLocalSnapshot({ pool, deadlineMs, roundId, boundaryTs, minEntries = MIN_ENTRIES }) {
  const r = await computeWinner({ pool, deadlineMs, boundaryTs, minEntries });
  if (r.skipped) return { skipped: true, reason: r.reason, block: r.block };

  // address -> first token seen for it, so the wheel can show the art.
  const meta = {};
  for (const t of r.tokens) {
    if (!meta[t.owner]) meta[t.owner] = { tokenId: t.id, tier: t.tier };
  }

  const packed = packTickets(r.tickets, meta);

  // Same self-check as round-snapshot.js: never hand out a snapshot that does
  // not agree with itself.
  const flat = [];
  for (const [addr, n] of packed) for (let i = 0; i < n; i++) flat.push(addr);
  if (flat.length !== r.tickets.length) {
    throw new Error(`local snapshot: packing lost tickets (${flat.length} vs ${r.tickets.length})`);
  }
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] !== r.tickets[i]) throw new Error(`local snapshot: order diverged at ${i}`);
  }

  return {
    skipped: false,
    snapshot: {
      round_id: roundId,
      pool,
      total: r.tickets.length,
      wallets: new Set(r.tickets).size,
      tickets: packed,
      block_hash: r.block.hash,
      block_height: String(r.block.height),  // the published file stores it as a string
      winner_index: r.index,
      generated_at: new Date().toISOString(),
      // Marks this as computed in the browser rather than published by the
      // draw script. The wheel should replace it with the real file when that
      // arrives, and complain if the two disagree.
      _local: true,
    },
    winner: r.winner,
    index: r.index,
    block: r.block,
  };
}

// ── Dry run: node chain-tickets.js daily [blockHeight] ──────────────────────

if (typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`) {
  const pool = process.argv[2] || 'daily';
  const height = process.argv[3] || undefined;

  const now = new Date();
  const d = new Date(now);
  d.setUTCHours(20, 0, 0, 0);
  if (now.getTime() < d.getTime()) d.setUTCDate(d.getUTCDate() - 1);
  while (!isDeadlineDay(pool, d)) d.setUTCDate(d.getUTCDate() - 1);

  console.log(`pool: ${pool}`);
  console.log(`deadline: ${d.toISOString()}`);
  if (!height) console.log('WARNING: no block height given - owners read at latest state');

  buildTicketsFromChain({ pool, deadlineMs: d.getTime(), blockHeight: height })
    .then(({ tickets, tokens, boundaryTs }) => {
      console.log(`unconsumed since: ${new Date(boundaryTs * 1000).toISOString()}`);
      console.log(`tokens: ${tokens.length}, tickets: ${tickets.length}`);
      for (const t of tokens) {
        console.log(
          `  ${t.id.padEnd(14)}${String(t.entries).padStart(3)} × ${t.owner}` +
          `   minted ${new Date(t.mintedAt * 1000).toISOString()}`
        );
      }
      console.log(
        tickets.length < MIN_ENTRIES
          ? `\nwould SKIP (${tickets.length} < ${MIN_ENTRIES})`
          : `\nwould DRAW - winner_index in 0..${tickets.length - 1}`
      );
    })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
