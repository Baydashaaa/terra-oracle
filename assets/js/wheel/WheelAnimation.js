/**
 * Oracle Draw - WheelAnimation
 *
 * Физика, а не CSS-твин. Профиль скорости решается ЗАРАНЕЕ, поэтому
 * посадка на нужный угол точная, а скорость непрерывна во всех стыках -
 * включая старт из уже вращающегося колеса (PreDraw).
 *
 * Фазы:  IDLE → PREDRAW → ACCEL → CRUISE → DECEL → LOCK → WINNER → REST
 *
 * Решение профиля. Известны: v0 (текущая скорость), нужный путь D.
 *   разгон   tA: v идёт v0→vMax по smootherstep, путь = (v0+vMax)/2 * tA
 *   крейсер  tB: путь = vMax * tB
 *   торможение tC: v = vMax*(1-u)^2, путь = vMax*tC/3
 * Из D находим tB. Если он отрицательный - добавляем полный оборот к D
 * и решаем снова. Так «6 оборотов» никогда не превращаются в 15.
 */

const TAU = Math.PI * 2;

export const MOTION = {
    IDLE: "IDLE", PREDRAW: "PREDRAW", ACCEL: "ACCEL", CRUISE: "CRUISE",
    DECEL: "DECEL", LOCK: "LOCK", WINNER: "WINNER", REST: "REST"
};

const DEFAULTS = {
    idleRpm: 1.2,
    predrawRpm: 6,
    maxRpm: 150,
    accelMs: 1400,
    decelMs: 3600,
    minCruiseMs: 500,
    lockDeg: 2.6,          // откат назад при защёлкивании
    lockMs: 620,
    winnerMs: 1800,
    minTurns: 5
};

const rpm = v => (v * TAU) / 60;
const smoother = u => u * u * u * (u * (u * 6 - 15) + 10);

export default class WheelAnimation {

    constructor(opts = {}) {
        this.cfg = { ...DEFAULTS, ...opts };
        this.mode = MOTION.REST;
        this.angle = 0;
        this.velocity = 0;
        this.plan = null;
        this.t0 = 0;
        this.onSettle = null;
        this.reducedMotion = false;
    }

    get isSpinning() {
        return this.mode === MOTION.ACCEL || this.mode === MOTION.CRUISE ||
               this.mode === MOTION.DECEL || this.mode === MOTION.LOCK;
    }

    /** 0..1 - насколько колесо «горячее». Кристалл берёт отсюда яркость. */
    get intensity() {
        const vMax = rpm(this.cfg.maxRpm);
        if (this.mode === MOTION.WINNER) return 1;
        if (!this.isSpinning) return 0.05;
        return Math.max(0, Math.min(1, 1 - Math.abs(this.velocity) / vMax));
    }

    idle(now) { this.mode = MOTION.IDLE; this.t0 = now; this.plan = null; }
    predraw(now) { this.mode = MOTION.PREDRAW; this.t0 = now; this.plan = null; }
    rest() { this.mode = MOTION.REST; this.plan = null; this.velocity = 0; }

    /**
     * Запустить розыгрыш до угла модели.
     * @param {number} now
     * @param {number} targetModelAngle угол билета внутри модели
     * @param {number} pointerAngle     угол указателя (обычно -π/2)
     * @param {function} onSettle       вызовется после LOCK
     */
    spinTo(now, targetModelAngle, pointerAngle, onSettle) {
        const c = this.cfg;
        this.onSettle = onSettle || null;

        // куда сесть: ближайшая позиция ниже текущего угла + обороты
        const base = pointerAngle - targetModelAngle;
        const back = (((this.angle - base) % TAU) + TAU) % TAU;
        const landing = this.angle - back;

        if (this.reducedMotion) {
            this.angle = landing;
            this.velocity = 0;
            this.mode = MOTION.WINNER;
            this.t0 = now;
            if (this.onSettle) this.onSettle();
            return this.plan = { skipped: true, land: landing };
        }

        const v0 = Math.abs(this.velocity);
        const vMax = rpm(c.maxRpm);
        const tA = c.accelMs / 1000, tC = c.decelMs / 1000;
        const dA = ((v0 + vMax) / 2) * tA;
        const dC = (vMax * tC) / 3;

        let turns = Math.max(c.minTurns, 1);
        let D = back + turns * TAU;
        let tB = (D - dA - dC) / vMax;
        while (tB < c.minCruiseMs / 1000) {          // не хватает пути - добавляем оборот
            turns += 1;
            D = back + turns * TAU;
            tB = (D - dA - dC) / vMax;
        }

        this.plan = {
            v0, vMax, tA, tB, tC,
            dA, dB: vMax * tB, dC,
            D,
            from: this.angle,
            land: this.angle - D,
            turns
        };
        this.mode = MOTION.ACCEL;
        this.t0 = now;
        return this.plan;
    }

    /** @returns {{angle:number, velocity:number, mode:string}} */
    step(now) {
        const c = this.cfg;
        const dt = 1 / 60;
        const el = (now - this.t0) / 1000;

        switch (this.mode) {
            case MOTION.IDLE:
            case MOTION.PREDRAW: {
                const target = -rpm(this.mode === MOTION.IDLE ? c.idleRpm : c.predrawRpm);
                this.velocity += (target - this.velocity) * Math.min(dt * 1.6, 1);
                this.angle += this.velocity * dt;
                break;
            }
            case MOTION.ACCEL: {
                const p = this.plan, u = Math.min(el / p.tA, 1);
                const s = smoother(u);
                this.velocity = -(p.v0 + (p.vMax - p.v0) * s);
                this.angle = p.from - (p.v0 * el + (p.vMax - p.v0) * p.tA * integralSmoother(u));
                if (u >= 1) { this.mode = MOTION.CRUISE; this.t0 = now; }
                break;
            }
            case MOTION.CRUISE: {
                const p = this.plan, u = Math.min(el / p.tB, 1);
                this.velocity = -p.vMax;
                this.angle = p.from - p.dA - p.vMax * el;
                if (u >= 1) { this.mode = MOTION.DECEL; this.t0 = now; }
                break;
            }
            case MOTION.DECEL: {
                const p = this.plan, u = Math.min(el / p.tC, 1);
                const k = 1 - u;
                this.velocity = -p.vMax * k * k;
                // интеграл vMax*(1-u)^2 dt = vMax*tC*(1-(1-u)^3)/3
                this.angle = p.from - p.dA - p.dB - (p.vMax * p.tC / 3) * (1 - k * k * k);
                if (u >= 1) {
                    this.mode = MOTION.LOCK;
                    this.t0 = now;
                    this.lockFrom = this.angle;
                }
                break;
            }
            case MOTION.LOCK: {
                // Защёлка: небольшой откат назад и возврат ровно в посадку.
                // Заодно снимает накопленную погрешность интегрирования.
                const u = Math.min(el / (c.lockMs / 1000), 1);
                const kick = (c.lockDeg * Math.PI / 180) * Math.sin(u * Math.PI) * (1 - u * 0.35);
                this.angle = this.plan.land + kick;
                this.velocity = 0;
                if (u >= 1) {
                    this.angle = this.plan.land;
                    this.mode = MOTION.WINNER;
                    this.t0 = now;
                    if (this.onSettle) this.onSettle();
                }
                break;
            }
            case MOTION.WINNER: {
                this.velocity = 0;
                if (el * 1000 > c.winnerMs) this.mode = MOTION.REST;
                break;
            }
            default:
                this.velocity = 0;
        }

        return { angle: this.angle, velocity: this.velocity, mode: this.mode };
    }

    /** Прогресс всей анимации 0..1 - для затемнения проигравших */
    get progress() {
        if (!this.plan || this.plan.skipped) return this.mode === MOTION.REST ? 0 : 1;
        const total = this.plan.tA + this.plan.tB + this.plan.tC;
        if (this.mode === MOTION.WINNER || this.mode === MOTION.REST) return 1;
        if (this.mode === MOTION.LOCK) return 1;
        return Math.min(1, this.#elapsedTotal() / total);
    }

    #elapsedTotal() {
        const p = this.plan;
        if (!p) return 0;
        switch (this.mode) {
            case MOTION.ACCEL: return 0;
            case MOTION.CRUISE: return p.tA;
            case MOTION.DECEL: return p.tA + p.tB;
            default: return p.tA + p.tB + p.tC;
        }
    }
}

/** ∫smootherstep du от 0 до u */
function integralSmoother(u) {
    return u * u * u * u * (u * (u * 1 - 3) + 2.5);   // = u^6 -3u^5 +2.5u^4
}

export { rpm, TAU };
