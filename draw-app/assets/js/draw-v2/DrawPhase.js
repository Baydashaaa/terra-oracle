/**
 * Oracle Draw V2 - DrawPhase
 *
 * Одна фаза управляет всем. Ни таймер, ни колесо, ни popup не держат
 * собственного состояния - они читают фазу.
 *
 *   OPEN ──T-15м──> LOCKED ──T-30с──> PRE_DRAW ──дедлайн──> AWAITING
 *                                                              │
 *                          результат есть ──────────────────────┤
 *                                                              ▼
 *                                            REVEALING ──> REVEALED
 *                                                              │
 *                                       раунд пропущен ──> ROLLOVER
 *
 * Флаги animation / replay / revealed сюда не нужны: они выводятся из
 * фазы. Два источника правды - это ровно та ошибка, из-за которой
 * currentLottery и selectedPool разъезжались при минте.
 */

export const PHASE = {
    OPEN: "OPEN",           // приём NFT открыт
    LOCKED: "LOCKED",       // последние минуты, приём закрыт
    PRE_DRAW: "PRE_DRAW",   // Oracle просыпается, колесо раскручивается вхолостую
    AWAITING: "AWAITING",   // дедлайн прошёл, ждём публикации результата
    REVEALING: "REVEALING", // идёт финальная анимация
    REVEALED: "REVEALED",   // результат показан
    ROLLOVER: "ROLLOVER"    // раунд не состоялся, билеты переходят дальше
};

/** Можно ли крутить/менять данные в этой фазе */
export const PHASE_RULES = {
    [PHASE.OPEN]: { entriesOpen: true, wheelIdle: false, showsResult: false },
    [PHASE.LOCKED]: { entriesOpen: false, wheelIdle: false, showsResult: false },
    [PHASE.PRE_DRAW]: { entriesOpen: false, wheelIdle: true, showsResult: false },
    [PHASE.AWAITING]: { entriesOpen: false, wheelIdle: true, showsResult: false },
    [PHASE.REVEALING]: { entriesOpen: false, wheelIdle: false, showsResult: false },
    [PHASE.REVEALED]: { entriesOpen: false, wheelIdle: false, showsResult: true },
    [PHASE.ROLLOVER]: { entriesOpen: true, wheelIdle: false, showsResult: false }
};

/**
 * Вычисление фазы. Чистая функция - её легко прогнать тестом на любой
 * момент времени, не дожидаясь 20:00.
 *
 * @param {object} ctx
 * @param {number} ctx.now
 * @param {number|null} ctx.deadline      ближайший дедлайн пула
 * @param {number|null} ctx.lastDeadline  последний прошедший дедлайн
 * @param {object|null} ctx.result        нормализованный раунд или null
 * @param {boolean} ctx.revealing         сейчас крутится финальная анимация
 * @param {object} ctx.cfg                LOCK_MS / PRE_DRAW_MS / AWAIT_TIMEOUT_MS
 */
export function derivePhase(ctx) {
    const { now, deadline, lastDeadline, result, revealing, cfg } = ctx;

    if (revealing) return PHASE.REVEALING;

    const covers = resultCovers(result, lastDeadline);

    // REVEALED держим ограниченное время после дедлайна. Иначе результат
    // вчерашнего раунда висит на колесе до следующих 20:00, вместо того
    // чтобы показывать отсчёт до нового розыгрыша.
    const withinReveal = lastDeadline === null ||
        (now - lastDeadline) <= (cfg.REVEAL_WINDOW_MS || 60 * 60 * 1000);

    if (covers && withinReveal) return result.skipped ? PHASE.ROLLOVER : PHASE.REVEALED;

    if (lastDeadline !== null && !covers) {
        const since = now - lastDeadline;
        // Результата за прошедший дедлайн ещё нет - ждём, но не вечно
        if (since >= 0 && since <= cfg.AWAIT_TIMEOUT_MS) return PHASE.AWAITING;
    }

    if (deadline !== null) {
        const left = deadline - now;
        if (left <= cfg.PRE_DRAW_MS) return PHASE.PRE_DRAW;
        if (left <= cfg.LOCK_MS) return PHASE.LOCKED;
    }

    return PHASE.OPEN;
}

/** Относится ли результат к последнему прошедшему дедлайну */
function resultCovers(result, lastDeadline) {
    if (!result) return false;
    if (lastDeadline === null) return true;
    if (result.drawnAt === null || result.drawnAt === undefined) return false;
    // допуск: block_time может быть на минуту раньше метки 20:00
    return result.drawnAt >= lastDeadline - 5 * 60 * 1000;
}

/** Человекочитаемая подпись фазы - один словарь вместо строк по всему UI */
export const PHASE_TEXT = {
    [PHASE.OPEN]: { title: "Next draw in {t}", sub: "Wheel spins automatically at 20:00 UTC" },
    [PHASE.LOCKED]: { title: "Entries close in {t}", sub: "Last chance to enter this round" },
    [PHASE.PRE_DRAW]: { title: "Oracle is reading the blockchain...", sub: "Round closed · {t} to the block" },
    [PHASE.AWAITING]: { title: "Oracle is reading the blockchain...", sub: "Waiting for the on-chain result" },
    [PHASE.REVEALING]: { title: "Selecting winner", sub: "Landing on ticket #{i}" },
    [PHASE.REVEALED]: { title: "Winner Selected", sub: "Payout sent automatically" },
    [PHASE.ROLLOVER]: { title: "Round rolled over", sub: "Not enough entries - tickets stay active" }
};
