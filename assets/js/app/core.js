if (history.scrollRestoration) history.scrollRestoration = 'manual';
// ── Safe profile helpers (defined in profile.js, may load later) ──────────
function _getDisplayName(address, fallback) {
  // Fully anonymous - show only wallet address, no nicknames
  if (!address) return 'Anonymous';
  return address.slice(0, 8) + '...' + address.slice(-4);
}
function _getProfileAvatar(address) {
  // Fully anonymous - no avatars
  return null;
}


// Fast smooth scroll to top (300ms, ease-out)
function smoothScrollTop() {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile) {
    window.scrollTo(0, 0);
    return;
  }
  const start = window.scrollY;
  if (start === 0) return;
  const duration = 300;
  const startTime = performance.now();
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    window.scrollTo(0, start * (1 - easeOut(progress)));
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
window.addEventListener('load', () => { window.scrollTo(0, 0); });

// ─── ADMIN KEY ───────────────────────────────────────────────
const ADMIN_KEY = 'TerraOracle#9X4K-2025';

// ─── DEMO QUESTIONS ───────────────────────────────────────────
const DEMO_QUESTIONS = [
  {
    id: 'LUNC-A3F9K2B',
    alias: 'Anonymous#4471',
    isAdmin: false,
    title: '🌱 Seeker',
    category: '🗳️ Governance',
    text: 'What is the plan for USTC re-peg after the SDK 0.53 upgrade? Has any formal proposal been submitted to the governance forum yet?',
    tags: ['ustc','sdk053','governance'],
    time: '34 min ago',
    votes: 12,
    answers: [
      { alias: 'Anonymous#8821', isAdmin: false, title: '⚡ Oracle', text: 'No formal proposal yet, but several validators have discussed it in the bi-weekly call. The main blocker is liquidity depth - USTC needs at least $50M TVL before a peg mechanism is viable.', votes: 8, voted: false },
      { alias: 'Admin', isAdmin: true, title: null, text: 'This is being tracked. A governance discussion thread will be opened within the next 2 weeks following the SDK upgrade completion. Stay tuned to the official Terra Classic channels.', votes: 24, voted: false },
    ],
    voted: false,
    open: false,
    formOpen: false,
  },
  {
    id: 'LUNC-B7M2X1C',
    alias: 'Anonymous#2209',
    isAdmin: false,
    title: null,
    category: '⚙️ Validator Issue',
    text: 'Is there a minimum self-delegation requirement for validators after MM 2.0 activates? Some validators seem to be running with very low self-stake.',
    tags: ['validators','mm20','staking'],
    time: '2 hrs ago',
    votes: 7,
    answers: [],
    voted: false,
    open: false,
    formOpen: false,
  },
];

// ─── QUESTIONS STORAGE ───────────────────────────────────────
const WORKER_URL = 'https://terra-oracle-questions.vladislav-baydan.workers.dev';

// Каждое 10-е оплаченное сообщение в DAO Chat даёт бесплатную Weekly-entry.
const CHAT_MSGS_PER_ENTRY = 10;

// Обновляет полоску прогресса над полем ввода чата. total - общее число
// сообщений кошелька (из /chat/count). Если total не передан, тянет сам.
async function updateChatEntryProgress(total) {
  const box = document.getElementById('chat-entry-progress');
  if (!box) return;
  // Тот же паттерн адреса, что и во всём файле: globalWalletAddress (view-only
  // luncdash) имеет приоритет над connectedAddress (подключённый Keplr).
  const wallet = (typeof globalWalletAddress !== 'undefined' && globalWalletAddress)
    || (typeof connectedAddress !== 'undefined' && connectedAddress) || null;
  if (!wallet) { box.style.display = 'none'; return; }

  if (total === undefined || total === null) {
    try {
      const r = await fetch(`${WORKER_URL}/chat/count?wallet=${wallet}`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      total = (d && (d.total || d.msgCount)) || 0;
    } catch (e) { box.style.display = 'none'; return; }
  }

  const per      = CHAT_MSGS_PER_ENTRY;
  const inCycle  = total % per;            // сколько в текущем цикле
  const toNext   = per - inCycle;          // сколько осталось до entry
  const earned   = Math.floor(total / per);
  const cur = document.getElementById('chat-entry-cur');
  const goal = document.getElementById('chat-entry-goal');
  const fill = document.getElementById('chat-entry-fill');
  const earnedEl = document.getElementById('chat-entry-earned');
  if (cur)  cur.textContent  = inCycle;
  if (goal) goal.textContent = per;
  if (fill) fill.style.width = Math.round(inCycle / per * 100) + '%';
  if (earnedEl) {
    if (earned > 0) {
      earnedEl.style.display = 'block';
      earnedEl.textContent = earned + (earned === 1 ? ' free entry earned so far' : ' free entries earned so far')
        + ' \u00b7 ' + toNext + ' to go';
    } else {
      earnedEl.style.display = 'none';
    }
  }
  box.style.display = 'block';
}
window.updateChatEntryProgress = updateChatEntryProgress;

// ── Worker-based questions storage ───────────────────────────
// questions[] is the in-memory cache, synced from worker on load
let questions = [];
let _questionsLoaded = false;

async function loadQuestionsFromWorker() {
  try {
    const res = await fetch(`${WORKER_URL}/questions`);
    if (!res.ok) throw new Error('Worker error');
    const data = await res.json();
    questions = (data.questions || []).map(q => ({
      answers: [], votes: 0, voted: false, open: false, formOpen: false,
      tags: [],
      // Generate time from createdAt if not present
      time: q.time || (q.createdAt ? (() => { const d = new Date(q.createdAt * 1000); return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear(); })() : 'unknown'),
      ...q,
    }));
    // Restore voted state - from worker data (wallet-based) + localStorage fallback
    const votedQ  = JSON.parse(localStorage.getItem('voted_questions') || '{}');
    const votedA  = JSON.parse(localStorage.getItem('voted_answers') || '{}');
    for (const q of questions) {
      // Check if wallet already voted this question (on-chain in voters array)
      if (votedQ[q.id]) q.voted = true;
      if ((globalWalletAddress || connectedAddress) && q.voters && q.voters.includes(globalWalletAddress || connectedAddress)) q.voted = true;
      for (const a of q.answers) {
        if (votedA[a.id]) a.voted = true;
        if ((globalWalletAddress || connectedAddress) && a.voters && a.voters.includes(globalWalletAddress || connectedAddress)) a.voted = true;
      }
      // Restore poll vote
      if (q.poll && q.pollVoters && globalWalletAddress && q.pollVoters.includes(globalWalletAddress)) {
        const votedPollKey = 'poll_vote_' + q.id;
        const savedOpt = localStorage.getItem(votedPollKey);
        q.myPollVote = savedOpt !== null ? parseInt(savedOpt) : null;
      }
    }
    _questionsLoaded = true;
    // Build score map for rank badges
    if (typeof buildScoreMap === 'function') window._walletScores = buildScoreMap(questions);
    // buildScoreMap sees only questions.json, so it just overwrote the full
    // figures. Put them back before painting, then refresh them in background.
    if (typeof applyWalletScores === 'function') applyWalletScores();
    renderBoard();
    if (typeof upgradeWalletScores === 'function') upgradeWalletScores();
    // Prefetch profiles for question/answer authors (background, no re-render)
    if (typeof prefetchProfiles === 'function') {
      const addrs = [];
      for (const q of questions) {
        if (q.wallet) addrs.push(q.wallet);
        for (const a of q.answers || []) { if (a.wallet) addrs.push(a.wallet); }
      }
      prefetchProfiles(addrs); // fire-and-forget, no .then()
    }
  } catch(e) {
    console.warn('Failed to load questions from worker:', e.message);
    questions = [];
    _questionsLoaded = true;
    renderBoard();
  }
}

// saveQuestions - no-op, worker handles persistence
function saveQuestions(qs) { questions = qs; }
let boardFilter = 'all';
let boardSort = 'new';

// Load questions from worker on startup
loadQuestionsFromWorker();
let boardSearch = '';

// ─── WALLET SESSION RESTORE ───────────────────────────────────
async function restoreWalletSession() {
  const saved = loadWalletSession();
  if (!saved) return;
  // Only Keplr supports silent session restore here. For Galaxy/Station we skip
  // auto-restore (user reconnects via the header) to avoid popping the wrong wallet.
  if (getActiveProvider() !== 'keplr') return;
  let attempts = 0;
  while (!window.keplr && attempts < 30) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }
  if (!window.keplr) return;

  // Несколько попыток: расширение может быть ещё не готово, а узел -
  // ответить не с первого раза.
  for (let i = 0; i < 3; i++) {
    try {
      await window.keplr.enable('columbus-5');
      const signer = window.keplr.getOfflineSigner('columbus-5');
      const accounts = await signer.getAccounts();
      const addr = accounts[0] && accounts[0].address;
      if (!addr) throw new Error('no account');

      // Адрес сменился - значит в Keplr выбран другой счёт. Раньше здесь
      // стоял clearWalletSession(): человек переключал аккаунт и оказывался
      // отключённым. Переходим на новый адрес, это и есть его намерение.
      if (addr !== saved) console.log('[wallet] аккаунт сменился:', saved, '→', addr);

      window.__oaRestoring = true;
      setWalletConnected(addr);
      window.__oaRestoring = false;
      saveWalletSession(addr);   // продлеваем срок при каждом заходе
      return;
    } catch (e) {
      if (i < 2) { await new Promise(r => setTimeout(r, 600)); continue; }
      // СЕССИЮ НЕ СТИРАЕМ. Раньше здесь был clearWalletSession(), и любая
      // ошибка - запертый кошелёк, закрытый попап, недоступный узел -
      // выкидывала пользователя насовсем. Оставляем как есть: следующая
      // загрузка или клик по кнопке подключат без потери состояния.
      console.log('[wallet] восстановить сессию не удалось, сессия сохранена:', e && e.message);
    }
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreWalletSession);
} else {
  restoreWalletSession();
}

// Keplr шлёт это событие при смене аккаунта и после разблокировки. Раньше
// обработчика не было вовсе, и сайт оставался с прежним адресом до
// перезагрузки страницы - вплоть до отправки транзакции не с того кошелька.
window.addEventListener('keplr_keystorechange', function () {
  if (typeof getActiveProvider === 'function' && getActiveProvider() !== 'keplr') return;
  if (!loadWalletSession()) return;   // не подключены - навязываться не надо
  restoreWalletSession();
});

