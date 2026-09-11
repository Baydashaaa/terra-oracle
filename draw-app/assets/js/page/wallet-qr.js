const WQR_CONFIGS = {
  'keplr-mobile': {
    title: 'Keplr',
    icon: `<img src="data:image/png;base64,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" style="width:36px;height:36px;border-radius:10px;display:block;">`,
    deeplink: (uri) => `keplr://wc?uri=${encodeURIComponent(uri)}`,
  },
  'galaxy-mobile': {
    title: 'Galaxy Station',
    icon: `<img src="https://docs.station.hexxagon.io/img/galaxy-station-logo.svg" style="width:36px;height:36px;border-radius:10px;display:block;">`,
    deeplink: (uri) => `galaxystation://wc?uri=${encodeURIComponent(uri)}`,
  },
  'station-mobile': {
    title: 'Terra Station',
    icon: `<img src="https://classic-docs.terra.money/_images/wallets_station.png" style="width:36px;height:36px;border-radius:10px;display:block;object-fit:cover;">`,
    deeplink: (uri) => `station://wc?uri=${encodeURIComponent(uri)}`,
  },
  'luncdash': {
    title: 'Luncdash',
    icon: `<svg style="width:36px;height:36px;" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
 <rect   rx="14" fill="#1a0e00"/>
 <circle cx="26" cy="26" r="18" stroke="url(#lg)" stroke-width="2.5" fill="none"/>
 <circle cx="26" cy="26" r="13" fill="#0d0800"/>
 <circle cx="26" cy="26" r="9" fill="#d4a017"/>
 <circle cx="30" cy="23" r="7.5" fill="#1a0e00"/>
 <circle cx="16" cy="16" r="1" fill="#f4c842" opacity="0.7"/>
 <circle cx="38" cy="14" r="0.7" fill="#f4c842" opacity="0.5"/>
 <circle cx="40" cy="36" r="0.8" fill="#f4c842" opacity="0.4"/>
 <defs>
 <linearGradient id="lg" x1="8" y1="8" x2="44" y2="44"><stop stop-color="#f4c842"/><stop offset="1" stop-color="#c47d00"/></linearGradient>
 </defs>
 </svg>`,
    deeplink: (uri) => `luncdash://wc?uri=${encodeURIComponent(uri)}`,
  }
};

const _isMobile = () => /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.matchMedia('(hover:none)').matches;
let _wqrClient = null, _wqrActive = false;
window._wqrClient = null;

function openWalletQRModal(walletType) {
  const cfg = WQR_CONFIGS[walletType];
  if (!cfg) return;
  if (_isMobile()) { window.location.href = cfg.deeplink(''); return; }
  if (_wqrActive) closeWalletQRModal();
  document.getElementById('wqr-icon').innerHTML = cfg.icon;
  document.getElementById('wqr-title').textContent = cfg.title;
  document.getElementById('wqr-status').textContent = 'Connecting...';
  document.getElementById('wqr-deeplink').style.display = 'none';
  const canvas = document.getElementById('wqr-canvas');
  canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
  document.getElementById('wallet-qr-modal').style.display = 'flex';
  _wqrActive = true;
  _startWC(walletType, cfg);
}

async function _startWC(walletType, cfg) {
  const statusEl = document.getElementById('wqr-status');
  try {
    const SignClient = await new Promise((resolve, reject) => {
      if (window._WCSignClient) return resolve(window._WCSignClient);
      const t = setTimeout(() => reject(new Error('timeout')), 20000);
      window.addEventListener('wc-ready', () => { clearTimeout(t); resolve(window._WCSignClient); }, { once: true });
    });
    if (!_wqrActive) return;
    statusEl.textContent = 'Generating QR...';
    _wqrClient = window._wqrClient = await SignClient.init({
      projectId: window._wcProjectId,
      metadata: {
        name: 'Oracle Draw',
        description: 'LUNC On-Chain NFT Lottery',
        url: 'https://draw.terraoracle.io/',
        icons: ['https://draw.terraoracle.io/favicon.ico']
      }
    });
    if (!_wqrActive) return;
    const { uri, approval } = await _wqrClient.connect({
      requiredNamespaces: {
        cosmos: {
          methods: ['cosmos_signAmino', 'cosmos_signDirect', 'cosmos_getAccounts'],
          chains: ['cosmos:columbus-5'],
          events: ['chainChanged', 'accountsChanged']
        }
      }
    });
    if (!uri || !_wqrActive) return;
    _renderQRSafe(uri);
    const dlBtn = document.getElementById('wqr-deeplink');
    dlBtn.href = cfg.deeplink(uri);
    if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) dlBtn.style.display = 'block';
    statusEl.textContent = 'Scan with ' + cfg.title;
    const session = await approval();
    if (!_wqrActive) return;
    closeWalletQRModal();
    const accounts = session?.namespaces?.cosmos?.accounts || [];
    if (accounts.length > 0) {
      const addr = accounts[0].split(':')[2];
      if (addr) _onWCConnected(addr, walletType);
    }
  } catch(e) {
    if (!_wqrActive) return;
    statusEl.textContent = e.message === 'timeout' ? 'SDK load timeout' : 'Connection error';
  }
}

function _renderQRSafe(text) {
  const canvas = document.getElementById('wqr-canvas');
  const attempt = () => {
    if (typeof qrcode !== 'undefined' && window.renderQRToCanvas) window.renderQRToCanvas(text, canvas);
    else setTimeout(attempt, 150);
  };
  attempt();
}

function _onWCConnected(address, walletType) {
  // Primary: use setConnectedWallet from app.js (sets walletProvider, UI, persistence, balance)
  if (typeof window.setConnectedWallet === 'function') {
    window.setConnectedWallet(address, walletType);
  } else if (typeof window.setWalletConnected === 'function') {
    window.setWalletConnected(address);
  }
  // Store WC session for reconnect on page reload
  try { localStorage.setItem('wallet_session', JSON.stringify({ address, type: walletType, expires: Date.now() + 7*24*60*60*1000 })); } catch(e) {}
  // Update mobile wallet button
  if (typeof _updateMobWalletBtn === 'function') _updateMobWalletBtn(address);
}

function closeWalletQRModal() {
  _wqrActive = false;
  const modal = document.getElementById('wallet-qr-modal');
  if (modal) modal.style.display = 'none';
  const canvas = document.getElementById('wqr-canvas');
  if (canvas) canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
}

document.getElementById('wallet-qr-modal').addEventListener('click', function(e) {
  if (e.target === this) closeWalletQRModal();
});

/* ─── Patch connectWallet: mobile types → QR/deeplink ─── */
(function() {
  const mobileTypes = ['keplr-mobile', 'galaxy-mobile', 'station-mobile', 'luncdash'];
  function tryPatch() {
    if (typeof window.connectWallet === 'function') {
      const _orig = window.connectWallet;
      window.connectWallet = function(type) {
        if (mobileTypes.includes(type)) { openWalletQRModal(type); return; }
        return _orig.apply(this, arguments);
      };
      return true;
    }
    return false;
  }
  if (!tryPatch()) {
    const iv = setInterval(() => { if (tryPatch()) clearInterval(iv); }, 100);
    setTimeout(() => clearInterval(iv), 8000);
  }
})();

/* ─── Patch disconnectWallet: close WC session ─── */
(function() {
  function tryPatchDisconnect() {
    if (typeof window.disconnectWallet === 'function') {
      const _orig = window.disconnectWallet;
      window.disconnectWallet = async function() {
        if (window._wqrClient) {
          try {
            const sessions = window._wqrClient.session?.getAll() || [];
            for (const s of sessions) {
              await window._wqrClient.disconnect({
                topic: s.topic,
                reason: { code: 6000, message: 'User disconnected' }
              });
            }
          } catch(e) { console.warn('[WC disconnect]', e.message); }
          window._wqrClient = null;
        }
        return _orig.apply(this, arguments);
      };
      return true;
    }
    return false;
  }
  if (!tryPatchDisconnect()) {
    const iv = setInterval(() => { if (tryPatchDisconnect()) clearInterval(iv); }, 100);
    setTimeout(() => clearInterval(iv), 8000);
  }
})();
