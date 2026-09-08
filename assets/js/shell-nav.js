// Мост между меню новой оболочки и боевым роутером.
// Шаг 3 переноса дизайна, 8 сентября 2026.
//
// Роутер прототипа (VIEWS + show()) сюда НЕ переносится. У боевого showPage
// есть то, чего у прототипа нет: подгрузка вопросов, рендер чата, разбор
// мобильного чата, чистые адреса /chat вместо ?v=chat и свой popstate.
// Поэтому новые ссылки просто зовут боевые функции по этой таблице.
(function () {
  'use strict';

  // имя вида в оболочке -> что делать
  var ROUTE = {
    home:       function () { showPage('home'); },
    chat:       function () { showPage('chat'); },
    ask:        function () { showPage('ask'); },
    governance: function () { showPage('vote'); },
    nft:        function () { showPage('bag'); },
    treasury:   function () { showPage_treasury(null, null, false); },
    reputation: function () { showRepPage('leaderboard'); },
    draw:       function () { window.open('https://draw.terraoracle.io/', '_blank', 'noopener'); },
    markets:      null,  // раздела на боевом сайте пока нет
    achievements: null   // тоже нет
  };

  // обратная таблица: адрес -> имя вида, чтобы подсветить пункт меню
  function viewFromPath() {
    var p = location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
    if (p === '' || p === 'index.html') return 'home';
    if (p === 'vote') return 'governance';
    if (p === 'bag') return 'nft';
    if (p === 'reputation') return 'reputation';
    if (p === 'treasury') return 'treasury';
    if (p === 'chat' || p === 'ask') return p;
    return null;   // board, about, profile - пунктов в новом меню нет
  }

  function highlight() {
    var v = viewFromPath();
    document.querySelectorAll('[data-view]').forEach(function (a) {
      if (a.dataset.view === v) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  // На десктопе прокручивается .main, а не окно, поэтому боевой
  // smoothScrollTop() промахивается мимо контейнера.
  function scrollMainTop() {
    var m = document.querySelector('.main');
    if (m) m.scrollTop = 0;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-view]');
    if (!a) return;
    e.preventDefault();
    var name = a.dataset.view;
    var go = ROUTE[name];
    if (typeof go !== 'function') return;   // помечен как SOON, ничего не делаем
    if (typeof window.dismissModal === 'function' && a.closest('.scrim-modal')) window.dismissModal();
    go();
    scrollMainTop();
    highlight();
  });

  // Пункты, под которые боевого раздела ещё нет, помечаем меткой SOON.
  // Если у пункта уже есть метка (у Markets в прототипе стоит NEW),
  // текст в ней заменяется - двух меток в строке быть не должно.
  // Появится раздел - вписать функцию в ROUTE вместо null, метка уйдёт сама.
  Object.keys(ROUTE).forEach(function (name) {
    if (ROUTE[name]) return;
    document.querySelectorAll('[data-view="' + name + '"]').forEach(function (a) {
      a.classList.add('is-soon');
      if (a.classList.contains('nav')) {
        var t = a.querySelector('.tag');
        if (!t) {
          t = document.createElement('span');
          t.className = 'tag';
          a.appendChild(t);
        }
        t.textContent = 'SOON';
      }
      if (a.classList.contains('mod') && !a.querySelector('.badge')) {
        var b = document.createElement('span');
        b.className = 'badge';
        b.textContent = 'SOON';
        a.appendChild(b);
      }
    });
  });

  addEventListener('popstate', function () { setTimeout(highlight, 0); });
  highlight();
})();
