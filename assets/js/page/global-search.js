// Поиск в шапке: "Search questions, markets, wallets".
//
// Данные грузим лениво, при первом фокусе, и держим 2 минуты:
//   вопросы и ответы  /questions        текст, теги, категория, id (LUNC-XXXX)
//   кошельки          /rep/scores       все кошельки с REP + авторы вопросов
// Markets добавятся, когда модуль выйдет из SOON: достаточно дописать
// источник в load() и группу в GROUPS.
//
// Переход по результату идёт через OracleActivity.go из side-activity.js,
// поэтому вопрос открывается и подсвечивается так же, как из Recent activity.
(function () {
  'use strict';

  var Q_WORKER = 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
  var TTL      = 2 * 60 * 1000;
  var PER      = 5;              // результатов в группе

  var input, box, data = null, loadedAt = 0, loading = null, results = [], cur = -1;

  function getJSON(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function short(addr) {
    addr = String(addr || '');
    return addr.length > 16 ? addr.slice(0, 8) + '\u2026' + addr.slice(-4) : addr;
  }

  // Подсветка совпадения + обрезка длинного текста вокруг него.
  function snippet(text, q, max) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    var i = text.toLowerCase().indexOf(q);
    var start = 0;
    if (i > max - 20) start = Math.max(0, i - 30);
    var cut = text.slice(start, start + max);
    var pre = start > 0 ? '\u2026' : '', post = start + max < text.length ? '\u2026' : '';
    var j = cut.toLowerCase().indexOf(q);
    if (j < 0) return pre + esc(cut) + post;
    return pre + esc(cut.slice(0, j)) + '<mark>' + esc(cut.slice(j, j + q.length)) + '</mark>' +
           esc(cut.slice(j + q.length)) + post;
  }

  // ─── данные ──────────────────────────────────────────────────

  function load() {
    if (data && Date.now() - loadedAt < TTL) return Promise.resolve(data);
    if (loading) return loading;
    loading = Promise.all([
      getJSON(Q_WORKER + '/questions?limit=500'),
      getJSON(Q_WORKER + '/rep/scores')
    ]).then(function (res) {
      var qs = (res[0] && res[0].questions) || [];
      var scores = (res[1] && res[1].scores) || {};
      var wallets = {};
      Object.keys(scores).forEach(function (w) { wallets[w] = { wallet: w, rep: Number(scores[w]) || 0 }; });
      qs.forEach(function (q) {
        if (q.wallet && !wallets[q.wallet]) wallets[q.wallet] = { wallet: q.wallet, rep: 0 };
        if (q.wallet && q.alias) wallets[q.wallet].alias = q.alias;
        (q.answers || []).forEach(function (a) {
          if (a.wallet && !wallets[a.wallet]) wallets[a.wallet] = { wallet: a.wallet, rep: 0 };
        });
      });
      data = { questions: qs, wallets: Object.keys(wallets).map(function (k) { return wallets[k]; }) };
      loadedAt = Date.now();
      loading = null;
      return data;
    });
    return loading;
  }

  function nick(w) {
    try { if (typeof window.getProfileNickname === 'function') return window.getProfileNickname(w.wallet) || w.alias || ''; } catch (e) {}
    return w.alias || '';
  }

  // ─── поиск ───────────────────────────────────────────────────

  function search(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2 || !data) return [];
    var out = [];

    // Вопросы: id, текст, теги, категория. Точное совпадение id - первым.
    var qHits = [];
    data.questions.forEach(function (x) {
      var id = String(x.id || '').toLowerCase();
      var hay = [x.text, (x.tags || []).join(' '), x.category, x.alias].join(' ').toLowerCase();
      var score = id === q ? 100 : id.indexOf(q) > -1 ? 50 : hay.indexOf(q) > -1 ? 10 : 0;
      if (score) qHits.push({ s: score + (x.createdAt || 0) / 1e10, x: x });
    });
    qHits.sort(function (a, b) { return b.s - a.s; });
    qHits.slice(0, PER).forEach(function (h) {
      var x = h.x, n = (x.answers || []).length;
      out.push({
        group: 'Questions', ic: 'ask.webp',
        title: snippet(x.text, q, 90),
        sub: esc(x.id || '') + (x.category ? ' \u00b7 ' + esc(x.category) : '') + ' \u00b7 ' + n + (n === 1 ? ' answer' : ' answers'),
        item: { type: 'questions', view: 'board', target: { q: x.id } }
      });
    });

    // Ответы: только по тексту.
    var aHits = [];
    data.questions.forEach(function (x) {
      (x.answers || []).forEach(function (a) {
        if (String(a.text || '').toLowerCase().indexOf(q) > -1) aHits.push({ x: x, a: a });
      });
    });
    aHits.sort(function (m, n) { return (n.a.createdAt || 0) - (m.a.createdAt || 0); });
    aHits.slice(0, PER).forEach(function (h) {
      out.push({
        group: 'Answers', ic: 'p-answers.webp',
        title: snippet(h.a.text, q, 90),
        sub: 'on ' + esc(String(h.x.text || '').slice(0, 50)) + (String(h.x.text || '').length > 50 ? '\u2026' : ''),
        item: { type: 'answers', view: 'board', target: { q: h.x.id, a: h.a.id } }
      });
    });

    // Кошельки: по адресу или нику.
    var wHits = data.wallets.filter(function (w) {
      return w.wallet.toLowerCase().indexOf(q) > -1 || nick(w).toLowerCase().indexOf(q) > -1;
    });
    wHits.sort(function (a, b) { return b.rep - a.rep; });
    wHits.slice(0, PER).forEach(function (w) {
      var nm = nick(w);
      out.push({
        group: 'Wallets', ic: 'profile.webp',
        title: nm ? esc(nm) + ' <span class="gs-dim">' + esc(short(w.wallet)) + '</span>' : esc(short(w.wallet)),
        sub: (w.rep ? Math.round(w.rep).toLocaleString('en-US') + ' REP' : 'no REP yet'),
        wallet: w.wallet
      });
    });
    return out;
  }

  // ─── выпадающий список ───────────────────────────────────────

  function render(q) {
    if (!q || q.trim().length < 2) { close(); return; }
    if (!data) {
      box.innerHTML = '<div class="gs-empty">Loading\u2026</div>';
      open();
      return;
    }
    results = search(q);
    cur = results.length ? 0 : -1;
    if (!results.length) {
      box.innerHTML = '<div class="gs-empty">Nothing found for \u201c' + esc(q.trim()) + '\u201d</div>';
      open();
      return;
    }
    var html = '', last = '';
    results.forEach(function (r, i) {
      if (r.group !== last) { html += '<div class="gs-group">' + r.group + '</div>'; last = r.group; }
      html += '<div class="gs-row" role="option" id="gs-opt-' + i + '" data-i="' + i + '">' +
        '<img src="assets/img/icons/' + r.ic + '" alt="" width="64" height="64">' +
        '<span class="gs-tx"><b>' + r.title + '</b><span>' + r.sub + '</span></span></div>';
    });
    box.innerHTML = html;
    mark();
    open();
  }

  function mark() {
    box.querySelectorAll('.gs-row').forEach(function (el) {
      var on = Number(el.getAttribute('data-i')) === cur;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) { el.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', el.id); }
    });
  }

  function open()  { box.hidden = false; input.setAttribute('aria-expanded', 'true'); }
  function close() { box.hidden = true;  input.setAttribute('aria-expanded', 'false'); cur = -1; }

  function pick(i) {
    var r = results[i];
    if (!r) return;
    close();
    input.blur();
    if (r.item) {
      if (window.OracleActivity && typeof window.OracleActivity.go === 'function') window.OracleActivity.go(r.item);
      return;
    }
    if (r.wallet) openWallet(r.wallet);
  }

  // Профиля чужого кошелька на сайте пока нет, поэтому открываем
  // Leaderboard и подсвечиваем строку с этим адресом, если она там есть.
  function openWallet(w) {
    if (typeof window.showRepPage === 'function') window.showRepPage('leaderboard');
    else {
      var link = document.querySelector('.side [data-view="reputation"], [data-view="reputation"]');
      if (link) link.click();
    }
    var head = w.slice(0, 8), tail = w.slice(-4), tries = 0;
    (function look() {
      var page = document.getElementById('page-reputation') || document;
      var rows = page.querySelectorAll('tr, li, .lb-row, [class*="row"]');
      for (var i = 0; i < rows.length; i++) {
        var t = rows[i].textContent || '';
        if ((t.indexOf(w) > -1 || (t.indexOf(head) > -1 && t.indexOf(tail) > -1)) && rows[i].offsetParent !== null) {
          rows[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
          rows[i].classList.remove('act-flash'); void rows[i].offsetWidth; rows[i].classList.add('act-flash');
          return;
        }
      }
      if (++tries < 20) setTimeout(look, 150);
    })();
  }

  // ─── запуск ──────────────────────────────────────────────────

  function start() {
    input = document.querySelector('.topbar .search input');
    if (!input) return;
    var wrap = input.closest('.search');
    wrap.classList.add('gs-wrap');

    box = document.createElement('div');
    box.className = 'gs-box';
    box.id = 'gsBox';
    box.hidden = true;
    box.setAttribute('role', 'listbox');
    wrap.appendChild(box);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-controls', 'gsBox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocomplete', 'off');

    var t = null;
    input.addEventListener('focus', function () {
      load().then(function () { if (document.activeElement === input) render(input.value); });
    });
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (!data) load().then(function () { render(input.value); });
        render(input.value);
      }, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); input.blur(); return; }
      if (box.hidden || !results.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); cur = (cur + 1) % results.length; mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cur = (cur - 1 + results.length) % results.length; mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(cur < 0 ? 0 : cur); }
    });
    // mousedown, а не click: иначе blur поля закроет список раньше клика.
    box.addEventListener('mousedown', function (e) {
      var row = e.target.closest('.gs-row');
      if (!row) return;
      e.preventDefault();
      pick(Number(row.getAttribute('data-i')));
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });

    // "/" в любом месте страницы ставит курсор в поиск.
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
      e.preventDefault();
      input.focus();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
