// ── HTML escape (для сообщений, вставляемых через innerHTML) ────────────────
function escHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

// Core endpoints + bag-cache config - declared FIRST, before any function
// that might reference them during early init (setConnectedWallet →
// renderMyBag can fire before later declarations execute, which threw
// "Cannot access 'BAG_CACHE_MAX_AGE_MS' before initialization"). Kept here at
// the very top so they're always initialized before any use.
const DRAW_WORKER       = 'https://oracle-draw.vladislav-baydan.workers.dev';
const BAG_CACHE_KEY     = 'oracle_draw_bag_cache_v1';
const BAG_CACHE_TTL_MS  = 5 * 60 * 1000;
const BAG_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

// Доли розыгрыша. Были рассыпаны литералами по семи местам, поэтому смена
// сплита требовала найти каждое. Воркер держит свою копию в
// DRAW_PRIZE_SHARE (oracle-draw-worker/src/worker.js) - меняешь здесь,
// меняй и там.
const PRIZE_SHARE  = 0.80;                // победителю; остальное seed + казна
const WEEKLY_SPLIT = [0.60, 0.25, 0.15];  // три места Weekly внутри PRIZE_SHARE

// Format NFT tokenId to a human-readable label.
// Contract tokens are "common-1" / "rare-7" / "legendary-2" → "Common #1" etc.
// Legacy Paco ids (Common_092528042026_ETME5) → their trailing code.
function formatNFTLabel(tokenId) {
  if (!tokenId) return '-';
  const str = String(tokenId);
  // Contract ids: common-1 → "Common #1"
  const m = str.match(/^(common|rare|legendary)-(\d+)$/i);
  if (m) {
    const tier = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    return `${tier} #${m[2]}`;
  }
  // Legacy Paco ids: Common_092528042026_ETME5 → ETME5
  const parts = str.split('_');
  if (parts.length >= 3) return parts[parts.length - 1];
  return str.slice(0, 8);
}

// ── TAB NAVIGATION ────────────────────────────────────────────────────────────
function showTab(tab, skipHistory) {
  const tabs = ['home','draw','winners','verify','bag'];
  tabs.forEach(t => {
    const page = document.getElementById('page-' + t);
    const nav  = document.getElementById('nav-' + t);
    if (page) page.style.display = t === tab ? 'block' : 'none';
    if (nav)  nav.classList.toggle('active-tab', t === tab);
  });

  if (tab === 'bag') renderMyBag();

  if (tab === 'home') {
    const hDraws = document.getElementById('home-stat-draws');
    const hNfts  = document.getElementById('home-stat-nfts');
    if (hDraws) hDraws.textContent = winnersData.filter(function(w){ return w.winner || (w.winners && w.winners.length > 0); }).length;
    // Use cached all-time activation count if available
    if (hNfts && window._totalNFTsActivated !== undefined) {
      hNfts.textContent = window._totalNFTsActivated;
    }
  }

  if (tab === 'draw') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Re-init wheel if canvas wasn't ready on first load
        switchLottery(window.currentLottery || 'daily');
      });
    });
  }

  // Push to browser history so Back button works.
  // location.search сохраняется намеренно: без него переключение вкладки
  // стирало любые параметры из адреса, и глубокие ссылки с ключами
  // (например ?revealtest=1) переставали работать сразу после загрузки.
  if (!skipHistory && history.pushState) {
    history.pushState({ tab }, '', '/' + tab + location.search);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Handle browser Back/Forward
window.addEventListener('popstate', function(e) {
  const path = location.pathname.replace(/^\//, '') || 'home';
  const tab = (e.state && e.state.tab) || path;
  const validTabs = ['home','draw','winners','verify','bag'];
  showTab(validTabs.includes(tab) ? tab : 'home', true);
});

// Пулы - смарт-контракты, а не кошельки (переезд 31 авг 2026). Приз считает
// контракт: pot = min(записанные входы + carry, баланс). Баланс сам по себе
// призом больше не является: излишек на нём войдёт в пот следующих раундов
// через carry, а не сразу.
const DAILY_WALLET   = 'terra1d9ga3dzhg63v6rmm8ahts55ekjpwlm6dusw5cwhpt60s6t0actqqsul6tm';
const WEEKLY_WALLET  = 'terra19w39c3qz6kc756hap92x374reptah9kp5825f5c67hmquy383r5qd7dmd8';
const POOL_CONTRACTS = { daily: DAILY_WALLET, weekly: WEEKLY_WALLET };

// Приз раунда - это pot контракта: min(записанные входы + carry, баланс).
// Баланс сам по себе призом больше не является, поэтому страница спрашивает
// pot. Фолбэк на баланс - на случай, если узел не ответил на smart-запрос.
async function getPoolAmount(pool) {
  const addr = POOL_CONTRACTS[pool] || '';
  if (!addr) return 0;
  try {
    const q = btoa('{"pot":{}}');
    const res = await fetch(
      `https://terra-classic-lcd.publicnode.com/cosmwasm/wasm/v1/contract/${addr}/smart/${q}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return getWalletBalance(addr);
    const d = (await res.json()).data || {};
    const sum = BigInt(d.pending || '0') + BigInt(d.carry || '0');
    const bal = BigInt(d.balance || '0');
    return Math.floor(Number(sum < bal ? sum : bal) / 1e6);
  } catch (e) {
    return getWalletBalance(addr);
  }
}
const BURN_WALLET    = 'terra16m05j95p9qvq93cdtchjcpwgvny8f57vzdj06p';
const DEV_WALLET     = 'terra17g55uzkm6cr5fcl3vzcrmu73v8as4yvf2kktzr';
const CHAIN_ID       = 'columbus-5';
const LUNC_PER_TICKET = 25000;

// ── Free entries from Terra Oracle (GitHub JSON) ─────────────────────────────
// Free entries are computed on-chain  no static JSON needed
let freeEntriesData = {}; // { "terra1abc": { chat:1, questions:2, total:3 } }

const ORACLE_TREASURY = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt';
const CHAT_ULUNA_FE   = 5000 * 1e6;
const QA_ULUNA_FE     = 100000 * 1e6; // 100k LUNC to Treasury (half of Q&A payment)
const TOLERANCE_FE    = 0.01;
const FCD_NODES_FE    = [
  'https://fcd.terra-classic.hexxagon.io',
  'https://terra-classic-fcd.publicnode.com',
];

async function loadFreeEntries() {
  // Read pre-computed free-entries.json (updated hourly by GitHub Actions)
  // This is more reliable than browser scraping and covers full history
  try {
    const res = await fetch('./free-entries.json?t=' + Math.floor(Date.now() / 3600000), {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const entries = data.entries || {};

    freeEntriesData = {};
    for (const [wallet, info] of Object.entries(entries)) {
      const total = (info.total || 0);
      if (total > 0) {
        freeEntriesData[wallet] = {
          chat:      info.chat      || 0,
          questions: info.questions || 0,
          total,
        };
      }
    }
    console.log('[OracleDraw] Free entries loaded from JSON:', Object.keys(freeEntriesData).length, 'wallets');
  } catch(e) {
    console.warn('[OracleDraw] Could not load free-entries.json, falling back to on-chain scan:', e.message);
    // Fallback: on-chain scrape with 30 day window
    await loadFreeEntriesOnChain();
  }
}

// Fallback: scrape on-chain if JSON not available
// Start of the current weekly draw round (Mon 20:00 UTC) - mirrors the worker's
// getCurrentRoundId('weekly') so free entries reset when the weekly draw rolls over.
function weeklyRoundStartSec() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0, 0));
  const diffToMon = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMon);
  if (now.getTime() < d.getTime()) d.setUTCDate(d.getUTCDate() - 7);
  return Math.floor(d.getTime() / 1000);
}

async function loadFreeEntriesOnChain() {
  // Window = current weekly round (Mon 20:00 UTC → now), NOT a rolling 30 days,
  // so free entries clear after each weekly draw and are never double-counted.
  const cutoff = weeklyRoundStartSec();
  const days = {};
  const qa   = {};

  for (const base of FCD_NODES_FE) {
    try {
      let offset = 0, done = false;
      while (!done) {
        const url = `${base}/v1/txs?account=${ORACLE_TREASURY}&limit=100&offset=${offset}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) break;
        const data = await res.json();
        const txs = data.txs || [];
        if (!txs.length) break;

        for (const tx of txs) {
          const ts = Math.floor(new Date(tx.timestamp).getTime() / 1000);
          if (ts < cutoff) { done = true; break; }
          const memo = tx.tx?.value?.memo || tx.tx?.body?.memo || '';
          const msgs = tx.tx?.value?.msg  || tx.tx?.body?.messages || [];
          for (const msg of msgs) {
            const type = msg['@type'] || msg.type || '';
            if (!type.includes('MsgSend')) continue;
            const val  = msg.value || msg;
            if ((val.to_address || '') !== ORACLE_TREASURY) continue;
            const sender = val.from_address || '';
            const coins  = val.amount || [];
            const lunc   = coins.find(c => c.denom === 'uluna');
            if (!lunc) continue;
            const amt = Number(lunc.amount);
            if (memo.trim().length > 0 && amt >= CHAT_ULUNA_FE * 0.99 && amt <= CHAT_ULUNA_FE * 1.01) {
              const day = new Date(tx.timestamp).toISOString().slice(0, 10);
              if (!days[sender]) days[sender] = {};
              days[sender][day] = (days[sender][day] || 0) + 1;
            }
            if (amt >= QA_ULUNA_FE * 0.99 && amt <= QA_ULUNA_FE * 1.01) {
              qa[sender] = (qa[sender] || 0) + 1;
            }
          }
        }
        if (txs.length < 100) break;
        offset += 100;
      }
      break;
    } catch(e) { continue; }
  }

  freeEntriesData = {};
  const allWallets = new Set([...Object.keys(days), ...Object.keys(qa)]);
  for (const wallet of allWallets) {
    let chatEntries = 0;
    if (days[wallet]) {
      for (const cnt of Object.values(days[wallet])) {
        chatEntries += Math.min(Math.floor(cnt / 10), 2);
      }
    }
    const qaEntries = (qa[wallet] || 0) * 2;
    const total = chatEntries + qaEntries;
    if (total > 0) freeEntriesData[wallet] = { chat: chatEntries, questions: qaEntries, total };
  }
  console.log('[OracleDraw] Free entries loaded on-chain (fallback):', Object.keys(freeEntriesData).length, 'wallets');
}


function getFreeEntries(wallet) {
  return freeEntriesData[wallet] || { chat: 0, questions: 0, total: 0 };
}
// Пороги розыгрыша живут в контракте (min_entries, min_pot) и меняются одной
// транзакцией. Константа ниже - только запасное значение, пока конфиг не
// загружен: раньше 5 входов и 500 000 LUNC были зашиты в код и разошлись с
// реальностью в первый же контрактный раунд.
const MIN_TICKETS    = 1; // фолбэк, реальное значение приходит из контракта
window.POOL_LIMITS   = window.POOL_LIMITS || {};

async function loadPoolLimits() {
  const q = btoa('{"config":{}}');
  await Promise.all(Object.entries(POOL_CONTRACTS).map(async ([pool, addr]) => {
    try {
      const res = await fetch(
        `https://terra-classic-lcd.publicnode.com/cosmwasm/wasm/v1/contract/${addr}/smart/${q}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return;
      const d = (await res.json()).data || {};
      window.POOL_LIMITS[pool] = {
        minEntries: Number(d.min_entries || 0),
        minPot:     Math.floor(Number(d.min_pot || 0) / 1e6),
        payoutBps:  d.payout_bps || [],
      };
    } catch (e) { /* остаёмся на фолбэке */ }
  }));
  return window.POOL_LIMITS;
}

/** Минимум входов для розыгрыша в этом пуле. */
function poolMinEntries(pool) {
  const v = (window.POOL_LIMITS[pool] || {}).minEntries;
  return Number.isFinite(v) ? v : MIN_TICKETS;
}

/** Минимальный пот в LUNC. Ноль означает, что порога нет вовсе. */
function poolMinPot(pool) {
  const v = (window.POOL_LIMITS[pool] || {}).minPot;
  return Number.isFinite(v) ? v : 0;
}
const LCD_NODES      = [
  'https://terra-classic-fcd.publicnode.com',
  'https://fcd.terra-classic.hexxagon.io',
  'https://terra-classic-lcd.publicnode.com',
];
const RPC_NODES      = [
  'https://terra-classic-rpc.publicnode.com',
  'https://rpc.terra-classic.io',
];

// ─── STATE ──────────────────────────────────────────────────────────────────
let currentLottery = 'daily';
window.currentLottery = currentLottery; // 'daily' | 'weekly'
// selectedTier and selectedPool are defined in index.html  do not redeclare here
let lotteryAddress = null;
let ticketCount = 1;
let luncPrice = 0;
let ustcPrice = 0;
let dailyTickets = [];   // array of {address, txhash, time}
let weeklyTickets = [];
let winnersData = [];    // flat array loaded from winners.json (daily + weekly combined)
let winnersFilter = 'all';
let timerInterval = null;

// ─── PARTICLES ──────────────────────────────────────────────────────────────
const container = document.getElementById('particles');
for (let i = 0; i < 30; i++) {
  const p = document.createElement('div');
  p.className = 'particle';
  p.style.left = Math.random() * 100 + '%';
  p.style.animationDuration = (8 + Math.random() * 15) + 's';
  p.style.animationDelay = (Math.random() * 10) + 's';
  p.style.width = p.style.height = (1 + Math.random() * 2) + 'px';
  container.appendChild(p);
}

// ─── FORMAT HELPERS ─────────────────────────────────────────────────────────
function fmt(n) {
  if (n >= 1e9)  return (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n/1e6).toFixed(2) + 'M';
  if (n >= 1000) return (n/1000).toFixed(1) + 'K';
  return Math.round(n).toLocaleString('en-US');
}
function fmtAddr(a) { return a ? a.slice(0,10) + '...' + a.slice(-4) : ''; }
function fmtDate(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}
