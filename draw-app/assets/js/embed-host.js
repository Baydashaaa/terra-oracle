// Внутри draw-app: режим рамки.
// Подключается в конце body файла draw-app/index.html.
//
// Делает две вещи: прячет собственную шапку Draw, когда страница открыта
// с ?embed=1, и сообщает наружу свою высоту, чтобы рамка под неё росла.
(function () {
  'use strict';

  var embedded = new URLSearchParams(location.search).has('embed') || window.top !== window.self;
  if (!embedded) return;

  document.documentElement.classList.add('is-embedded');
  document.body.classList.add('is-embedded');

  // Заставка Draw в рамке не нужна: её роль - прикрыть первую отрисовку
  // на своём домене, а здесь оболочку уже показал внешний сайт. К тому же
  // она снимается по window.load, а одна зависшая картинка держит её вечно.
  function dropSplash() {
    ['page-loader', 'page-transition'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    document.body.classList.remove('loading', 'is-loading');
    document.body.style.removeProperty('overflow');
    document.documentElement.style.removeProperty('overflow');
  }
  dropSplash();
  addEventListener('DOMContentLoaded', dropSplash);
  addEventListener('load', dropSplash);

  // ---------- команды снаружи ----------
  // Внешние вкладки шлют сюда {type:'oracle-draw:go', tab}.
  // About - это домашняя страница Draw: там уже лежит вся информация
  // о протоколе, дублировать её незачем.
  var MAP = {
    daily:   ['draw', 'daily'],
    weekly:  ['draw', 'weekly'],
    circuit: ['draw', 'circuit'],
    winners: ['winners', null],
    verify:  ['verify', null],
    about:   ['home', null]
  };

  var lastGo = null;
  var goTimer = null;

  function go(name) {
    // Повторный вызов той же вкладки ничего не меняет, а switchLottery
    // тяжёлый: он перезапускает таймер и пересобирает колесо. Два вызова
    // подряд оставляли его в промежуточном состоянии - отсюда пустая сцена.
    if (name === lastGo) return;
    lastGo = name;

    // Схлопываем очередь: при быстрых кликах выполняется последний выбор.
    clearTimeout(goTimer);
    goTimer = setTimeout(function () { apply(name); }, 40);
  }

  function apply(name) {
    var m = MAP[name] || MAP.daily;
    // Домашняя страница скрыта стилями всегда - иначе она мелькает до
    // того, как отработает скрипт. Показываем её только для About.
    document.body.classList.toggle('show-home', m[0] === 'home');
    if (typeof window.showTab === 'function') window.showTab(m[0], true);
    if (!m[1]) return;
    // selectGame - штатный переключатель рельса из game-switcher.js.
    // Он и прячет ненужную сцену, и для daily/weekly сам зовёт
    // switchLottery. Звать switchLottery напрямую нельзя: она не знает
    // про сцены, и после Circuit колесо оставалось скрытым.
    if (typeof window.selectGame === 'function') window.selectGame(m[1]);
    else if (typeof window.switchLottery === 'function') window.switchLottery(m[1]);
  }

  var selfOpened = false;

  addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    if (!e.data || e.data.type !== 'oracle-draw:go') return;
    selfOpened = true;
    go(e.data.tab);
  });

  // Своим ходом: в рамке домашняя страница не нужна никогда, а ждать
  // команды снаружи нельзя - пока она идёт, успевает мелькнуть home.
  // Сцена строится не мгновенно: рамка фиксированной высоты грузится
  // быстрее, чем Draw успевает собрать колесо. Ждём появления сцены и
  // только тогда открываем вкладку - иначе Daily оставался пустым до
  // первого переключения.
  function waitStage(fn, tries) {
    var st = document.getElementById('stage-draw');
    if (st || (tries || 0) > 40) return fn();
    setTimeout(function () { waitStage(fn, (tries || 0) + 1); }, 50);
  }

  function openDefault() {
    if (selfOpened) return;
    var want = new URLSearchParams(location.search).get('tab') || 'daily';
    waitStage(function () { lastGo = null; go(want); });
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', openDefault);
  else openDefault();


  var last = 0;
  function report() {
    // scrollHeight тела считает и то, что скрыто, и прежнюю раскладку -
    // планка от него только росла. Берём нижнюю границу последнего
    // видимого элемента: это фактический низ содержимого.
    var els = document.body.children;
    var bottom = 0;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.offsetParent === null && el.tagName !== 'BODY') continue;
      var r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      bottom = Math.max(bottom, r.bottom + window.scrollY);
    }
    var h = Math.ceil(bottom) + 12;
    if (!h || Math.abs(h - last) < 24) return;
    last = h;
    parent.postMessage({ type: 'oracle-draw:height', height: h }, location.origin);
  }

  // Сообщаем наружу, что готовы принимать команды.
  function ready() {
    parent.postMessage({ type: 'oracle-draw:ready' }, location.origin);
  }
  addEventListener('load', ready);
  setTimeout(ready, 120);

  // Окно минта прибито к коробке рамки, а она высотой во всё содержимое:
  // центр приходится ниже видимой части. Сообщаем наружу, чтобы сайт
  // подкрутил страницу к рамке.
  var modalWasOpen = false;
  new MutationObserver(function () {
    var ov = document.querySelector('.modal-overlay.open');
    // Сообщаем только в момент ОТКРЫТИЯ. Наблюдатель ловит любую смену
    // класса, в том числе выбор тира внутри окна - без этой проверки
    // страница подкручивалась на каждый клик.
    if (!ov) { modalWasOpen = false; return; }
    if (modalWasOpen) return;
    modalWasOpen = true;
    var top = ov.getBoundingClientRect().top + window.scrollY;
    // Окно прижато к верху рамки. Чтобы оно попало в поле зрения,
    // прокручиваем содержимое рамки в начало - внешняя страница при
    // этом не двигается, и вкладки остаются на месте.

    parent.postMessage({ type: 'oracle-draw:modal', top: top }, location.origin);
  }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });

  // Живые цифры наружу. Источник - рельс игр: game-switcher.js держит
  // его в актуальном состоянии даже когда он скрыт, и там уже лежат пул
  // и отсчёт всех трёх игр сразу. Своего расчёта на стороне сайта быть
  // не должно - он расходился с pool-timer.js на минуты.
  function txt(id) {
    var e = document.getElementById(id);
    return e ? e.textContent.trim() : '';
  }

  function broadcast() {
    parent.postMessage({
      type: 'oracle-draw:stats',
      games: {
        daily:   { pool: txt('dg-daily-pool'),   tick: txt('dg-daily-tick') },
        weekly:  { pool: txt('dg-weekly-pool'),  tick: txt('dg-weekly-tick') },
        circuit: { pool: txt('dg-circuit-zones'), tick: txt('dg-circuit-tick') }
      }
    }, location.origin);
  }
  setInterval(broadcast, 1000);
  addEventListener('load', broadcast);

  addEventListener('load', report);
  addEventListener('resize', report);
  setInterval(report, 700);
  new MutationObserver(report).observe(document.body, { childList: true, subtree: true });
})();
