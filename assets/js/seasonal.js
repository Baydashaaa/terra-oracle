/* ════════════════════════════════════════════════════════════════
   Seasonal theme - Halloween (self-contained), v2
   ----------------------------------------------------------------
   <script src="assets/js/seasonal.js?v=2"></script>   (in <head>, no defer)

   On from Oct 28 to Nov 1 (visitor's local date), off by itself after.
   Test: ?halloween=1 forces it on, ?halloween=0 forces it off
   (kept for the browser tab session). In the console:
   SeasonalTheme.peek('rise' | 'side' | 'phase') shows the watcher now.

   - sidebar and hero logo -> event logo, hero background -> Halloween art
   - a spider hangs on its thread from the bottom edge of the top bar,
     under the wallet button
   - the hooded watcher shows up every 15-40 s (at most 12 times a visit)
     in one of three ways: rises from the bottom edge, leans in from a
     side, or materialises out of the dark. His eyes follow the cursor;
     get the cursor close and he says something and vanishes.
     Never blocks clicks.
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
  var MOBILE = '(max-width:760px)';
  function isMobile() { return window.matchMedia(MOBILE).matches; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  var css = ''
    + '#hw-spider{position:fixed;top:0;left:0;width:60px;height:60px;z-index:60;pointer-events:none;'
    +   'filter:drop-shadow(0 4px 10px rgba(123,92,255,.45));opacity:0;transition:opacity .6s;}'
    + '#hw-spider:before{content:"";position:absolute;left:50%;top:0;width:1.5px;height:40%;transform:translateX(-50%);border-radius:1px;background:linear-gradient(#eee4ff,#c9b6ff 60%,#a99bbd);box-shadow:0 0 4px rgba(200,180,255,.6);}'
    + '#hw-spider.on{opacity:1;}'
    + '#hw-spider img{width:100%;height:100%;display:block;}'

    + '#hw-watcher{position:fixed;width:120px;height:168px;z-index:55;pointer-events:none;opacity:0;'
    +   'filter:drop-shadow(0 0 18px rgba(123,92,255,.35));}'
    + '#hw-watcher .hw-body{width:100%;height:100%;transform-origin:50% 100%;animation:hwSway 3.4s ease-in-out infinite;}'
    + '#hw-watcher svg{width:100%;height:100%;display:block;overflow:visible;}'
    + '@keyframes hwSway{0%,100%{transform:rotate(-2.5deg) translateY(0)}50%{transform:rotate(2.5deg) translateY(-5px)}}'
    + '#hw-bubble{position:absolute;left:50%;top:-4px;transform:translate(-50%,-100%) scale(.9);opacity:0;'
    +   'padding:7px 12px;border-radius:12px;white-space:nowrap;font:600 12px "Exo 2",sans-serif;color:#E8F0FF;'
    +   'background:linear-gradient(160deg,rgba(22,18,52,.96),rgba(11,15,30,.96));border:1px solid rgba(123,92,255,.45);'
    +   'box-shadow:0 0 18px rgba(123,92,255,.3);transition:opacity .25s,transform .25s;}'
    + '#hw-bubble.on{opacity:1;transform:translate(-50%,-100%) scale(1);}'
    + '@media (max-width:760px){'
    +   '#hw-spider{width:50px;height:50px;}'
    +   '#hw-watcher{width:86px;height:120px;}'
    + '}'
    + '@media (prefers-reduced-motion:reduce){#hw-watcher .hw-body{animation:none;}}';

  /* The watcher, inlined so his eyes can follow the cursor. Ids are
     prefixed so they never collide with other SVGs on the page. */
  var WATCHER_SVG = ''
    + '<svg viewBox="0 0 200 280" aria-hidden="true" focusable="false">'
    + '<defs>'
    +   '<linearGradient id="hw-cloak" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#272134"/><stop offset=".45" stop-color="#100e18"/><stop offset="1" stop-color="#040509"/></linearGradient>'
    +   '<linearGradient id="hw-rim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#9b88bd" stop-opacity=".65"/><stop offset=".48" stop-color="#62527e" stop-opacity=".3"/><stop offset="1" stop-color="#241d31" stop-opacity="0"/></linearGradient>'
    +   '<radialGradient id="hw-void"><stop stop-color="#010104"/><stop offset="1" stop-color="#090711"/></radialGradient>'
    +   '<linearGradient id="hw-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="white"/><stop offset=".75" stop-color="white"/><stop offset="1" stop-color="black"/></linearGradient>'
    +   '<mask id="hw-dissolve" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="280"><rect width="200" height="280" fill="url(#hw-fade)"/></mask>'
    +   '<filter id="hw-glow" x="-100%" y="-200%" width="300%" height="500%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2.2"/></filter>'
    + '</defs>'
    + '<style>'
    +   '.hw-eye{animation:hwEmber 5.8s ease-in-out infinite;fill:#fff8dd;}'
    +   '.hw-blink{animation:hwBlink 5.8s linear infinite;}'
    +   '@keyframes hwEmber{0%,22%,100%{fill:#fffdf0}49%,79%{fill:#ffd45c}}'
    +   '@keyframes hwBlink{0%,29%,34%,76%,81%,100%{opacity:1}31%,32%,78%,79%{opacity:.03}}'
    +   '@media (prefers-reduced-motion:reduce){.hw-eye,.hw-blink{animation:none}}'
    + '</style>'
    + '<g mask="url(#hw-dissolve)">'
    +   '<path d="M101 20 C80 23 64 48 56 78 L48 118 C32 142 25 185 16 248 L43 241 54 266 76 252 100 272 124 252 144 267 156 242 184 248 C172 191 170 149 151 119 L144 78 C137 48 123 27 101 20Z" fill="url(#hw-cloak)" stroke="url(#hw-rim)" stroke-width="1.6"/>'
    +   '<path d="M101 38 C80 50 65 77 63 109 C76 131 124 131 138 109 C134 77 120 51 101 38Z" fill="url(#hw-void)"/>'
    +   '<path d="M99 26 C77 42 59 78 57 112 M105 30 C129 54 143 87 146 114" fill="none" stroke="url(#hw-rim)" stroke-width="2" stroke-linecap="round"/>'
    +   '<path d="M61 119 Q76 139 99 148 Q119 140 140 120 L124 146 100 159 77 147Z" fill="#282133" opacity=".6"/>'
    +   '<path d="M61 143 Q48 187 42 238 M78 154 Q67 198 68 250 M123 151 Q139 196 146 240 M101 165 L98 251" fill="none" stroke="#564566" stroke-opacity=".22" stroke-width="2"/>'
    +   '<path d="M58 158 L35 223 53 214 64 176 M143 158 L165 224 146 215 136 176" fill="#05060b" opacity=".7"/>'
    +   '<g id="hw-eyes"><g class="hw-blink">'
    +     '<g class="hw-eye" filter="url(#hw-glow)" opacity=".65"><path d="M73 85 Q83 85 91 90 Q84 96 77 91Z M109 90 Q118 85 128 85 L124 92 Q115 96 109 90Z"/></g>'
    +     '<g class="hw-eye"><path d="M73 85 Q83 85 91 90 Q84 96 77 91Z M109 90 Q118 85 128 85 L124 92 Q115 96 109 90Z"/></g>'
    +   '</g></g>'
    + '</g>'
    + '</svg>';

  var QUIPS = ['Boo.', 'I see your bets.', 'The oracle never sleeps.', 'Happy Halloween.', 'Who goes there?', 'Shh... the draw is near.'];

  function swapArt() {
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

  /* ── Spider: hangs from the bottom edge of the top bar ───────── */
  function addSpider() {
    var sp = document.createElement('div');
    sp.id = 'hw-spider';
    sp.setAttribute('aria-hidden', 'true');
    sp.innerHTML = '<img src="' + DIR + 'spider.svg" alt="" width="160" height="160">';
    document.body.appendChild(sp);
    var raf = 0;
    function place() {
      raf = 0;
      var w = document.getElementById('wallet-wrap');
      var bar = (w && w.closest('.topbar')) || document.querySelector('.topbar');
      if (!w || !bar) { sp.style.visibility = 'hidden'; return; }
      var size = sp.offsetWidth || 60;
      var b = bar.getBoundingClientRect(), r = w.getBoundingClientRect();
      function vis(el) {
        while (el && (!el.getBoundingClientRect().width || el.id === 'hw-spider')) el = el;
        return el && el.getBoundingClientRect().width ? el : null;
      }
      var prev = w.previousElementSibling, next = w.nextElementSibling;
      while (prev && !prev.getBoundingClientRect().width) prev = prev.previousElementSibling;
      while (next && !next.getBoundingClientRect().width) next = next.nextElementSibling;
      var leftGap = prev ? r.left - prev.getBoundingClientRect().right : 0;
      var rightGap = next ? next.getBoundingClientRect().left - r.right : 0;
      var cx;
      if (isMobile() && prev) cx = (prev.getBoundingClientRect().right + r.left) / 2;
      else if (rightGap >= leftGap && next) cx = r.right + rightGap / 2;
      else if (prev) cx = prev.getBoundingClientRect().right + leftGap / 2;
      else cx = r.left - 20;
      var x = Math.max(4, Math.min(window.innerWidth - size - 4, cx - size / 2));
      sp.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(b.top + 1) + 'px)';
      sp.style.visibility = b.bottom < 0 ? 'hidden' : 'visible';
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(place); }
    place();
    sp.classList.add('on');
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    document.addEventListener('scroll', schedule, { passive: true, capture: true });
    setTimeout(place, 1200);
  }

  /* ── Watcher ─────────────────────────────────────────────────── */
  var W = { el: null, body: null, eyes: null, bubble: null, visible: false, leaving: false, anim: null, mode: '', timer: 0 };
  var MAX = 12, KEY = 'hw-watcher-shown', shown = 0;

  function addWatcher() {
    try { shown = Number(sessionStorage.getItem(KEY) || 0); } catch (e) {}
    var el = document.createElement('div');
    el.id = 'hw-watcher';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div id="hw-bubble"></div><div class="hw-body">' + WATCHER_SVG + '</div>';
    document.body.appendChild(el);
    W.el = el; W.body = el.querySelector('.hw-body'); W.eyes = el.querySelector('#hw-eyes'); W.bubble = el.querySelector('#hw-bubble');
    wirePointer();
    if (shown < MAX) schedule(rnd(6000, 12000));
  }

  function schedule(ms) { clearTimeout(W.timer); W.timer = setTimeout(autoPeek, ms); }
  function autoPeek() {
    if (shown >= MAX) return;
    if (document.hidden || W.visible) { schedule(rnd(8000, 15000)); return; }
    peek(reduced ? 'phase' : pick(['rise', 'rise', 'side', 'phase']));
    shown++;
    try { sessionStorage.setItem(KEY, String(shown)); } catch (e) {}
    schedule(rnd(15000, 40000));
  }

  // Where he stands and how he moves in, per mode
  function setup(mode) {
    var el = W.el, mob = isMobile(), side = Math.random() < 0.5 ? 'left' : 'right';
    var navGap = mob ? 64 : 0;
    el.style.left = el.style.right = el.style.top = el.style.bottom = '';
    var k;
    if (mode === 'rise') {
      el.style[side] = '2vw';
      el.style.bottom = navGap + 'px';
      k = [{ transform: 'translateY(105%)', opacity: 1 }, { transform: 'translateY(20%)', opacity: 1 }];
    } else if (mode === 'side') {
      el.style[side] = '0';
      el.style.bottom = (mob ? 22 : 16) + 'vh';
      var dir = side === 'left' ? -1 : 1;
      k = [
        { transform: 'translateX(' + (dir * 110) + '%) rotate(0deg)', opacity: 1 },
        { transform: 'translateX(' + (dir * 30) + '%) rotate(' + (-dir * 14) + 'deg)', opacity: 1 }
      ];
    } else {   // phase: materialises somewhere along the lower part of the screen
      el.style.left = Math.round(rnd(6, 78)) + 'vw';
      el.style.bottom = (navGap + Math.round(rnd(10, 60))) + 'px';
      k = reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'scale(.82)', filter: 'blur(10px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }];
    }
    return k;
  }

  function peek(mode) {
    if (!W.el || W.visible) return;
    W.mode = mode;
    var frames = setup(mode);
    W.visible = true; W.leaving = false;
    W.anim = W.el.animate(frames, { duration: reduced ? 900 : (mode === 'phase' ? 1300 : 1400), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    W.frames = frames;
    var stay = rnd(5500, 8500);
    if (Math.random() < 0.45) setTimeout(function () { if (W.visible && !W.leaving) say(pick(QUIPS), 2200); }, stay * 0.4);
    W.leaveTimer = setTimeout(function () { leave(false); }, stay);
  }

  function leave(spooked) {
    if (!W.visible || W.leaving) return;
    W.leaving = true;
    clearTimeout(W.leaveTimer);
    var from = W.frames[W.frames.length - 1];
    var to;
    if (spooked) {
      to = reduced ? [from, { opacity: 0 }]
        : [from, { opacity: 0, transform: (from.transform || '') + ' translateY(30px) scale(.6)', filter: 'blur(6px)' }];
    } else {
      to = [from, W.frames[0]];
      if (W.mode === 'phase') to = [from, reduced ? { opacity: 0 } : { opacity: 0, transform: 'scale(1.08)', filter: 'blur(12px)' }];
    }
    var a = W.el.animate(to, { duration: spooked ? 380 : 1100, easing: spooked ? 'cubic-bezier(.6,0,.9,.4)' : 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
    a.onfinish = function () {
      W.visible = false; W.leaving = false;
      W.el.style.opacity = '0';
      if (W.anim) { W.anim.cancel(); W.anim = null; }
      a.cancel();
    };
  }

  function say(text, ms) {
    var b = W.bubble; if (!b) return;
    b.textContent = text;
    b.classList.add('on');
    clearTimeout(b._t);
    b._t = setTimeout(function () { b.classList.remove('on'); }, ms || 2000);
  }

  // Eyes follow the pointer; come too close and he is gone
  function wirePointer() {
    var raf = 0, px = 0, py = 0, lastSpook = 0;
    function track() {
      raf = 0;
      if (!W.visible || W.leaving) return;
      var r = W.el.getBoundingClientRect();
      var ex = r.left + r.width / 2, ey = r.top + r.height * 0.32;
      var dx = px - ex, dy = py - ey, d = Math.hypot(dx, dy) || 1;
      if (!reduced) {
        var m = Math.min(4.5, d / 40);
        W.eyes.setAttribute('transform', 'translate(' + (dx / d * m).toFixed(2) + ' ' + (dy / d * m * 0.55).toFixed(2) + ')');
      }
      if (d < Math.max(110, r.width) && Date.now() - lastSpook > 1500) {
        lastSpook = Date.now();
        say(pick(['Boo!', 'Too close...', 'Not yet.']), 900);
        setTimeout(function () { leave(true); }, 320);
      }
    }
    function onMove(e) { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(track); }
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerdown', onMove, { passive: true });
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

  window.SeasonalTheme = {
    name: 'halloween',
    peek: function (mode) { if (W.el) peek(mode || 'rise'); }
  };
})();
