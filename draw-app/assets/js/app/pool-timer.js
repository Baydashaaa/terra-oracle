// ─── UPDATE POOL DISPLAY ────────────────────────────────────────────────────
function updatePoolDisplay() {
  const tickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const count = tickets.length;
  const isDaily = currentLottery === 'daily';

  // Count unique NFTs (transactions) vs entries
  const nftCount     = tickets.filter(t => t.nft === 1 || t.nft === undefined).length;
  const entriesCount = count; // total entries (for wheel)

  // Calculate prize pool from actual LUNC received
  // NFTs without nft field = old format, count by LUNC_PER_TICKET
  const tiers = window.NFT_TIERS || (typeof NFT_TIERS !== 'undefined' ? NFT_TIERS : null);
  let totalLunc = 0;
  const seen = new Set();
  for (const t of tickets) {
    if (seen.has(t.txhash)) continue;
    seen.add(t.txhash);
    if (tiers && t.entries) {
      if (t.entries === tiers.legendary.entries) totalLunc += tiers.legendary.lunc;
      else if (t.entries === tiers.rare.entries) totalLunc += tiers.rare.lunc;
      else totalLunc += tiers.common.lunc;
    } else {
      totalLunc += LUNC_PER_TICKET;
    }
  }

  // Use real wallet balance if available (includes Q&A + NFT contributions)
  // Именно ??, а не ||: у контракта пустой раунд даёт честный ноль, а ||
  // подменял его суммой по билетам и рисовал приз, которого нет.
  const _realBalance = isDaily
    ? (window._dailyPoolBalance  ?? totalLunc)
    : (window._weeklyPoolBalance ?? totalLunc);
  let poolPrize = _realBalance * PRIZE_SHARE;
  let seededLunc = _realBalance * 0.10;
  let poolUsd = poolPrize * luncPrice;

  const _pl=document.getElementById('pool-lunc');if(_pl)_pl.textContent = fmt(poolPrize) + ' LUNC';
  const _pu=document.getElementById('pool-usd');if(_pu)_pu.textContent = luncPrice > 0 ? '≈ $' + poolUsd.toFixed(2) + ' USD' : '';

  // Seeded next round
  const _seed = document.getElementById('stat-seeded');if(_seed)_seed.textContent = fmt(seededLunc);

  const _pt=document.getElementById('pool-tickets');if(_pt)_pt.textContent = nftCount + ' NFT' + (nftCount !== 1 ? 's' : '') + ' minted this round';

  const minNotice = document.getElementById('pool-min-notice');
  const _minEntries = typeof poolMinEntries === 'function'
    ? poolMinEntries(currentLottery) : MIN_TICKETS;
  if (minNotice && count < _minEntries && count > 0) {
    // Текст собираем здесь, а не в разметке: порог живёт в контракте, и
    // зашитая в index.html «пятёрка» обещала перенос там, где контракт
    // раунд разыграет.
    minNotice.innerHTML = '<svg class="oi oi--amber"><use href="#i-warning"/></svg> Less than ' +
      _minEntries + ' NFT' + (_minEntries !== 1 ? 's' : '') + ' minted - pool rolls over to next draw';
    minNotice.style.display = 'block';
  } else if (minNotice) {
    minNotice.style.display = 'none';
  }

  // Update stats
  // My Entries This Round - entries for connected wallet in current lottery
  const _myAddr = connectedWalletAddress || lotteryAddress;
  const _curTickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const _myNFTEntries = _myAddr ? _curTickets.filter(t => t.address === _myAddr).length : 0;
  const _myFreeEntries = (currentLottery === 'weekly' && _myAddr) ? (getFreeEntries(_myAddr).total || 0) : 0;
  const _myEntries = _myNFTEntries + _myFreeEntries;
  const _st=document.getElementById('stat-total');if(_st)_st.textContent = _myEntries > 0 ? _myEntries : '0';
  // stat-burned = Seeded Next Round = 10% of current pool LUNC
  const _sb=document.getElementById('stat-burned');if(_sb)_sb.textContent = fmt(Math.round(seededLunc)) + ' LUNC';
  // Draw page: completed draws for the CURRENT pool (matches the pool context shown)
  const _sd=document.getElementById('stat-draws');if(_sd)_sd.textContent = winnersData.filter(function(w){return w.type===(currentLottery||'daily');}).length;

  // ── Sync home page stat counters (always kept up to date) ──
  // Home: TOTAL completed draws across BOTH pools (independent of current tab)
  const _totalDraws = winnersData.filter(function(w){ return w.winner || (w.winners && w.winners.length > 0); }).length;
  const _hDraws = document.getElementById('home-stat-draws');
  const _hNfts  = document.getElementById('home-stat-nfts');
  if (_hDraws) _hDraws.textContent = _totalDraws;
  if (_hNfts) _hNfts.textContent = nftCount;

  // Refresh weekly prize split if on weekly tab - use real balance
  if (currentLottery === 'weekly') {
    const _wPool = window._weeklyPoolBalance || weeklyTickets.length * 25000;
    const pool80 = _wPool * PRIZE_SHARE;
    const p1 = document.getElementById('weekly-prize-1');
    const p2 = document.getElementById('weekly-prize-2');
    const p3 = document.getElementById('weekly-prize-3');
    if (p1) p1.textContent = fmt(Math.floor(pool80 * 0.60)) + ' LUNC';
    if (p2) p2.textContent = fmt(Math.floor(pool80 * 0.25)) + ' LUNC';
    if (p3) p3.textContent = fmt(Math.floor(pool80 * 0.15)) + ' LUNC';
  }

  // Weekly ticket price display
  const _tpd = document.getElementById('ticket-price-display');
  const _ms  = document.getElementById('modal-sub');
  if (!isDaily) {
    if (_tpd) _tpd.textContent = 'Common · Rare · Legendary';
    if (_ms)  _ms.textContent  = 'Choose your NFT tier · Activate to enter draw';
  } else {
    if (_tpd) _tpd.textContent = 'Common · Rare · Legendary';
    if (_ms)  _ms.textContent  = 'Choose your NFT tier · Activate to enter draw';
  }
  // Update buy button with current tier price
  if (typeof updateBuyBtn === 'function') updateBuyBtn();
}

// ─── DRAW SCHEDULE ──────────────────────────────────────────────────────────
// Расписание и формат отсчёта живут в assets/js/draw-schedule.js - это общий
// файл, побайтово одинаковый в репо terra-oracle и oracle-draw. Он грузится
// обычным <script> ДО app.js. Здесь только потребление, своей арифметики нет:
// именно три независимые копии этой логики и разъехались 3 авг 2026.
if (!window.DRAW_SCHEDULE) {
  console.error('[schedule] assets/js/draw-schedule.js не загружен - счётчики ' +
    'розыгрыша считать нечем. Проверь порядок <script> в index.html: ' +
    'draw-schedule.js должен идти ДО app.js.');
}

// ─── TIMER ──────────────────────────────────────────────────────────────────
// Имя оставлено прежним - его зовёт startTimer и, возможно, внешний код
function getNextDrawTime(type) {
  return window.DRAW_SCHEDULE.next(type === 'weekly' ? 'weekly' : 'daily');
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const isBlue = currentLottery === 'weekly';

  // Apply blue color to timer if weekly
  ['t-days','t-hours','t-mins','t-secs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.toggle('blue', isBlue); }
  });

  function tick() {
    const ms = window.DRAW_SCHEDULE.msToNext(currentLottery);
    const p  = window.DRAW_SCHEDULE.parts(ms);
    // В понедельник daily не разыгрывается, и отсчёт идёт до вторника. Без
    // пояснения человек, заминтивший в понедельник, ждёт колеса в тот же
    // вечер и не дожидается: подпись "Next Draw In" читается как "сегодня".
    const lbl = document.getElementById('timer-label');
    if (lbl) {
      const paused = window.DRAW_SCHEDULE.isPausedToday(currentLottery);
      lbl.innerHTML = paused
        ? '<svg class="oi oi--amber"><use href="#i-hourglass"/></svg> No draw today - next draw in'
        : '<svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Next Draw In';
    }
    document.getElementById('t-days').textContent  = String(p.d).padStart(2,'0');
    document.getElementById('t-hours').textContent = String(p.h).padStart(2,'0');
    document.getElementById('t-mins').textContent  = String(p.m).padStart(2,'0');
    document.getElementById('t-secs').textContent  = String(p.s).padStart(2,'0');
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

// ─── SWITCH LOTTERY ─────────────────────────────────────────────────────────
function switchLottery(type) {
  currentLottery = type;
  window.currentLottery = type;
  try { localStorage.setItem('activeLottery', type); } catch(e) {}
  const isDaily = type === 'daily';

  // Tabs
  const tabDaily  = document.getElementById('tab-daily');
  const tabWeekly = document.getElementById('tab-weekly');
  if (tabDaily)  tabDaily.className  = 'lottery-tab ' + (isDaily ? 'active-daily' : '');
  if (tabWeekly) tabWeekly.className = 'lottery-tab ' + (!isDaily ? 'active-weekly' : '');

  // Weekly body theme
  if (isDaily) {
    document.body.classList.remove('weekly-mode');
  } else {
    document.body.classList.add('weekly-mode');
  }

  // Page transition flash + hero animation
  const overlay = document.getElementById('page-transition');
  if (overlay) {
    overlay.classList.remove('flash-out');
    overlay.classList.add('flash');
    setTimeout(() => {
      overlay.classList.remove('flash');
      overlay.classList.add('flash-out');
    }, 120);
  }

  // Hero entrance animation
  const heroEl = document.getElementById('hero-title');
  const wheelEl = document.getElementById('wheel-panel-hero');
  if (heroEl) {
    heroEl.classList.remove('hero-switch-weekly', 'hero-switch-daily');
    void heroEl.offsetWidth; // force reflow
    heroEl.classList.add(isDaily ? 'hero-switch-daily' : 'hero-switch-weekly');
  }
  if (wheelEl) {
    wheelEl.classList.remove('wheel-switch');
    void wheelEl.offsetWidth;
    wheelEl.classList.add('wheel-switch');
  }

  // Hero
  const heroTitle = document.getElementById('hero-title');
  const heroSub   = document.getElementById('hero-sub');
  if (heroTitle) heroTitle.innerHTML   = isDaily ? 'DAILY <span class="gold" id="hero-subtitle">DRAW</span>' : 'WEEKLY <span class="blue-text" id="hero-subtitle">DRAW</span>';
  if (heroSub)   heroSub.textContent   = isDaily ? 'Mint an NFT. Activate it. Win the daily pool.' : 'Mint an NFT. Activate it. Win the weekly pool.';

  // Steps
  const wp = weeklyTicketPrice();
  const step1El = document.getElementById('step1-text');
  const step2El = document.getElementById('step2-text');
  if (step1El) step1El.textContent = isDaily
    ? 'Choose your tier - Common, Rare or Legendary. Activate to enter draw.'
    : 'Choose your tier - Common, Rare or Legendary. Activate to enter draw.';
  if (step2El) step2El.textContent = isDaily
    ? 'Mint an NFT to enter - your purchase is automatically registered. Draw happens at 20:00 UTC every day except Monday (Monday is the Weekly Draw).'
    : 'Mint an NFT to enter - your purchase is automatically registered. Pool accumulates all week until Monday 20:00 UTC.';

  // Pool display
  const poolDisplayEl = document.getElementById('pool-display');
  const poolLuncEl    = document.getElementById('pool-lunc');
  if (poolDisplayEl) poolDisplayEl.className = 'pool-display' + (isDaily ? '' : ' weekly-pool');
  if (poolLuncEl)    poolLuncEl.className    = 'pool-amount'  + (isDaily ? '' : ' blue');

  // Buy button
  const btn = document.getElementById('btn-buy-main');
  if (btn) btn.className = 'btn-buy' + (isDaily ? '' : ' weekly');

  // Modal
  const modalInner = document.getElementById('modal-inner');
  const modalTitle = document.getElementById('modal-title');
  const modalBtn   = document.getElementById('lottery-buy-btn');
  if (modalInner) modalInner.className = 'modal' + (isDaily ? '' : ' weekly-modal');
  if (modalTitle) modalTitle.className = 'modal-title' + (isDaily ? '' : ' blue');
  if (modalBtn)   modalBtn.className   = 'btn-confirm' + (isDaily ? '' : ' weekly');

  // Switch wheel panel style
  const wheelPanel = document.getElementById('wheel-panel-hero');
  if (wheelPanel) {
    wheelPanel.className = 'wheel-panel' + (isDaily ? '' : ' weekly-panel');
  }
  const wheelPanelLabel = document.getElementById('wheel-panel-label');
  if (wheelPanelLabel) wheelPanelLabel.textContent = isDaily ? 'ORACLE WHEEL' : 'COUNCIL OF ORACLES';

  startTimer();
  updatePoolDisplay();
  // Прячем карточку прошлого пула - Draw V2 вернёт её с данными нового,
  // либо оставит скрытой, если у пула ещё не было розыгрышей.
  const wwCard = document.getElementById('wheel-winner-card');
  if (wwCard) { wwCard.style.display = 'none'; wwCard.classList.remove('show'); }
  updateWheelTickets();

  // ── Toggle ALL Daily / Weekly elements via JS (reliable) ────
  const dailyExtra     = document.getElementById('daily-extra');
  const weeklyExtra    = document.getElementById('weekly-extra');
  const weeklyPodium   = document.getElementById('weekly-podium');
  const weeklyPoolSum  = document.getElementById('weekly-pool-summary-card') || document.querySelector('.weekly-pool-summary');
  const poolDisplay    = document.getElementById('pool-display');

  // Daily elements
  if (dailyExtra)    dailyExtra.style.display   = isDaily ? 'block' : 'none';
  if (poolDisplay)   poolDisplay.style.display  = isDaily ? 'block' : 'none';

  // Weekly elements
  if (weeklyExtra)   weeklyExtra.style.display  = isDaily ? 'none' : 'block';
  if (weeklyPodium)  weeklyPodium.style.display = isDaily ? 'none' : 'grid';
  if (weeklyPoolSum) weeklyPoolSum.style.display = isDaily ? 'none' : 'block';

  // Update podium prizes AFTER elements are visible
  if (!isDaily) updatePodiumPrizes();

  // ── Populate Daily: last winner ───────────────────────────────
  if (isDaily) {
    const last = winnersData.find(function(w){return w.type==='daily' && w.winner && !w.skipped;});
    const addrEl  = document.getElementById('last-winner-addr');
    const prizeEl = document.getElementById('last-winner-prize');
    const dateEl  = document.getElementById('last-winner-date');
    if (last && addrEl) {
      const addr = last.winner;
      addrEl.textContent  = addr.slice(0,10) + '...' + addr.slice(-6);
      if (prizeEl) prizeEl.textContent = fmt(last.prize) + ' LUNC';
      if (dateEl)  dateEl.textContent  = last.time ? new Date(last.time * 1000).toLocaleDateString() : '-';
    } else if (addrEl) {
      addrEl.textContent  = 'No draws yet';
      if (prizeEl) prizeEl.textContent = '-';
      if (dateEl)  dateEl.textContent  = '-';
    }
  }

  // ── Populate Weekly: prize split + free entries ───────────────
  if (!isDaily) {
    const pool80 = weeklyTickets.length > 0
      ? weeklyTickets.length * 25000 * 0.8
      : 0;
    const p1 = document.getElementById('weekly-prize-1');
    const p2 = document.getElementById('weekly-prize-2');
    const p3 = document.getElementById('weekly-prize-3');
    if (p1) p1.textContent = fmt(Math.floor(pool80 * 0.60)) + ' LUNC';
    if (p2) p2.textContent = fmt(Math.floor(pool80 * 0.25)) + ' LUNC';
    if (p3) p3.textContent = fmt(Math.floor(pool80 * 0.15)) + ' LUNC';

    // Free entries - total from GitHub JSON (all wallets this week)
    const freeEl = document.getElementById('weekly-free-entries');
    if (freeEl) {
      const totalFree = Object.values(freeEntriesData).reduce((s, e) => s + (e.total || 0), 0);
      freeEl.textContent = totalFree > 0 ? totalFree : '0';
    }
  }

  // ── Update podium prizes ──────────────────────────────────────
  if (!isDaily) {
    const tickets = weeklyTickets;
    // Банк берём с кошелька, а не из билетов: в него попадает и вклад Q&A.
    // Раньше эти же элементы заполнялись здесь от билетов, а несколькими
    // строками выше - updatePodiumPrizes() от баланса, и на экране
    // оставалась цифра той функции, что отработала последней.
    const pool = window._weeklyPoolBalance || tickets.length * 25000;
    const prize80 = Math.floor(pool * PRIZE_SHARE);
    const p1El = document.getElementById('podium-prize-1');
    const p2El = document.getElementById('podium-prize-2');
    const p3El = document.getElementById('podium-prize-3');
    const totalEl = document.getElementById('weekly-pool-total');
    const tickEl  = document.getElementById('weekly-pool-tickets');
    if (p1El) p1El.textContent = fmt(Math.floor(prize80 * 0.60)) + ' LUNC';
    if (p2El) p2El.textContent = fmt(Math.floor(prize80 * 0.25)) + ' LUNC';
    if (p3El) p3El.textContent = fmt(Math.floor(prize80 * 0.15)) + ' LUNC';
    if (totalEl) totalEl.textContent = fmt(window._weeklyPoolBalance || pool) + ' LUNC';
    if (tickEl)  tickEl.textContent  = tickets.length + ' NFTs minted this round';
  }

  // Switch animated rings color
  const r1 = document.getElementById('wheel-ring-1');
  const r2 = document.getElementById('wheel-ring-2');
  const r3 = document.getElementById('wheel-ring-3');
  if (r1) r1.style.borderColor = isDaily ? 'rgba(244,208,63,0.2)' : 'rgba(74,144,217,0.15)';
  if (r2) r2.style.borderColor = isDaily ? 'rgba(244,208,63,0.35)' : 'rgba(74,144,217,0.25)';
  if (r3) r3.style.background = isDaily
    ? 'conic-gradient(from 0deg,transparent 0%,rgba(244,208,63,0.35) 15%,transparent 30%,rgba(200,80,0,0.3) 50%,transparent 65%,rgba(244,208,63,0.2) 80%,transparent 100%)'
    : 'conic-gradient(from 0deg,transparent 0%,rgba(0,200,255,0.3) 15%,transparent 30%,rgba(100,0,255,0.3) 50%,transparent 65%,rgba(0,200,255,0.2) 80%,transparent 100%)';

  // Restore canvas glow (inline style takes priority over CSS)

  // Switch pointer color
  const ptrStop0 = document.querySelector('#ptr-grad stop:first-child');
  const ptrStop1 = document.querySelector('#ptr-grad stop:last-child');
  const ptrPoly  = document.querySelector('#ptr-grad ~ polygon') || document.querySelector('[points="12,32 0,0 24,0"]');
  if (ptrStop0) ptrStop0.style.stopColor = isDaily ? '#ffe066' : '#00c8ff';
  if (ptrStop1) ptrStop1.style.stopColor = isDaily ? '#e67e22' : '#6400ff';
  if (ptrPoly)  ptrPoly.style.filter = 'none';
}
