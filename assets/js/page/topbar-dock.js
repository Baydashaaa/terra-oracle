// Top bar as one console: the prices sit in one market strip, the tool buttons
// (Oracle Eye, sound, notifications) in one dock, the wallet and the avatar
// in wells of their own. The buttons are created by different scripts at different
// times (oracle-eye.js, oracle-sound.js, notify), so this keeps regrouping
// them whenever the bar changes. Elements are moved, not copied: their ids,
// listeners and dropdowns stay as they are.
(function () {
  'use strict';
  function start() {
    var bar = document.querySelector('header.topbar');
    if (!bar) return;
    function box(cls) { var d = document.createElement('div'); d.className = cls; return d; }
    var dock = box('tb-dock'), acct = box('tb-acct'), me = box('tb-me');
    var busy = false;
    function place() {
      if (busy) return;
      busy = true;
      try {
        var eye = bar.querySelector('#oe-nav');
        var sound = null;
        bar.querySelectorAll('button.onf-bell.osd-auto').forEach(function (b) { if (!b.closest('.onf-wrap')) sound = b; });
        var bell = bar.querySelector('.onf-wrap');
        var wallet = bar.querySelector('#wallet-wrap');
        var avatar = bar.querySelector('.round.avatar');
        // move only when the order is wrong, so a settled bar causes no mutations
        function arrange(host, want) {
          var ok = want.length === host.children.length && want.every(function (el, i) { return host.children[i] === el; });
          if (!ok) want.forEach(function (el) { host.appendChild(el); });
        }
        arrange(dock, [eye, sound, bell].filter(Boolean));
        arrange(acct, [wallet].filter(Boolean));
        arrange(me, [avatar].filter(Boolean));
        if (dock.parentNode !== bar || dock.nextElementSibling !== acct) bar.appendChild(dock);
        if (acct.parentNode !== bar || acct.nextElementSibling !== me) bar.appendChild(acct);
        if (me.parentNode !== bar || bar.lastElementChild !== me) bar.appendChild(me);
        me.classList.toggle('empty', !me.children.length);
        dock.classList.toggle('empty', !dock.children.length);
      } finally { busy = false; }
    }
    place();
    new MutationObserver(function () { place(); }).observe(bar, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
