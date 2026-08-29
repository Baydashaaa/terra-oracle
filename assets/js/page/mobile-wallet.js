/* ── MOBILE WALLET SMART CONNECT ── */

// Показываем Extension секцию только если кошелёк инжектирован
function updateMobileExtSection() {
  const section = document.getElementById('mob-ext-section');
  if (!section) return;
  const hasKeplr   = !!(window.keplr || window.getOfflineSigner);
  const hasGalaxy  = !!(window.galaxyStation || window.station);
  const hasStation = !!window.station;
  section.style.display = (hasKeplr || hasGalaxy || hasStation) ? 'block' : 'none';
  const keplrBtn   = document.getElementById('mob-keplr-ext-btn');
  const galaxyBtn  = document.getElementById('mob-galaxy-ext-btn');
  const stationBtn = document.getElementById('mob-station-ext-btn');
  if (keplrBtn)   keplrBtn.style.display   = hasKeplr ? 'flex' : 'none';
  if (galaxyBtn)  galaxyBtn.style.display  = hasGalaxy ? 'flex' : 'none';
  if (stationBtn) stationBtn.style.display = hasStation ? 'flex' : 'none';
}

// Вызываем при открытии мобильной модалки
const _origOpenMobileWalletModal = window.openMobileWalletModal;
window.openMobileWalletModal = function() {
  updateMobileExtSection();
  if (typeof _origOpenMobileWalletModal === 'function') return _origOpenMobileWalletModal();
  const modal = document.getElementById('mobile-wallet-modal');
  if (modal) modal.style.display = 'flex';
};

// Также при handleMobileNavWalletBtn
const _origHandleMobileNav = window.handleMobileNavWalletBtn;
window.handleMobileNavWalletBtn = function() {
  if (typeof globalWalletAddress !== 'undefined' && globalWalletAddress) {
    if (typeof openMobileConnectedModal === 'function') openMobileConnectedModal();
  } else {
    updateMobileExtSection();
    const modal = document.getElementById('mobile-wallet-modal');
    if (modal) modal.style.display = 'flex';
  }
};

// mobileConnectWallet - умный коннект для мобильных кнопок
function mobileConnectWallet(type) {
  if (type === 'keplr-mobile') {
    if (window.keplr) {
      if (typeof connectWallet === 'function') connectWallet('keplr-ext');
      return;
    }
    if (window.galaxyStation || window.station) {
      setTimeout(function(){ alert('Please open this site in Keplr browser to connect with Keplr wallet.'); }, 300);
      return;
    }
    window.location.href = 'keplr://';
    return;
  }
  if (type === 'galaxy-mobile') {
    if (window.galaxyStation || window.station) {
      if (typeof connectWallet === 'function') connectWallet('galaxy');
      return;
    }
    if (window.keplr) {
      setTimeout(function(){ alert('Please open this site in Galaxy Station browser to connect with Galaxy wallet.'); }, 300);
      return;
    }
    window.location.href = 'galaxystation://';
    return;
  }
  if (type === 'station-mobile') {
    if (window.station) {
      if (typeof connectWallet === 'function') connectWallet('station');
      return;
    }
    if (window.keplr || window.galaxyStation) {
      setTimeout(function(){ alert('Please open this site in the Station app browser to connect with Station wallet.'); }, 300);
      return;
    }
    window.location.href = 'station://';
    return;
  }
  if (type === 'luncdash') {
    setTimeout(function() { openLuncdashInput(); }, 300);
    return;
  }
}

// Запускаем проверку после загрузки
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(updateMobileExtSection, 500);
});
