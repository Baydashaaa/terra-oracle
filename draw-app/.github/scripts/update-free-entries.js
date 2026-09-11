// .github/scripts/update-free-entries.js
// Runs hourly via GitHub Actions
// Reads on-chain tx history via FCD → updates free-entries.json

import fetch from 'node-fetch';
import fs    from 'fs';
import path  from 'path';

// ── Constants ────────────────────────────────────────────────────────────────
const TREASURY_WALLET   = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt';
const DAILY_WALLET      = 'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px';
const WEEKLY_WALLET     = 'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz';
// Пулы переехали на контракты 31 авг 2026. Старые адреса из фильтра НЕ убраны:
// они всё ещё встречаются в истории, по которой считается окно.
const DAILY_POOL        = 'terra1d9ga3dzhg63v6rmm8ahts55ekjpwlm6dusw5cwhpt60s6t0actqqsul6tm';
const WEEKLY_POOL       = 'terra19w39c3qz6kc756hap92x374reptah9kp5825f5c67hmquy383r5qd7dmd8';

// Exclude these senders - they send protocol funds, not user payments
const EXCLUDED_SENDERS  = new Set([DAILY_WALLET, WEEKLY_WALLET, DAILY_POOL, WEEKLY_POOL, TREASURY_WALLET]);

// A chat message is identified by its EXACT amount (±1%), not by a range.
// The old range [5,000 … 100,000) also swallowed the Treasury leg of questions:
// 25,000 for Basic, 100,000 for Priority, and less than that whenever a rank
// discount applied - every such payment was miscounted as a chat message.
const CHAT_ULUNA          = 5_000_000_000;   // exactly 5,000 LUNC
const CHAT_TOLERANCE      = 0.01;            // ±1%
const CHAT_ENTRIES_PER_10 = 1;
const MAX_CHAT_ENTRIES_PER_ROUND = 20;       // cap per round, not per day -
                                             // entries reset weekly anyway, so a
                                             // weekly cap keeps the remainder of
                                             // messages from burning every day.
const QUESTION_ENTRIES_LEGACY    = 2;        // questions with no `entries` field
const STREAK_14D_ENTRIES  = 2;   // one-time free entries at 14-day streak milestone
const TRUSTED_ENTRIES     = 1;   // Trusted User (30-day streak): +1 per round, backed from RESERVE
const WINDOW_DAYS         = 90;  // scan 90 days back - entries accumulate
const WINDOW_SEC          = WINDOW_DAYS * 86400;

// Terra Oracle Worker - authoritative source for questions and streak milestones
const ORACLE_WORKER   = 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
const ACTIONS_SECRET  = process.env.ACTIONS_SECRET || '';  // for secret-gated streak endpoint

const FCD_NODES = [
  'https://terra-classic-fcd.publicnode.com',
  'https://fcd.terra-classic.hexxagon.io',
];

const JSON_PATH = path.resolve('free-entries.json');
const WINNERS_PATH = path.resolve('winners.json');

// ── Weekly round boundary ─────────────────────────────────────────────────────
// Start of the current weekly draw round (Mon 20:00 UTC). Identical to the
// worker's getCurrentRoundId('weekly') and the frontend fallback in app.js, so
// all three agree on when the week rolls over.
function weeklyRoundStartSec() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0, 0));
  const diffToMon = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMon);
  if (now.getTime() < d.getTime()) d.setUTCDate(d.getUTCDate() - 7);
  return Math.floor(d.getTime() / 1000);
}

// ── Граница по ФАКТУ розыгрыша ───────────────────────────────────────────────
// Дедлайн последнего weekly-розыгрыша, который РЕАЛЬНО состоялся.
//
// Зачем отдельно от часов: 3 августа 2026 недельный розыгрыш упал (require в
// ESM-репо), в winners.json не появилось ничего - а генератор всё равно сдвинул
// границу на понедельник 20:00 и обнулил все входы. Люди потеряли входы за
// раунд, которого не было. Часы не знают, состоялся розыгрыш или нет; знает
// только winners.json.
//
// skipped-раунды здесь НЕ считаются состоявшимися - при skip билеты переходят
// дальше, и входы должны вести себя так же.
function lastCompletedWeeklyDeadlineSec() {
  if (!fs.existsSync(WINNERS_PATH)) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(WINNERS_PATH, 'utf8')); }
  catch (e) { console.warn('Не смог прочитать winners.json:', e.message); return null; }

  const list = Array.isArray(data.weekly) ? data.weekly : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (!r || r.skipped === true) continue;
    if (!Array.isArray(r.winners) || r.winners.length === 0) continue;
    if (!r.date) continue;
    // Розыгрыш всегда в 20:00 UTC того дня, что записан в date
    const ts = Date.parse(r.date + 'T20:00:00Z');
    if (!Number.isNaN(ts)) return Math.floor(ts / 1000);
  }
  return null;
}

// ── FCD fetch with fallback ──────────────────────────────────────────────────
async function fcdFetch(endpoint) {
  for (const base of FCD_NODES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(base + endpoint, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json', 'User-Agent': 'TerraOracle/1.0' },
      });
      clearTimeout(timer);
      if (res.ok) return res.json();
      console.warn('FCD ' + base + ' returned ' + res.status);
    } catch (e) {
      console.warn('FCD ' + base + ' failed: ' + e.message);
    }
  }
  throw new Error('All FCD nodes failed for: ' + endpoint);
}

// ── Fetch all txs involving a wallet since cutoff ────────────────────────────
async function fetchTxsTo(wallet, cutoffSec) {
  const result = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = '/v1/txs?account=' + wallet + '&limit=' + limit + '&offset=' + offset;
    let data;
    try {
      data = await fcdFetch(url);
    } catch (e) {
      console.error('fetchTxsTo error:', e.message);
      break;
    }

    const list = data && data.txs ? data.txs : [];
    if (!list.length) break;

    let done = false;
    for (const tx of list) {
      const ts = Math.floor(new Date(tx.timestamp).getTime() / 1000);
      if (ts < cutoffSec) { done = true; break; }

      const msgs = (tx.tx && tx.tx.value && tx.tx.value.msg) ? tx.tx.value.msg : [];
      const memo = (tx.tx && tx.tx.value && tx.tx.value.memo) ? tx.tx.value.memo : '';

      for (const msg of msgs) {
        if (msg.type !== 'bank/MsgSend') continue;
        const val = msg.value || {};
        if (val.to_address !== wallet) continue;
        const coins = val.amount || [];
        result.push({
          from:  val.from_address,
          coins: coins,
          memo:  memo,
          ts:    ts,
        });
      }
    }

    if (done || list.length < limit) break;
    offset += limit;
  }

  return result;
}

// ── Выбор границы окна ───────────────────────────────────────────────────────
// Чистая функция: никакого диска и сети, поэтому проверяется тестом на всех
// сценариях (розыгрыш в срок / пропущен / skipped / истории нет / очень старый).
function chooseCutoff({ clockCutoff, drawnCutoff, histRaw, nowSec, windowSec }) {
  let cutoff, source, missedWeeks = 0;

  if (drawnCutoff === null || drawnCutoff === undefined) {
    // Истории нет вообще - ведём себя как раньше, по часам
    cutoff = clockCutoff;
    source = 'clock (в winners.json нет состоявшихся weekly-розыгрышей)';
  } else {
    // Граница = момент последнего СОСТОЯВШЕГОСЯ розыгрыша. Прошёл в срок -
    // это ровно та же метка, что даёт weeklyRoundStartSec(). Пропущен или
    // упал - граница остаётся старой, и входы переносятся дальше вместо того,
    // чтобы сгореть за раунд, которого не было.
    cutoff = drawnCutoff;
    source = 'last completed weekly draw';
    missedWeeks = Math.max(0, Math.round((clockCutoff - drawnCutoff) / (7 * 86400)));
  }

  // Предохранитель: сканирование ограничено WINDOW_DAYS, бесконечно растить
  // окно нельзя. Если розыгрышей не было дольше - упираемся в потолок.
  const floorSec = nowSec - windowSec;
  let clamped = false;
  if (cutoff < floorSec) { cutoff = floorSec; clamped = true; }

  // Ручной mid-week reset: history_from ПОЗЖЕ расчётной границы уважается,
  // устаревший игнорируется. Поведение прежнее.
  let manual = false;
  if (histRaw) {
    const histSec = Math.floor(new Date(histRaw).getTime() / 1000);
    if (!Number.isNaN(histSec) && histSec > cutoff) {
      cutoff = histSec;
      source = 'manual history_from';
      manual = true;
    }
  }

  return { cutoff, source, missedWeeks, clamped, manual };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Load existing JSON
  let existing = { _meta: {}, entries: {} };
  if (fs.existsSync(JSON_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')); } catch (e) {}
  }

  // Variant A - weekly reset. Cutoff = start of the CURRENT weekly draw round
  // (Mon 20:00 UTC). Entries reset automatically every Monday when the draw rolls
  // over, so a single question grants entries in ONE weekly draw only - no
  // carry-over, no re-counting in later draws. Computing the boundary here means
  // it no longer depends on an external resetFreeEntries() call (which was never
  // advancing history_from - it was stuck at the very first date, so 90 days of
  // questions kept counting). A history_from LATER than the weekly boundary is
  // still honored (lets an admin force a mid-week reset); an older/stale one is
  // ignored.
  const clockCutoff = weeklyRoundStartSec();
  const drawnCutoff = lastCompletedWeeklyDeadlineSec();
  const nowSec = Math.floor(Date.now() / 1000);

  const decision = chooseCutoff({
    clockCutoff, drawnCutoff,
    histRaw: existing && existing._meta && existing._meta.history_from,
    nowSec, windowSec: WINDOW_SEC
  });

  const cutoff       = decision.cutoff;
  const cutoffSource = decision.source + (decision.clamped ? ' (обрезано по ' + WINDOW_DAYS + ' дням)' : '');
  const missedWeeks  = decision.missedWeeks;

  if (missedWeeks > 0) {
    console.warn('ВНИМАНИЕ: пропущено недельных розыгрышей: ' + missedWeeks +
      '. Последний состоявшийся - ' + new Date(drawnCutoff * 1000).toISOString() +
      '. Входы НЕ обнуляются, окно расширено. Разберись, почему не прошёл розыгрыш.');
  }
  if (decision.clamped) {
    console.warn('Граница старше ' + WINDOW_DAYS + ' дней - обрезана до глубины сканирования');
  }
  if (decision.manual) {
    console.log('Honoring manual history_from (later than computed boundary)');
  }

  const cutoffIso = new Date(cutoff * 1000).toISOString();
  console.log('Cutoff: ' + cutoffIso + '  (источник: ' + cutoffSource + ')');
  if (drawnCutoff !== null) {
    console.log('  по часам было бы: ' + new Date(clockCutoff * 1000).toISOString());
  }

  // ── Fetch txs to TREASURY_WALLET (chat) ───────────────────────────────────
  console.log('Fetching txs to TREASURY_WALLET (chat fees)...');
  const treasuryTxs = await fetchTxsTo(TREASURY_WALLET, cutoff);
  console.log('Found ' + treasuryTxs.length + ' treasury txs');

  const chatByWallet = {};
  const questionByWallet = {};
  const streakByWallet = {};
  const trustedByWallet = {};

  // ── Chat: txs to TREASURY_WALLET, exactly 5k LUNC per message (±1%) ───────
  const CHAT_LO = CHAT_ULUNA * (1 - CHAT_TOLERANCE);
  const CHAT_HI = CHAT_ULUNA * (1 + CHAT_TOLERANCE);
  for (const tx of treasuryTxs) {
    if (EXCLUDED_SENDERS.has(tx.from)) continue;
    const uluna = tx.coins.find(function(c) { return c.denom === 'uluna'; });
    if (!uluna) continue;
    const amount = Number(uluna.amount);
    if (amount >= CHAT_LO && amount <= CHAT_HI) {
      const day = new Date(tx.ts * 1000).toISOString().slice(0, 10);
      if (!chatByWallet[tx.from]) chatByWallet[tx.from] = {};
      chatByWallet[tx.from][day] = (chatByWallet[tx.from][day] || 0) + 1;
    }
  }

  // ── Questions: from authoritative questions.json (via Worker /questions) ───
  // NOT from on-chain payments - NFT mints also pay WEEKLY_WALLET and would be
  // miscounted. A question only counts if it's actually recorded as a question.
  // Entries come from the question's own `entries` field, which the Worker
  // derives from the VERIFIED on-chain pool leg (Basic +1, Priority +4).
  // Questions written before tariffs existed have no field → legacy default.
  console.log('Fetching questions from Worker /questions...');
  try {
    const qRes = await fetch(ORACLE_WORKER + '/questions', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'TerraOracle/1.0' },
    });
    if (qRes.ok) {
      const qData = await qRes.json();
      const questions = (qData && qData.questions) ? qData.questions : [];
      for (const q of questions) {
        if (!q.wallet) continue;
        const created = Number(q.createdAt) || 0;   // unix seconds
        if (created < cutoff) continue;               // only this round
        const qe = Number(q.entries) > 0 ? Number(q.entries) : QUESTION_ENTRIES_LEGACY;
        questionByWallet[q.wallet] = (questionByWallet[q.wallet] || 0) + qe;
      }
      console.log('Counted questions from ' + questions.length + ' total records');
    } else {
      console.warn('Worker /questions returned ' + qRes.status);
    }
  } catch (e) {
    console.error('Questions fetch error:', e.message);
  }

  // ── Streak 14-day milestone: one-time +2 free entries (the round it's earned) ─
  if (ACTIONS_SECRET) {
    console.log('Fetching 14-day streak milestones...');
    try {
      const sRes = await fetch(ORACLE_WORKER + '/streak/milestone14-entries', {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TerraOracle/1.0',
          // Заголовком, а не в адресе: URL целиком попадает в логи прокси.
          'X-Actions-Secret': ACTIONS_SECRET,
        },
      });
      if (sRes.ok) {
        const sData = await sRes.json();
        for (const m of (sData.wallets || [])) {
          if (!m.wallet || !m.achievedAt) continue;
          const achievedSec = Math.floor(new Date(m.achievedAt).getTime() / 1000);
          if (achievedSec < cutoff) continue;          // only the round it was earned
          streakByWallet[m.wallet] = (streakByWallet[m.wallet] || 0) + STREAK_14D_ENTRIES;
        }
        console.log('Streak milestone wallets credited: ' + Object.keys(streakByWallet).length);
      } else {
        console.warn('Worker /streak/milestone14-entries returned ' + sRes.status);
      }
    } catch (e) {
      console.error('Streak milestone fetch error:', e.message);
    }
  } else {
    console.warn('ACTIONS_SECRET not set - skipping 14-day streak entries');
  }

  // ── Trusted User (30-day streak): +1 entry per round ──────────────────────
  // The Worker only lists wallets whose 25,000 LUNC backing transfer has already
  // landed in the Weekly pool, so this entry is always paid for before it counts.
  if (ACTIONS_SECRET) {
    console.log('Fetching Trusted User entries...');
    try {
      const tRes = await fetch(ORACLE_WORKER + '/streak/trusted-entries', {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TerraOracle/1.0',
          'X-Actions-Secret': ACTIONS_SECRET,
        },
      });
      if (tRes.ok) {
        const tData = await tRes.json();
        for (const t of (tData.wallets || [])) {
          if (!t.wallet) continue;
          trustedByWallet[t.wallet] = TRUSTED_ENTRIES;   // one per round, not cumulative
        }
        console.log('Trusted User wallets credited: ' + Object.keys(trustedByWallet).length);
      } else {
        console.warn('Worker /streak/trusted-entries returned ' + tRes.status);
      }
    } catch (e) {
      console.error('Trusted entries fetch error:', e.message);
    }
  } else {
    console.warn('ACTIONS_SECRET not set - skipping Trusted User entries');
  }

  // ── Calculate entries ─────────────────────────────────────────────────────
  const allWallets = new Set([
    ...Object.keys(chatByWallet),
    ...Object.keys(questionByWallet),
    ...Object.keys(streakByWallet),
    ...Object.keys(trustedByWallet),
  ]);
  console.log('Chat: ' + Object.keys(chatByWallet).length + ', Questions: ' + Object.keys(questionByWallet).length + ', Streak: ' + Object.keys(streakByWallet).length + ', Trusted: ' + Object.keys(trustedByWallet).length);

  const entries = {};
  let cappedWallets = 0;
  for (const wallet of allWallets) {
    // Chat entries: floor(total_msgs/10), capped per round
    let chatTotal = 0;
    if (chatByWallet[wallet]) {
      let totalMsgs = 0;
      for (const day of Object.values(chatByWallet[wallet])) {
        totalMsgs += day;
      }
      const uncapped = Math.floor(totalMsgs / 10) * CHAT_ENTRIES_PER_10;
      chatTotal = Math.min(uncapped, MAX_CHAT_ENTRIES_PER_ROUND);
      if (uncapped > chatTotal) cappedWallets++;
    }

    // Question entries: already summed per tariff above
    const qEntries = questionByWallet[wallet] || 0;

    // Streak 14-day milestone entries (one-time)
    const sEntries = streakByWallet[wallet] || 0;

    // Trusted User entry (30-day streak, one per round)
    const tEntries = trustedByWallet[wallet] || 0;

    const total = chatTotal + qEntries + sEntries + tEntries;
    if (total > 0) {
      entries[wallet] = {
        chat:      chatTotal,
        questions: qEntries,
        streak:    sEntries,
        trusted:   tEntries,
        total:     total,
      };
    }
  }
  if (cappedWallets) console.log('Chat cap applied to ' + cappedWallets + ' wallet(s)');

  // ── Write JSON ────────────────────────────────────────────────────────────
  const output = {
    _meta: {
      description:  'Free Weekly Draw entries - Terra Oracle protocol',
      sources: {
        chat:      '1 entry per 10 messages, max ' + MAX_CHAT_ENTRIES_PER_ROUND + ' per round',
        questions: 'entries per question tariff (Basic +1, Priority +4)',
        streak:    '2 one-time entries at 14-day streak milestone',
        trusted:   '1 entry per round for Trusted Users (30-day streak), backed from Reserve',
      },
      updated:     new Date().toISOString(),
      history_from: cutoffIso,  // входы считаются с этого момента
      cutoff_source: cutoffSource,
      resets:       'после состоявшегося weekly-розыгрыша (обычно Пн 20:00 UTC)',
      // Ненулевое значение = недельный розыгрыш не состоялся, входы перенесены.
      // Это сигнал разбираться, а не нормальное состояние.
      missed_weekly_draws: missedWeeks,
    },
    entries: entries,
  };

  fs.writeFileSync(JSON_PATH, JSON.stringify(output, null, 2));

  const totalEntries = Object.values(entries).reduce(function(s, e) { return s + e.total; }, 0);
  console.log('Done: ' + allWallets.size + ' wallets, ' + totalEntries + ' total entries');
}

main().catch(function(e) { console.error(e); process.exit(1); });
