// ── Mobile navigation ──
function closeMobileMenu() {
  const drawer = document.getElementById('nav-mobile-drawer');
  const btn = document.getElementById('nav-hamburger');
  if (drawer) drawer.classList.remove('open');
  if (btn) btn.classList.remove('active');
}

function toggleMobileNav() {
  const drawer = document.getElementById('nav-mobile-drawer');
  const btn = document.getElementById('nav-hamburger');
  const isOpen = drawer.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

function mobileNavGo(page) {
  showPage(page);
  toggleMobileNav();
}

function mobileNavGoFn(fn) {
  toggleMobileNav();
  setTimeout(function() {
    if (fn === 'showPage_treasury' && typeof showPage_treasury === 'function') {
      showPage_treasury({target: document.createElement('button')});
    }
  }, 50);
}

// Close drawer on outside click
document.addEventListener('click', function(e) {
  const drawer = document.getElementById('nav-mobile-drawer');
  const btn = document.getElementById('nav-hamburger');
  if (drawer && drawer.classList.contains('open')) {
    if (!drawer.contains(e.target) && !btn.contains(e.target)) {
      drawer.classList.remove('open');
      btn.classList.remove('open');
      document.body.style.overflow = '';
    }
  }
});

// Sync mobile wallet label with desktop
// Update mobile wallet UI when connected/disconnected
function updateMobileWalletUI(address) {
  const connectedInfo = document.getElementById('mobile-connected-info');
  const addrEl = document.getElementById('mobile-wallet-addr');
  const navBtn = document.getElementById('mobile-wallet-nav-btn');
  const navLabel = document.getElementById('mobile-wallet-nav-label');
  if (address) {
    const short = address.slice(0,6)+'...'+address.slice(-4);
    if (connectedInfo) connectedInfo.style.display = 'block';
    if (addrEl) addrEl.textContent = address.slice(0,10)+'...'+address.slice(-6);
    if (navLabel) navLabel.textContent = short;
    if (navBtn) {
      navBtn.style.background = 'rgba(0,200,150,0.12)';
      navBtn.style.borderColor = 'rgba(0,200,150,0.35)';
      navBtn.style.color = '#66ffaa';
      // Lets CSS drop the address on narrow screens while still showing the
      // word "Connect" when there is nothing connected yet - the state cannot
      // be expressed from the label text alone.
      navBtn.classList.add('is-connected');
    }
  } else {
    if (connectedInfo) connectedInfo.style.display = 'none';
    if (navLabel) navLabel.textContent = 'Connect';
    if (navBtn) navBtn.classList.remove('is-connected');
    if (navBtn) {
      navBtn.style.background = 'rgba(84,147,247,0.15)';
      navBtn.style.borderColor = 'rgba(84,147,247,0.4)';
      navBtn.style.color = '#7eb8ff';
    }
  }
}

const _origSetWalletConnectedMobile = window.setWalletConnected;
setTimeout(() => {
  if (typeof window.setWalletConnected === 'function') {
    const _prev = window.setWalletConnected;
    window.setWalletConnected = function(address) {
      _prev(address);
      updateMobileWalletUI(address);
    };
    // Restore session if saved
    const saved = (() => { try { const s = JSON.parse(localStorage.getItem('wallet_session')||'null'); if(s&&s.address&&s.expires>Date.now()) return s.address; } catch(e){} return null; })();
    if (saved) updateMobileWalletUI(saved);
  }
}, 300);

// Also patch disconnectWallet to update mobile UI
setTimeout(() => {
  if (typeof window.disconnectWallet === 'function') {
    const _prevDisc = window.disconnectWallet;
    window.disconnectWallet = function() {
      _prevDisc();
      updateMobileWalletUI(null);
    };
  }
}, 300);
