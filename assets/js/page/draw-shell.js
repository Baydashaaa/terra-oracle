// Oracle Draw внутри Terra Oracle: оболочка раздела.
// Шаг 5а переноса.
//
// Этот файл рулит только витриной - заголовками, вкладками, подписью
// пула и запасным отсчётом. Колесо, поле Circuit, список победителей и
// проверка розыгрыша - настоящие модули из репозитория Draw, они сами
// цепляются к id в разметке.
//
// Слева выбор игры (Daily / Weekly / Circuit), справа выбор вида
// (Play / Winners / Verify & proof).
(function () {
  'use strict';

  var DRAW = {
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
      wheelCap: 'COUNCIL OF ORACLES',
      tiers: [
        { pc: '60%', v: '1st place', p: 'FIRST',  c: '244,212,119' },
        { pc: '25%', v: '2nd place', p: 'SECOND', c: '34,211,238' },
        { pc: '15%', v: '3rd place', p: 'THIRD',  c: '209,96,143' }
      ]
    },
    circuit: { tone: '56,217,208', left: 6960 }
  };

  var n = function (x) { return Number(x || 0).toLocaleString('en-US'); };
  var pad = function (v) { return String(v).padStart(2, '0'); };
  var $ = function (id) { return document.getElementById(id); };

  var mode = 'daily', sub = 'play';

  function start() {
    var view = $('page-draw');
    if (!view) return;

    var MODES = [['daily', 'Daily'], ['weekly', 'Weekly'], ['circuit', 'Circuit']];
    var SUBS  = [['play', 'Play'], ['winners', 'Winners'], ['verify', 'Verify & proof']];

    $('drawModes').innerHTML = MODES.map(function (p) {
      return '<button role="tab" data-m="' + p[0] + '">' + p[1] + '</button>';
    }).join('');
    $('drawSubs').innerHTML = SUBS.map(function (p) {
      return '<button role="tab" data-s="' + p[0] + '">' + p[1] + '</button>';
    }).join('');

    function paint() {
      var d = DRAW[mode];
      // --tone задаётся здесь и больше нигде: на нём держится вся расцветка
      // раздела - сумма пула, кнопка минта, поле Circuit, заголовки проверки.
      view.style.setProperty('--tone', d.tone);

      view.querySelectorAll('#drawModes button').forEach(function (b) {
        b.setAttribute('aria-selected', String(b.dataset.m === mode));
      });
      view.querySelectorAll('#drawSubs button').forEach(function (b) {
        b.setAttribute('aria-selected', String(b.dataset.s === sub));
      });
      view.querySelectorAll('.draw-pane').forEach(function (el) {
        el.hidden = el.dataset.pane !== sub;
      });

      var isCircuit = mode === 'circuit';
      $('stage-draw').hidden = isCircuit;
      $('stage-circuit').hidden = !isCircuit;

      // Движок читает это, чтобы понять, какой пул показывает
      if (!isCircuit) {
        window.currentLottery = mode;
        if (window.oracleDrawV2 && window.oracleDrawV2.setPool) window.oracleDrawV2.setPool(mode);
        return paintPool(d);
      }
    }

    function paintPool(d) {
      $('drawTitle').innerHTML = d.title;
      $('drawLead').textContent = d.lead;
      $('drawTiers').innerHTML = d.tiers
        ? '<div class="tiers">' + d.tiers.map(function (t) {
            return '<div class="tier" style="--c:' + t.c + '"><div class="pc">' + t.pc +
                   '</div><div class="v">' + t.v + '</div><div class="p">' + t.p + '</div></div>';
          }).join('') + '</div>'
        : '';
      $('poolLbl').textContent = d.poolLabel;
      $('poolAmt').textContent = n(d.pool);
      $('poolSub').textContent = d.minted + ' NFTs minted this round';

      var wrap = $('poolBarWrap');
      if (d.target) {
        wrap.hidden = false;
        $('poolBar').style.width = (d.pool / d.target * 100) + '%';
        $('poolNote').textContent = n(d.pool) + ' / ' + n(d.target) +
          ' LUNC. If the target is missed the funds roll over.';
      } else {
        wrap.hidden = true;
        $('poolNote').textContent = '';
      }
      $('wheel-panel-label').textContent = d.wheelCap;
    }

    view.querySelectorAll('#drawModes button').forEach(function (b) {
      b.addEventListener('click', function () { mode = b.dataset.m; paint(); });
    });
    view.querySelectorAll('#drawSubs button').forEach(function (b) {
      b.addEventListener('click', function () { sub = b.dataset.s; paint(); });
    });

    // Запасной отсчёт. Как только заработает DrawScheduler, часы ведёт он,
    // но пустого таймера на экране быть не должно ни секунды.
    var left = { daily: DRAW.daily.left, weekly: DRAW.weekly.left, circuit: DRAW.circuit.left };
    setInterval(function () {
      Object.keys(left).forEach(function (k) { if (left[k] > 0) left[k]--; });
      var t = left[mode] || 0;
      var box = $('drawClock');
      if (box) {
        box.querySelector('[data-u="d"]').textContent = pad(Math.floor(t / 86400));
        box.querySelector('[data-u="h"]').textContent = pad(Math.floor(t % 86400 / 3600));
        box.querySelector('[data-u="m"]').textContent = pad(Math.floor(t % 3600 / 60));
        box.querySelector('[data-u="s"]').textContent = pad(t % 60);
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
