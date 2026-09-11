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

  var last = 0;
  function report() {
    var h = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    if (Math.abs(h - last) < 24) return;   // мелкие колебания не шлём
    last = h;
    parent.postMessage({ type: 'oracle-draw:height', height: h }, location.origin);
  }

  // В рамке нужен сразу розыгрыш, а не главная Draw: роутер смотрит
  // на pathname, а у нас адрес вида draw-app/?embed=1 - он попадает на home.
  function openTab() {
    var want = new URLSearchParams(location.search).get('tab') || 'draw';
    if (typeof window.showTab === 'function') window.showTab(want, true);
  }
  addEventListener('load', openTab);
  setTimeout(openTab, 400);

  addEventListener('load', report);
  addEventListener('resize', report);
  setInterval(report, 700);
  new MutationObserver(report).observe(document.body, { childList: true, subtree: true });
})();
