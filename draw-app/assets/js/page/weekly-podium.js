// ── WEEKLY PODIUM FIX ──────────────────────────────────────────
// Patch switchLottery AFTER app.js loads
window.addEventListener('load', () => {
  const _origSwitch = window.switchLottery;
  window.switchLottery = function(type) {
    if (_origSwitch) _origSwitch(type);
    const podium = document.getElementById('weekly-podium');
    if (podium) podium.style.display = (type === 'weekly') ? 'block' : 'none';
    // Update podium prizes after elements are visible
    if (type === 'weekly' && typeof updatePodiumPrizes === 'function') {
      updatePodiumPrizes();
    }
  };
});

// ── HAMBURGER MENU ─────────────────────────────────────────────
function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  const btn  = document.getElementById('hamburger-btn');
  menu.classList.toggle('open');
  btn.classList.toggle('open');
}
function closeMobileMenu() {
  document.getElementById('mobile-menu').classList.remove('open');
  document.getElementById('hamburger-btn').classList.remove('open');
}
// Close on outside click
document.addEventListener('click', (e) => {
  const menu = document.getElementById('mobile-menu');
  const btn  = document.getElementById('hamburger-btn');
  if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
    closeMobileMenu();
  }
});

// ── NFT TIER SELECTION ─────────────────────────────────────────
const NFT_TIERS = {
  common:    { label: 'Common',    icon: '<svg class="oi oi--muted"><use href="#i-mask"/></svg>', entries: 1,  lunc: 25000,  color: '#9ca3af' },
  rare:      { label: 'Rare',      icon: '<svg class="oi oi--cyan"><use href="#i-orb"/></svg>', entries: 5,  lunc: 125000, color: '#60a5fa' },
  legendary: { label: 'Legendary', icon: '<svg class="oi oi--amber"><use href="#i-eye"/></svg>', entries: 10, lunc: 250000, color: '#fb923c' },
};
let selectedTier = 'common';
let selectedPool = 'daily';
window.selectedTier = selectedTier;
window.selectedPool = selectedPool;
window.NFT_TIERS = {
  common:    { label: 'Common',    icon: '<svg class="oi oi--muted"><use href="#i-mask"/></svg>', entries: 1,  lunc: 25000,  color: '#9ca3af' },
  rare:      { label: 'Rare',      icon: '<svg class="oi oi--cyan"><use href="#i-orb"/></svg>', entries: 5,  lunc: 125000, color: '#60a5fa' },
  legendary: { label: 'Legendary', icon: '<svg class="oi oi--amber"><use href="#i-eye"/></svg>', entries: 10, lunc: 250000, color: '#fb923c' },
};

function selectPool(pool, _silent) {
  window.selectedPool = pool;
  selectedPool = pool;
  const dailyEl  = document.getElementById('pool-daily');
  const weeklyEl = document.getElementById('pool-weekly');
  if (!dailyEl || !weeklyEl) return;

  if (pool === 'daily') {
    dailyEl.style.border     = '2px solid rgba(212,160,23,0.8)';
    dailyEl.style.background = 'rgba(212,160,23,0.12)';
    dailyEl.style.boxShadow  = '0 0 16px rgba(212,160,23,0.25)';
    dailyEl.style.opacity    = '1';
    weeklyEl.style.border    = '2px solid rgba(74,144,217,0.25)';
    weeklyEl.style.background= 'rgba(74,144,217,0.04)';
    weeklyEl.style.boxShadow = 'none';
    weeklyEl.style.opacity   = '0.45';
  } else {
    weeklyEl.style.border    = '2px solid rgba(74,144,217,0.8)';
    weeklyEl.style.background= 'rgba(74,144,217,0.12)';
    weeklyEl.style.boxShadow = '0 0 16px rgba(74,144,217,0.25)';
    weeklyEl.style.opacity   = '1';
    dailyEl.style.border     = '2px solid rgba(212,160,23,0.25)';
    dailyEl.style.background = 'rgba(212,160,23,0.04)';
    dailyEl.style.boxShadow  = 'none';
    dailyEl.style.opacity    = '0.45';
  }

  // Update prize info text
  const prizeInfo = document.getElementById('modal-prize-info');
  if (prizeInfo) {
    prizeInfo.textContent = pool === 'daily'
      ? '80% winner · 10% seeds next round · 10% Protocol Treasury'
      : '48% 1st place · 20% 2nd place · 12% 3rd place · 10% seeds next round · 10% Protocol Treasury';
  }

  /* ── Синхронизация с состоянием страницы ───────────────────────────────
     Минт (openMintIframe и nativeMintV2 в oracle-mint-v2.js) читает
     window.currentLottery - переменную вкладок DAILY/WEEKLY, а не выбор
     в этой модалке. Из-за этого WEEKLY здесь не доезжал до транзакции:
     LUNC уходил в дневной кошелёк, минтился дневной контракт, NFT
     регистрировался в daily. Держим обе переменные одинаковыми, тогда
     не важно, какую из них читает конкретный участок кода.
     Флеш перехода гасим - иначе мигает поверх открытой модалки. */
  if (!_silent && window.currentLottery !== pool && typeof switchLottery === 'function') {
    const ov = document.getElementById('page-transition');
    const prevDisplay = ov ? ov.style.display : null;
    if (ov) ov.style.display = 'none';
    try { switchLottery(pool); }
    finally { if (ov) setTimeout(function () { ov.style.display = prevDisplay || ''; }, 250); }
  }

  if (typeof updateBuyBtn === 'function') updateBuyBtn();
}

function selectTier(tier) {
  window.selectedTier = tier;
  selectedTier = tier;
  const t = NFT_TIERS[tier];

  /* На узких экранах не раздуваем выбранную карточку - не хватает места по бокам */
  const _narrow = window.matchMedia('(max-width: 600px)').matches;
  const _scaleOn  = _narrow ? 1.02 : 1.08;
  const _scaleOff = _narrow ? 0.96 : 0.93;

  Object.keys(NFT_TIERS).forEach(k => {
    const el = document.getElementById('tier-' + k);
    if (!el) return;
    const c = NFT_TIERS[k].color;
    const isSelected = k === tier;

    if (isSelected) {
      el.style.transform  = 'scale(' + _scaleOn + ')';
      el.style.zIndex     = '10';
      el.style.opacity    = '1';
      el.style.filter     = 'brightness(1)';
      el.style.border     = `2px solid ${c}`;
      el.style.boxShadow  = `0 0 20px ${c}50, 0 8px 24px rgba(0,0,0,0.4)`;
      el.style.background = `rgba(${hexToRgb(c)},0.12)`;
    } else {
      el.style.transform  = 'scale(' + _scaleOff + ')';
      el.style.zIndex     = '1';
      el.style.opacity    = '0.45';
      el.style.filter     = 'brightness(0.6)';
      el.style.border     = `2px solid ${c}25`;
      el.style.boxShadow  = 'none';
      el.style.background = `rgba(${hexToRgb(c)},0.03)`;
    }

    // Selected badge
    let badge = el.querySelector('.tier-selected-badge');
    if (isSelected) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'tier-selected-badge';
        badge.style.cssText = `position:absolute;top:-10px;left:50%;transform:translateX(-50%);
          background:${c};color:#000;font-size:9px;font-weight:800;letter-spacing:0.1em;
          padding:2px 8px;border-radius:20px;white-space:nowrap;font-family:'Rajdhani',sans-serif;
          box-shadow:0 2px 8px ${c}60;`;
        badge.textContent = '✓ SELECTED';
        el.style.position = 'relative';
        el.appendChild(badge);
      }
    } else {
      if (badge) badge.remove();
    }
  });

  // Update totals
  const luncStr = t.lunc.toLocaleString();
  document.getElementById('modal-total-val').textContent    = luncStr + ' LUNC';
  document.getElementById('modal-tier-entries').textContent = t.entries + (t.entries === 1 ? ' entry' : ' entries');
  /* Кнопку минта целиком перерисовывает updateBuyBtn - единственный писатель.
     Раньше сюда и в updateBuyBtn писали двое, а статусы транзакции затирали
     спаны, из-за чего подпись рассинхронизировалась с выбранным тиром. */
  if (typeof updateBuyBtn === 'function') updateBuyBtn();
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

window.selectTier = selectTier;
window.selectPool = selectPool;

// Init with Common + Daily selected on page load
document.addEventListener('DOMContentLoaded', () => {
  selectTier('common');
  /* silent: на старте только красим модалку, не дёргаем switchLottery */
  selectPool(window.currentLottery || 'daily', true);
});
