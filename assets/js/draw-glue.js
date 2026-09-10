/* ─────────────────────────────────────────────────────────────────────────
   Glue for the modules lifted from the live Oracle Draw repo.

   Those modules were written against the old app.js and read a handful of
   globals from it. Rather than drag the whole 130 KB file across, this
   provides exactly what they look up - nothing more. When the real app.js
   comes over, delete this file: the names are identical, so the modules
   will not notice the swap.
   ───────────────────────────────────────────────────────────────────────── */

/* Format helpers, copied verbatim from config.js in the live repo so the
   winners list and the verify panel print exactly what the site prints. */
function fmt(n) {
  if (n >= 1e9)  return (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n/1e6).toFixed(2) + 'M';
  if (n >= 1000) return (n/1000).toFixed(1) + 'K';
  return Math.round(n).toLocaleString('en-US');
}
function fmtAddr(a) { return a ? a.slice(0,10) + '...' + a.slice(-4) : ''; }
function fmtDate(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

// worker base url, same value the live site uses
window.DRAW_WORKER = 'https://oracle-draw.vladislav-baydan.workers.dev';

// which pool the page is showing; the draw shell keeps this current
window.currentLottery = window.currentLottery || 'daily';

// ticket arrays and the connected wallet. Empty until the wallet layer lands,
// which is fine: every consumer treats an empty round as "awaiting entries".
window.dailyTickets  = window.dailyTickets  || [];
window.weeklyTickets = window.weeklyTickets || [];
window.freeEntriesData = window.freeEntriesData || {};
window.connectedWalletAddress = window.connectedWalletAddress || null;
window.lotteryAddress = window.lotteryAddress || null;

// winners.json, the file both Winners and Verify read
window.winnersData = window.winnersData || [];

/* config.js declares these with `let`, so they are script-scoped globals the
   modules read directly. Declaring them the same way keeps the modules
   untouched; `var` puts them on window so the glue can set them too. */
var winnersFilter = 'all';
var circuitWinnersLoaded = false;
window.filterWinners = window.filterWinners || function (f) {
  winnersFilter = f;
  document.querySelectorAll('.wfilters .draw-nav-btn').forEach(function (b) {
    b.classList.toggle('active', b.id === 'wf-' + f);
  });
  if (typeof renderWinners === 'function') renderWinners();
};

/* Same shape handling as chain.js in the live repo: winners.json is
   { daily: [...], weekly: [...] } and each entry goes through mapWinnerEntry,
   which winners-v2.js defines. Rolling our own parse here would drift from it. */
window.loadWinners = async function loadWinners() {
  try {
    const r = await fetch('./winners.json?t=' + Date.now());
    if (r.ok) {
      const raw = await r.json();
      let entries = [];
      if (raw && !Array.isArray(raw) && (raw.daily || raw.weekly) &&
          typeof mapWinnerEntry === 'function') {
        const daily  = (raw.daily  || []).map((w,i) => mapWinnerEntry(w,'daily',i)).filter(Boolean);
        const weekly = (raw.weekly || []).map((w,i) => mapWinnerEntry(w,'weekly',i)).filter(Boolean);
        entries = daily.concat(weekly).sort((a,b) => (b.time||0)-(a.time||0));
      } else if (Array.isArray(raw)) {
        entries = raw.filter(w => !w.skipped && w.winner);
      }
      window.winnersData = entries;
    }
  } catch (e) {
    console.warn('loadWinners:', e);
    window.winnersData = [];
  }
  if (typeof renderWinners === 'function') { try { renderWinners(); } catch (e) {} }
  if (typeof populateDrawVerifySelect === 'function') { try { populateDrawVerifySelect(); } catch (e) {} }
  if (typeof loadCircuitWinners === 'function' && !window.circuitWinnersLoaded) {
    try { loadCircuitWinners(); } catch (e) {}
  }
};

// the modules are plain scripts, so wait for them before the first load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.loadWinners());
} else {
  window.loadWinners();
}
