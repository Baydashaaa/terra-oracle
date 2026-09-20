// Мост между меню новой оболочки и боевым роутером.
// Шаг 3 переноса дизайна, 8 сентября 2026.
//
// Роутер прототипа (VIEWS + show()) сюда НЕ переносится. У боевого showPage
// есть то, чего у прототипа нет: подгрузка вопросов, рендер чата, разбор
// мобильного чата, чистые адреса /chat вместо ?v=chat и свой popstate.
// Поэтому новые ссылки просто зовут боевые функции по этой таблице.
(function () {
  'use strict';

  // Ключ предпросмотра ставится сразу при загрузке, а не внутри обработчика:
  // до клика по меню надо ещё дожить, а адрес с ?preview=1 теряется при
  // первом же переходе, потому что showPage переписывает путь.
  if (location.search.indexOf('preview=1') > -1) {
    try { sessionStorage.setItem('mkPreview', '1'); } catch (e) {}
  }

  // имя вида в оболочке -> что делать
  var ROUTE = {
    home:       function () { showPage('home'); },
    chat:       function () { showPage('chat'); },
    ask:        function () { showPage('ask'); },
    governance: function () { showPage('vote'); },
    nft:        function () { showPage('bag'); },
    treasury:   function () { showPage_treasury(null, null, false); },
    reputation: function () { showRepPage('leaderboard'); },
    draw:       function () { showPage('draw'); },
    board:      function () { showPage('board'); },
    // Markets не готов и публично закрыт. Открывается только адресом с
    // ключом: /markets?preview=1 - чтобы смотреть незаконченный раздел
    // на проде. Разметка раздела всё равно уезжает в index.html, так что
    // это защита от случайного захода, а не запрет.
    markets:    function () {
      // Ключ запоминается на вкладку: showPage переписывает адрес на
      // чистый путь, и ?preview=1 терялся после первого же перехода.
      if (location.search.indexOf('preview=1') > -1) {
        try { sessionStorage.setItem('mkPreview', '1'); } catch (e) {}
      }
      var on = false;
      try { on = sessionStorage.getItem('mkPreview') === '1'; } catch (e) {}
      if (on) showPage('markets');
    },
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
    if (p === 'chat' || p === 'ask' || p === 'board' || p === 'draw') return p;
    // draw попал сюда 20 сентября: без него нижняя панель на телефоне не
    // подсвечивала раздел Draw - viewFromPath возвращал null, и highlight()
    // снимал aria-current со всех пунктов разом.
    // markets намеренно не подсвечиваем: пункт закрыт, см. таблицу выше
    return null;   // about, profile - пунктов в новом меню нет
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
