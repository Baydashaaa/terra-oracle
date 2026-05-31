// ─── REPUTATION MODULE · terra-oracle ────────────────────────
// Pages: leaderboard | how it works
// Triggered by showRepPage(tab)

// ── Show reputation page ──────────────────────────────────────
let _repCurrentTab = 'leaderboard';

function showRepPage(tab, skipHistory) {
  tab = tab || _repCurrentTab;
  _repCurrentTab = tab;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const pg = document.getElementById('page-reputation');
  if (!pg) return;
  pg.classList.add('active');
  const repTab = document.querySelector('.nav-node');
  if (repTab) repTab.classList.add('active');
  if (!skipHistory && history.pushState) history.pushState({ page: 'reputation:' + tab }, '', '/reputation/' + tab);
  try { sessionStorage.setItem('currentPage', 'reputation:' + tab); } catch(e) {}

  window.scrollTo(0, 0);
  renderRepPage(tab);

  requestAnimationFrame(() => {
    document.body.style.overflow = '';
    window.scrollTo(0, 0);
  });
}

function renderRepPage(tab) {
  const pg = document.getElementById('page-reputation');
  if (!pg) return;

  const isConnected = typeof globalWalletAddress !== 'undefined' && globalWalletAddress;

  pg.innerHTML = `
    <div style="text-align:center;margin-bottom:36px;">
      <div style="display:inline-block;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;
        color:var(--accent);border:1px solid rgba(84,147,247,0.3);padding:4px 14px;border-radius:20px;
        background:rgba(84,147,247,0.05);margin-bottom:14px;">ORACLE REPUTATION</div>
      <h1 style="font-family:'Rajdhani',sans-serif;font-weight:800;font-size:clamp(26px,4vw,38px);color:#fff;margin-bottom:10px;display:flex;align-items:center;justify-content:center;">
        ${tab === 'leaderboard' ? '<span style="display:inline-flex;align-items:center;gap:10px;"><img src="/assets/icons/Leaderboard.png" style="width:80px;height:80px;flex-shrink:0;display:block;"><span style="color:#fff;font-size:clamp(26px,4vw,38px);font-weight:800;margin-top:8px;">Leaderboard</span></span>' : tab === 'stats' ? '<span style="display:inline-flex;align-items:center;gap:10px;"><img src="/assets/icons/Stats.png" style="width:80px;height:80px;flex-shrink:0;display:block;mix-blend-mode:screen;"><span style="color:#fff;font-size:clamp(26px,4vw,38px);font-weight:800;margin-top:8px;">Your Stats</span></span>' : '<span style="display:inline-flex;align-items:center;gap:10px;"><img src="/assets/icons/How-it-works.png" style="width:80px;height:80px;flex-shrink:0;display:block;"><span style="color:#fff;font-size:clamp(26px,4vw,38px);font-weight:800;margin-top:8px;">How it Works</span></span>'}
      </h1>
      <p style="font-size:12px;color:var(--muted);">
        ${tab === 'leaderboard' ? 'Top contributors ranked by Oracle Reputation score'
        : tab === 'stats'      ? 'Your activity breakdown · weekly rewards · estimated payout'
        :                        'Earn REP through activity · Unlock ranks, discounts & rewards'}
      </p>
    </div>

    <!-- Tab switcher -->
    <div style="display:flex;gap:8px;margin-bottom:28px;justify-content:center;flex-wrap:wrap;">
      <button onclick="showRepPage('leaderboard')" style="
        background:${tab==='leaderboard' ? 'rgba(84,147,247,0.12)' : 'transparent'};
        border:1px solid ${tab==='leaderboard' ? 'rgba(84,147,247,0.4)' : 'var(--border)'};
        color:${tab==='leaderboard' ? 'var(--accent)' : 'var(--muted)'};
        font-family:'Exo 2',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;
        padding:8px 20px;border-radius:8px;cursor:pointer;transition:all 0.2s;">
        <img src="/assets/icons/Leaderboard.png" style="width:35px;height:35px;vertical-align:middle;margin-right:4px;"> Leaderboard
      </button>
      <button onclick="showRepPage('stats')" style="
        background:${tab==='stats' ? 'rgba(84,147,247,0.12)' : 'transparent'};
        border:1px solid ${tab==='stats' ? 'rgba(84,147,247,0.4)' : 'var(--border)'};
        color:${tab==='stats' ? 'var(--accent)' : 'var(--muted)'};
        font-family:'Exo 2',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;
        padding:8px 20px;border-radius:8px;cursor:pointer;transition:all 0.2s;">
        <img src="/assets/icons/Stats.png" style="width:35px;height:35px;vertical-align:middle;margin-right:4px;mix-blend-mode:screen;"> Your Stats
      </button>
      <button onclick="showRepPage('how')" style="
        background:${tab==='how' ? 'rgba(84,147,247,0.12)' : 'transparent'};
        border:1px solid ${tab==='how' ? 'rgba(84,147,247,0.4)' : 'var(--border)'};
        color:${tab==='how' ? 'var(--accent)' : 'var(--muted)'};
        font-family:'Exo 2',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;
        padding:8px 20px;border-radius:8px;cursor:pointer;transition:all 0.2s;">
        <img src="/assets/icons/How-it-works.png" style="width:35px;height:35px;vertical-align:middle;margin-right:4px;"> How it Works
      </button>
    </div>

    <div id="rep-tab-content">
      ${tab === 'leaderboard' ? renderLeaderboardHTML()
      : tab === 'stats'      ? renderStatsHTML(isConnected)
      :                        renderHowItWorksHTML()}
    </div>
  `;

  if (tab === 'leaderboard') loadLeaderboard();
  if (tab === 'stats') {
    // Poll until wallet is ready (session restore can take up to 3s)
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      const addr = typeof globalWalletAddress !== 'undefined' && globalWalletAddress;
      if (addr) {
        clearInterval(poll);
        loadStatsData();
      } else if (attempts >= 20) {
        clearInterval(poll); // give up after 4s — show connect prompt
      }
    }, 200);
  }
}

// ── LEADERBOARD ───────────────────────────────────────────────
function renderLeaderboardHTML() {
  return `
    <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
      <button onclick="switchLeaderboardPeriod('weekly')" id="lb-btn-weekly" style="
        background:rgba(84,147,247,0.12);border:1px solid rgba(84,147,247,0.4);
        color:var(--accent);font-family:'Exo 2',sans-serif;font-size:10px;font-weight:700;
        letter-spacing:0.1em;padding:6px 16px;border-radius:6px;cursor:pointer;">
        📅 Weekly
      </button>
      <button onclick="switchLeaderboardPeriod('alltime')" id="lb-btn-alltime" style="
        background:transparent;border:1px solid var(--border);
        color:var(--muted);font-family:'Exo 2',sans-serif;font-size:10px;font-weight:700;
        letter-spacing:0.1em;padding:6px 16px;border-radius:6px;cursor:pointer;">
        🔥 All Time
      </button>
    </div>
    <div id="leaderboard-list">
      <div style="text-align:center;padding:40px;color:var(--muted);font-size:12px;">Loading...</div>
    </div>
  `;
}

let _lbPeriod = 'weekly';

function switchLeaderboardPeriod(period) {
  _lbPeriod = period;
  const weekly  = document.getElementById('lb-btn-weekly');
  const alltime = document.getElementById('lb-btn-alltime');
  if (weekly) {
    const active = 'background:rgba(84,147,247,0.12);border:1px solid rgba(84,147,247,0.4);color:var(--accent);';
    const inactive = 'background:transparent;border:1px solid var(--border);color:var(--muted);';
    weekly.style.cssText  += period === 'weekly'  ? active : inactive;
    alltime.style.cssText += period === 'alltime' ? active : inactive;
  }
  loadLeaderboard();
}

async function loadLeaderboard() {
  const el = document.getElementById('leaderboard-list');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:12px;">Loading contributors...</div>';

  try {
    // Fetch all questions from worker
    const WORKER_URL = typeof window.WORKER_URL !== 'undefined'
      ? window.WORKER_URL
      : 'https://terra-oracle-questions.vladislav-baydan.workers.dev';

    const res = await fetch(`${WORKER_URL}/questions`);
    if (!res.ok) throw new Error('Worker error');
    const data = await res.json();
    const allQuestions = data.questions || [];

    // Build per-wallet stats
    const wallets = {};
    const cutoff = _lbPeriod === 'weekly'
      ? Math.floor(Date.now() / 1000) - 7 * 86400
      : 0;
    const cutoffDate = new Date(cutoff * 1000).toISOString().slice(0, 10);

    for (const q of allQuestions) {
      if (!q.wallet) continue;
      const qThisWeek = q.createdAt >= cutoff;

      // For weekly: only count questions asked this week
      if (_lbPeriod === 'weekly' && !qThisWeek) {
        // Still check answers for this week
        for (const a of q.answers || []) {
          if (!a.wallet) continue;
          const aThisWeek = (a.createdAt || 0) >= cutoff;
          if (!aThisWeek) continue;
          if (!wallets[a.wallet]) wallets[a.wallet] = { wallet: a.wallet, alias: a.alias || ('Anonymous#' + a.wallet.slice(-4).toUpperCase()), questions: 0, answers: 0, upvotesGiven: 0, upvotesReceived: 0 };
          wallets[a.wallet].answers++;
          wallets[a.wallet].upvotesReceived += a.votes || 0;
        }
        continue;
      }

      if (!wallets[q.wallet]) wallets[q.wallet] = { wallet: q.wallet, alias: q.alias || ('Anonymous#' + q.wallet.slice(-4).toUpperCase()), questions: 0, answers: 0, upvotesGiven: 0, upvotesReceived: 0 };
      wallets[q.wallet].questions++;

      for (const a of q.answers || []) {
        if (!a.wallet) continue;
        const aThisWeek = _lbPeriod !== 'weekly' || (a.createdAt || 0) >= cutoff;
        if (!aThisWeek) continue;
        if (!wallets[a.wallet]) wallets[a.wallet] = { wallet: a.wallet, alias: a.alias || ('Anonymous#' + a.wallet.slice(-4).toUpperCase()), questions: 0, answers: 0, upvotesGiven: 0, upvotesReceived: 0 };
        wallets[a.wallet].answers++;
        wallets[a.wallet].upvotesReceived += a.votes || 0;
      }
    }

    // Always include connected wallet
    const connWallet = typeof globalWalletAddress !== 'undefined' ? globalWalletAddress : null;
    if (connWallet && !wallets[connWallet]) {
      wallets[connWallet] = { wallet: connWallet, alias: 'Anonymous#' + connWallet.slice(-4).toUpperCase(), questions: 0, answers: 0, upvotesGiven: 0, upvotesReceived: 0 };
    }

    // Fetch draw REP, chat REP and streak for all wallets in parallel
    const walletList = Object.values(wallets);
    const drawRepMap = {}, chatRepMap = {}, streakMap = {};
    try {
      const fetches = walletList.slice(0, 20).flatMap(w => [
        fetch(`${WORKER_URL}/rep/draw?wallet=${w.wallet}`)
          .then(r => r.ok ? r.json() : { total: 0, history: [] })
          .then(d => {
            if (_lbPeriod === 'weekly') {
              drawRepMap[w.wallet] = (d.history || [])
                .filter(h => (h.date || '') >= cutoffDate)
                .reduce((s, h) => s + (h.points || 0), 0);
            } else {
              drawRepMap[w.wallet] = d.total || 0;
            }
          })
          .catch(() => { drawRepMap[w.wallet] = 0; }),
        fetch(`${WORKER_URL}/chat/count?wallet=${w.wallet}`)
          .then(r => r.ok ? r.json() : { msgCount: 0, history: [] })
          .then(d => {
            if (_lbPeriod === 'weekly') {
              const weekMsgs = (d.history || []).filter(h => (h.date || '') >= cutoffDate).length;
              chatRepMap[w.wallet] = weekMsgs * 5;
            } else {
              chatRepMap[w.wallet] = (d.msgCount || 0) * 5;
            }
          })
          .catch(() => { chatRepMap[w.wallet] = 0; }),
        fetch(`${WORKER_URL}/streak?wallet=${w.wallet}`)
          .then(r => r.ok ? r.json() : { multiplier: 1.0 })
          .then(d => { streakMap[w.wallet] = d.multiplier || 1.0; })
          .catch(() => { streakMap[w.wallet] = 1.0; }),
      ]);
      await Promise.all(fetches);
    } catch(e) {}

    const ranked = Object.values(wallets).map(w => {
      const drawRep  = drawRepMap[w.wallet] || 0;
      const chatRep  = chatRepMap[w.wallet] || 0;
      const multiplier = streakMap[w.wallet] || 1.0;
      const baseScore = w.questions * 40 + w.answers * 15 + (w.upvotesReceived || 0) * 10 + chatRep + drawRep;
      const score = Math.round(baseScore * multiplier);
      const rank  = typeof getRank === 'function' ? getRank(score) : { name: 'INITIATE', icon: '◈', color: '#6b82a8', glow: 'rgba(107,130,168,0.3)' };
      return { ...w, score, drawRep, chatRep, multiplier, rank };
    }).filter(w => w.score > 0).sort((a, b) => b.score - a.score).slice(0, 50);

    const myWallet = typeof globalWalletAddress !== 'undefined' ? globalWalletAddress : null;
    window._lbRanked   = ranked;
    window._lbMyWallet = myWallet;
    renderLeaderboardPage(0);

  } catch(e) {
    const el2 = document.getElementById('leaderboard-list');
    if (el2) el2.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:12px;">Could not load leaderboard</div>';
  }
}

function renderLeaderboardPage(page) {
  const el = document.getElementById('leaderboard-list');
  if (!el) return;
  const ranked    = window._lbRanked   || [];
  const myWallet  = window._lbMyWallet || null;
  const PAGE_SIZE = 20;
  const totalPages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  page = Math.max(0, Math.min(page, totalPages - 1));
  window._lbPage = page;

  const slice = ranked.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Always render 20 slots — fill empty ones with placeholder
  const slots = Array.from({ length: PAGE_SIZE }, (_, i) => {
    const globalIdx = page * PAGE_SIZE + i;
    const w = slice[i] || null;
    const medal = globalIdx === 0 ? '🥇' : globalIdx === 1 ? '🥈' : globalIdx === 2 ? '🥉' : `#${globalIdx + 1}`;
    const medalColor = globalIdx < 3 ? '#fff' : 'var(--muted)';

    // Top-3 medal styling (gold / silver / bronze)
    const MEDAL_STYLES = [
      { c: '#ffc828', rgba: '255,200,40' },   // gold
      { c: '#c8d2e1', rgba: '200,210,225' },  // silver
      { c: '#cd7f32', rgba: '205,127,50' },   // bronze
    ];
    const ms = globalIdx < 3 ? MEDAL_STYLES[globalIdx] : null;

    if (!w) {
      // Empty slot
      return `
        <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;
          background:var(--surface);border:1px solid var(--border);
          border-radius:10px;margin-bottom:8px;opacity:0.35;">
          <div style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:800;
            color:${medalColor};min-width:32px;text-align:center;">${medal}</div>
          <div style="flex:1;">
            <div style="width:140px;height:12px;background:var(--border);border-radius:4px;margin-bottom:6px;"></div>
            <div style="width:200px;height:9px;background:var(--border);border-radius:4px;opacity:0.5;"></div>
          </div>
          <div style="text-align:right;">
            <div style="width:48px;height:18px;background:var(--border);border-radius:4px;margin-bottom:3px;"></div>
            <div style="font-size:9px;color:var(--muted);letter-spacing:0.08em;">REP</div>
          </div>
        </div>`;
    }

    const isMe = myWallet && w.wallet === myWallet;
    // Background/border: medal style for top-3, "me" highlight, or default
    const rowBg = ms
      ? `linear-gradient(100deg,rgba(${ms.rgba},0.1),rgba(14,24,48,0.4))`
      : (isMe ? 'rgba(84,147,247,0.07)' : 'var(--surface)');
    const rowBorder = ms
      ? `rgba(${ms.rgba},0.4)`
      : (isMe ? 'rgba(84,147,247,0.3)' : 'var(--border)');
    const accentBar = ms
      ? `<div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${ms.c};"></div>` : '';
    const medalSize = ms ? '25px' : '18px';
    const medalGlow = ms ? `filter:drop-shadow(0 0 6px rgba(${ms.rgba},0.5));` : '';
    const repColor = ms ? ms.c : w.rank.color;
    const repGlow  = ms ? `0 0 12px rgba(${ms.rgba},0.5)` : w.rank.glow;
    const repSize  = ms ? '24px' : '20px';
    return `
      <div style="display:flex;align-items:center;gap:14px;padding:${ms ? '16px' : '14px'} 16px;position:relative;overflow:hidden;
        background:${rowBg};
        border:1px solid ${rowBorder};
        border-radius:12px;margin-bottom:8px;transition:all 0.2s;${ms ? `box-shadow:0 0 20px rgba(${ms.rgba},0.07);` : ''}"
        onmouseover="this.style.borderColor='${ms ? `rgba(${ms.rgba},0.6)` : 'rgba(84,147,247,0.25)'}'"
        onmouseout="this.style.borderColor='${rowBorder}'">
        ${accentBar}
        <div style="font-family:'Rajdhani',sans-serif;font-size:${medalSize};font-weight:800;
          color:${medalColor};min-width:36px;text-align:center;${medalGlow}">${medal}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
            <span style="font-size:${ms ? '13px' : '12px'};font-weight:700;color:${isMe ? 'var(--accent)' : 'var(--text)'};
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${(w.wallet ? w.wallet.slice(0,8) + '...' + w.wallet.slice(-4) : 'Anonymous')}${isMe ? ' <span style="color:var(--accent);font-size:10px;">(you)</span>' : ''}
            </span>
            <span style="font-size:10px;font-weight:700;color:${w.rank.color};
              text-shadow:0 0 8px ${w.rank.glow};white-space:nowrap;">
              ${w.rank.icon} ${w.rank.name}
            </span>
          </div>
          <div style="display:flex;gap:12px;font-size:10px;color:var(--muted);flex-wrap:wrap;">
            <span>❓ ${w.questions} questions</span>
            <span>💬 ${w.answers} answers</span>
            <span>👍 ${w.upvotesReceived || 0} upvotes</span>
            ${w.drawRep ? `<span>🎭 +${w.drawRep} draw</span>` : ''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-family:'Rajdhani',sans-serif;font-size:${repSize};font-weight:800;
            color:${repColor};text-shadow:0 0 10px ${repGlow};">
            ${w.score.toLocaleString()}
          </div>
          <div style="font-size:9px;color:var(--muted);letter-spacing:0.08em;">REP</div>
        </div>
      </div>`;
  }).join('');

  const pagination = totalPages > 1 ? `
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:16px;">
      <button onclick="renderLeaderboardPage(${page - 1})"
        ${page === 0 ? 'disabled' : ''}
        style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);
          background:${page === 0 ? 'transparent' : 'var(--surface2)'};
          color:${page === 0 ? 'var(--muted)' : 'var(--text)'};
          cursor:${page === 0 ? 'default' : 'pointer'};font-size:12px;font-weight:600;
          transition:all 0.2s;">← Prev</button>
      <span style="font-size:11px;color:var(--muted);">
        Page ${page + 1} / ${totalPages}
        &nbsp;·&nbsp;
        <span style="color:var(--text);">${ranked.length} contributors</span>
      </span>
      <button onclick="renderLeaderboardPage(${page + 1})"
        ${page >= totalPages - 1 ? 'disabled' : ''}
        style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);
          background:${page >= totalPages - 1 ? 'transparent' : 'var(--surface2)'};
          color:${page >= totalPages - 1 ? 'var(--muted)' : 'var(--text)'};
          cursor:${page >= totalPages - 1 ? 'default' : 'pointer'};font-size:12px;font-weight:600;
          transition:all 0.2s;">Next →</button>
    </div>` : '';

  el.innerHTML = slots + pagination;
}

// ── YOUR STATS ────────────────────────────────────────────────
function renderStatsHTML(isConnected) {
  if (!isConnected) {
    return `
      <div style="text-align:center;padding:60px 20px;background:var(--surface);
        border:1px solid var(--border);border-radius:14px;">
        <div style="font-size:40px;margin-bottom:12px;">🔒</div>
        <div style="font-size:14px;color:var(--text);margin-bottom:6px;">Connect your wallet</div>
        <div style="font-size:12px;color:var(--muted);">Connect to see your reputation analytics</div>
      </div>`;
  }

  return `
    <!-- Activity breakdown -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px;margin-bottom:16px;">
      <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:16px;">
        Your Activity
      </div>
      <div id="stats-activity-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
        ${['questions','answers','upvotes','chat'].map(k => `
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;
            display:flex;align-items:center;justify-content:space-between;">
            <div>
              <div style="font-size:11px;color:var(--muted);margin-bottom:4px;" id="stats-label-${k}">
                ${{questions:'<img src="/assets/icons/questions.png" style="width:41px;height:41px;vertical-align:middle;margin-right:4px;"> Questions',answers:'<img src="/assets/icons/answers.png" style="width:41px;height:41px;vertical-align:middle;margin-right:4px;"> Answers',upvotes:'<img src="/assets/icons/upvotes.png" style="width:41px;height:41px;vertical-align:middle;margin-right:4px;"> Upvotes received',chat:'<img src="/assets/icons/chat-message.png" style="width:41px;height:41px;vertical-align:middle;margin-right:4px;"> Chat messages'}[k]}
              </div>
              <div style="font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:800;color:var(--text);" id="stats-count-${k}">…</div>
            </div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:16px;font-weight:800;
              color:${{questions:'var(--accent)',answers:'#66ffaa',upvotes:'#ffd700',chat:'#c084fc'}[k]};"
              id="stats-rep-${k}">…</div>
          </div>`).join('')}
        <!-- Oracle Draw card -->
        <div style="background:var(--surface2);border:1px solid rgba(255,136,68,0.25);border-radius:10px;padding:16px;
          display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:4px;"><img src="/assets/icons/oracle-draw-mints.png" style="width:41px;height:41px;vertical-align:middle;margin-right:4px;"> Oracle Draw mints</div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:800;color:var(--text);" id="stats-count-draw">…</div>
          </div>
          <div style="font-family:'Rajdhani',sans-serif;font-size:16px;font-weight:800;color:#ff8844;"
            id="stats-rep-draw">…</div>
        </div>
      </div>
      <div style="margin-top:10px;padding:10px 14px;background:var(--surface2);border:1px solid var(--border);
        border-radius:8px;font-size:10px;color:var(--muted);line-height:1.7;">
        <img src="/assets/icons/questions.png" style="width:25px;height:25px;vertical-align:middle;"> Questions: <strong style="color:var(--text);">+40 REP</strong> each ·
        <img src="/assets/icons/answers.png" style="width:25px;height:25px;vertical-align:middle;"> Answers: <strong style="color:var(--text);">+15 REP</strong> each ·
        <img src="/assets/icons/upvotes.png" style="width:25px;height:25px;vertical-align:middle;"> Upvotes: <strong style="color:var(--text);">+10 REP</strong> each ·
        <img src="/assets/icons/chat-message.png" style="width:25px;height:25px;vertical-align:middle;"> Chat: <strong style="color:var(--text);">+5 REP</strong> per message ·
        <img src="/assets/icons/oracle-draw-mints.png" style="width:25px;height:25px;vertical-align:middle;"> Draw: <strong style="color:#ff8844;">+25/125/250 REP</strong> per mint
      </div>
      <div style="margin-top:16px;padding:14px 16px;background:var(--surface2);border:1px solid var(--border);
        border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12px;color:var(--muted);">Total Reputation</span>
        <span style="font-family:'Rajdhani',sans-serif;font-size:24px;font-weight:800;color:var(--accent);"
          id="stats-total-rep">…</span>
      </div>
    </div>

    <!-- Oracle Draw REP -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px;margin-bottom:16px;">
      <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:16px;">
        ORACLE DRAW ACTIVITY
      </div>
      <div id="stats-draw-block">
        <div style="text-align:center;padding:20px;color:var(--muted);font-size:12px;">Loading...</div>
      </div>
    </div>

    <!-- Rank + position -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px;margin-bottom:16px;">
      <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:16px;">
        Your Rank
      </div>
      <div id="stats-rank-block" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <div style="font-size:12px;color:var(--muted);">Loading…</div>
      </div>
    </div>

    <!-- Weekly Rewards Pool -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px;margin-bottom:16px;">
      <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:16px;">
        Weekly Rewards Pool
      </div>
      <div id="stats-pool-block">
        <div style="font-size:12px;color:var(--muted);">Loading…</div>
      </div>
    </div>

    <!-- Estimated Reward -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px;">
      <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:16px;">
        Your Estimated Reward
      </div>
      <div id="stats-reward-block">
        <div style="font-size:12px;color:var(--muted);">Loading…</div>
      </div>
    </div>
  `;
}

async function loadStatsData() {
  const wallet = typeof globalWalletAddress !== 'undefined' ? globalWalletAddress : null;
  if (!wallet) return;

  // Re-render stats HTML if it's showing the "connect wallet" prompt
  const tabContent = document.getElementById('rep-tab-content');
  if (tabContent && tabContent.innerHTML.includes('Connect your wallet') && typeof renderStatsHTML === 'function') {
    tabContent.innerHTML = renderStatsHTML(true);
  }

  const MIN_CONTRIBUTORS = 10;

  try {
    const WORKER_URL_LOCAL = typeof window.WORKER_URL !== 'undefined'
      ? window.WORKER_URL
      : 'https://terra-oracle-questions.vladislav-baydan.workers.dev';

    const [qStats, chatStats, drawRepData] = await Promise.all([
      typeof fetchQuestionStats === 'function' ? fetchQuestionStats(wallet) : Promise.resolve({ myQuestions: [], myAnswers: [], totalUpvotes: 0 }),
      typeof fetchChatStats     === 'function' ? fetchChatStats(wallet)     : Promise.resolve({ msgCount: 0 }),
      fetch(`${WORKER_URL_LOCAL}/rep/draw?wallet=${wallet}`).then(r => r.ok ? r.json() : { total: 0, history: [] }).catch(() => ({ total: 0, history: [] })),
    ]);

    const { myQuestions = [], myAnswers = [], totalUpvotes = 0 } = qStats;
    const msgCount       = chatStats?.msgCount   || 0;
    const drawRepTotal   = drawRepData?.total     || 0;
    const drawRepHistory = drawRepData?.history   || [];

    // All-time REP (unified formula — same as calcReputation in profile.js)
    const repQuestions = myQuestions.length * 40;
    const repAnswers   = myAnswers.length   * 15;
    const repUpvotes   = totalUpvotes       * 10;
    const repChat      = msgCount * 5;
    const repDraw      = drawRepTotal;
    const totalRep     = Math.round(repQuestions + repAnswers + repUpvotes + repChat + repDraw);

    // Update activity grid
    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    const totalDrawMints = drawRepHistory.length;
    set('stats-count-questions', myQuestions.length);
    set('stats-count-answers',   myAnswers.length);
    set('stats-count-upvotes',   totalUpvotes);
    set('stats-count-chat',      msgCount);
    set('stats-count-draw',      totalDrawMints);
    set('stats-rep-questions',   '+' + repQuestions.toLocaleString() + ' REP');
    set('stats-rep-answers',     '+' + repAnswers.toLocaleString()   + ' REP');
    set('stats-rep-upvotes',     '+' + repUpvotes.toLocaleString()   + ' REP');
    set('stats-rep-chat',        '+' + Math.round(repChat) + ' REP');
    set('stats-rep-draw',        drawRepTotal > 0 ? '+' + drawRepTotal.toLocaleString() + ' REP' : '+0 REP');
    set('stats-total-rep',       totalRep.toLocaleString() + ' REP');

    // Draw REP section
    const drawEl = document.getElementById('stats-draw-block');
    if (drawEl) {
      if (drawRepTotal === 0 && drawRepHistory.length === 0) {
        drawEl.innerHTML = `<div style="font-size:12px;color:var(--muted);text-align:center;padding:16px;">
          No Oracle Draw activity yet · <a href="https://draw.terraoracle.io/" target="_blank"
          style="color:var(--accent);text-decoration:none;">Mint your first NFT →</a></div>`;
      } else {
        // Count mints per tier
        const tierCounts = { common: 0, rare: 0, legendary: 0 };
        const tierRep    = { common: 25, rare: 125, legendary: 250 };
        for (const h of drawRepHistory) {
          const src = (h.source || '').toLowerCase();
          if (src.includes('common'))    tierCounts.common++;
          else if (src.includes('rare')) tierCounts.rare++;
          else if (src.includes('legendary')) tierCounts.legendary++;
        }
        const totalMints = tierCounts.common + tierCounts.rare + tierCounts.legendary;

        drawEl.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:12px;">
            ${[['common','#9ca3af',25],['rare','#60a5fa',125],['legendary','#fb923c',250]].map(([tier, color, pts]) => `
              <div style="background:${tier==='common'?'rgba(156,163,175,0.06)':tier==='rare'?'rgba(96,165,250,0.06)':'rgba(251,146,60,0.06)'};
                border:1px solid ${tier==='common'?'rgba(156,163,175,0.35)':tier==='rare'?'rgba(96,165,250,0.35)':'rgba(251,146,60,0.35)'};
                border-radius:10px;padding:12px;text-align:center;
                box-shadow:0 0 12px ${tier==='common'?'rgba(156,163,175,0.08)':tier==='rare'?'rgba(96,165,250,0.08)':'rgba(251,146,60,0.08)'};">
                <div style="font-size:10px;color:${color};margin-bottom:4px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">${tier}</div>
                <div style="font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:800;color:${color};">${tierCounts[tier]}</div>
                <div style="font-size:10px;color:var(--muted);margin-top:2px;">mints · +${(tierCounts[tier]*pts).toLocaleString()} REP</div>
              </div>`).join('')}
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;
            background:var(--surface2);border:1px solid var(--border);border-radius:10px;">
            <span style="font-size:12px;color:var(--muted);">${totalMints} total mints</span>
            <span style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:800;color:#ff8844;">+${drawRepTotal.toLocaleString()} REP</span>
          </div>
          ${drawRepHistory.length > 0 ? `
          <div style="margin-top:10px;">
            <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">Recent activity</div>
            ${drawRepHistory.slice(0, 5).map(h => {
              const src = h.source || '';
              const tier = src.includes('legendary') ? 'Legendary' : src.includes('rare') ? 'Rare' : 'Common';
              const pool = src.includes('weekly') ? 'Weekly' : 'Daily';
              const pts  = h.points || 0;
              const color = tier === 'Legendary' ? '#fb923c' : tier === 'Rare' ? '#60a5fa' : '#9ca3af';
              const date  = h.ts ? new Date(h.ts * 1000).toLocaleDateString([], {month:'short',day:'numeric'}) : '';
              return `<div style="display:flex;align-items:center;justify-content:space-between;
                padding:8px 12px;background:var(--surface2);border:1px solid var(--border);
                border-radius:8px;margin-bottom:6px;">
                <div>
                  <span style="font-size:11px;font-weight:700;color:${color};">${tier}</span>
                  <span style="font-size:10px;color:var(--muted);margin-left:8px;">${pool} Draw</span>
                  ${date ? `<span style="font-size:10px;color:var(--muted);margin-left:8px;">${date}</span>` : ''}
                </div>
                <span style="font-size:11px;font-weight:700;color:#ff8844;">+${pts} REP</span>
              </div>`;
            }).join('')}
          </div>` : ''}`;
      }
    }

    // Rank block
    const rank     = typeof getRank     === 'function' ? getRank(totalRep)     : null;
    const nextRank = typeof getNextRank === 'function' ? getNextRank(totalRep) : null;
    const rankEl   = document.getElementById('stats-rank-block');
    if (rankEl && rank) {
      const pct = nextRank
        ? Math.round(((totalRep - rank.minScore) / (nextRank.minScore - rank.minScore)) * 100)
        : 100;
      rankEl.innerHTML = `
        <div style="flex:1;">
          <div style="font-size:20px;font-weight:800;color:${rank.color};
            text-shadow:0 0 12px ${rank.glow};margin-bottom:8px;letter-spacing:0.08em;">
            ${rank.icon} ${rank.name}
          </div>
          ${nextRank ? `
            <div style="font-size:10px;color:var(--muted);margin-bottom:6px;">
              Progress to <span style="color:${nextRank.color};font-weight:700;">${nextRank.icon} ${nextRank.name}</span>
              · need <strong style="color:var(--text);">${(nextRank.minScore - totalRep).toLocaleString()}</strong> more REP
            </div>
            <div style="background:rgba(255,255,255,0.06);border-radius:6px;height:8px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,${rank.bar},${nextRank.bar});
                border-radius:6px;box-shadow:0 0 8px ${rank.glow};transition:width 0.8s ease;"></div>
            </div>` : `
            <div style="font-size:11px;color:${rank.color};font-weight:700;letter-spacing:0.06em;">
              MAX RANK ACHIEVED
            </div>`}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:10px;color:var(--muted);margin-bottom:4px;letter-spacing:0.08em;">REWARD MULTIPLIER</div>
          <div style="font-family:'Rajdhani',sans-serif;font-size:28px;font-weight:800;
            color:${rank.color};text-shadow:0 0 10px ${rank.glow};">x${rank.multiplier}</div>
        </div>`;
    }

    // Fetch all questions for weekly scoring
    const WORKER_URL = typeof window.WORKER_URL !== 'undefined'
      ? window.WORKER_URL
      : 'https://terra-oracle-questions.vladislav-baydan.workers.dev';

    const res = await fetch(`${WORKER_URL}/questions`);
    const data = await res.json();
    const allQuestions = data.questions || [];

    // Build 7-day scores per wallet
    const cutoff7d      = Math.floor(Date.now() / 1000) - 7 * 86400;
    const weeklyScores  = {};
    for (const q of allQuestions) {
      if (!q.wallet || (q.createdAt || 0) < cutoff7d) continue;
      if (!weeklyScores[q.wallet]) weeklyScores[q.wallet] = 0;
      weeklyScores[q.wallet] += 40 + (q.votes || 0) * 15;
      for (const a of q.answers || []) {
        if (!a.wallet) continue;
        if (!weeklyScores[a.wallet]) weeklyScores[a.wallet] = 0;
        weeklyScores[a.wallet] += 5 + (a.votes || 0) * 15;
      }
    }
    // Include current user's 7d score
    const myWeeklyScore = weeklyScores[wallet] || Math.round(
      myQuestions.filter(q => (q.createdAt||0) >= cutoff7d).length * 40 +
      myAnswers.filter(a => (a.createdAt||0) >= cutoff7d).length * 5
    );
    if (!weeklyScores[wallet]) weeklyScores[wallet] = myWeeklyScore;

    const allWeeklyEntries  = Object.entries(weeklyScores).sort((a, b) => b[1] - a[1]);
    const totalContributors = allWeeklyEntries.length;
    const myPosition        = allWeeklyEntries.findIndex(([w]) => w === wallet) + 1;
    const top20pct          = Math.ceil(totalContributors * 0.2);
    const inTop20           = myPosition > 0 && myPosition <= top20pct;
    const poolActive        = totalContributors >= MIN_CONTRIBUTORS;

    // Fetch REP Rewards wallet balance directly (already 25% of treasury)
    const REP_REWARDS_WALLET = 'terra1ty6fxd9u0jzae5lpzcs56rfclxg4q32hw5x4ce';
    let poolLunc = 0;
    try {
      const tRes  = await fetch(`https://terra-classic-lcd.publicnode.com/cosmos/bank/v1beta1/balances/${REP_REWARDS_WALLET}`);
      const tData = await tRes.json();
      const uluna = parseInt(tData.balances?.find(b => b.denom === 'uluna')?.amount || '0');
      poolLunc    = Math.round(uluna / 1_000_000);
    } catch(e) {}

    // Pool block
    const poolEl = document.getElementById('stats-pool-block');
    if (poolEl) {
      poolEl.innerHTML = `
        ${!poolActive ? `
          <div style="padding:14px 16px;background:rgba(255,165,0,0.06);border:1px solid rgba(255,165,0,0.2);
            border-radius:10px;margin-bottom:16px;">
            <div style="font-size:10px;color:rgba(255,165,0,0.9);font-weight:700;margin-bottom:6px;
              letter-spacing:0.1em;text-transform:uppercase;">Pool Inactive - Rollover Mode</div>
            <div style="font-size:12px;color:var(--muted);line-height:1.7;margin-bottom:12px;">
              Weekly rewards activate when <strong style="color:var(--text);">${MIN_CONTRIBUTORS} contributors</strong>
              are active. The pool accumulates and carries over each week until the threshold is reached.
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:6px;">
              <span>Contributors this week</span>
              <span style="color:var(--text);font-weight:700;">${totalContributors} / ${MIN_CONTRIBUTORS}</span>
            </div>
            <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:5px;overflow:hidden;">
              <div style="height:100%;width:${Math.min(100, (totalContributors/MIN_CONTRIBUTORS)*100)}%;
                background:linear-gradient(90deg,rgba(255,165,0,0.5),rgba(255,165,0,0.85));border-radius:4px;"></div>
            </div>
          </div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:10px;color:var(--muted);margin-bottom:6px;letter-spacing:0.1em;text-transform:uppercase;">Weekly Pool</div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:800;color:#66ffaa;">
              ${poolLunc > 0 ? poolLunc.toLocaleString() + ' LUNC' : '-'}
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:4px;">REP Rewards Pool balance</div>
            <div style="font-size:9px;color:rgba(255,255,255,0.2);margin-top:3px;font-family:monospace;">terra1ty6...x4ce</div>
          </div>
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:10px;color:var(--muted);margin-bottom:6px;letter-spacing:0.1em;text-transform:uppercase;">Your Status</div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:15px;font-weight:800;
              color:${!poolActive ? 'rgba(255,165,0,0.9)' : inTop20 ? '#66ffaa' : 'var(--muted)'};">
              ${!poolActive ? 'Pending threshold' : inTop20 ? 'Top 20%' : 'Not eligible'}
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:4px;">
              ${myPosition > 0 ? 'Rank #' + myPosition + ' of ' + totalContributors : 'No activity this week'}
            </div>
          </div>
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:10px;color:var(--muted);margin-bottom:6px;letter-spacing:0.1em;text-transform:uppercase;">Your Weekly REP</div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:800;color:var(--accent);">
              ${myWeeklyScore.toLocaleString()}
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:4px;">Last 7 days</div>
          </div>
        </div>`;
    }

    // Estimated reward
    const rewardEl = document.getElementById('stats-reward-block');
    if (rewardEl) {
      let estimatedLunc = 0;
      if (poolActive && inTop20 && poolLunc > 0 && rank) {
        const myWeighted = myWeeklyScore * rank.multiplier;
        const totalWeighted = allWeeklyEntries.slice(0, top20pct)
          .reduce((s, [w, score]) => {
            const r = typeof getRank === 'function' ? getRank(weeklyScores[w] || 0) : { multiplier: 1 };
            return s + score * r.multiplier;
          }, 0);
        if (totalWeighted > 0) estimatedLunc = Math.round(poolLunc * (myWeighted / totalWeighted));
      }

      rewardEl.innerHTML = !poolActive ? `
        <div style="text-align:center;padding:20px;">
          <div style="font-size:13px;color:var(--muted);line-height:1.7;">
            The pool is accumulating. Rewards will be distributed once
            <strong style="color:var(--text);">${MIN_CONTRIBUTORS} active contributors</strong> are reached.
            Current pool: <strong style="color:#66ffaa;">${poolLunc > 0 ? poolLunc.toLocaleString() + ' LUNC' : '-'}</strong>
          </div>
        </div>` : inTop20 ? `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
          <div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:36px;font-weight:800;color:#ffd700;
              text-shadow:0 0 16px rgba(255,215,0,0.4);">
              ~${estimatedLunc > 0 ? estimatedLunc.toLocaleString() : '-'} LUNC
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">
              ${myWeeklyScore.toLocaleString()} weekly REP x${rank?.multiplier || 1} multiplier
            </div>
          </div>
          <div style="font-size:11px;color:var(--muted);max-width:260px;line-height:1.7;">
            Full pool distributed to top 20% contributors · proportional to 7-day REP × rank multiplier.
          </div>
        </div>` : `
        <div style="text-align:center;padding:20px;">
          <div style="font-size:13px;color:var(--muted);margin-bottom:8px;">
            You need to be in the <strong style="color:var(--text);">top 20%</strong> to earn weekly rewards
          </div>
          <div style="font-size:12px;color:var(--muted);">
            Current rank: <strong style="color:var(--text);">#${myPosition || '-'}</strong> of ${totalContributors} ·
            Top <strong style="color:var(--text);">${top20pct}</strong> qualify this week
          </div>
        </div>`;
    }

  } catch(err) {
    console.warn('loadStatsData error:', err);
  }
}

// ── HOW IT WORKS ──────────────────────────────────────────────
function renderHowItWorksHTML() {
  const ranks = typeof RANKS !== 'undefined' ? RANKS : [];

  return `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;margin-bottom:16px;">
      <div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);margin-bottom:14px;">
        What is Oracle Reputation
      </div>
      <p style="font-size:13px;color:var(--text);line-height:1.85;margin-bottom:20px;">
        Oracle Reputation (REP) measures your contribution to the Terra Oracle protocol.
        It is <strong style="color:var(--accent);">not a token or balance</strong> -
        it reflects your <strong style="color:var(--text);">activity, quality, and engagement</strong>
        across all protocol modules. REP accumulates over time and unlocks ranks, fee discounts, and weekly rewards.
      </p>
      <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:12px;">
        How REP is earned
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:16px;">
        ${[
          ['Ask a question',      '+40 REP per question',              'var(--accent)'],
          ['Answer a question',   '+15 REP per answer',                '#66ffaa'      ],
          ['Upvote received',     '+10 REP per upvote',                '#ffd700'      ],
          ['Chat message',        '+5 REP per message',                '#c084fc'      ],
          ['Mint Common NFT',     '+25 REP per mint',                  '#9ca3af'      ],
          ['Mint Rare NFT',       '+125 REP per mint',                 '#60a5fa'      ],
          ['Mint Legendary NFT',  '+250 REP per mint',                 '#fb923c'      ],
        ].map(([label, rep, color]) => `
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;">
            <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">${label}</div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:16px;font-weight:800;color:${color};">${rep}</div>
          </div>`).join('')}
      </div>
      <div style="padding:14px 16px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border);">
        <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">
          Anti-abuse limits
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--muted);line-height:1.6;">
          <div>Answers are limited to 3 per question per day to prevent spam.</div>
          <div>Voting is capped at 20 votes per day per wallet.</div>
          <div>Self-votes on questions and answers are blocked.</div>
        </div>
      </div>
    </div>

    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;margin-bottom:16px;">
      <div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">
        Oracle Ascension
      </div>
      <p style="font-size:12px;color:var(--muted);line-height:1.7;margin-bottom:18px;">
        As your REP grows, you ascend through 7 ranks. Each rank unlocks a fee discount on questions
        and a reward multiplier applied to your weekly earnings.
      </p>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${ranks.map(r => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
            background:var(--surface2);border:1px solid var(--border);border-radius:10px;min-width:0;">
            <div style="font-size:12px;font-weight:800;color:${r.color};
              text-shadow:0 0 8px ${r.glow};flex:1;min-width:0;letter-spacing:0.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${r.icon} ${r.name}
            </div>
            <div style="font-size:10px;color:var(--muted);white-space:nowrap;flex-shrink:0;">
              ${r.minScore === 0 ? 'Start' : r.minScore.toLocaleString() + ' REP'}
            </div>
            <div style="font-size:10px;color:${r.color};font-weight:700;flex-shrink:0;opacity:${r.multiplier > 1 ? 1 : 0.4};">
              x${r.multiplier}
            </div>
            ${r.discount > 0 ? `<div style="font-size:10px;color:var(--green);flex-shrink:0;">−${r.discount}%</div>` : ''}
          </div>`).join('')}
      </div>
    </div>

    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;margin-bottom:16px;">
      <div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">
        Weekly Reward Pool
      </div>
      <p style="font-size:12px;color:var(--muted);line-height:1.85;margin-bottom:20px;">
        Each week, <strong style="color:var(--text);">25% of Protocol Treasury</strong> income is transferred to the <strong style="color:#66ffaa;">REP Rewards Pool</strong> wallet - and the full balance is paid out to top contributors.
        This pool is distributed to the <strong style="color:var(--text);">top 20% of contributors</strong>
        ranked by their REP earned in the last 7 days. Your share is proportional to your weekly REP
        multiplied by your rank multiplier.
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;">
          <div style="font-size:10px;color:var(--muted);margin-bottom:8px;letter-spacing:0.1em;text-transform:uppercase;">Reward formula</div>
          <div style="font-size:12px;color:var(--text);line-height:1.85;">
            Your share =<br>
            <span style="color:var(--accent);">(your 7-day REP x rank multiplier)</span><br>
            divided by total weighted REP of top 20%<br>
            multiplied by weekly pool
          </div>
        </div>
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;">
          <div style="font-size:10px;color:var(--muted);margin-bottom:8px;letter-spacing:0.1em;text-transform:uppercase;">Scoring period</div>
          <div style="font-size:12px;color:var(--text);line-height:1.85;">
            Only activity from the <strong style="color:var(--text);">last 7 days</strong> counts toward weekly rewards.
            All-time REP still determines your rank and fee discounts.
          </div>
        </div>
      </div>
      <div style="padding:14px 16px;background:rgba(255,165,0,0.05);border:1px solid rgba(255,165,0,0.2);
        border-radius:8px;margin-bottom:16px;">
        <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,165,0,0.8);margin-bottom:8px;">
          Activation threshold
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.7;">
          Weekly rewards only activate when at least <strong style="color:var(--text);">10 unique contributors</strong>
          are active in a given week. If the threshold is not met, the pool carries over to the following week
          and continues accumulating until the minimum is reached.
        </div>
      </div>
      <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin-bottom:12px;">
        Rank multipliers
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;">
        ${ranks.filter(r => r.multiplier > 1).map(r => `
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:11px;font-weight:700;color:${r.color};margin-bottom:6px;letter-spacing:0.04em;">${r.icon} ${r.name}</div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:800;color:${r.color};
              text-shadow:0 0 10px ${r.glow};">x${r.multiplier}</div>
          </div>`).join('')}
      </div>
    </div>

    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;">
      <div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">
        REP Persistence
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;color:var(--muted);line-height:1.85;">
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;">
          <div style="font-size:10px;color:var(--muted);margin-bottom:8px;letter-spacing:0.1em;text-transform:uppercase;">All-time REP</div>
          <div>Accumulates forever. Used to determine your rank and unlock fee discounts. Never resets.</div>
        </div>
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;">
          <div style="font-size:10px;color:var(--muted);margin-bottom:8px;letter-spacing:0.1em;text-transform:uppercase;">Weekly REP</div>
          <div>Only activity from the last 7 days. Resets each week. Used exclusively for reward distribution.</div>
        </div>
      </div>
    </div>
  `;
}

// ── fetchChatStats ─────────────────────────────────────────────
// Fetches the total number of chat messages a wallet has sent.
// Used by Your Stats (reputation:stats) to compute Chat REP (msgCount × 5).
async function fetchChatStats(wallet) {
  try {
    const WORKER_URL = typeof window.WORKER_URL !== 'undefined'
      ? window.WORKER_URL
      : 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
    const res = await fetch(`${WORKER_URL}/chat/count?wallet=${wallet}`);
    if (!res.ok) return { msgCount: 0 };
    const data = await res.json();
    return { msgCount: data.msgCount || data.total || 0 };
  } catch (e) {
    console.warn('fetchChatStats failed:', e);
    return { msgCount: 0 };
  }
}
window.fetchChatStats = fetchChatStats;
