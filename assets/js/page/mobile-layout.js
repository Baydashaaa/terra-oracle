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

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    // Шапка и нижнее меню могут поменять высоту (шрифты, поворот), а чат
    // растягивается ровно между ними - пока чат открыт, сверяемся.
    setInterval(function () {
      var chat = document.getElementById('page-chat');
      if (chat && chat.classList.contains('active')) measure();
    }, 800);
  }

  // Чат на телефоне - fixed-страница между шапкой и нижним меню. Их высоты
  // меряем и отдаём в CSS как --m-top и --m-nav (правила в mobile.css).
  var navEl = null;
  function bottomNav() {
    if (navEl && navEl.isConnected) return navEl;
    var vw = window.innerWidth, vh = window.innerHeight;
    var list = document.querySelectorAll('nav, [class*="nav"], [class*="tab"], [id*="nav"], [id*="tab"]');
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (getComputedStyle(e).position !== 'fixed') continue;
      var r = e.getBoundingClientRect();
      if (r.height > 30 && r.height < 140 && r.width >= vw * 0.8 && r.bottom >= vh - 2) { navEl = e; return e; }
    }
    return null;
  }

  function measure() {
    var root = document.documentElement;
    var tb = document.querySelector('.topbar');
    var top = tb ? Math.max(0, Math.round(tb.getBoundingClientRect().bottom)) + 8 : 60;
    var nav = bottomNav();
    var navH = nav ? Math.max(0, Math.round(window.innerHeight - nav.getBoundingClientRect().top)) : 0;
    root.style.setProperty('--m-top', top + 'px');
    root.style.setProperty('--m-nav', navH + 'px');

    // Страница чата в потоке (position:static), поэтому ей нужна точная
    // высота: от её верха в документе до нижнего меню, с зазором 8 px.
    var chat = document.getElementById('page-chat');
    if (chat && chat.classList.contains('active')) {
      var docTop = chat.getBoundingClientRect().top + window.scrollY;
      var h = Math.round(window.innerHeight - docTop - navH - 8);
      if (h > 240) root.style.setProperty('--m-chat-h', h + 'px');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
