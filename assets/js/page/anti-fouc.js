// ── Instant-correct-page (anti-FOUC) ──────────────────────────────────────
// .page{display:none} / .page.active{display:block} (see style.css), and
// ONLY #page-home has class="page active" hardcoded in the static markup.
// app.js sits near the very end of <body> (not deferred), so on a direct
// load/refresh of e.g. /reputation the browser fully parses+paints this
// large document - Home visible per the static markup - LONG before JS at
// the bottom ever runs showPage()/showRepPage() to switch it. That's the
// "flash of Home, then switches after ~1s" symptom.
// Fix: run synchronously HERE, before any .page div below is parsed, and
// inject a style override so the CORRECT page is what gets painted first -
// zero flash, independent of how long the rest of the page takes to load.
(function () {
  try {
    var validTabs = ['home','board','ask','chat','vote','about','bag','treasury','profile','reputation'];
    var pathParts = location.pathname.replace(/^\//, '').split('/');
    var page = pathParts[0] || 'home';
    if (!validTabs.includes(page)) page = 'home';
    if (page !== 'home') {
      var s = document.createElement('style');
      s.id = 'fouc-fix';
      s.textContent = '#page-home.active{display:none!important}#page-' + page + '{display:block!important}';
      document.head.appendChild(s);
    }
  } catch (e) {}
})();
