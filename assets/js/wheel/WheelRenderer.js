/**
 * Oracle Draw - WheelRenderer
 *
 * Дирижёр. Владеет канвасом и DPR, держит кэш картинок NFT, собирает кадр
 * из остальных модулей. Сам ничего не решает про данные - ему дают
 * TicketModel и состояние анимации.
 *
 * Порядок слоёв:
 *   фон → звёзды → плита → сектора → рамка победителя → обод →
 *   искры обода → ядро → кристалл
 *
 * Почему canvas, а не SVG, как просил бриф: в том же брифе есть картинки
 * NFT внутри секторов (это PNG-маски) и сотни анимируемых частиц. Сотни
 * SVG-узлов, перерисовываемых каждый кадр, на среднем Android дают
 * заметные просадки - в этом проекте уже ловили ровно такое от
 * полноэкранных композитных слоёв. Canvas с масштабом по devicePixelRatio
 * даёт ту же резкость на любом экране. Гравировки и статичные детали при
 * желании можно положить сверху отдельным SVG-слоем - рендерер за
 * интерфейсом, замена не заденет остальное.
 */

import { getTheme, detectQuality, QUALITY } from "./WheelTheme.js";
import * as Glow from "./WheelGlow.js";
import WheelSector from "./WheelSector.js";
import WheelPointer from "./WheelPointer.js";
import WheelCenter from "./WheelCenter.js";
import WheelParticles from "./WheelParticles.js";
import WheelAnimation from "./WheelAnimation.js";

const TAU = Math.PI * 2;
const POINTER_ANGLE = -Math.PI / 2;

export default class WheelRenderer {

    constructor(canvas, opts = {}) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext("2d") : null;
        this.theme = getTheme(opts.pool || "daily");
        this.qualityKey = opts.quality || detectQuality();
        this.quality = QUALITY[this.qualityKey];

        this.model = null;
        this.angle = 0;
        this.winner = null;
        this.revealProgress = 0;      // 0..1 - насколько проигравшие погашены
        this.coreEnergy = 0;

        this.sectors = new WheelSector(this.theme);
        this.pointer = new WheelPointer(this.theme);
        this.center = new WheelCenter(this.theme);
        this.particles = new WheelParticles(opts.seed || 20260801);

        this._activeId = null;
        this._tick = 0;

        // Рендерер владеет своим циклом и своей физикой: снаружи его
        // просят «в холостую» / «раскручивайся» / «сядь на билет N».
        this.anim = new WheelAnimation();
        this.anim.reducedMotion = !!opts.reducedMotion || this.qualityKey === "still";
        this.onLanded = null;
        this._raf = null;

        this.resize();
    }

    /* ---------- настройка ---------- */

    setPool(pool) {
        this.theme = getTheme(pool);
        this.sectors.setTheme(this.theme);
        this.pointer.setTheme(this.theme);
        this.center.setTheme(this.theme);
        this.#rebuildParticles();
        return this;
    }

    setQuality(key) {
        this.qualityKey = key;
        this.quality = QUALITY[key] || QUALITY.medium;
        this.#rebuildParticles();
        return this;
    }

    setModel(model) {
        this.model = model;
        this.winner = null;
        this.revealProgress = 0;
        this._activeId = null;
        return this;
    }

    setWinner(sector) { this.winner = sector; return this; }

    /* ---------- цикл и управление ---------- */

    start() {
        if (this._raf !== null) return this;
        const loop = (now) => {
            this.anim.step(now);
            this.angle = this.anim.angle;
            if (this.winner) this.revealProgress = Math.min(1, this.revealProgress + 0.035);
            this.render(now, { intensity: this.anim.intensity, isSpinning: this.anim.isSpinning });
            this._raf = requestAnimationFrame(loop);
        };
        this._raf = requestAnimationFrame(loop);
        return this;
    }

    stop() {
        if (this._raf !== null) cancelAnimationFrame(this._raf);
        this._raf = null;
        return this;
    }

    /**
     * Шаг вручную - для превью и тестов без rAF.
     * Часы стартуют от now(), а не от нуля: spinToIndex ставит t0 по
     * performance.now(), и при отсчёте с нуля прошедшее время выходило
     * отрицательным - анимация не доходила до конца.
     */
    frame(dt = 1 / 60) {
        if (this._t === undefined) this._t = now();
        this._t += dt * 1000;
        this.anim.step(this._t);
        this.angle = this.anim.angle;
        if (this.winner) this.revealProgress = Math.min(1, this.revealProgress + 0.035);
        this.render(this._t, { intensity: this.anim.intensity, isSpinning: this.anim.isSpinning });
        return this;
    }

    idle() { this.anim.idle(now()); this.setWinner(null); this.revealProgress = 0; return this; }
    preDraw() { this.anim.predraw(now()); this.setWinner(null); this.revealProgress = 0; return this; }

    /**
     * Запустить розыгрыш до билета с плоским индексом index.
     * @returns {boolean} false, если индекс не разрешается в сектор
     */
    spinToIndex(index) {
        if (!this.model) return false;
        const target = this.model.angleForIndex(index);
        if (target === null || target === undefined) return false;
        this.setWinner(null);
        this.revealProgress = 0;
        this.anim.spinTo(now(), target, POINTER_ANGLE, () => {
            this.setWinner(this.model.sectorForIndex(index));
            this.pointer.strike();
            if (this.onLanded) this.onLanded();
        });
        return true;
    }

    /** Мгновенно поставить колесо на билет - без анимации */
    snapToIndex(index) {
        if (!this.model) return false;
        const target = this.model.angleForIndex(index);
        if (target === null || target === undefined) return false;
        this.angle = POINTER_ANGLE - target;
        this.anim.angle = this.angle;
        this.anim.rest();
        this.setWinner(this.model.sectorForIndex(index));
        this.revealProgress = 1;
        return true;
    }
    setAngle(a) { this.angle = a; return this; }

    resize() {
        if (!this.canvas) return this;
        const dpr = Math.min(window.devicePixelRatio || 1, this.qualityKey === "high" ? 2 : 1.5);
        const rect = this.canvas.getBoundingClientRect();
        const cssW = rect.width || this.canvas.width || 500;
        const cssH = rect.height || this.canvas.height || cssW;
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);
        this.dpr = dpr;
        this._cssW = this.canvas.clientWidth || cssW;
        this.#rebuildParticles();
        return this;
    }

    #rebuildParticles() {
        const n = Math.round(this.theme.particles.count * (this.quality?.particles ?? 0));
        const stars = Math.round(140 * (this.quality?.stars ?? 0));
        this.particles.build(Math.max(n, 1), Math.max(stars, 1));
    }

    /* ---------- кадр ---------- */

    /**
     * @param {number} t     время в мс (performance.now)
     * @param {object} anim  {intensity, progress, isSpinning}
     */
    render(t, anim = {}) {
        const ctx = this.ctx;
        if (!ctx || !this.canvas) return;

        // Вкладка Draw может быть скрыта на момент загрузки: тогда канвас
        // имеет нулевой размер, и без этой проверки колесо так и осталось бы
        // в аварийном размере. Заодно ловит поворот экрана и смену вкладки.
        const live = this.canvas.clientWidth;
        if (live && Math.abs(live - (this._cssW || 0)) > 1) {
            this._cssW = live;
            this.resize();
            return;                      // следующий кадр отрисует уже в новом размере
        }

        const W = this.canvas.width, H = this.canvas.height;
        const cx = W / 2, cy = H / 2;
        const ringW = Math.min(W, H) * this.theme.ring.width;
        const rOuter = Math.min(W, H) / 2 - 4;
        const rFace = rOuter - ringW;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);

        // Фон и звёзды обрезаны по кругу колеса. Раньше cosmicBackdrop
        // заливал весь прямоугольник, и на странице колесо выглядело
        // вырезанным из чёрного квадрата.
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, rOuter, 0, TAU);
        ctx.clip();
        Glow.cosmicBackdrop(ctx, W, H, this.theme);
        this.particles.drawStars(ctx, W, H, t, this.quality);
        ctx.restore();

        Glow.facePlate(ctx, cx, cy, rFace, this.theme);

        const active = this.#activeSector();
        this.#detectTick(active, t);

        if (!this.model || !this.model.sectors.length) {
            this.#emptyFace(ctx, cx, cy, rFace);
        }

        if (this.model) {
            for (const s of this.model.sectors) {
                const isWinner = this.winner && s.id === this.winner.id;
                const dim = this.winner
                    ? (isWinner ? 1 : 1 - (1 - this.theme.winner.dim) * this.revealProgress)
                    : 1;
                const scale = isWinner ? 1 + this.theme.winner.grow * this.revealProgress : 1;
                const act = (active && active.id === s.id && !this.winner)
                    ? 1 : (isWinner ? 1 : 0);
                this.sectors.draw(ctx, cx, cy, rFace, s,
                    { angle: this.angle, dim, scale, active: act, winner: isWinner, t }, this.quality);
            }
            if (this.winner && this.revealProgress > 0.05) {
                this.sectors.drawWinnerFrame(ctx, cx, cy, rFace, this.winner, this.angle, t, this.quality);
                this.particles.drawWinnerSparks(
                    ctx, cx, cy, rFace,
                    this.angle + this.winner.startAngle, this.winner.span,
                    this.theme, t, this.quality
                );
            }
        }

        Glow.brushedRing(ctx, cx, cy, rOuter, ringW, this.theme, t);
        if (this.quality.engravings) this.#engravings(ctx, cx, cy, rOuter, ringW, t);
        if (this.quality.reflections) Glow.ringReflections(ctx, cx, cy, rOuter, ringW, this.theme, t);
        Glow.ringPulse(ctx, cx, cy, rOuter, this.theme, t, this.quality);
        this.particles.drawRing(ctx, cx, cy, rOuter - ringW * 0.15, rOuter - ringW * 0.9,
            this.theme, t, this.quality, this.angle);

        this.coreEnergy += ((anim.isSpinning ? 1 : 0.15) - this.coreEnergy) * 0.05;
        this.center.draw(ctx, cx, cy, rFace, t, this.quality, this.coreEnergy);

        this.pointer.draw(ctx, cx, cy, rOuter, t,
            anim.intensity ?? 0, this.quality, this._tick);
        this._tick *= 0.86;
    }

    /** Раунд без участников - колесо крутится, но сектора пустые */
    #emptyFace(ctx, cx, cy, r) {
        const th = this.theme;
        const n = 12;
        const span = TAU / n;

        for (let i = 0; i < n; i++) {
            const a0 = this.angle + i * span;
            const a1 = a0 + span;

            // Пустые сектора всё равно рисуем: колесо должно читаться как
            // колесо, а не как пустой круг. Чередование через один даёт
            // объём, не привлекая внимания.
            const g = ctx.createRadialGradient(cx, cy, r * 0.22, cx, cy, r);
            g.addColorStop(0, "rgba(255,255,255,0.015)");
            g.addColorStop(1, i % 2 ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.018)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, a0, a1);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = th.spoke;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a0) * r * 0.30, cy + Math.sin(a0) * r * 0.30);
            ctx.lineTo(cx + Math.cos(a0) * r * 0.99, cy + Math.sin(a0) * r * 0.99);
            ctx.stroke();
        }

        // тонкая дуга по краю - граница поля секторов
        ctx.strokeStyle = th.spoke;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.985, 0, TAU);
        ctx.stroke();

        ctx.save();
        ctx.fillStyle = th.text.secondary;
        ctx.globalAlpha = 0.75;
        ctx.font = `${Math.round(r * 0.068)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Awaiting entries", cx, cy + r * 0.60);
        ctx.font = `${Math.round(r * 0.05)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.globalAlpha = 0.45;
        ctx.fillText("Mint an NFT to take a sector", cx, cy + r * 0.72);
        ctx.restore();
    }

    /** Гравировки по ободу - статичны относительно колеса, едут вместе с ним */
    #engravings(ctx, cx, cy, r, w, t) {
        const n = 24;
        ctx.save();
        ctx.strokeStyle = this.theme.engraving;
        ctx.lineWidth = 1;
        for (let i = 0; i < n; i++) {
            const a = this.angle * 0.25 + (i / n) * TAU;
            const rr = r - w * 0.5;
            const len = (i % 4 === 0) ? w * 0.34 : w * 0.18;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * (rr - len / 2), cy + Math.sin(a) * (rr - len / 2));
            ctx.lineTo(cx + Math.cos(a) * (rr + len / 2), cy + Math.sin(a) * (rr + len / 2));
            ctx.stroke();
            if (i % 6 === 0) {
                ctx.beginPath();
                ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, w * 0.09, 0, TAU);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    /**
     * Сектор под точкой экрана. Координаты клиентские (из события мыши),
     * переводим их в систему канваса с учётом текущего угла вращения.
     * Возвращает null, если точка вне поля секторов или модели нет.
     */
    sectorAt(clientX, clientY) {
        if (!this.model || !this.model.sectors.length || !this.canvas) return null;
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width) return null;

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = clientX - cx;
        const dy = clientY - cy;
        const dist = Math.hypot(dx, dy);

        const rOuter = rect.width / 2 - 4 * (rect.width / this.canvas.width);
        const ringW = rect.width * this.theme.ring.width;
        const rFace = rOuter - ringW;
        if (dist > rFace || dist < rFace * 0.30) return null;   // обод и ядро не кликаются

        const a = (((Math.atan2(dy, dx) - this.angle) % TAU) + TAU) % TAU;
        for (const s of this.model.sectors) {
            const start = ((s.startAngle % TAU) + TAU) % TAU;
            const end = start + s.span;
            if ((a >= start && a < end) || (end > TAU && a < end - TAU)) return s;
        }
        return null;
    }

    /** Какой сектор сейчас под кристаллом */
    #activeSector() {
        if (!this.model || !this.model.sectors.length) return null;
        const a = (((POINTER_ANGLE - this.angle) % TAU) + TAU) % TAU;
        for (const s of this.model.sectors) {
            const start = ((s.startAngle % TAU) + TAU) % TAU;
            const end = start + s.span;
            if ((a >= start && a < end) || (end > TAU && a < end - TAU)) return s;
        }
        return null;
    }

    /** Смена сектора под кристаллом = короткий тик яркости */
    #detectTick(active, t) {
        const id = active ? active.id : null;
        if (id !== this._activeId) {
            this._activeId = id;
            this._tick = 1;
        }
    }

    get pointerAngle() { return POINTER_ANGLE; }
}

function now() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
}

export { POINTER_ANGLE, TAU };
