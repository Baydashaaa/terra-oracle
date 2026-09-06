/**
 * Oracle Draw V2 - Event Bus
 *
 * Отличия от наивной версии:
 *  - off() и once() - иначе при switchLottery подписки копятся и колесо
 *    крутится по два-три раза на один результат;
 *  - каждый слушатель в своём try/catch - упавшая анимация не должна
 *    убивать popup, нотификацию и всё, что подписалось после неё;
 *  - "*" - подписка на все события (удобно для отладки).
 */

export const EVENTS = {
    READY: "READY",                   // первый успешный load, базовая линия выставлена
    DATA_UPDATED: "DATA_UPDATED",     // winners.json изменился
    ROUND_CHANGED: "ROUND_CHANGED",   // сменился round_id текущего пула
    RESULT_READY: "RESULT_READY",     // результат доступен - отрисовать статично
    DRAW_FINISHED: "DRAW_FINISHED",   // КРУТИТЬ КОЛЕСО (только когда это уместно)
    DRAW_SKIPPED: "DRAW_SKIPPED",     // раунд не состоялся (мало билетов и т.п.)
    PHASE_CHANGED: "PHASE_CHANGED",   // OPEN → LOCKED → PRE_DRAW → AWAITING → REVEALING → REVEALED
    TICK: "TICK",                     // раз в секунду, для обратного отсчёта
    ERROR: "ERROR"                    // сеть/парсинг
};

export default class DrawEvents {

    constructor() {
        this.listeners = Object.create(null);
    }

    on(event, callback) {
        if (typeof callback !== "function") return () => {};
        (this.listeners[event] ||= []).push(callback);
        return () => this.off(event, callback);   // возвращаем "отписку"
    }

    once(event, callback) {
        const wrapper = (data) => {
            this.off(event, wrapper);
            callback(data);
        };
        return this.on(event, wrapper);
    }

    off(event, callback) {
        const list = this.listeners[event];
        if (!list) return;
        if (!callback) {
            delete this.listeners[event];
            return;
        }
        const i = list.indexOf(callback);
        if (i !== -1) list.splice(i, 1);
    }

    emit(event, data) {
        const run = (fn, payload) => {
            try {
                fn(payload);
            } catch (err) {
                console.error(`[DrawEvents] listener failed on ${event}:`, err);
            }
        };

        // копия массива: слушатель может отписаться прямо в обработчике
        (this.listeners[event] || []).slice().forEach(fn => run(fn, data));
        (this.listeners["*"] || []).slice().forEach(fn => run(fn, { event, data }));
    }

    clear() {
        this.listeners = Object.create(null);
    }
}
