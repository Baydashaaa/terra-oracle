// Ask Oracle: связка новой раскладки с боевыми ask.js и sign.js.
// Ни один из них не правится - здесь только чипсы категорий,
// итоговая карточка и блокировка отправки до оплаты.
(function () {
  'use strict';

  var TIERS = {
    basic:    { label: 'Basic',    entries: '+1', rep: '+50' },
    priority: { label: 'Priority', entries: '+4', rep: '+50' }
  };

  function $(id) { return document.getElementById(id); }

  // ---------- категория ----------
  // Значение хранит скрытое поле name="category" - его читает ask.js
  // через FormData, поэтому логика отправки не меняется.
  window.askPickCategory = function (btn, value) {
    var input = document.querySelector('#ask-form input[name="category"]');
    if (input) input.value = value;
    var box = $('askChips');
    if (box) {
      box.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
    }
    syncSummary();
  };

  function currentCategory() {
    var input = document.querySelector('#ask-form input[name="category"]');
    return (input && input.value) || '';
  }

  function currentTier() {
    var r = document.querySelector('#tier-picker input[name="question-tier"]:checked');
    return TIERS[r && r.value] || TIERS.basic;
  }

  // ---------- итоговая карточка ----------
  // Цену считает sign.js и кладёт её в панель выгоды. Мы её оттуда
  // зеркалим, чтобы не дублировать расчёт скидки.
  function syncSummary() {
    var t = currentTier();
    var cat = currentCategory();

    var line = $('askSummaryLine');
    if (line) {
      line.innerHTML = t.label +
        ' \u00b7 Category: <b>' + (cat ? cat : 'not chosen') + '</b>' +
        ' \u00b7 Weekly entries: <b>' + t.entries + '</b>' +
        ' \u00b7 REP available: <b>' + t.rep + '</b>';
    }

    var nowB = document.querySelector('#ask-price-now b');
    var fin = $('askFinal2');
    if (fin) fin.textContent = nowB ? nowB.textContent : '-';

    var baseEl = $('ask-price-base');
    var base = $('askBase2');
    if (base) {
      var shown = baseEl && baseEl.style.display !== 'none';
      base.textContent = shown ? (($('ask-price-base-amt') || {}).textContent || '') + ' LUNC' : '';
    }

    var badge = $('ask-price-badge');
    var disc = $('askDisc2');
    if (disc) {
      var on = badge && badge.style.display !== 'none';
      disc.textContent = on ? (($('ask-price-badge-text') || {}).textContent || '') : '';
    }
  }

  // ---------- блокировка отправки ----------
  // sign.js открывает форму, выставляя ей display:block. До этого
  // момента поля видны намеренно - чтобы было понятно, что ждёт
  // впереди, - но отправлять неоплаченный вопрос нельзя.
  var lastLocked = null;

  function syncLock() {
    var form = $('ask-form');
    var btn = $('ask-btn');
    if (!form || !btn) return;
    var locked = (form.style.display === 'none' || form.style.display === '');
    // Выходим, если ничего не изменилось. Наблюдатель ниже слушает
    // атрибуты этой же формы, а мы вешаем на неё класс - без этой
    // проверки запись сама себя и вызывала бы, по кругу.
    if (locked === lastLocked) return;
    lastLocked = locked;
    form.classList.toggle('is-locked', locked);
    btn.disabled = locked;
    if (locked) btn.setAttribute('title', 'Pay the question fee to unlock');
    else btn.removeAttribute('title');
  }

  // Слушаем ТОЛЬКО атрибут style и без поддерева: и sign.js, и мы сами
  // пишем внутрь этих узлов, а широкая подписка замыкает наблюдателя
  // на собственную запись.
  function watchStyle(el, fn) {
    if (!el) return;
    new MutationObserver(fn).observe(el, { attributes: true, attributeFilter: ['style'] });
  }

  function watchText(el, fn) {
    if (!el) return;
    new MutationObserver(fn).observe(el, { childList: true, subtree: true, characterData: true });
  }

  function start() {
    if (!$('ask-form')) return;

    watchText($('ask-price-now'), syncSummary);
    watchStyle($('ask-price-base'), syncSummary);
    watchStyle($('ask-price-badge'), syncSummary);
    watchText($('ask-price-badge-text'), syncSummary);
    watchStyle($('ask-form'), syncLock);

    document.addEventListener('change', function (e) {
      if (e.target.name === 'question-tier') syncSummary();
    });

    syncSummary();
    syncLock();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
