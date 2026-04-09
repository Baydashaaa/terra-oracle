// ─── REPUTATION MODULE · terra-oracle ────────────────────────
// Pages: leaderboard | how it works
// Triggered by showRepPage(tab)

// ── Show reputation page ──────────────────────────────────────
let _repCurrentTab = 'leaderboard';

function showRepPage(tab) {
  tab = tab || _repCurrentTab;
  _repCurrentTab = tab;

  // Hide all pages, show reputation
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const pg = document.getElementById('page-reputation');
  if (!pg) return;
  pg.classList.add('active');
  try { sessionStorage.setItem('currentPage', 'reputation:' + tab); } catch(e) {}
  if (typeof smoothScrollTop === 'function') smoothScrollTop();

  renderRepPage(tab);
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
      <h1 style="font-family:'Rajdhani',sans-serif;font-weight:800;font-size:clamp(26px,4vw,38px);color:#fff;margin-bottom:10px;">
        ${tab === 'leaderboard' ? '🏆 Leaderboard' : tab === 'stats' ? '📊 Your Stats' : '📖 How it Works'}
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
        🏆 Leaderboard
      </button>
      <button onclick="showRepPage('stats')" style="
        background:${tab==='stats' ? 'rgba(84,147,247,0.12)' : 'transparent'};
        border:1px solid ${tab==='stats' ? 'rgba(84,147,247,0.4)' : 'var(--border)'};
        color:${tab==='stats' ? 'var(--accent)' : 'var(--muted)'};
        font-family:'Exo 2',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;
        padding:8px 20px;border-radius:8px;cursor:pointer;transition:all 0.2s;">
        📊 Your Stats
      </button>
      <button onclick="showRepPage('how')" style="
        background:${tab==='how' ? 'rgba(84,147,247,0.12)' : 'transparent'};
        border:1px solid ${tab==='how' ? 'rgba(84,147,247,0.4)' : 'var(--border)'};
        color:${tab==='how' ? 'var(--accent)' : 'var(--muted)'};
        font-family:'Exo 2',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;
        padding:8px 20px;border-radius:8px;cursor:pointer;transition:all 0.2s;">
        📖 How it Works
      </button>
    </div>

    <div id="rep-tab-content">
      ${tab === 'leaderboard' ? renderLeaderboardHTML()
      : tab === 'stats'      ? renderStatsHTML(isConnected)
      :                        renderHowItWorksHTML()}
    </div>
  `;

  if (tab === 'leaderboard') loadLeaderboard();
  if (tab === 'stats' && isConnected) loadStatsData();
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

    for (const q of allQuestions) {
      if (q.createdAt < cutoff) continue;
      if (!q.wallet) continue;
      if (!wallets[q.wallet]) wallets[q.wallet] = { wallet: q.wallet, alias: q.alias || ('Anonymous#' + q.wallet.slice(-4).toUpperCase()), questions: 0, answers: 0, upvotes: 0 };
      wallets[q.wallet].questions++;
      wallets[q.wallet].upvotes += q.votes || 0;

      for (const a of q.answers || []) {
        if (!a.wallet) continue;
        if (!wallets[a.wallet]) wallets[a.wallet] = { wallet: a.wallet, alias: a.alias || ('Anonymous#' + a.wallet.slice(-4).toUpperCase()), questions: 0, answers: 0, upvotes: 0 };
        wallets[a.wallet].answers++;
        wallets[a.wallet].upvotes += a.votes || 0;
      }
    }

    // Calculate REP score for each
    const ranked = Object.values(wallets).map(w => {
      const score = w.questions * 40 + w.answers * 15 + w.upvotes * 10;
      const rank  = typeof getRank === 'function' ? getRank(score) : { name: 'INITIATE', icon: '◈', color: '#6b82a8', glow: 'rgba(107,130,168,0.3)' };
      return { ...w, score, rank };
    }).sort((a, b) => b.score - a.score).slice(0, 50);

    if (!ranked.length) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:12px;">No contributors yet — be the first!</div>';
      return;
    }

    const myWallet = typeof globalWalletAddress !== 'undefined' ? globalWalletAddress : null;

    el.innerHTML = ranked.map((w, i) => {
      const isMe = myWallet && w.wallet === myWallet;
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
      return `
        <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;
          background:${isMe ? 'rgba(84,147,247,0.07)' : 'var(--surface)'};
          border:1px solid ${isMe ? 'rgba(84,147,247,0.3)' : 'var(--border)'};
          border-radius:10px;margin-bottom:8px;transition:all 0.2s;"
          onmouseover="this.style.borderColor='rgba(84,147,247,0.25)'"
          onmouseout="this.style.borderColor='${isMe ? 'rgba(84,147,247,0.3)' : 'var(--border)'}'">
          <div style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:800;
            color:${i < 3 ? '#fff' : 'var(--muted)'};min-width:32px;text-align:center;">
            ${medal}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
              <span style="font-size:12px;font-weight:700;color:${isMe ? 'var(--accent)' : 'var(--text)'};
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${w.alias}${isMe ? ' <span style="color:var(--accent);font-size:10px;">(you)</span>' : ''}
              </span>
              <span style="font-size:10px;font-weight:700;color:${w.rank.color};
                text-shadow:0 0 8px ${w.rank.glow};white-space:nowrap;">
                ${w.rank.icon} ${w.rank.name}
              </span>
            </div>
            <div style="display:flex;gap:12px;font-size:10px;color:var(--muted);">
              <span>❓ ${w.questions} questions</span>
              <span>💬 ${w.answers} answers</span>
              <span>👍 ${w.upvotes} upvotes</span>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:800;
              color:${w.rank.color};text-shadow:0 0 10px ${w.rank.glow};">
              ${w.score.toLocaleString()}
            </div>
            <div style="font-size:9px;color:var(--muted);letter-spacing:0.08em;">REP</div>
          </div>
        </div>`;
    }).join('');

  } catch(e) {
    const el2 = document.getElementById('leaderboard-list');
    if (el2) el2.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:12px;">Could not load leaderboard</div>';
  }
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
                ${{questions:'❓ Questions',answers:'💬 Answers',upvotes:'👍 Upvotes received',chat:'🗨️ Chat messages'}[k]}
              </div>
              <div style="font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:800;color:var(--text);" id="stats-count-${k}">…</div>
            </div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:16px;font-weight:800;
              color:${{questions:'var(--accent)',answers:'#66ffaa',upvotes:'#ffd700',chat:'#c084fc'}[k]};"
              id="stats-rep-${k}">…</div>
          </div>`).join('')}
      </div>
      <div style="margin-top:16px;padding:14px 16px;background:var(--surface2);border:1px solid var(--border);
        border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12px;color:var(--muted);">Total Reputation</span>
        <span style="font-family:'Rajdhani',sans-serif;font-size:24px;font-weight:800;color:var(--accent);"
          id="stats-total-rep">…</span>
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

  try {
    const [qStats, chatStats] = await Promise.all([
      typeof fetchQuestionStats === 'function' ? fetchQuestionStats(wallet) : Promise.resolve({ myQuestions: [], myAnswers: [], totalUpvotes: 0 }),
      typeof fetchChatStats     === 'function' ? fetchChatStats(wallet)     : Promise.resolve({ msgCount: 0 }),
    ]);

    const { myQuestions = [], myAnswers = [], totalUpvotes = 0 } = qStats;
    const msgCount = chatStats?.msgCount || 0;

    // REP per source
    const repQuestions = myQuestions.length * 40;
    const repAnswers   = myAnswers.length * 15;
    const repUpvotes   = totalUpvotes * 10;
    const repChat      = Math.min(msgCount, 20) * 2 + Math.max(0, msgCount - 20) * 0.4;
    const totalRep     = Math.round(repQuestions + repAnswers + repUpvotes + repChat);

    // Update activity grid
    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    set('stats-count-questions', myQuestions.length);
    set('stats-count-answers',   myAnswers.length);
    set('stats-count-upvotes',   totalUpvotes);
    set('stats-count-chat',      msgCount);
    set('stats-rep-questions',   '+' + repQuestions.toLocaleString() + ' REP');
    set('stats-rep-answers',     '+' + repAnswers.toLocaleString()   + ' REP');
    set('stats-rep-upvotes',     '+' + repUpvotes.toLocaleString()   + ' REP');
    set('stats-rep-chat',        '+' + Math.round(repChat) + ' REP');
    set('stats-total-rep',       totalRep.toLocaleString() + ' REP');

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
            text-shadow:0 0 12px ${rank.glow};margin-bottom:8px;">
            ${rank.icon} ${rank.name}
          </div>
          ${nextRank ? `
            <div style="font-size:10px;color:var(--muted);margin-bottom:6px;">
              Progress to <span style="color:${nextRank.color};">${nextRank.icon} ${nextRank.name}</span>
              · need <strong style="color:var(--text);">${(nextRank.minScore - totalRep).toLocaleString()}</strong> more REP
            </div>
            <div style="background:rgba(255,255,255,0.06);border-radius:6px;height:8px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,${rank.bar},${nextRank.bar});
                border-radius:6px;box-shadow:0 0 8px ${rank.glow};transition:width 0.8s ease;"></div>
            </div>` : `
            <div style="font-size:11px;color:${rank.color};font-weight:700;">✦ MAX RANK — ASCENDED</div>`}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Reward multiplier</div>
          <div style="font-family:'Rajdhani',sans-serif;font-size:28px;font-weight:800;
            color:${rank.color};text-shadow:0 0 10px ${rank.glow};">×${rank.multiplier}</div>
        </div>`;
    }

    // Leaderboard position + pool calculation
    const WORKER_URL = typeof window.WORKER_URL !== 'undefined'
      ? window.WORKER_URL
      : 'https://terra-oracle-questions.vladislav-baydan.workers.dev';

    const res = await fetch(`${WORKER_URL}/questions`);
    const data = await res.json();
    const allQuestions = data.questions || [];

    // Build scores for all wallets
    const scores = {};
    for (const q of allQuestions) {
      if (!q.wallet) continue;
      if (!scores[q.wallet]) scores[q.wallet] = 0;
      scores[q.wallet] += q.wallet === wallet ? 0 : 0; // others
    }
    if (typeof buildScoreMap === 'function') {
      const map = buildScoreMap(allQuestions);
      Object.assign(scores, map);
    }

    const allScores  = Object.values(scores).sort((a, b) => b - a);
    const myPosition = allScores.indexOf(totalRep) + 1 || allScores.findIndex(s => s <= totalRep) + 1;
    const top20pct   = Math.ceil(allScores.length * 0.2);
    const inTop20    = myPosition > 0 && myPosition <= top20pct;
    const totalTopRep = allScores.slice(0, top20pct).reduce((s, v) => s + v, 0);

    // Fetch treasury balance for pool estimate
    let poolLunc = 0;
    try {
      const tRes = await fetch('https://terra-classic-lcd.publicnode.com/cosmos/bank/v1beta1/balances/terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt');
      const tData = await tRes.json();
      const uluna = parseInt(tData.balances?.find(b => b.denom === 'uluna')?.amount || '0');
      poolLunc = Math.round((uluna / 1_000_000) * 0.20); // 20% of treasury
    } catch(e) {}

    // Pool block
    const poolEl = document.getElementById('stats-pool-block');
    if (poolEl) {
      poolEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:10px;color:var(--muted);margin-bottom:6px;letter-spacing:0.08em;">WEEKLY POOL</div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:800;color:#66ffaa;">
              ${poolLunc > 0 ? poolLunc.toLocaleString() + ' LUNC' : '—'}
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:4px;">~20% of Treasury</div>
          </div>
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:10px;color:var(--muted);margin-bottom:6px;letter-spacing:0.08em;">ELIGIBLE</div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:800;
              color:${inTop20 ? '#66ffaa' : 'var(--muted)'};">
              ${inTop20 ? '✅ Top 20%' : '❌ Not yet'}
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:4px;">
              ${myPosition > 0 ? 'Rank #' + myPosition + ' of ' + allScores.length : 'No rank yet'}
            </div>
          </div>
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:10px;color:var(--muted);margin-bottom:6px;letter-spacing:0.08em;">CONTRIBUTORS</div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:800;color:var(--accent);">
              ${allScores.length}
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:4px;">Top ${top20pct} share rewards</div>
          </div>
        </div>`;
    }

    // Estimated reward block
    const rewardEl = document.getElementById('stats-reward-block');
    if (rewardEl) {
      let estimatedLunc = 0;
      if (inTop20 && totalTopRep > 0 && poolLunc > 0 && rank) {
        const share = (totalRep * rank.multiplier) / totalTopRep;
        estimatedLunc = Math.round(poolLunc * share);
      }

      rewardEl.innerHTML = inTop20 ? `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
          <div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:36px;font-weight:800;color:#ffd700;
              text-shadow:0 0 16px rgba(255,215,0,0.4);">
              ~${estimatedLunc > 0 ? estimatedLunc.toLocaleString() : '—'} LUNC
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">
              Based on your ${totalRep.toLocaleString()} REP × ${rank?.multiplier || 1}× multiplier
            </div>
          </div>
          <div style="font-size:11px;color:var(--muted);max-width:260px;line-height:1.6;">
            Distributed weekly to top 20% contributors proportional to their REP score × rank multiplier.
          </div>
        </div>` : `
        <div style="text-align:center;padding:20px;">
          <div style="font-size:13px;color:var(--muted);margin-bottom:8px;">
            You need to be in the <strong style="color:var(--text);">top 20%</strong> to earn weekly rewards
          </div>
          <div style="font-size:12px;color:var(--muted);">
            Current position: <strong style="color:var(--text);">#${myPosition || '—'}</strong> · 
            Need top <strong style="color:var(--text);">${top20pct}</strong> to qualify
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
    <!-- What is REP -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;margin-bottom:16px;">
      <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:12px;">What is Oracle Reputation?</div>
      <p style="font-size:13px;color:var(--text);line-height:1.8;margin-bottom:16px;">
        Oracle Reputation (REP) measures your contribution to the Terra Oracle protocol.
        It is <strong style="color:var(--accent);">not a balance</strong> — it reflects your
        <strong style="color:var(--text);">activity, quality, and consistency</strong>.
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">
        ${[
          ['❓', 'Ask a question', '+40 REP', 'var(--accent)'],
          ['💬', 'Answer (community)', '+15 REP', '#66ffaa'],
          ['👍', 'Upvote received', '+10 REP', '#ffd700'],
          ['🗨️', 'Chat message', '+2 REP', '#c084fc'],
        ].map(([icon, label, rep, color]) => `
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center;">
            <div style="font-size:22px;margin-bottom:6px;">${icon}</div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">${label}</div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:800;color:${color};">${rep}</div>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:12px;font-size:11px;color:var(--muted);padding:10px 14px;
        background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border);">
        ⚠️ Anti-abuse: first 20 chat messages/day earn full reward · votes capped at 20/day
      </div>
    </div>

    <!-- Rank system -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;margin-bottom:16px;">
      <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:16px;">Oracle Ascension — 7 Ranks</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${ranks.map(r => `
          <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;
            background:var(--surface2);border:1px solid var(--border);border-radius:10px;">
            <div style="font-size:16px;font-weight:800;color:${r.color};
              text-shadow:0 0 10px ${r.glow};min-width:120px;letter-spacing:0.06em;">
              ${r.icon} ${r.name}
            </div>
            <div style="flex:1;">
              <div style="height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:100%;background:${r.bar};
                  box-shadow:0 0 6px ${r.glow};border-radius:3px;opacity:0.7;"></div>
              </div>
            </div>
            <div style="font-size:11px;color:var(--muted);min-width:80px;text-align:right;">
              ${r.minScore === 0 ? 'Starting' : r.minScore.toLocaleString() + ' REP'}
            </div>
            <div style="font-size:10px;color:${r.color};min-width:120px;text-align:right;
              opacity:${r.discount > 0 ? 1 : 0.4};">
              ${r.discountLabel}
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Weekly rewards -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;">
      <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-bottom:12px;">Weekly Reward Pool</div>
      <p style="font-size:13px;color:var(--text);line-height:1.8;margin-bottom:16px;">
        ~20% of Treasury weekly rewards are distributed to the <strong style="color:var(--accent);">top 20% contributors</strong>
        proportional to their REP score. Higher rank multiplies your share.
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;">
        ${ranks.filter(r => r.multiplier > 1).map(r => `
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:12px;font-weight:700;color:${r.color};margin-bottom:4px;">${r.icon} ${r.name}</div>
            <div style="font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:800;color:${r.color};
              text-shadow:0 0 10px ${r.glow};">×${r.multiplier}</div>
            <div style="font-size:9px;color:var(--muted);margin-top:2px;">reward multiplier</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}
