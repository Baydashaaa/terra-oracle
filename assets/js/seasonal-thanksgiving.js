/* Seasonal art - Thanksgiving.
   On from Nov 19 to Nov 30 (visitor's local date), off by itself after.
   Test: ?thanksgiving=1 forces it on, ?thanksgiving=0 off (kept for the tab).
   Every page banner that has a Thanksgiving version is swapped for it,
   including banners drawn later by scripts (Reputation tabs). Same file
   names and sizes as the originals, so layouts do not move.
   Art: assets/img/seasonal/thanksgiving/ */
(function () {
  'use strict';
  function isOn() {
    try {
      var q = new URLSearchParams(location.search).get('thanksgiving');
      if (q === '1' || q === '0') sessionStorage.setItem('thanksgiving', q);
      var f = sessionStorage.getItem('thanksgiving');
      if (f === '1') return true;
      if (f === '0') return false;
    } catch (e) {}
    var d = new Date();
    return d.getMonth() === 10 && d.getDate() >= 19 && d.getDate() <= 30;
  }
  if (!isOn()) return;
  document.documentElement.classList.add('theme-thanksgiving');

  var DIR = 'assets/img/seasonal/thanksgiving/';
  var NAMES = ['hero', 'banner-ask', 'banner-markets', 'banner-governance', 'banner-nft',
               'banner-rep-board', 'banner-rep-how', 'banner-rep-stats', 'bg-treasury'];
  var RE = new RegExp('(^|/)assets/img/(' + NAMES.join('|') + ')\\.webp(\\?.*)?$');

  function swap(img) {
    var src = img.getAttribute('src') || '';
    var m = src.match(RE);
    if (!m) return;
    img.removeAttribute('srcset');
    img.setAttribute('src', DIR + m[2] + '.webp');
  }
  function scan(root) {
    if (root.tagName === 'IMG') swap(root);
    if (root.querySelectorAll) root.querySelectorAll('img').forEach(swap);
  }
  // Event logo in the side menu, the hero and the phone top bar (not the TCO
  // coin in the price strip, that one is the token icon).
  function swapLogo() {
    document.querySelectorAll('.logo .mark img, .hero .hmark').forEach(function (img) {
      img.removeAttribute('srcset');
      img.src = DIR + 'logo-256.webp';
      img.srcset = DIR + 'logo-256.webp 256w, ' + DIR + 'logo-512.webp 512w';
      img.sizes = '160px';
    });
    var st = document.createElement('style');
    st.textContent = '@media (max-width:860px){.topbar::before{background-image:url("' + DIR + 'logo-256.webp") !important}}';
    document.head.appendChild(st);
  }
  function start() {
    swapLogo();
    scan(document);
    new MutationObserver(function (list) {
      list.forEach(function (r) {
        if (r.type === 'attributes') swap(r.target);
        else r.addedNodes.forEach(function (n) { if (n.nodeType === 1) scan(n); });
      });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
