// ─── ADMIN PANEL - Keplr wallet auth ────────────────────────────────────────
function initAdminTrigger() {
  // Opens admin login if URL contains ?admin
  if (new URLSearchParams(window.location.search).has('admin')) {
    openAdminLogin();
  }
}

function openAdminLogin() {
  const el = document.getElementById('admin-login');
  el.style.display = 'flex';
  document.getElementById('admin-login-status').textContent = '';
  document.getElementById('admin-connect-btn').innerHTML  = '<svg class="oi oi--gold"><use href="#i-key"/></svg> Connect Keplr';
}

function closeAdminLogin() {
  document.getElementById('admin-login').style.display = 'none';
}

async function connectAdminKeplr() {
  const statusEl = document.getElementById('admin-login-status');
  const btnEl    = document.getElementById('admin-connect-btn');

  if (!window.keplr) {
    statusEl.style.color = '#ff3c78';
    statusEl.innerHTML = '<svg class="oi oi--amber"><use href="#i-warning"/></svg> Keplr not found - install Keplr extension';
    return;
  }

  try {
    btnEl.innerHTML    = '<svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Connecting...';
    statusEl.textContent = '';
    statusEl.style.color = 'var(--muted)';

    await window.keplr.enable(CHAIN_ID);
    const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
    const accounts      = await offlineSigner.getAccounts();
    const addr          = accounts[0].address;

    if (addr === ADMIN_WALLET) {
      adminUnlocked = true;
      closeAdminLogin();
      toggleAdminPanel();
    } else {
      // Wrong wallet - show error
      statusEl.style.color = '#ff3c78';
      statusEl.textContent = '✕ Access denied - wrong wallet';
      btnEl.innerHTML    = '<svg class="oi oi--gold"><use href="#i-key"/></svg> Connect Keplr';
      // Briefly flash red border on modal
      const modal = document.querySelector('#admin-login > div');
      if (modal) {
        modal.style.borderColor = 'rgba(255,60,120,0.6)';
        setTimeout(() => { modal.style.borderColor = 'rgba(0,200,255,0.25)'; }, 1500);
      }
    }
  } catch(e) {
    statusEl.style.color = '#ff9944';
    statusEl.innerHTML = '<svg class="oi oi--amber"><use href="#i-warning"/></svg> ' + escHTML(e.message || 'Connection failed');
    btnEl.innerHTML    = '<svg class="oi oi--gold"><use href="#i-key"/></svg> Connect Keplr';
  }
}

function toggleAdminPanel() {
  const panel = document.getElementById('admin-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  updateAdminStats();
}

function updateAdminStats() {
  const tickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const countEl = document.getElementById('admin-ticket-count');
  const refEl   = document.getElementById('admin-last-refresh');
  if (countEl) countEl.textContent = tickets.length;
  if (refEl)   refEl.textContent   = new Date().toLocaleTimeString('en-GB');
}

