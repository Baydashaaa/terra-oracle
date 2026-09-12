// About Protocol: живые цифры в блоке Ecosystem at a glance.
// Источники те же, что у главной - winners.json для розыгрышей и
// воркер вопросов для доски. Второго расчёта нет.
(function () {
  'use strict';

  function n(x) { return Number(x || 0).toLocaleString('en-US'); }
  function compact(x) {
    x = Number(x || 0);
    if (x >= 1e9) return (x / 1e9).toFixed(2) + 'B';
    if (x >= 1e6) return (x / 1e6).toFixed(2) + 'M';
    if (x >= 1e3) return (x / 1e3).toFixed(1) + 'K';
    return String(Math.round(x));
  }
  function set(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }

  async function draws() {
    try {
      var r = await fetch('draw-app/winners.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var w = await r.json();
      var live = function (a) { return (a || []).filter(function (x) { return !x.skipped; }); };
      var d = live(w.daily), k = live(w.weekly);

      var paid = 0, players = 0;
      d.forEach(function (x) { paid += x.prize_lunc || 0; players += x.participants || 0; });
      k.forEach(function (x) {
        players += x.participants || 0;
        (x.winners || []).forEach(function (p) { paid += p.amount_lunc || p.prize_lunc || 0; });
      });

      set('ab-players', n(players));
      set('ab-paid', compact(paid));
      set('ab-rounds', n(d.length + k.length));
    } catch (e) {
      console.warn('[about] draws:', e);
    }
  }

  async function questions() {
    try {
      var W = (typeof window.WORKER_URL !== 'undefined' && window.WORKER_URL)
        || 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
      var r = await fetch(W + '/questions', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      set('ab-questions', n((d.questions || []).length));
    } catch (e) {
      console.warn('[about] questions:', e);
    }
  }

  // ---------- петля участия ----------
  // Шаги листаются сами, но клик по любому останавливает автопрокрутку:
  // если человек выбрал шаг руками, увозить его дальше нельзя.
  function loop() {
    var rows = [].slice.call(document.querySelectorAll('.lp-row'));
    var arc = document.getElementById('lpArc');
    var num = document.getElementById('lpNum');
    if (!rows.length || !arc) return;

    var dial = document.getElementById('lpDial');
    var name = document.getElementById('lpName');
    var i = 0;
    var FULL = 465;   // длина окружности r=74, см. about.css

    function show(k) {
      i = k;
      rows.forEach(function (r, n) { r.classList.toggle('on', n === k); });
      arc.style.strokeDashoffset = String(FULL - FULL * (k + 1) / rows.length);
      if (num) num.textContent = '0' + (k + 1);
      if (name) name.textContent = rows[k].dataset.name || '';
      // Цвет циферблата берём у активного шага: дуга, риски, номер и
      // свечение красятся одной переменной.
      if (dial) dial.style.setProperty('--c', rows[k].style.getPropertyValue('--c'));
    }

    rows.forEach(function (r, n) {
      // autoplay removed: shagi listayutsya tolko rukami - avtoprokrutka
      // uvodila vzglyad s togo shaga, kotoryy chelovek chital.
      r.addEventListener('click', function () { show(n); });
    });

    show(0);
  }

  function start() {
    if (!document.getElementById('ab-paid')) return;
    draws();
    questions();
    loop();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
