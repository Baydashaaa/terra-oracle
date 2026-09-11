// Вкладки раздела Oracle Draw на стороне сайта.
// Шесть разделов одним рядом, как в макете: Daily, Weekly, Circuit,
// Winners, Verify & proof, About.
//
// Сама механика живёт в рамке, поэтому вкладка не переключает разметку,
// а шлёт команду внутрь через postMessage. Ответ не нужен: если рамка
// ещё не загрузилась, команда просто повторится по её сигналу готовности.
(function () {
  'use strict';

  var TABS = [
    ['daily',   'Daily',          '244,212,119'],
    ['weekly',  'Weekly',         '185,140,255'],
    ['circuit', 'Circuit',        '56,217,208'],
    ['winners', 'Winners',        '244,212,119'],
    ['verify',  'Verify & proof', '168,85,247'],
    ['about',   'About',          '110,135,235']
  ];

  var tab = 'daily';
  var ready = false;

  function frame() { return document.getElementById('drawFrame'); }

  function send() {
    var f = frame();
    if (!f || !f.contentWindow) return;
    f.contentWindow.postMessage({ type: 'oracle-draw:go', tab: tab }, location.origin);
  }

  function paint(box) {
    box.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.t === tab));
    });
    var t = TABS.filter(function (x) { return x[0] === tab; })[0];
    var page = document.getElementById('page-draw');
    if (page && t) page.style.setProperty('--tone', t[2]);
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    if (!e.data || e.data.type !== 'oracle-draw:ready') return;
    ready = true;
    send();   // рамка поднялась - повторяем выбранную вкладку
  });

  // Ряд вкладок лежит в разметке - скрипт только вешает обработчики.
  // Создавать его из JS оказалось ненадёжно: раздел рисуется рано,
  // и вставка могла не успеть.
  function start() {
    var nav = document.getElementById('drawModes');
    if (!nav) return;
    nav.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        tab = b.dataset.t;
        paint(nav);
        if (ready) send();
      });
    });
    paint(nav);

    // Точка входа для карточки Next draw: она выбирает игру, а ряд
    // вкладок должен показать ту же - иначе два переключателя разойдутся.
    window.drawTabs = {
      open: function (name) {
        if (!TABS.some(function (t) { return t[0] === name; })) return;
        tab = name;
        paint(nav);
        send();
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
