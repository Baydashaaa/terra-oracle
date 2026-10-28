/* ════════════════════════════════════════════════════════════════
   Seasonal theme - Halloween (self-contained)
   ----------------------------------------------------------------
   <script src="assets/js/seasonal.js?v=1"></script>   (in <head>, no defer)

   On from Oct 28 to Nov 1 (visitor's local date), off by itself after.
   Test: ?halloween=1 forces it on, ?halloween=0 forces it off
   (kept for the browser tab session).

   What it does while on:
   - sidebar and hero logo -> event logo
   - hero background -> Halloween art (smaller file on phones)
   - a spider hangs from the top edge next to the wallet button
   - the hooded watcher peeks up from the bottom edge now and then
     (random side, at most 5 times per visit, never blocks clicks)
   Art: assets/img/seasonal/halloween/
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__seasonalLoaded) return;
  window.__seasonalLoaded = true;

  var DIR = 'assets/img/seasonal/halloween/';

  function isOn() {
    try {
      var q = new URLSearchParams(location.search).get('halloween');
      if (q === '1' || q === '0') sessionStorage.setItem('halloween', q);
      var forced = sessionStorage.getItem('halloween');
      if (forced === '1') return true;
      if (forced === '0') return false;
    } catch (e) {}
    var d = new Date(), m = d.getMonth(), day = d.getDate();
    return (m === 9 && day >= 28) || (m === 10 && day <= 1);
  }
  if (!isOn()) return;

  document.documentElement.classList.add('theme-halloween');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var css = ''
    + '#hw-spider{position:fixed;top:0;width:84px;height:84px;z-index:60;pointer-events:none;'
    +   'filter:drop-shadow(0 4px 10px rgba(123,92,255,.45));opacity:0;transition:opacity .6s;}'
    + '#hw-spider.on{opacity:1;}'
    + '#hw-spider img{width:100%;height:100%;display:block;}'
    + '#hw-watcher{position:fixed;bottom:0;width:120px;height:168px;z-index:55;pointer-events:none;'
    +   'transform:translateY(105%);transition:transform 1.4s cubic-bezier(.2,.8,.2,1),opacity 1.2s;'
    +   'filter:drop-shadow(0 0 18px rgba(123,92,255,.35));}'
    + '#hw-watcher.left{left:2vw;} #hw-watcher.right{right:2vw;}'
    + '#hw-watcher.up{transform:translateY(22%);}'
    + '#hw-watcher img{width:100%;height:100%;display:block;}'
    + '@media (max-width:760px){'
    +   '#hw-spider{width:64px;height:64px;}'
    +   '#hw-watcher{width:84px;height:118px;bottom:calc(64px + env(safe-area-inset-bottom,0px));}'
    + '}'
    + '@media (prefers-reduced-motion:reduce){'
    +   '#hw-watcher{transition:opacity 1.2s;transform:translateY(22%);opacity:0;}'
    +   '#hw-watcher.up{opacity:1;}'
    + '}';

  function swapArt() {
    // Event logo: sidebar mark and the hero mark. The TCO ticker icon in the
    // top bar uses the same file and stays as it is.
    document.querySelectorAll('.logo .mark img, .hero .hmark').forEach(function (img) {
      img.src = DIR + 'logo-256.webp';
      img.srcset = DIR + 'logo-256.webp 256w, ' + DIR + 'logo-512.webp 512w';
      img.sizes = '160px';
      img.alt = 'Terra Oracle - Halloween';
    });
    var art = document.querySelector('.hero .art');
    if (art) {
      art.srcset = DIR + 'hero-960.webp 960w, ' + DIR + 'hero.webp 1774w';
      art.sizes = '100vw';
      art.src = DIR + 'hero.webp';
    }
  }

  function addSpider() {
    var sp = document.createElement('div');
    sp.id = 'hw-spider';
    sp.setAttribute('aria-hidden', 'true');
    sp.innerHTML = '<img src="' + DIR + 'spider.svg" alt="" width="160" height="160">';
    document.body.appendChild(sp);
    function place() {
      var w = document.getElementById('wallet-wrap');
      var r = w ? w.getBoundingClientRect() : null;
      var size = sp.offsetWidth || 84;
      // Hangs over the left edge of the wallet button; without it - top right corner
      var x = (r && r.width) ? r.left - size * 0.45 : window.innerWidth - size - 220;
      sp.style.left = Math.max(4, Math.min(window.innerWidth - size - 4, x)) + 'px';
    }
    place();
    sp.classList.add('on');
    window.addEventListener('resize', place);
    setTimeout(place, 1200);   // after fonts and the Oracle Eye settle the top bar
  }

  function addWatcher() {
    var MAX = 5, KEY = 'hw-watcher-shown';
    var shown = 0;
    try { shown = Number(sessionStorage.getItem(KEY) || 0); } catch (e) {}
    if (shown >= MAX) return;

    var el = document.createElement('div');
    el.id = 'hw-watcher';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<img src="' + DIR + 'watcher.svg" alt="" width="200" height="280">';
    document.body.appendChild(el);

    function rnd(a, b) { return a + Math.random() * (b - a); }
    function next(delay) { setTimeout(peek, delay); }
    function peek() {
      if (shown >= MAX) return;
      if (document.hidden) { next(rnd(15000, 30000)); return; }
      el.classList.remove('left', 'right');
      el.classList.add(Math.random() < 0.5 ? 'left' : 'right');
      void el.offsetWidth;                       // restart the transition from below
      el.classList.add('up');
      shown++;
      try { sessionStorage.setItem(KEY, String(shown)); } catch (e) {}
      setTimeout(function () { el.classList.remove('up'); }, rnd(5000, 7500));
      next(rnd(45000, 120000));
    }
    next(rnd(20000, 40000));
  }

  function start() {
    var style = document.createElement('style');
    style.id = 'hw-style';
    style.textContent = css;
    document.head.appendChild(style);
    swapArt();
    addSpider();
    addWatcher();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.SeasonalTheme = { name: 'halloween', reducedMotion: reduced };
})();
