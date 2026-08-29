function toggleMobileRepMenu() {
  const menu = document.getElementById('mobile-rep-menu');
  const arrow = document.getElementById('rep-menu-arrow');
  if (!menu) return;
  const open = menu.style.display === 'none';
  menu.style.display = open ? 'block' : 'none';
  if (arrow) arrow.style.transform = open ? 'rotate(180deg)' : '';
}

function openMobileWalletModal() {
  const modal = document.getElementById('mobile-wallet-modal');
  if (modal) { modal.style.display='flex'; }
}

function handleMobileNavWalletBtn() {
  if (typeof globalWalletAddress !== 'undefined' && globalWalletAddress) {
    openMobileConnectedModal();
  } else {
    openMobileWalletModal();
  }
}

function openMobileConnectedModal() {
  const modal = document.getElementById('mobile-connected-modal');
  if (!modal) return;
  // Fill address
  const addr = globalWalletAddress;
  const addrEl = document.getElementById('mcm-address');
  if (addrEl) addrEl.textContent = addr.slice(0,12)+'...'+addr.slice(-6);
  modal.style.display = 'flex';
}

function closeMobileConnectedModal() {
  const modal = document.getElementById('mobile-connected-modal');
  if (modal) modal.style.display = 'none';
}
function closeMobileWalletModal() {
  const modal = document.getElementById('mobile-wallet-modal');
  if (modal) { modal.style.display='none'; }
}
// Close on backdrop click
document.getElementById('mobile-wallet-modal')?.addEventListener('click', function(e) {
  if (e.target === this) closeMobileWalletModal();
});
document.getElementById('mobile-connected-modal')?.addEventListener('click', function(e) {
  if (e.target === this) closeMobileConnectedModal();
});
