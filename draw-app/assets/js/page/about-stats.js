// Третье число на странице About: сколько всего выплачено игрокам.
//
// Два других (#home-stat-draws, #home-stat-nfts) уже заполняют config.js,
// data.js и pool-timer.js - их не трогаем. Здесь только выплаты, и считаются
// они из тех же двух источников, что и кафель Total paid на главной
// terraoracle.io: winners.json (daily + weekly) и накопитель воркера
// /circuit/totals (раунды Circuit).
//
// Адрес данных берётся у data-origin.js: внутри рамки на terraoracle.io
// относительный путь упёрся бы в пустую копию.
(function () {
  'use strict';

  var WORKER = (typeof DRAW_WORKER !== 'undefined' && DRAW_WORKER)
    ? DRAW_WORKER
    : 'https://oracle-draw.vladislav-baydan.workers.dev';

  function compact(x) {
    x = Number(x || 0);
    if (x >= 1e9) return (x / 1e9).toFixed(2) + 'B';
    if (x >= 1e6) return (x / 1e6).toFixed(2) + 'M';
    if (x >= 1e3) return (x / 1e3).toFixed(1) + 'K';
    return String(Math.round(x));
  }

  async function drawsPaid() {
    var url = (typeof window.drawDataUrl === 'function')
      ? window.drawDataUrl('winners.json')
      : 'https://draw.terraoracle.io/winners.json';
    var r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var w = await r.json();
    var live = function (a) { return (a || []).filter(function (x) { return !x.skipped; }); };
    var paid = 0;
    live(w.daily).forEach(function (x) { paid += x.prize_lunc || x.prize || 0; });
    live(w.weekly).forEach(function (x) {
      (x.winners || []).forEach(function (p) { paid += p.amount_lunc || p.prize_lunc || 0; });
    });
    return paid;
  }

  async function circuitPaid() {
    try {
      var r = await fetch(WORKER + '/circuit/totals', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return 0;
      var t = await r.json();
      return t && !t.empty ? (t.paidLunc || 0) : 0;
    } catch (e) {
      // Circuit недоступен - показываем сумму по розыгрышам, а не прочерк.
      console.warn('[about] circuit totals:', e);
      return 0;
    }
  }

  async function start() {
    var el = document.getElementById('home-stat-paid');
    if (!el) return;
    try {
      var both = await Promise.all([drawsPaid(), circuitPaid()]);
      el.textContent = compact(both[0] + both[1]);
    } catch (e) {
      el.textContent = '-';
      console.warn('[about] paid:', e);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
