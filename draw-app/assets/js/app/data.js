// ─── SCROLL ─────────────────────────────────────────────────────────────────
function scrollToId(id) {
  document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── WINNERS FILTER BUTTONS ─────────────────────────────────────────────────
function filterWinners(f) {
  winnersFilter = f;
  ['all','daily','weekly','mine'].forEach(function(k){
    var b = document.getElementById('wf-' + k);
    if (b) b.classList.toggle('active', k === f);
  });
  renderWinners();
}

// ─── GET WALLET BALANCE ──────────────────────────────────────────────────────
async function getWalletBalance(address) {
  try {
    const res = await fetch(`https://terra-classic-lcd.publicnode.com/cosmos/bank/v1beta1/balances/${address}`);
    if (!res.ok) return 0;
    const data = await res.json();
    const balances = data.balances || [];
    const lunc = balances.find(b => b.denom === 'uluna');
    return lunc ? Math.floor(parseInt(lunc.amount) / 1e6) : 0;
  } catch(e) { return 0; }
}

// ─── LOAD ALL DATA ───────────────────────────────────────────────────────────
async function loadAllData() {
  await fetchPrices();

  // ── Step 1: balances only (very fast) ──
  const [_dailyBal, _weeklyBal] = await Promise.all([
    getPoolAmount('daily'),
    getPoolAmount('weekly'),
    loadPoolLimits(),
  ]);
  window._dailyPoolBalance  = _dailyBal;
  window._weeklyPoolBalance = _weeklyBal;
  updatePoolDisplay();

  // ── Step 2: tickets + free entries in parallel (slower) ──
  // NOTE: tickets now come from Worker /round-stats (source of truth after NFT activation system)
  // fetchTickets (LCD-based) is kept as fallback but no longer primary
  const [_daily, _weekly] = await Promise.all([
    fetchRoundStatsAsTickets('daily'),
    fetchRoundStatsAsTickets('weekly'),
    loadFreeEntries(),
  ]);
  dailyTickets  = _daily;
  weeklyTickets = _weekly;
  updatePoolDisplay();

  // ── Update wheel with fresh data ──
  if (typeof updateWheelTickets === 'function') {
    updateWheelTickets();
  }

  // ── Refresh home page stats with fresh data ──
  // NFTs Minted = all-time cumulative counter from Worker /total-mints (never resets).
  // Shows total + tier breakdown via tooltip on hover.
  const hNfts = document.getElementById('home-stat-nfts');
  if (hNfts) {
    try {
      const totalRes = await fetch('https://oracle-draw.vladislav-baydan.workers.dev/total-mints');
      if (totalRes.ok) {
        const t = await totalRes.json();
        const total = t.total || 0;
        hNfts.textContent = total;
        // Tooltip with tier breakdown - shown on hover/tap
        const tip = `Common: ${t.common || 0} · Rare: ${t.rare || 0} · Legendary: ${t.legendary || 0}`;
        hNfts.title = tip;
        // Visual cue that it's interactive
        hNfts.style.cursor = 'help';
        // Custom tooltip (mobile-friendly) - replaces parent card content briefly on tap
        const card = hNfts.parentElement;
        if (card && !card.dataset.tooltipBound) {
          card.dataset.tooltipBound = '1';
          card.style.position = 'relative';
          const tooltip = document.createElement('div');
          tooltip.id = 'home-stat-nfts-tooltip';
          tooltip.style.cssText = 'position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);' +
            'background:rgba(12,16,30,0.96);border:1px solid rgba(124,92,255,0.35);border-radius:10px;' +
            'padding:8px 14px;font-size:11px;color:#cdd6f4;white-space:nowrap;pointer-events:none;' +
            'opacity:0;transition:opacity 0.15s ease;z-index:50;letter-spacing:0.04em;backdrop-filter:blur(8px);';
          tooltip.textContent = tip;
          card.appendChild(tooltip);
          const show = () => { tooltip.textContent = hNfts.title; tooltip.style.opacity = '1'; };
          const hide = () => { tooltip.style.opacity = '0'; };
          card.addEventListener('mouseenter', show);
          card.addEventListener('mouseleave', hide);
          card.addEventListener('touchstart', () => { show(); setTimeout(hide, 2500); }, { passive: true });
        } else if (card) {
          // Update existing tooltip text
          const tEl = card.querySelector('#home-stat-nfts-tooltip');
          if (tEl) tEl.textContent = tip;
        }
        window._totalNFTsActivated = total;
      }
    } catch(e) {
      const tickets = (typeof dailyTickets !== 'undefined' ? dailyTickets : []);
      const nftCount = tickets.filter(t => t.nft === 1 || t.nft === undefined).length;
      if (nftCount > 0) hNfts.textContent = nftCount;
    }
  }
  const hDraws = document.getElementById('home-stat-draws');
  if (hDraws) hDraws.textContent = winnersData.filter(function(w){ return w.winner || (w.winners && w.winners.length > 0); }).length;
}

function updatePodiumPrizes() {
  // Use real wallet balance - not ticket count * price
  const pool = window._weeklyPoolBalance || weeklyTickets.length * 25000;
  const prize80 = Math.floor(pool * PRIZE_SHARE);
  const p1El = document.getElementById('podium-prize-1');
  const p2El = document.getElementById('podium-prize-2');
  const p3El = document.getElementById('podium-prize-3');
  const totalEl = document.getElementById('weekly-pool-total');
  const tickEl  = document.getElementById('weekly-pool-tickets');
  if (p1El) p1El.textContent = fmt(Math.floor(prize80 * 0.60)) + ' LUNC';
  if (p2El) p2El.textContent = fmt(Math.floor(prize80 * 0.25)) + ' LUNC';
  if (p3El) p3El.textContent = fmt(Math.floor(prize80 * 0.15)) + ' LUNC';
  if (totalEl) totalEl.textContent = fmt(pool) + ' LUNC';
  if (tickEl)  tickEl.textContent  = weeklyTickets.length + ' NFTs minted this round';

  // Порог берём у контракта: min_pot можно поменять транзакцией, и зашитые
  // 500 000 разъезжались бы с реальностью молча.
  const WEEKLY_MIN = poolMinPot('weekly');
  const pct = WEEKLY_MIN > 0 ? Math.min(100, Math.round((pool / WEEKLY_MIN) * 100)) : 100;
  const bar    = document.getElementById('weekly-progress-bar');
  const label  = document.getElementById('weekly-progress-label');
  const status = document.getElementById('weekly-draw-status');
  if (bar)   bar.style.width = pct + '%';
  if (label) label.textContent = fmt(pool) + ' / ' + fmt(WEEKLY_MIN) + ' LUNC';
  // Порога нет - полосе нечего показывать, а обещание про перенос средств
  // было бы враньём: контракт разыграет раунд при любом поте.
  const barWrap = bar && bar.parentElement;
  if (WEEKLY_MIN <= 0) {
    // Ранний выход здесь недопустим: ниже по функции синхронизируется
    // видимость подиума и блоков вкладки.
    if (barWrap) barWrap.style.display = 'none';
    if (label)   label.textContent = fmt(pool) + ' LUNC';
    if (status)  status.innerHTML = '<span style="color:#66ffaa;"><svg class="oi oi--green"><use href="#i-check"/></svg> Draw runs at 20:00 UTC</span>';
  } else if (status) {
    if (barWrap) barWrap.style.display = '';
    if (pool >= WEEKLY_MIN) {
      bar.style.background = 'linear-gradient(90deg,#66ffaa,#00c8ff)';
      bar.style.boxShadow  = '0 0 8px rgba(102,255,170,0.5)';
      status.innerHTML = '<span style="color:#66ffaa;"><svg class="oi oi--green"><use href="#i-check"/></svg> Pool ready - draw will start at 20:00 UTC</span>';
    } else {
      const remaining = fmt(WEEKLY_MIN - pool);
      bar.style.background = 'linear-gradient(90deg,#7C5CFF,#5B8CFF)';
      bar.style.boxShadow  = '0 0 8px rgba(124,92,255,0.5)';
      status.innerHTML = `<span style="color:#6B7AA6;"><svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Need ${remaining} more LUNC · If not reached, funds roll over to next week</span>`;
    }
  }

  // Ensure podium visibility matches current tab
  const podium = document.getElementById('weekly-podium');
  const poolDisplay = document.getElementById('pool-display');
  const weeklyPoolSum = document.getElementById('weekly-pool-summary-card');
  const dailyExtra = document.getElementById('daily-extra');
  const weeklyExtra = document.getElementById('weekly-extra');
  if (currentLottery === 'weekly') {
    if (podium)       podium.style.display       = 'grid';
    if (weeklyPoolSum) weeklyPoolSum.style.display = 'block';
    if (weeklyExtra)  weeklyExtra.style.display   = 'block';
    if (poolDisplay)  poolDisplay.style.display   = 'none';
    if (dailyExtra)   dailyExtra.style.display    = 'none';
  } else {
    if (podium)       podium.style.display        = 'none';
    if (weeklyPoolSum) weeklyPoolSum.style.display = 'none';
    if (weeklyExtra)  weeklyExtra.style.display   = 'none';
    if (poolDisplay)  poolDisplay.style.display   = 'block';
    if (dailyExtra)   dailyExtra.style.display    = 'block';
  }
}


