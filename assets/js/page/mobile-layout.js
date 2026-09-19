// Мобильная и планшетная раскладка (до 1180 px, как брейкпоинт в shell.css).
//
// Правая колонка aside.side на десктопе стоит в .app после main, а футер
// живёт внутри main. На узком экране это давало порядок "раздел, футер,
// колонка" на КАЖДОЙ странице. Здесь колонка переносится в конец
// #page-home: видна только на главной и всегда до футера. На широком
// экране возвращается на своё место. Узлы те же, поэтому скрипты карточек
// (side-draw, side-activity, side-leaderboard) продолжают работать.
(function () {
  'use strict';

  function start() {
    var side = document.querySelector('.app > aside.side');
    var home = document.getElementById('page-home');
    if (!side || !home) return;

    var anchor = document.createComment('side-anchor');
    side.parentNode.insertBefore(anchor, side);

    var mq = window.matchMedia('(max-width:1180px)');
    function place() {
      if (mq.matches) {
        if (side.parentNode !== home) {
          home.appendChild(side);
          side.classList.add('side-in-home');
        }
      } else if (anchor.nextSibling !== side) {
        anchor.parentNode.insertBefore(side, anchor.nextSibling);
        side.classList.remove('side-in-home');
      }
    }
    place();
    if (mq.addEventListener) mq.addEventListener('change', place);
    else if (mq.addListener) mq.addListener(place);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
