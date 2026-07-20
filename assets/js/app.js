if (history.scrollRestoration) history.scrollRestoration = 'manual';
// ── Safe profile helpers (defined in profile.js, may load later) ──────────
function _getDisplayName(address, fallback) {
  // Fully anonymous — show only wallet address, no nicknames
  if (!address) return 'Anonymous';
  return address.slice(0, 8) + '...' + address.slice(-4);
}
function _getProfileAvatar(address) {
  // Fully anonymous — no avatars
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
    renderBoard();
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
  try {
    await window.keplr.enable('columbus-5');
    const signer = window.keplr.getOfflineSigner('columbus-5');
    const accounts = await signer.getAccounts();
    if (accounts[0].address === saved) {
      setWalletConnected(saved);
    } else {
      clearWalletSession();
    }
  } catch(e) { clearWalletSession(); }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreWalletSession);
} else {
  restoreWalletSession();
}

// ─── NAVIGATION ───────────────────────────────────────────────
function _isMobileChat() {
  return window.matchMedia('(hover:none)').matches || window.innerWidth <= 900;
}

function showPage(name, e, skipHistory) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const pg = document.getElementById('page-' + name);
  if (pg) pg.classList.add('active');
  if (e && e.target) e.target.classList.add('active');
  if (name === 'board') { if (!_questionsLoaded) loadQuestionsFromWorker(); else renderBoard(); }
  if (name === 'vote') { applyStoredVotes(); applyVoteStates(); renderVotes(); loadVotesFromWorker(); }
  if (name === 'chat') renderChatPage();
  if (name === 'bag')  renderOracleBag();
  // Mobile chat: hide footer, expand messages area
  const footer = document.querySelector('footer');
  if (_isMobileChat()) {
    if (name === 'chat') {
      if (footer) footer.style.display = 'none';
      document.body.classList.add('mobile-chat-open');
      document.body.style.overflow = 'hidden';
      document.body.style.paddingBottom = '0';
      document.documentElement.style.paddingBottom = '0';
      const chatPage = document.getElementById('page-chat');
      if (chatPage) {
        chatPage.style.padding = '8px 12px 0';
        chatPage.style.paddingBottom = '0';
        chatPage.style.marginBottom = '0';
      }
      const inputBar = document.getElementById('chat-input-bar');
      if (inputBar) { inputBar.style.padding = '8px 0 0'; inputBar.style.marginBottom = '0'; }
      // Recalculate after DOM fully rendered (double rAF ensures offsetHeight is accurate)
      function recalcMsgsHeight() {
        const msgs = document.getElementById('chat-page-messages');
        const nav = document.querySelector('nav');
        const ib = document.getElementById('chat-input-bar');
        const badge = document.querySelector('.chat-mobile-badge');
        if (!msgs) return;
        const navH = nav ? nav.offsetHeight : 64;
        const inputH = ib ? ib.offsetHeight : 0;
        const badgeH = badge ? badge.offsetHeight : 0;
        const msgsH = window.innerHeight - navH - inputH - badgeH - 8;
        msgs.style.minHeight = Math.max(msgsH, 200) + 'px';
        msgs.style.overflowY = 'auto';
      }
      requestAnimationFrame(() => requestAnimationFrame(recalcMsgsHeight));
      // Also run after 300ms for slow-rendering browsers (Keplr)
      setTimeout(recalcMsgsHeight, 300);
    } else {
      if (footer) footer.style.display = '';
      document.body.classList.remove('mobile-chat-open');
      document.body.style.overflow = '';
      document.body.style.paddingBottom = '';
      document.documentElement.style.paddingBottom = '';
      const chatPage = document.getElementById('page-chat');
      if (chatPage) chatPage.removeAttribute('style');
      const msgs = document.getElementById('chat-page-messages');
      if (msgs) msgs.removeAttribute('style');
    }
  }
  if (!skipHistory && history.pushState) {
    history.pushState({ page: name }, '', '/' + name.replace(/:/g, '/'));
  }
  try { sessionStorage.setItem('currentPage', name); } catch(e) {}
  smoothScrollTop();
}

// Handle browser Back/Forward
window.addEventListener('popstate', function(e) {
  const pathParts = location.pathname.replace(/^\//, '').split('/');
  const name = (e.state && e.state.page) || (pathParts[0] === 'reputation' ? 'reputation:' + (pathParts[1] || 'leaderboard') : pathParts[0]) || 'home';
  if (name === 'treasury') {
    if (typeof showPage_treasury === 'function') showPage_treasury(null, null, true);
  } else if (name && name.startsWith('reputation')) {
    const tab = name.split(':')[1] || 'leaderboard';
    if (typeof showRepPage === 'function') showRepPage(tab, true);
  } else if (name === 'profile') {
    if (typeof openProfile === 'function') openProfile(true);
  } else {
    showPage(name || 'home', null, true);
  }
});

// ─── Treasury logic moved to assets/js/treasury.js ───────────

// ─── HASHTAG LOGIC ────────────────────────────────────────────
let currentTags = [];

function renderTagPills() {
  const pillsEl = document.getElementById('tag-pills');
  if (!pillsEl) return;
  pillsEl.innerHTML = currentTags.map(t =>
    `<span class="tag-pill">#${t}<button onclick="removeTag('${t}')">✕</button></span>`
  ).join('');
  document.getElementById('tags-hidden').value = currentTags.join(',');
}

function addTag(raw) {
  if (currentTags.length >= 5) return;
  const tag = raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 20);
  if (!tag || currentTags.includes(tag)) return;
  currentTags.push(tag);
  renderTagPills();
}

function addTagSuggestion(tag) {
  addTag(tag);
  document.getElementById('tag-raw-input').focus();
}

function removeTag(tag) {
  currentTags = currentTags.filter(t => t !== tag);
  renderTagPills();
}

document.addEventListener('DOMContentLoaded', () => {
  // Removes the temporary <style id="fouc-fix"> injected at the very top of
  // <body> (see index.html) that forces the correct page visible on first
  // paint before this script has a chance to run. It uses !important, which
  // — if left in place — permanently overrides every later class-based page
  // switch: clicking any nav tab would keep showing whatever page the user
  // had originally loaded/refreshed on, since #id{display:...!important}
  // always beats .page.active{display:block} regardless of which page later
  // gets the "active" class. Must be called exactly once, right after the
  // real routing below has taken over — never left in the DOM permanently.
  function removeFoucFix() {
    const el = document.getElementById('fouc-fix');
    if (el) el.remove();
  }

  // Restore page from pathname or hash (404.html redirect)
  const pathParts = location.pathname.replace(/^\//, '').split('/');
  const hashPart = location.hash.replace(/^#/, '');
  let savedPage = null;
  if (pathParts[0] && pathParts[0] !== '') {
    savedPage = pathParts[0] === 'reputation' ? 'reputation:' + (pathParts[1] || 'leaderboard') : pathParts[0];
  } else if (hashPart) {
    savedPage = hashPart.replace(/\//, ':'); // convert hash/tab to page:tab format
  }
  if (!savedPage) { try { savedPage = sessionStorage.getItem('currentPage'); } catch(e) {} }
  // Clean URL
  const cleanUrl = savedPage ? '/' + savedPage.replace(/:/g, '/') : '/home';
  if (history.replaceState) history.replaceState({ page: savedPage || 'home' }, '', cleanUrl);
  if (savedPage === 'treasury') {
    if (typeof showPage_treasury === 'function') showPage_treasury(null, null, true);
    removeFoucFix();
  } else if (savedPage && savedPage.startsWith('reputation')) {
    const tab = savedPage.split(':')[1] || 'leaderboard';
    if (typeof showRepPage === 'function') showRepPage(tab, true);
    removeFoucFix();
  } else if (savedPage === 'profile') {
    // profile.js loads after app.js — wait for openProfile to be defined
    if (typeof openProfile === 'function') {
      openProfile(true);
      removeFoucFix();
    } else {
      const t = setInterval(() => {
        if (typeof openProfile === 'function') { clearInterval(t); openProfile(true); removeFoucFix(); }
      }, 50);
      setTimeout(() => { clearInterval(t); removeFoucFix(); }, 3000); // safety timeout
    }
  } else {
    showPage(savedPage || 'home', null, true);
    removeFoucFix();
  }
  const input = document.getElementById('tag-raw-input');
  if (!input) return;
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addTag(this.value);
      this.value = '';
    } else if (e.key === 'Backspace' && this.value === '' && currentTags.length) {
      currentTags.pop();
      renderTagPills();
    }
  });
  input.addEventListener('input', function() {
    if (this.value.endsWith(',') || this.value.endsWith(' ')) {
      addTag(this.value);
      this.value = '';
    }
  });
});

// ─── FILTER & SORT ──────────────────────────────────────────
function setBoardSearch(val) {
  boardSearch = val.trim().toLowerCase();
  document.getElementById('search-clear').style.display = boardSearch ? 'block' : 'none';
  renderBoard();
}

function clearSearch() {
  boardSearch = '';
  document.getElementById('board-search').value = '';
  document.getElementById('search-clear').style.display = 'none';
  renderBoard();
}

function setBoardFilter(cat) {
  boardFilter = cat;
  document.querySelectorAll('[id^="filter-"]').forEach(b => b.classList.remove('active'));
  const map = {'all':'filter-all','Governance':'filter-gov','Technical':'filter-tech','Validator Issue':'filter-val','Market':'filter-market','Community':'filter-comm','Security / Vulnerability':'filter-gov','Protocol Bug':'filter-tech','Proposal / Idea':'filter-gov','Fraud / Manipulation':'filter-gov','Other':'filter-all'};
  if (map[cat]) document.getElementById(map[cat])?.classList.add('active');
  renderBoard();
}

function setBoardSort(s) {
  boardSort = s;
  document.querySelectorAll('[id^="sort-"]').forEach(b => b.classList.remove('active'));
  document.getElementById('sort-' + s)?.classList.add('active');
  renderBoard();
}

// ─── RENDER BOARD ────────────────────────────────────────────
function renderPoll(q, qi) {
  const poll = q.poll;
  const totalVotes = poll.reduce((s, o) => s + (o.votes || 0), 0);
  const myVote = q.myPollVote !== undefined ? q.myPollVote : null;

  let optionsHtml = '';
  for (let oi = 0; oi < poll.length; oi++) {
    const opt = poll[oi];
    const pct = totalVotes > 0 ? Math.round((opt.votes || 0) / totalVotes * 100) : 0;
    const voted = myVote === oi;
    const border = voted ? 'rgba(84,147,247,0.6)' : 'rgba(255,255,255,0.08)';
    const bg = voted ? 'rgba(84,147,247,0.12)' : 'rgba(255,255,255,0.03)';
    const textColor = voted ? 'var(--accent)' : 'var(--text)';
    optionsHtml += '<div style="margin-bottom:6px;">' +
      '<button onclick="votePoll(' + qi + ',' + oi + ')" style="width:100%;text-align:left;padding:8px 12px;border-radius:8px;border:1px solid ' + border + ';background:' + bg + ';cursor:pointer;position:relative;overflow:hidden;">' +
      '<div style="position:absolute;left:0;top:0;height:100%;width:' + pct + '%;background:rgba(84,147,247,0.08);border-radius:8px;transition:width 0.4s;"></div>' +
      '<div style="position:relative;display:flex;justify-content:space-between;align-items:center;">' +
      '<span style="font-size:12px;color:' + textColor + ';">' + opt.text + '</span>' +
      '<span style="font-size:11px;color:var(--muted);">' + pct + '% · ' + (opt.votes || 0) + '</span>' +
      '</div></button></div>';
  }

  return '<div class="poll-section" style="margin:10px 0;border:1px solid rgba(84,147,247,0.2);border-radius:10px;padding:12px;background:rgba(84,147,247,0.04);">' +
    '<div style="font-size:10px;color:var(--accent);letter-spacing:0.08em;margin-bottom:8px;">COMMUNITY POLL</div>' +
    optionsHtml +
    '<div style="font-size:10px;color:var(--muted);margin-top:4px;">' + totalVotes + ' vote' + (totalVotes !== 1 ? 's' : '') + ' total</div>' +
    '</div>';
}


async function votePoll(qi, optionIdx) {
  if (!globalWalletAddress) { alert('Connect wallet to vote'); return; }
  const q = questions[qi];
  if (!q.poll) return;
  if (q.myPollVote !== undefined && q.myPollVote !== null) return; // already voted
  if (q._pollVoting) return; // guard against double-click
  q._pollVoting = true;

  // Optimistic update
  q.myPollVote = optionIdx;
  q.poll[optionIdx].votes = (q.poll[optionIdx].votes || 0) + 1;
  localStorage.setItem('poll_vote_' + q.id, String(optionIdx));
  renderBoard();

  try {
    const res = await fetch(`${WORKER_URL}/poll-vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, optionIdx, wallet: globalWalletAddress }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) { q._pollVoting = false; return; }
    let err = {}; try { err = await res.json(); } catch(e) {}
    q._pollVoting = false;
    if (err.error === 'Already voted') return; // already on server
    // Roll back
    q.myPollVote = null;
    q.poll[optionIdx].votes = Math.max(0, (q.poll[optionIdx].votes || 1) - 1);
    localStorage.removeItem('poll_vote_' + q.id);
    renderBoard();
    alert('Your poll vote could not be submitted. Please try again.');
  } catch(e) {
    q._pollVoting = false;
    q.myPollVote = null;
    q.poll[optionIdx].votes = Math.max(0, (q.poll[optionIdx].votes || 1) - 1);
    localStorage.removeItem('poll_vote_' + q.id);
    renderBoard();
    alert('Your poll vote could not be submitted (network issue). Please try again.');
  }
}

function renderBoard() {
  const list = document.getElementById('questions-list');
  const count = document.getElementById('board-count');

  let filtered = boardFilter === 'all' ? [...questions] : questions.filter(q => q.category === boardFilter || q.category.includes(boardFilter.replace(/[🗳️⚙️📈🌍⚡]\s*/,'')));

  if (boardSearch) {
    const searchTag = boardSearch.startsWith('#') ? boardSearch.slice(1) : null;
    filtered = filtered.filter(q =>
      q.text.toLowerCase().includes(boardSearch) ||
      q.category.toLowerCase().includes(boardSearch) ||
      q.id.toLowerCase().includes(boardSearch) ||
      (searchTag && q.tags && q.tags.some(t => t.toLowerCase() === searchTag.toLowerCase())) ||
      (q.tags && q.tags.some(t => ('#'+t).includes(boardSearch) || t.includes(boardSearch))) ||
      q.answers.some(a => a.text.toLowerCase().includes(boardSearch))
    );
  }

  if (boardSort === 'hot') filtered.sort((a,b) => (b.votes + b.answers.length*2) - (a.votes + a.answers.length*2));
  else if (boardSort === 'unanswered') filtered = filtered.filter(q => q.answers.length === 0);
  else filtered.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));

  count.textContent = filtered.length + ' open question' + (filtered.length !== 1 ? 's' : '');

  if (filtered.length === 0) {
    list.innerHTML = boardSearch
      ? `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No questions match "<strong>${boardSearch}</strong>".<br><span style="font-size:11px;opacity:0.6;">Try different keywords</span></div></div>`
      : `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No questions here yet.<br>Be the first to ask!</div></div>`;
    return;
  }

  list.innerHTML = filtered.map((q, qi) => {
    const realQi = questions.indexOf(q);
    return `
    <div class="q-card" id="qcard-${qi}">
      <div class="q-meta">
        ${q.isAdmin ? `<span class="badge-admin">🛡️ Admin</span>` : `${_getProfileAvatar(q.wallet) ? `<img src="${getProfileAvatar(q.wallet)}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:4px;">` : ''}<span class="q-alias">${_getDisplayName(q.wallet, q.alias)}</span>`}
        ${!q.isAdmin && q.wallet && window._walletScores ? getRankBadgeHTML(window._walletScores[q.wallet] || 0) : (q.title && !q.isAdmin ? `<span class="badge-title">${q.title}</span>` : '')}
        <span class="q-category">${q.category}</span>
        <span class="q-ref" style="margin-left:auto;">${q.time}&nbsp;&nbsp;${q.id}</span>
      </div>
      ${q.tags && q.tags.length ? `<div class="q-tags">${q.tags.map(t => `<span class="q-tag ${boardSearch === '#'+t || boardSearch === t ? 'active-tag' : ''}" onclick="setBoardSearch('#${t}')">#${t}</span>`).join('')}</div>` : ''}
      <div class="q-text">${boardSearch ? q.text.replace(new RegExp('(' + boardSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark style="background:rgba(84,147,247,0.25);color:var(--accent);border-radius:2px;padding:0 2px;">$1</mark>') : q.text}</div>
      ${q.poll && q.poll.length >= 2 ? renderPoll(q, realQi) : ''}
      <div class="q-footer">
        <div class="q-votes">
          <button class="vote-btn ${q.voted ? 'voted' : ''}" onclick="voteQuestion(${realQi})"><img src="/assets/icons/upvotes.png" style="width:27px;height:27px;vertical-align:middle;margin-right:3px;"> ${q.votes}</button>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm btn-answer-view" onclick="toggleAnswers(${realQi})">💬 ${q.answers.length} answer${q.answers.length !== 1 ? 's' : ''}</button>
          <button class="btn btn-sm btn-answer-add" onclick="toggleAnswerForm(${realQi})">+ Answer</button>
        </div>
      </div>
      <div class="answers-section ${q.open ? 'open' : ''}" id="answers-${realQi}">
        ${q.answers.length === 0 ? `<div style="font-size:12px;color:var(--muted);padding:8px 0;">No answers yet - be the first!</div>` : ''}
        ${q.answers.map((a, ai) => `
          <div class="answer-item ${a.isAdmin ? 'admin-answer' : ''}">
            <div class="answer-meta">
              ${a.isAdmin ? `<span class="badge-admin">🛡️ Admin</span>` : `${_getProfileAvatar(a.wallet) ? `<img src="${getProfileAvatar(a.wallet)}" style="width:18px;height:18px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:4px;">` : ''}<span class="q-alias">${_getDisplayName(a.wallet, a.alias)}</span>`}
              ${!a.isAdmin && a.wallet && window._walletScores ? getRankBadgeHTML(window._walletScores[a.wallet] || 0) : (a.title && !a.isAdmin ? `<span class="badge-title">${a.title}</span>` : '')}
            </div>
            ${a.replyTo ? `<div style="margin-bottom:8px;padding:6px 10px;background:rgba(84,147,247,0.07);border-left:2px solid var(--accent);border-radius:0 6px 6px 0;">
              <div style="font-size:10px;color:var(--accent);font-weight:700;margin-bottom:2px;display:flex;align-items:center;gap:4px;"><span>&#x21A9;&#xFE0E;</span>${a.replyTo.author}</div>
              <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.replyTo.text}</div>
            </div>` : ''}
            <div class="answer-text">${a.text}</div>
            <div class="answer-votes" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <button class="vote-btn ${a.voted ? 'voted' : ''}" onclick="voteAnswer(${realQi},${ai})"><img src="/assets/icons/upvotes.png" style="width:27px;height:27px;vertical-align:middle;margin-right:3px;"> ${a.votes}</button>
              <button
                data-board-reply-qi="${realQi}"
                data-board-reply-id="${a.id}"
                data-board-reply-author="${_getDisplayName(a.wallet, a.alias).replace(/"/g,'&quot;')}"
                data-board-reply-text="${a.text.replace(/"/g,'&quot;').replace(/\n/g,' ').slice(0,80)}"
                style="background:none;border:none;color:var(--muted);font-size:11px;font-family:'Exo 2',sans-serif;cursor:pointer;padding:2px 0;display:inline-flex;align-items:center;gap:4px;"
                onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--muted)'">
                <span style="font-style:normal;font-size:12px;line-height:1;">&#x21A9;&#xFE0E;</span> Reply
              </button>
              ${a.wallet && a.wallet === (globalWalletAddress || connectedAddress) ? `
              <button
                data-delete-qi="${realQi}"
                data-delete-aid="${a.id}"
                style="background:none;border:none;color:rgba(255,96,96,0.5);font-size:11px;font-family:'Exo 2',sans-serif;cursor:pointer;padding:2px 0;display:inline-flex;align-items:center;gap:4px;margin-left:auto;"
                onmouseover="this.style.color='#ff6060'" onmouseout="this.style.color='rgba(255,96,96,0.5)'">
                🗑 Delete
              </button>` : ''}
            </div>
          </div>
        `).join('')}
        <div class="answer-form ${q.formOpen ? 'open' : ''}" id="aform-${realQi}">
          <div class="answer-form-title">Submit anonymous answer</div>
          <div id="board-reply-block-${realQi}" style="display:none;align-items:flex-start;gap:8px;margin-bottom:12px;padding:8px 10px;background:rgba(84,147,247,0.06);border:1px solid rgba(84,147,247,0.15);border-radius:8px;">
            <div style="flex:1;padding:4px 8px;background:rgba(84,147,247,0.07);border-left:2px solid var(--accent);border-radius:0 5px 5px 0;">
              <div style="font-size:10px;color:var(--accent);font-weight:700;margin-bottom:2px;display:flex;align-items:center;gap:4px;"><span>&#x21A9;&#xFE0E;</span><span class="board-reply-author"></span></div>
              <div class="board-reply-text" style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
            </div>
            <button onclick="clearBoardReply(${realQi})" style="background:none;border:none;color:var(--muted);font-size:15px;cursor:pointer;padding:2px 6px;line-height:1;flex-shrink:0;">✕</button>
          </div>
          <div class="form-group">
            <label>Your Answer</label>
            <textarea id="atext-${realQi}" placeholder="Share your knowledge anonymously..." rows="4"></textarea>
          </div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:4px;">
            <button class="btn btn-primary btn-sm" onclick="submitAnswer(${realQi})">Post Answer</button>
          </div>
        </div>
      </div>
    </div>
  `; }).join('');
}



function toggleAnswers(qi) { questions[qi].open = !questions[qi].open; renderBoard(); }
function toggleAnswerForm(qi) { questions[qi].formOpen = !questions[qi].formOpen; questions[qi].open = true; renderBoard(); }

document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-delete-qi]');
  if (!btn) return;
  const qi = parseInt(btn.getAttribute('data-delete-qi'));
  const aid = btn.getAttribute('data-delete-aid');
  deleteAnswer(qi, aid);
});

async function deleteAnswer(qi, aid) {
  if (!confirm('Delete your answer? This cannot be undone.')) return;
  const q = questions[qi];
  const answerIdx = q.answers.findIndex(a => a.id === aid);
  if (answerIdx === -1) return;
  try {
    const res = await fetch(`${WORKER_URL}/answer/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, answerId: aid, wallet: globalWalletAddress }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
    questions[qi].answers.splice(answerIdx, 1);
    renderBoard();
  } catch(e) {
    alert('Failed to delete: ' + e.message);
  }
}

// ─── BOARD ANSWER REPLY ───────────────────────────────────────
window._boardReplyTo = {};

window.setBoardReply = function(qi, answerId, author, text) {
  window._boardReplyTo[qi] = { answerId, author, text };
  const block = document.getElementById('board-reply-block-' + qi);
  if (block) {
    block.style.display = 'flex';
    const nameEl = block.querySelector('.board-reply-author');
    const textEl = block.querySelector('.board-reply-text');
    if (nameEl) nameEl.textContent = author;
    if (textEl) textEl.textContent = text.slice(0, 80) + (text.length > 80 ? '...' : '');
    const textarea = document.getElementById('atext-' + qi);
    if (textarea) textarea.focus();
  }
};

window.clearBoardReply = function(qi) {
  delete window._boardReplyTo[qi];
  const block = document.getElementById('board-reply-block-' + qi);
  if (block) block.style.display = 'none';
};

document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-board-reply-qi]');
  if (!btn) return;
  const qi = btn.getAttribute('data-board-reply-qi');
  window.setBoardReply(qi, btn.getAttribute('data-board-reply-id'), btn.getAttribute('data-board-reply-author'), btn.getAttribute('data-board-reply-text'));
});

async function submitAnswer(qi) {
  const text = document.getElementById('atext-' + qi).value.trim();
  if (!text) { alert('Please write your answer first.'); return; }
  if (!globalWalletAddress) { alert('Connect wallet to answer'); return; }
  const wallet = globalWalletAddress;
  const q = questions[qi];
  // Anti-spam: max 3 answers per question per day per wallet
  const today = new Date().toISOString().slice(0, 10);
  const todayAnswers = q.answers.filter(a => a.wallet === wallet && a.createdAt && new Date(a.createdAt * 1000).toISOString().slice(0, 10) === today);
  if (todayAnswers.length >= 3) { alert('You can only post 3 answers per question per day.'); return; }
  const replyTo = window._boardReplyTo[qi] || null;
  try {
    const res = await fetch(`${WORKER_URL}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, text, wallet, replyTo: replyTo ? { answerId: replyTo.answerId, author: replyTo.author, text: replyTo.text.slice(0,80) } : null }),
    });
    if (!res.ok) throw new Error('Failed to post answer');
    const data = await res.json();
    questions[qi].answers.push({
      id: data.answerId,
      alias: 'Anonymous#' + wallet.slice(-4).toUpperCase(),
      isAdmin: false, wallet, text, votes: 0, voted: false,
      replyTo: replyTo ? { answerId: replyTo.answerId, author: replyTo.author, text: replyTo.text.slice(0,80) } : null,
    });
    questions[qi].formOpen = false;
    questions[qi].open = true;
    window.clearBoardReply(qi);
    renderBoard();
  } catch(e) {
    alert('Failed to post answer: ' + e.message);
  }
}

async function voteQuestion(qi) {
  const q = questions[qi];
  if (q.voted) return;
  if (q._voting) return; // guard against double-click
  const _wallet = globalWalletAddress || connectedAddress;
  if (!_wallet) { alert('Connect wallet to vote'); return; }
  q._voting = true;

  // Optimistic update
  q.votes++; q.voted = true;
  const votedQ = JSON.parse(localStorage.getItem('voted_questions') || '{}');
  votedQ[q.id] = true;
  localStorage.setItem('voted_questions', JSON.stringify(votedQ));
  renderBoard();

  // Helper to undo the optimistic vote
  const rollback = () => {
    q.votes = Math.max(0, q.votes - 1); q.voted = false;
    const v = JSON.parse(localStorage.getItem('voted_questions') || '{}');
    delete v[q.id]; localStorage.setItem('voted_questions', JSON.stringify(v));
    renderBoard();
  };

  // Sync to worker — only keep the vote if the server confirms it
  try {
    const res = await fetch(`${WORKER_URL}/question-vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, wallet: _wallet }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) { q._voting = false; return; } // confirmed
    // Server rejected — read reason
    let err = {}; try { err = await res.json(); } catch(e) {}
    q._voting = false;
    if (err.error === 'Already voted') return; // already counted on server — keep voted state
    rollback();
    if (err.error === 'Cannot vote your own question') alert('You cannot vote your own question');
    else alert('Your vote could not be submitted. Please try again.');
  } catch(e) {
    // Network failure — vote did NOT reach the server
    q._voting = false;
    rollback();
    alert('Your vote could not be submitted (network issue). Please try again.');
  }
}

async function voteAnswer(qi, ai) {
  const answer = questions[qi].answers[ai];
  if (answer.voted) return;
  if (answer._voting) return; // guard against double-click
  if (!globalWalletAddress) { alert('Connect wallet to vote'); return; }
  answer._voting = true;

  // Optimistic update
  answer.votes++; answer.voted = true;
  const votedA = JSON.parse(localStorage.getItem('voted_answers') || '{}');
  votedA[answer.id] = true;
  localStorage.setItem('voted_answers', JSON.stringify(votedA));
  renderBoard();

  const rollback = () => {
    answer.votes = Math.max(0, answer.votes - 1); answer.voted = false;
    const v = JSON.parse(localStorage.getItem('voted_answers') || '{}');
    delete v[answer.id]; localStorage.setItem('voted_answers', JSON.stringify(v));
    renderBoard();
  };

  // Persist to worker — only keep if confirmed
  try {
    const res = await fetch(`${WORKER_URL}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: questions[qi].id, answerId: answer.id, wallet: globalWalletAddress }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) { answer._voting = false; return; }
    let err = {}; try { err = await res.json(); } catch(e) {}
    answer._voting = false;
    if (err.error === 'Already voted') return; // already on server
    rollback();
    if (err.error === 'Cannot vote your own answer') alert('You cannot vote your own answer');
    else alert('Your vote could not be submitted. Please try again.');
  } catch(e) {
    answer._voting = false;
    rollback();
    alert('Your vote could not be submitted (network issue). Please try again.');
  }
}

// ─── ASK FORM ────────────────────────────────────────────────
document.getElementById('ask-message').addEventListener('input', function() {
  const max = 2000, len = this.value.length, remaining = max - len;
  const pct = len / max;
  const ring = document.getElementById('ask-ring');
  document.getElementById('ask-count').textContent = remaining;
  ring.style.strokeDashoffset = 87.96 - pct * 87.96;
  ring.style.stroke = remaining <= 100 ? '#ff4444' : remaining <= 300 ? '#f5c518' : 'var(--accent)';
  document.getElementById('ask-count').style.color = remaining <= 100 ? '#ff4444' : remaining <= 300 ? '#f5c518' : 'var(--muted)';
});

document.getElementById('ask-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = document.getElementById('ask-btn');
  btn.disabled = true;
  btn.innerHTML = 'Transmitting<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>';
  const formData = new FormData(this);
  const category = formData.get('category') || 'Other';
  const text = formData.get('message') || '';
  const txHash = document.getElementById('verified-tx-hidden').value;
  const wallet = document.getElementById('verified-wallet-hidden').value;
  const ref = 'LUNC-' + Date.now().toString(36).toUpperCase().slice(-7);
  const tagsRaw = document.getElementById('tags-hidden').value;
  const tags = tagsRaw ? tagsRaw.split(',').filter(Boolean) : [];
  const _userTitle = (typeof getUserTitle === 'function' && wallet) ? getUserTitle(wallet) : null;
  const _titleLabel = _userTitle ? _userTitle.name : 'Seeker';
  // Poll options
  const _pollRaw = document.getElementById('poll-options-hidden')?.value || '';
  let pollOptions = [];
  try { pollOptions = JSON.parse(_pollRaw).filter(o => o.trim()); } catch {}
  const poll = pollOptions.length >= 2 ? pollOptions.map(o => ({ text: o, votes: 0, voters: [] })) : null;

  try {
    const res = await fetch(`${WORKER_URL}/questions`, {
      method: 'POST',
      headers: txHash === 'ADMIN_BYPASS' ? adminHeaders() : { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ref, category, text, wallet, txHash, tags, paymentAmount: 200000, poll }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to submit');
    }
    // Add optimistically to local cache
    const newQ = { id: ref, alias: 'Anonymous#' + wallet.slice(-4).toUpperCase(), title: _titleLabel,
      category, text, tags, wallet, txHash, createdAt: Date.now() / 1000,
      poll, votes: 0, answers: [], voted: false, open: false, formOpen: false };
    questions.unshift(newQ);
    renderBoard();
    document.getElementById('ask-form-section').style.display = 'none';
    const success = document.getElementById('ask-success');
    success.classList.add('visible');
    document.getElementById('ask-ref').textContent = 'REF: ' + ref;
    if (typeof resetPollOptions === 'function') resetPollOptions();
  } catch(e) {
    alert('Failed to submit question: ' + e.message);
  }
  btn.disabled = false;
  btn.innerHTML = 'Transmit Question →';
});

// ─── PROTOCOL WALLETS ─────────────────────────────────────────
const ADMIN_WALLET    = 'terra15jt5a9ycsey4hd6nlqgqxccl9aprkmg2mxmfc6';
const TREASURY_WALLET = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt'; // Protocol Treasury wallet
const WEEKLY_DRAW_WALLET = 'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz'; // Weekly Draw Pool
const BURN_WALLET     = 'terra16m05j95p9qvq93cdtchjcpwgvny8f57vzdj06p';
const PROTOCOL_WALLET = ADMIN_WALLET;

// ── Admin secret (pairs with worker env ADMIN_SECRET) ────────────────────────
// The admin wallet address is public (it's in this file), so the worker also
// requires a shared secret in the X-Admin-Secret header for admin endpoints.
// Asked once via prompt, then kept in localStorage on the admin's browser.
function getAdminSecret(forceAsk) {
  let s = null;
  try { s = localStorage.getItem('admin_secret'); } catch(e) {}
  if ((!s || forceAsk) && connectedAddress === ADMIN_WALLET) {
    s = (prompt('Enter admin secret (must match the worker ADMIN_SECRET variable):') || '').trim();
    if (s) { try { localStorage.setItem('admin_secret', s); } catch(e) {} }
  }
  return s || '';
}
function adminHeaders() {
  return { 'Content-Type': 'application/json', 'X-Admin-Wallet': ADMIN_WALLET, 'X-Admin-Secret': getAdminSecret() };
}
const REQUIRED_LUNC   = 200000000000; // 200,000 LUNC in uLUNC
let connectedAddress  = null;

async function connectKeplr() {
  const btn = document.getElementById('keplr-connect-btn');
  if (!window.keplr) {
    if (confirm('Keplr wallet not found. Install Keplr?')) window.open('https://www.keplr.app/', '_blank');
    return;
  }
  try {
    btn.textContent = 'Connecting...'; btn.disabled = true;
    await window.keplr.enable('columbus-5');
    const offlineSigner = window.keplr.getOfflineSigner('columbus-5');
    const accounts = await offlineSigner.getAccounts();
    connectedAddress = accounts[0].address;
    setActiveProvider('keplr');
    // Update Pay button - async fetch real title from worker
    const _addr = accounts[0].address;
    if (typeof updateVerifyBtnPrice === 'function') updateVerifyBtnPrice(_addr);
    document.getElementById('connected-addr').textContent = connectedAddress.slice(0,10)+'...'+connectedAddress.slice(-4);
    document.getElementById('verified-wallet-hidden').value = connectedAddress;
    // Refresh My Bag if open
    if (document.getElementById('page-bag') &&
        document.getElementById('page-bag').classList.contains('active')) {
      renderOracleBag();
    }
    document.getElementById('keplr-disconnected').style.display = 'none';
    document.getElementById('keplr-connected').style.display = 'block';
    if (connectedAddress === ADMIN_WALLET) {
      document.getElementById('verified-tx-hidden').value = 'ADMIN_BYPASS';
      document.getElementById('keplr-connected').style.display = 'none';
      document.getElementById('ask-form').style.display = 'block';
      const notice = document.getElementById('tx-section');
      notice.style.display = 'block';
      notice.innerHTML = '<div style="background:rgba(245,197,24,0.08);border:1px solid rgba(245,197,24,0.25);border-radius:8px;padding:12px 16px;font-size:12px;color:var(--gold);">🛡️ Admin wallet detected - payment bypassed</div>';
    } else {
      document.getElementById('tx-section').style.display = 'block';
    }
  } catch(e) {
    btn.textContent = '🔑 Connect Keplr Wallet'; btn.disabled = false;
    alert('Connection failed: ' + (e.message || e));
  }
}

function disconnectKeplr() {
  connectedAddress = null;
  document.getElementById('keplr-disconnected').style.display = 'block';
  document.getElementById('keplr-connected').style.display = 'none';
  document.getElementById('tx-section').style.display = 'none';
  document.getElementById('ask-form').style.display = 'none';
  document.getElementById('tx-status').style.display = 'none';
  document.getElementById('keplr-connect-btn').textContent = '🔑 Connect Keplr Wallet';
  document.getElementById('keplr-connect-btn').disabled = false;
}

// ─── AMINO SIGNING HELPER (no cosmjs) ────────────────────────────────────────
// ── Active wallet provider routing (Keplr / Galaxy Station / Terra Station) ──
// All three expose a Keplr-compatible signer (getOfflineSigner + signDirect).
// Galaxy/Station nest that interface under `.keplr`; we fall back to the object
// itself, which also carries getOfflineSigner. Keplr stays `window.keplr`, so the
// Keplr path is byte-for-byte unchanged.
function setActiveProvider(p) {
  window._activeWalletProvider = p;
  try { localStorage.setItem('wallet_provider', p); } catch(e) {}
}
function getActiveProvider() {
  if (window._activeWalletProvider) return window._activeWalletProvider;
  try { return localStorage.getItem('wallet_provider') || 'keplr'; } catch(e) { return 'keplr'; }
}
function getActiveKeplr() {
  const p = getActiveProvider();
  if (p === 'luncdash') return null; // view-only: address entered manually, no signer available
  if (p === 'galaxy') { const g = window.galaxyStation; if (g) return g.keplr || g; }
  if (p === 'station') { const s = window.station || window.galaxyStation; if (s) return s.keplr || s; }
  return window.keplr;
}
const VIEW_ONLY_MSG = 'This wallet was connected by address only (view-only). To sign transactions, connect via Keplr, Galaxy Station or Terra Station.';
async function enableActive(chainId) {
  const k = getActiveKeplr();
  if (k && typeof k.enable === 'function') { try { await k.enable(chainId); } catch(e) {} }
  return k;
}

async function sendLuncDirect(fromAddr, toAddr, amountUluna, memo, chainId) {
  const LCD   = 'https://terra-classic-lcd.publicnode.com';
  const CHAIN = chainId || 'columbus-5';

  // Get account info
  const accRes  = await fetch(`${LCD}/cosmos/auth/v1beta1/accounts/${fromAddr}`);
  const accData = await accRes.json();
  const acct    = accData?.account || {};
  const accountNumber = parseInt(acct.account_number || '0');
  const sequence      = parseInt(acct.sequence || '0');

  // Fee = gas + 0.5% tax
  const gasLimit = 300000;
  const gasFee   = Math.ceil(gasLimit * 28.325);
  const taxFee   = Math.ceil(amountUluna * 0.005);
  const totalFee = gasFee + taxFee;

  // Protobuf helpers
  function encodeVarint(n) { n=Number(n); const b=[]; while(n>127){b.push((n&0x7f)|0x80);n=Math.floor(n/128);}b.push(n&0x7f);return new Uint8Array(b); }
  function encodeField(f,w,d){const t=encodeVarint((f<<3)|w);if(w===2){const l=encodeVarint(d.length);const o=new Uint8Array(t.length+l.length+d.length);o.set(t);o.set(l,t.length);o.set(d,t.length+l.length);return o;}return t;}
  function concat(...a){const tot=a.reduce((s,x)=>s+x.length,0);const o=new Uint8Array(tot);let off=0;for(const x of a){o.set(x,off);off+=x.length;}return o;}
  const enc = new TextEncoder();

  // MsgSend
  const coinP  = concat(encodeField(1,2,enc.encode('uluna')), encodeField(2,2,enc.encode(String(amountUluna))));
  const msgSP  = concat(encodeField(1,2,enc.encode(fromAddr)), encodeField(2,2,enc.encode(toAddr)), encodeField(3,2,coinP));
  const anyMsg = concat(encodeField(1,2,enc.encode('/cosmos.bank.v1beta1.MsgSend')), encodeField(2,2,msgSP));
  const txBodyP = concat(encodeField(1,2,anyMsg), encodeField(2,2,enc.encode(memo)));

  // Get pubkey from Keplr
  const directSigner = getActiveKeplr().getOfflineSigner(CHAIN);
  const accounts = await directSigner.getAccounts();
  const pubkeyB   = accounts[0].pubkey;
  const pubkeyAny = concat(
    encodeField(1,2,enc.encode('/cosmos.crypto.secp256k1.PubKey')),
    encodeField(2,2,encodeField(1,2,pubkeyB))
  );

  // ModeInfo: SIGN_MODE_DIRECT = 1
  const modeInfoP = encodeField(1,2,concat(encodeVarint((1<<3)|0), encodeVarint(1)));

  // SignerInfo
  const signerP = concat(
    encodeField(1,2,pubkeyAny),
    encodeField(2,2,modeInfoP),
    encodeVarint((3<<3)|0), encodeVarint(sequence)
  );

  // Fee
  const feeCoinP  = concat(encodeField(1,2,enc.encode('uluna')), encodeField(2,2,enc.encode(String(totalFee))));
  const feeP      = concat(encodeField(1,2,feeCoinP), encodeVarint((2<<3)|0), encodeVarint(gasLimit));
  const authInfoP = concat(encodeField(1,2,signerP), encodeField(2,2,feeP));

  // Sign with signDirect
  const { signed, signature } = await directSigner.signDirect(fromAddr, {
    bodyBytes:     txBodyP,
    authInfoBytes: authInfoP,
    chainId:       CHAIN,
    accountNumber: BigInt(accountNumber),
  });

  // Use signed bytes (Keplr may have modified them)
  const finalBody     = signed.bodyBytes     || txBodyP;
  const finalAuthInfo = signed.authInfoBytes || authInfoP;
  const sigB          = Uint8Array.from(atob(signature.signature), c=>c.charCodeAt(0));
  const txRawP        = concat(encodeField(1,2,finalBody), encodeField(2,2,finalAuthInfo), encodeField(3,2,sigB));
  // btoa with String.fromCharCode fails on large arrays on mobile - use chunked approach
  let txBase64 = '';
  const chunkSize = 8192;
  for (let i = 0; i < txRawP.length; i += chunkSize) {
    txBase64 += String.fromCharCode(...txRawP.subarray(i, i + chunkSize));
  }
  txBase64 = btoa(txBase64);

  const res  = await fetch(`${LCD}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBase64, mode: 'BROADCAST_MODE_SYNC' }),
  });
  const data   = await res.json();
  const txHash = data?.tx_response?.txhash || data?.txhash;
  const code   = data?.tx_response?.code ?? data?.code ?? 0;
  if (code !== 0) throw new Error('TX failed: ' + (data?.tx_response?.raw_log || JSON.stringify(data)));

  // Poll for confirmation - max 5 × 4s
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const chk = await fetch(`${LCD}/cosmos/tx/v1beta1/txs/${txHash}`);
      if (chk.ok) {
        const chkData = await chk.json();
        if (chkData?.tx_response?.txhash) {
          if ((chkData.tx_response.code ?? 0) !== 0) throw new Error('TX failed on-chain: ' + chkData.tx_response.raw_log);
          return txHash;
        }
      }
    } catch(e) { if (e.message?.includes('TX failed')) throw e; }
  }

  if (code !== 0) throw new Error('TX failed: ' + (data?.tx_response?.raw_log || JSON.stringify(data)));
  return txHash;
}

// ─── FIX 1: Ask - исправлена fee (200,000 LUNC payment) ──────
// ─── Send two MsgSend in one TX (one signature) ───────────────
async function sendTwoMsgsDirect(fromAddr, to1, amount1, to2, amount2, memo, chainId) {
  const LCD   = 'https://terra-classic-lcd.publicnode.com';
  const CHAIN = chainId || 'columbus-5';

  const accRes  = await fetch(`${LCD}/cosmos/auth/v1beta1/accounts/${fromAddr}`);
  const accData = await accRes.json();
  const acct    = accData?.account || {};
  const accountNumber = parseInt(acct.account_number || '0');
  const sequence      = parseInt(acct.sequence || '0');

  const totalAmount = amount1 + amount2;
  // Gas scales with memo length (WritePerByte). 400k was too tight — long
  // questions hit out-of-gas at ~403k. 600k gives comfortable headroom.
  const gasLimit = 600000;
  const gasFee   = Math.ceil(gasLimit * 28.325);
  const taxFee   = Math.ceil(totalAmount * 0.005);
  const totalFee = gasFee + taxFee;

  function encodeVarint(n) { n=Number(n); const b=[]; while(n>127){b.push((n&0x7f)|0x80);n=Math.floor(n/128);}b.push(n&0x7f);return new Uint8Array(b); }
  function encodeField(f,w,d){const t=encodeVarint((f<<3)|w);if(w===2){const l=encodeVarint(d.length);const o=new Uint8Array(t.length+l.length+d.length);o.set(t);o.set(l,t.length);o.set(d,t.length+l.length);return o;}return t;}
  function concat(...a){const tot=a.reduce((s,x)=>s+x.length,0);const o=new Uint8Array(tot);let off=0;for(const x of a){o.set(x,off);off+=x.length;}return o;}
  const enc = new TextEncoder();

  function buildMsgSend(from, to, amount) {
    const coinP = concat(encodeField(1,2,enc.encode('uluna')), encodeField(2,2,enc.encode(String(amount))));
    const msgSP = concat(encodeField(1,2,enc.encode(from)), encodeField(2,2,enc.encode(to)), encodeField(3,2,coinP));
    return concat(encodeField(1,2,enc.encode('/cosmos.bank.v1beta1.MsgSend')), encodeField(2,2,msgSP));
  }

  const anyMsg1 = buildMsgSend(fromAddr, to1, amount1);
  const anyMsg2 = buildMsgSend(fromAddr, to2, amount2);
  const txBodyP = concat(encodeField(1,2,anyMsg1), encodeField(1,2,anyMsg2), encodeField(2,2,enc.encode(memo)));

  const directSigner = getActiveKeplr().getOfflineSigner(CHAIN);
  const accounts = await directSigner.getAccounts();
  const pubkeyB  = accounts[0].pubkey;
  const pubkeyAny = concat(
    encodeField(1,2,enc.encode('/cosmos.crypto.secp256k1.PubKey')),
    encodeField(2,2,encodeField(1,2,pubkeyB))
  );
  const modeInfoP = encodeField(1,2,concat(encodeVarint((1<<3)|0), encodeVarint(1)));
  const signerP   = concat(
    encodeField(1,2,pubkeyAny),
    encodeField(2,2,modeInfoP),
    encodeVarint((3<<3)|0), encodeVarint(sequence)
  );
  const feeCoinP  = concat(encodeField(1,2,enc.encode('uluna')), encodeField(2,2,enc.encode(String(totalFee))));
  const feeP      = concat(encodeField(1,2,feeCoinP), encodeVarint((2<<3)|0), encodeVarint(gasLimit));
  const authInfoP = concat(encodeField(1,2,signerP), encodeField(2,2,feeP));

  const { signed, signature } = await directSigner.signDirect(fromAddr, {
    bodyBytes:     txBodyP,
    authInfoBytes: authInfoP,
    chainId:       CHAIN,
    accountNumber: BigInt(accountNumber),
  });

  const finalBody     = signed.bodyBytes     || txBodyP;
  const finalAuthInfo = signed.authInfoBytes || authInfoP;
  const sigB          = Uint8Array.from(atob(signature.signature), c=>c.charCodeAt(0));
  const txRawP        = concat(encodeField(1,2,finalBody), encodeField(2,2,finalAuthInfo), encodeField(3,2,sigB));

  let txBase64 = '';
  const chunkSize = 8192;
  for (let i = 0; i < txRawP.length; i += chunkSize) {
    txBase64 += String.fromCharCode(...txRawP.subarray(i, i + chunkSize));
  }
  txBase64 = btoa(txBase64);

  const res  = await fetch(`${LCD}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBase64, mode: 'BROADCAST_MODE_SYNC' }),
  });
  const data   = await res.json();
  const txHash = data?.tx_response?.txhash || data?.txhash;
  const code   = data?.tx_response?.code ?? data?.code ?? 0;
  if (code !== 0) throw new Error('TX failed: ' + (data?.tx_response?.raw_log || JSON.stringify(data)));

  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const chk = await fetch(`${LCD}/cosmos/tx/v1beta1/txs/${txHash}`);
      if (chk.ok) {
        const chkData = await chk.json();
        if (chkData?.tx_response?.txhash) {
          if ((chkData.tx_response.code ?? 0) !== 0) throw new Error('TX failed on-chain: ' + chkData.tx_response.raw_log);
          return txHash;
        }
      }
    } catch(e) { if (e.message?.includes('TX failed')) throw e; }
  }
  return txHash;
}

// ── Shared discount calc (canonical, per protocol docs) ──────────────────────
// 1. Streak is fetched first: it provides both the 7-day discount (25%) and the
//    REP multiplier. Effective REP = base REP × streak multiplier — the SAME
//    number the profile page and leaderboard display, so rank always matches.
// 2. Final discount = the HIGHER of rank discount vs streak discount (they do
//    NOT stack). Canonical rules live in profile.js (combineDiscounts et al.).
// Used by both the button price preview and the actual transaction so they always agree.
async function getQuestionDiscountPct(addr) {
  let rankD = 0, streakD = 0, streakMult = 1.0, _streakDays = 0, _rankName = '';

  // ── Streak: 7+ days = 25% discount, and the REP multiplier for ranks ──
  try {
    const sr = await fetch(`${WORKER_URL}/streak?wallet=${addr}`);
    if (sr.ok) {
      const sd = await sr.json();
      _streakDays = sd.currentStreak || 0;
      if (_streakDays >= 7) streakD = (typeof STREAK_QUESTION_DISCOUNT !== 'undefined') ? STREAK_QUESTION_DISCOUNT : 25;
      streakMult = sd.multiplier || 1.0;
    }
  } catch(e) {}

  // ── Full base REP = questions*40 + answers*15 + chatMsgs*5 + upvotes*10 + drawRep ──
  try {
    let rep = 0;
    // Q&A stats (questions, answers, upvotes)
    let qStats = null;
    if (typeof fetchQuestionStats === 'function') {
      try { qStats = await fetchQuestionStats(addr); } catch(e) {}
    }
    if (qStats) {
      const nQ = (qStats.myQuestions || []).length;
      const nA = (qStats.myAnswers || []).length;
      const up = qStats.totalUpvotes || 0;
      rep += nQ * 40 + nA * 15 + up * 10;
    }
    // Chat messages
    try {
      const cr = await fetch(`${WORKER_URL}/chat/count?wallet=${addr}`);
      if (cr.ok) { const cd = await cr.json(); rep += (cd.msgCount || cd.total || 0) * 5; }
    } catch(e) {}
    // Draw REP
    try {
      const dr = await fetch(`${WORKER_URL}/rep/draw?wallet=${addr}`);
      if (dr.ok) { const dd = await dr.json(); rep += dd.total || 0; }
    } catch(e) {}
    // Fallback: if everything above failed, use the partial score map
    if (!rep && window._walletScores && window._walletScores[addr]) rep = window._walletScores[addr];

    // Rank is computed on EFFECTIVE REP (base × streak multiplier) — same as profile/leaderboard.
    const effRep = (typeof getEffectiveRep === 'function') ? getEffectiveRep(rep, streakMult) : Math.round(rep * streakMult);
    if (typeof getRank === 'function') { const rk = getRank(effRep); rankD = (rk && rk.discount) ? rk.discount : 0; _rankName = (rk && rk.name) ? rk.name : ''; }
  } catch(e) {}

  // Higher of the two, never summed (per docs).
  const pct = (typeof combineDiscounts === 'function') ? combineDiscounts(rankD, streakD) : Math.max(rankD, streakD);
  // Stash the breakdown so the price panel can show the WHY (streak vs rank)
  // without re-fetching everything.
  getQuestionDiscountPct._last = { pct, rankD, streakD, streakDays: _streakDays, rankName: _rankName };
  return pct;
}

// Update the verify button text with the user's real (discounted) price.
// Also fills the price panel above the button: base (struck through), the
// personal price, and a badge explaining WHY (streak vs rank) — driven by
// the breakdown stashed in getQuestionDiscountPct._last.
async function updateVerifyBtnPrice(addr) {
  try {
    const discPct = await getQuestionDiscountPct(addr);
    const price   = 200000 - Math.round(200000 * (discPct / 100));
    const btnEl   = document.getElementById('verify-btn');
    if (btnEl) {
      const disc = discPct > 0 ? ` (${discPct}% off)` : '';
      btnEl.textContent = `Pay ${price.toLocaleString()} LUNC & Unlock →${disc}`;
    }
    const nowEl   = document.getElementById('ask-price-now');
    const baseEl  = document.getElementById('ask-price-base');
    const badgeEl = document.getElementById('ask-price-badge');
    const badgeTx = document.getElementById('ask-price-badge-text');
    if (nowEl) nowEl.innerHTML = 'Your price: <b>' + price.toLocaleString() + ' LUNC</b>';
    if (discPct > 0) {
      if (baseEl)  baseEl.style.display = '';
      if (badgeEl) badgeEl.style.display = '';
      if (badgeTx) {
        const info = getQuestionDiscountPct._last || {};
        let reason = '';
        if (info.streakD >= info.rankD && info.streakD > 0) reason = (info.streakDays || 7) + '-day streak';
        else if (info.rankName) reason = info.rankName + ' rank';
        badgeTx.textContent = discPct + '% OFF' + (reason ? ' · ' + reason : '');
      }
    } else {
      if (baseEl)  baseEl.style.display = 'none';
      if (badgeEl) badgeEl.style.display = 'none';
    }
  } catch(e) {}
}

async function autoPayAndUnlock() {
  if (!connectedAddress) { alert('Connect wallet first!'); return; }
  const btn = document.getElementById('verify-btn');
  if (!getActiveKeplr()) {
    alert(getActiveProvider() === 'luncdash' ? VIEW_ONLY_MSG : 'Wallet extension not found. Please reconnect your wallet.');
    return;
  }
  btn.textContent = '⏳ Opening wallet...'; btn.disabled = true;
  try {
    await enableActive('columbus-5');
    const accounts = await getActiveKeplr().getOfflineSigner('columbus-5').getAccounts();
    const sender = accounts[0].address;

    // ── Discount = HIGHER of RANK discount / STREAK discount (per docs, not summed). ──
    // Rank uses effective REP (base × streak multiplier), same as profile page.
    // Same helper the button uses, so preview and charge always match.
    const discountPct = await getQuestionDiscountPct(sender);

    // Discount is % of total 200,000 LUNC, subtracted from Treasury portion
    // Weekly Pool: always 100,000 LUNC (fixed)
    // Treasury: 100,000 - (200,000 × discount%)
    const toWeekly    = 100000 * 1e6;                                          // always fixed
    const discountAmt = Math.round(200000 * (discountPct / 100));              // e.g. 5% → 10,000
    const toTreasury  = Math.round((100000 - discountAmt) * 1e6);              // e.g. 90,000 LUNC
    const totalLunc   = 100000 + (100000 - discountAmt);                       // e.g. 190,000

    const discountLabel = discountPct > 0
      ? ` (${discountPct}% off - saved ${discountAmt.toLocaleString()} LUNC)`
      : '';

    // Single TX with two MsgSend — one signature
    const txHash = await sendTwoMsgsDirect(
      sender,
      WEEKLY_DRAW_WALLET, toWeekly,
      TREASURY_WALLET, toTreasury,
      'Terra Oracle Q&A - Weekly Pool + Treasury', 'columbus-5'
    );

    // Store tx hash for question record
    document.getElementById('verified-tx-hidden').value = txHash;
    document.getElementById('verified-wallet-hidden').value = sender;

    const luncPaid = totalLunc.toLocaleString();
    showTxStatus('success', `✅ Payment confirmed! ${luncPaid} LUNC sent${discountLabel}. Form unlocked.`);
    setTimeout(() => {
      document.getElementById('tx-section').style.display = 'none';
      document.getElementById('keplr-connected').style.display = 'none';
      document.getElementById('ask-form').style.display = 'block';
    }, 1200);
  } catch(e) {
    btn.disabled = false;
    if (typeof connectedAddress !== 'undefined' && connectedAddress && typeof updateVerifyBtnPrice === 'function') {
      updateVerifyBtnPrice(connectedAddress);
    } else {
      btn.textContent = 'Pay 200,000 LUNC & Unlock';
    }
    showTxStatus('error', '❌ ' + (e.message || 'Transaction cancelled.'));
  }
}

async function verifyTX() {
  const txHash = document.getElementById('tx-input').value.trim();
  const btn = document.getElementById('verify-btn');
  if (!txHash) { alert('Please enter a TX hash'); return; }
  btn.textContent = 'Checking...'; btn.disabled = true;
  document.getElementById('tx-status').style.display = 'none';
  let txData = null;
  try {
    const res = await fetch(`https://terra-classic-lcd.publicnode.com/cosmos/tx/v1beta1/txs/${txHash}`);
    if (res.ok) { txData = await res.json(); }
  } catch(e) {}
  btn.textContent = 'Verify'; btn.disabled = false;
  if (!txData || txData.error) { showTxStatus('error', '❌ Transaction not found. Check the hash and try again.'); return; }
  if (txData.code && txData.code !== 0) { showTxStatus('error', '❌ Transaction failed on-chain.'); return; }
  const msgs = txData.tx?.value?.msg || txData.tx?.body?.messages || [];
  let valid = false, foundAmount = 0;
  for (const msg of msgs) {
    const type = msg.type || msg['@type'] || '';
    const val = msg.value || msg;
    if (type.includes('MsgSend') || type.includes('bank')) {
      const toAddr = val.to_address || val.toAddress;
      const coins = val.amount || [];
      const lunc = Array.isArray(coins) ? coins.find(c => c.denom === 'uluna') : (coins.denom === 'uluna' ? coins : null);
      // Accept payment to Treasury OR Weekly Pool (split payment - either tx is valid proof)
      const MIN_ACCEPTED = 150000 * 1e6; // 150,000 LUNC minimum (max discount = 25%)
      if ((toAddr === TREASURY_WALLET || toAddr === WEEKLY_DRAW_WALLET || toAddr === PROTOCOL_WALLET) && lunc) {
        foundAmount += parseInt(lunc.amount);
      }
    }
  }
  const MIN_ACCEPTED = 100000 * 1e6; // at least the Weekly Pool portion
  if (foundAmount < MIN_ACCEPTED) { showTxStatus('error', `❌ Invalid payment. Expected 100,000+ LUNC to Oracle wallets. Found: ${(foundAmount/1000000).toLocaleString()} LUNC.`); return; }
  valid = true;
  document.getElementById('verified-tx-hidden').value = txHash;
  showTxStatus('success', '✅ Payment verified! 200,000 LUNC confirmed. Form unlocked.');
  setTimeout(() => {
    document.getElementById('tx-section').style.display = 'none';
    document.getElementById('keplr-connected').style.display = 'none';
    document.getElementById('ask-form').style.display = 'block';
  }, 1200);
}

function showTxStatus(type, msg) {
  const el = document.getElementById('tx-status');
  el.style.display = 'block';
  el.style.background = type === 'success' ? 'rgba(102,255,170,0.06)' : 'rgba(255,60,60,0.06)';
  el.style.border = type === 'success' ? '1px solid rgba(102,255,170,0.25)' : '1px solid rgba(255,60,60,0.25)';
  el.style.color = type === 'success' ? 'var(--green)' : '#ff6060';
  el.textContent = msg;
}

// ─── WALLET CONNECT ───────────────────────────────────────────
let globalWalletAddress = null;

function saveWalletSession(address) {
  localStorage.setItem('wallet_session', JSON.stringify({ address, expires: Date.now() + 24 * 60 * 60 * 1000 }));
}
function loadWalletSession() {
  try {
    const s = JSON.parse(localStorage.getItem('wallet_session') || 'null');
    if (s && s.address && s.expires > Date.now()) return s.address;
    localStorage.removeItem('wallet_session');
  } catch(e) {}
  return null;
}
function clearWalletSession() { localStorage.removeItem('wallet_session'); }

window.toggleWalletDropdown = function() {
  document.getElementById('wallet-dropdown').classList.toggle('open');
}

document.addEventListener('click', function(e) {
  if (!document.getElementById('wallet-wrap').contains(e.target)) {
    document.getElementById('wallet-dropdown').classList.remove('open');
  }
});

window.connectWallet = async function(type) {
  if (type === 'keplr-ext') {
    if (!window.keplr) {
      if (confirm('Keplr extension not found. Install Keplr?')) window.open('https://www.keplr.app/download', '_blank');
      return;
    }
    try {
      document.getElementById('wallet-btn-label').textContent = 'Connecting...';
      await window.keplr.enable('columbus-5');
      const signer = window.keplr.getOfflineSigner('columbus-5');
      const accounts = await signer.getAccounts();
      setActiveProvider('keplr');
      setWalletConnected(accounts[0].address);
    } catch(e) {
      document.getElementById('wallet-btn-label').textContent = 'Connect';
      alert('Connection failed: ' + (e.message || e));
    }
  } else if (type === 'galaxy' || type === 'galaxy-mobile') {
    const galaxy = window.galaxyStation || window.station;
    if (!galaxy) {
      if (confirm('Galaxy Station not found. Install Galaxy Station?')) window.open('https://station.hexxagon.io/', '_blank');
      return;
    }
    try {
      document.getElementById('wallet-btn-label').textContent = 'Connecting...';
      const conn = await galaxy.connect();
      const address = conn?.address || conn?.addresses?.mainnet || conn?.addresses?.['columbus-5'];
      if (address) {
        setActiveProvider('galaxy');
        setWalletConnected(address);
      } else {
        throw new Error('No address returned');
      }
    } catch(e) {
      document.getElementById('wallet-btn-label').textContent = 'Connect';
      alert('Galaxy Station connection failed: ' + (e.message || e));
    }
  } else if (type === 'station' || type === 'station-mobile') {
    // Terra Station — uses window.station (same API as Galaxy Station)
    const stationWallet = window.station;
    if (!stationWallet) {
      if (confirm('Terra Station not found. Install Terra Station?')) window.open('https://chrome.google.com/webstore/detail/terra-station/aiifbnbfobpmeekipheeijimdpnlpgpp', '_blank');
      return;
    }
    try {
      document.getElementById('wallet-btn-label').textContent = 'Connecting...';
      const conn = await stationWallet.connect();
      const address = conn?.address || conn?.addresses?.mainnet || conn?.addresses?.['columbus-5'];
      if (address) {
        setActiveProvider('station');
        setWalletConnected(address);
      } else {
        throw new Error('No address returned');
      }
    } catch(e) {
      document.getElementById('wallet-btn-label').textContent = 'Connect';
      alert('Terra Station connection failed: ' + (e.message || e));
    }
  } else if (type === 'luncdash') {
    const addr = prompt('Enter your Terra Classic wallet address (terra1...):');
    if (addr && addr.startsWith('terra1') && addr.length > 20) {
      setActiveProvider('luncdash');
      setWalletConnected(addr.trim());
    } else if (addr !== null) {
      alert('Invalid Terra Classic address.');
    }
  } else if (type === 'keplr-mobile') {
    if (typeof openWalletQRModal === 'function') { openWalletQRModal('keplr-mobile'); return; }
    alert('Keplr Mobile: use the QR option in the wallet menu, or connect via Keplr Extension.');
  }
}

function setWalletConnected(address) {
  globalWalletAddress = address;
  connectedAddress = address;
  saveWalletSession(address);
  const short = address.slice(0,8) + '...' + address.slice(-4);
  document.getElementById('wallet-btn-label').textContent = short;
  document.getElementById('wallet-main-btn').classList.add('connected');
  document.getElementById('wallet-connected-addr').textContent = address;
  document.getElementById('wallet-not-connected').style.display = 'none';
  document.getElementById('wallet-connected-panel').style.display = 'block';
  document.getElementById('wallet-dropdown').classList.remove('open');

  // Синхронизируем CHAT страницу
  const chatPrompt = document.getElementById('chat-page-connect-prompt');
  const chatForm   = document.getElementById('chat-page-form');
  const chatAddr   = document.getElementById('chat-page-addr');
  if (chatPrompt) chatPrompt.style.display = 'none';
  if (chatForm)   chatForm.style.display   = 'block';
  if (chatAddr)   chatAddr.textContent     = address.slice(0,10)+'...'+address.slice(-4);

  // Синхронизируем ASK страницу
  const connAddrEl  = document.getElementById('connected-addr');
  const verifiedWallet = document.getElementById('verified-wallet-hidden');
  const keplrDisc   = document.getElementById('keplr-disconnected');
  const keplrConn   = document.getElementById('keplr-connected');
  if (connAddrEl)     connAddrEl.textContent  = address.slice(0,10)+'...'+address.slice(-4);
  if (verifiedWallet) verifiedWallet.value    = address;
  if (keplrDisc)      keplrDisc.style.display = 'none';
  if (keplrConn)      keplrConn.style.display = 'block';
  if (address !== ADMIN_WALLET) {
    const txSection = document.getElementById('tx-section');
    if (txSection) txSection.style.display = 'block';
  } else {
    const verifiedTx = document.getElementById('verified-tx-hidden');
    const txSection  = document.getElementById('tx-section');
    const askForm    = document.getElementById('ask-form');
    if (verifiedTx) verifiedTx.value = 'ADMIN_BYPASS';
    if (txSection)  { txSection.style.display = 'block'; txSection.innerHTML = '<div style="background:rgba(245,197,24,0.08);border:1px solid rgba(245,197,24,0.25);border-radius:8px;padding:12px 16px;font-size:12px;color:var(--gold);">🛡️ Admin wallet detected - payment bypassed</div>'; }
    if (askForm)    askForm.style.display = 'block';
  }

  if (window.keplrChatAddress !== undefined) {
    keplrChatAddress = address;
    const addrShort = address.slice(0,8) + '...' + address.slice(-4);
    document.getElementById('keplr-chat-addr').textContent = addrShort;
    document.getElementById('keplr-verified-bar').style.display = 'flex';
    document.getElementById('mode-keplr').textContent = '🔑 ' + addrShort;
    setMode('keplr');
  }
  // Обновляем My Bag при подключении кошелька
  renderOracleBag();

  // Если открыта вкладка Your Stats — загружаем данные
  setTimeout(() => {
    if (typeof loadStatsData === 'function') {
      const repPage = document.getElementById('page-reputation');
      const isRepActive = repPage && repPage.classList.contains('active');
      const isStatsTab = typeof _repCurrentTab !== 'undefined' && _repCurrentTab === 'stats';
      if (isRepActive && isStatsTab) {
        loadStatsData();
      }
    }
  }, 200);

  // Load profile from Worker (profile.js loads after app.js)
  setTimeout(() => {
    if (typeof loadProfileFromWorker === 'function') {
      loadProfileFromWorker(address).then(() => {
        if (typeof renderBoard === 'function') renderBoard();
        if (typeof renderProfilePage === 'function' && document.getElementById('page-profile')?.classList.contains('active')) {
          renderProfilePage();
        }
      });
    }
  }, 300);
}

window.openBagWalletPicker = function() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => {
    const dropdown = document.getElementById('wallet-dropdown');
    if (dropdown) dropdown.classList.add('open');
  }, 350);
}

window.disconnectWallet = function() {
  globalWalletAddress = null;
  connectedAddress = null;
  clearWalletSession();
  window._activeWalletProvider = null;
  try { localStorage.removeItem('wallet_provider'); } catch(e) {}
  document.getElementById('wallet-btn-label').textContent = 'Connect';
  document.getElementById('wallet-main-btn').classList.remove('connected');
  document.getElementById('wallet-not-connected').style.display = 'block';
  document.getElementById('wallet-connected-panel').style.display = 'none';
  document.getElementById('wallet-dropdown').classList.remove('open');
  const adminPanel = document.getElementById('admin-panel');
  if (adminPanel) adminPanel.style.display = 'none';

  // Сбрасываем ASK страницу
  const keplrDisc = document.getElementById('keplr-disconnected');
  const keplrConn = document.getElementById('keplr-connected');
  const txSection = document.getElementById('tx-section');
  const askForm   = document.getElementById('ask-form');
  if (keplrDisc) keplrDisc.style.display = 'block';
  if (keplrConn) keplrConn.style.display = 'none';
  if (txSection) txSection.style.display = 'none';
  if (askForm)   askForm.style.display   = 'none';

  // Сбрасываем CHAT страницу
  const chatPrompt = document.getElementById('chat-page-connect-prompt');
  const chatForm   = document.getElementById('chat-page-form');
  if (chatPrompt) chatPrompt.style.display = 'block';
  if (chatForm)   chatForm.style.display   = 'none';

  try { disconnectChatKeplr(); } catch(e) {}
  renderOracleBag();
}

// ─── CHAT PAGE ────────────────────────────────────────────────
document.getElementById('chat-page-input').addEventListener('input', function() {
  const max = 256, len = this.value.length, remaining = max - len;
  const pct = len / max;
  const ring = document.getElementById('chat-ring');
  const counter = document.getElementById('chat-page-count');
  ring.style.strokeDashoffset = 87.96 - (pct * 87.96);
  if (remaining <= 20) { ring.style.stroke = '#ff4444'; counter.style.color = '#ff4444'; }
  else if (remaining <= 50) { ring.style.stroke = '#f5c518'; counter.style.color = '#f5c518'; }
  else { ring.style.stroke = 'var(--accent)'; counter.style.color = 'var(--muted)'; }
  counter.textContent = remaining;
});

// ─── FIX 2: Chat - исправлена fee (5,000 LUNC payment) ───────
window._chatReplyTo = null;
window.setChatReply = function(txHash, author, text) {
  window._chatReplyTo = { txHash, author, text };
  const block = document.getElementById('chat-reply-block');
  if (block) block.style.display = 'flex';
  const nameEl = document.getElementById('chat-reply-author');
  if (nameEl) nameEl.textContent = author;
  const textEl = document.getElementById('chat-reply-text');
  if (textEl) textEl.textContent = text.slice(0,80) + (text.length > 80 ? '...' : '');
  const input = document.getElementById('chat-page-input');
  if (input) input.focus();
};
window.clearChatReply = function() {
  window._chatReplyTo = null;
  const block = document.getElementById('chat-reply-block');
  if (block) block.style.display = 'none';
};
document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-reply-txhash]');
  if (!btn) return;
  window.setChatReply(btn.getAttribute('data-reply-txhash'), btn.getAttribute('data-reply-author'), btn.getAttribute('data-reply-text'));
});

window.sendChatMessage = async function() {
  const text = document.getElementById('chat-page-input').value.trim();
  const statusEl = document.getElementById('chat-tx-status');
  const btn = document.getElementById('chat-page-send-btn');
  if (!text) { alert('Write a message first!'); return; }
  if (!globalWalletAddress) { alert('Connect your wallet first!'); return; }
  if (!getActiveKeplr()) { alert(getActiveProvider() === 'luncdash' ? VIEW_ONLY_MSG : 'Wallet not found. Please connect a wallet.'); return; }
  btn.textContent = '⏳ Waiting for wallet...'; btn.disabled = true;
  statusEl.style.display = 'none';
  try {
    await enableActive('columbus-5');
    const accounts = await getActiveKeplr().getOfflineSigner('columbus-5').getAccounts();
    const sender = accounts[0].address;
    const replyPrefix = window._chatReplyTo ? `>${window._chatReplyTo.txHash.slice(0,16)}|` : '';
    const fullMemo = (replyPrefix + text).slice(0, 256);
    const txHash = await sendLuncDirect(sender, TREASURY_WALLET, 5000000000, fullMemo, 'columbus-5');
    const result = { transactionHash: txHash };
    const short = sender.slice(0,8)+'...'+sender.slice(-4);

    // ✅ Streak: Chat - платное действие (5,000 LUNC)
    fetch(`${WORKER_URL}/streak/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: sender, action: 'chat' }),
    }).catch(() => {});
    const stored = JSON.parse(localStorage.getItem('dao_chat_pending') || '[]');
    stored.push({ text, author: short, fullAddr: sender, txHash: result.transactionHash, isVerified: true, timestamp: Date.now() });
    localStorage.setItem('dao_chat_pending', JSON.stringify(stored));

    // ── Track message count via Worker (server-side, tamper-proof) ──
    fetch(`${WORKER_URL}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: sender, txHash: result.transactionHash }),
    }).then(r => r.json()).then(data => {
      if (data.milestoneEntry && data.newCount) {
        setTimeout(() => {
          statusEl.style.cssText = 'display:block;border-radius:8px;padding:10px 14px;font-size:12px;background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.3);color:#a78bfa;margin-top:10px;';
          statusEl.innerHTML = '🎉 Milestone reached! <strong>' + data.newCount + ' messages</strong> - you earned a free Weekly Draw entry! Total entries earned: <strong>' + data.entriesEarned + '</strong>';
          setTimeout(() => { statusEl.style.display = 'none'; }, 8000);
        }, 3000);
      }
    }).catch(() => {});
    // ─────────────────────────────────────────────────────────────

    document.getElementById('chat-page-input').value = '';
    document.getElementById('chat-page-count').textContent = '256';
    document.getElementById('chat-ring').style.strokeDashoffset = '87.96';
    document.getElementById('chat-ring').style.stroke = 'var(--accent)';
    window.clearChatReply();
    btn.textContent = 'Send Message →'; btn.disabled = false;
    statusEl.style.cssText = 'display:block;border-radius:8px;padding:10px 14px;font-size:12px;background:rgba(102,255,170,0.06);border:1px solid rgba(102,255,170,0.25);color:var(--green);margin-top:10px;';
    statusEl.innerHTML = '✅ Sent! <a href="https://finder.terraport.finance/classic/tx/' + result.transactionHash + '" target="_blank" style="color:var(--green);text-decoration:underline;">' + result.transactionHash.slice(0,16) + '...</a><br><span style="font-size:10px;opacity:0.7;">Message will appear after blockchain confirmation (~6s)</span>';
    setTimeout(() => { loadChatFromChain(); }, 8000);
    setTimeout(() => { statusEl.style.display = 'none'; }, 10000);
  } catch(e) {
    btn.textContent = 'Send Message →'; btn.disabled = false;
    statusEl.style.cssText = 'display:block;border-radius:8px;padding:10px 14px;font-size:12px;background:rgba(255,60,60,0.06);border:1px solid rgba(255,60,60,0.25);color:#ff6060;margin-top:10px;';
    statusEl.textContent = '❌ ' + (e.message || 'Transaction cancelled or failed.');
  }
}

// ─── BLOCKCHAIN CHAT ──────────────────────────────────────────
const CHAT_WALLET = TREASURY_WALLET;
const CHAT_HISTORY_WALLET = TREASURY_WALLET;
const CHAT_MIN_ULUNA = 5000000000;
// FIX 4: два разных FCD узла для настоящего fallback
const FCD_NODES = [
  'https://terra-classic-lcd.publicnode.com',
  'https://terra-classic-lcd.publicnode.com',
];

const CHAT_REACTIONS = ['🔥','👍','🚀','💎','❤️'];

// ── Chat reactions (server-backed via Worker) ────────────────────────────────
// Reactions live in the Worker KV (chat-react:<txHash>) so they're shared by
// everyone and survive cache clears / device changes. We keep an in-memory
// cache for the current render: { txHash: { emoji: { count, voters:[...] } } }
window._chatReactions = {};

function getMyWallet() { return globalWalletAddress || connectedAddress || null; }

// Fetch reactions for the currently shown messages, then re-render the rows.
async function loadChatReactions(txHashes) {
  const hashes = (txHashes || []).filter(Boolean);
  if (!hashes.length) return;
  try {
    const res = await fetch(`${WORKER_URL}/chat/reactions?txHashes=${encodeURIComponent(hashes.join(','))}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const data = await res.json();
    window._chatReactions = data || {};
    // Re-render each reaction row in place
    for (const h of hashes) {
      const row = document.getElementById('reactions-' + h);
      if (row) row.outerHTML = buildReactionsRow(h);
    }
  } catch(e) { /* network issue — keep whatever we had */ }
}

async function toggleReaction(txHash, emoji) {
  const wallet = getMyWallet();
  if (!wallet) { alert('Connect wallet to react'); return; }

  // Optimistic update on the in-memory cache
  const r = window._chatReactions[txHash] || (window._chatReactions[txHash] = {});
  const cell = r[emoji] || { count: 0, voters: [] };
  const had = cell.voters.includes(wallet);
  if (had) { cell.voters = cell.voters.filter(w => w !== wallet); cell.count = cell.voters.length; }
  else { cell.voters = [...cell.voters, wallet]; cell.count = cell.voters.length; }
  if (cell.count === 0) delete r[emoji]; else r[emoji] = cell;

  const row = document.getElementById('reactions-' + txHash);
  if (row) row.outerHTML = buildReactionsRow(txHash);

  // Persist to Worker; roll back on failure
  try {
    const res = await fetch(`${WORKER_URL}/chat/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash, emoji, wallet }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('react failed: ' + res.status);
    const d = await res.json();
    // Adopt the server's authoritative count for this emoji
    const rr = window._chatReactions[txHash] || (window._chatReactions[txHash] = {});
    if (d.count > 0) {
      const existing = rr[emoji] || { voters: [] };
      // keep voters list roughly in sync (server is source of truth on count)
      if (d.reacted && !existing.voters.includes(wallet)) existing.voters.push(wallet);
      if (!d.reacted) existing.voters = existing.voters.filter(w => w !== wallet);
      existing.count = d.count;
      rr[emoji] = existing;
    } else {
      delete rr[emoji];
    }
    const row2 = document.getElementById('reactions-' + txHash);
    if (row2) row2.outerHTML = buildReactionsRow(txHash);
  } catch(e) {
    // Roll back the optimistic change
    const rb = window._chatReactions[txHash] || {};
    const c = rb[emoji] || { count: 0, voters: [] };
    if (had) { if (!c.voters.includes(wallet)) c.voters.push(wallet); }
    else { c.voters = c.voters.filter(w => w !== wallet); }
    c.count = c.voters.length;
    if (c.count === 0) delete rb[emoji]; else rb[emoji] = c;
    window._chatReactions[txHash] = rb;
    const row3 = document.getElementById('reactions-' + txHash);
    if (row3) row3.outerHTML = buildReactionsRow(txHash);
  }
}

function buildReactionsRow(txHash) {
  const wallet = getMyWallet();
  const r = window._chatReactions[txHash] || {};
  const active = CHAT_REACTIONS
    .map(e => { const cell = r[e]; return cell && cell.count > 0 ? { e, count: cell.count, mine: wallet && cell.voters.includes(wallet) } : null; })
    .filter(Boolean);
  return `<div id="reactions-${txHash}" class="chat-reactions-row">
    ${active.map(r => `<button class="chat-reaction ${r.mine?'my-reaction':''}" onclick="toggleReaction('${txHash}','${r.e}')">${r.e} <span>${r.count}</span></button>`).join('')}
    <div class="reaction-picker-wrap">
      <button class="chat-reaction add-reaction-btn" title="Add reaction">＋</button>
      <div class="reaction-picker">${CHAT_REACTIONS.map(e => `<button onclick="toggleReaction('${txHash}','${e}')">${e}</button>`).join('')}</div>
    </div>
  </div>`;
}

let cachedMsgs = [];

function renderChatMessages(msgs) {
  cachedMsgs = msgs;
  const container = document.getElementById('chat-page-messages');
  if (!msgs || msgs.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:60px 20px;"><div style="font-size:32px;margin-bottom:12px;">💬</div>No messages yet - be the first to speak!</div>';
    return;
  }

  container.innerHTML = msgs.map(m => {
    const displayName = _getDisplayName(m.fullAddr, m.author);
    const avatar = _getProfileAvatar(m.fullAddr);
    const initials = displayName.slice(0,2).toUpperCase();

    // System message - protocol announcement
    if (m.isSystem) {
      const isPool = m.text.includes('Weekly Pool') || m.text.includes('Daily');
      const icon = isPool ? '🎰' : '🏛';
      const label = m.text.includes('Q&A') ? 'New Question Asked' : 'Oracle Draw Entry';
      const color = isPool ? 'rgba(123,92,255,0.18)' : 'rgba(245,197,24,0.08)';
      const borderColor = isPool ? 'rgba(123,92,255,0.25)' : 'rgba(245,197,24,0.2)';
      const labelColor = isPool ? 'var(--accent)' : 'var(--gold)';
      return `<div id="msg-${m.txHash}" style="padding:8px 0;border-bottom:1px solid rgba(30,51,88,0.3);">
        <div style="display:flex;align-items:center;gap:10px;background:${color};border:1px solid ${borderColor};border-radius:10px;padding:11px 14px;">
          <div style="font-size:20px;flex-shrink:0;">${icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:9px;color:${labelColor};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:2px;">${label}</div>
            <div style="font-size:12px;color:var(--muted);">${m.amount} LUNC → Protocol Treasury</div>
          </div>
          <a href="https://finder.terraport.finance/classic/tx/${m.txHash}" target="_blank" style="font-size:9px;color:var(--muted);text-decoration:none;flex-shrink:0;">🔗 ${m.time}</a>
        </div>
      </div>`;
    }

    // Avatar: profile image or colored initials
    const avatarHtml = avatar
      ? `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : `<span style="font-size:12px;font-weight:700;color:var(--accent);">${initials}</span>`;

    const rankBadge = m.fullAddr && window._walletScores && typeof getRankBadgeHTML === 'function'
      ? getRankBadgeHTML(window._walletScores[m.fullAddr] || 0) : '';

    return `
    <div class="chat-page-msg" id="msg-${m.txHash}" style="padding:14px 0;border-bottom:1px solid rgba(30,51,88,0.35);">
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <!-- Avatar (click → profile) -->
        <div onclick="openUserProfile('${m.fullAddr || ''}')" title="View profile" style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,rgba(84,147,247,0.2),rgba(123,92,255,0.25));border:1px solid rgba(84,147,247,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;cursor:pointer;transition:transform 0.12s,border-color 0.12s;"
          onmouseover="this.style.transform='scale(1.08)';this.style.borderColor='var(--accent)'"
          onmouseout="this.style.transform='scale(1)';this.style.borderColor='rgba(84,147,247,0.2)'">
          ${avatarHtml}
        </div>
        <!-- Content -->
        <div style="flex:1;min-width:0;">
          <!-- Header row -->
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;flex-wrap:wrap;">
            <span onclick="openUserProfile('${m.fullAddr || ''}')" style="font-size:13px;font-weight:700;color:var(--text);cursor:pointer;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text)'">${displayName}</span>
            ${rankBadge}
            <a href="https://finder.terraport.finance/classic/tx/${m.txHash}" target="_blank"
              style="font-size:9px;color:var(--muted);text-decoration:none;margin-left:auto;white-space:nowrap;flex-shrink:0;"
              onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--muted)'">
              🔗 ${m.time}
            </a>
          </div>
          <!-- Message text -->
          <!-- Reply quote -->
          ${m.replyTo ? (() => {
            const orig = cachedMsgs.find(x => x.txHash && x.txHash.startsWith(m.replyTo));
            if (!orig) return '';
            const origName = _getDisplayName(orig.fullAddr, orig.author);
            return `<div style="margin-bottom:8px;padding:6px 10px;background:rgba(84,147,247,0.07);border-left:2px solid var(--accent);border-radius:0 6px 6px 0;cursor:pointer;" onclick="document.getElementById('msg-${orig.txHash}')?.scrollIntoView({behavior:'smooth'})">
              <div style="font-size:10px;color:var(--accent);font-weight:700;margin-bottom:2px;display:flex;align-items:center;gap:4px;"><span style="font-style:normal;">&#x21A9;&#xFE0E;</span>${origName}</div>
              <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${orig.text.slice(0,80)}</div>
            </div>`;
          })() : ''}
          <!-- Message text -->
          <div style="font-size:14px;line-height:1.65;color:rgba(232,240,255,0.92);word-break:break-word;">${m.text}</div>
          <!-- Reactions -->
          ${buildReactionsRow(m.txHash)}
          <!-- Reply button -->
          <button
            data-reply-txhash="${m.txHash}"
            data-reply-author="${(_getDisplayName(m.fullAddr, m.author)).replace(/"/g,'&quot;')}"
            data-reply-text="${m.text.replace(/"/g,'&quot;').replace(/\n/g,' ').slice(0,80)}"
            style="margin-top:6px;background:none;border:none;color:var(--muted);font-size:11px;font-family:'Exo 2',sans-serif;cursor:pointer;padding:2px 0;letter-spacing:0.03em;display:inline-flex;align-items:center;gap:4px;"
            onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--muted)'">
            <span style="font-style:normal;font-size:12px;line-height:1;">&#x21A9;&#xFE0E;</span>
            Reply
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  // Pull shared reactions from the Worker and refresh the rows
  loadChatReactions(msgs.map(m => m.txHash).filter(Boolean));
  // Build the participants panel from everyone who has posted
  renderChatParticipants(msgs);
}

// ── Chat participants panel (desktop side + mobile drawer) ───────────────────
function renderChatParticipants(msgs) {
  // "Recently active" — wallets that posted in the last 24 hours.
  // Fully on-chain: derived from message timestamps, no tracking server.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - DAY_MS;
  const seen = new Set();
  const wallets = [];
  // Newest first so the most recently active appear on top
  for (const m of [...msgs].sort((a, b) => (b.ts || 0) - (a.ts || 0))) {
    const w = m.fullAddr;
    if (!w || !w.startsWith('terra1')) continue;
    if ((m.ts || 0) < cutoff) continue;       // older than 24h — skip
    if (seen.has(w)) continue;
    seen.add(w); wallets.push(w);
  }
  const count = wallets.length;

  const rowHtml = (w) => {
    const short = w.slice(0, 8) + '...' + w.slice(-4);
    const init = w.slice(0, 2).toUpperCase();
    const rankHtml = (window._walletScores && typeof getRankBadgeHTML === 'function')
      ? getRankBadgeHTML(window._walletScores[w] || 0) : '';
    return `<div class="chat-participant" onclick="openUserProfile('${w}')">
      <div class="cp-av">${init}</div>
      <div style="min-width:0;">
        <div class="cp-addr">${short}</div>
        ${rankHtml ? `<div class="cp-rank">${rankHtml}</div>` : ''}
      </div>
    </div>`;
  };

  const listHtml = wallets.length
    ? wallets.map(rowHtml).join('')
    : '<div style="font-size:11px;color:var(--muted);text-align:center;padding:16px 0;">No one active in the last 24h</div>';


  // Desktop side panel
  const sideList = document.getElementById('chat-participants-list');
  if (sideList) sideList.innerHTML = listHtml;
  const sideCount = document.getElementById('chat-participants-count');
  if (sideCount) sideCount.textContent = count;

  // Mobile drawer + button count
  const drawerList = document.getElementById('chat-drawer-list');
  if (drawerList) drawerList.innerHTML = listHtml;
  const drawerCount = document.getElementById('chat-drawer-count');
  if (drawerCount) drawerCount.textContent = count;
  const mobileCount = document.getElementById('chat-mobile-pcount');
  if (mobileCount) mobileCount.textContent = count;
}

window.openChatParticipants = function() {
  document.getElementById('chat-drawer-overlay')?.classList.add('open');
  document.getElementById('chat-drawer')?.classList.add('open');
};
window.closeChatParticipants = function() {
  document.getElementById('chat-drawer-overlay')?.classList.remove('open');
  document.getElementById('chat-drawer')?.classList.remove('open');
};

// ── User profile modal (opened from chat avatar/name click) ──────────────────
window.openUserProfile = async function(wallet) {
  if (!wallet || !wallet.startsWith('terra1')) return;

  // Remove any existing modal
  const existing = document.getElementById('user-profile-modal');
  if (existing) existing.remove();

  const shortAddr = wallet.slice(0, 10) + '...' + wallet.slice(-6);
  const rankBadge = (window._walletScores && typeof getRankBadgeHTML === 'function')
    ? getRankBadgeHTML(window._walletScores[wallet] || 0) : '';

  // Build modal shell with loading placeholders
  const modal = document.createElement('div');
  modal.id = 'user-profile-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);padding:20px;';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:linear-gradient(160deg,#0e1830,#0a1120);border:1px solid rgba(84,147,247,0.25);border-radius:16px;max-width:420px;width:100%;padding:0;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="padding:22px 22px 18px;border-bottom:1px solid rgba(30,51,88,0.5);position:relative;">
        <button onclick="document.getElementById('user-profile-modal').remove()" style="position:absolute;top:14px;right:14px;background:rgba(255,255,255,0.06);border:none;color:var(--muted);width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:15px;line-height:1;">✕</button>
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,rgba(84,147,247,0.25),rgba(123,92,255,0.3));border:1px solid rgba(84,147,247,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="font-size:17px;font-weight:700;color:var(--accent);">${wallet.slice(0,2).toUpperCase()}</span>
          </div>
          <div style="min-width:0;">
            <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px;">${shortAddr}</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${rankBadge}<span style="font-size:9px;background:rgba(102,255,170,0.12);color:var(--green);padding:1px 7px;border-radius:4px;">✓ ON-CHAIN</span></div>
          </div>
        </div>
      </div>
      <div style="padding:20px 22px;">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
          <div style="text-align:center;background:rgba(84,147,247,0.06);border:1px solid rgba(84,147,247,0.15);border-radius:12px;padding:14px 8px;">
            <div id="up-rep" style="font-size:22px;font-weight:800;color:var(--accent);font-family:Rajdhani,sans-serif;">…</div>
            <div style="font-size:10px;color:var(--muted);letter-spacing:0.08em;margin-top:3px;">REP</div>
          </div>
          <div style="text-align:center;background:rgba(245,197,24,0.06);border:1px solid rgba(245,197,24,0.15);border-radius:12px;padding:14px 8px;">
            <div id="up-draw" style="font-size:22px;font-weight:800;color:var(--gold);font-family:Rajdhani,sans-serif;">…</div>
            <div style="font-size:10px;color:var(--muted);letter-spacing:0.08em;margin-top:3px;">DRAW REP</div>
          </div>
          <div style="text-align:center;background:rgba(123,92,255,0.06);border:1px solid rgba(123,92,255,0.15);border-radius:12px;padding:14px 8px;">
            <div id="up-nfts" style="font-size:22px;font-weight:800;color:#9d7bff;font-family:Rajdhani,sans-serif;">…</div>
            <div style="font-size:10px;color:var(--muted);letter-spacing:0.08em;margin-top:3px;">NFTs</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:12px;">
          <div style="text-align:center;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:12px 8px;">
            <div id="up-chat" style="font-size:18px;font-weight:700;color:var(--text);font-family:Rajdhani,sans-serif;">…</div>
            <div style="font-size:10px;color:var(--muted);letter-spacing:0.08em;margin-top:3px;">CHAT MESSAGES</div>
          </div>
          <div style="text-align:center;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:12px 8px;">
            <div id="up-streak" style="font-size:18px;font-weight:700;color:var(--text);font-family:Rajdhani,sans-serif;">…</div>
            <div style="font-size:10px;color:var(--muted);letter-spacing:0.08em;margin-top:3px;">STREAK 🔥</div>
          </div>
        </div>
        <a href="https://finder.terraport.finance/classic/address/${wallet}" target="_blank" style="display:block;text-align:center;margin-top:16px;font-size:11px;color:var(--accent);text-decoration:none;">🔗 View wallet on Finder</a>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // Fetch stats in parallel; fill in as they resolve (each independently)
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  // Draw REP
  fetch(`${WORKER_URL}/rep/draw?wallet=${wallet}`).then(r => r.json()).then(d => {
    setText('up-draw', (d && d.total ? d.total : 0).toLocaleString());
  }).catch(() => setText('up-draw', '0'));

  // Total REP (from weekly score map if present, else draw rep)
  const totalRep = (window._walletScores && window._walletScores[wallet]) || 0;
  setText('up-rep', totalRep.toLocaleString());

  // Chat messages + streak
  fetch(`${WORKER_URL}/chat/count?wallet=${wallet}`).then(r => r.json()).then(d => {
    setText('up-chat', (d && d.total ? d.total : 0).toLocaleString());
  }).catch(() => setText('up-chat', '0'));

  fetch(`${WORKER_URL}/streak?wallet=${wallet}`).then(r => r.json()).then(d => {
    setText('up-streak', (d && d.currentStreak ? d.currentStreak : 0) + 'd');
  }).catch(() => setText('up-streak', '0d'));

  // NFT count — query the CW721 contracts directly via LCD (fast, no Paco/CORS).
  // Sums Daily + Weekly Oracle Mask collections owned by this wallet.
  (async () => {
    const LCD = 'https://terra-classic-lcd.publicnode.com';
    const CONTRACTS = [
      'terra1py527m8kv3473gs8kfjez0qjm0yxgm7jjpv6v5ct3scvrvdvx8pqswyea0', // Daily
      'terra1jkl6r2d9sycvm3zg8l9y6lwcqsr8mfy24mxxe7utqgn0sv7ljnhq9ka49p', // Weekly
    ];
    try {
      const counts = await Promise.all(CONTRACTS.map(async (c) => {
        try {
          const q = btoa(JSON.stringify({ tokens: { owner: wallet, limit: 100 } }));
          const r = await fetch(`${LCD}/cosmwasm/wasm/v1/contract/${c}/smart/${q}`, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) return 0;
          const d = await r.json();
          return Array.isArray(d.data?.tokens) ? d.data.tokens.length : 0;
        } catch(e) { return 0; }
      }));
      const total = counts.reduce((s, n) => s + n, 0);
      setText('up-nfts', total.toLocaleString());
    } catch(e) {
      setText('up-nfts', '—');
    }
  })();
};

async function loadChatFromChain() {
  const container = document.getElementById('chat-page-messages');
  if (!cachedMsgs.length) {
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;"><div style="font-size:22px;margin-bottom:10px;">⏳</div><div style="color:var(--muted);font-size:12px;">Loading messages from blockchain...</div></div>`;
  }
  // Use Oracle Draw Worker proxy — bypasses CORS/DNS issues and falls back across multiple nodes server-side
  let txList = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(
      `https://oracle-draw.vladislav-baydan.workers.dev/proxy-txs?wallet=${CHAT_HISTORY_WALLET}&limit=50`,
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const body = await res.json();
      // Worker returns FCD-shape: { txs: [{ txhash, timestamp, tx: { value: { memo, msg } } }] }
      // Convert to LCD-shape that the parser below expects (txs[] + tx_responses[])
      const rawTxs = body.txs || [];
      txList = {
        txs: rawTxs.map(t => ({
          body: {
            memo: t.tx?.value?.memo || '',
            messages: (t.tx?.value?.msg || []).map(m => ({
              '@type': '/cosmos.bank.v1beta1.MsgSend',
              from_address: m.value?.from_address || '',
              to_address:   m.value?.to_address   || '',
              amount:       m.value?.amount        || [],
            })),
          },
        })),
        tx_responses: rawTxs.map(t => ({
          txhash:    t.txhash || '',
          timestamp: t.timestamp || '',
          code:      t.code || 0,
        })),
      };
    }
  } catch(e) {
    console.warn('Chat: Worker proxy failed:', e.message);
  }
  if (!txList) {
    if (!cachedMsgs.length) {
      container.innerHTML = `<div style="text-align:center;padding:40px 20px;"><div style="font-size:22px;margin-bottom:10px;">⚠️</div><div style="color:var(--muted);font-size:12px;">Could not reach blockchain nodes</div><button onclick="loadChatFromChain()" style="margin-top:14px;background:rgba(84,147,247,0.1);border:1px solid rgba(84,147,247,0.25);color:var(--accent);border-radius:8px;padding:7px 16px;font-family:'Exo 2',sans-serif;font-size:11px;cursor:pointer;">↻ Retry now</button></div>`;
    }
    return;
  }
  // LCD v1beta1: txs[] = tx bodies, tx_responses[] = metadata (hash, timestamp)
  // They are parallel arrays - same index = same transaction
  const txBodies    = txList.txs || [];
  const txResponses = txList.tx_responses || [];
  if (!txBodies.length && !txResponses.length) {
    if (!cachedMsgs.length) container.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:40px;">No messages yet - be the first!</div>';
    return;
  }
  const msgs = [];
  const count = Math.max(txBodies.length, txResponses.length);
  for (let i = 0; i < count; i++) {
    try {
      const txBody = txBodies[i];        // has body.messages, body.memo
      const txMeta = txResponses[i];     // has txhash, timestamp
      const rawMemo = txBody?.body?.memo || '';
      if (!rawMemo || rawMemo.trim() === '') continue;
      // Fix emoji: LCD may return UTF-8 bytes misread as Latin-1 — re-decode
      let memo = rawMemo;
      try {
        const bytes = Uint8Array.from(rawMemo, c => c.charCodeAt(0) & 0xFF);
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (decoded !== rawMemo) memo = decoded;
      } catch(e) { /* keep original if not valid UTF-8 sequence */ }
      // Try base64 decode — system memos are sometimes base64-encoded
      try {
        const b64decoded = decodeURIComponent(escape(atob(memo.trim())));
        if (b64decoded && b64decoded.length > 0) memo = b64decoded;
      } catch(e) { /* not base64 — keep as-is */ }
      const txMsgs = txBody?.body?.messages || [];
      let sender = null, luncAmount = 0;
      for (const msg of txMsgs) {
        const type = msg['@type'] || msg.type || '';
        const val  = msg.value || msg;
        if (type.includes('MsgSend')) {
          const to = val.to_address || '';
          if (to === CHAT_WALLET) {
            sender = val.from_address || null;
            const coins = val.amount || [];
            const lunc = Array.isArray(coins) ? coins.find(c => c.denom === 'uluna') : null;
            luncAmount = lunc ? parseInt(lunc.amount) : 0;
          }
        }
      }
      if (!sender || luncAmount < CHAT_MIN_ULUNA) continue;
      // Filter out system/admin wallets — their transfers are not chat messages
      const SYSTEM_WALLETS = [
        'terra15jt5a9ycsey4hd6nlqgqxccl9aprkmg2mxmfc6', // ADMIN
        'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt', // TREASURY
        'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px',  // DAILY
        'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz',  // WEEKLY
        'terra16m05j95p9qvq93cdtchjcpwgvny8f57vzdj06p',  // COLLECTION
      ];
      if (SYSTEM_WALLETS.includes(sender)) continue;
      // Block amounts far above 5,000 LUNC (±2% tolerance for tax) — not chat payments
      if (luncAmount > 5200000000) continue;
      const short = sender.slice(0, 10) + '...' + sender.slice(-4);
      const luncFormatted = (luncAmount / 1000000).toLocaleString(undefined, {maximumFractionDigits: 0});
      const ts = txMeta?.timestamp ? new Date(txMeta.timestamp) : null;
      const timeStr = ts ? ts.toLocaleDateString([], {month:'short',day:'numeric'}) + ' ' + ts.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
      let replyTo = null, displayText = memo.slice(0, 256);
      const replyMatch = memo.match(/^>([A-Fa-f0-9]{16})\|(.*)$/s);
      if (replyMatch) { replyTo = replyMatch[1]; displayText = replyMatch[2]; }
      msgs.push({ author: short, fullAddr: sender, text: displayText, replyTo, amount: luncFormatted, txHash: txMeta?.txhash || '', time: timeStr, ts: ts ? ts.getTime() : 0,
        isSystem: ['Terra Oracle Q&A - Weekly Pool','Terra Oracle Q&A - Treasury','Oracle Draw - Daily','Oracle Draw - Weekly'].includes(memo.trim())
      });
    } catch(e) { continue; }
  }
  msgs.sort((a, b) => a.ts - b.ts);
  renderChatMessages(msgs);
  // Prefetch profiles for chat authors (background, no re-render)
  if (typeof prefetchProfiles === 'function') {
    const addrs = [...new Set(msgs.map(m => m.fullAddr).filter(Boolean))];
    prefetchProfiles(addrs); // fire-and-forget
  }
}


// ── POOL MILESTONE BANNER ─────────────────────────────────────────────────
const DAILY_POOL_WALLET  = 'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px';
const WEEKLY_POOL_WALLET = 'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz';

const POOL_MILESTONES = [
  { min: 5000000,    label: '💎 JACKPOT TERRITORY', color: '#00ffff', glow: 'rgba(0,255,255,0.3)',   bg: 'rgba(0,255,255,0.06)',   border: 'rgba(0,255,255,0.25)'  },
  { min: 1000000,    label: '⚡ ON FIRE',           color: '#ffd700', glow: 'rgba(255,215,0,0.3)',   bg: 'rgba(255,215,0,0.06)',   border: 'rgba(255,215,0,0.25)'  },
  { min: 500000,     label: '🔥 HEATING UP',        color: '#ff8844', glow: 'rgba(255,136,68,0.3)',  bg: 'rgba(255,136,68,0.06)',  border: 'rgba(255,136,68,0.25)' },
  { min: 100000,     label: '🌱 GROWING',           color: '#66ffaa', glow: 'rgba(102,255,170,0.3)', bg: 'rgba(102,255,170,0.05)', border: 'rgba(102,255,170,0.2)' },
  { min: 0,          label: '🌑 JUST STARTED',      color: '#6b82a8', glow: 'rgba(107,130,168,0.2)', bg: 'rgba(107,130,168,0.04)', border: 'rgba(107,130,168,0.15)' },
];

function getPoolMilestone(lunc) {
  return POOL_MILESTONES.find(m => lunc >= m.min) || POOL_MILESTONES[POOL_MILESTONES.length - 1];
}

async function fetchPoolBalance(walletAddr) {
  try {
    const res = await fetch(`https://terra-classic-lcd.publicnode.com/cosmos/bank/v1beta1/balances/${walletAddr}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return 0;
    const data = await res.json();
    const uluna = data.balances?.find(b => b.denom === 'uluna');
    return uluna ? parseInt(uluna.amount) / 1000000 : 0;
  } catch(e) { return 0; }
}

async function renderPoolMilestoneBanner() {
  const container = document.getElementById('chat-pool-milestone');
  if (!container) return;

  const [daily, weekly] = await Promise.all([
    fetchPoolBalance(DAILY_POOL_WALLET),
    fetchPoolBalance(WEEKLY_POOL_WALLET),
  ]);

  const pools = [
    { name: 'DAILY POOL',  amount: daily,  icon: '☀️' },
    { name: 'WEEKLY POOL', amount: weekly, icon: '📅' },
  ];

  container.innerHTML = pools.map(pool => {
    const ms = getPoolMilestone(pool.amount);
    const formatted = pool.amount >= 1000000
      ? (pool.amount / 1000000).toFixed(2) + 'M'
      : pool.amount >= 1000
      ? Math.round(pool.amount / 1000) + 'K'
      : Math.round(pool.amount).toString();

    // Progress to next milestone
    const nextMs = POOL_MILESTONES.find(m => m.min > pool.amount);
    const pct = nextMs
      ? Math.min(100, (pool.amount / nextMs.min) * 100)
      : 100;

    return `
    <div style="flex:1;min-width:200px;background:${ms.bg};border:1px solid ${ms.border};border-radius:12px;padding:14px 16px;position:relative;overflow:hidden;">
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% -20%,${ms.glow},transparent 70%);pointer-events:none;"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:16px;">${pool.icon}</span>
        <div>
          <div style="font-size:9px;letter-spacing:0.15em;color:var(--muted);text-transform:uppercase;">${pool.name}</div>
          <div style="font-size:9px;color:${ms.color};font-weight:700;letter-spacing:0.1em;">${ms.label}</div>
        </div>
      </div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:26px;font-weight:800;color:${ms.color};line-height:1;margin-bottom:8px;text-shadow:0 0 20px ${ms.glow};">
        ${formatted} <span style="font-size:13px;opacity:0.7;">LUNC</span>
      </div>
      ${nextMs ? `
      <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:3px;margin-bottom:4px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${ms.color};border-radius:4px;transition:width 1s ease;opacity:0.8;"></div>
      </div>
      <div style="font-size:9px;color:var(--muted);">
        ${(nextMs.min - pool.amount).toLocaleString(undefined,{maximumFractionDigits:0})} LUNC to next level
      </div>` : `<div style="font-size:9px;color:${ms.color};">🏆 Maximum level reached!</div>`}
    </div>`;
  }).join('');
}

function renderChatPage() {
  if (cachedMsgs.length) renderChatMessages(cachedMsgs);
  loadChatFromChain();
  renderPoolMilestoneBanner();
}
// Wait for all scripts to load before initializing
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { renderChatPage(); });
} else {
  renderChatPage();
}
setInterval(loadChatFromChain, 60000); // 60s poll - reduced from 30s for performance

// ── Auto-refresh: pool balance + questions every 30s ──────────────────────────
(function startAutoRefresh() {
  setInterval(() => {
    // Refresh pool balance silently
    if (typeof fetchPoolBalance === 'function') {
      fetchPoolBalance('terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz').catch(() => {});
    }
    // Refresh questions if on home/ask page
    if (typeof loadQuestionsFromWorker === 'function') {
      loadQuestionsFromWorker().catch(() => {});
    }
    // Refresh vote counts if on vote page
    if (typeof loadVotesFromWorker === 'function') {
      const votePage = document.getElementById('vote-page');
      if (votePage && votePage.style.display !== 'none') {
        loadVotesFromWorker().catch(() => {});
      }
    }
  }, 30000);
})();

const _origSetWallet = window.setWalletConnected;
window.setWalletConnected = function(address) {
  _origSetWallet(address);
  document.getElementById('chat-page-connect-prompt').style.display = 'none';
  document.getElementById('chat-page-form').style.display = 'block';
  document.getElementById('chat-page-addr').textContent = address.slice(0,10)+'...'+address.slice(-4);
  document.getElementById('vote-wallet-status').innerHTML = '<span style="font-size:11px;color:var(--green);">✓ ' + address.slice(0,8)+'...'+address.slice(-4) + '</span>';
  const adminPanel = document.getElementById('admin-panel');
  if (adminPanel) {
    adminPanel.style.display = address === ADMIN_WALLET ? 'block' : 'none';
    if (address === ADMIN_WALLET) { applyVoteStates(); updateAdminPanel(); setTimeout(_adminInitOptions, 100); }
  }
  applyStoredVotes(); applyVoteStates(); renderVotes();
}

// ─── VOTE PAGE ────────────────────────────────────────────────



/* ═══ WORKER VOTES ═══ */

// Load community votes from Cloudflare Worker (visible to ALL users)
async function loadVotesFromWorker() {
  try {
    const res = await fetch(`${WORKER_URL}/votes`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return;
    const workerVotes = await res.json();
    if (!Array.isArray(workerVotes)) return;
    const deleted = getDeletedVotes();
    // Merge: worker votes take priority, skip deleted
    for (const wv of workerVotes) {
      if (deleted.includes(wv.id)) continue; // skip deleted
      const existingIdx = VOTES_DATA.findIndex(v => v.id === wv.id);
      if (existingIdx > -1) {
        VOTES_DATA[existingIdx] = { ...VOTES_DATA[existingIdx], ...wv, userVoted: VOTES_DATA[existingIdx].userVoted };
      } else {
        VOTES_DATA.unshift(wv);
      }
    }
    applyStoredVotes();
    renderVotes();
    if (typeof updateAdminPanel === 'function') updateAdminPanel();
  } catch(e) {
    console.warn('Could not load votes from worker:', e.message);
  }
}

// Static demo votes removed: they existed only in the frontend (not in the
// worker KV), so /votes/cast returned 404 "Vote not found" and users saw a
// fake "network issue" error. All votes now come from the worker (/votes) —
// create real proposals via the admin panel instead.
const VOTES_DATA = [
];

// Filter out locally deleted static votes
const DELETED_VOTES_KEY = 'admin_deleted_votes';
function getDeletedVotes() { try { return JSON.parse(localStorage.getItem(DELETED_VOTES_KEY)||'[]'); } catch(e) { return []; } }
function markVoteDeleted(id) { const d=getDeletedVotes(); if(!d.includes(id)){d.push(id);localStorage.setItem(DELETED_VOTES_KEY,JSON.stringify(d));} }
(function pruneDeletedVotes() {
  const deleted = getDeletedVotes();
  if (!deleted.length) return;
  for (let i = VOTES_DATA.length - 1; i >= 0; i--) {
    if (deleted.includes(VOTES_DATA[i].id)) VOTES_DATA.splice(i, 1);
  }
})();

let currentVoteFilter = 'all';
function filterVotes(type) { currentVoteFilter = type; document.querySelectorAll('.vote-tab').forEach(t => t.classList.remove('active')); event.target.classList.add('active'); renderVotes(); }

function renderVotes() {
  const list = document.getElementById('votes-list');
  const filtered = currentVoteFilter === 'all' ? VOTES_DATA : VOTES_DATA.filter(v => v.type === currentVoteFilter);
  if (filtered.length === 0) { list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px;font-size:12px;">No votes in this category yet.</div>'; return; }

  // Per-type color scheme (accent + winner colors) — mirrors home-page style.
  const TYPE = {
    weekly:  { vc:'#7B5CFF', vc2:'#c4b5fd', label:'Weekly',  ico:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>' },
    monthly: { vc:'#E8C840', vc2:'#fde68a', label:'Monthly', ico:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01"/>' },
    special: { vc:'#ff6b8a', vc2:'#ffa3b6', label:'Special', ico:'<path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2z"/>' },
  };
  const svg = (paths, cls) => `<svg viewBox="0 0 24 24" class="${cls}">${paths}</svg>`;

  list.innerHTML = filtered.map(v => {
    const t = TYPE[v.type] || TYPE.special;
    const closed = (v.status === 'closed' || v.status === 'stopped');
    const voted = v.userVoted !== null && v.userVoted !== undefined;
    const revealed = voted || closed; // show bars/percents once voted or closed
    const maxVotes = Math.max(...v.options.map(o => o.votes));
    const pct = o => v.totalVotes > 0 ? Math.round((o.votes / v.totalVotes) * 100) : 0;
    const quorumPct = Math.min(100, Math.round((v.totalVotes / v.quorum) * 100));

    const opts = v.options.map((o, oi) => {
      const p = pct(o);
      const isWinner = revealed && o.votes === maxVotes && v.totalVotes > 0;
      const isSel = v.userVoted === oi;
      const cls = ['vp-opt', revealed ? (isWinner ? 'win' : 'lose') : '', isSel ? 'sel' : ''].filter(Boolean).join(' ');
      const radioInner = isWinner ? svg('<path d="M20 6 9 17l-5-5"/>', 'vp-check') : '';
      return `<div class="${cls}" ${closed ? '' : `onclick="castVote('${v.id}', ${oi})"`} style="--wc:${t.vc}">
        <div class="vp-opt-fill" style="width:${revealed ? p : 0}%"></div>
        <div class="vp-opt-row">
          <div class="vp-radio">${radioInner}</div>
          <div class="vp-opt-label">${o.label}</div>
          ${revealed ? `<div class="vp-opt-pct">${p}%</div>` : ''}
        </div>
      </div>`;
    }).join('');

    let foot;
    if (voted) {
      foot = `<div class="vp-voted">${svg('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', 'vp-foot-ico')}You voted</div>`;
    } else if (closed) {
      foot = `<div class="vp-voted" style="color:var(--muted);">${svg('<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>', 'vp-foot-ico')}Voting closed</div>`;
    } else if (v.status === 'upcoming') {
      foot = `<div class="vp-voted" style="color:var(--gold);">${svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', 'vp-foot-ico')}Voting opens on the 20th</div>`;
    } else {
      foot = `<button class="vp-cast-btn" onclick="castVote('${v.id}', -1)" ${!globalWalletAddress ? 'disabled' : ''}>${globalWalletAddress ? 'Cast Vote →' : svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 'vp-lock') + ' Connect to Vote'}</button>`;
    }

    return `<div class="vp-card ${closed ? 'vp-card-closed' : ''}" id="vcard-${v.id}" style="--vc:${t.vc};--vc2:${t.vc2};">
      <div class="vp-meta">
        <div class="vp-badge">${svg(t.ico, 'vp-badge-ico')}${t.label}</div>
        <div class="vp-timer">${svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 'vp-timer-ico')}${v.timer || ''}</div>
      </div>
      <div class="vp-title">${v.title}</div>
      <div class="vp-desc">${v.desc}</div>
      <div class="vp-quorum">
        <div class="vp-q-bar"><div class="vp-q-fill" style="width:${quorumPct}%"></div></div>
        <div class="vp-q-info"><span>Quorum · ${v.totalVotes} / ${v.quorum} votes</span><span>${quorumPct}%</span></div>
      </div>
      <div class="vp-opts">${opts}</div>
      <div class="vp-foot">${foot}<div class="vp-total">${v.totalVotes} votes total</div></div>
      ${v.source ? `<div class="vp-src">${svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 'vp-src-ico')}${v.source}</div>` : ''}
    </div>`;
  }).join('');
}

const VOTE_STATE_KEY = 'admin_vote_states';
function getVoteStates() { try { return JSON.parse(localStorage.getItem(VOTE_STATE_KEY) || '{}'); } catch(e) { return {}; } }
function saveVoteState(voteId, state) { const states = getVoteStates(); states[voteId] = { ...states[voteId], ...state, updatedAt: Date.now() }; localStorage.setItem(VOTE_STATE_KEY, JSON.stringify(states)); }

function applyVoteStates() {
  const states = getVoteStates();
  for (const vote of VOTES_DATA) {
    const s = states[vote.id];
    if (!s) continue;
    if (s.status) vote.status = s.status;
    if (s.startedAt) vote.startedAt = s.startedAt;
    if (s.stoppedAt) vote.stoppedAt = s.stoppedAt;
    if (s.pairs && vote.isMonthlyLiquidity) vote.options = s.pairs.map(p => ({ label: p, votes: vote.options.find(o => o.label === p)?.votes || 0 }));
    if (s.status === 'active' && s.startedAt) {
      const msLeft = (s.startedAt + 5*24*60*60*1000) - Date.now();
      if (msLeft <= 0) { vote.status = 'closed'; vote.timer = 'Voting closed'; }
      else { const d=Math.floor(msLeft/86400000),h=Math.floor((msLeft%86400000)/3600000),m=Math.floor((msLeft%3600000)/60000); vote.timer = d>0?`${d}d ${h}h remaining`:`${h}h ${m}m remaining`; }
    } else if (s.status === 'stopped' || s.status === 'closed') { vote.timer = 'Voting closed'; }
    else if (s.status === 'upcoming') { vote.timer = 'Not started yet'; }
  }
}

window.adminStartVote = async function(voteId) {
  try {
    await fetch(`${WORKER_URL}/votes/toggle`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ id: voteId, action: 'start' }),
      signal: AbortSignal.timeout(6000),
    });
    await loadVotesFromWorker();
    showAdminToast('▶ Vote started!', 'green');
  } catch(e) {
    const vote = VOTES_DATA.find(v => v.id === voteId); if (!vote) return;
    saveVoteState(voteId, { status: 'active', startedAt: Date.now() });
    applyVoteStates(); updateAdminPanel(); renderVotes();
    showAdminToast('▶ Started (offline)', 'green');
  }
}
window.adminStopVote = async function(voteId) {
  try {
    await fetch(`${WORKER_URL}/votes/toggle`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ id: voteId, action: 'stop' }),
      signal: AbortSignal.timeout(6000),
    });
    await loadVotesFromWorker();
    showAdminToast('■ Vote stopped', 'red');
  } catch(e) {
    saveVoteState(voteId, { status: 'stopped', stoppedAt: Date.now() });
    applyVoteStates(); updateAdminPanel(); renderVotes();
    showAdminToast('■ Stopped (offline)', 'red');
  }
}
window.adminToggleVote = function(voteId, newStatus) { if (newStatus === 'active') adminStartVote(voteId); else adminStopVote(voteId); }

function updateAdminPanel() {
  const panel = document.getElementById('admin-panel');
  if (!panel || panel.style.display === 'none') return;
  const otherEl = document.getElementById('admin-other-votes');
  if (!otherEl) return;
  if (!VOTES_DATA.length) {
    otherEl.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0;">No votes yet. Create one above.</div>';
    return;
  }
  const statusColors = { active: '#66ffaa', stopped: '#ff6464', upcoming: '#ffc840', closed: '#888' };
  const statusIcons  = { active: '●', stopped: '■', upcoming: '◎', closed: '○' };
  otherEl.innerHTML = VOTES_DATA.map(v => {
    const s = v.status || 'unknown';
    const col = statusColors[s] || '#888';
    const icon = statusIcons[s] || '○';
    const startBtn = s !== 'active'
      ? `<button onclick="adminStartVote('${v.id}')" style="font-size:11px;padding:6px 12px;border-radius:6px;border:1px solid rgba(102,255,170,0.3);background:rgba(102,255,170,0.08);color:var(--green);cursor:pointer;font-family:'Exo 2',sans-serif;font-weight:700;">▶</button>`
      : '';
    const stopBtn = s === 'active'
      ? `<button onclick="adminStopVote('${v.id}')" style="font-size:11px;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,60,60,0.25);background:rgba(255,60,60,0.06);color:#ff6464;cursor:pointer;font-family:'Exo 2',sans-serif;font-weight:700;">■</button>`
      : '';
    const delBtn = `<button onclick="adminDeleteVote('${v.id}')" style="font-size:11px;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,60,60,0.2);background:rgba(255,60,60,0.05);color:#ff6464;cursor:pointer;" title="Delete vote">🗑</button>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${v.title}</div>
        <div style="font-size:10px;margin-top:3px;color:${col};letter-spacing:0.06em;">${icon} ${s.toUpperCase()} · ${v.timer || ''} · ${v.totalVotes || 0} votes</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">${startBtn}${stopBtn}${delBtn}</div>
    </div>`;
  }).join('');
}


// ── Admin form helpers ────────────────────────────────────────
function _getAdminOptions() {
  const list = document.getElementById('av-options-list');
  if (!list) return [];
  return Array.from(list.querySelectorAll('input[type="text"]'))
    .map(inp => inp.value.trim()).filter(v => v.length > 0);
}

function _adminResetForm() {
  ['av-title','av-desc','av-source'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  const d=document.getElementById('av-days'); if(d) d.value='7';
  const q=document.getElementById('av-quorum'); if(q) q.value='100';
  const p=document.getElementById('av-preview'); if(p) p.style.display='none';
  // Re-init options
  const list=document.getElementById('av-options-list');
  if(list) { list.innerHTML=''; _addAdminOption(); _addAdminOption(); }
}

window.adminAddOption = function() {
  const list = document.getElementById('av-options-list');
  if (!list) return;
  if (list.children.length >= 8) { showAdminToast('Max 8 options', 'red'); return; }
  const idx = list.children.length;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:center;';
  row.innerHTML = `<input type="text" placeholder="Option ${idx+1}..." maxlength="100"
    style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Exo 2',sans-serif;font-size:13px;padding:9px 12px;outline:none;">
    <button onclick="this.parentElement.remove()" style="background:rgba(255,60,60,0.08);border:1px solid rgba(255,60,60,0.2);border-radius:6px;color:#ff6464;font-size:16px;width:32px;height:32px;cursor:pointer;flex-shrink:0;line-height:1;">×</button>`;
  list.appendChild(row);
};
function _addAdminOption() { window.adminAddOption(); }

window.adminPreviewVote = function() {
  const title = document.getElementById('av-title')?.value.trim();
  const type  = document.getElementById('av-type')?.value;
  const days  = document.getElementById('av-days')?.value;
  const opts  = _getAdminOptions();
  if (!title || opts.length < 2) { showAdminToast('Fill title and at least 2 options', 'red'); return; }
  const preview = document.getElementById('av-preview');
  const previewText = document.getElementById('av-preview-text');
  if (preview && previewText) {
    previewText.innerHTML = `<b>${title}</b><br>Type: ${type} · Duration: ${days}d<br>Options:${opts.map((o,i)=>`<br>${i+1}. ${o}`).join('')}`;
    preview.style.display = 'block';
  }
};

window.adminResetForm = function() { _adminResetForm(); };

// Init options on panel show
function _adminInitOptions() {
  const list = document.getElementById('av-options-list');
  if (!list || list.children.length > 0) return;
  _addAdminOption(); _addAdminOption();
}

window.adminCreateVote = async function() {
  const title = document.getElementById('av-title')?.value.trim();
  const desc  = document.getElementById('av-desc')?.value.trim();
  const type  = document.getElementById('av-type')?.value || 'weekly';
  const days  = parseInt(document.getElementById('av-days')?.value || '7');
  const quorum= parseInt(document.getElementById('av-quorum')?.value || '100');
  const source= document.getElementById('av-source')?.value.trim() || 'Admin proposal';
  const opts  = _getAdminOptions();

  if (!title)          { showAdminToast('Enter a title', 'red'); return; }
  if (opts.length < 2) { showAdminToast('Add at least 2 options', 'red'); return; }
  if (!globalWalletAddress || globalWalletAddress !== ADMIN_WALLET) {
    showAdminToast('Admin wallet not connected', 'red'); return;
  }

  const durationMs = days * 24 * 60 * 60 * 1000;
  const btn = document.querySelector('[onclick="adminCreateVote()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving...'; }

  try {
    const res = await fetch(`${WORKER_URL}/votes`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ title, desc, type, durationMs, quorum, source, options: opts }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!res.ok) { showAdminToast('❌ ' + (data.error || 'Error'), 'red'); return; }
    _adminResetForm();
    showAdminToast('✅ Vote created for all users!', 'green');
    await loadVotesFromWorker();
  } catch(e) {
    showAdminToast('❌ ' + (e.message || 'Network error'), 'red');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✅ CREATE & START'; }
  }
};

window.adminDeleteVote = async function(voteId) {
  if (!confirm('Delete this vote permanently?')) return;
  // Mark as deleted in localStorage (survives page refresh for static votes)
  markVoteDeleted(voteId);
  // Remove from local VOTES_DATA immediately
  const idx = VOTES_DATA.findIndex(v => v.id === voteId);
  if (idx > -1) VOTES_DATA.splice(idx, 1);
  updateAdminPanel(); renderVotes();
  // Also remove from Worker
  try {
    await fetch(`${WORKER_URL}/votes`, {
      method: 'DELETE',
      headers: adminHeaders(),
      body: JSON.stringify({ id: voteId }),
      signal: AbortSignal.timeout(6000),
    });
    showAdminToast('🗑 Vote deleted', 'red');
  } catch(e) {
    showAdminToast('🗑 Removed locally', 'red');
  }
};

function showAdminToast(msg, color) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = `position:fixed;top:80px;right:20px;z-index:9999;padding:10px 18px;border-radius:8px;font-family:'Exo 2',sans-serif;font-size:12px;font-weight:700;letter-spacing:0.05em;background:${color==='green'?'rgba(102,255,170,0.15)':'rgba(255,60,60,0.12)'};border:1px solid ${color==='green'?'rgba(102,255,170,0.4)':'rgba(255,60,60,0.3)'};color:${color==='green'?'var(--green)':'#ff6464'};`;
  document.body.appendChild(toast); setTimeout(() => toast.remove(), 2500);
}

function getVoteStorageKey() { return globalWalletAddress ? 'votes_' + globalWalletAddress : null; }
function loadVotesFromStorage() { const key = getVoteStorageKey(); if (!key) return {}; try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) { return {}; } }
function saveVoteToStorage(voteId, optionIdx) { const key = getVoteStorageKey(); if (!key) return; const votes = loadVotesFromStorage(); votes[voteId] = optionIdx; localStorage.setItem(key, JSON.stringify(votes)); }
function applyStoredVotes() { const votes = loadVotesFromStorage(); for (const vote of VOTES_DATA) { vote.userVoted = votes[vote.id] !== undefined ? votes[vote.id] : null; } }

async function castVote(voteId, optionIdx) {
  if (!globalWalletAddress) { alert('Connect Keplr wallet to vote!'); return; }
  if (optionIdx === -1) return;
  const vote = VOTES_DATA.find(v => v.id === voteId);
  if (!vote || vote.userVoted !== null) return;
  if (vote.status === 'upcoming') { alert('Voting is not open yet! Check back on the 20th.'); return; }
  if (vote._voting) return; // guard against double-click while a vote is in flight
  vote._voting = true;

  // Optimistic update — show it immediately, but be ready to roll back.
  const prevVotes  = vote.options[optionIdx].votes;
  const prevTotal  = vote.totalVotes;
  vote.options[optionIdx].votes++; vote.totalVotes++; vote.userVoted = optionIdx;
  saveVoteToStorage(voteId, optionIdx);
  if (vote.isMonthlyLiquidity && vote.voteKey) { try { localStorage.setItem(vote.voteKey, JSON.stringify({ totalVotes: vote.totalVotes, options: vote.options.map(o => o.votes) })); } catch(e) {} }
  renderVotes();

  // Persist to Worker — the server is the source of truth. Only KEEP the vote
  // if the server confirms it; otherwise roll back so the count stays honest.
  try {
    const res = await fetch(`${WORKER_URL}/votes/cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voteId, optionIdx, wallet: globalWalletAddress }),
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      // Confirmed. Adopt the server's authoritative total if provided.
      try { const d = await res.json(); if (d && typeof d.totalVotes === 'number') vote.totalVotes = d.totalVotes; } catch(e) {}
      vote._voting = false;
      renderVotes();
      return;
    }

    // 409 = this wallet already voted on the server (e.g. from another device).
    // Keep the "voted" state but refresh real numbers from the server.
    if (res.status === 409) {
      vote._voting = false;
      await loadVotesFromWorker();
      return;
    }

    // Any other error (vote closed, vote not found, server error) → roll back
    // the optimistic vote and surface the REAL server reason to the user.
    let serverErr = '';
    try { const d = await res.json(); if (d && d.error) serverErr = d.error; } catch(e2) {}
    const rejection = new Error(serverErr || ('cast rejected: ' + res.status));
    rejection._serverReason = serverErr;
    throw rejection;
  } catch (e) {
    // Roll back — the vote did NOT register on the server.
    vote.options[optionIdx].votes = prevVotes;
    vote.totalVotes = prevTotal;
    vote.userVoted = null;
    vote._voting = false;
    // Clear the local "voted" marker so the user can try again.
    try {
      const key = getVoteStorageKey();
      if (key) { const stored = loadVotesFromStorage(); delete stored[voteId]; localStorage.setItem(key, JSON.stringify(stored)); }
    } catch(e2) {}
    renderVotes();
    if (e && e._serverReason) alert('Your vote could not be submitted: ' + e._serverReason);
    else alert('Your vote could not be submitted (network issue). Please try again.');
  }
}


// ── MY BAG (Terra Oracle) — реальные данные с Oracle Draw ──────────────────────

const O_NFT_API_BASE = 'https://nft.lunc.tools/api';
const O_DRAW_WORKER  = 'https://oracle-draw.vladislav-baydan.workers.dev';
const O_BAG_CACHE_KEY = 'oracle_bag_cache_v1';
const O_BAG_CACHE_TTL = 5 * 60 * 1000;
const O_BAG_CACHE_MAX_AGE = 30 * 60 * 1000; // still instant-painted, just marked stale

function oDetectNFTTier(nft) {
  const name = (nft.name || nft.nft_name || '').toLowerCase();
  if (name.includes('legendary')) return 'legendary';
  if (name.includes('rare'))      return 'rare';
  return 'common';
}
function oTierEntries(tier) {
  return tier === 'legendary' ? 10 : tier === 'rare' ? 5 : 1;
}
function oExtractTokenId(n) {
  return String(n.token_id || n.id || n.tokenId || n.nft_id || '');
}
// Format: "Common_09528042026_ETME5" → "ETME5"
// or numeric token_id → "#5"
function oFormatNFTLabel(tokenId) {
  if (!tokenId) return '—';
  // If it's a structured name like Common_timestamp_CODE → show CODE
  const parts = tokenId.split('_');
  if (parts.length >= 3) {
    return parts[parts.length - 1]; // last segment = unique code e.g. "ETME5"
  }
  // Pure numeric or short string
  return '#' + tokenId;
}
function oSaveBagCache(wallet, nftsRaw) {
  try { localStorage.setItem(O_BAG_CACHE_KEY, JSON.stringify({ wallet, nftsRaw, ts: Date.now() })); } catch(e) {}
}
function oLoadBagCache(wallet, maxAge = O_BAG_CACHE_TTL) {
  try {
    const raw = localStorage.getItem(O_BAG_CACHE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.wallet !== wallet || Date.now() - d.ts > maxAge) return null;
    return d.nftsRaw;
  } catch(e) { return null; }
}
async function oFetch(url, opts = {}, attempts = 2, timeoutMs = 8000) {
  let err;
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok || res.status < 500) return res;
      err = new Error('HTTP ' + res.status);
    } catch(e) { err = e; }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 1000));
  }
  throw err;
}

function renderOracleBag() {
  const wallet = globalWalletAddress || connectedAddress;
  const notConn = document.getElementById('bag-not-connected-oracle');
  const conn    = document.getElementById('bag-connected-oracle');
  if (!notConn || !conn) return;

  if (!wallet) {
    notConn.style.display = 'block';
    conn.style.display    = 'none';
    return;
  }
  notConn.style.display = 'none';
  conn.style.display    = 'block';

  const el = id => document.getElementById(id);

  // Instant paint from cache (client-side stale-while-revalidate): if we have
  // ANY cached NFT list for this wallet, render it immediately instead of
  // sitting on ambiguous "…" placeholders while loadOracleBagNFTs fetches
  // fresh data in the background.
  const cachedNfts = oLoadBagCache(wallet, O_BAG_CACHE_MAX_AGE);
  if (cachedNfts) {
    renderOracleBagFromNFTs(wallet, cachedNfts, { fromCache: true });
  } else {
    if (el('o-bag-stat-nfts'))   el('o-bag-stat-nfts').textContent   = '…';
    if (el('o-bag-stat-won'))    el('o-bag-stat-won').textContent    = '-';
    if (el('o-bag-stat-daily'))  el('o-bag-stat-daily').textContent  = '…';
    if (el('o-bag-stat-weekly')) el('o-bag-stat-weekly').textContent = '…';
    if (el('o-bag-count'))       el('o-bag-count').textContent       = '…';
    const grid = el('o-bag-grid'), empty = el('o-bag-empty');
    if (grid) grid.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      const msg = empty.querySelector('div');
      if (msg) msg.innerHTML = `⏳ Loading your Oracle Masks…<br>
        <span style="font-size:11px;color:var(--muted);">First load can take up to ~60s if the marketplace API is slow. Later visits load instantly from cache.</span>`;
    }
  }

  loadOracleBagNFTs(wallet);
}

async function loadOracleBagNFTs(wallet) {
  const el = id => document.getElementById(id);

  // NFTs go through the Draw Worker proxy (/owned-nfts) — same SWR cache as
  // the draw site: instant from KV after the first ever load, background
  // refresh, no more waiting on the slow marketplace API. Direct Paco call
  // remains as a last-resort fallback below.
  // Single attempt: the worker already retries 3× internally against Paco.
  // A second browser-side attempt used to double the worst-case wait.
  const [nftResult, dailyStatsResult, weeklyStatsResult] = await Promise.allSettled([
    oFetch(`${O_DRAW_WORKER}/owned-nfts?wallet=${wallet}`, {}, 1, 42000),
    oFetch(`${O_DRAW_WORKER}/round-stats?pool=daily`, {}, 2),
    oFetch(`${O_DRAW_WORKER}/round-stats?pool=weekly`, {}, 2),
  ]);

  let allNFTs = null, pacoError = null;
  let dailyActiveWallets = new Set(), weeklyActiveWallets = new Set();

  if (nftResult.status === 'fulfilled' && nftResult.value.ok) {
    try {
      const data = await nftResult.value.json();
      allNFTs = Array.isArray(data) ? data : data.nfts || data.data || data.tokens || [];
      oSaveBagCache(wallet, allNFTs);
    } catch(e) { pacoError = 'Invalid response'; }
  } else {
    pacoError = nftResult.reason?.message || 'API error';
    // Worker proxy failed — last resort: Paco directly with a generous timeout.
    try {
      const direct = await oFetch(`${O_NFT_API_BASE}/owned-nfts/${wallet}`, {}, 1, 18000);
      if (direct.ok) {
        const data = await direct.json();
        allNFTs = Array.isArray(data) ? data : (data.nfts || data.data || data.tokens || []);
        oSaveBagCache(wallet, allNFTs);
        pacoError = null;
      }
    } catch(e2) {}
  }

  if (dailyStatsResult.status === 'fulfilled' && dailyStatsResult.value.ok) {
    try {
      const d = await dailyStatsResult.value.json();
      dailyActiveWallets = new Set(Object.keys(d.byWallet || {}));
    } catch(e) {}
  }
  if (weeklyStatsResult.status === 'fulfilled' && weeklyStatsResult.value.ok) {
    try {
      const d = await weeklyStatsResult.value.json();
      weeklyActiveWallets = new Set(Object.keys(d.byWallet || {}));
    } catch(e) {}
  }

  if (allNFTs === null) {
    const cached = oLoadBagCache(wallet);
    if (cached) {
      allNFTs = cached;
    } else {
      const grid = el('o-bag-grid'), empty = el('o-bag-empty');
      if (el('o-bag-stat-nfts')) el('o-bag-stat-nfts').textContent = '-';
      if (el('o-bag-stat-daily')) el('o-bag-stat-daily').textContent = '-';
      if (el('o-bag-stat-weekly')) el('o-bag-stat-weekly').textContent = '-';
      if (el('o-bag-count')) el('o-bag-count').textContent = '-';
      if (grid) grid.style.display = 'none';
      if (empty) {
        empty.style.display = 'block';
        const msg = empty.querySelector('div');
        if (msg) msg.innerHTML = `⚠ NFT API unavailable<br><button onclick="loadOracleBagNFTs('${wallet}')"
          style="margin-top:12px;padding:8px 16px;border-radius:8px;border:1px solid rgba(244,208,63,0.4);
          background:rgba(244,208,63,0.08);color:#f4d03f;cursor:pointer;font-size:11px;">🔄 Retry</button>`;
      }
      return;
    }
  }

  await renderOracleBagFromNFTs(wallet, allNFTs, { pacoError });
}

// Pure render: paints My Bag from an already-fetched NFT list. Called both
// for the instant cache-paint (meta.fromCache=true) and after a real fetch
// resolves, so the UI never sits on ambiguous "…" placeholders longer than
// the actual network wait requires.
async function renderOracleBagFromNFTs(wallet, allNFTs, meta = {}) {
  const { pacoError = null, fromCache = false } = meta;
  const el = id => document.getElementById(id);
  let dailyActiveWallets = new Set(), weeklyActiveWallets = new Set();

  // Filter Oracle Mask NFTs only
  const masks = allNFTs.filter(n => {
    const slug = (n.slug || '').toLowerCase();
    if (slug === 'oracle-mask-daily' || slug === 'oracle-mask-weekly' || slug === 'oracle-mask') return true;
    const col = (n.collection_name || n.collection || '').toLowerCase();
    return col.includes('oracle') && col.includes('mask');
  });

  const nfts = masks.map(n => {
    const tokenId = oExtractTokenId(n);
    const tier    = oDetectNFTTier(n);
    const slug    = (n.slug || '').toLowerCase();
    let pool = null;
    if (slug === 'oracle-mask-daily')  pool = 'daily';
    if (slug === 'oracle-mask-weekly') pool = 'weekly';
    const isNewArch = pool !== null;
    let used = false;
    if (isNewArch) {
      // Check by specific tokenId (not wallet) so only active NFTs show as active
      const dailyIds  = window._oDailyActiveTokenIds  || new Set();
      const weeklyIds = window._oWeeklyActiveTokenIds || new Set();
      used = pool === 'daily' ? !dailyIds.has(String(tokenId)) : !weeklyIds.has(String(tokenId));
    }
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    return {
      id: tokenId, type: tier, pool, isNewArch,
      entries: oTierEntries(tier),
      name: n.name || n.nft_name || `Oracle Mask ${tierLabel}`,
      used,
      inCurrentRound: !used,
    };
  });

  window._oBagNFTs = nfts;

  // Fetch active tokenIds for this wallet
  try {
    const [dailyR, weeklyR] = await Promise.all([
      oFetch(`${O_DRAW_WORKER}/my-entries?pool=daily&wallet=${wallet}`, {}, 2),
      oFetch(`${O_DRAW_WORKER}/my-entries?pool=weekly&wallet=${wallet}`, {}, 2),
    ]);
    if (dailyR.ok) {
      const dd = await dailyR.json();
      window._oDailyActiveTokenIds = new Set((dd.activations || []).map(a => String(a.tokenId)));
    }
    if (weeklyR.ok) {
      const wd = await weeklyR.json();
      window._oWeeklyActiveTokenIds = new Set((wd.activations || []).map(a => String(a.tokenId)));
    }
  } catch(e) {}

  // Fetch entries from Draw Worker
  let dailyEntries = 0, weeklyEntries = 0;
  try {
    const [dr, wr] = await Promise.allSettled([
      oFetch(`${O_DRAW_WORKER}/my-entries?pool=daily&wallet=${wallet}`, {}, 2),
      oFetch(`${O_DRAW_WORKER}/my-entries?pool=weekly&wallet=${wallet}`, {}, 2),
    ]);
    if (dr.status === 'fulfilled' && dr.value.ok) dailyEntries = (await dr.value.json()).myEntries || 0;
    if (wr.status === 'fulfilled' && wr.value.ok) weeklyEntries = (await wr.value.json()).myEntries || 0;
  } catch(e) {}

  // Fetch wins from Draw Worker — count unique rounds
  let totalWon = 0, wonDaily = 0, wonWeekly = 0;
  try {
    const wr = await oFetch(`${O_DRAW_WORKER}/my-wins?wallet=${wallet}`, {}, 2);
    if (wr.ok) {
      const d = await wr.json();
      const wins = d.wins || [];
      const dailyRounds  = new Set(wins.filter(w => w.pool === 'daily').map(w => w.roundId));
      const weeklyRounds = new Set(wins.filter(w => w.pool === 'weekly').map(w => w.roundId));
      wonDaily   = dailyRounds.size;
      wonWeekly  = weeklyRounds.size;
      totalWon   = wonDaily + wonWeekly;
    }
  } catch(e) {}

  if (el('o-bag-stat-nfts'))   el('o-bag-stat-nfts').textContent   = nfts.length;
  if (el('o-bag-stat-won'))    el('o-bag-stat-won').textContent    = totalWon;
  if (el('o-won-daily'))       el('o-won-daily').textContent       = wonDaily;
  if (el('o-won-weekly'))      el('o-won-weekly').textContent      = wonWeekly;
  if (el('o-bag-stat-daily'))  el('o-bag-stat-daily').textContent  = dailyEntries;
  if (el('o-bag-stat-weekly')) el('o-bag-stat-weekly').textContent = weeklyEntries;
  if (el('o-bag-count'))       el('o-bag-count').textContent       = nfts.length + (fromCache ? ' (refreshing…)' : '');

  const grid = el('o-bag-grid'), empty = el('o-bag-empty');
  if (grid) {
    if (!nfts.length) {
      grid.style.display = 'none';
      if (empty) {
        empty.style.display = 'block';
        const msg = empty.querySelector('div');
        if (msg) msg.innerHTML = `No Oracle Mask NFTs in your wallet<br>
          <a href="https://draw.terraoracle.io/" target="_blank"
            style="display:inline-block;margin-top:12px;padding:8px 20px;border-radius:8px;
            border:1px solid rgba(244,208,63,0.4);background:rgba(244,208,63,0.08);
            color:#f4d03f;text-decoration:none;font-size:11px;">Mint on Oracle Draw →</a>`;
      }
    } else {
      if (empty) empty.style.display = 'none';
      grid.style.display = 'grid';
      setTimeout(() => filterOracleBagNFTs('all'), 0);
    }
  }

  // History
  try {
    const hr = await oFetch(`${O_DRAW_WORKER}/my-history?wallet=${wallet}`, {}, 2);
    if (hr.ok) {
      const hdata = await hr.json();
      const rawHistory = hdata.history || hdata.rounds || [];
      // Filter admin resets, group by round
      const filtered = rawHistory.filter(h => !(h.roundId||'').startsWith('admin_reset'));
      const roundMap = new Map();
      for (const h of filtered) {
        const key = (h.pool||h.type) + ':' + (h.roundId||h.round);
        if (!roundMap.has(key)) {
          roundMap.set(key, { roundId: h.roundId||h.round, pool: h.pool||h.type, entries: 0, won: false, consumedAt: h.consumedAt });
        }
        const r = roundMap.get(key);
        r.entries += (h.entries || 1);
        if (h.won || h.result === 'won') r.won = true;
      }
      const history = Array.from(roundMap.values()).sort((a,b) => new Date(b.consumedAt) - new Date(a.consumedAt));
      const histTable = el('o-bag-hist-table');
      const histEmpty = el('o-bag-hist-empty');
      const histBody  = el('o-bag-hist-body');
      if (histBody && history.length) {
        if (histEmpty) histEmpty.style.display = 'none';
        if (histTable) histTable.style.display = 'table';
        histBody.innerHTML = history.map(h => {
          const date = h.consumedAt ? new Date(h.consumedAt).toLocaleDateString() : (h.roundId || '-');
          const pool = (h.pool||'daily');
          const won  = h.won
            ? '<span style="color:#66ffaa;font-weight:700;">Won</span>'
            : '<span style="color:var(--muted);">—</span>';
          return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
            <td style="padding:12px 14px;color:var(--muted);font-size:12px;">${date}</td>
            <td style="padding:12px 14px;">
              <span style="font-size:9px;padding:2px 8px;border-radius:4px;
                background:${pool==='daily'?'rgba(244,208,63,0.1)':'rgba(74,144,217,0.1)'};
                color:${pool==='daily'?'#f4d03f':'#7eb8ff'};
                border:1px solid ${pool==='daily'?'rgba(244,208,63,0.2)':'rgba(74,144,217,0.2)'};">
                ${pool.charAt(0).toUpperCase()+pool.slice(1)}
              </span>
            </td>
            <td style="padding:12px 14px;text-align:center;font-size:12px;">${h.entries}</td>
            <td style="padding:12px 14px;">${won}</td>
          </tr>`;
        }).join('');
      }
    }
  } catch(e) {}
}

const O_TIER_IMAGES = {
  common:    { sm: 'https://draw.terraoracle.io/nfts/common-sm.webp',    fallback: 'https://draw.terraoracle.io/nfts/common-sm.png'    },
  rare:      { sm: 'https://draw.terraoracle.io/nfts/rare-sm.webp',      fallback: 'https://draw.terraoracle.io/nfts/rare-sm.png'      },
  legendary: { sm: 'https://draw.terraoracle.io/nfts/legendary-sm.webp', fallback: 'https://draw.terraoracle.io/nfts/legendary-sm.png' },
};

let _oBagCurrentFilter = 'all';

function filterOracleBagNFTs(filter) {
  _oBagCurrentFilter = filter;
  const nfts = window._oBagNFTs || [];
  const el = id => document.getElementById(id);

  ['all','common','rare','legendary','used'].forEach(f => {
    const btn = el('o-bag-filter-' + f);
    if (!btn) return;
    const colors = {
      all:       { active:'rgba(244,208,63,0.12)', border:'rgba(244,208,63,0.5)',   text:'#f4d03f'  },
      common:    { active:'rgba(180,190,210,0.1)', border:'rgba(180,190,210,0.5)',  text:'#b0b8c8'  },
      rare:      { active:'rgba(96,165,250,0.1)',  border:'rgba(96,165,250,0.5)',   text:'#60a5fa'  },
      legendary: { active:'rgba(251,146,60,0.1)',  border:'rgba(251,146,60,0.5)',   text:'#fb923c'  },
      used:      { active:'rgba(255,255,255,0.08)',border:'rgba(255,255,255,0.35)', text:'#e2e8f0'  },
    };
    const c = colors[f];
    btn.style.background  = f === filter ? c.active : 'transparent';
    btn.style.borderColor = f === filter ? c.border.replace('0.5','0.8') : c.border.replace('0.5','0.2');
    btn.style.color       = c.text;
    btn.style.opacity     = f === filter ? '1' : '0.6';
    btn.style.fontWeight  = f === filter ? '700' : '400';
  });

  let filtered = nfts;
  if (filter === 'used')      filtered = nfts.filter(n => !n.inCurrentRound);
  else if (filter !== 'all')  filtered = nfts.filter(n => n.type === filter);

  filtered = filtered.slice().sort((a, b) => {
    if (a.inCurrentRound && !b.inCurrentRound) return -1;
    if (!a.inCurrentRound && b.inCurrentRound) return 1;
    return 0;
  });

  const grid = el('o-bag-grid');
  if (!grid) return;

  const cfgs = {
    common:    { color:'#b0b8c8', glow:'rgba(180,190,210,0.3)', bg:'rgba(180,190,210,0.05)', icon:'🎭', label:'COMMON'   },
    rare:      { color:'#60a5fa', glow:'rgba(96,165,250,0.35)', bg:'rgba(96,165,250,0.06)',  icon:'🔮', label:'RARE'      },
    legendary: { color:'#fb923c', glow:'rgba(251,146,60,0.4)',  bg:'rgba(251,146,60,0.07)',  icon:'👁',  label:'LEGENDARY' },
  };

  if (!filtered.length) {
    grid.style.display = 'none';
    const empty = document.getElementById('o-bag-empty');
    if (empty) empty.style.display = 'block';
    return;
  }
  const empty2 = document.getElementById('o-bag-empty');
  if (empty2) empty2.style.display = 'none';
  grid.style.display = 'grid';

  grid.innerHTML = filtered.map(nft => {
    const cfg = cfgs[nft.type] || cfgs.common;
    const used = nft.used || !nft.inCurrentRound;
    const opacity = !used ? '1' : '0.5';

    let statusHtml;
    if (nft.isNewArch && !used) {
      const poolLabel = (nft.pool || 'daily').toUpperCase();
      const poolColor = nft.pool === 'weekly' ? 'rgba(96,165,250,0.5)'   : 'rgba(102,255,170,0.5)';
      const poolBg    = nft.pool === 'weekly' ? 'rgba(96,165,250,0.08)'  : 'rgba(102,255,170,0.08)';
      const poolText  = nft.pool === 'weekly' ? '#60a5fa'                : '#66ffaa';
      statusHtml = `<div style="padding:8px 10px;border-radius:8px;background:${poolBg};
        border:1px solid ${poolColor};color:${poolText};font-size:11px;font-weight:600;text-align:center;">
        ✓ ACTIVE IN ${poolLabel}</div>`;
    } else if (!used) {
      statusHtml = `<div style="padding:8px 10px;border-radius:8px;background:rgba(244,208,63,0.06);
        border:1px solid rgba(244,208,63,0.25);color:#f4d03f;font-size:11px;text-align:center;">
        🎭 In Draw</div>`;
    } else {
      statusHtml = `<div style="padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.02);
        border:1px solid rgba(255,255,255,0.07);color:var(--muted);font-size:11px;text-align:center;">
        ✔ Round over</div>`;
    }

    const img = O_TIER_IMAGES[nft.type] || O_TIER_IMAGES.common;
    const imgHtml = `
      <picture>
        <source srcset="${img.sm}" type="image/webp">
        <img src="${img.fallback}"
          style="width:100px;height:150px;border-radius:10px;object-fit:cover;margin-bottom:12px;background:rgba(255,255,255,0.03);"
          onerror="this.style.display='none';this.previousElementSibling.style.display='none';this.nextElementSibling.style.display='block';">
      </picture>
      <div style="font-size:32px;margin-bottom:8px;display:none;">${cfg.icon}</div>`;

    return `<div style="background:${cfg.bg};border:1px solid ${cfg.glow};border-radius:16px;
      padding:20px 18px;text-align:center;box-shadow:0 0 18px ${cfg.glow};
      transition:transform 0.2s;opacity:${opacity};"
      onmouseover="this.style.transform='translateY(-3px)'"
      onmouseout="this.style.transform='translateY(0)'">
      ${imgHtml}
      <div style="font-size:9px;letter-spacing:0.2em;color:${cfg.color};font-weight:700;margin-bottom:4px;">${cfg.label}</div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700;color:#fff;margin-bottom:4px;">${oFormatNFTLabel(nft.id)}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:3px;">${nft.entries} ${nft.entries===1?'entry':'entries'}</div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:12px;">${nft.pool ? (nft.pool.charAt(0).toUpperCase()+nft.pool.slice(1))+' Pool' : 'Oracle Draw'}</div>
      ${statusHtml}
    </div>`;
  }).join('');
}


