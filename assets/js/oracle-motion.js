/* oracle-motion.js - единый слой движения для всего сайта.
 *
 * Ничего в разметке разделов не меняет и ни от чего не зависит: если файл
 * не загрузился, сайт выглядит как раньше. Анимируются только transform и
 * opacity (дёшево для видеокарты), классы снимаются по окончании, чтобы не
 * мешать собственным hover-эффектам карточек.
 *
 * 1. Переход между разделами: новый раздел проявляется, его блоки входят
 *    по очереди.
 * 2. Появление при прокрутке: карточки, которые рисуются позже (рынки,
 *    вопросы, голосования), тоже входят мягко, пачками с задержкой.
 * 3. Счётчики: числа в статистике не прыгают, а докручиваются.
 * 4. Праздник: короткий салют из частиц на подтверждённый прогноз, новый
 *    рынок или выплату (window.oracleCelebrate).
 *
 * Системная настройка "уменьшить движение" выключает всё, кроме смены
 * чисел без анимации.
 */
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (REDUCED) { window.oracleCelebrate = function () {}; return; }

  document.documentElement.classList.add('motion-on');

  // ── 1. переход между разделами ─────────────────────────────────────────────

  // У раздела с чатом и у разделов с фиксированными окнами внутри transform
  // на предке сломал бы position:fixed, поэтому там только прозрачность.
  var FADE_ONLY = { chat: true };

  var lastEnter = 0;
  function enterPage(name) {
    var pg = document.getElementById('page-' + name);
    if (!pg) return;
    lastEnter = performance.now();
    pg.classList.remove('pg-enter', 'pg-fade');
    void pg.offsetWidth;                       // перезапуск анимации
    pg.classList.add(FADE_ONLY[name] ? 'pg-fade' : 'pg-enter');
    var kids = pg.children, n = 0;
    for (var i = 0; i < kids.length && n < 10; i++) {
      var k = kids[i];
      if (k.offsetParent === null && getComputedStyle(k).position !== 'fixed') continue;
      if (FADE_ONLY[name]) continue;
      k.style.setProperty('--st', (60 + n * 55) + 'ms');
      k.classList.add('pg-kid');
      n++;
    }
    var clear = function () {
      pg.classList.remove('pg-enter', 'pg-fade');
      for (var j = 0; j < kids.length; j++) kids[j].classList.remove('pg-kid');
    };
    setTimeout(clear, 1100);
    scan(pg);
  }

  function wrapShowPage() {
    if (typeof window.showPage !== 'function' || window.showPage._motion) return;
    var orig = window.showPage;
    var wrapped = function (name) {
      var r = orig.apply(this, arguments);
      try { enterPage(name); } catch (e) { /* движение не должно ломать навигацию */ }
      return r;
    };
    wrapped._motion = true;
    window.showPage = wrapped;
  }

  // ── 2. появление при прокрутке ─────────────────────────────────────────────

  var REVEAL = [
    '.mod', '.stat', '.card', '.q-card', '.vote-card', '.stat-card',
    '.mkc', '.hmark', '.hm-card', '.oracle-box', '.answer-item',
  ].join(',');

  var queue = [], flushPending = false;
  function flush() {
    flushPending = false;
    queue.sort(function (a, b) {
      return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });
    queue.forEach(function (el, i) {
      el.style.setProperty('--rd', Math.min(i, 8) * 60 + 'ms');
      el.classList.add('rv-in');
    });
    queue = [];
  }

  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      queue.push(e.target);
    });
    if (queue.length && !flushPending) { flushPending = true; requestAnimationFrame(flush); }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 }) : null;

  // Формы и списки, которые перерисовываются при каждом клике или
  // обновлении, не анимируются заново: иначе карточки мигали бы на глазах.
  var SKIP = '#mk-create-host, .no-motion, [data-no-motion]';

  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && (r.width || r.height);
  }

  function arm(el) {
    if (!io || el._rv || el.closest(SKIP)) return;
    // Через полторы секунды после входа в раздел новый блок, появившийся
    // прямо на экране, - это перерисовка, а не появление: не трогаем.
    // Ниже экрана - по-прежнему входит при прокрутке.
    if (performance.now() - lastEnter > 1500 && inView(el)) { el._rv = true; return; }
    el._rv = true;
    el.classList.add('rv');
    io.observe(el);
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(REVEAL)) arm(root);
    root.querySelectorAll(REVEAL).forEach(arm);
  }

  document.addEventListener('animationend', function (e) {
    var el = e.target;
    if (e.animationName === 'rvIn') { el.classList.remove('rv', 'rv-in'); el.style.removeProperty('--rd'); }
  }, true);

  // ── 3. счётчики ────────────────────────────────────────────────────────────

  var COUNT = '.stat .num, #mk-stat-open, #mk-stat-vol, #mk-stat-settled, #mk-stat-players, .stat-value, .chart-main-val, #repVal';
  var NUM_RE = /^(\D{0,3}?)([\d][\d,]*(?:\.\d+)?)(.*)$/;

  function tween(el, from, to, prefix, suffix, decimals) {
    var t0 = performance.now(), dur = 900;
    el._tw = true;
    function step(t) {
      var p = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      var v = from + (to - from) * e;
      el.textContent = prefix + v.toLocaleString('en-US', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
      if (p < 1) requestAnimationFrame(step);
      else { el._tw = false; el._last = to; }
    }
    requestAnimationFrame(step);
  }

  function countFrom(el) {
    if (el._tw) return;
    var m = NUM_RE.exec((el.textContent || '').trim());
    if (!m) return;
    var digits = m[2], to = Number(digits.replace(/,/g, ''));
    if (!isFinite(to)) return;
    var dec = digits.indexOf('.') >= 0 ? digits.split('.')[1].length : 0;
    var from = typeof el._last === 'number' ? el._last : 0;
    if (from === to) return;
    // Без разделителей в исходной строке (например, номер блока) не
    // добавляем их и при анимации.
    if (digits.indexOf(',') < 0 && to >= 1000) { el._last = to; return; }
    tween(el, from, to, m[1], m[3], dec);
  }

  function armCount(el) {
    if (el._cnt) return;
    el._cnt = true;
    var seen = false;
    var obs = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
      if (es[0].isIntersecting && !seen) { seen = true; obs.disconnect(); countFrom(el); }
    }) : null;
    if (obs) obs.observe(el); else countFrom(el);
    new MutationObserver(function () { if (seen && !el._tw) countFrom(el); })
      .observe(el, { childList: true, characterData: true, subtree: true });
  }

  function scanCount(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(COUNT)) armCount(root);
    root.querySelectorAll(COUNT).forEach(armCount);
  }

  // ── 4. праздник ────────────────────────────────────────────────────────────

  var COLORS = ['#7B5CFF', '#A855F7', '#C8B8FF', '#00FFB0', '#E8C840', '#00D4FF'];
  window.oracleCelebrate = function (x, y) {
    var cv = document.createElement('canvas');
    cv.className = 'motion-burst';
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    var ox = x == null ? innerWidth / 2 : x, oy = y == null ? innerHeight * 0.38 : y;
    var parts = [];
    for (var i = 0; i < 90; i++) {
      var a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 7;
      parts.push({ x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3,
        r: 2 + Math.random() * 3.5, c: COLORS[i % COLORS.length], life: 0, max: 55 + Math.random() * 35,
        sq: Math.random() < 0.4, rot: Math.random() * 6 });
    }
    var frame = 0;
    (function draw() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      var alive = 0;
      parts.forEach(function (p) {
        if (p.life > p.max) return;
        alive++;
        p.life++; p.x += p.vx; p.y += p.vy; p.vx *= 0.97; p.vy = p.vy * 0.97 + 0.18; p.rot += 0.2;
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
        ctx.fillStyle = p.c;
        ctx.shadowColor = p.c; ctx.shadowBlur = 8;
        if (p.sq) {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
        } else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      });
      if (alive && ++frame < 200) requestAnimationFrame(draw); else cv.remove();
    })();
  };


  // ── 5. этап 2: скользящая подсветка меню ───────────────────────────────────
  //
  // Одна подсветка на всё левое меню переезжает к активному пункту, а не
  // гаснет в одном месте и зажигается в другом.

  function navGlide() {
    var rail = document.querySelector('.rail');
    if (!rail || !rail.querySelector('.nav')) return;
    if (getComputedStyle(rail).position === 'static') rail.style.position = 'relative';
    var glide = document.createElement('span');
    glide.className = 'nav-glide';
    glide.setAttribute('aria-hidden', 'true');
    rail.appendChild(glide);
    document.documentElement.classList.add('nav-glide-on');
    var first = true;
    function place() {
      var a = rail.querySelector('.nav[aria-current="page"]');
      if (!a || !a.offsetParent) { glide.style.opacity = '0'; return; }
      var r = a.getBoundingClientRect(), rr = rail.getBoundingClientRect();
      var top = r.top - rr.top + rail.scrollTop, left = r.left - rr.left + rail.scrollLeft;
      if (first) glide.style.transition = 'none';
      glide.style.transform = 'translate(' + left + 'px,' + top + 'px)';
      glide.style.width = r.width + 'px';
      glide.style.height = r.height + 'px';
      glide.style.opacity = '1';
      if (first) { void glide.offsetWidth; glide.style.transition = ''; first = false; }
    }
    new MutationObserver(place).observe(rail, { attributes: true, subtree: true, attributeFilter: ['aria-current'] });
    window.addEventListener('resize', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    place();
  }

  // ── 6. скелетоны ───────────────────────────────────────────────────────────
  //
  // Пока число ещё не пришло ("-", "--"), на его месте мерцает плашка, а не
  // висит одинокий прочерк.

  var SKEL = '.stat .num, .clock b, [data-pool], #repVal, #mk-stat-open, #mk-stat-vol, #mk-stat-settled, #mk-stat-players';
  var EMPTY = /^(-|--|\u2014|\u2013|)$/;
  function skel(el) {
    if (el._sk) return;
    el._sk = true;
    var check = function () { el.classList.toggle('sk', EMPTY.test((el.textContent || '').trim()) && !el._skDone); };
    check();
    new MutationObserver(function () {
      if (!EMPTY.test((el.textContent || '').trim())) el._skDone = true;
      check();
    }).observe(el, { childList: true, characterData: true, subtree: true });
    // Если данные так и не пришли (узел недоступен), через 8 секунд плашка
    // уступает место прочерку: бесконечное мерцание хуже честного "нет данных".
    setTimeout(function () { el._skDone = true; el.classList.remove('sk'); }, 8000);
  }
  function scanSkel(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(SKEL)) skel(root);
    root.querySelectorAll(SKEL).forEach(skel);
  }

  // ── 7. наклон карточек модулей за курсором ─────────────────────────────────

  var FINE = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  function tilt(card) {
    if (!FINE || card._tilt) return;
    card._tilt = true;
    var glare = document.createElement('span');
    glare.className = 'tilt-glare';
    glare.setAttribute('aria-hidden', 'true');
    card.appendChild(glare);
    var raf = 0;
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        card.style.transform = 'perspective(900px) rotateX(' + (-y * 7).toFixed(2) + 'deg) rotateY(' + (x * 9).toFixed(2) + 'deg) translateY(-4px)';
        card.style.setProperty('--gx', ((x + 0.5) * 100).toFixed(1) + '%');
        card.style.setProperty('--gy', ((y + 0.5) * 100).toFixed(1) + '%');
      });
    });
    card.addEventListener('pointerleave', function () {
      cancelAnimationFrame(raf);
      card.style.transform = '';
    });
  }
  function scanTilt(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.mod').forEach(tilt);
  }

  // ── 8. смена цифр таймера ──────────────────────────────────────────────────

  function tick(el) {
    if (el._tick) return;
    el._tick = true;
    var last = el.textContent;
    new MutationObserver(function () {
      if (el.textContent === last) return;
      last = el.textContent;
      el.classList.remove('tick');
      void el.offsetWidth;
      el.classList.add('tick');
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }

  // ── запуск ─────────────────────────────────────────────────────────────────

  function start() {
    wrapShowPage();
    var active = document.querySelector('.page.active');
    if (active) enterPage(active.id.replace(/^page-/, ''));
    scan(document.body);
    scanCount(document.body);
    scanSkel(document.body);
    scanTilt(document.body);
    document.querySelectorAll('.clock b').forEach(tick);
    try { navGlide(); } catch (e) { /* меню без подсветки - не беда */ }
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          scan(n);
          scanCount(n);
          scanSkel(n);
          scanTilt(n);
          if (n.querySelectorAll) n.querySelectorAll('.clock b').forEach(tick);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 0); });
  else setTimeout(start, 0);
})();
