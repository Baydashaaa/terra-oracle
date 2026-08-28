// ─── NAVIGATION ───────────────────────────────────────────────
function _isMobileChat() {
  return window.matchMedia('(hover:none)').matches || window.innerWidth <= 900;
}

function showPage(name, e, skipHistory) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const pg = document.getElementById('page-' + name);
  if (pg) pg.classList.add('active');
  if (e && e.target) e.target.classList.add('active');
  if (name === 'board') { if (!_questionsLoaded) loadQuestionsFromWorker(); else renderBoard(); }
  if (name === 'vote') { applyStoredVotes(); applyVoteStates(); renderVotes(); loadVotesFromWorker(); }
  if (name === 'chat') renderChatPage();
  if (name === 'bag')  renderOracleBag();
  // Mobile chat: hide footer, expand messages area
  const footer = document.querySelector('footer');
  if (_isMobileChat()) {
    if (name === 'chat') {
      if (footer) footer.style.display = 'none';
      document.body.classList.add('mobile-chat-open');
      document.body.style.overflow = 'hidden';
      document.body.style.paddingBottom = '0';
      document.documentElement.style.paddingBottom = '0';
      const chatPage = document.getElementById('page-chat');
      if (chatPage) {
        chatPage.style.padding = '8px 12px 0';
        chatPage.style.paddingBottom = '0';
        chatPage.style.marginBottom = '0';
      }
      const inputBar = document.getElementById('chat-input-bar');
      if (inputBar) { inputBar.style.padding = '8px 0 0'; inputBar.style.marginBottom = '0'; }
      // Recalculate after DOM fully rendered (double rAF ensures offsetHeight is accurate)
      function recalcMsgsHeight() {
        const msgs = document.getElementById('chat-page-messages');
        const nav = document.querySelector('nav');
        const ib = document.getElementById('chat-input-bar');
        const badge = document.querySelector('.chat-mobile-badge');
        if (!msgs) return;
        const navH = nav ? nav.offsetHeight : 64;
        const inputH = ib ? ib.offsetHeight : 0;
        const badgeH = badge ? badge.offsetHeight : 0;
        const msgsH = window.innerHeight - navH - inputH - badgeH - 8;
        msgs.style.minHeight = Math.max(msgsH, 200) + 'px';
        msgs.style.overflowY = 'auto';
      }
      requestAnimationFrame(() => requestAnimationFrame(recalcMsgsHeight));
      // Also run after 300ms for slow-rendering browsers (Keplr)
      setTimeout(recalcMsgsHeight, 300);
    } else {
      if (footer) footer.style.display = '';
      document.body.classList.remove('mobile-chat-open');
      document.body.style.overflow = '';
      document.body.style.paddingBottom = '';
      document.documentElement.style.paddingBottom = '';
      const chatPage = document.getElementById('page-chat');
      if (chatPage) chatPage.removeAttribute('style');
      const msgs = document.getElementById('chat-page-messages');
      if (msgs) msgs.removeAttribute('style');
    }
  }
  if (!skipHistory && history.pushState) {
    history.pushState({ page: name }, '', '/' + name.replace(/:/g, '/'));
  }
  try { sessionStorage.setItem('currentPage', name); } catch(e) {}
  smoothScrollTop();
}

// Handle browser Back/Forward
window.addEventListener('popstate', function(e) {
  const pathParts = location.pathname.replace(/^\//, '').split('/');
  const name = (e.state && e.state.page) || (pathParts[0] === 'reputation' ? 'reputation:' + (pathParts[1] || 'leaderboard') : pathParts[0]) || 'home';
  if (name === 'treasury') {
    if (typeof showPage_treasury === 'function') showPage_treasury(null, null, true);
  } else if (name && name.startsWith('reputation')) {
    const tab = name.split(':')[1] || 'leaderboard';
    if (typeof showRepPage === 'function') showRepPage(tab, true);
  } else if (name === 'profile') {
    if (typeof openProfile === 'function') openProfile(true);
  } else {
    showPage(name || 'home', null, true);
  }
});

// ─── Treasury logic moved to assets/js/treasury.js ───────────

// ─── BLOCK EXPLORER ───────────────────────────────────────────
// One definition for every explorer link on the site. They used to be written
// out by hand, which is how four of them ended up on /classic/ - a path that is
// not Terraport Finder's network name and sends people to a different explorer
// entirely. Terraport Finder serves Terra Classic only, and calls it mainnet.
const FINDER = 'https://finder.terraport.finance/mainnet';
const finderTx   = (h) => `${FINDER}/tx/${h}`;
const finderAddr = (a) => `${FINDER}/address/${a}`;

// ─── EVIDENCE LINK ────────────────────────────────────────────
// The URL comes from whoever asked the question, so it is untrusted twice over:
// it lands in an href, where a javascript: scheme would execute, and in HTML,
// where a quote would break out of the attribute. Only http and https are
// allowed through, and the text is escaped either way.
function safeUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch (e) { return null; }
}
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

