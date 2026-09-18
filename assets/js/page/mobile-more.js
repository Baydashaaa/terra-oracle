// Шторка "Everything else" на телефоне.
//
// Нижняя панель вмещает четыре раздела и кнопку More; остальное живёт
// здесь. Разметка - #mMore в index.html, стили уже в shell.css
// (.scrim-modal показывается по атрибуту open, на узких экранах выезжает
// снизу с "ручкой").
//
// Переходом по разделам занимается shell-nav.js: ссылки внутри помечены
// data-view, как в рельсе. Здесь только открыть, закрыть и не мешать.
(function () {
  'use strict';

  function sheet() { return document.getElementById('mMore'); }

  function open() {
    var s = sheet();
    if (!s) return;
    s.setAttribute('open', '');
    // Фон под шторкой не должен прокручиваться вместе с ней.
    document.documentElement.style.overflow = 'hidden';
  }

  function close() {
    var s = sheet();
    if (!s) return;
    s.removeAttribute('open');
    document.documentElement.style.overflow = '';
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-modal="more"]');
    if (btn) { e.preventDefault(); open(); return; }

    var s = sheet();
    if (!s || !s.hasAttribute('open')) return;

    // Крестик, клик по фону мимо панели, и переход в раздел: во всех
    // трёх случаях шторка уходит. При переходе - именно закрыть, а не
    // оставить: иначе новый раздел откроется под ней.
    if (e.target.closest('[data-close]')) { e.preventDefault(); close(); return; }
    if (e.target === s) { close(); return; }
    if (e.target.closest('#mMore [data-view]')) { close(); return; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  // Возврат "назад" в браузере тоже закрывает: иначе шторка осталась бы
  // висеть над предыдущим разделом.
  addEventListener('popstate', close);
})();
