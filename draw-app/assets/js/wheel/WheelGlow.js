/**
 * Oracle Draw - WheelGlow
 * Свет: мягкое сияние, градиенты металла, бархатный фон.
 * Бриф прямо запрещает сильный блюр, поэтому здесь только shadowBlur,
 * радиальные градиенты и аккуратный additive-проход.
 */

const TAU = Math.PI * 2;

/** Металл обода: щётка по кругу, а не плоская заливка */
export function brushedRing(ctx, cx, cy, r, width, theme, t) {
    const g = ctx.createRadialGradient(cx, cy, r - width, cx, cy, r);
    g.addColorStop(0.00, theme.ring.inner);
    g.addColorStop(0.35, theme.ring.mid);
    g.addColorStop(0.60, theme.ring.outer);
    g.addColorStop(1.00, theme.ring.edge);
    ctx.strokeStyle = g;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, r - width / 2, 0, TAU);
    ctx.stroke();
}

/** Бегущие блики по ободу */
export function ringReflections(ctx, cx, cy, r, width, theme, t, count = 3) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i++) {
        const a = (t / 9000 + i / count) * TAU;
        const arc = 0.22;
        const g = ctx.createLinearGradient(
            cx + Math.cos(a - arc) * r, cy + Math.sin(a - arc) * r,
            cx + Math.cos(a + arc) * r, cy + Math.sin(a + arc) * r
        );
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, "rgba(255,255,255,0.30)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = width * 0.55;
        ctx.beginPath();
        ctx.arc(cx, cy, r - width / 2, a - arc, a + arc);
        ctx.stroke();
    }
    ctx.restore();
}

/** Дыхание обода - один цикл на pulseMs */
export function ringPulse(ctx, cx, cy, r, theme, t, quality) {
    if (!quality.bloom) return;
    const p = 0.5 + 0.5 * Math.sin((t / theme.ring.pulseMs) * TAU);
    ctx.save();
    ctx.globalAlpha = 0.18 + p * 0.28;
    ctx.shadowColor = theme.ring.glow;
    ctx.shadowBlur = (18 + p * 26) * quality.shadowBlur;
    ctx.strokeStyle = theme.ring.glow;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.005, 0, TAU);
    ctx.stroke();
    ctx.restore();
}

/** Космический фон под колесом */
export function cosmicBackdrop(ctx, w, h, theme) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, theme.bg.top);
    g.addColorStop(1, theme.bg.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, theme.bg.vignette);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
}

/** Тёмная плита под секторами, чтобы редкости читались на глубине */
export function facePlate(ctx, cx, cy, r, theme) {
    const g = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
    g.addColorStop(0, theme.plate.from);
    g.addColorStop(1, theme.plate.to);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
}

/** Локальное сияние вокруг точки (победитель, кристалл) */
export function bloom(ctx, x, y, radius, color, strength, quality) {
    if (!quality.bloom || strength <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = Math.min(1, strength);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
    ctx.restore();
}

export { TAU };
