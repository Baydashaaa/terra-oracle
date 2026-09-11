/* ── ORACLE DRAW MOBILE WALLET ── */

function openMobileWalletModal() {
  // If already connected - show connected modal
  const addr = _getConnectedAddress();
  if (addr) { openMobileConnectedModal(addr); return; }
  // Check for injected wallets
  const hasKeplr = !!(window.keplr || window.getOfflineSigner);
  const hasGalaxy = !!(window.galaxyStation || window.station);
  const hasTerraStation = !!(window.station && window.station.terra) || !!window.isTerraExtensionAvailable;
  const extSection = document.getElementById('mob-ext-section');
  if (extSection) extSection.style.display = (hasKeplr || hasGalaxy || hasTerraStation) ? 'block' : 'none';
  const modal = document.getElementById('mobile-wallet-modal');
  if (modal) modal.style.display = 'flex';
}

function closeMobileWalletModal() {
  const modal = document.getElementById('mobile-wallet-modal');
  if (modal) modal.style.display = 'none';
}

function openMobileConnectedModal(addr) {
  const modal = document.getElementById('mobile-connected-modal');
  const addrEl = document.getElementById('mob-connected-addr');
  if (addrEl && addr) addrEl.textContent = addr.slice(0,12)+'...'+addr.slice(-6);
  if (modal) modal.style.display = 'flex';
}

function closeMobileConnectedModal() {
  const modal = document.getElementById('mobile-connected-modal');
  if (modal) modal.style.display = 'none';
}

function _getConnectedAddress() {
  // Сначала проверяем реальное состояние сайта
  if (typeof window.globalWalletAddress !== 'undefined' && window.globalWalletAddress) {
    return window.globalWalletAddress;
  }
  // Проверяем label кнопки Connect в nav
  const label = document.getElementById('wallet-btn-label');
  if (label && label.textContent && label.textContent !== 'Connect Wallet' && label.textContent.includes('...')) {
    return label.textContent;
  }
  return null;
}

function mobileConnectWallet(type) {
  if (type === 'keplr-mobile') {
    // In Keplr in-app browser: window.keplr is available
    if (window.keplr && !window.galaxyStation) {
      if (typeof window.connectWallet === 'function') window.connectWallet('keplr');
      return;
    }
    // In Galaxy Station in-app browser: window.galaxyStation.keplr is available
    if (window.galaxyStation) {
      setTimeout(function(){ alert('Please open this site in Keplr Mobile browser to connect with Keplr.'); }, 300);
      return;
    }
    // Not in any in-app browser - open Keplr app
    window.location.href = 'keplr://';
    return;
  }
  if (type === 'galaxy-mobile') {
    // In Galaxy Station in-app browser: window.galaxyStation is available
    if (window.galaxyStation) {
      if (typeof window.connectWallet === 'function') window.connectWallet('galaxystation');
      return;
    }
    // In Keplr in-app browser
    if (window.keplr) {
      setTimeout(function(){ alert('Please open this site in Galaxy Station browser to connect with Galaxy.'); }, 300);
      return;
    }
    // Not in any in-app browser - open Galaxy Station app
    window.location.href = 'galaxystation://';
    return;
  }
  if (type === 'luncdash') {
    setTimeout(function() { openLuncdashInput(); }, 300);
    return;
  }
}

// Sync mob-wallet-btn label when connected/disconnected
function _updateMobWalletBtn(address) {
  const btn = document.getElementById('mob-wallet-btn');
  const label = document.getElementById('mob-wallet-label');
  if (!btn || !label) return;
  if (address) {
    label.textContent = address.slice(0,6)+'...'+address.slice(-4);
    btn.style.background = 'rgba(0,200,150,0.12)';
    btn.style.borderColor = 'rgba(0,200,150,0.35)';
    btn.style.color = '#66ffaa';
    btn.onclick = function() { openMobileConnectedModal(address); };
  } else {
    label.textContent = 'Connect';
    btn.style.background = 'rgba(84,147,247,0.15)';
    btn.style.borderColor = 'rgba(84,147,247,0.4)';
    btn.style.color = '#7eb8ff';
    btn.onclick = openMobileWalletModal;
  }
}

// Hook into setWalletConnected and setConnectedWallet
setTimeout(function() {
  // Oracle Draw uses setConnectedWallet(address, provider)
  if (typeof window.setConnectedWallet === 'function') {
    const _prev = window.setConnectedWallet;
    window.setConnectedWallet = function(addr, provider) {
      _prev(addr, provider);
      _updateMobWalletBtn(addr);
    };
  }
  // Also try setWalletConnected (fallback)
  if (typeof window.setWalletConnected === 'function') {
    const _prev2 = window.setWalletConnected;
    window.setWalletConnected = function(addr) {
      _prev2(addr);
      _updateMobWalletBtn(addr);
    };
  }
  // Watch wallet-btn-label for changes as additional fallback
  const label = document.getElementById('wallet-btn-label');
  if (label) {
    const observer = new MutationObserver(function() {
      const txt = label.textContent;
      if (txt && txt !== 'Connect Wallet' && txt !== 'Connecting...' && txt.includes('terra')) {
        _updateMobWalletBtn(txt);
      } else if (txt === 'Connect Wallet') {
        _updateMobWalletBtn(null);
      }
    });
    observer.observe(label, { childList: true, characterData: true, subtree: true });
  }

  /* Разовая синхронизация с текущим состоянием.
     Хуки выше перехватывают ТОЛЬКО будущие вызовы, а восстановление сессии
     из localStorage происходит на раннем старте app.js - задолго до этих
     800 мс. MutationObserver тоже не спасал: он реагирует на изменения
     после подписки, а метка была проставлена раньше. Из-за этого при уже
     подключённом кошельке в шапке продолжало висеть «Connect». */
  var _curAddr = null;
  try { if (typeof connectedWalletAddress !== 'undefined' && connectedWalletAddress) _curAddr = connectedWalletAddress; } catch(e) {}
  try { if (!_curAddr && typeof lotteryAddress !== 'undefined' && lotteryAddress) _curAddr = lotteryAddress; } catch(e) {}
  if (_curAddr) _updateMobWalletBtn(_curAddr);
}, 800);

function handleMobileDisconnect() {
  closeMobileConnectedModal();
  // Чистим localStorage
  try { localStorage.removeItem('wallet_session'); } catch(e) {}
  // Вызываем оригинальный disconnect
  if (typeof window.disconnectWallet === 'function') {
    window.disconnectWallet();
  }
  // Обновляем кнопку
  _updateMobWalletBtn(null);
}

// Close modals on backdrop click
document.getElementById('mobile-wallet-modal').addEventListener('click', function(e) {
  if (e.target === this) closeMobileWalletModal();
});
document.getElementById('mobile-connected-modal').addEventListener('click', function(e) {
  if (e.target === this) closeMobileConnectedModal();
});
