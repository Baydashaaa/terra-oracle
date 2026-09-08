/**
 * Oracle Draw V2 - DrawScheduler
 *
 * Один секундный таймер вместо частокола setInterval.
 * Каждую секунду: tick() для обратного отсчёта, и решение - пора ли в сеть.
 *
 * Почему не setInterval(update, 5000):
 *  - 17 280 запросов в сутки с каждой открытой вкладки, притом что файл
 *    меняется раз в день;
 *  - вкладка в фоне на мобиле всё равно тротлится браузером - лучше явно
 *    уйти в редкий режим и сделать мгновенную проверку при возврате;
 *  - двойной start() давал два независимых таймера.
 */

import { CONFIG } from "./Config.js";

export default class DrawScheduler {

    constructor(engine) {
        this.engine = engine;
        this.timer = null;
        this.lastPoll = 0;
        this.running = false;

        this.onVisibility = () => {
            if (!document.hidden) this.pollNow();
        };
        this.onOnline = () => this.pollNow();
    }

    start() {
        if (this.running) return;         // защита от двойного запуска
        this.running = true;

        document.addEventListener("visibilitychange", this.onVisibility);
        window.addEventListener("online", this.onOnline);

        this.pollNow();                   // первый запрос сразу, не через 5 секунд

        this.timer = setInterval(() => {
            const now = Date.now();
            this.engine.tick();

            const interval = this.engine.pollInterval(document.hidden);
            if (now - this.lastPoll >= interval) this.pollNow();
        }, 1000);
    }

    stop() {
        if (!this.running) return;
        this.running = false;
        clearInterval(this.timer);
        this.timer = null;
        document.removeEventListener("visibilitychange", this.onVisibility);
        window.removeEventListener("online", this.onOnline);
    }

    /** Внеочередной опрос (возврат на вкладку, кнопка Refresh, после минта) */
    pollNow(opts) {
        this.lastPoll = Date.now();
        return this.engine.update(opts);
    }
}
