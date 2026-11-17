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
        return '<li data-profile="' + x.w + '"' + (x.w === mine ? ' class="me"' : '') + '>' +
          (i < 3 ? medal(i) : '<span class="pos">' + (i + 1) + '</span>') +
          '<span class="nm">' + short(x.w) + '</span>' +
          '<span class="sc">' + x.s.toLocaleString('en-US') + '</span></li>';
      }).join('');
    } catch (e) {
      box.innerHTML = '<li class="lb-empty">Leaderboard unavailable</li>';
      console.warn('[side-leaderboard]', (e && (e.message || e.name)) || e);
    }
  }

  // Top three get a struck medal: ribbon, milled edge, laurel and the place
  // number, in gold, silver and bronze. Drawn once per row, no images.
  var MEDAL = [
    { a: '#fff4c2', b: '#f5c542', c: '#b07a0c', d: '#6b4500', r1: '#7c5cff', r2: '#4c2fd1', t: '#5a3b00' },
    { a: '#ffffff', b: '#d5dbe6', c: '#8f9bb0', d: '#4e586b', r1: '#22d3ee', r2: '#0e7490', t: '#2b3445' },
    { a: '#ffe2c7', b: '#e59a5c', c: '#9b5a2a', d: '#5c2f10', r1: '#f472b6', r2: '#9d174d', t: '#4a2208' },
  ];
  function medal(i) {
    var m = MEDAL[i], id = 'md' + i;
    return '<span class="pos medal m' + (i + 1) + '" aria-label="Place ' + (i + 1) + '">' +
      '<svg viewBox="0 0 32 36" width="30" height="34" aria-hidden="true"><defs>' +
      '<radialGradient id="' + id + 'f" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="' + m.a + '"/><stop offset=".45" stop-color="' + m.b + '"/><stop offset="1" stop-color="' + m.c + '"/></radialGradient>' +
      '<linearGradient id="' + id + 'e" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + m.b + '"/><stop offset="1" stop-color="' + m.d + '"/></linearGradient>' +
      '<linearGradient id="' + id + 'r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + m.r1 + '"/><stop offset="1" stop-color="' + m.r2 + '"/></linearGradient></defs>' +
      // ribbon tails behind the coin
      '<path d="M9 22 L5 35 L10 32 L13 35 L15 24 Z" fill="url(#' + id + 'r)"/><path d="M23 22 L27 35 L22 32 L19 35 L17 24 Z" fill="url(#' + id + 'r)"/>' +
      // milled edge, face, inner ring
      '<circle cx="16" cy="14.5" r="12.5" fill="url(#' + id + 'e)"/>' +
      '<circle cx="16" cy="14.5" r="12.5" fill="none" stroke="' + m.d + '" stroke-opacity=".55" stroke-width="1.6" stroke-dasharray="1.1 1.1"/>' +
      '<circle cx="16" cy="14.5" r="10" fill="url(#' + id + 'f)"/>' +
      '<circle cx="16" cy="14.5" r="8.4" fill="none" stroke="' + m.d + '" stroke-opacity=".35" stroke-width=".7"/>' +
      // laurel
      '<path d="M10.2 17.5c-1.3-2.4-1-5.2.6-7.2M21.8 17.5c1.3-2.4 1-5.2-.6-7.2" fill="none" stroke="' + m.d + '" stroke-opacity=".55" stroke-width=".9" stroke-linecap="round"/>' +
      '<text x="16" y="18.4" text-anchor="middle" font-size="10" font-weight="800" font-family="system-ui,sans-serif" fill="' + m.t + '">' + (i + 1) + '</text>' +
      '<ellipse cx="12.6" cy="9.6" rx="3.6" ry="1.6" fill="#fff" opacity=".45" transform="rotate(-28 12.6 9.6)"/>' +
      '</svg></span>';
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
