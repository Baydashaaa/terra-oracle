// Рамка с Oracle Draw: подгонка высоты под содержимое.
//
// iframe сам под содержимое не растёт. Внутренняя страница шлёт свою
// высоту наружу через postMessage - домен один, поэтому обмен разрешён.
// Если сообщений нет (старая версия внутри), остаётся запасная высота.
//
// Зачем вообще: при высоте по экрану внутри рамки появляется своя полоса
// прокрутки, и колесо мыши над рамкой перестаёт листать страницу. Когда
// внутри прокручивать нечего, браузер отдаёт прокрутку наружу.
(function () {
  'use strict';

  var MIN = 900;

  // report() внутри молчит, пока разница меньше 24 пикселей. Без такого
  // же запаса рамка могла бы оказаться на эти 24 пикселя короче
  // содержимого, а прокрутки внутри больше нет - низ просто обрезало бы.
  var PAD = 24;

  function frame() { return document.getElementById('drawFrame'); }

  // Потолок. Внутри рамки vh считается от её высоты, поэтому любой
  // размер в vh замыкает круг "рамка выше -> содержимое выше -> рамка
  // выше". Один такой случай уже был (min-height:100vh у body), и он
  // разогнал страницу до 71244 пикселей. Потолок делает возможный
  // повтор безобидным: появится прокрутка внутри рамки - это видно
  // сразу, - а не полотно в десятки тысяч пикселей.
  var MAX = 6000;

  // Нижняя граница после первого сообщения. MIN (900) - только стартовая
  // высота до него: на телефоне содержимое бывает заметно короче.
  var FLOOR = 320;

  // Страховка от любой петли "рамка выше -> содержимое выше". Настоящий
  // рост содержимого (открыли вкладку, подгрузился список) - это один-два
  // скачка. Петля - серия мелких прибавок подряд. Если за 4 секунды было
  // 4 мелких роста, дальнейшие мелкие прибавки 10 секунд не принимаем.
  var smallGrowth = [], frozenUntil = 0;

  function setHeight(px) {
    var f = frame();
    if (!f) return;
    var cur = parseFloat(f.style.height) || 0;
    // Внутри сообщили ровно высоту рамки (или её минус запас): это не
    // содержимое, а что-то растянутое по vh. Не растём.
    if (cur && (Math.abs(px - cur) <= 2 || Math.abs(px + PAD - cur) <= 2)) return;
    var want = Math.min(MAX, Math.max(FLOOR, Math.ceil(px) + PAD));
    var now = Date.now();
    if (cur && want > cur && want - cur < 120) {
      if (now < frozenUntil) return;
      smallGrowth = smallGrowth.filter(function (t) { return now - t < 4000; });
      smallGrowth.push(now);
      if (smallGrowth.length >= 4) {
        frozenUntil = now + 10000;
        smallGrowth = [];
        if (window.console) console.warn('[draw-frame] repeated small growth, looks like a height loop; holding at', cur);
        return;
      }
    }
    var h = want + 'px';
    if (f.style.height !== h) f.style.height = h;
  }

  window.addEventListener('message', function (e) {
    // Принимаем только со своего же источника.
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (!d) return;

    if (d.type === 'oracle-draw:height') {
      var px = Number(d.height);
      if (isFinite(px) && px > 0) setHeight(px);
      return;
    }

    // oracle-draw:modal больше не обрабатываем. Окно встаёт по центру
    // видимой части рамки (переменные --host-top / --host-vh ниже),
    // и подкрутка страницы под него только дёргала бы экран.
  });

  // Какая часть рамки сейчас видна. Внутри рамки этого знать нельзя:
  // её собственная "видимая область" равна всей её высоте, поэтому
  // position:fixed там считается от полотна, а не от экрана человека.
  var sent = { top: -1, height: -1 };
  var queued = false;

  function sendViewport() {
    queued = false;
    var f = frame();
    if (!f || !f.contentWindow) return;

    var r = f.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;

    // Сколько рамки ушло вверх за край экрана и сколько её видно.
    var top = Math.max(0, -r.top);
    var height = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (height <= 0) return;                 // рамка вне экрана - молчим

    // Дрожание гасим порогом: прокрутка идёт пикселями, а перерисовывать
    // подложку на каждый пиксель незачем.
    if (Math.abs(top - sent.top) < 2 && Math.abs(height - sent.height) < 2) return;
    sent.top = top;
    sent.height = height;

    f.contentWindow.postMessage({
      type: 'oracle-draw:viewport',
      top: Math.round(top),
      height: Math.round(height)
    }, location.origin);
  }

  function queueViewport() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sendViewport);
  }

  addEventListener('scroll', queueViewport, { passive: true });
  addEventListener('resize', queueViewport);
  addEventListener('load', queueViewport);
  setInterval(queueViewport, 500);   // вкладки и раскладка меняют геометрию

  // Запасная высота: пока сообщение не пришло, рамка не должна быть пустой.
  function init() {
    var f = frame();
    if (f && !f.style.height) f.style.height = MIN + 'px';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
