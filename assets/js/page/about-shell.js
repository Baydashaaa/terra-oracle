// About Protocol: живые цифры в блоке Ecosystem at a glance.
// Источники те же, что у главной - winners.json плюс накопитель Circuit
// в воркере для розыгрышей и воркер вопросов для доски.
//
// До 20 сентября 2026 здесь складывались только daily и weekly, а главная
// подмешивала ещё и Circuit - отсюда 19 раундов против 44 и 7.00M против
// 7.60M на двух страницах одного сайта. Формулы ниже повторяют home-shell.js
// дословно: если менять, то в обоих файлах сразу.
(function () {
  'use strict';

  var DRAW_WORKER = 'https://oracle-draw.vladislav-baydan.workers.dev';

  function n(x) { return Number(x || 0).toLocaleString('en-US'); }
  function compact(x) {
    x = Number(x || 0);
    if (x >= 1e9) return (x / 1e9).toFixed(2) + 'B';
    if (x >= 1e6) return (x / 1e6).toFixed(2) + 'M';
    if (x >= 1e3) return (x / 1e3).toFixed(1) + 'K';
    return String(Math.round(x));
  }
  function set(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }

  // ---------- Circuit ----------
  // Основной источник - накопитель /circuit/totals, он не зависит от
  // глубины истории. История - запасной путь, если накопитель пуст.
  async function loadCircuit() {
    try {
      var r = await fetch(DRAW_WORKER + '/circuit/totals', { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        var t = await r.json();
        if (!t.empty && (t.rounds || t.paidLunc)) {
          return { paid: t.paidLunc || 0, rounds: t.rounds || 0 };
        }
      }
    } catch (e) {
      console.warn('[about] circuit totals:', e);
    }
    return loadCircuitFromHistory();
  }

  async function loadCircuitFromHistory() {
    try {
      var r = await fetch(DRAW_WORKER + '/circuit/history?limit=60', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      var closed = (d.rounds || []).filter(function (x) {
        return x && x.status === 'closed' && typeof x.winnerZone === 'number';
      });
      var out = { paid: 0, rounds: closed.length };
      closed.forEach(function (x) {
        // Приз - доля prize из разбивки раунда, в uluna. Та же формула,
        // что в mapCircuitRound (winners-v3.js) и в home-shell.js.
        if (x.split && x.split.prize) out.paid += Math.round(x.split.prize / 1e6);
      });
      return out;
    } catch (e) {
      console.warn('[about] circuit:', e);
      return null;
    }
  }

  // ---------- уникальные кошельки ----------
  // Сумма participants по раундам - это УЧАСТИЯ: один кошелёк в тридцати
  // раундах давал тридцать. Уникальных отдаёт воркер, как на главной.
  async function loadWallets() {
    try {
      var r = await fetch(DRAW_WORKER + '/stats/wallets', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      return (typeof d.unique === 'number') ? d : null;
    } catch (e) {
      console.warn('[about] wallets:', e);
      return null;
    }
  }

  async function draws() {
    var cir = await loadCircuit();
    var wal = await loadWallets();
    try {
      // Данные живут в репо oracle-draw, копии в draw-app/ больше нет -
      // см. draw-app/assets/js/data-origin.js. Внешний сайт никогда не
      // на draw-домене, поэтому адрес просто абсолютный.
      var r = await fetch('https://draw.terraoracle.io/winners.json', { cache: 'no-cache' });
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

      if (cir) {
        paid += cir.paid || 0;
      }
      var rounds = d.length + k.length + ((cir && cir.rounds) || 0);

      // Уникальные кошельки, если воркер ответил; иначе прежний счёт
      // участий - он завышен, но лучше пустой клетки.
      set('ab-players', n(wal ? wal.unique : players));
      set('ab-paid', compact(paid));
      set('ab-rounds', n(rounds));
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
