// Oracle Draw inside Terra Oracle: use the wallet the site is connected with.
//
// The draw app kept its own wallet state and only knew Keplr, Galaxy and
// Station, looked up on its own window. Inside the site (an iframe) that
// failed twice: a wallet connected in the top bar was never seen here, and
// mobile in-app browsers (Frontier, Keplr, Galaxy) inject their provider
// into the top page only - Mint said "No wallet found" while the site showed
// "Connected". This bridge:
//   - borrows the providers from the parent page (same origin);
//   - adds Frontier as a signer;
//   - follows the site's wallet (connect, switch, disconnect);
//   - makes "Connect wallet to buy" open the site's own wallet menu.
(function () {
  'use strict';
  if (!document.documentElement.classList.contains('is-embedded')) return;
  var P = null;
  try { if (window.parent !== window && window.parent.document) P = window.parent; } catch (e) { P = null; }
  if (!P) return;

  // site provider name -> draw provider name
  var MAP = { frontier: 'frontier', keplr: 'keplr', 'keplr-ext': 'keplr', galaxy: 'galaxystation',
              station: 'station', luncdash: 'luncdash' };
  var KEYS = ['frontier', 'keplr', 'galaxyStation', 'station'];

  function borrow() {
    KEYS.forEach(function (k) {
      try { if (!window[k] && P[k]) window[k] = P[k]; } catch (e) {}
    });
    try { if (!window.getOfflineSigner && P.getOfflineSigner) window.getOfflineSigner = P.getOfflineSigner; } catch (e) {}
  }
  borrow();

  function siteProvider() {
    try { if (typeof P.getActiveProvider === 'function') return P.getActiveProvider(); } catch (e) {}
    try { return localStorage.getItem('wallet_provider') || 'keplr'; } catch (e) { return 'keplr'; }
  }
  function siteAddress() {
    // the top bar is the truth: "connected" means the wallet answered
    try {
      var btn = P.document.getElementById('wallet-main-btn');
      if (!btn || !btn.classList.contains('connected')) return null;
      var s = JSON.parse(localStorage.getItem('wallet_session') || 'null');
      return s && s.address ? s.address : null;
    } catch (e) { return null; }
  }

  function adopt(address) {
    borrow();
    if (!address) {
      if (typeof connectedWalletAddress !== 'undefined' && connectedWalletAddress && typeof disconnectWallet === 'function') {
        try { disconnectWallet(); } catch (e) {}
      }
      return;
    }
    var prov = MAP[siteProvider()] || 'keplr';
    if (connectedWalletAddress === address && walletProvider === prov) return;
    try { setConnectedWallet(address, prov); } catch (e) { connectedWalletAddress = address; walletProvider = prov; }
    lotteryAddress = address;
    try { syncDrawWalletUI(address); } catch (e) {}
    try { if (typeof updateBuyBtn === 'function') updateBuyBtn(); } catch (e) {}
  }

  // Frontier signs like Keplr (enable + getOfflineSigner + signDirect)
  var origGet = window.getWalletKeplr;
  if (typeof origGet === 'function') {
    window.getWalletKeplr = function (provider) {
      borrow();
      if (provider === 'frontier') return window.frontier || null;
      return origGet(provider);
    };
  }

  // "Connect wallet to buy": open the site's wallet menu (or wake the saved
  // wallet), the bridge picks the result up through oracle:wallet.
  var origConnect = window.connectLotteryKeplr;
  window.connectLotteryKeplr = window.connectDrawKeplr = async function () {
    var a = siteAddress();
    if (a) { adopt(a); return; }
    try {
      if (typeof P.toggleWalletDropdown === 'function') {
        var dd = P.document.getElementById('wallet-dropdown');
        if (!dd || !dd.classList.contains('open')) P.toggleWalletDropdown();
        try { P.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
        return;
      }
    } catch (e) {}
    if (typeof origConnect === 'function') return origConnect();
  };
  // disconnect inside the modal disconnects the site too
  window.disconnectDrawKeplr = window.disconnectLotteryKeplr = function () {
    try { if (typeof P.disconnectWallet === 'function') { P.disconnectWallet(); return; } } catch (e) {}
    adopt(null);
  };

  try { P.addEventListener('oracle:wallet', function (e) { adopt(e && e.detail ? e.detail.address : siteAddress()); }); } catch (e) {}
  addEventListener('storage', function (e) { if (e.key === 'wallet_session' || e.key === 'wallet_provider') adopt(siteAddress()); });

  function start() { adopt(siteAddress()); }
  if (document.readyState === 'complete') setTimeout(start, 0);
  else addEventListener('load', function () { setTimeout(start, 0); });
  // the parent may finish its own restore after the frame loaded
  var tries = 0, t = setInterval(function () {
    if (++tries > 20) return clearInterval(t);
    var a = siteAddress(); if (a) { adopt(a); clearInterval(t); }
  }, 1000);
})();
