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
    { name: 'Repeg Club', src: 'assets/img/partners/repegclub.webp', url: 'https://repegclub.com/' },
    { name: 'Orbit Wire', src: 'assets/img/partners/orbitwire.webp', url: 'https://orbitwire.io/' }
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

  // ---------- уникальные кошельки ----------
  // Кафель считал сумму participants по раундам, то есть участия: один
  // кошелёк в тридцати раундах давал тридцать. Списка участников в
  // winners.json нет, поэтому уникальных отдаёт воркер - он объединяет
  // адреса из used_nfts (daily и weekly) и circuit_history.
  async function loadWallets() {
    try {
      var r = await fetch(DRAW_WORKER + '/stats/wallets', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      return (typeof d.unique === 'number') ? d : null;
    } catch (e) {
      console.warn('[home] wallets:', e);
      return null;
    }
  }

  // ---------- Circuit ----------
  // Раздел Winners на draw.terraoracle.io подмешивает раунды Circuit в общий
  // список (winners-v3.js), поэтому его "total paid out" больше, чем сумма по
  // winners.json. Здесь тот же источник и та же формула приза, иначе две
  // страницы сайта показывают разные числа.
  // Возвращает null при любой ошибке - остальные кафели от этого не страдают.
  async function loadCircuit() {
    try {
      var r = await fetch(DRAW_WORKER + '/circuit/history?limit=60', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      var closed = (d.rounds || []).filter(function (x) {
        return x && x.status === 'closed' && typeof x.winnerZone === 'number';
      });

      var out = { paid: 0, rounds: closed.length, players: 0, entries: 0 };
      closed.forEach(function (x) {
        // Приз - доля prize из разбивки раунда, в uluna. Так же считает
        // mapCircuitRound в winners-v3.js.
        if (x.split && x.split.prize) out.paid += Math.round(x.split.prize / 1e6);
        out.entries += x.sold || 0;
        var wallets = {};
        (x.blocks || []).forEach(function (b) { wallets[b.wallet] = 1; });
        out.players += Object.keys(wallets).length;
      });
      return out;
    } catch (e) {
      console.warn('[home] circuit:', e);
      return null;
    }
  }

  // ---------- розыгрыши ----------
  async function loadDraws() {
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
      var daily = live(w.daily), weekly = live(w.weekly);

      // Поле приза у daily называется по-разному: ранние записи писали
      // `prize`, поздние `prize_lunc`. Winners на draw.terraoracle.io берёт
      // оба (mapWinnerEntry: `w.prize_lunc || w.prize`), а здесь стоял
      // только второй - старые раунды считались нулём, и сумма на главной
      // выходила меньше, чем в разделе Winners.
      var paid = 0;
      daily.forEach(function (x) { paid += x.prize_lunc || x.prize || 0; });
      weekly.forEach(function (x) {
        (x.winners || []).forEach(function (p) { paid += p.amount_lunc || p.prize_lunc || p.prize || 0; });
      });

      var entries = 0;
      daily.concat(weekly).forEach(function (x) { entries += x.entries || 0; });

      var rounds = daily.length + weekly.length;
      var sub = n(daily.length) + ' daily · ' + n(weekly.length) + ' weekly';
      if (cir) {
        paid    += cir.paid;
        entries += cir.entries;
        rounds  += cir.rounds;
        sub     += ' · ' + n(cir.rounds) + ' circuit';
      }

      // Прочерк честнее суммы участий: подпись обещает кошельки.
      txt('stPlayers', wal ? n(wal.unique) : '-');
      txt('stPlayersSub', n(entries) + ' entries total');

      set('stPaid', compact(paid) + '<small>LUNC</small>');
      txt('stPaidSub', 'paid out to winners');

      txt('stRounds', n(rounds));
      txt('stRoundsSub', sub);
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
    box.innerHTML = '<ul>' + PARTNERS.map(function (p) {
      var inner = (p.src
        ? '<img src="' + p.src + '" alt="' + p.name + '" loading="lazy" onerror="this.remove()">'
        : '') + '<span class="txt">' + p.name + '</span>';
      return '<li>' + (p.url
        ? '<a href="' + p.url + '" target="_blank" rel="noopener">' + inner + '</a>'
        : inner) + '</li>';
    }).join('') + '</ul>';
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
