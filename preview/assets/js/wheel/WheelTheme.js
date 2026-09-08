/**
 * Oracle Draw - WheelTheme
 *
 * Все цвета, толщины и тайминги живут здесь. Ни один другой модуль не
 * содержит хардкодного цвета: тема приходит параметром. Поэтому Daily и
 * Weekly - не два рендерера, а два набора токенов.
 *
 * DAILY  - Ancient Oracle Machine: золото, бронза, тёмно-синий.
 * WEEKLY - Council of Oracles: фиолет, белая энергия, золотые акценты.
 */

const RARITY = {
    common:    { key: "common",    label: "COMMON",    base: "#c8cdd8", edge: "#8f97a8", glow: "rgba(200,205,216,0.55)" },
    rare:      { key: "rare",      label: "RARE",      base: "#4d9bff", edge: "#2a6fd0", glow: "rgba(77,155,255,0.60)" },
    legendary: { key: "legendary", label: "LEGENDARY", base: "#ff5c4d", edge: "#ffbf4d", glow: "rgba(255,140,60,0.70)" }
};

const DAILY = {
    key: "daily",
    name: "Ancient Oracle Machine",

    bg:        { top: "#070b14", bottom: "#0d1424", vignette: "rgba(0,0,0,0.65)" },
    ring:      { inner: "#7a5a1e", mid: "#f4d477", outer: "#a87c28", edge: "#5a4014",
                 width: 0.06, glow: "rgba(244,212,119,0.55)", pulseMs: 5000 },
    engraving: "rgba(255,236,180,0.35)",
    plate:     { from: "#0a1020", to: "#050810" },
    spoke:     "rgba(244,212,119,0.16)",

    core:      { r1: "#f4d477", r2: "#c89a3c", r3: "rgba(244,212,119,0.45)",
                 hub: "#070b14", pulse: "rgba(244,212,119,0.5)", emblem: "wheel",
                 // Подставь сюда файл логотипа, и центр возьмёт его:
                 // emblemSrc: "/assets/img/logo-wheel.svg",
                 emblemSrc: null },

    pointer:   { frame: "#f4d477", frameEdge: "#8a6414", core: "#fff6dc",
                 energy: "#ffd166", glow: "rgba(255,209,102,0.85)" },

    text:      { primary: "#f6efe0", secondary: "rgba(246,239,224,0.62)", accent: "#f4d477" },
    particles: { color: "rgba(255,224,150,0.9)", count: 90 },
    winner:    { glow: "rgba(255,214,120,0.95)", grow: 0.08, dim: 0.25 }
};

const WEEKLY = {
    key: "weekly",
    name: "Council of Oracles",

    bg:        { top: "#080614", bottom: "#150e2a", vignette: "rgba(0,0,0,0.65)" },
    ring:      { inner: "#4a2b8f", mid: "#b98cff", outer: "#6f3fd0", edge: "#2c1a55",
                 width: 0.06, glow: "rgba(185,140,255,0.55)", pulseMs: 5000 },
    engraving: "rgba(232,214,255,0.35)",
    plate:     { from: "#0d0820", to: "#06040f" },
    spoke:     "rgba(185,140,255,0.16)",

    core:      { r1: "#e8d6ff", r2: "#a06cff", r3: "rgba(185,140,255,0.45)",
                 hub: "#080614", pulse: "rgba(200,160,255,0.5)", emblem: "trophy", emblemSrc: null },

    pointer:   { frame: "#c8a2ff", frameEdge: "#4a2b8f", core: "#ffffff",
                 energy: "#e0c8ff", glow: "rgba(200,160,255,0.85)" },

    text:      { primary: "#f2ecff", secondary: "rgba(242,236,255,0.62)", accent: "#c8a2ff" },
    particles: { color: "rgba(220,190,255,0.9)", count: 110 },
    winner:    { glow: "rgba(210,170,255,0.95)", grow: 0.08, dim: 0.25 }
};

/**
 * Уровни качества. Бриф просит частицы, блум и три вращающихся кольца -
 * на десктопе это дёшево, на среднем Android нет. Плюс в проекте уже
 * ловили просадку отрисовки от полноэкранных композитных слоёв.
 */
export const QUALITY = {
    high:   { particles: 1.0, stars: 1.0, bloom: true,  engravings: true,  reflections: true,  shadowBlur: 1.0 },
    medium: { particles: 0.5, stars: 0.5, bloom: true,  engravings: true,  reflections: false, nftImages: true,  shadowBlur: 0.6 },
    low:    { particles: 0.0, stars: 0.2, bloom: false, engravings: false, reflections: false, nftImages: true,  shadowBlur: 0.0 },
    still:  { particles: 0.0, stars: 0.0, bloom: false, engravings: true,  reflections: false, nftImages: true,  shadowBlur: 0.0 }
};

export function detectQuality() {
    if (typeof window === "undefined") return "high";
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return "still";
    const coarse = window.matchMedia && window.matchMedia("(hover:none)").matches;
    const cores = navigator.hardwareConcurrency || 4;
    const narrow = window.innerWidth <= 768;
    if (coarse && (cores <= 4 || narrow)) return "low";
    if (coarse || narrow) return "medium";
    return "high";
}

export function getTheme(pool) {
    return pool === "weekly" ? WEEKLY : DAILY;
}

export function rarityOf(tier) {
    return RARITY[String(tier || "common").toLowerCase()] || RARITY.common;
}

export { RARITY, DAILY, WEEKLY };
export default { getTheme, rarityOf, detectQuality, QUALITY, RARITY };
