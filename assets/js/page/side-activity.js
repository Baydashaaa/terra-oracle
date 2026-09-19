// Лента "Recent activity" в правой колонке + окно "View all activity".
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
//   минты NFT    NFT-контракт        metadata.minted_at, секунды
// Минты читаем прямо из контракта: id токена имеет вид tier-N, поэтому
// последние - это старшие номера каждого тира. Результат кэшируется до
// тех пор, пока не изменится stats.total_minted.
// Markets добавим, когда модуль выйдет из SOON.
//
// Клик по строке открывает нужный раздел (тот же обработчик, что у
// ссылок [data-view] в меню) и пытается прокрутить к самому событию.
(function () {
  'use strict';

  var Q_WORKER    = 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
  var DRAW_WORKER = 'https://oracle-draw.vladislav-baydan.workers.dev';
  var DATA_ORIGIN = 'https://draw.terraoracle.io';
  var LCD         = 'https://terra-classic-lcd.publicnode.com';
  var NFT         = 'terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx';
  var NFT_PER_TIER = 8;          // сколько последних токенов каждого тира читать

  var LIMIT   = 6;               // строк в карточке
  var EVERY   = 5 * 60 * 1000;   // как часто обновлять
  var ICONS   = 'assets/img/icons/';

  var cache = [];                // последние события карточки, для кликов

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
  // type нужен фильтру в окне, view/target - переходу по клику.

  function fromQuestions(d) {
    var out = [];
    var qs = (d && d.questions) || [];
    qs.forEach(function (q) {
      if (q.createdAt) {
        out.push({
          type: 'questions', view: 'board', target: { q: q.id },
          ts:   q.createdAt,
          ic:   'ask.webp',
          text: 'Question asked',
          amt:  q.paymentAmount ? lunc(q.paymentAmount) + ' LUNC' : '',
          tone: 'var(--ink-2)'
        });
      }
      (q.answers || []).forEach(function (a) {
        if (!a.createdAt) return;
        var accepted = q.chosenAnswerId && q.chosenAnswerId === a.id;
        out.push({
          type: 'answers', view: 'board', target: { q: q.id, a: a.id },
          ts:   a.createdAt,
          ic:   accepted ? 'reputation.webp' : 'p-answers.webp',
          text: accepted ? 'Answer accepted' : 'Answer posted',
          amt:  accepted ? '+60 REP' : (a.votes ? '\u2191' + a.votes : ''),
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
        var from = Number(b.from), to = Number(b.to);
        var zones = (to - from + 1) || 1;
        out.push({
          type: 'circuit', view: 'draw', target: { tab: 'circuit', zone: from },
          ts:   Math.floor(b.at / 1000),         // здесь миллисекунды
          ic:   'circuit.webp',
          text: zones === 1 ? 'Circuit zone claimed' : 'Circuit zones claimed \u00d7' + zones,
          amt:  zones === 1 && isFinite(from) ? 'Zone #' + from : (b.paid ? lunc(b.paid / 1e6) + ' LUNC' : ''),
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
          type: 'draws', view: 'draw', target: { tab: pool },
          ts:   ts,
          ic:   'draw.webp',
          text: (pool === 'weekly' ? 'Weekly' : 'Daily') + ' draw settled',
          amt:  w.prize_lunc ? lunc(w.prize_lunc) + ' LUNC' : '',
          tone: 'var(--cyan)'
        });
      });
    });
    return out;
  }

  // ─── минты NFT ───────────────────────────────────────────────

  var TIER_TONE = {
    common: 'var(--ink-2)', rare: 'var(--cyan)',
    epic: '#b18cff', legendary: 'var(--amber)'
  };

  function smart(msg) {
    var b64 = btoa(JSON.stringify(msg));
    return getJSON(LCD + '/cosmwasm/wasm/v1/contract/' + NFT + '/smart/' + encodeURIComponent(b64))
      .then(function (r) { return r && r.data; });
  }

  function allTokenIds() {
    var ids = [];
    function page(after) {
      var q = { all_tokens: { limit: 100 } };
      if (after) q.all_tokens.start_after = after;
      return smart(q).then(function (d) {
        var t = (d && d.tokens) || [];
        ids = ids.concat(t);
        return t.length === 100 ? page(t[t.length - 1]) : ids;
      });
    }
    return page(null);
  }

  function fromNFT() {
    return smart({ extension: { msg: { stats: {} } } }).then(function (st) {
      if (!st) return [];
      var key = 'actNft2:' + st.total_minted;
      try {
        var hit = sessionStorage.getItem(key);
        if (hit) return JSON.parse(hit);
      } catch (e) {}

      return allTokenIds().then(function (ids) {
        var byTier = {};
        ids.forEach(function (id) {
          var m = /^([a-z]+)-(\d+)$/.exec(id);
          if (!m) return;
          (byTier[m[1]] = byTier[m[1]] || []).push({ id: id, n: Number(m[2]) });
        });
        var pick = [];
        Object.keys(byTier).forEach(function (t) {
          byTier[t].sort(function (a, b) { return b.n - a.n; });
          pick = pick.concat(byTier[t].slice(0, NFT_PER_TIER));
        });
        return Promise.all(pick.map(function (p) {
          return smart({ nft_info: { token_id: p.id } }).then(function (d) {
            var m = (d && (d.extension || d.metadata)) || {};
            var tier = String(m.tier || p.id.split('-')[0]).toLowerCase();
            if (!m.minted_at) return null;
            var pool = String(m.pool || '').toLowerCase();
            pool = pool === 'weekly' || pool === 'daily' ? pool : '';
            return {
              type: 'nft', view: pool ? 'draw' : 'nft', target: pool ? { tab: pool } : { token: p.id },
              ts:   Number(m.minted_at),
              ic:   'nft.webp',
              text: pool ? (pool === 'weekly' ? 'Weekly' : 'Daily') + ' draw entry' : 'NFT minted',
              amt:  tier.charAt(0).toUpperCase() + tier.slice(1) + ' NFT',
              tone: TIER_TONE[tier] || 'var(--ink-2)'
            };
          });
        }));
      }).then(function (list) {
        list = list.filter(Boolean);
        try { sessionStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
        return list;
      });
    }).catch(function () { return []; });
  }

  function collect(qLimit, cLimit) {
    return Promise.all([
      getJSON(Q_WORKER + '/questions?limit=' + qLimit),
      getJSON(DRAW_WORKER + '/circuit/history?limit=' + cLimit),
      getJSON(DATA_ORIGIN + '/winners.json?t=' + Math.floor(Date.now() / 3600000)),
      fromNFT()
    ]).then(function (res) {
      var items = []
        .concat(fromQuestions(res[0]))
        .concat(fromCircuit(res[1]))
        .concat(fromWinners(res[2]))
        .concat(res[3] || []);

      // Свежие сверху; будущие метки отбрасываем, чтобы сбитые часы на
      // машине человека не выводили события "через 3 часа".
      var now = Math.floor(Date.now() / 1000) + 300;
      items = items.filter(function (a) { return a.ts && a.ts <= now; });
      items.sort(function (a, b) { return b.ts - a.ts; });
      return items;
    });
  }

  // ─── отрисовка ───────────────────────────────────────────────

  function rows(items) {
    return items.map(function (a, i) {
      return '<li class="act-go" role="button" tabindex="0" data-i="' + i + '">' +
        '<img class="ico" src="' + ICONS + a.ic + '" alt="" width="96" height="96" loading="lazy">' +
        '<span class="tx"><b>' + esc(a.text) + '</b><span>' + ago(a.ts) + '</span></span>' +
        '<span class="amt" style="color:' + a.tone + '">' + esc(a.amt) + '</span></li>';
    }).join('');
  }

  function empty() {
    return '<li><span class="tx"><b>No activity yet</b>' +
           '<span>events will appear here</span></span></li>';
  }

  function render(items) {
    var box = el();
    if (!box) return;
    cache = items;
    box.innerHTML = items.length ? rows(items) : empty();
  }

  // Клик и Enter/Space по строке списка.
  function bindList(list, getItems, after) {
    function fire(li) {
      var it = getItems()[Number(li.getAttribute('data-i'))];
      if (!it) return;
      if (after) after();
      go(it);
    }
    list.addEventListener('click', function (e) {
      var li = e.target.closest('.act-go');
      if (li) fire(li);
    });
    list.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var li = e.target.closest('.act-go');
      if (li) { e.preventDefault(); fire(li); }
    });
  }

  // ─── переход к событию ───────────────────────────────────────

  function openView(view) {
    // Тот же путь, что у меню и карточек модулей: кликаем по ссылке
    // с нужным data-view, её обработчик уже умеет открывать раздел.
    var link = document.querySelector('.side [data-view="' + view + '"]:not([data-draw-tab])') ||
               document.querySelector('[data-view="' + view + '"]:not([aria-disabled="true"]):not([data-draw-tab])');
    if (link) { link.click(); return; }
    location.href = '?v=' + encodeURIComponent(view);
  }

  // Ждём, пока раздел дорисуется, и возвращаем первый видимый узел.
  function waitFor(find, cb) {
    var tries = 0;
    (function look() {
      var node = null;
      try { node = find(); } catch (e) {}
      // Скрытый узел (закрытая секция ответов) тоже годится,
      // если видна его карточка: значит раздел уже открыт.
      if (node && (node.offsetParent !== null ||
          (node.parentElement && node.parentElement.offsetParent !== null))) return cb(node);
      if (++tries < 25) setTimeout(look, 150);
    })();
  }

  function flash(node) {
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.remove('act-flash');
    void node.offsetWidth;
    node.classList.add('act-flash');
    setTimeout(function () { node.classList.remove('act-flash'); }, 2600);
  }

  // Вопрос: board.js помечает секцию ответов data-qid, а ответы
  // data-answer-id. Открываем секцию через его же toggleAnswers.
  function focusQuestion(t) {
    if (!t.q) return;
    waitFor(function () {
      return document.querySelector('.answers-section[data-qid="' + CSS.escape(String(t.q)) + '"]');
    }, function (sec) {
      var qi = Number(String(sec.id).replace('answers-', ''));
      if (!sec.classList.contains('open') && typeof window.toggleAnswers === 'function' && isFinite(qi)) {
        window.toggleAnswers(qi);
      }
      setTimeout(function () {
        var s2 = document.getElementById(sec.id) || sec;   // секция могла перерисоваться
        var node = t.a && s2.querySelector('[data-answer-id="' + CSS.escape(String(t.a)) + '"]');
        flash(node || s2.parentElement || s2);
      }, 250);
    });
  }

  function go(it) {
    openView(it.view);
    var t = it.target || {};
    if (it.view === 'draw' && t.tab) {
      waitFor(function () {
        return document.querySelector('#drawModes [data-t="' + t.tab + '"]');
      }, function (tab) { tab.click(); });
    }
    if (it.view === 'board') {
      // Есть страница вопроса - открываем её, иначе прокрутка к карточке.
      var opened = t.q && typeof window.openQuestionById === 'function' && window.openQuestionById(t.q, t.a);
      if (!opened) focusQuestion(t);
    }
    // Модули, которые умеют больше, могут слушать это событие.
    document.dispatchEvent(new CustomEvent('oracle:focus', { detail: { type: it.type, view: it.view, target: t } }));
  }

  // ─── окно "View all activity" ────────────────────────────────

  var modal = null, allItems = [], shown = [], filter = 'all';

  var FILTERS = [
    ['all', 'All'], ['questions', 'Questions'], ['answers', 'Answers'],
    ['draws', 'Draws'], ['circuit', 'Circuit'], ['nft', 'NFT']
  ];

  function buildModal() {
    modal = document.createElement('div');
    modal.className = 'act-modal';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="act-dialog" role="dialog" aria-modal="true" aria-labelledby="actModalTitle">' +
        '<div class="act-head">' +
          '<h3 id="actModalTitle"><img class="hdr" src="' + ICONS + 'hdr-activity.webp" alt="" width="128" height="128"> All activity</h3>' +
          '<button type="button" class="act-x" aria-label="Close">\u00d7</button>' +
        '</div>' +
        '<div class="act-chips" role="tablist">' +
          FILTERS.map(function (f) {
            return '<button type="button" role="tab" data-f="' + f[0] + '">' + f[1] + '</button>';
          }).join('') +
        '</div>' +
        '<ul class="acts act-all"></ul>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('.act-x')) closeAll();
      var chip = e.target.closest('.act-chips button');
      if (chip) { filter = chip.getAttribute('data-f'); drawAll(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.hidden) closeAll();
    });
    bindList(modal.querySelector('.act-all'), function () { return shown; }, closeAll);
  }

  function drawAll() {
    var list = modal.querySelector('.act-all');
    modal.querySelectorAll('.act-chips button').forEach(function (b) {
      var on = b.getAttribute('data-f') === filter;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    shown = filter === 'all' ? allItems : allItems.filter(function (a) { return a.type === filter; });
    list.innerHTML = shown.length ? rows(shown) : empty();
  }

  function openAll() {
    if (!modal) buildModal();
    filter = 'all';
    modal.hidden = false;
    document.documentElement.classList.add('act-lock');
    var list = modal.querySelector('.act-all');
    list.innerHTML = '<li><span class="tx"><b>Loading\u2026</b><span>&nbsp;</span></span></li>';
    modal.querySelector('.act-x').focus();
    collect(100, 30).then(function (items) {
      allItems = items;
      drawAll();
    });
  }

  function closeAll() {
    if (!modal) return;
    modal.hidden = true;
    document.documentElement.classList.remove('act-lock');
  }

  // Переход к событию нужен и поиску в шапке.
  window.OracleActivity = { go: go };

  // Ссылки с data-draw-tab (например, карточка Circuit на главной) ведут
  // не просто на Draw, а сразу на нужную вкладку. Перехват в фазе capture,
  // чтобы обычный обработчик data-view не успел открыть Draw на Daily.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-draw-tab]');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    go({ type: 'nav', view: 'draw', target: { tab: a.getAttribute('data-draw-tab') } });
  }, true);

  // ─── запуск ──────────────────────────────────────────────────

  function load() {
    if (!el()) return;
    collect(12, 6).then(function (items) { render(items.slice(0, LIMIT)); });
  }

  function start() {
    var box = el();
    if (!box) return;
    bindList(box, function () { return cache; });
    var btn = box.closest('section') && box.closest('section').querySelector('.wide');
    if (btn) btn.addEventListener('click', openAll);

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
