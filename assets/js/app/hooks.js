/* ── Oracle Stats hooks (added automatically) ─────────────────── */
(function () {
  if (typeof setWalletConnected !== 'function') return;
  var orig = setWalletConnected;
  setWalletConnected = window.setWalletConnected = function (addr) {
    var r = orig.apply(this, arguments);
    try {
      if (window.oa && addr) {
        oa.wallet(addr, window.__oaRestoring ? { restored: true } : undefined);
      }
    } catch (e) {}
    return r;
  };
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('button, a') : null;
    if (el && /connect/i.test(el.textContent || '')) window.__oaRestoring = false;
  }, true);
})();
