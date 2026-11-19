// Home: makes the Ecosystem stats tiles live.
//  - a tile that leads into Draw opens the right tab (Winners / Verify);
//  - a number that changes flashes once;
//  - the Terra Classic tile shows the latest block and how fresh it is.
// Navigation itself goes through shell-nav.js ([data-view]); this file only
// adds the Draw tab and the visuals.
(function () {
  'use strict';
  var LCD = 'https://terra-classic-lcd.publicnode.com';
  var $ = function (id) { return document.getElementById(id); };

  document.addEventListener('click', function (e) {
    var a = e.target.closest('.stats [data-draw-tab]');
    if (!a) return;
    var tab = a.getAttribute('data-draw-tab');
    // shell-nav opens Draw on the same click; pick the tab right after
    setTimeout(function () { if (window.drawTabs) window.drawTabs.open(tab); }, 60);
  });

  // flash a figure when its value changes (not on the first fill)
  ['stTvl', 'stPlayers', 'stPaid', 'stRounds'].forEach(function (id) {
    var el = $(id); if (!el) return;
    var last = el.textContent;
    new MutationObserver(function () {
      var now = el.textContent;
      if (now === last) return;
      var first = last === '-' || last === '';
      last = now;
      if (first) return;
      el.classList.remove('hl-bump'); void el.offsetWidth; el.classList.add('hl-bump');
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });

  // live block on the Terra Classic tile
  var height = 0, blockTime = 0;
  function onHome() {
    var p = $('page-home');
    return !p || p.classList.contains('active') || getComputedStyle(p).display !== 'none';
  }
  function fmtAge(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + 's ago' : Math.floor(s / 60) + 'm ago';
  }
  function paint() {
    var b = $('hlBlock'), age = $('hlBlockAge');
    if (!b || !height) return;
    var t = 'Block #' + height.toLocaleString('en-US');
    if (b.textContent !== t) { b.textContent = t; b.classList.remove('hl-tick'); void b.offsetWidth; b.classList.add('hl-tick'); }
    if (age) age.textContent = 'Live · ' + fmtAge(Date.now() - blockTime);
  }
  async function poll() {
    if (document.hidden || !onHome()) return;
    try {
      var r = await fetch(LCD + '/cosmos/base/tendermint/v1beta1/blocks/latest', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      var d = await r.json();
      var h = d && d.block && d.block.header;
      if (!h) return;
      height = +h.height; blockTime = Date.parse(h.time) || Date.now();
      paint();
    } catch (e) { /* keep the static label */ }
  }
  function start() {
    poll();
    setInterval(poll, 12000);
    setInterval(paint, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
