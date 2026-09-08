// Ask Oracle: чипсы популярных категорий из прототипа.
// Категорию хранит боевой <select name="category">, чипсы только
// переключают его значение - логика отправки не меняется.
(function () {
  'use strict';

  window.askPickCategory = function (btn, value) {
    var box = document.getElementById('askChips');
    var sel = document.querySelector('#ask-form select[name="category"]');
    if (!sel) return;
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (box) {
      box.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
    }
  };

  // Обратная связь: выбрали в списке - подсветится нужный чипс.
  document.addEventListener('change', function (e) {
    if (!e.target.matches('#ask-form select[name="category"]')) return;
    var box = document.getElementById('askChips');
    if (!box) return;
    box.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.cat === e.target.value ? 'true' : 'false');
    });
  });
})();
