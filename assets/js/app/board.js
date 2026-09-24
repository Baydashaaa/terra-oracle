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
  // - if left in place - permanently overrides every later class-based page
  // switch: clicking any nav tab would keep showing whatever page the user
  // had originally loaded/refreshed on, since #id{display:...!important}
  // always beats .page.active{display:block} regardless of which page later
  // gets the "active" class. Must be called exactly once, right after the
  // real routing below has taken over - never left in the DOM permanently.
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
    // profile.js loads after app.js - wait for openProfile to be defined
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

// ─── BOARD FILTERS ────────────────────────────────────────────
// Категории Board = категории формы Ask. Второго списка нет: чипы строятся
// из кнопок [data-cat] формы, поэтому новая категория в Ask сама
// появляется на Board, и разойтись им больше нельзя. Раньше тут были
// группы (Security / Tech / ...), и формулировки в двух местах не совпадали.
// Вопросы со старыми категориями, которых в форме уже нет, видны в Other.
const BOARD_CAT_COLORS = {
  'Governance': '167,139,250', 'Protocol Bug': '34,211,238', 'Validator Issue': '96,165,250',
  'Security / Vulnerability': '248,113,113', 'Community': '74,222,128', 'Proposal / Idea': '245,197,66',
  'Partnership / Collaboration': '244,114,182', 'Fraud / Manipulation': '251,146,60', 'Other': '148,163,184',
};

function boardCategories() {
  return Array.from(document.querySelectorAll('#page-ask [data-cat]'))
    .map(b => b.getAttribute('data-cat'))
    .filter((v, i, a) => v && a.indexOf(v) === i);
}

function boardMatchesFilter(q) {
  if (boardFilter === 'all') return true;
  const c = q.category || '';
  if (boardFilter === 'Other') return c === 'Other' || boardCategories().indexOf(c) < 0;
  return c === boardFilter;
}

function markBoardFilter() {
  document.querySelectorAll('#page-board [data-filter]').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-filter') === boardFilter));
}

function renderBoardCategories() {
  const box = document.querySelector('#page-board .bd-side .bd-card .bd-chips');
  if (!box || box.dataset.built) return;
  const cats = boardCategories();
  if (!cats.length) return;
  box.dataset.built = '1';
  box.innerHTML = '<button type="button" class="vote-tab" data-filter="all">All</button>' +
    cats.map(c => `<button type="button" class="vote-tab" data-filter="${escHtml(c)}" style="--c:${BOARD_CAT_COLORS[c] || '124,58,237'}">${escHtml(c)}</button>`).join('');
  markBoardFilter();
}

function setBoardFilter(cat) {
  boardFilter = cat;
  markBoardFilter();
  renderBoard();
}

document.addEventListener('click', e => {
  const b = e.target.closest('#page-board [data-filter]');
  if (b) setBoardFilter(b.getAttribute('data-filter'));
});

function setBoardSort(s) {
  boardSort = s;
  document.querySelectorAll('[id^="sort-"]').forEach(b => b.classList.remove('active'));
  document.getElementById('sort-' + s)?.classList.add('active');
  renderBoard();
}

// ─── RENDER BOARD ────────────────────────────────────────────
// Poll status. A question lives 7 days (expiresAt, set by the worker), and
// the poll closes with it. Before this the card showed only the creation
// date, so a click on a closed poll looked like a broken button.
function pollState(q) {
  const now = Math.floor(Date.now() / 1000);
  const end = Number(q.expiresAt) || 0;
  const closed = end > 0 && now >= end;
  const voted = q.myPollVote !== undefined && q.myPollVote !== null;
  return { closed, voted, end, left: end - now };
}

function pollLeftText(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return Math.max(1, m) + 'm';
}

function pollDateText(ts) {
  const d = new Date(ts * 1000);
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

function renderPoll(q, qi) {
  const poll = q.poll;
  const totalVotes = poll.reduce((s, o) => s + (o.votes || 0), 0);
  const st = pollState(q);
  const myVote = st.voted ? q.myPollVote : null;   // -1 = voted, option unknown on this device
  const locked = st.closed || st.voted;

  let status;
  if (st.closed) {
    status = '<span style="color:#ff8a8a;border:1px solid rgba(255,96,96,0.35);background:rgba(255,96,96,0.08);padding:1px 7px;border-radius:4px;">Closed</span>' +
      '<span style="color:var(--muted);">Ended ' + pollDateText(st.end) + '</span>';
  } else {
    status = '<span style="color:#66ffaa;border:1px solid rgba(102,255,170,0.35);background:rgba(102,255,170,0.08);padding:1px 7px;border-radius:4px;">Open</span>' +
      (st.end ? '<span style="color:var(--muted);">Ends in ' + pollLeftText(st.left) + '</span>' : '');
  }
  if (st.voted) status += '<span style="color:var(--accent);">&#10003; You voted</span>';

  let optionsHtml = '';
  for (let oi = 0; oi < poll.length; oi++) {
    const opt = poll[oi];
    const pct = totalVotes > 0 ? Math.round((opt.votes || 0) / totalVotes * 100) : 0;
    const mine = myVote === oi;
    const border = mine ? 'rgba(84,147,247,0.6)' : 'rgba(255,255,255,0.08)';
    const bg = mine ? 'rgba(84,147,247,0.12)' : 'rgba(255,255,255,0.03)';
    const textColor = mine ? 'var(--accent)' : 'var(--text)';
    optionsHtml += '<div style="margin-bottom:6px;">' +
      '<button type="button" onclick="votePoll(' + qi + ',' + oi + ')"' + (locked ? ' disabled aria-disabled="true"' : '') +
      ' title="' + (st.closed ? 'This poll is closed' : st.voted ? 'You already voted' : 'Vote for this option') + '"' +
      ' style="width:100%;text-align:left;padding:8px 12px;border-radius:8px;border:1px solid ' + border + ';background:' + bg + ';cursor:' + (locked ? 'default' : 'pointer') + ';position:relative;overflow:hidden;">' +
      '<div style="position:absolute;left:0;top:0;height:100%;width:' + pct + '%;background:rgba(84,147,247,0.08);border-radius:8px;transition:width 0.4s;"></div>' +
      '<div style="position:relative;display:flex;justify-content:space-between;align-items:center;">' +
      '<span style="font-size:12px;color:' + textColor + ';">' + escHtml(opt.text) + '</span>' +
      '<span style="font-size:11px;color:var(--muted);">' + pct + '% · ' + (opt.votes || 0) + '</span>' +
      '</div></button></div>';
  }

  return '<div class="poll-section" style="margin:10px 0;border:1px solid rgba(84,147,247,0.2);border-radius:10px;padding:12px;background:rgba(84,147,247,0.04);' + (st.closed ? 'opacity:0.85;' : '') + '">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10px;letter-spacing:0.08em;margin-bottom:8px;">' +
    '<span style="color:var(--accent);">COMMUNITY POLL</span>' + status + '</div>' +
    optionsHtml +
    '<div style="font-size:10px;color:var(--muted);margin-top:4px;">' + totalVotes + ' vote' + (totalVotes !== 1 ? 's' : '') + ' total' +
    (st.closed ? ' · final result' : '') + '</div>' +
    '</div>';
}

async function votePoll(qi, optionIdx) {
  if (!(globalWalletAddress || connectedAddress)) { alert('Connect wallet to vote'); return; }
  const q = questions[qi];
  if (!q || !q.poll) return;
  const st = pollState(q);
  if (st.closed) { renderBoard(); return; }   // button is disabled; guard for a stale card
  if (st.voted) return; // already voted
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
      body: JSON.stringify({ questionId: q.id, optionIdx, ...(await voteSession()) }),
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
    // Show the worker's own reason (closed, expired, ...) instead of a guess.
    alert(err.error ? 'Vote not accepted: ' + err.error : 'Your poll vote could not be submitted. Please try again.');
  } catch(e) {
    q._pollVoting = false;
    q.myPollVote = null;
    q.poll[optionIdx].votes = Math.max(0, (q.poll[optionIdx].votes || 1) - 1);
    localStorage.removeItem('poll_vote_' + q.id);
    renderBoard();
    alert('Your poll vote could not be submitted (network issue). Please try again.');
  }
}

// ── Priority pin countdown ───────────────────────────────────────────────────
// The remaining pin time is what makes a Priority question read as a paid,
// expiring slot rather than a static badge. Only the text nodes are updated on
// each tick - a full renderBoard() happens once, when a pin actually expires.
function pinTimeLeft(sec) {
  if (sec <= 0) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
let _pinTickerId = null;

// Какие вопросы раскрыты и недописанные ответы - по id вопроса, а не в
// самих объектах. Список questions перезагружается целиком, и флаг
// q.open пропадал вместе со старыми объектами: ветка сама закрывалась,
// а набранный ответ стирался.
const _boardOpen = new Set();
const _boardDrafts = {};
function startPinTicker() {
  if (_pinTickerId) return;
  _pinTickerId = setInterval(() => {
    const els = document.querySelectorAll('.pin-time[data-pin-until]');
    if (!els.length) { clearInterval(_pinTickerId); _pinTickerId = null; return; }
    const now = Math.floor(Date.now() / 1000);
    let expired = false;
    els.forEach(el => {
      const left = (parseInt(el.dataset.pinUntil, 10) || 0) - now;
      if (left <= 0) expired = true; else el.textContent = pinTimeLeft(left);
    });
    if (expired) { clearInterval(_pinTickerId); _pinTickerId = null; renderBoard(); }
  }, 30000);
}

function renderBoard() {
  const list = document.getElementById('questions-list');
  const count = document.getElementById('board-count');
  renderBoardCategories();
  renderPopularTags();
  document.querySelectorAll('#qmodal textarea[id^="atext-"]').forEach(t => {
    const sec = t.closest('.answers-section');
    if (sec && sec.dataset.qid) _boardDrafts[sec.dataset.qid] = t.value;
  });
  _renderQModal();
  _tryDeepQuestion();

  let filtered = boardFilter === 'all'
    ? [...questions]
    : questions.filter(boardMatchesFilter);

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

  // Priority questions float to the top while their 24h pin is still live.
  // Done AFTER the chosen sort, so ordering inside each group is preserved and
  // the pin expires on its own without any cleanup job.
  const _nowSec  = Math.floor(Date.now() / 1000);
  const isPinned = q => (q.pinnedUntil || 0) > _nowSec;
  filtered = [...filtered.filter(isPinned), ...filtered.filter(q => !isPinned(q))];
  startPinTicker();

  count.textContent = filtered.length + ' open question' + (filtered.length !== 1 ? 's' : '');

  if (filtered.length === 0) {
    list.innerHTML = boardSearch
      ? `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No questions match "<strong>${escHtml(boardSearch)}</strong>".<br><span style="font-size:11px;opacity:0.6;">Try different keywords</span></div></div>`
      : `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">No questions here yet.<br>Be the first to ask!</div></div>`;
    return;
  }

  // Раскрытие: одно действие на вопрос. Раскрытая ветка сразу показывает
  // и ответы, и форму ответа.
  questions.forEach(q => {
    const id = String(q.id);
    if (q.open) _boardOpen.add(id);
    q.open = _boardOpen.has(id);
    q.formOpen = q.open;
  });

  // Сохраняем недописанные ответы и фокус до перерисовки.
  let _focusQid = null, _selA = 0, _selB = 0;
  document.querySelectorAll('#questions-list textarea[id^="atext-"], #qmodal textarea[id^="atext-"]').forEach(t => {
    const sec = t.closest('.answers-section');
    const qid = sec && sec.dataset.qid;
    if (!qid) return;
    _boardDrafts[qid] = t.value;
    if (document.activeElement === t) { _focusQid = qid; _selA = t.selectionStart; _selB = t.selectionEnd; }
  });

  list.innerHTML = filtered.map((q, qi) => _qCardHTML(q, qi, questions.indexOf(q), 'list')).join('');

  // Возвращаем недописанные ответы и курсор.
  _restoreBoardDrafts(list, _focusQid, _selA, _selB);
}

// Шаблон карточки вопроса. mode 'list' - строка списка, 'modal' - страница
// вопроса в окне: ветка всегда раскрыта, принятый ответ сверху, вместо
// стрелки кнопка Copy link. Пока вопрос открыт в окне, в списке его ветку
// не рисуем: иначе id формы ответа (atext-N и т.п.) оказались бы дважды.
function _qCardHTML(q, qi, realQi, mode) {
  const _nowSec  = Math.floor(Date.now() / 1000);
  const isPinned = x => (x.pinnedUntil || 0) > _nowSec;
  const inModal = mode === 'modal';
  const skipThread = !inModal && _modalQid === String(q.id);
  const answersView = inModal
    ? q.answers.map((a, ai) => [a, ai]).sort((x, y) => (y[0].id === q.chosenAnswerId) - (x[0].id === q.chosenAnswerId))
    : q.answers.map((a, ai) => [a, ai]);
  return `
    <div class="q-card qc2${isPinned(q) ? ' q-card--pinned' : ''}${(q.open || inModal) ? ' is-open' : ''}${inModal ? ' qc2-modal' : ''}" id="${inModal ? 'qmodal-card' : 'qcard-' + qi}" data-qi="${realQi}">

      <!-- Левый столбец: голос. Стрелка одна - в модели вопроса только
           счётчик votes и флаг voted, минуса нет. Рисовать неработающую
           стрелку вниз не стали. -->
      <div class="qc2-vote">
        <button class="qc2-up ${q.voted ? 'voted' : ''}" onclick="voteQuestion(${realQi})" aria-label="Upvote">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14l6-6 6 6"/></svg>
        </button>
        <b>${q.votes}</b>
      </div>

      <div class="qc2-body">
        <div class="qc2-chips">
          ${isPinned(q) ? `<span class="badge-pin">Priority</span><span class="pin-timer"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.4 2"/></svg><span class="pin-time" data-pin-until="${q.pinnedUntil}">${pinTimeLeft(q.pinnedUntil - _nowSec)}</span></span>` : ''}
          <span class="q-category">${escHtml(q.category)}</span>
          ${q.tags && q.tags.length ? q.tags.map(t => `<span class="q-tag ${boardSearch === '#'+t || boardSearch === t ? 'active-tag' : ''}" data-q-tag="${escHtml(t)}">${escHtml(t)}</span>`).join('') : ''}
        </div>

        <div class="qc2-title">${(() => {
          const safe = escHtml(q.text);
          if (!boardSearch) return safe;
          const needle = escHtml(boardSearch).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return safe.replace(new RegExp('(' + needle + ')', 'gi'), '<mark>$1</mark>');
        })()}</div>

        ${(() => {
          // Вторая строка по цепочке: ссылка-подтверждение, если есть;
          // иначе начало принятого ответа; если нет ни того ни другого -
          // строки нет вовсе. Своего поля с описанием у вопроса нет.
          const u = q.evidence ? safeUrl(q.evidence) : null;
          if (u) {
            const shown = u.length > 58 ? u.slice(0, 58) + '\u2026' : u;
            return `<a class="qc2-sub qc2-ev" href="${escHtml(u)}" target="_blank" rel="noopener nofollow">${escHtml(shown)}</a>`;
          }
          const best = q.chosenAnswerId ? q.answers.find(a => a.id === q.chosenAnswerId) : null;
          if (best && best.text) {
            const t = best.text.length > 120 ? best.text.slice(0, 120) + '\u2026' : best.text;
            return `<div class="qc2-sub">${escHtml(t)}</div>`;
          }
          return '';
        })()}

        <div class="qc2-meta">
          ${q.isAdmin ? `<span class="badge-admin">\u{1F6E1}\uFE0F Admin</span>` : `${_getProfileAvatar(q.wallet) ? `<img class="qc2-ava" src="${getProfileAvatar(q.wallet)}" alt="">` : ''}<span class="q-alias" data-profile="${escHtml(q.wallet || '')}">${_getDisplayName(q.wallet, q.alias)}</span>`}
          ${!q.isAdmin && q.wallet && window._walletScores ? getRankBadgeHTML(window._walletScores[q.wallet] || 0) : (q.title && !q.isAdmin ? `<span class="badge-title">${escHtml(q.title)}</span>` : '')}
          <span class="qc2-dot">\u00b7</span><span class="qc2-time">${escHtml(q.time)}</span>
          <span class="qc2-id">${escHtml(q.id)}</span>

          <${inModal ? 'span' : 'button type="button" onclick="toggleAnswers(' + realQi + ')"'} class="qc2-answers" title="${inModal ? q.answers.length + ' answers' : 'Show answers here'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z"/></svg>
            ${q.answers.length}
          </${inModal ? 'span' : 'button'}>
        </div>

        ${q.poll && q.poll.length >= 2 && !skipThread ? renderPoll(q, realQi) : ''}
      </div>

      <!-- Одно действие "открыть вопрос": стрелка, клик по карточке или по
           счётчику ответов. Форма ответа живёт внутри раскрытой ветки. -->
      <div class="qc2-side">
        ${inModal ? `<button type="button" class="qc2-open qc2-link" data-copy-q="${escHtml(q.id)}" aria-label="Copy link" title="Copy link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>
        </button>` : `<button type="button" class="qc2-open" onclick="openQuestionModal(${realQi})" aria-label="Open question page" title="Open question">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>`}
      </div>
      ${skipThread ? '' : `<div class="answers-section ${(q.open || inModal) ? 'open' : ''}" id="answers-${realQi}" data-qid="${escHtml(String(q.id || ''))}">
        ${q.answers.length === 0 ? `<div style="font-size:12px;color:var(--muted);padding:8px 0;">No answers yet - be the first!</div>` : ''}
        ${answersView.map(([a, ai]) => `
          <div class="answer-item ${a.isAdmin ? 'admin-answer' : ''}" data-answer-id="${escHtml(String(a.id || ''))}">
            <div class="answer-meta">
              ${a.isAdmin ? `<span class="badge-admin">🛡️ Admin</span>` : `${_getProfileAvatar(a.wallet) ? `<img src="${getProfileAvatar(a.wallet)}" style="width:18px;height:18px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:4px;">` : ''}<span class="q-alias" data-profile="${escHtml(a.wallet || '')}">${_getDisplayName(a.wallet, a.alias)}</span>`}
              ${!a.isAdmin && a.wallet && window._walletScores ? getRankBadgeHTML(window._walletScores[a.wallet] || 0) : (a.title && !a.isAdmin ? `<span class="badge-title">${escHtml(a.title)}</span>` : '')}
              ${a.id === q.chosenAnswerId ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;letter-spacing:0.06em;color:#66ffaa;background:rgba(102,255,170,0.08);border:1px solid rgba(102,255,170,0.35);padding:1px 7px;border-radius:4px;">&#10003; ACCEPTED</span>` : ''}
            </div>
            ${a.replyTo ? `<div style="margin-bottom:8px;padding:6px 10px;background:rgba(84,147,247,0.07);border-left:2px solid var(--accent);border-radius:0 6px 6px 0;">
              <div style="font-size:10px;color:var(--accent);font-weight:700;margin-bottom:2px;display:flex;align-items:center;gap:4px;"><span>&#x21A9;&#xFE0E;</span>${escHtml(a.replyTo.author)}</div>
              <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(a.replyTo.text)}</div>
            </div>` : ''}
            <div class="answer-text">${escHtml(a.text)}</div>
            <div class="answer-votes" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <button class="vote-btn ${a.voted ? 'voted' : ''}" onclick="voteAnswer(${realQi},${ai})"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;filter:drop-shadow(0 0 4px currentColor);"><path d="M12 19.6V5.4"/><path d="M6.2 11.2 12 5.4l5.8 5.8"/></svg> ${a.votes}</button>
              <button
                data-board-reply-qi="${realQi}"
                data-board-reply-id="${escHtml(a.id)}"
                data-board-reply-author="${escHtml(_getDisplayName(a.wallet, a.alias))}"
                data-board-reply-text="${escHtml(String(a.text).replace(/\n/g,' ').slice(0,80))}"
                style="background:none;border:none;color:var(--muted);font-size:11px;font-family:'Exo 2',sans-serif;cursor:pointer;padding:2px 0;display:inline-flex;align-items:center;gap:4px;"
                onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--muted)'">
                <span style="font-style:normal;font-size:12px;line-height:1;">&#x21A9;&#xFE0E;</span> Reply
              </button>
              ${(() => {
                const me = globalWalletAddress || connectedAddress;
                // Only the person who asked, only once, and never their own
                // answer - the fee for a question would not cover what REP
                // converts into.
                if (!me || me !== q.wallet || q.chosenAnswerId || !a.wallet || a.wallet === me) return '';
                return `<button
                  onclick="acceptAnswer('${q.id}','${a.id}')"
                  style="background:none;border:none;color:rgba(102,255,170,0.6);font-size:11px;font-family:'Exo 2',sans-serif;cursor:pointer;padding:2px 0;display:inline-flex;align-items:center;gap:4px;"
                  onmouseover="this.style.color='#66ffaa'" onmouseout="this.style.color='rgba(102,255,170,0.6)'">
                  &#10003; Accept this answer
                </button>`;
              })()}
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
        <div class="answer-form ${(q.formOpen || inModal) ? 'open' : ''}" id="aform-${realQi}">
          <div class="answer-form-title">Write an answer</div>
          <div id="board-reply-block-${realQi}" style="display:none;align-items:flex-start;gap:8px;margin-bottom:12px;padding:8px 10px;background:rgba(84,147,247,0.06);border:1px solid rgba(84,147,247,0.15);border-radius:8px;">
            <div style="flex:1;padding:4px 8px;background:rgba(84,147,247,0.07);border-left:2px solid var(--accent);border-radius:0 5px 5px 0;">
              <div style="font-size:10px;color:var(--accent);font-weight:700;margin-bottom:2px;display:flex;align-items:center;gap:4px;"><span>&#x21A9;&#xFE0E;</span><span class="board-reply-author"></span></div>
              <div class="board-reply-text" style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
            </div>
            <button onclick="clearBoardReply(${realQi})" style="background:none;border:none;color:var(--muted);font-size:15px;cursor:pointer;padding:2px 6px;line-height:1;flex-shrink:0;">✕</button>
          </div>
          <div class="form-group">
            <label>Your Answer</label>
            <textarea id="atext-${realQi}" placeholder="Share your knowledge..." rows="4"></textarea>
          </div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:4px;">
            <button class="btn btn-primary btn-sm" onclick="submitAnswer(${realQi})">Post Answer</button>
          </div>
        </div>
      </div>`}
    </div>
  `;
}

function _restoreBoardDrafts(root, focusQid, a, b) {
  root.querySelectorAll('textarea[id^="atext-"]').forEach(t => {
    const sec = t.closest('.answers-section');
    const qid = sec && sec.dataset.qid;
    if (qid && _boardDrafts[qid]) t.value = _boardDrafts[qid];
    if (qid && qid === focusQid) { t.focus({ preventScroll: true }); try { t.setSelectionRange(a, b); } catch (e) {} }
  });
}

// ─── Страница вопроса (окно) ─────────────────────────────────────
// Стрелка на карточке открывает вопрос целиком: опрос, все ответы
// (принятый сверху), форма ответа и Copy link. Ссылка вида /?q=ID
// открывает этот вопрос сразу при загрузке сайта.
let _modalQid = null;
const _deepQ = (() => { try { return new URLSearchParams(location.search).get('q'); } catch (e) { return null; } })();
let _deepQDone = false;

function _qModalEl() {
  let ov = document.getElementById('qmodal');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'qmodal';
  ov.className = 'qm-overlay';
  ov.hidden = true;
  ov.innerHTML = '<div class="qm-dialog" role="dialog" aria-modal="true" aria-label="Question">' +
    '<button type="button" class="qm-x" aria-label="Close">\u00d7</button><div class="qm-body"></div></div>';
  // Внутри #page-board, чтобы на карточку действовали стили Board.
  (document.getElementById('page-board') || document.body).appendChild(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('.qm-x')) closeQuestionModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !ov.hidden) closeQuestionModal();
  });
  return ov;
}

function _renderQModal() {
  if (!_modalQid) return;
  const realQi = questions.findIndex(q => String(q.id) === _modalQid);
  const ov = _qModalEl();
  if (realQi < 0) { closeQuestionModal(); return; }
  const body = ov.querySelector('.qm-body');
  let focusQid = null, a = 0, b = 0;
  const t = body.querySelector('textarea[id^="atext-"]');
  if (t && document.activeElement === t) { focusQid = _modalQid; a = t.selectionStart; b = t.selectionEnd; }
  body.innerHTML = _qCardHTML(questions[realQi], -1, realQi, 'modal');
  _restoreBoardDrafts(body, focusQid, a, b);
}

function openQuestionModal(realQi, answerId) {
  const q = questions[realQi];
  if (!q) return;
  _modalQid = String(q.id);
  const ov = _qModalEl();
  ov.hidden = false;
  document.documentElement.classList.add('qm-lock');
  renderBoard();
  const body = ov.querySelector('.qm-body');
  ov.scrollTop = 0;
  if (answerId) {
    const el = body.querySelector('[data-answer-id="' + CSS.escape(String(answerId)) + '"]');
    if (el) setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('act-flash'); void el.offsetWidth; el.classList.add('act-flash');
    }, 60);
  }
}

function openQuestionById(id, answerId) {
  const i = questions.findIndex(q => String(q.id) === String(id));
  if (i >= 0) openQuestionModal(i, answerId);
  return i >= 0;
}
window.openQuestionById = openQuestionById;

function closeQuestionModal() {
  const ov = document.getElementById('qmodal');
  _modalQid = null;
  if (ov) { ov.hidden = true; ov.querySelector('.qm-body').innerHTML = ''; }
  document.documentElement.classList.remove('qm-lock');
  renderBoard();
}

// Copy link: адрес, который сразу открывает этот вопрос.
document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy-q]');
  if (!b) return;
  const url = location.origin + '/?q=' + encodeURIComponent(b.getAttribute('data-copy-q'));
  const done = () => { b.classList.add('copied'); b.title = 'Link copied'; setTimeout(() => { b.classList.remove('copied'); b.title = 'Copy link'; }, 1600); };
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url));
  else prompt('Copy this link:', url);
});

// Ссылка /?q=ID: как только вопросы загрузились, открываем Board и вопрос.
function _tryDeepQuestion() {
  if (!_deepQ || _deepQDone || !questions.length) return;
  const i = questions.findIndex(q => String(q.id) === _deepQ);
  _deepQDone = true;
  if (i < 0) return;
  if (typeof showPage === 'function') { try { showPage('board'); } catch (e) {} }
  setTimeout(() => openQuestionModal(i), 50);
}

// Popular tags в боковой панели Board: считаются по всем вопросам, топ-10.
// Клик ставит поиск по тегу (#tag), повторный клик снимает.
function renderPopularTags() {
  const box = document.getElementById('bd-tags');
  const card = document.getElementById('bd-tags-card');
  if (!box || !card) return;
  const cnt = {};
  questions.forEach(q => (q.tags || []).forEach(t => {
    const k = String(t).toLowerCase();
    cnt[k] = (cnt[k] || 0) + 1;
  }));
  const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || a.localeCompare(b)).slice(0, 10);
  card.hidden = !top.length;
  const pal = ['167,139,250', '34,211,238', '245,197,66', '74,222,128', '244,114,182', '96,165,250', '251,146,60'];
  box.innerHTML = top.map((t, i) =>
    `<button type="button" class="bd-tag${boardSearch === '#' + t ? ' on' : ''}" data-bd-tag="${escHtml(t)}" style="--c:${pal[i % pal.length]}">#${escHtml(t)}</button>`
  ).join('');
}

document.addEventListener('click', function (e) {
  const b = e.target.closest('[data-bd-tag]');
  if (!b) return;
  const t = '#' + b.getAttribute('data-bd-tag');
  if (boardSearch === t) { clearSearch(); return; }
  const inp = document.getElementById('board-search');
  if (inp) inp.value = t;
  setBoardSearch(t);
});

function toggleAnswers(qi) {
  const q = questions[qi];
  if (!q) return;
  const id = String(q.id);
  if (_boardOpen.has(id)) { _boardOpen.delete(id); q.open = false; }
  else { _boardOpen.add(id); q.open = true; }
  renderBoard();
}
// Старое имя оставлено: его могут звать другие места. Теперь то же, что раскрыть.
function toggleAnswerForm(qi) {
  const q = questions[qi];
  if (!q) return;
  if (!_boardOpen.has(String(q.id))) toggleAnswers(qi);
}

// Клик по пустому месту карточки тоже раскрывает вопрос. Кнопки, ссылки,
// теги, ник автора, опрос и сама ветка ответов живут своей жизнью.
document.addEventListener('click', function (e) {
  const card = e.target.closest('#questions-list .qc2');
  if (!card) return;
  if (e.target.closest('button, a, input, textarea, select, label, .q-tag, [data-profile], .answers-section, .qc2-poll, .poll, .poll-section, [onclick]')) return;
  if (window.getSelection && String(window.getSelection()).length) return;   // выделяли текст
  const qi = Number(card.dataset.qi);
  if (isFinite(qi)) toggleAnswers(qi);
});

document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-delete-qi]');
  if (!btn) return;
  const qi = parseInt(btn.getAttribute('data-delete-qi'));
  const aid = btn.getAttribute('data-delete-aid');
  deleteAnswer(qi, aid);
});

// Marks the answer that helped. Permanent on purpose: a changeable choice
// would grant REP twice, and taking it back from someone already credited is
// worse than living with a mistake.
async function acceptAnswer(questionId, answerId) {
  if (!confirm('Accept this answer? This cannot be undone, and the author receives REP for it.')) return;
  try {
    const res = await fetch(`${WORKER_URL}/answer/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId, answerId, ...(await signAction('answer/accept', questionId + ':' + answerId)) }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Failed'); }
    const q = questions.find(x => x.id === questionId);
    if (q) { q.chosenAnswerId = answerId; q.status = 'answered'; }
    renderBoard();
  } catch (e) {
    alert('Could not accept: ' + e.message);
  }
}

async function deleteAnswer(qi, aid) {
  if (!confirm('Delete your answer? This cannot be undone.')) return;
  const q = questions[qi];
  const answerIdx = q.answers.findIndex(a => a.id === aid);
  if (answerIdx === -1) return;
  try {
    const res = await fetch(`${WORKER_URL}/answer/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Подпись привязана и к вопросу, и к конкретному ответу: подписав
      // удаление одного, нельзя удалить соседний.
      body: JSON.stringify({ questionId: q.id, answerId: aid, ...(await signAction('answer/delete', q.id + ':' + aid)) }),
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

// Клик по тегу. Раньше тег подставлялся прямо в inline onclick - строковая
// подстановка в JS-контекст, которую нельзя экранировать HTML-эскейпом.
document.addEventListener('click', function(e) {
  const tagEl = e.target.closest('[data-q-tag]');
  if (!tagEl) return;
  setBoardSearch('#' + tagEl.getAttribute('data-q-tag'));
});

document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-board-reply-qi]');
  if (!btn) return;
  const qi = btn.getAttribute('data-board-reply-qi');
  window.setBoardReply(qi, btn.getAttribute('data-board-reply-id'), btn.getAttribute('data-board-reply-author'), btn.getAttribute('data-board-reply-text'));
});

// Posting guard by question id: the wallet signature takes seconds, and a
// second click during it used to send the same answer twice.
const _answerPosting = new Set();

async function submitAnswer(qi) {
  const field = document.getElementById('atext-' + qi);
  const text = field ? field.value.trim() : '';
  if (!text) { alert('Please write your answer first.'); return; }
  if (!globalWalletAddress) { alert('Connect wallet to answer'); return; }
  const wallet = globalWalletAddress;
  const q = questions[qi];
  if (!q) return;
  const qid = String(q.id);
  if (_answerPosting.has(qid)) return;
  // Anti-spam: max 3 answers per question per day per wallet
  const today = new Date().toISOString().slice(0, 10);
  const todayAnswers = q.answers.filter(a => a.wallet === wallet && a.createdAt && new Date(a.createdAt * 1000).toISOString().slice(0, 10) === today);
  if (todayAnswers.length >= 3) { alert('You can only post 3 answers per question per day.'); return; }
  const replyTo = window._boardReplyTo[qi] || null;
  const btn = document.querySelector('#aform-' + qi + ' .btn-primary');
  _answerPosting.add(qid);
  if (btn) { btn.disabled = true; btn.textContent = 'Posting...'; }
  try {
    // Подпись покрывает и хеш текста с цитатой (SEC-07): перехваченная
    // подпись не годится для другого содержимого.
    const replyObj = replyTo ? { answerId: replyTo.answerId, author: replyTo.author, text: replyTo.text.slice(0,80) } : null;
    const signed = await signAction('answer', q.id, await contentHash(answerContent({ text, replyTo: replyObj })));
    const res = await fetch(`${WORKER_URL}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, text, replyTo: replyObj, ...signed }),
    });
    if (!res.ok) throw new Error('Failed to post answer');
    const data = await res.json();
    questions[qi].answers.push({
      id: data.answerId,
      alias: 'Anonymous#' + wallet.slice(-4).toUpperCase(),
      isAdmin: false, wallet, text, votes: 0, voted: false,
      createdAt: Math.floor(Date.now() / 1000),
      replyTo: replyObj,
    });
    questions[qi].formOpen = false;
    questions[qi].open = true;
    // renderBoard() saves every textarea into _boardDrafts before it redraws.
    // The field still held the posted text, so deleting the draft alone was
    // not enough: it was saved back and reappeared under the new answer.
    document.querySelectorAll('textarea[id="atext-' + qi + '"]').forEach(t => { t.value = ''; });
    delete _boardDrafts[qid];
    window.clearBoardReply(qi);
    renderBoard();
  } catch(e) {
    alert('Failed to post answer: ' + e.message);
  } finally {
    _answerPosting.delete(qid);
    const b = document.querySelector('#aform-' + qi + ' .btn-primary');
    if (b) { b.disabled = false; b.textContent = 'Post Answer'; }
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

  // Sync to worker - only keep the vote if the server confirms it
  try {
    const res = await fetch(`${WORKER_URL}/question-vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, ...(await voteSession()) }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) { q._voting = false; return; } // confirmed
    // Server rejected - read reason
    let err = {}; try { err = await res.json(); } catch(e) {}
    q._voting = false;
    if (err.error === 'Already voted') return; // already counted on server - keep voted state
    rollback();
    if (err.error === 'Cannot vote your own question') alert('You cannot vote your own question');
    else alert('Your vote could not be submitted. Please try again.');
  } catch(e) {
    // Network failure - vote did NOT reach the server
    q._voting = false;
    rollback();
    alert('Your vote could not be submitted (network issue). Please try again.');
  }
}

async function voteAnswer(qi, ai) {
  const answer = questions[qi].answers[ai];
  if (answer.voted) return;
  if (answer._voting) return; // guard against double-click
  if (!(globalWalletAddress || connectedAddress)) { alert('Connect wallet to vote'); return; }
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

  // Persist to worker - only keep if confirmed
  try {
    const res = await fetch(`${WORKER_URL}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: questions[qi].id, answerId: answer.id, ...(await voteSession()) }),
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

