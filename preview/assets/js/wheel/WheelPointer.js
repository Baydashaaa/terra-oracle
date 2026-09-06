/**
 * Oracle Draw - WheelPointer (Oracle Crystal)
 *
 * Треугольника нет. Кристалл-ромб в золотой оправе, внутри живая энергия.
 * Яркость растёт по мере замедления: аргумент `intensity` 0..1 приходит
 * из анимации (1 - v/vMax), поэтому «загорается на подлёте» само собой.
 */

const TAU = Math.PI * 2;

export default class WheelPointer {

    constructor(theme) {
        this.theme = theme;
        this.flash = 0;          // короткая вспышка при защёлкивании
    }

    setTheme(theme) { this.theme = theme; return this; }

    /** Дёрнуть вспышку - зовётся в момент фиксации победителя */
    strike() { this.flash = 1; return this; }

    /**
     * @param {number} intensity 0..1 - насколько «горячий» кристалл
     * @param {number} tick      0..1 - реакция на проезжающий сектор
     */
    draw(ctx, cx, cy, r, t, intensity, quality, tick = 0) {
        const th = this.theme;
        const h = r * 0.16;                     // высота кристалла
        const w = h * 0.62;
        const y = cy - r - h * 0.12;             // сидит на ободе сверху

        this.flash *= 0.90;
        const heat = Math.min(1, intensity + this.flash * 0.8 + tick * 0.25);

        ctx.save();
        ctx.translate(cx, y);

        // сияние под кристаллом
        if (quality.bloom) {
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            const g = ctx.createRadialGradient(0, h * 0.35, 0, 0, h * 0.35, h * (1.4 + heat));
            g.addColorStop(0, th.pointer.glow);
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.globalAlpha = 0.35 + heat * 0.55;
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, h * 0.35, h * (1.4 + heat), 0, TAU);
            ctx.fill();
            ctx.restore();
        }

        // оправа
        this.#diamond(ctx, w * 1.18, h * 1.18);
        const frame = ctx.createLinearGradient(-w, -h, w, h);
        frame.addColorStop(0, th.pointer.frameEdge);
        frame.addColorStop(0.45, th.pointer.frame);
        frame.addColorStop(1, th.pointer.frameEdge);
        ctx.fillStyle = frame;
        ctx.fill();

        // тело кристалла
        this.#diamond(ctx, w, h);
        const body = ctx.createLinearGradient(0, -h, 0, h);
        body.addColorStop(0, th.pointer.core);
        body.addColorStop(0.5, th.pointer.energy);
        body.addColorStop(1, th.pointer.frameEdge);
        ctx.fillStyle = body;
        ctx.globalAlpha = 0.85 + heat * 0.15;
        ctx.fill();
        ctx.globalAlpha = 1;

        // энергия внутри: две встречные волны
        ctx.save();
        this.#diamond(ctx, w, h);
        ctx.clip();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 2; i++) {
            const p = ((t / (900 - i * 260)) % 1);
            const yy = -h + 2 * h * (i === 0 ? p : 1 - p);
            ctx.globalAlpha = (0.25 + heat * 0.5) * (1 - Math.abs(yy) / h * 0.6);
            ctx.fillStyle = th.pointer.core;
            ctx.fillRect(-w, yy - h * 0.06, w * 2, h * 0.12);
        }
        ctx.restore();

        // грань
        this.#diamond(ctx, w, h);
        ctx.strokeStyle = th.pointer.frame;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // остриё смотрит в обод
        ctx.beginPath();
        ctx.moveTo(-w * 0.28, h * 0.92);
        ctx.lineTo(0, h * 1.55);
        ctx.lineTo(w * 0.28, h * 0.92);
        ctx.closePath();
        ctx.fillStyle = th.pointer.frame;
        ctx.fill();

        ctx.restore();
    }

    #diamond(ctx, w, h) {
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(w, 0);
        ctx.lineTo(0, h);
        ctx.lineTo(-w, 0);
        ctx.closePath();
    }
}
