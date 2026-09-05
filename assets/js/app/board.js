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
// The ask form offers eight categories; the board had six chips, and the two
// lists were never reconciled. "Security / Vulnerability" matched no chip and
// could only be found under ALL, while MARKET filtered on a category the form
// has never offered and was therefore always empty.
//
// One definition now drives both the chips and the filtering. Every category in
// the form belongs to exactly one group, so nothing can become unreachable
// again - the check below fails loudly if a new category is added here and
// forgotten in the form, or the other way round.
const BOARD_GROUPS = {
  security: { label: 'Security',  cats: ['Security / Vulnerability', 'Fraud / Manipulation'] },
  tech:     { label: 'Tech',      cats: ['Protocol Bug', 'Validator Issue'] },
  gov:      { label: 'Governance',cats: ['Governance', 'Proposal / Idea'] },
  comm:     { label: 'Community', cats: ['Community'] },
  other:    { label: 'Other',     cats: ['Other'] },
};

function boardGroupOf(category) {
  for (const [key, g] of Object.entries(BOARD_GROUPS)) {
    if (g.cats.includes(category)) return key;
  }
  return 'other';   // an unknown or legacy category is still findable
}

function setBoardFilter(cat) {
  boardFilter = cat;
  document.querySelectorAll('[id^="filter-"]').forEach(b => b.classList.remove('active'));
  document.getElementById('filter-' + cat)?.classList.add('active');
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
      '<span style="font-size:12px;color:' + textColor + ';">' + escHtml(opt.text) + '</span>' +
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

  let filtered = boardFilter === 'all'
    ? [...questions]
    : questions.filter(q => boardGroupOf(q.category || '') === boardFilter);

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

  list.innerHTML = filtered.map((q, qi) => {
    const realQi = questions.indexOf(q);
    return `
    <div class="q-card${isPinned(q) ? ' q-card--pinned' : ''}" id="qcard-${qi}">
      <div class="q-meta">
        ${isPinned(q) ? `<span class="badge-pin">Priority</span><span class="pin-timer"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.4 2"/></svg><span class="pin-time" data-pin-until="${q.pinnedUntil}">${pinTimeLeft(q.pinnedUntil - _nowSec)}</span></span>` : ''}
        ${q.isAdmin ? `<span class="badge-admin">🛡️ Admin</span>` : `${_getProfileAvatar(q.wallet) ? `<img src="${getProfileAvatar(q.wallet)}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:4px;">` : ''}<span class="q-alias">${_getDisplayName(q.wallet, q.alias)}</span>`}
        ${!q.isAdmin && q.wallet && window._walletScores ? getRankBadgeHTML(window._walletScores[q.wallet] || 0) : (q.title && !q.isAdmin ? `<span class="badge-title">${escHtml(q.title)}</span>` : '')}
        <span class="q-category">${escHtml(q.category)}</span>
        <span class="q-ref" style="margin-left:auto;">${escHtml(q.time)}&nbsp;&nbsp;${escHtml(q.id)}</span>
      </div>
      ${q.tags && q.tags.length ? `<div class="q-tags">${q.tags.map(t => `<span class="q-tag ${boardSearch === '#'+t || boardSearch === t ? 'active-tag' : ''}" data-q-tag="${escHtml(t)}">#${escHtml(t)}</span>`).join('')}</div>` : ''}
      ${(() => {
        const u = q.evidence ? safeUrl(q.evidence) : null;
        if (!u) return '';
        const shown = u.length > 58 ? u.slice(0, 58) + '…' : u;
        return `<div class="q-evidence"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.4 4.53"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.4-1.42"/></svg><a href="${escHtml(u)}" target="_blank" rel="noopener noreferrer">${escHtml(shown)}</a></div>`;
      })()}
      <div class="q-text">${(() => {
        const safe = escHtml(q.text);
        if (!boardSearch) return safe;
        const needle = escHtml(boardSearch).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return safe.replace(new RegExp('(' + needle + ')', 'gi'), '<mark style="background:rgba(84,147,247,0.25);color:var(--accent);border-radius:2px;padding:0 2px;">$1</mark>');
      })()}</div>
      ${q.poll && q.poll.length >= 2 ? renderPoll(q, realQi) : ''}
      <div class="q-footer">
        <div class="q-votes">
          <button class="vote-btn ${q.voted ? 'voted' : ''}" onclick="voteQuestion(${realQi})"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;filter:drop-shadow(0 0 4px currentColor);"><path d="M12 19.6V5.4"/><path d="M6.2 11.2 12 5.4l5.8 5.8"/></svg> ${q.votes}</button>
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
      body: JSON.stringify({ questionId: q.id, text, replyTo: replyTo ? { answerId: replyTo.answerId, author: replyTo.author, text: replyTo.text.slice(0,80) } : null, ...(await signAction('answer', q.id)) }),
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

