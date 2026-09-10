// Oracle Draw внутри Terra Oracle: оболочка раздела.
//
// Один ряд вкладок, шесть разделов: Daily, Weekly, Circuit, Winners,
// Verify & proof, About. Вкладки Play нет - выбор игры и есть выбор
// раздела, отдельный переключатель был лишним уровнем.
//
// Файл рулит только витриной: заголовками, вкладками, подписью пула и
// запасным отсчётом. Колесо, поле Circuit, список победителей и проверка
// розыгрыша - настоящие модули из репозитория Draw, они сами цепляются
// к id в разметке.
(function () {
  'use strict';

  var POOLS = {
    daily: {
      tone: '244,212,119', title: 'DAILY<br>DRAW',
      lead: 'Mint an NFT. Activate it. Win the daily pool.',
      poolLabel: 'CURRENT PRIZE POOL', pool: 0, minted: 0, left: 65370,
      wheelCap: 'ORACLE WHEEL'
    },
    weekly: {
      tone: '185,140,255', title: 'WEEKLY<br>DRAW',
      lead: 'Mint an NFT. Activate it. Win the weekly pool.',
      poolLabel: 'WEEKLY PRIZE POOL', pool: 0, minted: 0, target: 800000, left: 153549,
      wheelCap: 'COUNCIL OF ORACLES'
    }
  };

  // вкладка -> [подпись, какая панель показывается, тон раздела]
  var TABS = [
    ['daily',   'Daily',           'play',    '244,212,119'],
    ['weekly',  'Weekly',          'play',    '185,140,255'],
    ['circuit', 'Circuit',         'play',    '56,217,208'],
    ['winners', 'Winners',         'winners', '244,212,119'],
    ['verify',  'Verify & proof',  'verify',  '168,85,247'],
    ['about',   'About',           'about',   '110,135,235']
  ];

  var TIERS = [
    { pc: '60%', v: '1st place', p: 'FIRST',  c: '244,212,119' },
    { pc: '25%', v: '2nd place', p: 'SECOND', c: '34,211,238' },
    { pc: '15%', v: '3rd place', p: 'THIRD',  c: '209,96,143' }
  ];

  var n = function (x) { return Number(x || 0).toLocaleString('en-US'); };
  var pad = function (v) { return String(v).padStart(2, '0'); };
  var $ = function (id) { return document.getElementById(id); };

  var tab = 'daily';
  var view = null;

  // Одна упавшая часть не должна утаскивать за собой остальные:
  // раньше ошибка в отрисовке пула гасила и вкладки, и панели.
  function safe(label, fn) {
    try { fn(); } catch (e) { console.warn('[draw-shell] ' + label + ':', e); }
  }

  function def(k) { return TABS.filter(function (t) { return t[0] === k; })[0] || TABS[0]; }

  function paint() {
    var t = def(tab);
    var pane = t[2];

    safe('тон', function () { view.style.setProperty('--tone', t[3]); });

    safe('вкладки', function () {
      view.querySelectorAll('#drawModes button').forEach(function (b) {
        b.setAttribute('aria-selected', String(b.dataset.m === tab));
      });
    });

    safe('панели', function () {
      view.querySelectorAll('.draw-pane').forEach(function (el) {
        el.hidden = el.dataset.pane !== pane;
      });
    });

    safe('сцена', function () {
      var isCircuit = tab === 'circuit';
      var sd = $('stage-draw'), sc = $('stage-circuit');
      if (sd) sd.hidden = pane !== 'play' || isCircuit;
      if (sc) sc.hidden = pane !== 'play' || !isCircuit;
    });

    if (tab !== 'daily' && tab !== 'weekly') return;

    safe('пул', function () { paintPool(tab); });

    safe('движок', function () {
      window.currentLottery = tab;
      if (window.oracleDrawV2 && window.oracleDrawV2.setPool) window.oracleDrawV2.setPool(tab);
    });
  }

  function paintPool(key) {
    var d = POOLS[key];
    var set = function (id, prop, val) { var e = $(id); if (e) e[prop] = val; };

    set('drawTitle', 'innerHTML', d.title);
    set('drawLead', 'textContent', d.lead);
    set('drawTiers', 'innerHTML', key === 'weekly'
      ? '<div class="tiers">' + TIERS.map(function (t) {
          return '<div class="tier" style="--c:' + t.c + '"><div class="pc">' + t.pc +
                 '</div><div class="v">' + t.v + '</div><div class="p">' + t.p + '</div></div>';
        }).join('') + '</div>'
      : '');
    set('poolLbl', 'textContent', d.poolLabel);
    set('poolAmt', 'textContent', n(d.pool));
    set('poolSub', 'textContent', d.minted + ' NFTs minted this round');
    set('wheel-panel-label', 'textContent', d.wheelCap);

    var wrap = $('poolBarWrap');
    if (!wrap) return;
    if (d.target) {
      wrap.hidden = false;
      var bar = $('poolBar');
      if (bar) bar.style.width = (d.pool / d.target * 100) + '%';
      set('poolNote', 'textContent', n(d.pool) + ' / ' + n(d.target) +
        ' LUNC. If the target is missed the funds roll over.');
    } else {
      wrap.hidden = true;
      set('poolNote', 'textContent', '');
    }
  }

  function start() {
    view = $('page-draw');
    if (!view) return;

    var modes = $('drawModes');
    if (!modes) { console.warn('[draw-shell] нет #drawModes'); return; }

    modes.innerHTML = TABS.map(function (t) {
      return '<button role="tab" data-m="' + t[0] + '">' + t[1] + '</button>';
    }).join('');

    // Второй ряд вкладок больше не нужен - всё в одном.
    var subs = $('drawSubs');
    if (subs) { subs.innerHTML = ''; subs.hidden = true; }

    modes.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { tab = b.dataset.m; paint(); });
    });

    // Запасной отсчёт. Как только заработает DrawScheduler, часы ведёт он,
    // но пустого таймера на экране быть не должно ни секунды.
    var left = { daily: POOLS.daily.left, weekly: POOLS.weekly.left, circuit: 6960 };
    setInterval(function () {
      Object.keys(left).forEach(function (k) { if (left[k] > 0) left[k]--; });
      var t = left[tab] || 0;
      var box = $('drawClock');
      if (box) {
        var u = function (k, v) { var e = box.querySelector('[data-u="' + k + '"]'); if (e) e.textContent = v; };
        u('d', pad(Math.floor(t / 86400)));
        u('h', pad(Math.floor(t % 86400 / 3600)));
        u('m', pad(Math.floor(t % 3600 / 60)));
        u('s', pad(t % 60));
      }
      var cl = $('cir-left');
      if (cl && !cl.dataset.live) {
        cl.textContent = Math.floor(left.circuit / 3600) + 'h ' +
                         Math.floor(left.circuit % 3600 / 60) + 'm';
      }
    }, 1000);

    paint();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
