// Правая колонка: карточка Leaderboard.
// Показывает пятёрку по пожизненному REP - то же, что вкладка All Time
// в разделе Reputation. Источник тот же, /rep/scores, поэтому второго
// расчёта здесь нет и расхождений с разделом быть не может.
(function () {
  'use strict';

  function worker() {
    return (typeof window.WORKER_URL !== 'undefined' && window.WORKER_URL)
      || 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
  }

  function short(a) {
    return a && a.length > 14 ? a.slice(0, 8) + '\u2026' + a.slice(-4) : (a || '');
  }

  async function load() {
    var box = document.getElementById('lbList');
    if (!box) return;

    try {
      var r = await fetch(worker() + '/rep/scores', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      var map = d.onchain || {};

      var top = Object.keys(map)
        .map(function (w) { return { w: w, s: Number(map[w]) || 0 }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 5);

      if (!top.length) {
        box.innerHTML = '<li class="lb-empty">No contributors yet</li>';
        return;
      }

      var mine = (typeof globalWalletAddress !== 'undefined' && globalWalletAddress) || '';
      box.innerHTML = top.map(function (x, i) {
        return '<li' + (x.w === mine ? ' class="me"' : '') + '>' +
          '<span class="pos">' + (i + 1) + '</span>' +
          '<span class="nm">' + short(x.w) + '</span>' +
          '<span class="sc">' + x.s.toLocaleString('en-US') + '</span></li>';
      }).join('');
    } catch (e) {
      box.innerHTML = '<li class="lb-empty">Leaderboard unavailable</li>';
      console.warn('[side-leaderboard]', (e && (e.message || e.name)) || e);
    }
  }

  function wireButton() {
    var box = document.getElementById('lbList');
    if (!box) return;
    var card = box.closest('.card');
    var btn = card && card.querySelector('button.wide');
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', function () {
        if (typeof showRepPage === 'function') showRepPage('leaderboard');
      });
    }
  }

  function start() {
    wireButton();
    load();
    // Счёт меняется от активности, но не ежесекундно - раз в пять минут хватает.
    setInterval(load, 300000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
