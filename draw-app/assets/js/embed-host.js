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
  // Глаз Oracle гасит себя сам - см. отказ по is-embedded в начале
  // assets/js/oracle-eye.js. Здешний killEye() удалён: он искал узлы со
  // словом "eye" в id или классе и до #oe-btn не доставал.
  // Заглушка window.oracleEye тоже не нужна - wheel-bridge.js проверяет
  // наличие перед вызовом wake().

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

  // Обратная карта: внутренняя вкладка -> имя во внешнем ряду.
  // Ветка 'draw' сюда не входит намеренно: какая игра открыта, решает
  // рельс (game-switcher.js), и сообщать за него мы не вправе.
  var BACK = { winners: 'winners', verify: 'verify', home: 'about' };
  var applying = false;

  // Рамка может сменить вкладку сама: кнопка verify на карточке победителя
  // зовёт openVerifyForRound -> showTab('verify'). Внешний ряд вкладок об
  // этом узнавал только от нас, а мы молчали - отсюда подсветка Winners
  // поверх открытой проверки.
  function hookShowTab() {
    if (typeof window.showTab !== 'function' || window.showTab.__reports) return;
    var orig = window.showTab;
    var wrapped = function (tab) {
      var res = orig.apply(this, arguments);
      try {
        var name = BACK[tab];
        // applying - это наш собственный вызов из apply(): он пришёл
        // снаружи, докладывать о нём обратно незачем.
        if (name && !applying && name !== lastGo) {
          lastGo = name;
          parent.postMessage({ type: 'oracle-draw:tab', tab: name }, location.origin);
        }
      } catch (e) {}
      return res;
    };
    wrapped.__reports = true;
    window.showTab = wrapped;
  }

  function apply(name) {
    hookShowTab();
    var m = MAP[name] || MAP.daily;
    // Домашняя страница скрыта стилями всегда - иначе она мелькает до
    // того, как отработает скрипт. Показываем её только для About.
    document.body.classList.toggle('show-home', m[0] === 'home');
    applying = true;
    try {
      if (typeof window.showTab === 'function') window.showTab(m[0], true);
    } finally {
      applying = false;
    }
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
    if (!e.data) return;

    // Видимая часть рамки, присланная хозяином. Кладём в переменные:
    // по ним embed-theme.css ставит подложку окна минта так, чтобы окно
    // оказалось по центру экрана человека, а не по центру всего полотна.
    if (e.data.type === 'oracle-draw:viewport') {
      var s = document.documentElement.style;
      s.setProperty('--host-top', (Number(e.data.top) || 0) + 'px');
      s.setProperty('--host-vh', Math.max(240, Number(e.data.height) || 0) + 'px');
      return;
    }

    if (e.data.type !== 'oracle-draw:go') return;
    selfOpened = true;
    go(e.data.tab);
  });

  // Своим ходом: в рамке домашняя страница не нужна никогда, а ждать
  // команды снаружи нельзя - пока она идёт, успевает мелькнуть home.
  // Сцена строится не мгновенно: рамка грузится быстрее, чем Draw
  // успевает получить winners.json и билеты.
  //
  // Здесь была страховка waitStage, которая ЖДАЛА ПОЯВЛЕНИЯ #stage-draw.
  // Она не работала: этот элемент лежит в статической разметке и есть
  // всегда, поэтому ожидание завершалось на первой же попытке. Вкладка
  // открывалась по пустым данным, и Daily оставался пустым до первого
  // переключения - ручное переключение делало то же самое, но позже.
  //
  // Ждать признака готовности ДО открытия нечего: пока раздел скрыт, у
  // него нулевая высота при любом состоянии. Поэтому проверяем ПОСЛЕ.
  // Сторож стартового показа.
  //
  // Раздел открывается двумя путями: сами на DOMContentLoaded и по
  // сообщению oracle-draw:go от хозяина. Оба зовут apply(), но на старте
  // это может не удержаться - init.js показывает СВОЮ стартовую вкладку
  // (обычно home), и порядок двух вызовов не гарантирован. На проде
  // выходило так, что побеждал init.js: у #page-draw оставался
  // display:none, а всё внутри отдавало нулевую высоту.
  //
  // Поэтому проверяем результат, а не момент вызова, и делаем это
  // независимо от того, кто открыл раздел первым: прошлая версия жила
  // внутри openDefault, а та выходит сразу, если хозяин успел прислать
  // oracle-draw:go раньше DOMContentLoaded.
  var MIN_H = 40;          // ниже этого сцена считается нерисованной
  var watchUntil = 0;      // до какого момента следим
  var lastFix = 0;         // когда последний раз вмешивались

  function drawShown() {
    var p = document.getElementById('page-draw');
    if (!p || getComputedStyle(p).display === 'none') return false;
    var st = document.getElementById('stage-draw');
    return !!st && st.offsetHeight >= MIN_H;
  }

  function watchdog() {
    if (Date.now() > watchUntil) return;
    // Не чаще раза в секунду: apply перестраивает колесо, и частые
    // вызовы подряд оставляли его в промежуточном состоянии.
    if (!drawShown() && Date.now() - lastFix > 900) {
      lastFix = Date.now();
      apply(lastGo || 'daily');
    }
    setTimeout(watchdog, 250);
  }

  function openDefault() {
    // showTab объявлен в config.js, а тот грузится с defer - к моменту
    // выполнения этого файла его ещё нет. Поэтому перехват ставим здесь.
    hookShowTab();
    watchUntil = Date.now() + 8000;
    watchdog();
    if (selfOpened) return;      // хозяин уже открыл нужную вкладку
    var want = new URLSearchParams(location.search).get('tab') || 'daily';
    lastGo = null;
    go(want);
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

  // Кроме готовой строки отдаём ещё и остаток в миллисекундах. Строка
  // общего формата теряет секунды всё, что дальше суток ("2d 05:24"), а
  // карточке снаружи нужны три клетки. Считать расписание у себя она
  // по-прежнему не должна - источник один, здесь.
  // У Circuit расписания нет, дедлайн приходит из воркера - его кладёт
  // в window game-switcher.js при каждом опросе.
  function circuitMsLeft() {
    var dl = window.__circuitDeadline;
    if (typeof dl !== 'number') return null;
    var left = dl - Date.now();
    return left > 0 ? left : null;
  }

  function msLeft(pool) {
    var S = window.DRAW_SCHEDULE;
    if (!S || typeof S.msToNext !== 'function') return null;
    var v = S.msToNext(pool);
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  }

  function broadcast() {
    parent.postMessage({
      type: 'oracle-draw:stats',
      games: {
        daily:   { pool: txt('dg-daily-pool'),   tick: txt('dg-daily-tick'),   ms: msLeft('daily') },
        weekly:  { pool: txt('dg-weekly-pool'),  tick: txt('dg-weekly-tick'),  ms: msLeft('weekly') },
        circuit: { pool: txt('dg-circuit-zones'), tick: txt('dg-circuit-tick'), ms: circuitMsLeft() }
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
