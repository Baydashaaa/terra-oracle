// Правая колонка: карточка Next draw.
//
// Цифры НЕ считаются здесь. Их присылает рамка с Oracle Draw: там
// работает pool-timer.js, который знает про фактический раунд, переносы
// и пропуски. Свой расчёт по расписанию давал расхождение в минуты.
//
// Переключатель Daily / Weekly / Circuit меняет и карточку, и игру
// внутри рамки - выбор в одном месте ведёт в нужную игру.
(function () {
  'use strict';

  var tab = 'daily';
  var card = null;
  var stats = {};      // последнее, что прислала рамка

  function $(sel) { return card ? card.querySelector(sel) : null; }

  function frame() { return document.getElementById('drawFrame'); }

  function send(name) {
    var f = frame();
    if (f && f.contentWindow) {
      f.contentWindow.postMessage({ type: 'oracle-draw:go', tab: name }, location.origin);
    }
  }

  function paint() {
    if (!card) return;

    card.querySelectorAll('.seg button').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });

    var d = stats[tab] || {};

    // Часы. Рамка присылает готовую строку вида "3d 07:42" или "1h 18m" -
    // разбираем её на клетки, а если формата нет, показываем как есть.
    var box = $('[data-clock]');
    if (box) {
      var t = String(d.tick || '');
      var set = function (u, v) { var e = box.querySelector('[data-u="' + u + '"]'); if (e) e.textContent = v; };
      // Форматы разные: у розыгрышей "3d 07:42:11", у Circuit "33m" или
      // "1h 18m", а во время розыгрыша просто "drawing". Разбираем все,
      // а неизвестное показываем прочерками - чужие цифры хуже пустоты.
      var hms = t.match(/(?:(\d+)d\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      var hm  = t.match(/(?:(\d+)h\s*)?(\d+)m$/);
      if (hms) {
        set('h', (hms[1] ? hms[1] + 'd ' : '') + hms[2]);
        set('m', hms[3]);
        set('s', hms[4] || '00');
      } else if (hm) {
        set('h', hm[1] || '00');
        set('m', hm[2]);
        set('s', '00');
      } else {
        set('h', '--'); set('m', '--'); set('s', '--');
      }
    }

    var lbl = $('[data-pool-label]');
    if (lbl) {
      lbl.textContent = tab === 'circuit' ? 'Zones claimed'
                      : tab === 'weekly'  ? 'Weekly prize pool'
                      :                     'Prize pool';
    }

    // Сумма. У Circuit это число занятых зон, а не LUNC - подпись и
    // значение должны меняться вместе, иначе выходит "Zones claimed
    // 1,250,000 LUNC".
    var amt = $('[data-pool-amount]') || $('.amount');
    if (amt && d.pool) {
      amt.textContent = d.pool + (tab === 'circuit' ? ' / 250' : '');
    }
    var unit = card.querySelector('.amount small, [data-pool-unit]');
    if (unit) unit.style.display = tab === 'circuit' ? 'none' : '';

    // Секунды есть только у розыгрышей: Circuit отдаёт минуты.
    var secCell = box && box.querySelector('[data-u="s"]');
    if (secCell && secCell.parentElement) {
      secCell.parentElement.style.display = tab === 'circuit' ? 'none' : '';
    }

    var extra = $('[data-extra]');
    if (extra) extra.style.display = tab === 'circuit' ? '' : 'none';
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (!d || d.type !== 'oracle-draw:stats') return;
    stats = d.games || {};
    paint();
  });

  function open(name) {
    tab = name;
    paint();
    if (typeof showPage === 'function') showPage('draw');
    // Подсветку верхнего ряда двигаем через него же, чтобы два
    // переключателя не разошлись.
    if (window.drawTabs && window.drawTabs.open) window.drawTabs.open(name);
    else send(name);
  }

  function start() {
    var seg = document.querySelector('.side .seg [data-tab="daily"]');
    card = seg && seg.closest('.card');
    if (!card) return;

    card.querySelectorAll('.seg button').forEach(function (b) {
      // Клик по игре и выбирает её в карточке, и открывает раздел на ней.
      // Только меняем показания. Раздел открывает кнопка View details -
      // выбирать игру и проваливаться в неё одним кликом неожиданно.
      b.addEventListener('click', function () { tab = b.dataset.tab; paint(); });
    });

    var cta = $('[data-cta]') || card.querySelector('button.wide');
    if (cta) cta.addEventListener('click', function () { open(tab); });

    paint();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
