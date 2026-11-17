// Live line on the module cards of the home page: each card shows one real,
// current number from its module (pool, open questions, zones, markets), so
// the cards read as running systems rather than pictures. Everything is read
// from data the page already has; a card with nothing to say shows no line.
(function () {
  'use strict';
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  // the frame sends placeholders ('-', '—') until it has numbers
  function real(v) { var t = String(v === undefined || v === null ? '' : v).trim(); return t && !/^[-\u2013\u2014.]+$/.test(t) ? t : ''; }
  function text(view) {
    try {
      var st = window.oracleDrawStats || {};
      if (view === 'draw') {
        var p = real(st.daily && st.daily.pool);
        return p ? 'Daily pool ' + p + ' LUNC' : '';
      }
      if (view === 'circuit') {
        var z = real(st.circuit && st.circuit.pool);
        return z ? z + ' / 250 zones claimed' : '';
      }
      if (view === 'ask') {
        if (typeof questions === 'undefined' || !questions.length) return '';
        return fmt(questions.length) + (questions.length === 1 ? ' open question' : ' open questions');
      }
      if (view === 'chat') {
        if (typeof cachedMsgs === 'undefined' || !cachedMsgs.length) return '';
        var n = cachedMsgs.filter(function (m) { return !m.isSystem; }).length;
        return n ? fmt(n) + ' messages on chain' : '';
      }
      if (view === 'markets') {
        var el = document.getElementById('home-markets-count');
        return el && el.textContent.trim() ? el.textContent.trim() : '';
      }
    } catch (e) {}
    return '';
  }
  function paint() {
    document.querySelectorAll('.mods > .mod[data-view]').forEach(function (card) {
      // the Circuit card links to the draw view with its own tab
      var t = text(card.getAttribute('data-draw-tab') === 'circuit' ? 'circuit' : card.getAttribute('data-view'));
      var chip = card.querySelector('.mod-live');
      if (!t) { if (chip) chip.hidden = true; return; }
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'mod-live';
        chip.innerHTML = '<i aria-hidden="true"></i><span></span>';
        card.appendChild(chip);
      }
      chip.hidden = false;
      var s = chip.querySelector('span');
      if (s.textContent !== t) s.textContent = t;
    });
  }
  function start() { paint(); setInterval(paint, 3000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
