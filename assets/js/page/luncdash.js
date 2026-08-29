function openLuncdashInput() {
  const modal = document.getElementById('luncdash-modal');
  const input = document.getElementById('luncdash-addr-input');
  if (modal) modal.style.display = 'flex';
  if (input) { input.value = ''; setTimeout(function(){ input.focus(); }, 100); }
}
function closeLuncdashModal() {
  const modal = document.getElementById('luncdash-modal');
  if (modal) modal.style.display = 'none';
}
function confirmLuncdashAddr() {
  const input = document.getElementById('luncdash-addr-input');
  const addr = input ? input.value.trim() : '';
  if (addr.startsWith('terra1') && addr.length >= 40) {
    closeLuncdashModal();
    if (typeof window.setActiveProvider === 'function') window.setActiveProvider('luncdash');
    else if (typeof setActiveProvider === 'function') setActiveProvider('luncdash');
    if (typeof window.setWalletConnected === 'function') {
      window.setWalletConnected(addr);
    } else if (typeof connectWallet === 'function') {
      connectWallet('luncdash');
    }
  } else {
    input.style.borderColor = 'rgba(255,80,80,0.6)';
    setTimeout(function(){ input.style.borderColor = 'rgba(232,200,64,0.3)'; }, 1500);
  }
}
document.getElementById('luncdash-modal').addEventListener('click', function(e) {
  if (e.target === this) closeLuncdashModal();
});
