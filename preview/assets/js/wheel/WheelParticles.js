/**
 * Oracle Draw - WheelParticles
 * Две системы: искры внутри обода и звёздная пыль на фоне.
 * Обе детерминированы по сиду, чтобы кадр можно было воспроизвести.
 */

const TAU = Math.PI * 2;

function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export default class WheelParticles {

    constructor(seed = 20260801) {
        this.rand = mulberry(seed);
        this.ring = [];
        this.stars = [];
        this.built = 0;
    }

    build(count, starCount) {
        this.ring = Array.from({ length: count }, () => ({
            a: this.rand() * TAU,
            rr: 0.42 + this.rand() * 0.52,      // положение внутри обода
            speed: (0.04 + this.rand() * 0.14) * (this.rand() < 0.5 ? -1 : 1),
            size: 0.6 + this.rand() * 1.8,
            phase: this.rand() * TAU
        }));
        this.stars = Array.from({ length: starCount }, () => ({
            x: this.rand(), y: this.rand(),
            size: 0.4 + this.rand() * 1.3,
            phase: this.rand() * TAU,
            drift: (this.rand() - 0.5) * 0.004
        }));
        this.built = count + starCount;
        return this;
    }

    /** Звёзды рисуются в экранных координатах, до колеса */
    drawStars(ctx, w, h, t, quality) {
        if (!quality.stars) return;
        ctx.save();
        for (const s of this.stars) {
            const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 1400 + s.phase));
            ctx.globalAlpha = tw * 0.55 * quality.stars;
            ctx.fillStyle = "#ffffff";
            const x = ((s.x + s.drift * t / 1000) % 1 + 1) % 1;
            ctx.beginPath();
            ctx.arc(x * w, s.y * h, s.size, 0, TAU);
            ctx.fill();
        }
        ctx.restore();
    }

    /** Искры в обойме - крутятся вместе с колесом, но со своим сносом */
    drawRing(ctx, cx, cy, rOuter, rInner, theme, t, quality, wheelAngle) {
        if (!quality.particles) return;
        const n = Math.round(this.ring.length * quality.particles);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = theme.particles.color;
        for (let i = 0; i < n; i++) {
            const p = this.ring[i];
            const a = p.a + wheelAngle * 0.35 + (t / 1000) * p.speed;
            const r = rInner + (rOuter - rInner) * p.rr;
            const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t / 700 + p.phase));
            ctx.globalAlpha = pulse * 0.8;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, p.size * pulse, 0, TAU);
            ctx.fill();
        }
        ctx.restore();
    }

    /** Искры вокруг сектора-победителя */
    drawWinnerSparks(ctx, cx, cy, r, angle, span, theme, t, quality) {
        if (!quality.particles) return;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = theme.winner.glow;
        const n = 26;
        for (let i = 0; i < n; i++) {
            const p = this.ring[i % this.ring.length];
            const local = ((t / 1600) + p.phase / TAU) % 1;
            const a = angle + span * local;
            const rad = r * (0.55 + 0.42 * (0.5 + 0.5 * Math.sin(t / 500 + p.phase)));
            ctx.globalAlpha = (1 - local) * 0.8;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, p.size * 1.4, 0, TAU);
            ctx.fill();
        }
        ctx.restore();
    }
}
