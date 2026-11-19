// Treasury vaults: a gauge on each pool card and a small currency unit on
// the big figures. Visual only - reads what treasury.js already wrote and
// the shared draw schedule; writes nothing that other code reads.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var DAY = 864e5, WEEK = 7 * DAY;

  function parseLunc(t) {
    var m = String(t || '').replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
    if (!m) return NaN;
    var k = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
    return parseFloat(m[1]) * k;
  }

  // "77.6K LUNC" -> "77.6K " + <span class="tv-u">LUNC</span>; a space is
  // kept so textContent still reads the same.
  function splitUnit(el) {
    if (!el || el.querySelector('.tv-u')) return;
    var m = String(el.textContent).trim().match(/^(.+?)\s+(LUNC|USTC|TCO)$/);
    if (!m) return;
    el.textContent = '';
    el.appendChild(document.createTextNode(m[1] + ' '));
    var u = document.createElement('span'); u.className = 'tv-u'; u.textContent = m[2];
    el.appendChild(u);
  }
  function watchUnit(id) {
    var el = $(id); if (!el || el.dataset.tvUnit) return;
    el.dataset.tvUnit = '1'; splitUnit(el);
    new MutationObserver(function () { splitUnit(el); }).observe(el, { childList: true, characterData: true, subtree: true });
  }

  function gauge(card, key) {
    var g = card.querySelector('.tv-gauge');
    if (!g) {
      g = document.createElement('div');
      g.className = 'tv-gauge'; g.setAttribute('data-k', key);
      g.innerHTML = '<div class="tv-gauge-top"><span></span><b></b></div><div class="tv-track"><i></i></div>';
      var addr = card.querySelector('.tre-addr');
      card.insertBefore(g, addr || null);
    }
    return g;
  }
  function setGauge(g, label, value, frac) {
    var f = Math.max(0, Math.min(1, isFinite(frac) ? frac : 0));
    var s = g.querySelector('span'), b = g.querySelector('b'), i = g.querySelector('i');
    if (s.textContent !== label) s.textContent = label;
    if (b.textContent !== value) b.textContent = value;
    i.style.width = (f * 100).toFixed(1) + '%';
  }

  function tick() {
    var cards = document.querySelectorAll('#page-treasury .tre-pools .tre-card');
    if (cards.length < 4) return;
    var S = window.DRAW_SCHEDULE;

    // Treasury: its share of everything the protocol holds
    var tvl = parseLunc($('t-total-tvl') && $('t-total-tvl').textContent);
    var tre = parseLunc($('t-oracle-bal') && $('t-oracle-bal').textContent);
    var share = tvl > 0 && tre >= 0 ? tre / tvl : NaN;
    setGauge(gauge(cards[0], 'share'), 'Share of TVL', isFinite(share) ? Math.round(share * 100) + '%' : '-', share);

    // Daily / Weekly: how far the round has run
    if (S && typeof S.msToNext === 'function') {
      var d = 1 - S.msToNext('daily') / DAY, w = 1 - S.msToNext('weekly') / WEEK;
      setGauge(gauge(cards[1], 'round'), 'Round progress', Math.round(d * 100) + '%', d);
      setGauge(gauge(cards[2], 'round'), 'Week progress', Math.round(w * 100) + '%', w);
    }

    // Circuit: zones taken on the board
    var z = String(($('t-circuit-zones') || {}).textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
    if (z) setGauge(gauge(cards[3], 'board'), 'Board filled', z[1] + ' / ' + z[2], +z[1] / +z[2]);
    else setGauge(gauge(cards[3], 'board'), 'Board filled', '-', 0);
  }

  function start() {
    ['t-total-tvl', 't-oracle-bal', 't-draw-bal', 't-weekly-bal', 't-circuit-bal'].forEach(watchUnit);
    tick();
    setInterval(tick, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
