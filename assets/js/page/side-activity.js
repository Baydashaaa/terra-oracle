// Лента "Recent activity" в правой колонке.
//
// Общая, а не личная: показывает, что происходит в экосистеме, поэтому
// работает и без подключённого кошелька.
//
// В ленту попадают только события, у которых в данных ЕСТЬ ВРЕМЯ:
//   вопросы      /questions          createdAt, секунды
//   ответы       внутри вопросов     createdAt, секунды
//   зоны Circuit /circuit/history    blocks[].at, миллисекунды
//   розыгрыши    winners.json        date раунда
// У открытого раунда Circuit (/circuit/state) времени у блоков нет, и
// текущие захваты сюда не попадают - иначе пришлось бы писать "только
// что" всему, что мы не умеем датировать.
//
// Минты в ленту не идут: ручки со временем отдельного минта нет,
// /round-stats отдаёт лишь суммы по кошелькам. Markets стоят SOON.
(function () {
  'use strict';

  var Q_WORKER    = 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
  var DRAW_WORKER = 'https://oracle-draw.vladislav-baydan.workers.dev';
  var DATA_ORIGIN = 'https://draw.terraoracle.io';

  var LIMIT   = 6;            // строк в карточке
  var EVERY   = 5 * 60 * 1000; // как часто обновлять
  var ICONS   = 'assets/img/icons/';

  function el() { return document.getElementById('actList'); }

  function getJSON(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function lunc(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(Math.round(n));
  }

  // Время события всегда храним в секундах.
  function ago(sec) {
    var d = Math.floor(Date.now() / 1000) - sec;
    if (d < 60)     return 'just now';
    if (d < 3600)   return Math.floor(d / 60) + ' min ago';
    if (d < 86400)  { var h = Math.floor(d / 3600); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
    var days = Math.floor(d / 86400);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ─── сбор событий ────────────────────────────────────────────

  function fromQuestions(d) {
    var out = [];
    var qs = (d && d.questions) || [];
    qs.forEach(function (q) {
      if (q.createdAt) {
        out.push({
          ts:   q.createdAt,
          ic:   'p-questions.webp',
          text: 'Question asked',
          amt:  q.paymentAmount ? lunc(q.paymentAmount) + ' LUNC' : '',
          tone: 'var(--ink-2)'
        });
      }
      (q.answers || []).forEach(function (a) {
        if (!a.createdAt) return;
        var accepted = q.chosenAnswerId && q.chosenAnswerId === a.id;
        out.push({
          ts:   a.createdAt,
          ic:   accepted ? 'p-top.webp' : 'p-answers.webp',
          text: accepted ? 'Answer accepted' : 'Answer posted',
          amt:  accepted ? 'accepted' : (a.votes ? '\u2191' + a.votes : ''),
          tone: accepted ? 'var(--green)' : 'var(--ink-3)'
        });
      });
    });
    return out;
  }

  function fromCircuit(d) {
    var out = [];
    ((d && d.rounds) || []).forEach(function (r) {
      (r.blocks || []).forEach(function (b) {
        if (!b.at) return;                       // без времени не берём
        var zones = (Number(b.to) - Number(b.from) + 1) || 1;
        out.push({
          ts:   Math.floor(b.at / 1000),         // здесь миллисекунды
          ic:   'circuit.webp',
          text: zones === 1 ? 'Circuit zone claimed' : 'Circuit zones claimed \u00d7' + zones,
          amt:  b.paid ? lunc(b.paid / 1e6) + ' LUNC' : '',
          tone: 'var(--amber)'
        });
      });
    });
    return out;
  }

  function fromWinners(d) {
    var out = [];
    ['daily', 'weekly'].forEach(function (pool) {
      ((d && d[pool]) || []).forEach(function (w) {
        if (w.skipped || !w.date) return;
        // В winners.json есть только дата раунда. Розыгрыш идёт в 20:00
        // UTC - берём этот час, иначе событие уехало бы на полсуток.
        var ts = Math.floor(Date.parse(w.date + 'T20:00:00Z') / 1000);
        if (!isFinite(ts)) return;
        out.push({
          ts:   ts,
          ic:   pool === 'weekly' ? 'n-weekly.webp' : 'n-daily.webp',
          text: (pool === 'weekly' ? 'Weekly' : 'Daily') + ' draw settled',
          amt:  w.prize_lunc ? lunc(w.prize_lunc) + ' LUNC' : '',
          tone: 'var(--cyan)'
        });
      });
    });
    return out;
  }

  // ─── отрисовка ───────────────────────────────────────────────

  function render(items) {
    var box = el();
    if (!box) return;

    if (!items.length) {
      box.innerHTML = '<li><span class="tx"><b>No activity yet</b>' +
                      '<span>events will appear here</span></span></li>';
      return;
    }

    box.innerHTML = items.map(function (a) {
      return '<li>' +
        '<img class="ico" src="' + ICONS + a.ic + '" alt="" width="96" height="96" loading="lazy">' +
        '<span class="tx"><b>' + esc(a.text) + '</b><span>' + ago(a.ts) + '</span></span>' +
        '<span class="amt" style="color:' + a.tone + '">' + esc(a.amt) + '</span></li>';
    }).join('');
  }

  function load() {
    if (!el()) return;
    Promise.all([
      getJSON(Q_WORKER + '/questions?limit=12'),
      getJSON(DRAW_WORKER + '/circuit/history?limit=6'),
      getJSON(DATA_ORIGIN + '/winners.json?t=' + Math.floor(Date.now() / 3600000))
    ]).then(function (res) {
      var items = []
        .concat(fromQuestions(res[0]))
        .concat(fromCircuit(res[1]))
        .concat(fromWinners(res[2]));

      // Свежие сверху; будущие метки отбрасываем, чтобы сбитые часы на
      // машине человека не выводили события "через 3 часа".
      var now = Math.floor(Date.now() / 1000) + 300;
      items = items.filter(function (a) { return a.ts && a.ts <= now; });
      items.sort(function (a, b) { return b.ts - a.ts; });

      render(items.slice(0, LIMIT));
    });
  }

  function start() {
    load();
    setInterval(function () {
      // Спящая вкладка не обновляется: запросы к воркерам считаются
      // по квоте, и держать их вхолостую незачем.
      if (document.visibilityState === 'visible') load();
    }, EVERY);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
