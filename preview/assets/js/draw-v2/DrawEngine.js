/**
 * Oracle Draw V2 - DrawEngine
 *
 * Читает winners.json, подтягивает снимок билетов раунда, строит
 * TicketModel и держит фазу. DOM не трогает.
 *
 * Правило про winner_index: индекс - основа, адрес - предохранитель.
 * Если tickets[winner_index] !== winner из winners.json, снимок не от
 * этого раунда → verified=false, колесо не крутим.
 */

import DrawAPI from "./DrawAPI.js";
import DrawEvents, { EVENTS } from "./DrawEvents.js";
import DrawState from "./DrawState.js";
import TicketModel from "../wheel/TicketModel.js";
import { PHASE, derivePhase } from "./DrawPhase.js";
import { CONFIG } from "./Config.js";
import { nextDeadline, prevDeadline, msToNextDeadline, inActiveWindow } from "./DrawClock.js";
// The same module lottery-draw.js uses. Deliberately not a second copy of
// the rule: two copies drift, and a drifted rule shows one winner while
// paying another.
import { buildLocalSnapshot } from "../../../chain-tickets.js";

export default class DrawEngine {

    constructor(pool = CONFIG.DAILY) {
        this.state = new DrawState(pool);
        this.api = new DrawAPI();
        this.events = new DrawEvents();
        this.data = { daily: [], weekly: [], meta: null };
        this.failures = 0;
        this.busy = false;
    }

    /* ---------- публичное ---------- */

    get pool() { return this.state.pool; }
    get phase() { return this.state.phase; }
    get model() { return this.state.model; }

    on(e, cb) { return this.events.on(e, cb); }
    once(e, cb) { return this.events.once(e, cb); }
    off(e, cb) { this.events.off(e, cb); }

    async setPool(pool) {
        if (pool !== CONFIG.DAILY && pool !== CONFIG.WEEKLY) return;
        if (pool === this.state.pool) return;
        this.state.reset(pool);
        await this.#adoptLatest({ silent: true });
        // Тот же случай: пока грузились, пул мог смениться снова. Событие с
        // устаревшим снимком состояния разослало бы чужие цифры по интерфейсу.
        if (this.state.pool !== pool) return;
        this.syncPhase();
        this.events.emit(EVENTS.DATA_UPDATED, this.snapshot());
    }

    /** Прокрутить ещё раз по текущему результату */
    replay() {
        const { round, model, verified } = this.state;
        if (!round || round.skipped || !model || !verified) return false;
        this.events.emit(EVENTS.DRAW_FINISHED, { round, model, replay: true });
        return true;
    }

    /** Мост сообщает, что анимация началась/кончилась - фаза REVEALING */
    beginReveal() { this.state.revealing = true; this.syncPhase(); }
    endReveal() { this.state.revealing = false; this.syncPhase(); }

    history() { return (this.data[this.state.pool] || []).slice(); }

    snapshot() {
        const now = Date.now();
        return {
            ...this.state.snapshot(),
            nextDeadline: nextDeadline(this.state.pool, now),
            remaining: msToNextDeadline(this.state.pool, now)
        };
    }

    /* ---------- цикл ---------- */

    async update({ force = false } = {}) {
        if (this.busy) return;
        this.busy = true;
        try {
            const payload = await this.api.load({ force });
            this.failures = 0;
            this.state.lastError = null;
            this.state.lastUpdateAt = Date.now();

            if (payload) {
                this.data = payload;
                this.events.emit(EVENTS.DATA_UPDATED, this.snapshot());
                await this.#adoptLatest({ silent: false });
            }
            this.syncPhase();
        } catch (err) {
            this.failures++;
            this.state.lastError = err.message || String(err);
            this.events.emit(EVENTS.ERROR, { error: err, failures: this.failures });
        } finally {
            this.busy = false;
        }
    }

    tick() {
        const now = Date.now();
        this.syncPhase(now);
        this.events.emit(EVENTS.TICK, {
            now,
            pool: this.state.pool,
            phase: this.state.phase,
            remaining: msToNextDeadline(this.state.pool, now)
        });
    }

    pollInterval(hidden = false) {
        if (hidden) return CONFIG.POLL_HIDDEN;
        // в PRE_DRAW и AWAITING опрашиваем часто независимо от расписания
        const hot = this.state.phase === PHASE.PRE_DRAW ||
                    this.state.phase === PHASE.AWAITING ||
                    inActiveWindow(this.state.pool);
        const base = hot ? CONFIG.POLL_ACTIVE : CONFIG.POLL_IDLE;
        if (this.failures === 0) return base;
        return base * Math.pow(2, Math.min(this.failures, CONFIG.MAX_BACKOFF_STEPS));
    }

    /* ---------- фаза ---------- */

    syncPhase(now = Date.now()) {
        const phase = derivePhase({
            now,
            deadline: nextDeadline(this.state.pool, now),
            lastDeadline: prevDeadline(this.state.pool, now),
            result: this.state.round,
            revealing: this.state.revealing,
            cfg: CONFIG
        });

        if (phase !== this.state.phase) {
            const from = this.state.phase;
            this.state.phase = phase;
            this.events.emit(EVENTS.PHASE_CHANGED, { from, to: phase, pool: this.state.pool });
        }
        // Waiting for a result we can work out ourselves. Fire and forget: a
        // failure here costs nothing, the published file still arrives.
        if (phase === PHASE.AWAITING) this.#tryLocalResult(now);
    }

    /* ---------- локальный расчёт ---------- */

    /**
     * Работает результат сам, не дожидаясь публикации.
     *
     * Кладём его в this.local, а НЕ в state: #adoptLatest выходит рано, если
     * ключ совпал с текущим, и опубликованный снимок был бы отброшен молча.
     * Сверка с ним - единственное, что доказывает, что правило не разъехалось.
     */
    async #tryLocalResult(now = Date.now()) {
        if (this.localBusy) return;
        const pool = this.state.pool;
        const deadline = prevDeadline(pool, now);
        if (!deadline) return;

        const date = new Date(deadline).toISOString().slice(0, 10);
        const key = `${pool}_${date}`;
        if (this.local && this.local.key === key) return;
        if (this.state.roundKey === key) return;   // опубликованный уже пришёл

        // Дедлайн-блок рождается на несколько секунд позже дедлайна, а тик
        // приходит раз в секунду - без паузы и троттлинга мы бомбим LCD
        // бинарным поиском по блокам ежесекундно, пока не приедет публикация.
        if (now - deadline < 15000) return;
        if (this.localNextTry && now < this.localNextTry) return;
        this.localNextTry = now + 5000;

        this.localBusy = true;
        try {
            // Граница «отыграно» - дедлайн последнего состоявшегося раунда,
            // ровно как её берёт lottery-draw.js.
            const done = (this.data[pool] || []).filter(r => !r.skipped && r.date);
            const prev = done[done.length - 1] || null;
            const boundaryTs = prev
                ? Math.floor(Date.parse(prev.deadline || (prev.date + "T20:00:00Z")) / 1000)
                : undefined;

            const r = await buildLocalSnapshot({ pool, deadlineMs: deadline, roundId: key, boundaryTs });
            if (!r || r.skipped) { this.local = { key, skipped: true }; return; }
            if (this.state.roundKey === key) return;   // пока считали, приехал настоящий

            const model = new TicketModel(r.snapshot, { maxSectors: CONFIG.MAX_SECTORS });
            const round = {
                key, pool, date,
                skipped: false, reason: null,
                winner: r.winner, winnerIndex: r.index, prize: 0,
                winners: [{ place: 1, address: r.winner, prize: 0, tx: null, index: r.index }],
                entries: r.snapshot.total, participants: r.snapshot.wallets,
                blockHash: r.block.hash, blockHeight: String(r.block.height),
                randomness: "terra-classic-block-hash-at-round-deadline",
                txTreasury: null, drawnAt: deadline, raw: r.snapshot, local: true
            };
            this.local = { key, round, model, winner: r.winner, index: r.index };

            // Раунд считается просмотренным сразу: перезагрузка страницы не
            // должна крутить колесо повторно.
            this.state.markSeen(key);
            this.events.emit(EVENTS.RESULT_READY, { round, firstLoad: false, model, verified: true });
            this.events.emit(EVENTS.DRAW_FINISHED, { round, model, replay: false });
        } catch (e) {
            console.warn("[DrawEngine] локальный расчёт не удался:", e.message);
        } finally {
            this.localBusy = false;
        }
    }

    /**
     * Сверка опубликованного результата с тем, что уже показано.
     * Совпало - тишина. Разошлось - говорим громко: это значит, что правило в
     * браузере и правило в скрипте больше не одно и то же.
     */
    #reconcileLocal(latest) {
        const loc = this.local;
        if (!loc || loc.key !== latest.key || loc.skipped) return false;
        const same = loc.winner === latest.winner && loc.index === latest.winnerIndex;
        if (!same) {
            console.error(
                `[DrawEngine] локальный результат разошёлся с опубликованным для ${latest.key}: ` +
                `показали ${loc.winner} (index ${loc.index}), в winners.json ${latest.winner} ` +
                `(index ${latest.winnerIndex}). Победитель - опубликованный.`
            );
        }
        return same;
    }

    /* ---------- приём нового раунда ---------- */

    async #adoptLatest({ silent }) {
        // Пул, с которого начали. Всё, что ниже, относится к НЕМУ.
        const pool = this.state.pool;
        const list = this.data[pool] || [];
        const latest = DrawAPI.pickLatest(list);
        if (!latest) { this.state.hydrated = true; return; }

        const firstLoad = !this.state.hydrated;
        if (latest.key === this.state.roundKey) { this.state.hydrated = true; return; }

        // снимок билетов + модель колеса
        //
        // У пропущенного раунда снимка нет и быть не может: розыгрыша не было,
        // список билетов замораживать нечего. Запрос за ним всё равно уходил и
        // возвращал 404 - обработчик его глотал, но в консоли оставалась
        // красная строка, похожая на поломку.
        const raw = latest.skipped ? null : await this.api.loadSnapshot(latest.key);

        // Пока грузился снимок, вкладку могли переключить - и не один раз.
        // Тогда наш результат устарел: записывать его нельзя, иначе раунд
        // чужого пула ляжет поверх текущего, и отсчёт под колесом начнёт
        // считаться от чужого дедлайна. Ровно так недельный «4d 23:55»
        // появлялся на вкладке Daily.
        if (this.state.pool !== pool) return;
        const model = raw ? new TicketModel(raw, { maxSectors: CONFIG.MAX_SECTORS }) : null;
        const verified = !!(model && !latest.skipped &&
            model.verify(latest.winnerIndex, latest.winner));

        if (model && !latest.skipped && !verified) {
            console.warn(
                `[DrawEngine] снимок ${latest.key} не сходится: ` +
                `tickets[${latest.winnerIndex}] = ${model.addressForIndex(latest.winnerIndex)}, ` +
                `в winners.json ${latest.winner}. Колесо крутить не будем.`
            );
        }

        this.state.applyRound(latest, model, verified);
        this.state.hydrated = true;

        if (silent) return;

        this.events.emit(EVENTS.ROUND_CHANGED, { round: latest, firstLoad, model, verified });
        this.events.emit(EVENTS.RESULT_READY, { round: latest, firstLoad, model, verified });

        if (latest.skipped) {
            this.state.markSeen(latest.key);
            this.events.emit(EVENTS.DRAW_SKIPPED, { round: latest, firstLoad });
            return;
        }

        // Уже показали этот раунд из локального расчёта? Тогда крутить второй
        // раз незачем - если только он не разошёлся с опубликованным.
        const agreed = this.#reconcileLocal(latest);
        if (agreed) {
            this.state.markSeen(latest.key);
            if (firstLoad) this.events.emit(EVENTS.READY, this.snapshot());
            return;
        }

        const seen = this.state.hasSeen(latest.key);
        const fresh = this.#isFresh(latest);
        this.state.markSeen(latest.key);

        if (!seen && (!firstLoad || fresh) && verified) {
            this.events.emit(EVENTS.DRAW_FINISHED, { round: latest, model, replay: false });
        }
        if (firstLoad) this.events.emit(EVENTS.READY, this.snapshot());
    }

    #isFresh(round, now = Date.now()) {
        if (round.drawnAt) return (now - round.drawnAt) <= CONFIG.FRESH_RESULT_MS;
        const prev = prevDeadline(this.state.pool, now);
        return prev !== null && (now - prev) <= CONFIG.FRESH_RESULT_MS;
    }
}
