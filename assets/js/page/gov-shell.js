// Governance: связка новой шапки раздела с боевым vote.js.
// Шаг 4 переноса дизайна, 8 сентября 2026.
//
// vote.js НЕ трогается. Обе боевые функции просто оборачиваются:
//  - filterVotes  дополнительно проставляет aria-selected, на него смотрит .ptabs
//  - renderVotes  дополнительно пересчитывает плашки в шапке из VOTES_DATA
(function () {
  'use strict';

  function syncTabs() {
    var box = document.getElementById('govTabs');
    if (!box) return;
    box.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-selected', b.classList.contains('active') ? 'true' : 'false');
    });
  }

  function paintStats() {
    var box = document.getElementById('govStats');
    if (!box || typeof VOTES_DATA === 'undefined' || !Array.isArray(VOTES_DATA)) return;

    var open = VOTES_DATA.filter(function (v) {
      return v.status !== 'closed' && v.status !== 'stopped' && v.status !== 'upcoming';
    });
    var votes = VOTES_DATA.reduce(function (s, v) { return s + (v.totalVotes || 0); }, 0);
    var withQuorum = VOTES_DATA.filter(function (v) { return v.quorum > 0; });
    var part = withQuorum.length
      ? withQuorum.reduce(function (s, v) {
          return s + Math.min(100, (v.totalVotes || 0) / v.quorum * 100);
        }, 0) / withQuorum.length
      : 0;

    var stats = [
      { n: VOTES_DATA.length,            l: 'Total proposals',    ic: 'g-proposals' },
      { n: votes.toLocaleString('en-US'), l: 'Total votes',        ic: 'g-votes' },
      { n: part.toFixed(1) + '%',        l: 'Avg. participation', ic: 'g-participation' },
      { n: open.length,                  l: 'Active proposals',   ic: 'g-scales' }
    ];

    box.innerHTML = stats.map(function (s) {
      return '<div class="s"><img src="assets/img/icons/' + s.ic + '.webp" alt="" ' +
             'width="128" height="128" loading="lazy"><div><b>' + s.n +
             '</b><span>' + s.l + '</span></div></div>';
    }).join('');
  }

  function wrap(name, after) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      var r = orig.apply(this, arguments);
      try { after(); } catch (e) { console.warn('[gov-shell] ' + name + ':', e); }
      return r;
    };
  }

  wrap('filterVotes', syncTabs);
  wrap('renderVotes', function () { syncTabs(); paintStats(); });
})();
