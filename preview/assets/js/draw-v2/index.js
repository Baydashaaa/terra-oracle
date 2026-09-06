/**
 * Oracle Draw V2 - точка входа.
 *
 * Ничего не ломает в старом app.js: только читает winners.json и эмитит
 * события. Пока к ним никто не подписан - система работает вхолостую.
 *
 * Подключение (index.html, ПОСЛЕ старых скриптов):
 *   <script type="module" src="/assets/js/draw-v2/index.js?v=1"></script>
 *
 * Отладка: открыть страницу с ?draw-v2-debug - в консоли будет весь поток
 * событий, а window.oracleDrawV2 даст ручной доступ.
 */

import DrawEngine from "./DrawEngine.js";
import DrawScheduler from "./DrawScheduler.js";
import DrawBridge from "./DrawBridge.js";
import { EVENTS } from "./DrawEvents.js";
import { PHASE } from "./DrawPhase.js";
import { CONFIG } from "./Config.js";
import { formatCountdown, nextDeadline, prevDeadline } from "./DrawClock.js";

if (new URLSearchParams(location.search).has("draw-v2-debug")) {
    CONFIG.DEBUG = true;
}

// Стартуем с того пула, который открыт на странице (вкладки старого app.js)
const initialPool = (window.currentLottery === CONFIG.WEEKLY) ? CONFIG.WEEKLY : CONFIG.DAILY;

const engine = new DrawEngine(initialPool);
const scheduler = new DrawScheduler(engine);
const bridge = new DrawBridge(engine).attach();

// Пока снимка билетов нет (старые раунды, или lottery-draw.js ещё не
// обновлён) - колесо остаётся за старым рендером app.js. Как только
// модель построена, канвас переходит к V2.
engine.on(EVENTS.RESULT_READY, ({ model }) => {
    if (model && model.total > 0 && window.oracleDrawV2) window.oracleDrawV2.ownsWheel = true;
});

if (CONFIG.DEBUG) {
    engine.on("*", ({ event, data }) => {
        if (event === EVENTS.TICK) return;              // не засоряем консоль
        console.log(`%c[DrawV2] ${event}`, "color:#7ec8ff", data);
    });
}

window.oracleDrawV2 = {
    ownsWheel: false,
    engine,
    scheduler,
    bridge,
    CONFIG,
    EVENTS,
    PHASE,
    utils: { formatCountdown, nextDeadline, prevDeadline },

    // короткие обёртки для консоли и для будущего UI
    on: (e, cb) => engine.on(e, cb),
    off: (e, cb) => engine.off(e, cb),
    refresh: () => scheduler.pollNow({ force: true }),
    refreshLive: () => bridge.refreshLive(),
    setPool: (p) => engine.setPool(p),
    replay: () => engine.replay(),
    model: () => engine.model,
    phase: () => engine.phase,
    state: () => engine.snapshot(),
    history: () => engine.history()
};

// стартуем последним: к этому моменту window.oracleDrawV2 уже есть
scheduler.start();

export { engine, scheduler, bridge };
