/**
 * Oracle Draw V2 - DrawBridge
 *
 * Связывает фазы движка с колесом и старым UI. Собственной физики и
 * собственного цикла кадров здесь больше нет - всё это живёт в
 * assets/js/wheel/. Мост только переводит фазу в команду.
 *
 *   PRE_DRAW / AWAITING → wheel.preDraw()   (холостое вращение, луч Оракула)
 *   DRAW_FINISHED       → wheel.spinToIndex(winner_index)
 *   REVEALED (перезаход)→ wheel.snapToIndex(...) без анимации
 */

import { EVENTS } from "./DrawEvents.js";
import { PHASE, PHASE_TEXT } from "./DrawPhase.js";
import { CONFIG } from "./Config.js";
import WheelRenderer from "../wheel/WheelRenderer.js";
import SectorDetails from "./SectorDetails.js";
import TicketModel from "../wheel/TicketModel.js";

export default class DrawBridge {

    constructor(engine) {
        this.engine = engine;
        this.wheel = null;
        // В каком пуле колесо нарисовано СЕЙЧАС. WheelRenderer.setPool() меняет
        // тему, но сам пул не хранит, а сравнивать надо - иначе на каждом тике
        // пересобираются частицы.
        this.wheelPool = null;
        this.queue = [];
        this.round = null;
        this.lastCard = null;
        this.details = new SectorDetails();
        this.unsubs = [];
    }

    get ui() { return window.OracleDrawUI || null; }

    attach() {
        const on = (e, fn) => this.unsubs.push(this.engine.on(e, fn));

        // Поднимаем колесо сразу: пустое, но живое. Ждать данных нельзя -
        // в раунде без минтов их не будет вовсе.
        const boot = () => { this.refreshLive(); this.startIdle(); };
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", boot, { once: true });
        } else {
            setTimeout(boot, 0);
        }

        on(EVENTS.PHASE_CHANGED, ({ to }) => this.onPhase(to));
        on(EVENTS.TICK, t => this.onTick(t));
        on(EVENTS.DRAW_FINISHED, ({ round, model }) => this.reveal(round, model));
        on(EVENTS.RESULT_READY, ({ round, model, firstLoad, verified }) => {
            if (model) this.mount(model, round.pool);
            if (firstLoad && !round.skipped && verified) this.showStatic(round, model);
            else if (firstLoad && !round.skipped) this.showStatic(round, null);
        });
        on(EVENTS.DRAW_SKIPPED, ({ round }) => this.showRollover(round));
        // Переключение пула или страницы прячет карточку средствами app.js -
        // возвращаем её из текущего состояния, а не только на первой загрузке.
        on(EVENTS.DATA_UPDATED, () => this.syncCard());
        on(EVENTS.ROUND_CHANGED, () => {
            if (typeof window.loadWinners === "function") window.loadWinners();
        });
        return this;
    }

    detach() {
        this.unsubs.forEach(off => off());
        this.unsubs = [];
        if (this.wheel) this.wheel.destroy();
        this.wheel = null;
    }

    /* ── колесо ── */


    /**
     * Модель по ЖИВЫМ участникам текущего раунда - чтобы колесо было видно
     * до розыгрыша, а не только после появления снимка.
     *
     * Снимок остаётся авторитетным: он замораживает порядок билетов в момент
     * розыгрыша, и только по нему считается winner_index. Этот список -
     * предварительный показ, verified у него не бывает.
     */
    /**
     * Привести карточку победителя в соответствие с текущим раундом.
     * switchLottery в app.js ставит ей display:none, и без этого она
     * не возвращалась до перезагрузки страницы.
     */
    syncCard() {
        const ui = this.ui;
        if (!ui || !ui.card) return;
        if (this.engine.state.revealing) return;

        const round = this.engine.state.round;
        if (!round || round.skipped || !round.winners.length) { this.lastCard = null; return; }

        const w = round.winners[0];
        this.lastCard = {
            address: w.address, prize: w.prize, tx: w.tx,
            // дата и пул нужны карточке, чтобы подписать раунд и опознать
            // результат недельной давности как несвежий
            date: round.date, pool: round.pool,
            label: round.winners.length > 1 ? "1st Place" : null
        };
        ui.card(this.lastCard);
    }

    /**
     * Держать карточку победителя в актуальном виде.
     *
     * Зовётся каждую секунду и сама решает, надо ли что-то делать:
     *  - карточки нет, а победитель в состоянии есть → показать;
     *  - карточку спрятал switchLottery из app.js → вернуть;
     *  - всё на месте → выйти, ничего не трогая (иначе CSS-анимация
     *    появления перезапускалась бы каждую секунду).
     *
     * Через события это не решается: DATA_UPDATED движок эмитит ДО того,
     * как подставит раунд в state, а следующий раз он придёт только при
     * изменении winners.json - раз в сутки.
     */
    ensureCard() {
        if (this.engine.state.revealing) return;

        const round = this.engine.state.round;
        if (!round || round.skipped || !round.winners.length) return;

        const el = document.getElementById("wheel-winner-card");
        if (!el) return;

        const hidden = !el.style.display || el.style.display === "none";
        if (this.lastCard && !hidden) return;

        this.syncCard();
    }

    /**
     * Клик по сектору открывает окно с NFT кошелька.
     * Во время вращения клики игнорируем - иначе окно перекроет розыгрыш.
     */
    bindPointer(renderer) {
        const canvas = renderer.canvas;
        if (!canvas || canvas._oracleBound) return;
        if (typeof canvas.addEventListener !== "function") return;
        canvas._oracleBound = true;

        canvas.addEventListener("click", (e) => {
            if (this.engine.state.revealing) return;
            const sector = renderer.sectorAt(e.clientX, e.clientY);
            if (!sector) return;
            const total = renderer.model ? renderer.model.total : 0;
            this.details.open(sector, renderer.theme, this.ui, total);
        });

        canvas.addEventListener("mousemove", (e) => {
            if (this.engine.state.revealing) { canvas.style.cursor = ""; return; }
            canvas.style.cursor = renderer.sectorAt(e.clientX, e.clientY) ? "pointer" : "";
        });

        canvas.addEventListener("mouseleave", () => { canvas.style.cursor = ""; });
    }

    /** Показать колесо в холостом вращении, даже если данных ещё нет */
    startIdle() {
        const r = this.ensure(this.engine.pool);
        if (!r) { setTimeout(() => this.startIdle(), 400); return; }   // канвас ещё не в DOM
        if (!r.model) r.setModel(this.liveModel || null);
        this.bindPointer(r);
        r.idle();
        r.start();
        if (window.oracleDrawV2) window.oracleDrawV2.ownsWheel = true;
    }

    refreshLive() {
        const ui = this.ui;
        if (!ui || !ui.participants) return;

        // Пул страницы - источник правды для движка, и сверять его надо ДО
        // любых ранних выходов.
        //
        // Здесь был баг: эта сверка стояла НИЖЕ `if (state.model) return`.
        // Пока ни один раунд не имел снимка, state.model всегда был null и
        // сверка отрабатывала. Как только появился первый снимок
        // (weekly_2026-08-03), метод стал выходить раньше - движок переставал
        // узнавать о переключении вкладки, и колесо оставалось в теме
        // прежнего пула: на Weekly крутилось daily-колесо.
        const pagePool = ui.pool ? ui.pool() : this.engine.pool;
        if (pagePool && pagePool !== this.engine.pool) {
            this.engine.setPool(pagePool);   // асинхронный: подтянет раунд нового пула
            this.lastCard = null;
            // Тему меняем сразу, не дожидаясь загрузки: иначе колесо висит в
            // чужих цветах до прихода ROUND_CHANGED, а если у нового пула
            // раунда ещё нет - то и вовсе остаётся чужим.
            this.ensure(pagePool);
        }

        if (this.engine.state.revealing) return;      // во время анимации не трогаем

        // Снимок главнее - но только пока показываем ТОТ раунд.
        //
        // Здесь был баг: выход стоял безусловным. state.model - снимок
        // завершённого раунда, поднятый при старте из winners.json; пока он
        // есть, живые участники не рисовались вообще. Колесо показывало
        // состав прошлого раунда, а счётчики под ним - текущего. Переключение
        // вкладки звало setPool(), тот сбрасывал модель, и всё «чинилось».
        //
        // В OPEN, LOCKED и ROLLOVER идёт уже НОВЫЙ раунд: снимок устарел,
        // и вытеснять его должны живые входы.
        const _ph = this.engine.state.phase;
        const _stillShowingThatRound =
            _ph !== PHASE.OPEN && _ph !== PHASE.LOCKED && _ph !== PHASE.ROLLOVER;
        if (this.engine.state.model && _stillShowingThatRound) return;

        // Пустой раунд - тоже состояние: колесо крутится вхолостую и пишет
        // «No entries yet». Раньше здесь стоял return, и канвас оставался
        // чёрным до первого минта.

        const pairs = (ui.participants() || []).filter(p => p && p[1] > 0);
        const model = new TicketModel({ tickets: pairs }, { maxSectors: 48 });

        this.liveModel = model;
        this.mount(model, ui.pool ? ui.pool() : this.engine.pool);
        if (window.oracleDrawV2) window.oracleDrawV2.ownsWheel = true;
    }

    ensure(pool) {
        if (this.wheel) {
            // Раньше здесь был просто `return this.wheel` - колесо отдавалось
            // как есть, в теме того пула, с которым его когда-то создали.
            if (pool && pool !== this.wheelPool) {
                this.wheel.setPool(pool);
                this.wheelPool = pool;
            }
            return this.wheel;
        }
        const canvas = document.getElementById("wheel-canvas");
        if (!canvas) return null;
        const reduced = typeof matchMedia === "function" &&
            matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.wheel = new WheelRenderer(canvas, { pool, reducedMotion: reduced });
        this.wheelPool = pool;
        this.wheel.start();
        addEventListener("resize", () => this.wheel && this.wheel.resize());
        return this.wheel;
    }

    mount(model, pool) {
        // ensure() уже привёл тему к pool (или создал колесо сразу в ней -
        // конструктор WheelRenderer берёт тему из opts.pool). Повторный
        // setPool() здесь только зря пересобирал бы частицы.
        const w = this.ensure(pool);
        if (!w) return;
        w.setModel(model);
    }

    /* ── фазы ── */

    onPhase(phase) {
        const ui = this.ui;
        const w = this.wheel;

        if (phase === PHASE.PRE_DRAW || phase === PHASE.AWAITING) {
            if (w) w.preDraw();
            if (ui) { ui.entriesOpen(false); if (ui.wakeOracleEye) ui.wakeOracleEye(true); }
            return;
        }
        if (phase === PHASE.REVEALING) {
            if (ui) ui.entriesOpen(false);
            return;
        }
        if (w && phase !== PHASE.REVEALED) w.idle();
        if (ui) {
            ui.entriesOpen(phase === PHASE.OPEN || phase === PHASE.ROLLOVER);
            if (ui.wakeOracleEye) ui.wakeOracleEye(false);
        }
    }

    onTick({ phase, remaining }) {
        this.ensureCard();
        const ui = this.ui;
        if (!ui || phase === PHASE.REVEALING || phase === PHASE.REVEALED) return;
        const text = PHASE_TEXT[phase];
        if (!text) return;
        const t = remaining !== null ? ui.fmtShort(remaining) : "";
        ui.msg(text.title.replace("{t}", t), text.sub.replace("{t}", t), phaseColor(phase));
    }

    /* ── розыгрыш ── */

    reveal(round, model) {
        const w = this.ensure(round.pool);
        if (!w || !model) { this.showStatic(round, null); return; }

        this.mount(model, round.pool);
        this.round = round;
        this.queue = round.winners.slice();
        this.engine.beginReveal();
        this.next();
    }

    next() {
        const w = this.queue.shift();
        if (!w) {
            this.engine.endReveal();
            if (this.ui) {
                this.ui.msg(
                    this.round.winners.length > 1 ? "All Winners Selected" : "Winner Selected",
                    "Payouts sent automatically", "#66ffaa"
                );
            }
            return;
        }

        const index = w.index ?? this.round.winnerIndex;
        this.wheel.onLanded = () => {
            this.wheel.onLanded = null;
            if (this.ui) {
                this.lastCard = {
                    address: w.address, prize: w.prize, tx: w.tx,
                    date: this.round.date, pool: this.round.pool,
                    label: this.round.winners.length > 1 ? placeLabel(w.place) : null
                };
                this.ui.card(this.lastCard);
            }
            setTimeout(() => this.next(), CONFIG.REVEAL_HOLD);
        };

        if (this.ui) {
            this.ui.msg("Selecting winner",
                `Ticket #${index} of ${this.wheel.model.total}`, "#00c8ff");
        }
        if (!this.wheel.spinToIndex(index)) { this.wheel.onLanded = null; this.next(); }
    }

    /* ── статика ── */

    showStatic(round, model) {
        const ui = this.ui;
        if (!ui || round.skipped) return;
        const w = round.winners[0];
        if (!w) return;
        if (model && this.wheel && round.winnerIndex !== null) {
            this.wheel.snapToIndex(round.winnerIndex);
        }
        ui.msg("Winner Selected",
            model ? (round.date ? "Draw of " + round.date : "Payout sent automatically")
                  : "Result verified on-chain - replay unavailable for this round",
            "#66ffaa");
        ui.card({ address: w.address, prize: w.prize, tx: w.tx,
                  date: round.date, pool: round.pool, label: null });
    }

    showRollover(round) {
        if (!this.ui) return;
        this.ui.msg("Round rolled over",
            round.reason || "Not enough entries - tickets stay active", "#ff9944");
    }
}

function placeLabel(p) { return ["1st Place","2nd Place","3rd Place"][p-1] || p+"th Place"; }

function phaseColor(phase) {
    switch (phase) {
        case PHASE.LOCKED: return "rgba(255,80,80,0.9)";
        case PHASE.PRE_DRAW:
        case PHASE.AWAITING: return "#a78bfa";
        case PHASE.ROLLOVER: return "#ff9944";
        default: return "rgba(0,200,255,0.7)";
    }
}
