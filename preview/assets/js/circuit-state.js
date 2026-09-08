/* ═══════════════════════════════════════════════════════════════════════════
   CIRCUIT - единственный опросчик /circuit/state
   ---------------------------------------------------------------------------
   ЗАЧЕМ. До этого файла состояние раунда тянули ТРИ независимых таймера с
   одной страницы: refreshCircuit() в index.html (20 с), circuit-board.js
   (20 с) и circuit-reveal.js (5 с), плюс четвёртый - дополнительный
   пятисекундный fast-poll, который refreshCircuit заводил на время розыгрыша,
   не гася при этом свой двадцатисекундный. Выходило ~25 900 запросов в сутки
   с ОДНОЙ открытой вкладки: две-три вкладки съедали половину дневного лимита
   Workers KV, четыре выбирали весь лимит запросов Workers и воркер начинал
   отдавать 429 всем подряд.

   ЧТО ДЕЛАЕТ. Один fetch на всех, результат раздаётся подписчикам. Плюс две
   вещи, которых не было ни у одного из трёх:

   1. Пауза по видимости. Свёрнутая вкладка не стучит вообще; при возврате
      идёт немедленный запрос, чтобы человек не смотрел на устаревшие цифры.
   2. Такт по состоянию раунда. Обычно 20 секунд, но как только msLeft <= 0
      (дедлайн прошёл, ждём раннера) - 5 секунд, чтобы доска сама перекинулась
      на новый раунд и показ розыгрыша не опоздал. Ровно то, ради чего был
      нужен прежний fast-poll, но без второго параллельного таймера.

   ПОДКЛЮЧЕНИЕ: обычный <script>, ПОСЛЕ app.js (нужен DRAW_WORKER) и ДО
   circuit-board.js / circuit-reveal.js.

   API:
     CircuitState.subscribe(fn)  fn(state) на каждый успешный ответ; если
                                 ответ уже есть, вызывается сразу же
     CircuitState.get()          последний ответ или null
     CircuitState.refresh()      внеочередной запрос (после покупки зон),
                                 возвращает промис с состоянием
     CircuitState.unsubscribe(fn)

   Ошибки глотаются молча и НЕ раздаются подписчикам: у всех троих потребителей
   логика «нет данных - оставить экран как есть», и мигать прочерками на каждом
   сетевом сбое хуже, чем показывать цифры десятисекундной давности.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const IDLE_MS   = 20000;  // обычный такт
  const HOT_MS    = 5000;   // дедлайн прошёл, ждём closing
  const MIN_GAP_MS = 3000;  // минимальный зазор между запросами

  const base = () => (typeof DRAW_WORKER !== 'undefined' ? DRAW_WORKER : '');

  const subs = [];
  let last = null;          // последний успешный ответ
  let lastAt = 0;           // когда он получен
  let inFlight = null;      // текущий запрос, чтобы не пускать второй
  let timer = null;
  let period = IDLE_MS;

  const isHidden = () => (typeof document.visibilityState === 'string'
    ? document.visibilityState === 'hidden'
    : !!document.hidden);

  function emit(state) {
    for (let i = 0; i < subs.length; i++) {
      // Один упавший подписчик не должен ронять остальных.
      try { subs[i](state); } catch (e) { /* noop */ }
    }
  }

  // Такт зависит только от того, прошёл ли дедлайн. Пересобираем таймер лишь
  // при смене периода - иначе каждый ответ сдвигал бы следующий запрос.
  function retune(state) {
    const want = (state && Number(state.msLeft) <= 0) ? HOT_MS : IDLE_MS;
    if (want === period) return;
    period = want;
    schedule();
  }

  function stop() {
    // Именно !== null, а не if (timer): идентификатор таймера бывает нулём,
    // и на проверке «правдивости» такой таймер тихо остаётся жить.
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  function schedule() {
    stop();
    if (isHidden()) return;                  // фоновая вкладка молчит
    timer = setInterval(() => { poll(false); }, period);
  }

  function poll(force) {
    if (inFlight) return inFlight;
    if (!force && Date.now() - lastAt < MIN_GAP_MS) return Promise.resolve(last);

    inFlight = (async () => {
      try {
        const r = await fetch(base() + '/circuit/state',
                              { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return last;
        const d = await r.json();
        if (!d) return last;
        last = d;
        lastAt = Date.now();
        emit(d);
        retune(d);
        return d;
      } catch (e) {
        return last;
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  document.addEventListener('visibilitychange', function () {
    if (isHidden()) {
      stop();
    } else {
      poll(true);        // вернулись - показываем свежее, а не то, что было
      schedule();
    }
  });

  window.CircuitState = {
    get: () => last,
    refresh: () => poll(true),
    subscribe: function (fn) {
      if (typeof fn !== 'function' || subs.indexOf(fn) !== -1) return;
      subs.push(fn);
      if (last) { try { fn(last); } catch (e) {} }
    },
    unsubscribe: function (fn) {
      const i = subs.indexOf(fn);
      if (i !== -1) subs.splice(i, 1);
    },
  };

  function boot() {
    // Страница без сцены Circuit (нет ни рельса, ни доски) опрашивать нечего.
    if (!document.getElementById('stage-circuit') &&
        !document.getElementById('dg-circuit-zones')) return;
    poll(true);
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
