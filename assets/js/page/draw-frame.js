// Рамка с Oracle Draw: подгонка высоты под содержимое.
//
// iframe сам под содержимое не растёт. Внутренняя страница шлёт свою
// высоту наружу через postMessage - домен один, поэтому обмен разрешён.
// Если сообщений нет (старая версия внутри), остаётся запасная высота.
(function () {
  'use strict';

  var MIN = 900;

  function frame() { return document.getElementById('drawFrame'); }

  window.addEventListener('message', function (e) {
    // Принимаем только со своего же источника.
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (!d || d.type !== 'oracle-draw:height') return;
    return;
  });

  // Запасная высота: пока сообщение не пришло, рамка не должна быть пустой.
  function init() {
    var f = frame();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
