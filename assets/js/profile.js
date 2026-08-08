// ─── PROFILE SYSTEM ──────────────────────────────────────────

// CSS стили для профиля - добавляются динамически
(function injectProfileStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .wallet-profile-btn {
      display:block;width:100%;text-align:left;
      background:rgba(84,147,247,0.06);border:1px solid rgba(84,147,247,0.15);
      color:var(--accent);font-family:'Exo 2',sans-serif;font-size:13px;font-weight:700;
      letter-spacing:0.08em;padding:9px 14px;border-radius:8px;cursor:pointer;
      margin-bottom:8px;transition:all 0.2s;
    }
    .wallet-profile-btn:hover { background:rgba(84,147,247,0.12); border-color:rgba(84,147,247,0.35); }
    .title-row { display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border); }
    .title-row:last-child { border-bottom:none; }
    .title-progress-bar { flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden; }
    .title-progress-fill { height:100%;border-radius:3px;transition:width 0.6s ease; }
    .history-item { background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px; }
    .history-item-meta { font-size:12px;color:var(--muted);margin-bottom:6px;display:flex;gap:10px;align-items:center; }
    .history-item-text { font-size:14px;color:var(--text);line-height:1.7; }
    .history-item-votes { font-size:13px;color:var(--green);margin-top:8px; }
  `;
  document.head.appendChild(style);
})();

// ─── RANK SYSTEM (Oracle Ascension) ──────────────────────────
// Reputation = Action Score + Quality Score
// Action:  Ask question +40 | Answer +40 | Chat msg +5 (no limit)
// Quality: Upvote received +20 | Oracle Draw mint +25/125/250 (via worker /rep/draw)
// Discount applies to the Treasury leg of the question fee only - the Weekly
// Pool leg is fixed per tariff (Basic 25,000 / Priority 100,000).
//
// NOTE: this is an ESTIMATE. The Worker's weekly leaderboard applies two rules
// the browser cannot reproduce (it has no access to wallet history in KV):
//   - answers are degressive per day: 1-3 -> +40, 4-10 -> +10, 11+ -> 0
//   - upvotes only count from wallets with paid on-chain history
// So the number shown here can be slightly higher than the one paid out.

const RANKS = [
  {
    name: 'INITIATE',   icon: '◈',  minScore: 0,
    color: '#6b82a8',   bar: '#4a5c7a',   glow: 'rgba(107,130,168,0.3)',
    discount: 0,        questionPrice: 200000,
    discountLabel: 'No discount',
    multiplier: 1.0,
  },
  {
    name: 'SEEKER',     icon: '🌱', minScore: 500,
    color: '#66ffaa',   bar: '#1ec864',   glow: 'rgba(30,200,100,0.35)',
    discount: 0,        questionPrice: 200000,
    discountLabel: 'No discount',
    multiplier: 1.0,
  },
  {
    name: 'ADEPT',      icon: '🔵', minScore: 1500,
    color: '#7eb8ff',   bar: '#5493f7',   glow: 'rgba(84,147,247,0.4)',
    discount: 5,        questionPrice: 190000,
    discountLabel: '5% off any question',
    multiplier: 1.1,
  },
  {
    name: 'ANALYST',    icon: '🔮', minScore: 4000,
    color: '#c084fc',   bar: '#a855f7',   glow: 'rgba(168,85,247,0.4)',
    discount: 10,       questionPrice: 180000,
    discountLabel: '10% off any question',
    multiplier: 1.2,
  },
  {
    name: 'ORACLE',     icon: '⚡', minScore: 8000,
    color: '#ffd700',   bar: '#f5c518',   glow: 'rgba(245,197,24,0.45)',
    discount: 15,       questionPrice: 170000,
    discountLabel: '15% off any question',
    multiplier: 1.3,
  },
  {
    name: 'ARCHON',     icon: '🔥', minScore: 15000,
    color: '#ff8844',   bar: '#ff6600',   glow: 'rgba(255,102,0,0.45)',
    discount: 20,       questionPrice: 160000,
    discountLabel: '20% off any question',
    multiplier: 1.4,
  },
  {
    name: 'ASCENDED',   icon: '✦',  minScore: 30000,
    color: '#00ffff',   bar: '#00d4ff',   glow: 'rgba(0,212,255,0.55)',
    discount: 25,       questionPrice: 150000,
    discountLabel: '25% off any question',
    multiplier: 1.5,
  },
];

// ── Canonical discount & effective-REP rules (SINGLE SOURCE OF TRUTH) ────────
// Used by profile.js, reputation.js and app.js so rank, displayed REP and the
// actual charged question price always agree. Per the protocol docs:
//   1. The streak REP multiplier applies to your total base REP — this
//      "effective REP" is the displayed reputation AND the score ranks use.
//   2. When both a rank discount and the 7-day-streak discount (25%) are
//      available, the HIGHER one applies. They do NOT stack.
const STREAK_QUESTION_DISCOUNT = 25; // % off at 7+ day streak

function getEffectiveRep(baseRep, streakMultiplier) {
  return Math.round((baseRep || 0) * (streakMultiplier || 1.0));
}
function combineDiscounts(rankDiscount, streakDiscount) {
  return Math.max(rankDiscount || 0, streakDiscount || 0);
}
window.getEffectiveRep = getEffectiveRep;
window.combineDiscounts = combineDiscounts;
window.STREAK_QUESTION_DISCOUNT = STREAK_QUESTION_DISCOUNT;

// Legacy alias so existing code using TITLES still works
const TITLES = RANKS.filter(r => r.minScore > 0).map(r => ({
  name: r.icon + ' ' + r.name,
  questionsNeeded: 1, upvotesNeeded: 0,
  color: r.color, bar: r.bar,
  discount: r.discount, questionPrice: r.questionPrice,
  discountLabel: r.discountLabel,
}));

// ── Reputation calculation ────────────────────────────────────
// qStats: { myQuestions, myAnswers, totalUpvotes }
// chatStats: { msgCount }
function calcReputation(qStats, chatStats) {
  // answerUpvotes, not totalUpvotes: question upvotes are displayed but never
  // scored. Falls back to totalUpvotes only for callers built before the split.
  const { myQuestions = [], myAnswers = [], answerUpvotes, totalUpvotes = 0 } = qStats;
  const scoredUpvotes = (answerUpvotes !== undefined) ? answerUpvotes : totalUpvotes;
  const msgCount = chatStats?.msgCount || 0;

  // Action Score
  const actionScore =
    myQuestions.length * 40 +   // Ask question: +40 REP
    myAnswers.length   * 40 +   // Answer: +40 REP (flat estimate - see note above)
    msgCount * 5;               // Chat: +5 REP per message, no limit

  // Quality Score
  const qualityScore = scoredUpvotes * 20; // Upvote on an answer: +20 REP

  return actionScore + qualityScore;
}

// ── Get rank by reputation score ─────────────────────────────
function getRank(score) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (score >= r.minScore) rank = r;
  }
  return rank;
}

// ── Get next rank ─────────────────────────────────────────────
function getNextRank(score) {
  for (const r of RANKS) {
    if (score < r.minScore) return r;
  }
  return null; // already at max
}

// ── Get rank badge HTML ───────────────────────────────────────
// score: reputation number | wallet: optional wallet address for cache
function getRankBadgeHTML(score) {
  if (score === undefined || score === null) return '';
  const rank = getRank(score);
  if (!rank) return '';
  const isInitiate = rank.name === 'INITIATE';
  return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:${rank.color};${isInitiate ? 'opacity:0.5;' : `text-shadow:0 0 6px ${rank.glow};`}background:rgba(0,0,0,0.2);border:1px solid ${rank.color}${isInitiate ? '55' : '88'};padding:1px 7px;border-radius:4px;">${rank.icon} ${rank.name}</span>`;
}

// ── On-chain reputation ─────────────────────────────────────────────────────
// Read by the visitor's own browser, straight from a public node — no server of
// ours between the contract and the number on screen. That is the whole point
// of moving reputation on-chain, so the read should not be proxied either.
const ORACLE_SCORE_CONTRACT = 'terra1pj6t6v4czktz7znzq8xk2ny2yh7pdwen4jw8z4zz86zrac6ur9vqqkwcls';
const ORACLE_SCORE_LCD = 'https://terra-classic-lcd.publicnode.com';

// Values are stored in micro-units. Round rather than floor: decay between
// blocks otherwise turns a freshly granted 40 into a displayed 39.
async function fetchOnChainScore(wallet) {
  if (!wallet) return null;
  try {
    const q = btoa(JSON.stringify({ score: { address: wallet } }));
    const res = await fetch(`${ORACLE_SCORE_LCD}/cosmwasm/wasm/v1/contract/${ORACLE_SCORE_CONTRACT}/smart/${q}`);
    if (!res.ok) return null;
    const d = (await res.json()).data;
    if (!d) return null;
    return {
      rank:   Math.round(Number(d.lifetime_earned || 0) / 1e6),   // never decays
      weight: Math.round(Number(d.effective || 0) / 1e6),         // 90-day half-life
      actions: d.actions || 0,
    };
  } catch (e) { return null; }
}
window.fetchOnChainScore = fetchOnChainScore;

function oracleScoreTxUrl() {
  return 'https://finder.terraport.finance/mainnet/address/' + ORACLE_SCORE_CONTRACT;
}
window.oracleScoreTxUrl = oracleScoreTxUrl;

// Avatar ring in the rank colour. Returns the border and glow only, so the
// caller keeps control of size, layout and hover behaviour.
// INITIATE stays deliberately dim: a ring everyone has signals nothing, and a
// bright one would make the starting rank look like an achievement.
// How many grants are queued but not yet written. A count, not a REP figure:
// pricing the queue would mean reimplementing the contract's weights out here,
// which is the duplication this whole change exists to remove.
async function fetchPendingCount(wallet) {
  const base = (typeof window.WORKER_URL !== 'undefined' && window.WORKER_URL)
    ? window.WORKER_URL
    : 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
  try {
    const res = await fetch(base + '/rep/scores');
    if (!res.ok) return 0;
    const d = await res.json();
    return (d && d.pending && d.pending[wallet]) || 0;
  } catch (e) { return 0; }
}
window.fetchPendingCount = fetchPendingCount;

function renderOnChainPanel(chain, streakMultiplier, pendingCount) {
  const host = document.getElementById('profile-rep-big');
  if (!host) return;

  let box = document.getElementById('profile-onchain');
  if (!box) {
    box = document.createElement('div');
    box.id = 'profile-onchain';
    box.style.cssText = 'margin-top:6px;font-size:11px;line-height:1.5;color:var(--text-dim);text-align:right;';
    host.parentNode.appendChild(box);
  }

  if (!chain) {
    // The number above came from the local estimate, so say so rather than
    // letting it pass for a settled figure.
    box.innerHTML = '<span style="opacity:.7">chain unreachable — showing an estimate</span>';
    return;
  }

  const link = '<a href="' + oracleScoreTxUrl() + '" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">verify ↗</a>';
  const mult = streakMultiplier || 1.0;

  const queued = pendingCount > 0
    ? '<div style="opacity:.7">' + pendingCount + (pendingCount === 1 ? ' action' : ' actions') + ' queued, written within the hour</div>'
    : '';
  // Named explicitly so the two figures never look like a discrepancy: the
  // contract holds the base, the bonus is applied here.
  const multNote = mult > 1.0
    ? '<div style="opacity:.7">streak bonus ×' + mult + ' applied on top, off-chain</div>'
    : '';

  box.innerHTML =
    '<div><b style="color:var(--green);">' + chain.rank.toLocaleString() + '</b> on-chain · ' + link + '</div>' +
    '<div style="opacity:.7">weight ' + chain.weight.toLocaleString() + ' — decays with a 90-day half-life</div>' +
    queued + multNote;
}
window.renderOnChainPanel = renderOnChainPanel;

function getRankRingCSS(score) {
  const rank = (score === undefined || score === null) ? null : getRank(score);
  if (!rank) return { border: 'rgba(84,147,247,0.2)', shadow: 'none' };
  const isInitiate = rank.name === 'INITIATE';
  return {
    border: isInitiate ? `${rank.color}44` : rank.color,
    shadow: isInitiate ? 'none' : `0 0 8px ${rank.glow}`,
  };
}
window.getRankRingCSS = getRankRingCSS;

// Build a score map from allQuestions: wallet → {questions, answers, upvotes}
function buildScoreMap(allQuestions) {
  const map = {};
  for (const q of allQuestions) {
    if (!q.wallet) continue;
    if (!map[q.wallet]) map[q.wallet] = { questions: 0, answers: 0, upvotes: 0 };
    map[q.wallet].questions++;
    map[q.wallet].upvotes += q.votes || 0;
    for (const a of q.answers || []) {
      if (!a.wallet) continue;
      if (!map[a.wallet]) map[a.wallet] = { questions: 0, answers: 0, upvotes: 0 };
      map[a.wallet].answers++;
      map[a.wallet].upvotes += a.votes || 0;
    }
  }
  // Convert to score
  const scores = {};
  for (const [w, s] of Object.entries(map)) {
    scores[w] = s.questions * 40 + s.answers * 40 + s.upvotes * 20;
  }
  return scores;
}

// Global score map - populated after questions load
window._walletScores = {};

// ── Full REP for rank badges ────────────────────────────────────────────────
// buildScoreMap above can only see questions.json, so it knows nothing about
// chat messages or Draw REP. That made every badge on the site disagree with
// the profile page: a wallet reading 655 REP / SEEKER on its own profile showed
// 200 REP / INITIATE in chat and on the board.
//
// The Worker can see all three sources, so it serves the finished map. This
// upgrades the badges once it arrives; until then the Q&A-only figure stands in,
// which is the same behaviour as before rather than an empty badge.
// Kept separately from window._walletScores because buildScoreMap() reassigns
// that on every questions load, wiping the full figures back to Q&A-only. The
// visible symptom was a badge that read SEEKER, dropped to INITIATE after
// navigating away and back, and returned only once chat refreshed.
let _walletScoresFull = null;
let _walletScoresAt = 0;
const WALLET_SCORES_TTL = 60 * 1000;

// Lays the full figures back over whatever buildScoreMap just produced. Safe to
// call as often as you like — it only touches the map.
function applyWalletScores() {
  if (!_walletScoresFull) return false;
  window._walletScores = Object.assign({}, window._walletScores, _walletScoresFull);
  return true;
}
window.applyWalletScores = applyWalletScores;

async function upgradeWalletScores(force) {
  const fresh = _walletScoresFull && (Date.now() - _walletScoresAt) < WALLET_SCORES_TTL;
  if (fresh && !force) { applyWalletScores(); return; }

  const base = (typeof window.WORKER_URL !== 'undefined' && window.WORKER_URL)
    ? window.WORKER_URL
    : 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
  try {
    const res = await fetch(base + '/rep/scores');
    if (!res.ok) { applyWalletScores(); return; }
    const data = await res.json();
    if (!data || !data.scores) { applyWalletScores(); return; }

    _walletScoresFull = data.scores;
    _walletScoresAt = Date.now();
    applyWalletScores();

    // Redraw whatever is already on screen with the corrected numbers.
    if (typeof renderBoard === 'function') { try { renderBoard(); } catch (e) {} }
    if (typeof renderChatMessages === 'function' && Array.isArray(window._chatMsgs)) {
      try { renderChatMessages(window._chatMsgs); } catch (e) {}
    }
  } catch (e) {
    // Fall back to the last good copy; badges stay correct rather than
    // reverting to the partial figure on a single failed request.
    applyWalletScores();
    console.warn('rank scores unavailable:', e.message);
  }
}
window.upgradeWalletScores = upgradeWalletScores;

// Legacy function so existing calls don't break
// Takes the score, does not reinvent it. Both earlier versions computed REP
// here from question and upvote counts — one with its own weights, one with
// thresholds every wallet cleared at once, which is how every author ended up
// labelled ASCENDED.
function getUserTitleFromStats(score) {
  const rank = getRank(score || 0);
  if (!rank) return null;
  return {
    name: rank.icon + ' ' + rank.name,
    color: rank.color, bar: rank.bar,
    discount: rank.discount, questionPrice: rank.questionPrice,
    discountLabel: rank.discountLabel,
  };
}

// ── On-chain chat stats fetch ────────────────────────────────────────────────
// Reads Treasury wallet txs for the connected wallet over last 7 days.
// Chat tx: 5,000 LUNC ±1% + non-empty memo → groups by UTC calendar day
// Free entries: every 10th message (total) = +1 Weekly Draw entry
// Also counts Q&A questions: each = +2 free entries
// TREASURY_WALLET defined in app.js
const PROFILE_LCD_NODES = [
  'https://terra-classic-lcd.publicnode.com',
  'https://lcd.terraclassic.community',
];
const PROFILE_FCD_NODES = [
  'https://terra-classic-fcd.publicnode.com',
  'https://fcd.terra-classic.hexxagon.io',
];
const CHAT_ULUNA    = 5000 * 1e6;
const QA_ULUNA      = 200000 * 1e6;
const TOLERANCE     = 0.01;

async function fetchChatStats(address) {
  if (!address) return { msgCount: 0, entriesEarned: 0, todayMsgs: 0, todayEntries: 0, days: {}, qaCount: 0 };

  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
  const days   = {};
  let   qaCount = 0;

  // FCD is primary - reliably indexes all tx types on columbus-5
  const allNodes = [
    { base: 'https://fcd.terra-classic.hexxagon.io',       type: 'fcd' },
    { base: 'https://terra-classic-fcd.publicnode.com',    type: 'fcd' },
    { base: 'https://terra-classic-lcd.publicnode.com',    type: 'lcd' },
    { base: 'https://lcd.terraclassic.community',          type: 'lcd' },
  ];

  for (const { base, type } of allNodes) {
    try {
      let offset = 0, done = false, found = false;
      while (!done) {
        let url;
        let data = null;
        if (type === 'fcd') {
          url = `${base}/v1/txs?account=${address}&limit=100&offset=${offset}`;
          const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
          if (!res.ok) break;
          data = await res.json();
        } else {
          url = `${base}/cosmos/tx/v1beta1/txs?events=transfer.sender=%27${address}%27&pagination.limit=50&order_by=2&pagination.offset=${offset}`;
          const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
          if (!res.ok) break;
          data = await res.json();
        }
        if (!data) break;

        // FCD: flat txs[] each with tx.tx.value.memo + timestamp
        // LCD: parallel txs[] (bodies) + tx_responses[] (metadata)
        let _entries = [];
        if (type === 'fcd') {
          const fcdTxs = data.txs || [];
          _entries = fcdTxs.map(tx => ({
            ts:        Math.floor(new Date(tx.timestamp).getTime() / 1000),
            memo:      tx.tx?.value?.memo || tx.tx?.body?.memo || '',
            msgs:      tx.tx?.value?.msg  || tx.tx?.body?.messages || [],
          }));
        } else {
          const _txBodies    = data.txs || [];
          const _txResponses = data.tx_responses || [];
          const _n = Math.max(_txBodies.length, _txResponses.length);
          for (let i = 0; i < _n; i++) {
            _entries.push({
              ts:   Math.floor(new Date(_txResponses[i]?.timestamp || 0).getTime() / 1000),
              memo: _txBodies[i]?.body?.memo || '',
              msgs: _txBodies[i]?.body?.messages || [],
            });
          }
        }
        if (!_entries.length) break;

        for (const _entry of _entries) {
          const ts   = _entry.ts;
          const memo = _entry.memo;
          const msgs = _entry.msgs;
          if (ts < cutoff) { done = true; break; }

          for (const msg of msgs) {
            const msgType  = msg['@type'] || msg.type || '';
            if (!msgType.includes('MsgSend')) continue;
            const val      = msg.value || msg;
            const toAddr   = val.to_address   || '';
            const fromAddr = val.from_address || '';
            if (toAddr   !== TREASURY_WALLET) continue;
            if (fromAddr !== address)         continue;

            const coins = val.amount || [];
            const lunc  = coins.find(c => c.denom === 'uluna');
            if (!lunc) continue;
            const amt = Number(lunc.amount);

            // Chat: ~5,000 LUNC + non-empty memo
            if (memo.trim().length > 0 &&
                amt >= CHAT_ULUNA * (1 - TOLERANCE) &&
                amt <= CHAT_ULUNA * (1 + TOLERANCE)) {
              const day = new Date(_entry.ts * 1000).toISOString().slice(0, 10);
              days[day] = (days[day] || 0) + 1;
            }

            // Q&A: ~200,000 LUNC
            if (amt >= QA_ULUNA * (1 - TOLERANCE) &&
                amt <= QA_ULUNA * (1 + TOLERANCE)) {
              qaCount++;
            }
          }
        }
        if (_entries.length < 50) break;
        offset += 50;
      }
      // If we got through without error, stop trying nodes
      break;
    } catch(e) {
      console.warn('fetchChatStats node failed:', e.message);
      continue;
    }
  }

  const msgCount = Object.values(days).reduce((s, n) => s + n, 0);

  let entriesEarned = qaCount * 2;
  entriesEarned += Math.floor(msgCount / 10);

  const todayKey     = new Date().toISOString().slice(0, 10);
  const todayMsgs    = days[todayKey] || 0;
  const todayEntries = Math.floor(todayMsgs / 10);

  return { msgCount, entriesEarned, todayMsgs, todayEntries, days, qaCount };
}

// Count upvotes received on answers
function getTotalUpvotesReceived(walletAddress) {
  if (!walletAddress) return 0;
  let total = 0;
  for (const q of questions) {
    for (const a of q.answers) {
      if ((a.fullAddr === walletAddress || a.walletAddr === walletAddress) && a.votes > 0) {
        total += a.votes;
      }
    }
  }
  return total;
}

function getTopAnswerCount(walletAddress) {
  if (!walletAddress) return 0;
  let count = 0;
  for (const q of questions) {
    for (const a of q.answers) {
      if ((a.fullAddr === walletAddress || a.walletAddr === walletAddress) && a.votes >= 3) count++;
    }
  }
  return count;
}

function getUserTitle(walletAddress) {
  if (!walletAddress) return null;
  // _walletScores is filled from the contract, so the label on a question
  // matches the rank on the profile and in chat. Missing means zero, which
  // lands on INITIATE — the right answer for a wallet with no history.
  const score = (window._walletScores && window._walletScores[walletAddress]) || 0;
  return getUserTitleFromStats(score);
}


// Message counting moved to Worker - see POST /chat/message

// ─── PROFILE DATA ─────────────────────────────────────────────
function getProfileKey(address) { return 'profile_' + address; }

// In-memory cache to avoid duplicate Worker requests
const _profileFetchCache = {};

function loadProfile(address) {
  if (!address) return null;
  try { return JSON.parse(localStorage.getItem(getProfileKey(address)) || 'null'); } catch(e) { return null; }
}

// Prefetch profiles for multiple addresses at once (deduped, cached)
async function prefetchProfiles(addresses) {
  if (!addresses || !addresses.length) return;
  const unique = [...new Set(addresses.filter(Boolean))];
  const toFetch = unique.filter(addr => {
    if (_profileFetchCache[addr]) return false; // already fetching/fetched
    const p = loadProfile(addr);
    if (p) return false; // already fetched
    return true;
  });
  if (!toFetch.length) return;
  // Mark as fetching to prevent duplicate requests
  toFetch.forEach(addr => { _profileFetchCache[addr] = true; });
  await Promise.all(toFetch.map(addr => loadProfileFromWorker(addr).catch(() => null)));
}

function saveProfileData(address, data) {
  if (!address) return;
  localStorage.setItem(getProfileKey(address), JSON.stringify(data));
  // Sync to Worker (async, non-blocking)
  syncProfileToWorker(address, data);
}

async function syncProfileToWorker(address, data) {
  // Disabled — fully anonymous, no profile sync
}

async function loadProfileFromWorker(address) {
  if (!address) return null;
  try {
    const res = await fetch(`${WORKER_URL}/profile?wallet=${address}`);
    if (!res.ok) return null;
    const data = await res.json();
    // Anonymous — don't load or cache nickname/avatar
    return null;
  } catch(e) {
    console.warn('Profile load from worker failed:', e.message);
    return null;
  }
}

function getProfileNickname(address) {
  // Fully anonymous — no nicknames
  return null;
}

function getProfileAvatar(address) {
  // Fully anonymous — no avatars
  return null;
}

function getDisplayName(address) {
  // Fully anonymous — wallet address only
  if (!address) return 'Anonymous';
  return address.slice(0, 8) + '...' + address.slice(-4);
}

// ─── OPEN PROFILE PAGE ────────────────────────────────────────
function openProfile(skipHistory) {
  document.getElementById('wallet-dropdown').classList.remove('open');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-profile').classList.add('active');
  if (!skipHistory && history.pushState) history.pushState({ page: 'profile' }, '', '/profile');
  try { sessionStorage.setItem('currentPage', 'profile'); } catch(e) {}
  smoothScrollTop();
  const addr = globalWalletAddress;
  if (addr) {
    loadProfileFromWorker(addr).then(() => renderProfilePage());
  } else {
    renderProfilePage();
  }
}

// ── Fetch question stats from worker ─────────────────────────
async function fetchQuestionStats(address) {
  try {
    const res = await fetch(`${WORKER_URL}/questions`);
    if (!res.ok) throw new Error('Worker error');
    const data = await res.json();
    const allQuestions = data.questions || [];

    const myQuestions = allQuestions.filter(q => q.wallet === address);
    let totalUpvotes = 0;
    const myAnswers = [];

    // Count upvotes received on answers
    for (const q of allQuestions) {
      for (const a of q.answers || []) {
        if (a.wallet === address) {
          myAnswers.push({ ...a, questionId: q.id, questionText: q.text });
          totalUpvotes += a.votes || 0;
        }
      }
    }

    // Upvotes on ANSWERS are the ones that grant REP; the tally above holds
    // exactly those, so keep it before question votes are folded in.
    const answerUpvotes = totalUpvotes;

    // Question upvotes count towards the visible "upvotes received" stat but
    // grant no REP — asking is already paid for with the +40 for the question,
    // and every other component of the system (the snapshot, the queue,
    // rep-rewards.js) scores it that way.
    for (const q of myQuestions) {
      totalUpvotes += q.votes || 0;
    }

    const topAnswers = myAnswers.filter(a => a.votes >= 3).length;
    return { myQuestions, myAnswers, totalUpvotes, answerUpvotes, topAnswers, allQuestions };
  } catch(e) {
    console.warn('fetchQuestionStats failed:', e.message);
    return { myQuestions: [], myAnswers: [], totalUpvotes: 0, answerUpvotes: 0, topAnswers: 0, allQuestions: [] };
  }
}

// ─── DRAW REP FETCH ───────────────────────────────────────────
async function fetchDrawRep(address) {
  try {
    const res = await fetch(`${WORKER_URL}/rep/draw?wallet=${address}`);
    if (!res.ok) throw new Error('Worker error');
    return await res.json();
  } catch(e) {
    return { total: 0, history: [] };
  }
}

async function fetchStreakData(address) {
  try {
    const res = await fetch(`${WORKER_URL}/streak?wallet=${address}`);
    if (!res.ok) throw new Error('Worker error');
    return await res.json();
  } catch(e) {
    console.warn('fetchStreakData failed:', e.message);
    return { currentStreak: 0, longestStreak: 0, todayDone: false, multiplier: 1.0, milestones: [], lastActivityDate: null };
  }
}

// ─── STREAK BLOCK RENDERER ────────────────────────────────────
function renderStreakBlock(streakData) {
  const el = document.getElementById('streak-block');
  if (!el) return;

  const { currentStreak, longestStreak, todayDone, multiplier, milestones } = streakData;

  const flameSize   = currentStreak >= 30 ? '32px' : currentStreak >= 14 ? '28px' : currentStreak >= 7 ? '24px' : '20px';
  const streakColor = currentStreak >= 30 ? '#00ffff' : currentStreak >= 14 ? '#ffd700' : currentStreak >= 7 ? '#ff8844' : currentStreak >= 3 ? '#66ffaa' : 'var(--muted)';
  const streakGlow  = currentStreak >= 30 ? 'rgba(0,212,255,0.5)' : currentStreak >= 14 ? 'rgba(245,197,24,0.45)' : currentStreak >= 7 ? 'rgba(255,102,0,0.4)' : currentStreak >= 3 ? 'rgba(30,200,100,0.35)' : 'none';

  const MILESTONES       = [3, 5, 7, 14, 30];
  const MILESTONE_LABELS = {
    3:  'x1.1 REP multiplier',
    5:  'x1.2 REP multiplier',
    7:  'x1.3 REP + 25% question discount',
    14: 'x1.5 REP + 2 free Weekly Draw entries',
    30: 'x2.0 REP + Trusted User status',
  };
  const nextMs      = MILESTONES.find(m => currentStreak < m);
  const nextMsLabel = nextMs ? MILESTONE_LABELS[nextMs] : null;

  const statusBadge = todayDone
    ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(30,200,100,0.12);border:1px solid rgba(30,200,100,0.35);color:#4ade80;font-weight:700;">✓ Streak secured today</span>`
    : `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(255,170,0,0.1);border:1px solid rgba(255,170,0,0.3);color:#ffaa00;font-weight:700;">⏳ Today not completed</span>`;

  const MILESTONE_REWARDS = {
    3:  'x1.1 REP',
    5:  'x1.2 REP',
    7:  'x1.3 REP\n25% off ask',
    14: 'x1.5 REP\n2 free entries',
    30: 'x2.0 REP\n+1 Draw entry',
  };

  const msBadges = MILESTONES.map(m => {
    const reached  = milestones.includes(m);
    const lines    = MILESTONE_REWARDS[m].split('\n');
    return `<div style="text-align:center;padding:8px 6px;border-radius:8px;flex:1;min-width:50px;
      background:${reached ? 'rgba(30,200,100,0.08)' : 'rgba(255,255,255,0.03)'};
      border:1px solid ${reached ? 'rgba(30,200,100,0.3)' : 'var(--border)'};
      opacity:${reached ? 1 : 0.45};">
      <div style="line-height:0;margin-bottom:2px;">${reached ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;filter:drop-shadow(0 0 4px #4ade8088);"><path d="M4.5 12.6 9.4 17.5 19.5 7.4"/></svg>` : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6B82A8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;"><rect x="4.5" y="10.4" width="15" height="9.6" rx="2.2"/><path d="M8 10.4V7.8a4 4 0 0 1 8 0v2.6"/><path d="M12 14.3v2.2"/></svg>`}</div>
      <div style="font-size:12px;font-weight:700;color:${reached ? '#4ade80' : 'var(--muted)'};margin-top:2px;">${m}d</div>
      ${lines.map(l => `<div style="font-size:11px;color:${reached ? '#4ade80' : 'var(--muted)'};opacity:0.85;margin-top:2px;line-height:1.3;">${l}</div>`).join('')}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <svg width="${flameSize}" height="${flameSize}" viewBox="0 0 24 24" fill="none" stroke="${streakColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;filter:${currentStreak > 0 ? `drop-shadow(0 0 8px ${streakGlow})` : 'none'};"><path d="M12 20.6c3.2 0 5.7-2.2 5.7-5.3 0-3.6-2.9-5.6-4.2-9.6-2 1.6-3 3.3-3 5 0 1.2.5 2 .5 2.9 0 .9-.7 1.6-1.6 1.6-.85 0-1.45-.55-1.65-1.45-1 1.2-1.55 2.6-1.55 4.05 0 3 2.5 4.8 5.75 4.8z"/></svg>
        <div>
          <div style="font-size:12px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:2px;">Daily Streak</div>
          <div style="font-family:'Rajdhani',sans-serif;font-size:28px;font-weight:800;color:${streakColor};${currentStreak > 0 ? `text-shadow:0 0 14px ${streakGlow};` : ''}line-height:1;">
            ${currentStreak} <span style="font-size:16px;font-weight:600;opacity:0.7;">days</span>
          </div>
        </div>
      </div>
      <div style="text-align:right;">
        ${statusBadge}
        <div style="font-size:12px;color:var(--muted);margin-top:6px;">Best: ${longestStreak}d · REP ×${multiplier.toFixed(1)}</div>
      </div>
    </div>
    ${nextMs ? `
      <div style="margin-bottom:10px;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid var(--border);">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">Next milestone: <strong style="color:var(--text);">${nextMs} days</strong></div>
        <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:5px;overflow:hidden;">
          <div style="height:100%;border-radius:4px;background:linear-gradient(90deg,#ff8844,#ffd700);width:${Math.round((currentStreak / nextMs) * 100)}%;transition:width 0.6s ease;"></div>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px;">${currentStreak}/${nextMs} days · unlocks: <span style="color:var(--green);">${nextMsLabel}</span></div>
      </div>
    ` : `<div style="font-size:13px;color:#00ffff;font-weight:700;letter-spacing:0.08em;margin-bottom:10px;">✦ MAX STREAK - TRUSTED STATUS UNLOCKED</div>`}
    <div style="display:flex;gap:6px;">${msBadges}</div>
    <div style="margin-top:10px;font-size:12px;color:var(--muted);line-height:1.6;">
      Active in <strong style="color:var(--text);">Ask · Answer · Vote · Chat · Draw</strong> = 1 streak day.
      Miss 1 day per 7 days = grace period applied automatically.
    </div>
  `;
}


// ── Generative "Oracle face" avatar ──────────────────────────────────────
// Deterministic from the wallet address: orbit angles, colors and particle
// positions are derived from a simple string hash, so every wallet gets a
// unique but STABLE identicon — recognizable identity with zero deanonymization.
function _avaHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return Math.abs(h);
}
function walletAvatar(addr) {
  const P = ['#7B5CFF', '#00D4FF', '#E8C840', '#00FFB0', '#ff6b8a', '#a78bfa'];
  const h1 = _avaHash(addr), h2 = _avaHash(addr + ':1'), h3 = _avaHash(addr + ':2'), h4 = _avaHash(addr + ':3');
  const rot1 = h1 % 180, rot2 = h2 % 180, rot3 = h3 % 180;
  const c1 = P[h1 % P.length], c2 = P[h2 % P.length], c3 = P[h3 % P.length];
  const core = P[h4 % P.length];
  // 3 particles on deterministic positions (polar coords from hash)
  let dots = '';
  for (let i = 0; i < 3; i++) {
    const hh = _avaHash(addr + ':p' + i);
    const ang = (hh % 360) * Math.PI / 180;
    const rad = 26 + (hh % 14);
    const x = (50 + rad * Math.cos(ang)).toFixed(1);
    const y = (50 + rad * Math.sin(ang)).toFixed(1);
    const r = (1.4 + (hh % 12) / 10).toFixed(1);
    dots += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + P[hh % P.length] + '"/>';
  }
  return '<svg viewBox="0 0 100 100">'
    + '<defs><radialGradient id="avac' + (h1 % 997) + '" cx="42%" cy="36%"><stop offset="0" stop-color="#2a2450"/><stop offset="1" stop-color="#0a0e1c"/></radialGradient></defs>'
    + '<rect width="100" height="100" fill="url(#avac' + (h1 % 997) + ')"/>'
    + '<g transform="rotate(' + rot1 + ' 50 50)"><ellipse cx="50" cy="50" rx="36" ry="14" fill="none" stroke="' + c1 + '" stroke-width="1.6" opacity=".8"/></g>'
    + '<g transform="rotate(' + rot2 + ' 50 50)"><ellipse cx="50" cy="50" rx="33" ry="11" fill="none" stroke="' + c2 + '" stroke-width="1.2" opacity=".65"/></g>'
    + '<g transform="rotate(' + rot3 + ' 50 50)"><ellipse cx="50" cy="50" rx="27" ry="8" fill="none" stroke="' + c3 + '" stroke-width="1" opacity=".5"/></g>'
    + '<circle cx="50" cy="50" r="9" fill="' + core + '" opacity=".9"/>'
    + '<circle cx="47" cy="47" r="3.4" fill="#fff" opacity=".85"/>'
    + dots
    + '</svg>';
}
const _PF_STAR = '<svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>';
function copyProfileAddr() {
  const el = document.getElementById('profile-wallet-short');
  const btn = document.getElementById('profile-copy-btn');
  if (!el) return;
  const addr = el.textContent || '';
  const done = () => {
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg viewBox="0 0 24 24" style="stroke:#6ee7b7;"><path d="M20 6 9 17l-5-5"/></svg>';
    setTimeout(() => { btn.innerHTML = orig; }, 1400);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(addr).then(done).catch(() => {});
  }
}

function renderProfilePage() {
  const address = globalWalletAddress;
  if (!address) return;

  // Anonymous profile — wallet address only, no nickname/avatar
  const topCount = getTopAnswerCount(address);
  // Wallet address — show full address
  const walletShortEl = document.getElementById('profile-wallet-short');
  if (walletShortEl) walletShortEl.textContent = address;

  // Generative avatar (stable per address)
  const avaEl = document.getElementById('profile-avatar');
  if (avaEl && avaEl.dataset.addr !== address) {
    avaEl.innerHTML = walletAvatar(address);
    avaEl.dataset.addr = address;
  }

  // Title badge - show loading until real data arrives
  const titleEl = document.getElementById('profile-title-badge');
  if (titleEl) {
    titleEl.textContent = '…';
    titleEl.style.color = 'var(--muted)';
  }

  // Stats - show loading state
  document.getElementById('stat-questions').textContent = '…';
  document.getElementById('stat-answers').textContent = '…';
  document.getElementById('stat-upvotes').textContent = '…';
  document.getElementById('stat-top-answers').textContent = '…';
  document.getElementById('stat-messages').textContent = '…';

  // Load question stats from worker + chat stats from chain + streak + draw REP in parallel
  Promise.all([
    fetchQuestionStats(address).catch(() => ({ myQuestions: [], myAnswers: [], totalUpvotes: 0, answerUpvotes: 0, topAnswers: 0, allQuestions: [] })),
    fetchChatStats(address).catch(() => ({ msgCount: 0, entriesEarned: 0, todayMsgs: 0, todayEntries: 0, days: {}, qaCount: 0 })),
    fetchStreakData(address).catch(() => null),
    fetchDrawRep(address).catch(() => null),
    fetchOnChainScore(address).catch(() => null),
    fetchPendingCount(address).catch(() => 0),
  ]).then(([qStats, chatStats, streakData, drawRep, chain, pendingCount]) => {
    const { myQuestions, myAnswers, totalUpvotes, topAnswers, allQuestions } = qStats;

    document.getElementById('stat-questions').textContent = myQuestions.length;
    document.getElementById('stat-answers').textContent = myAnswers.length;
    document.getElementById('stat-upvotes').textContent = totalUpvotes;
    document.getElementById('stat-top-answers').textContent = topAnswers;
    document.getElementById('stat-messages').textContent = chatStats.msgCount;

    // Calculate reputation + rank
    // The contract is the figure. calcReputation stays only as a fallback for
    // when the chain cannot be reached — six copies of one formula is how the
    // site ended up showing four different numbers for the same wallet, and the
    // only way to stop that is for the copies never to be authoritative.
    const estimate = calcReputation(qStats, chatStats) + (drawRep?.total || 0);
    const baseReputation = chain ? chain.rank : estimate;
    const streakMultiplier = streakData?.multiplier || 1.0;
    // Rank follows all-time REP alone. Multiplying by the streak made rank
    // fall when a streak lapsed, which contradicts the promise that your status
    // stays where you left it — and that promise is why lifetime_earned in the
    // contract deliberately never decays. The multiplier still counts, for
    // weekly reward shares and its own 25% question discount.
    const reputation = baseReputation;
    const rank       = getRank(reputation);
    const nextRank   = getNextRank(reputation);

    // Update title badge → rank with SVG star (no default emoji)
    const titleEl = document.getElementById('profile-title-badge');
    if (titleEl) {
      titleEl.innerHTML = `<span style="display:inline-flex;width:14px;height:14px;">${_PF_STAR.replace('<svg ', '<svg style="stroke:' + rank.color + ';" ')}</span><span style="color:${rank.color};text-shadow:0 0 12px ${rank.glow};">${rank.name}</span>`;
      titleEl.style.color = rank.color;
    }
    // Rank-colored ring around the avatar
    const ringEl = document.getElementById('profile-ava-ring');
    if (ringEl) {
      ringEl.style.borderColor = rank.color;
      ringEl.style.boxShadow = '0 0 22px ' + rank.glow;
    }
    // Big REP number in the header
    const repBigEl = document.getElementById('profile-rep-big');
    if (repBigEl) repBigEl.textContent = reputation.toLocaleString();

    // Settled figure from the contract, shown next to the live one. They differ
    // by whatever the attestor has not written yet — an hour at most — and
    // saying so is better than quietly showing a number that lags.
    // Not awaited and wrapped: this is a decoration on top of the page, and a
    // slow or failing node must never stop the rest of the profile rendering.
    // These now agree by construction: the displayed figure is the contract's
    // own, with no multiplier layered on top.
    try { renderOnChainPanel(chain, streakMultiplier, pendingCount); }
    catch (e) { console.warn('on-chain panel:', e); }
    // Perk badge: current discount, or the NEXT rank that unlocks one
    const perkEl = document.getElementById('profile-next-perk');
    if (perkEl) {
      if (rank.discount > 0) {
        perkEl.textContent = rank.discount + '% off questions';
        perkEl.style.display = '';
      } else {
        const nextPerkRank = (typeof RANKS !== 'undefined')
          ? RANKS.find(r => r.minScore > rank.minScore && (r.discount || 0) > 0)
          : null;
        if (nextPerkRank) {
          perkEl.textContent = 'Next perk: ' + nextPerkRank.discount + '% off at ' + nextPerkRank.name;
          perkEl.style.display = '';
        } else {
          perkEl.style.display = 'none';
        }
      }
    }

    // Render reputation block
    renderReputationBlock(reputation, rank, nextRank);

    renderMessageProgress(chatStats);
    renderRankProgress(reputation);
    renderStreakBlock(streakData);
    renderHistoryTab(currentHistoryTab || 'answers', myAnswers, myQuestions);
  });
}

// ─── MESSAGE MILESTONE PROGRESS (on-chain stats) ─────────────
function renderMessageProgress(stats) {
  const el = document.getElementById('message-milestone-section');
  if (!el) return;

  // Guard against undefined stats (network error or slow load)
  const msgCount     = stats?.msgCount     ?? 0;
  const entriesEarned = stats?.entriesEarned ?? 0;
  const todayMsgs    = stats?.todayMsgs    ?? 0;
  const todayEntries = stats?.todayEntries  ?? 0;

  // Progress to next entry: X/10 msgs total
  const totalProgress = msgCount % 10;
  const pct = Math.round((totalProgress / 10) * 100);

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="font-size:13px;color:var(--muted);"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;filter:drop-shadow(0 0 4px currentColor88);"><rect x="3.5" y="4.8" width="17" height="11.8" rx="3"/><path d="M8.2 16.6v3.6l4.4-3.6"/><path d="M8.6 10.7h.01M12 10.7h.01M15.4 10.7h.01"/></svg> Chat messages → free Weekly lottery entries</span>
      <span style="font-size:13px;color:var(--green);font-weight:700;">${entriesEarned} ${entriesEarned === 1 ? 'entry' : 'entries'} earned</span>
    </div>
    <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:6px;margin-bottom:10px;overflow:hidden;">
      <div style="height:100%;border-radius:4px;background:linear-gradient(90deg,#1ec864,#4ade80);width:${pct}%;transition:width 0.6s ease;"></div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      <div style="font-size:12px;padding:3px 10px;border-radius:20px;
        background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--muted);">
        Every 10th message = +1 Weekly Draw entry
      </div>
      <div style="font-size:12px;color:var(--muted);padding:3px 0;">
        ${totalProgress}/10 to next entry
      </div>
    </div>
  `;
}

// ─── REPUTATION BLOCK ─────────────────────────────────────────
function renderReputationBlock(reputation, rank, nextRank) {
  const el = document.getElementById('reputation-block');
  if (!el) return;

  const pct = nextRank
    ? Math.round(((reputation - rank.minScore) / (nextRank.minScore - rank.minScore)) * 100)
    : 100;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div>
        <div style="font-size:12px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Oracle Reputation</div>
        <div style="font-family:'Rajdhani',sans-serif;font-size:32px;font-weight:800;color:${rank.color};text-shadow:0 0 18px ${rank.glow};line-height:1;">
          ${reputation.toLocaleString()}
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Current Rank</div>
        <div style="font-size:18px;font-weight:800;letter-spacing:0.1em;color:${rank.color};text-shadow:0 0 14px ${rank.glow};">
          ${rank.icon} ${rank.name}
        </div>
      </div>
    </div>
    ${nextRank ? `
      <div style="margin-bottom:6px;display:flex;justify-content:space-between;font-size:12px;color:var(--muted);">
        <span>Progress to <span style="color:${nextRank.color};font-weight:700;">${nextRank.icon} ${nextRank.name}</span></span>
        <span style="color:${rank.color};">${pct}%</span>
      </div>
      <div style="background:rgba(255,255,255,0.06);border-radius:6px;height:8px;overflow:hidden;margin-bottom:6px;">
        <div style="height:100%;border-radius:6px;width:${pct}%;background:linear-gradient(90deg,${rank.bar},${nextRank.bar});transition:width 0.8s ease;box-shadow:0 0 8px ${rank.glow};"></div>
      </div>
      <div style="font-size:12px;color:var(--muted);">
        ${reputation.toLocaleString()} / ${nextRank.minScore.toLocaleString()} REP · need <strong style="color:var(--text);">${(nextRank.minScore - reputation).toLocaleString()}</strong> more
      </div>
    ` : `
      <div style="font-size:13px;color:${rank.color};text-shadow:0 0 10px ${rank.glow};font-weight:700;letter-spacing:0.08em;">
        ✦ MAX RANK ACHIEVED - ASCENDED
      </div>
    `}
  `;
}

// ─── RANK PROGRESS LIST ───────────────────────────────────────
function renderRankProgress(reputation) {
  const el = document.getElementById('title-progress-list');
  if (!el) return;

  el.innerHTML = RANKS.map(r => {
    const achieved = reputation >= r.minScore;
    const isCurrent = getRank(reputation) === r;
    const pct = r.minScore === 0 ? 100 : Math.min(100, Math.round((reputation / r.minScore) * 100));

    return `
      <div class="title-row" style="${isCurrent ? `border-left:2px solid ${r.color};padding-left:10px;margin-left:-12px;` : ''}">
        <div style="width:110px;font-size:13px;font-weight:700;color:${r.color};opacity:${achieved ? 1 : 0.45};
          ${achieved ? `text-shadow:0 0 8px ${r.glow};` : ''}">
          ${r.icon} ${r.name}
          ${isCurrent ? '<span style="font-size:11px;opacity:0.7;"> ← you</span>' : ''}
        </div>
        <div style="flex:1;">
          <div class="title-progress-bar" style="margin-bottom:3px;">
            <div class="title-progress-fill" style="width:${pct}%;background:${achieved ? r.bar : 'rgba(255,255,255,0.12)'};
              ${achieved ? `box-shadow:0 0 6px ${r.glow};` : ''}"></div>
          </div>
          <div style="font-size:11px;color:var(--muted);">
            ${r.minScore === 0 ? 'Starting rank' : r.minScore.toLocaleString() + ' REP'}
          </div>
        </div>
        <div style="font-size:12px;color:${r.color};opacity:${achieved ? 1 : 0.45};min-width:80px;text-align:right;">
          ${achieved ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;"><path d="M4.5 12.6 9.4 17.5 19.5 7.4"/></svg> ` : ''}${r.discountLabel}
        </div>
      </div>`;
  }).join('');
}

// Legacy - kept so old calls don't break
function renderTitleProgress(qCount, upvotes) {
  const approxScore = qCount * 40 + upvotes * 20;
  renderRankProgress(approxScore);
}

let currentHistoryTab = 'answers';

function switchHistoryTab(tab) {
  currentHistoryTab = tab;
  document.getElementById('history-tab-answers').classList.toggle('active', tab === 'answers');
  document.getElementById('history-tab-questions').classList.toggle('active', tab === 'questions');
  const msgTabEl = document.getElementById('history-tab-messages');
  if (msgTabEl) msgTabEl.classList.toggle('active', tab === 'messages');
  const drawTabEl = document.getElementById('history-tab-draw');
  if (drawTabEl) drawTabEl.classList.toggle('active', tab === 'draw');

  const address = globalWalletAddress;
  if (tab === 'draw') {
    renderHistoryTab('draw', [], []);
    return;
  }
  fetchQuestionStats(address).then(({ myQuestions, myAnswers }) => {
    renderHistoryTab(tab, myAnswers, myQuestions);
  });
}

function renderHistoryTab(tab, myAnswers, myQuestions) {
  const el = document.getElementById('profile-history-list');
  if (tab === 'draw') {
    el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:14px;">Loading Draw activity...</div>`;
    const WORKER_URL_LOCAL = typeof window.WORKER_URL !== 'undefined'
      ? window.WORKER_URL
      : 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
    fetch(`${WORKER_URL_LOCAL}/rep/draw?wallet=${globalWalletAddress}`)
      .then(r => r.ok ? r.json() : { total: 0, history: [] })
      .catch(() => ({ total: 0, history: [] }))
      .then(data => {
        const history = data.history || [];
        const total   = data.total   || 0;
        if (!history.length) {
          el.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:14px;padding:30px;">
            No Oracle Draw activity yet ·
            <a href="https://baydashaaa.github.io/oracle-draw/" target="_blank"
              style="color:var(--accent);text-decoration:none;">Mint your first NFT →</a>
          </div>`;
          return;
        }
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;
            padding:12px 16px;background:var(--surface2);border:1px solid var(--border);
            border-radius:10px;margin-bottom:12px;">
            <span style="font-size:14px;color:var(--muted);">Total Draw REP earned</span>
            <span style="font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:800;color:#ff8844;">
              +${total.toLocaleString()} REP
            </span>
          </div>
          ${history.map(h => {
            const src   = h.source || '';
            const tier  = src.includes('legendary') ? 'Legendary' : src.includes('rare') ? 'Rare' : 'Common';
            const pool  = src.toLowerCase().includes('weekly') ? 'Weekly' : 'Daily';
            const pts   = h.points || 0;
            const color = tier === 'Legendary' ? '#ffd700' : tier === 'Rare' ? '#a78bfa' : '#8aaccc';
            const date  = h.ts ? new Date(h.ts * 1000).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}) : '';
            const tokenId = src.split('_').pop() || '';
            return `<div class="history-item">
              <div class="history-item-meta">
                <span style="color:${color};"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;filter:drop-shadow(0 0 4px currentColor88);"><path d="M4.3 7.7c0-1.2 1-2.1 2.2-2 1.85.18 3.68.28 5.5.28s3.65-.1 5.5-.28c1.2-.1 2.2.8 2.2 2v3c0 4.45-3.45 8.05-7.7 8.05S4.3 15.15 4.3 10.7z"/><path d="M8.3 10.5c.85-.5 1.85-.5 2.7 0M13 10.5c.85-.5 1.85-.5 2.7 0"/></svg> ${tier} NFT</span>
                <span style="color:var(--muted);">${pool} Draw</span>
                ${date ? `<span style="color:var(--muted);">${date}</span>` : ''}
                ${tokenId ? `<span class="q-ref" style="font-family:monospace;">#${tokenId}</span>` : ''}
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
                <span style="font-size:14px;color:var(--muted);">
                  Minted · entered ${pool} Draw pool
                </span>
                <span style="font-size:15px;font-weight:700;color:#ff8844;">+${pts} REP</span>
              </div>
            </div>`;
          }).join('')}`;
      });
    return;
  }
  if (tab === 'messages') {
    el.innerHTML = `
      <div class="history-item">
        <div class="history-item-meta">
          <span style="color:var(--green);"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;filter:drop-shadow(0 0 4px currentColor88);"><rect x="3.5" y="4.8" width="17" height="11.8" rx="3"/><path d="M8.2 16.6v3.6l4.4-3.6"/><path d="M8.6 10.7h.01M12 10.7h.01M15.4 10.7h.01"/></svg> DAO Chat Activity</span>
          <span style="font-size:12px;color:var(--muted);">Last 7 days · on-chain</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;" id="chat-stats-grid">
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
            <div style="font-family:'Rajdhani',sans-serif;font-size:26px;font-weight:800;color:var(--green);">…</div>
            <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">Messages sent</div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
            <div style="font-family:'Rajdhani',sans-serif;font-size:26px;font-weight:800;color:#a78bfa;">…</div>
            <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">Free Weekly entries</div>
          </div>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;" id="chat-stats-days"></div>
        <div style="margin-top:14px;font-size:13px;color:var(--muted);line-height:1.6;">
          Every <strong style="color:var(--text)">10th message</strong> = 1 free Weekly Draw entry.
          Messages cost <strong style="color:var(--text)">5,000 LUNC</strong> each and go to the Protocol Treasury.
        </div>
      </div>`;
    // Async fill
    fetchChatStats(globalWalletAddress).then(stats => {
      const grid = document.getElementById('chat-stats-grid');
      if (!grid) return;
      grid.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
          <div style="font-family:'Rajdhani',sans-serif;font-size:26px;font-weight:800;color:var(--green);">${stats.msgCount}</div>
          <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">Messages sent</div>
        </div>
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
          <div style="font-family:'Rajdhani',sans-serif;font-size:26px;font-weight:800;color:#a78bfa;">${stats.entriesEarned}</div>
          <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">Free Weekly entries</div>
        </div>`;
      // Per-day breakdown
      const daysEl = document.getElementById('chat-stats-days');
      if (daysEl && Object.keys(stats.days).length) {
        const sorted = Object.entries(stats.days).sort((a,b) => b[0].localeCompare(a[0]));
        daysEl.innerHTML = sorted.map(([day, cnt]) => {
          const entries = Math.floor(cnt / 10);
          const label   = new Date(day).toLocaleDateString([], {month:'short',day:'numeric'});
          return `<div style="font-size:12px;padding:3px 10px;border-radius:20px;
            background:${entries > 0 ? 'rgba(30,200,100,0.1)' : 'rgba(255,255,255,0.04)'};
            border:1px solid ${entries > 0 ? 'rgba(30,200,100,0.3)' : 'var(--border)'};
            color:${entries > 0 ? '#4ade80' : 'var(--muted)'};">
            ${label}: ${cnt} msgs${entries > 0 ? ' · +'+entries+' entr'+(entries>1?'ies':'y') : ''}
          </div>`;
        }).join('');
      }
    });
    return;
  }
  if (tab === 'answers') {
    if (!myAnswers.length) { el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:14px;padding:30px;">No answers yet - go to the Board and share your knowledge!</div>'; return; }
    el.innerHTML = myAnswers.map(a => `
      <div class="history-item">
        <div class="history-item-meta">
          <span style="color:var(--accent);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;filter:drop-shadow(0 0 4px currentColor88);"><rect x="3.5" y="4.8" width="17" height="11.8" rx="3"/><path d="M8.2 16.6v3.6l4.4-3.6"/><path d="M8.6 10.7h.01M12 10.7h.01M15.4 10.7h.01"/></svg> Answer</span>
          <span>on question ${a.questionId}</span>
          ${a.votes >= 3 ? '<span style="color:var(--gold);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#E8C840" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;filter:drop-shadow(0 0 4px #E8C84088);"><path d="M12 3.6l2.55 5.2 5.75.84-4.15 4.05.98 5.71L12 16.7l-5.13 2.7.98-5.71L3.7 9.64l5.75-.84z"/></svg> Top Answer</span>' : ''}
        </div>
        <div class="history-item-text" style="font-size:13px;color:var(--muted);margin-bottom:6px;font-style:italic;">"${(a.questionText||'').slice(0,80)}..."</div>
        <div class="history-item-text">${a.text.slice(0,200)}${a.text.length > 200 ? '...' : ''}</div>
        <div class="history-item-votes"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;"><path d="M7 11.6v8.8H4.4A1.4 1.4 0 0 1 3 19v-6a1.4 1.4 0 0 1 1.4-1.4z"/><path d="M7 11.6 10.5 4.1a2.05 2.05 0 0 1 2.9 2.55l-.85 3.05h4.45a1.8 1.8 0 0 1 1.77 2.12l-.98 5.45a1.95 1.95 0 0 1-1.92 1.6H9.6a2.8 2.8 0 0 1-.9-.15L7 20.4z"/></svg> ${a.votes || 0} upvotes</div>
      </div>
    `).join('');
  } else {
    if (!myQuestions.length) { el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:14px;padding:30px;">No questions yet - ask the community something!</div>'; return; }
    el.innerHTML = myQuestions.map(q => `
      <div class="history-item">
        <div class="history-item-meta">
          <span style="color:var(--accent);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;filter:drop-shadow(0 0 4px currentColor88);"><path d="M9 9.1a3.05 3.05 0 115.75 1.4c-.62 1.02-1.85 1.42-2.35 2.35-.28.52-.4 1.05-.4 1.65"/><path d="M12 18.3h.01"/></svg> Question</span>
          <span>${q.category}</span>
          <span>${q.time}</span>
          <span class="q-ref">${q.id}</span>
        </div>
        <div class="history-item-text">${q.text.slice(0,200)}${q.text.length > 200 ? '...' : ''}</div>
        <div class="history-item-votes"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;"><path d="M7 11.6v8.8H4.4A1.4 1.4 0 0 1 3 19v-6a1.4 1.4 0 0 1 1.4-1.4z"/><path d="M7 11.6 10.5 4.1a2.05 2.05 0 0 1 2.9 2.55l-.85 3.05h4.45a1.8 1.8 0 0 1 1.77 2.12l-.98 5.45a1.95 1.95 0 0 1-1.92 1.6H9.6a2.8 2.8 0 0 1-.9-.15L7 20.4z"/></svg> ${q.votes || 0} votes · <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em;"><rect x="3.5" y="4.8" width="17" height="11.8" rx="3"/><path d="M8.2 16.6v3.6l4.4-3.6"/><path d="M8.6 10.7h.01M12 10.7h.01M15.4 10.7h.01"/></svg> ${q.answers?.length || 0} answers</div>
      </div>
    `).join('');
  }
}

// ─── EDIT PROFILE ─────────────────────────────────────────────
function toggleProfileEdit() {
  const form = document.getElementById('profile-edit-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function saveProfile() {
  // Profiles are fully anonymous — no nickname saving
}

// ─── AVATAR ───────────────────────────────────────────────────
function triggerAvatarUpload() {
  document.getElementById('avatar-upload').click();
}

function handleAvatarUpload(event) {
  // Disabled — fully anonymous
}

function removeAvatar() {
  // Disabled — fully anonymous
}

// ─── PATCH: показывать никнейм вместо Anonymous#xxxx ─────────
// Nickname теперь берётся из Worker через alias при POST /answer
// Override удалён - используется async submitAnswer из app.js

// ── Load profile from Worker when wallet connects ─────────────
// Hooks into setWalletConnected to fetch profile from server
const _profileWalletHook = window.setWalletConnected;
setTimeout(() => {
  if (typeof window.setWalletConnected === 'function') {
    const _prev = window.setWalletConnected;
    window.setWalletConnected = function(address) {
      _prev(address);
      // Load profile from Worker - updates localStorage then re-renders
      loadProfileFromWorker(address).then(data => {
        if (data) {
          if (typeof renderBoard === 'function') renderBoard();
          if (typeof renderChatMessages === 'function' && typeof cachedMsgs !== 'undefined') renderChatMessages(cachedMsgs);
        }
      });
    };
  }
}, 600);
