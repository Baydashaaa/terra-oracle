/**
 * Oracle Draw — расписание розыгрышей. ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ.
 *
 * Этот файл лежит В ДВУХ РЕПО и должен быть в них ПОБАЙТОВО ОДИНАКОВЫМ:
 *   terra-oracle/assets/js/draw-schedule.js   (terraoracle.io — читает treasury.js)
 *   oracle-draw/assets/js/draw-schedule.js    (draw.terraoracle.io — читает app.js)
 * Правишь в одном — копируй во второй. Расхождение здесь = расхождение таймеров,
 * а это ровно тот баг, из-за которого файл и появился.
 *
 * ─── Откуда взято расписание ────────────────────────────────────────────────
 * .github/workflows/lottery-draw.yml, шаг «Determine draw type»:
 *     DAY=$(date -u +%u)
 *     if [ "$DAY" = "1" ]; then type=weekly; else type=daily; fi
 * Cron `0 20 * * *`, ОДИН job за запуск, ветка исключающая. Дальше
 * lottery-draw.js получает один DRAW_TYPE и делает if (IS_DAILY) … else …
 *
 * Следствие: DAILY ПО ПОНЕДЕЛЬНИКАМ НЕ ПРОВОДИТСЯ.
 * Подтверждено историей winners.json на 3 авг 2026: 92 daily-записи, ни одной
 * в понедельник (дыры на 2026-07-20 и 2026-07-27); все 15 weekly — понедельники.
 *
 * Если расписание в workflow когда-нибудь поменяется — менять здесь, в Config.js
 * бандла V2 и в самом workflow. Пока таких мест три, dev/_test_schedule.js
 * сверяет этот файл с DrawClock.js и падает при расхождении.
 *
 * Грузить ОБЫЧНЫМ <script> ДО app.js / treasury.js. Не модуль — намеренно:
 * порядок загрузки должен быть предсказуемым, без импортов и без defer.
 */
(function (root) {
  'use strict';

  var DRAW_HOUR_UTC          = 20;   // час розыгрыша, UTC
  var DRAW_MINUTE_UTC        = 0;
  var WEEKLY_DAY_UTC         = 1;    // 0 = вс, 1 = пн
  var DAILY_SKIPS_WEEKLY_DAY = true; // в день weekly отдельного daily нет
  var DAY_MS                 = 86400000;

  /** Метка 20:00 UTC того календарного дня (UTC), в который попадает ts */
  function deadlineOfDay(ts) {
    var d = new Date(ts);
    return Date.UTC(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
      DRAW_HOUR_UTC, DRAW_MINUTE_UTC, 0, 0
    );
  }

  /** Разыгрывается ли пул в день, на который приходится дедлайн */
  function poolRunsAt(pool, deadlineTs) {
    var isWeeklyDay = new Date(deadlineTs).getUTCDay() === WEEKLY_DAY_UTC;
    if (pool === 'weekly') return isWeeklyDay;
    return DAILY_SKIPS_WEEKLY_DAY ? !isWeeklyDay : true;
  }

  /**
   * Ближайший будущий розыгрыш пула. Возвращает Date.
   * Ровно 20:00:00.000 будущим НЕ считается — в этот момент уже идёт розыгрыш.
   */
  function nextDraw(pool, from) {
    var now = (from instanceof Date) ? from.getTime()
            : (typeof from === 'number') ? from
            : Date.now();
    for (var i = 0; i <= 8; i++) {
      var ts = deadlineOfDay(now + i * DAY_MS);
      if (ts > now && poolRunsAt(pool, ts)) return new Date(ts);
    }
    return null; // недостижимо: подходящий день есть в любых 8 сутках
  }

  /** Последний прошедший розыгрыш пула. Возвращает Date или null */
  function prevDraw(pool, from) {
    var now = (from instanceof Date) ? from.getTime()
            : (typeof from === 'number') ? from
            : Date.now();
    for (var i = 0; i <= 8; i++) {
      var ts = deadlineOfDay(now - i * DAY_MS);
      if (ts <= now && poolRunsAt(pool, ts)) return new Date(ts);
    }
    return null;
  }

  /** Миллисекунд до ближайшего розыгрыша пула */
  function msToNext(pool, from) {
    var now = (from instanceof Date) ? from.getTime()
            : (typeof from === 'number') ? from
            : Date.now();
    var n = nextDraw(pool, now);
    return n === null ? null : (n.getTime() - now);
  }

  /**
   * ЕДИНЫЙ ФОРМАТ ОТСЧЁТА для всех текстовых подписей на обоих сайтах.
   *   больше суток → "1d 02:57"
   *   меньше суток → "02:57:23"
   * Секунды в верхней ветке намеренно убраны: при остатке в сутки они
   * не несут смысла, а строка скачет и мешает читать.
   */
  function formatCountdown(ms) {
    if (!(ms > 0)) return '00:00:00';
    var t = Math.floor(ms / 1000);
    var d = Math.floor(t / 86400);
    var h = Math.floor((t % 86400) / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    return d > 0 ? (d + 'd ' + pad(h) + ':' + pad(m))
                 : (pad(h) + ':' + pad(m) + ':' + pad(s));
  }

  /** Разбор на части — для флип-счётчика с отдельными коробками DAYS/HOURS/… */
  function parts(ms) {
    if (!(ms > 0)) return { d: 0, h: 0, m: 0, s: 0 };
    var t = Math.floor(ms / 1000);
    return {
      d: Math.floor(t / 86400),
      h: Math.floor((t % 86400) / 3600),
      m: Math.floor((t % 3600) / 60),
      s: t % 60
    };
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  /** true, если сегодня в 20:00 UTC этого пула не будет (daily в понедельник) */
  function isPausedToday(pool, from) {
    var now = (from instanceof Date) ? from : new Date();
    var today = deadlineOfDay(now.getTime());
    return !poolRunsAt(pool, today);
  }

  root.DRAW_SCHEDULE = {
    hourUTC:             DRAW_HOUR_UTC,
    minuteUTC:           DRAW_MINUTE_UTC,
    weeklyDayUTC:        WEEKLY_DAY_UTC,
    dailySkipsWeeklyDay: DAILY_SKIPS_WEEKLY_DAY,
    next:                nextDraw,
    prev:                prevDraw,
    msToNext:            msToNext,
    format:              formatCountdown,
    parts:               parts,
    poolRunsAt:          poolRunsAt,
    isPausedToday:       isPausedToday
  };
})(typeof window !== 'undefined' ? window : globalThis);
