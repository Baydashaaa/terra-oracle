// Ask Oracle: связка новой раскладки с боевыми ask.js и sign.js.
// Ни один из них не правится. Здесь три вещи: кнопки категорий,
// живая итоговая карточка и одна нижняя кнопка вместо двух -
// пока вопрос не оплачен, она платит, после оплаты отправляет.
(function () {
  'use strict';

  var TIERS = {
    basic:    { label: 'Basic',    entries: '+1', rep: '+50' },
    priority: { label: 'Priority', entries: '+4', rep: '+50' }
  };

  var ARROW = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
              ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M5 12h14M13 6l6 6-6 6"/></svg>';

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
        ' \u00b7 Category: <b>' + (cat || 'not chosen') + '</b>' +
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

  // ---------- одна кнопка на два шага ----------
  // sign.js открывает форму, выставляя ей display:block. До этого
  // момента поля видны намеренно, но отправлять неоплаченный вопрос
  // нельзя - кнопка переключается в режим оплаты.
  function isLocked() {
    var form = $('ask-form');
    return !form || form.style.display === 'none' || form.style.display === '';
  }

  function paintButton() {
    var btn = $('ask-btn');
    var pay = $('verify-btn');
    if (!btn) return;

    if (isLocked()) {
      // Надпись и состояние берём у боевой кнопки оплаты, её ведёт sign.js
      var label = (pay && pay.textContent.trim()) || 'Pay & Unlock';
      var html = label + ' ' + ARROW;
      if (btn.innerHTML !== html) btn.innerHTML = html;
      if (btn.type !== 'button') btn.type = 'button';
      var d = pay ? !!pay.disabled : false;
      if (btn.disabled !== d) btn.disabled = d;
    } else {
      var done = 'Ask the Oracle ' + ARROW;
      if (btn.innerHTML !== done) btn.innerHTML = done;
      if (btn.type !== 'submit') btn.type = 'submit';
      if (btn.disabled) btn.disabled = false;
    }
  }

  var lastLocked = null;

  function syncLock() {
    var form = $('ask-form');
    if (!form) return;
    var locked = isLocked();
    // Выходим, если ничего не изменилось: наблюдатель слушает эту же
    // форму, а мы вешаем на неё класс - иначе запись вызывала бы себя.
    if (locked === lastLocked) return;
    lastLocked = locked;
    form.classList.toggle('is-locked', locked);
    paintButton();
  }

  function onAskClick(e) {
    if (!isLocked()) return;            // оплачено - обычная отправка формы
    e.preventDefault();
    if (!currentCategory()) { alert('Choose a category first.'); return; }
    var msg = ($('ask-message') || {}).value || '';
    if (!msg.trim()) { alert('Write your question first.'); return; }
    if (typeof autoPayAndUnlock === 'function') autoPayAndUnlock();
  }

  // Слушаем узко: и sign.js, и мы сами пишем внутрь этих узлов,
  // а широкая подписка замыкает наблюдателя на собственную запись.
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
    watchText($('verify-btn'), paintButton);

    var pay = $('verify-btn');
    if (pay) {
      new MutationObserver(paintButton).observe(pay,
        { attributes: true, attributeFilter: ['disabled'] });
    }

    var btn = $('ask-btn');
    if (btn) btn.addEventListener('click', onAskClick);

    document.addEventListener('change', function (e) {
      if (e.target.name === 'question-tier') syncSummary();
    });

    syncSummary();
    syncLock();
    paintButton();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
