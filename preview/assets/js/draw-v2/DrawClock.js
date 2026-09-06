/**
 * Oracle Draw V2 - DrawClock
 * Вся арифметика времени в одном месте, строго в UTC.
 *
 * ВАЖНО: round_id здесь НЕ вычисляется. В winners.json он сдвинут на день
 * вперёд (getCurrentRoundId зовётся уже после 20:00), и любая своя формула
 * разъедется с файлом. Сравниваем только строки round_id из самого файла.
 */

import { CONFIG } from "./Config.js";

const DAY = 86400000;

/** Метка 20:00 UTC того календарного дня (UTC), в который попадает ts */
function deadlineOfDay(ts) {
    const d = new Date(ts);
    return Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        CONFIG.DRAW_HOUR_UTC,
        CONFIG.DRAW_MINUTE_UTC,
        0, 0
    );
}

/** Разыгрывается ли этот пул в день, на который приходится дедлайн */
export function poolRunsAt(pool, deadlineTs) {
    const isWeeklyDay = new Date(deadlineTs).getUTCDay() === CONFIG.WEEKLY_WEEKDAY_UTC;
    if (pool === CONFIG.WEEKLY) return isWeeklyDay;
    return CONFIG.DAILY_SKIPS_WEEKLY_DAY ? !isWeeklyDay : true;
}

/** Ближайший будущий дедлайн пула (мс) */
export function nextDeadline(pool, now = Date.now()) {
    for (let i = 0; i <= 8; i++) {
        const ts = deadlineOfDay(now + i * DAY);
        if (ts > now && poolRunsAt(pool, ts)) return ts;
    }
    return null;
}

/** Последний прошедший дедлайн пула (мс) */
export function prevDeadline(pool, now = Date.now()) {
    for (let i = 0; i <= 8; i++) {
        const ts = deadlineOfDay(now - i * DAY);
        if (ts <= now && poolRunsAt(pool, ts)) return ts;
    }
    return null;
}

/** Мы в "горячем" окне вокруг розыгрыша? */
export function inActiveWindow(pool, now = Date.now()) {
    const next = nextDeadline(pool, now);
    const prev = prevDeadline(pool, now);
    if (next !== null && next - now <= CONFIG.ACTIVE_BEFORE_MS) return true;
    if (prev !== null && now - prev <= CONFIG.ACTIVE_AFTER_MS) return true;
    return false;
}

/** Мс до следующего дедлайна (для обратного отсчёта) */
export function msToNextDeadline(pool, now = Date.now()) {
    const next = nextDeadline(pool, now);
    return next === null ? null : next - now;
}

/**
 * Отсчёт для UI. Формат ОБЩИЙ с assets/js/draw-schedule.js - тем файлом,
 * по которому считают treasury.js и app.js:
 *   больше суток → "1d 02:57"
 *   меньше суток → "02:57:23"
 * Раньше здесь часы не сворачивались в дни и при остатке больше суток
 * выходило "26:57:00" - четвёртый формат одного и того же числа.
 * Арифметика дедлайнов в этом файле своя намеренно: бандл - ES-модуль и
 * не должен зависеть от порядка загрузки обычных <script>. Совпадение с
 * draw-schedule.js стережёт dev/_test_schedule.js - он сверяет обе
 * реализации почасово на две недели вперёд и падает при расхождении.
 */
export function formatCountdown(ms) {
    if (ms === null || !(ms > 0)) return "00:00:00";
    const total = Math.floor(ms / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const p = (n) => String(n).padStart(2, "0");
    return d > 0 ? `${d}d ${p(h)}:${p(m)}` : `${p(h)}:${p(m)}:${p(s)}`;
}
