/* data-origin.js - ЕДИНСТВЕННОЕ место, где сказано, откуда Draw берёт данные.
 *
 * Файлы winners.json, rounds/*.json, free-entries.json и rewards-proofs.json
 * пишут воркфлоу репо oracle-draw - в свой репо, на draw.terraoracle.io.
 * Копия draw-app/ внутри terra-oracle показывается в рамке на terraoracle.io/draw
 * и своих данных НЕ имеет: относительный путь упирался бы в замороженную копию,
 * путь от корня - в 404 на terraoracle.io.
 *
 * Поэтому адрес данных считается по домену страницы:
 *   draw.terraoracle.io  -> свой корень (пустой префикс)
 *   любой другой домен   -> https://draw.terraoracle.io
 * GitHub Pages отдаёт access-control-allow-origin: *, кросс-доменный GET проходит.
 *
 * Файл один и тот же в обоих репо - править в oracle-draw и копировать сюда.
 * Подключается ПЕРВЫМ и БЕЗ defer: circuit-claim.js читает drawDataUrl на загрузке.
 * Никаких const на верхнем уровне - только свойства window, иначе одинаковое имя
 * в другом скрипте роняет разбор файла.
 */
(function () {
  var DATA_HOST = 'draw.terraoracle.io';
  var DATA_ORIGIN = 'https://' + DATA_HOST;

  window.DRAW_DATA_ORIGIN = (location.hostname === DATA_HOST) ? '' : DATA_ORIGIN;

  // drawDataUrl('winners.json')            -> https://draw.terraoracle.io/winners.json
  // drawDataUrl('rounds/daily_X.json')     -> https://draw.terraoracle.io/rounds/daily_X.json
  // на самом draw.terraoracle.io           -> /winners.json
  window.drawDataUrl = function (p) {
    return window.DRAW_DATA_ORIGIN + '/' + String(p == null ? '' : p).replace(/^\.?\/+/, '');
  };
})();
