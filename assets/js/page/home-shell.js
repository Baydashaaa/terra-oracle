// Главная страница: реальные данные вместо заглушки DATA из прототипа.
// Шаг 4 переноса дизайна.
//
// Источники:
//   winners.json                  - результаты розыгрышей (выплаты, участники, раунды)
//   oracle-draw worker /treasury-history - текущий TVL казны и дельта за окно
// Партнёры пока списком в коде: отдельного источника под них нет.
(function () {
  'use strict';

  var DRAW_WORKER = 'https://oracle-draw.vladislav-baydan.workers.dev';

  var PARTNERS = [
    { name: 'Terraport',     src: 'assets/img/partners/terraport.webp' },
    { name: 'Terra Classic', src: 'assets/img/partners/terraclassic.webp' },
    { name: 'Terra Finder',  src: '' },
    { name: 'Repeg Club',    src: '' },
    { name: 'Garuda',        src: '' },
    { name: 'TerraCVita',    src: '' }
  ];

  function n(x) { return Number(x || 0).toLocaleString('en-US'); }

  // 7 004 865 -> "7.00M". Единица возвращается отдельно, разметка
  // кладёт её в <small>.
  function compact(x) {
    x = Number(x || 0);
    if (x >= 1e9) return (x / 1e9).toFixed(2) + 'B';
    if (x >= 1e6) return (x / 1e6).toFixed(2) + 'M';
    if (x >= 1e3) return (x / 1e3).toFixed(1) + 'K';
    return String(Math.round(x));
  }

  function set(id, html) { var e = document.getElementById(id); if (e) e.innerHTML = html; }
  function txt(id, s)    { var e = document.getElementById(id); if (e) e.textContent = s; }

  // ---------- казна ----------
  async function loadTvl() {
    try {
      var r = await fetch(DRAW_WORKER + '/treasury-history', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      var lunc = (d.current && d.current.uluna || 0) / 1e6;
      set('stTvl', compact(lunc) + '<small>LUNC</small>');

      if (d.deltaUluna != null) {
        var dl = d.deltaUluna / 1e6;
        var hrs = d.deltaHours ? Math.round(d.deltaHours) + 'h' : 'window';
        txt('stTvlSub', (dl >= 0 ? '+' : '-') + compact(Math.abs(dl)) + ' per ' + hrs);
      } else {
        txt('stTvlSub', 'live on-chain');
      }
    } catch (e) {
      txt('stTvl', '-');
      txt('stTvlSub', 'treasury unavailable');
      console.warn('[home] TVL:', e);
    }
  }

  // ---------- розыгрыши ----------
  async function loadDraws() {
    try {
      var r = await fetch('draw-app/winners.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var w = await r.json();

      var live = function (a) { return (a || []).filter(function (x) { return !x.skipped; }); };
      var daily = live(w.daily), weekly = live(w.weekly);

      var paid = 0;
      daily.forEach(function (x) { paid += x.prize_lunc || 0; });
      weekly.forEach(function (x) {
        (x.winners || []).forEach(function (p) { paid += p.amount_lunc || p.prize_lunc || 0; });
      });

      var entries = 0, players = 0;
      daily.concat(weekly).forEach(function (x) {
        entries += x.entries || 0;
        players += x.participants || 0;
      });

      txt('stPlayers', n(players));
      txt('stPlayersSub', n(entries) + ' entries total');

      set('stPaid', compact(paid) + '<small>LUNC</small>');
      txt('stPaidSub', 'paid out to winners');

      txt('stRounds', n(daily.length + weekly.length));
      txt('stRoundsSub', n(daily.length) + ' daily · ' + n(weekly.length) + ' weekly');
    } catch (e) {
      ['stPlayers', 'stPaid', 'stRounds'].forEach(function (id) { txt(id, '-'); });
      ['stPlayersSub', 'stPaidSub', 'stRoundsSub'].forEach(function (id) { txt(id, 'draw data unavailable'); });
      console.warn('[home] draws:', e);
    }
  }

  // ---------- партнёры ----------
  function paintMarquee() {
    var box = document.getElementById('marquee');
    if (!box) return;
    var one = '<ul>' + PARTNERS.map(function (p) {
      return '<li>' + (p.src
        ? '<img src="' + p.src + '" alt="' + p.name + '" loading="lazy" ' +
          'onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),' +
          '{className:\'txt\',textContent:\'' + p.name + '\'}))">'
        : '<span class="txt">' + p.name + '</span>') + '</li>';
    }).join('') + '</ul>';
    box.innerHTML = one + one;   // две копии, чтобы у бегущей строки не было шва
  }

  function start() {
    if (!document.getElementById('stTvl')) return;
    paintMarquee();
    loadTvl();
    loadDraws();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
