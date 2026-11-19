// Oracle Draw inside Terra Oracle: the "game floor" layer.
// Visual only. Reads what the page already shows or loaded (timer digits,
// entry counters, round tickets) and never writes to anything the draw
// logic uses.
//   1. marquee bulbs on the wheel rim, faster as the draw gets closer
//   2. timer heat: amber in the last hour, red in the last 10 minutes,
//      a tick sound in the last 10 seconds (only if site sound is on)
//   3. "your odds" under the Mint button, now and after each tier
//   4. live mint feed under the wheel
(function () {
  'use strict';
  var root = document.documentElement;
  if (!root.classList.contains('is-embedded')) return;

  var BULBS = 40;
  var TIER_ENTRIES = { common: 1, rare: 5, legendary: 10 };
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(id) { return document.getElementById(id); }
  function num(el) { var n = el ? parseInt(String(el.textContent).replace(/[^\d]/g, ''), 10) : 0; return isNaN(n) ? 0 : n; }
  function lottery() { return window.currentLottery === 'weekly' ? 'weekly' : 'daily'; }
  function tickets() {
    try { return lottery() === 'weekly' ? weeklyTickets : dailyTickets; } catch (e) { return []; }
  }
  function myAddr() {
    try { if (typeof connectedWalletAddress !== 'undefined' && connectedWalletAddress) return connectedWalletAddress; } catch (e) {}
    try { if (typeof lotteryAddress !== 'undefined' && lotteryAddress) return lotteryAddress; } catch (e) {}
    return null;
  }
  function short(a) { return a ? a.slice(0, 9) + '...' + a.slice(-4) : '?'; }
  function pct(x) {
    if (!isFinite(x) || x <= 0) return '0%';
    if (x >= 0.995) return '100%';
    var p = x * 100;
    return (p < 1 ? p.toFixed(1) : Math.round(p)) + '%';
  }
  function ago(sec) {
    var d = Math.max(0, Date.now() / 1000 - sec);
    if (d < 60) return 'just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return Math.floor(d / 86400) + 'd ago';
  }

  // ---------- 1. marquee bulbs ----------
  function mountBulbs() {
    var wrap = $('wheel-canvas-wrap');
    if (!wrap || wrap.querySelector('.cs-bulbs')) return;
    var ring = document.createElement('div');
    ring.className = 'cs-bulbs';
    ring.setAttribute('aria-hidden', 'true');
    // centre line of the rim drawn by WheelRenderer: rOuter = W/2 - 4 (of
    // 480), ring width 6% of W -> about 46.3% of the box from the centre
    var R = 46.3;
    for (var i = 0; i < BULBS; i++) {
      var a = (i / BULBS) * Math.PI * 2 - Math.PI / 2;
      var b = document.createElement('i');
      b.style.left = (50 + R * Math.cos(a)) + '%';
      b.style.top = (50 + R * Math.sin(a)) + '%';
      b.style.setProperty('--n', i % 4);
      ring.appendChild(b);
    }
    wrap.appendChild(ring);
  }

  // ---------- 2. timer heat ----------
  var lastSecs = null;
  function remaining() {
    var d = num($('t-days')), h = num($('t-hours')), m = num($('t-mins')), s = num($('t-secs'));
    return ((d * 24 + h) * 60 + m) * 60 + s;
  }
  function heat() {
    var sec = remaining();
    var level = sec <= 0 ? 'calm' : sec <= 600 ? 'final' : sec <= 3600 ? 'hour' : 'calm';
    if (root.getAttribute('data-heat') !== level) root.setAttribute('data-heat', level);

    var secEl = $('t-secs');
    var now = secEl ? secEl.textContent : null;
    if (now !== lastSecs && lastSecs !== null && !reduced) {
      // flip on every digit that changed
      ['t-days', 't-hours', 't-mins', 't-secs'].forEach(function (id) {
        var el = $(id); if (!el) return;
        if (el.dataset.csPrev !== el.textContent) {
          el.classList.remove('cs-flip'); void el.offsetWidth; el.classList.add('cs-flip');
          el.dataset.csPrev = el.textContent;
        }
      });
      if (sec > 0 && sec <= 10) {
        try {
          var snd = window.parent && window.parent !== window && window.parent.OracleSound;
          if (snd && snd.enabled && typeof snd.tick === 'function') snd.tick();
        } catch (e) {}
      }
    }
    lastSecs = now;
  }

  // ---------- 3. your odds ----------
  function mountOdds() {
    var btn = $('btn-buy-main');
    if (!btn || $('cs-odds')) return;
    var box = document.createElement('div');
    box.id = 'cs-odds';
    box.className = 'cs-odds';
    box.innerHTML =
      '<div class="cs-odds-now"><span class="cs-odds-lbl"></span><b class="cs-odds-val">0%</b></div>' +
      '<div class="cs-odds-tiers">' +
      '<span data-t="common"><em>Common</em><b>-</b></span>' +
      '<span data-t="rare"><em>Rare</em><b>-</b></span>' +
      '<span data-t="legendary"><em>Legendary</em><b>-</b></span>' +
      '</div>';
    btn.insertAdjacentElement('afterend', box);
  }
  function odds() {
    var box = $('cs-odds'); if (!box) return;
    var total = num($('wheel-ticket-count'));
    var mine = Math.min(num($('stat-total')), total);
    var weekly = lottery() === 'weekly';
    box.querySelector('.cs-odds-lbl').textContent = weekly ? 'Your 1st-place odds' : 'Your odds now';
    box.querySelector('.cs-odds-val').textContent = total ? pct(mine / total) : '0%';
    box.classList.toggle('has-odds', mine > 0);
    var tiers = window.NFT_TIERS || {};
    Object.keys(TIER_ENTRIES).forEach(function (t) {
      var e = (tiers[t] && tiers[t].entries) || TIER_ENTRIES[t];
      var cell = box.querySelector('[data-t="' + t + '"] b');
      if (cell) cell.textContent = pct((mine + e) / (total + e));
    });
    box.setAttribute('data-empty', total ? '0' : '1');
  }

  // ---------- 4. live mint feed ----------
  var seen = null, feedKey = '';
  function mountFeed() {
    if ($('cs-feed')) return;
    var anchor = $('wheel-participant-count');
    var row = anchor && anchor.parentElement && anchor.parentElement.parentElement;
    if (!row) return;
    var feed = document.createElement('div');
    feed.id = 'cs-feed';
    feed.className = 'cs-feed';
    feed.innerHTML = '<div class="cs-feed-h"><i></i>Live mints</div><div class="cs-feed-track"><div class="cs-feed-belt"></div></div>';
    row.insertAdjacentElement('afterend', feed);
  }
  function mints() {
    var by = {}, list = [];
    (tickets() || []).forEach(function (t) {
      if (!t || !t.address) return;
      var key = String(t.txhash || '').split(':').slice(0, 2).join(':') || (t.address + t.time);
      if (by[key]) return;
      by[key] = 1;
      list.push({ key: key, addr: t.address, tier: String(t.tier || 'common').toLowerCase(), entries: t.mintEntries || TIER_ENTRIES[String(t.tier || 'common').toLowerCase()] || 1, time: t.time || 0 });
    });
    return list.sort(function (a, b) { return b.time - a.time; }).slice(0, 12);
  }
  function chip(m, fresh, me) {
    return '<span class="cs-chip t-' + m.tier + (fresh ? ' is-new' : '') + (me ? ' is-me' : '') + '">' +
      '<b>' + (me ? 'You' : short(m.addr)) + '</b>' +
      '<em>' + m.tier + ' +' + m.entries + '</em>' +
      (Date.now() / 1000 - m.time < 8 * 86400 ? '<small>' + ago(m.time) + '</small>' : '') + '</span>';
  }
  function feed() {
    var box = $('cs-feed'); if (!box) return;
    var list = mints();
    var key = lottery() + '|' + list.map(function (m) { return m.key; }).join(',') + '|' + Math.floor(Date.now() / 60000);
    if (key === feedKey) return;
    var lotteryChanged = feedKey.split('|')[0] !== lottery();
    feedKey = key;
    var belt = box.querySelector('.cs-feed-belt');
    if (!list.length) {
      belt.innerHTML = '<span class="cs-feed-empty">No mints this round yet - the first one owns the whole wheel</span>';
      box.classList.remove('is-moving');
      seen = {};
      return;
    }
    var me = myAddr();
    var first = seen === null || lotteryChanged;
    var html = list.map(function (m) { return chip(m, !first && !seen[m.key], m.addr === me); }).join('');
    seen = {}; list.forEach(function (m) { seen[m.key] = 1; });
    // enough chips to scroll: duplicate the set for a seamless loop
    var moving = list.length >= 4 && !reduced;
    belt.innerHTML = moving ? html + html : html;
    box.classList.toggle('is-moving', moving);
    if (moving) belt.style.setProperty('--dur', (list.length * 4) + 's');
  }

  // ---------- live pill above the title ----------
  function mountLive() {
    var h = $('hero-title');
    if (!h || $('cs-live')) return;
    var p = document.createElement('div');
    p.id = 'cs-live';
    p.className = 'cs-live';
    p.innerHTML = '<i></i><span>Live round</span>';
    h.insertAdjacentElement('beforebegin', p);
  }

  // ---------- stage banner ----------
  // Same shape as the hero banners of the other sections (art, scrim,
  // eyebrow, title): the title and lead move into it, ids untouched, so
  // pool-timer.js keeps rewriting them as before.
  function mountStage() {
    var split = document.querySelector('#stage-draw .hero-split');
    var h = $('hero-title'), sub = $('hero-sub');
    if (!split || !h || $('cs-stage')) return;
    var st = document.createElement('section');
    st.id = 'cs-stage';
    st.className = 'cs-stage';
    st.innerHTML = '<span class="cs-stage-art"></span><span class="cs-stage-wheels"></span><span class="cs-stage-scrim"></span>' +
      '<div class="cs-stage-copy"><p class="cs-stage-eye"><i></i><span class="cs-eye-t">Oracle Draw</span></p></div>' +
      '<div class="cs-stage-facts"><span><b>20:00</b><em>UTC draw</em></span><span><b>1 / 5 / 10</b><em>entries per mask</em></span><span><b>On-chain</b><em>verifiable</em></span></div>';
    split.parentNode.insertBefore(st, split);
    var copy = st.querySelector('.cs-stage-copy');
    copy.appendChild(h);
    if (sub) copy.appendChild(sub);
    copy.appendChild(st.querySelector('.cs-stage-facts'));
    var live = $('cs-live'); if (live) live.remove();
  }
  function stage() {
    var st = $('cs-stage'); if (!st) return;
    var w = lottery() === 'weekly';
    st.classList.toggle('is-weekly', w);
    var eye = st.querySelector('.cs-eye-t');
    var t = w ? 'Oracle Draw \u00b7 weekly round \u00b7 3 winners' : 'Oracle Draw \u00b7 daily round \u00b7 1 winner';
    if (eye.textContent !== t) eye.textContent = t;
  }

  function start() {
    mountBulbs(); mountOdds(); mountFeed(); mountLive(); mountStage(); stage();
    heat(); odds(); feed();
    setInterval(function () { heat(); odds(); stage(); }, 500);
    setInterval(function () { mountFeed(); feed(); }, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
