/**
 * Oracle Draw - WheelSector
 *
 * Один сектор = один кошелёк. Угол пропорционален числу билетов, значит
 * видимая площадь равна вероятности выигрыша.
 *
 * ВАЖНОЕ РАСХОЖДЕНИЕ С МАКЕТОМ. На макете у всех секторов одинаковая
 * ширина, хотя подписи разные: 20 билетов, 15, 12, 5. Так нельзя - это
 * ровно та подмена, которую мы убрали из старого колеса: глаз читает
 * равные шансы там, где шансы отличаются вчетверо.
 *
 * Поэтому сектора взвешенные, а вместо обрезки контента введены уровни
 * детализации: чем уже сектор, тем меньше в нём помещается. Никакой
 * элемент не рисуется, если под него нет места - вместо мельтешения
 * остаётся чистая цветная полоса редкости.
 *
 *   FULL    - номер + кошелёк + билеты
 *   COMPACT - номер + билеты
 *   TICK    - только цвет редкости
 *
 * Картинок NFT в секторах нет: маски рисуются одинаковыми кружками на
 * любом масштабе, съедают место под подписи и заставляют ждать загрузку
 * с домена. Номер читается всегда и на любой ширине сектора.
 */

import { rarityOf } from "./WheelTheme.js";

const TAU = Math.PI * 2;

export const DETAIL = { FULL: "FULL", COMPACT: "COMPACT", TICK: "TICK" };

/** Сколько пикселей дуги есть у сектора на радиусе подписи */
export function detailFor(sector, r) {
    const arc = sector.span * r * 0.68;
    if (arc >= 54) return DETAIL.FULL;      // пороги ниже, чем были с картинкой
    if (arc >= 26) return DETAIL.COMPACT;
    return DETAIL.TICK;
}

/**
 * Что писать крупно в секторе.
 *  "token"   - номер NFT (#144), как на макете
 *  "ordinal" - порядковый номер кошелька в раунде (№7)
 * У кошелька с несколькими NFT номер токена один из нескольких, поэтому
 * при спорах о том, «чей это сектор», ordinal однозначнее.
 */
export const LABEL_MODE = { value: "ordinal" };

/**
 * Что стоит в кружке. Без «#» и «№» - символ рядом с цифрой в маленьком
 * круге читается плохо, а смысл цифры понятен из контекста.
 *
 *   "ordinal" - порядковый номер кошелька в раунде: 1, 2, 3…
 *               По умолчанию: он короткий при любом числе участников.
 *   "token"   - номер NFT без тира: common-11 → 11
 *   "raw"     - tokenId как есть (для отладки)
 */
function badgeText(s, meta) {
    if (LABEL_MODE.value === "ordinal") return String(s.number);

    const id = meta.tokenId;
    if (id === undefined || id === null) return String(s.number);
    if (LABEL_MODE.value === "raw") return String(id);

    const num = String(id).match(/(\d+)\s*$/);
    return num ? num[1] : String(s.number);
}

/** Оставлено пустым: картинки в секторах убраны, вызовы не ломаются. */
export function preloadArt() { return null; }

export default class WheelSector {

    constructor(theme) {
        this.theme = theme;
    }

    setTheme(theme) { this.theme = theme; return this; }

    /**
     * @param {object} s        сектор из TicketModel (+ s.meta: {tokenId, tier, image})
     * @param {object} state    {angle, dim, scale, active, winner, t}
     */
    draw(ctx, cx, cy, r, s, state, quality) {
        const th = this.theme;
        const meta = s.meta || {};
        const rar = rarityOf(meta.tier);
        const a0 = state.angle + s.startAngle;
        const a1 = state.angle + s.endAngle;
        const mid = (a0 + a1) / 2;
        const R = r * (state.scale || 1);

        ctx.save();
        ctx.globalAlpha = state.dim ?? 1;

        // тело сектора: от тёмного центра к цвету редкости у обода
        const g = ctx.createRadialGradient(cx, cy, r * 0.22, cx, cy, R);
        g.addColorStop(0, "rgba(255,255,255,0.02)");
        g.addColorStop(0.62, hexA(rar.base, s.isGroup ? 0.10 : 0.16));
        g.addColorStop(1, hexA(rar.base, s.isGroup ? 0.20 : 0.34));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
        ctx.fill();

        // активный сектор - «Оракул сканирует участника»
        if (state.active > 0) {
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = state.active * 0.30;
            ctx.fillStyle = rar.glow;
            ctx.fill();
            ctx.restore();
        }

        // спицы
        ctx.strokeStyle = th.spoke;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
        ctx.stroke();

        // Дуга у обода показывает СОСТАВ кошелька: если человек сминтил
        // и legendary, и rare, и common - дуга делится на части
        // пропорционально entries каждого тира. Заливка сектора при этом
        // остаётся по лучшему NFT, иначе смешанные кошельки было бы
        // не отличить от однотонных.
        ctx.lineWidth = Math.max(1.5, r * 0.012);
        ctx.globalAlpha = (state.dim ?? 1) * (0.55 + state.active * 0.45);
        const parts = tierParts(meta, s.entries);
        let seg = a0;
        for (const [tierKey, share] of parts) {
            const to = seg + (a1 - a0) * share;
            ctx.strokeStyle = rarityOf(tierKey).edge;
            ctx.beginPath();
            ctx.arc(cx, cy, R * 0.985, seg, to);
            ctx.stroke();
            seg = to;
        }
        ctx.globalAlpha = state.dim ?? 1;

        const detail = detailFor(s, R);
        if (detail !== DETAIL.TICK) {
            this.#content(ctx, cx, cy, R, s, meta, rar, mid, detail, state, quality);
        }

        ctx.restore();
    }

    /**
     * Контент разворачивается К ЦЕНТРУ, без гнутого текста - как в брифе.
     * Ось подписи направлена по биссектрисе, текст читается снизу вверх
     * на левой половине и сверху вниз на правой, чтобы не вставать вверх ногами.
     */
    #content(ctx, cx, cy, R, s, meta, rar, mid, detail, state, quality) {
        const th = this.theme;
        const unit = R * 0.055;

        // Наклон текста вдоль биссектрисы нужен узким секторам - там иначе
        // не помещается. Широкому он вредит: у одного участника на весь
        // круг биссектриса произвольна, и текст уезжает под случайным углом.
        const wide = s.span > (100 * Math.PI / 180);

        // Кружок с цифрой - у обода, по центру ширины сектора.
        // Текст - в середине сектора.
        const R_BADGE = 0.86;
        const R_TEXT = wide ? 0.46 : 0.56;

        this.#badge(ctx, cx, cy, R, s, meta, rar, mid, unit, state, quality, R_BADGE);
        this.#text(ctx, cx, cy, R, s, rar, mid, unit, state, detail, wide, R_TEXT);
    }

    /** Цифра в кружке у обода. Цифра всегда прямая - так читается лучше. */
    #badge(ctx, cx, cy, R, s, meta, rar, mid, unit, state, quality, place) {
        const th = this.theme;
        const label = s.isGroup ? "+" : badgeText(s, meta);

        // Сколько дуги доступно на этом радиусе - чтобы кружки соседних
        // секторов не налезали друг на друга при большом числе участников.
        const rr = R * place;
        const room = s.span * rr;
        let rB = unit * (label.length > 2 ? 1.22 : 1.08);
        if (rB * 2 > room * 0.92) rB = (room * 0.92) / 2;
        if (rB < unit * 0.62) return;                 // совсем тесно - пропускаем

        const x = cx + Math.cos(mid) * rr;
        const y = cy + Math.sin(mid) * rr;

        ctx.save();
        ctx.translate(x, y);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.beginPath();
        ctx.arc(0, 0, rB, 0, TAU);
        ctx.fillStyle = hexA(rar.base, state.winner ? 0.30 : 0.16);
        ctx.fill();

        if (quality.bloom && state.active > 0.4) {
            ctx.shadowColor = rar.glow;
            ctx.shadowBlur = 12 * quality.shadowBlur * state.active;
        }
        ctx.strokeStyle = state.winner ? th.text.accent : rar.base;
        ctx.lineWidth = Math.max(1.1, rB * 0.13);
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = state.winner ? th.text.accent : th.text.primary;
        ctx.font = `800 ${rB * (label.length > 2 ? 0.82 : 1.02)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(label, 0, 0);
        ctx.restore();
    }

    /** Адрес кошелька и число entries - в середине сектора */
    #text(ctx, cx, cy, R, s, rar, mid, unit, state, detail, wide, place) {
        const th = this.theme;
        const rr = R * place;
        const x = cx + Math.cos(mid) * rr;
        const y = cy + Math.sin(mid) * rr;
        const flip = Math.cos(mid) < 0;

        ctx.save();
        ctx.translate(x, y);
        if (!wide) ctx.rotate(mid + (flip ? Math.PI : 0));
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (s.isGroup) {
            ctx.fillStyle = th.text.primary;
            ctx.font = `600 ${unit * 1.1}px ui-sans-serif, system-ui, sans-serif`;
            ctx.fillText(`${s.members.length} wallets`, 0, -unit * 0.55);
            ctx.fillStyle = th.text.secondary;
            ctx.font = `${unit * 0.85}px ui-monospace, monospace`;
            ctx.fillText(plural(s.entries), 0, unit * 0.6);
            ctx.restore();
            return;
        }

        const lines = [];
        if (detail === DETAIL.FULL) lines.push(["addr", shortAddr(s.address)]);
        lines.push(["entries", plural(s.entries)]);

        const step = unit * 1.15;
        let y0 = -((lines.length - 1) * step) / 2;
        for (const [kind, textLine] of lines) {
            if (kind === "addr") {
                ctx.fillStyle = state.winner ? th.text.accent : rar.base;
                ctx.font = `${unit * 0.95}px ui-monospace, monospace`;
            } else {
                ctx.fillStyle = th.text.secondary;
                ctx.font = `${unit * 0.85}px ui-monospace, monospace`;
            }
            ctx.fillText(textLine, 0, y0);
            y0 += step;
        }
        ctx.restore();
    }

    /** Обводка и искры победителя рисуются поверх всех секторов */
    drawWinnerFrame(ctx, cx, cy, r, s, angle, t, quality) {
        const th = this.theme;
        const a0 = angle + s.startAngle;
        const a1 = angle + s.endAngle;
        const R = r * (1 + th.winner.grow);
        const p = 0.5 + 0.5 * Math.sin(t / 620);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
        ctx.strokeStyle = th.winner.glow;
        ctx.lineWidth = 2 + p * 2;
        if (quality.bloom) {
            ctx.shadowColor = th.winner.glow;
            ctx.shadowBlur = (18 + p * 26) * quality.shadowBlur;
        }
        ctx.stroke();

        // бегущий пунктир по дуге
        ctx.setLineDash([r * 0.03, r * 0.03]);
        ctx.lineDashOffset = -(t / 22) % (r * 0.06);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.99, a0, a1);
        ctx.stroke();
        ctx.restore();
    }
}

/**
 * На сайте единица участия называется entry, а не ticket: пользователь
 * минтит NFT, и тир определяет, сколько entries он даёт (1 / 5 / 10).
 */
/**
 * Доли тиров в секторе: [["legendary", 0.62], ["common", 0.38]].
 * Порядок от старшего к младшему, чтобы дуга читалась одинаково у всех.
 */
function tierParts(meta, entries) {
    const t = meta && meta.tiers;
    if (!t || !entries) return [[meta && meta.tier || "common", 1]];
    const out = [];
    for (const key of ["legendary", "rare", "common"]) {
        if (t[key] > 0) out.push([key, t[key] / entries]);
    }
    return out.length ? out : [[meta.tier || "common", 1]];
}

function plural(n) {
    return n + (n === 1 ? " entry" : " entries");
}

function shortAddr(a) {
    if (!a) return "";
    return a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a;
}

function hexA(hex, alpha) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export { shortAddr };
