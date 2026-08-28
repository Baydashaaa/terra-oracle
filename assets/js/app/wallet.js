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
    // Terra Station - uses window.station (same API as Galaxy Station)
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
  // Показать прогресс к бесплатной entry сразу при подключении, не дожидаясь
  // первой отправки или перезагрузки ленты.
  if (typeof updateChatEntryProgress === 'function') updateChatEntryProgress();
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

  // Если открыта вкладка Your Stats - загружаем данные
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

