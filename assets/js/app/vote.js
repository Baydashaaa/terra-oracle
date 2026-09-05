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
// fake "network issue" error. All votes now come from the worker (/votes) -
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

  // Per-type color scheme (accent + winner colors) - mirrors home-page style.
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
          <div class="vp-opt-label">${escHtml(o.label)}</div>
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
        <div class="vp-timer">${svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 'vp-timer-ico')}${escHtml(v.timer || '')}</div>
      </div>
      <div class="vp-title">${escHtml(v.title)}</div>
      <div class="vp-desc">${escHtml(v.desc)}</div>
      <div class="vp-quorum">
        <div class="vp-q-bar"><div class="vp-q-fill" style="width:${quorumPct}%"></div></div>
        <div class="vp-q-info"><span>Quorum · ${v.totalVotes} / ${v.quorum} votes</span><span>${quorumPct}%</span></div>
      </div>
      <div class="vp-opts">${opts}</div>
      <div class="vp-foot">${foot}<div class="vp-total">${v.totalVotes} votes total</div></div>
      ${v.source ? `<div class="vp-src">${svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 'vp-src-ico')}${escHtml(v.source)}</div>` : ''}
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await adminBody('votes/toggle', voteId + ':start', { id: voteId, action: 'start' })),
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await adminBody('votes/toggle', voteId + ':stop', { id: voteId, action: 'stop' })),
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
        <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(v.title)}</div>
        <div style="font-size:10px;margin-top:3px;color:${col};letter-spacing:0.06em;">${icon} ${escHtml(s.toUpperCase())} · ${escHtml(v.timer || '')} · ${escHtml(String(v.totalVotes || 0))} votes</div>
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await adminBody('votes/create', String(title).slice(0,120), { title, desc, type, durationMs, quorum, source, options: opts })),
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await adminBody('votes/delete', voteId, { id: voteId })),
      signal: AbortSignal.timeout(6000),
    });
    showAdminToast('🗑 Vote deleted', 'red');
  } catch(e) {
    showAdminToast('🗑 Removed locally', 'red');
  }
};

function showVoteToast(msg, color) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = "position:fixed;top:80px;right:20px;z-index:9999;padding:10px 18px;border-radius:8px;font-family:'Exo 2',sans-serif;font-size:12px;font-weight:700;letter-spacing:0.05em;background:" +
    (color === 'green' ? 'rgba(102,255,170,0.15)' : 'rgba(255,60,60,0.12)') + ";border:1px solid " +
    (color === 'green' ? 'rgba(102,255,170,0.4)' : 'rgba(255,60,60,0.3)') + ";color:" +
    (color === 'green' ? 'var(--green)' : '#ff6464') + ";";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

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

  // ADR-36. Раньше в Worker уходил только текстовый wallet - подставить чужой
  // адрес мог кто угодно, а настоящему владельцу оставалось "уже голосовал".
  // Сессионная подпись (та же, что в Board) доказывает владение ключом.
  // Подписываем ДО оптимистичного обновления: отказ в кошельке не должен
  // оставлять на экране голос, которого не было.
  let session;
  try {
    session = await voteSession();
  } catch (e) {
    vote._voting = false;
    showVoteToast(e.message || 'Signature required to vote', 'red');
    return;
  }

  // Optimistic update - show it immediately, but be ready to roll back.
  const prevVotes  = vote.options[optionIdx].votes;
  const prevTotal  = vote.totalVotes;
  vote.options[optionIdx].votes++; vote.totalVotes++; vote.userVoted = optionIdx;
  saveVoteToStorage(voteId, optionIdx);
  if (vote.isMonthlyLiquidity && vote.voteKey) { try { localStorage.setItem(vote.voteKey, JSON.stringify({ totalVotes: vote.totalVotes, options: vote.options.map(o => o.votes) })); } catch(e) {} }
  renderVotes();

  // Persist to Worker - the server is the source of truth. Only KEEP the vote
  // if the server confirms it; otherwise roll back so the count stays honest.
  try {
    const res = await fetch(`${WORKER_URL}/votes/cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voteId, optionIdx, ...session }),
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
    // Roll back - the vote did NOT register on the server.
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


// ── MY BAG (Terra Oracle) - реальные данные с Oracle Draw ──────────────────────

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
// Подпись NFT. Контрактные id вида common-5 раньше сюда не попадали и
// уходили в последнюю ветку как "#common-5" - тир дублировался с надписью
// над карточкой. Формат приведён к тому же виду, что на draw.terraoracle.io.
// Контракт:  common-5              → "Common #5"
// Наследие Paco: Common_0952…_ETME5 → "ETME5"
function oFormatNFTLabel(tokenId) {
  if (!tokenId) return '-';
  const str = String(tokenId);
  const m = str.match(/^(common|rare|legendary)-(\d+)$/i);
  if (m) {
    const tier = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    return tier + ' #' + m[2];
  }
  const parts = str.split('_');
  if (parts.length >= 3) return parts[parts.length - 1];
  return str.slice(0, 8);
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

  // Токены берём прямо из контракта Oracle Mask через OracleNFT: маркетплейс
  // nft.lunc.tools отключён 31 авг 2026, и прокси воркера /owned-nfts ходил
  // именно туда. getContractTokensLegacy отдаёт тот же формат, что раньше
  // приходил от Paco (slug, token_id, name, tier), поэтому разбор ниже не
  // меняется. Статистика раундов по-прежнему идёт через воркер.
  const [nftResult, dailyStatsResult, weeklyStatsResult] = await Promise.allSettled([
    (window.OracleNFT && typeof OracleNFT.getContractTokensLegacy === 'function')
      ? OracleNFT.getContractTokensLegacy(wallet)
      : Promise.reject(new Error('oracle-nft-client.js не загружен')),
    oFetch(`${O_DRAW_WORKER}/round-stats?pool=daily`, {}, 2),
    oFetch(`${O_DRAW_WORKER}/round-stats?pool=weekly`, {}, 2),
  ]);

  let allNFTs = null, pacoError = null;
  let dailyActiveWallets = new Set(), weeklyActiveWallets = new Set();

  if (nftResult.status === 'fulfilled' && Array.isArray(nftResult.value)) {
    allNFTs = nftResult.value;
    oSaveBagCache(wallet, allNFTs);
  } else {
    // Пустой ответ от узла и отказ узла - разные вещи, но обе оставляют
    // экран без данных: показываем кеш, как и раньше при отказе Paco.
    pacoError = nftResult.reason?.message || 'Contract query failed';
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

  // Fetch wins from Draw Worker - count unique rounds
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
            : '<span style="color:var(--muted);">-</span>';
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

