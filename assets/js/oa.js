/**
 * Oracle Stats - front end collector.
 *
 * Deliberately NOT called analytics.js / tracker.js: those names are on public
 * ad-blocker lists and would be dropped for a noticeable share of visitors.
 *
 * Add to both sites, before app.js:
 *   <script src="/assets/js/oa.js?v=1" defer></script>
 *
 * Public API (all calls are safe if the script failed to load - see the guards
 * in the integration notes):
 *   oa.track('name', {meta})
 *   oa.wallet(address)                 real Connect, counts as a conversion
 *   oa.wallet(address, {restored:true}) session restored automatically
 *   oa.wallet(null)                    disconnect
 *   oa.pool('daily' | 'weekly')
 */
(function () {
  'use strict';

  var ENDPOINT = 'https://s.terraoracle.io/e';
  var COOKIE = 'oa_vid';
  var COOKIE_DOMAIN = '.terraoracle.io';   // shared by both sites on purpose
  var COOKIE_DAYS = 400;
  var FLUSH_AFTER_MS = 12000;
  var FLUSH_AT_COUNT = 8;

  // ------------------------------------------------------------------
  // visitor id - random, first party, no personal data in it
  // ------------------------------------------------------------------
  function readCookie(name) {
    var m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : '';
  }

  function writeCookie(name, value) {
    var d = new Date(Date.now() + COOKIE_DAYS * 86400000).toUTCString();
    var base = name + '=' + encodeURIComponent(value) + '; expires=' + d +
               '; path=/; SameSite=Lax';
    // Localhost and file:// have no parent domain to share.
    if (location.hostname.indexOf('terraoracle.io') !== -1) {
      document.cookie = base + '; domain=' + COOKIE_DOMAIN + '; Secure';
    } else {
      document.cookie = base;
    }
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) {
      try { return crypto.randomUUID(); } catch (e) {}
    }
    var s = '';
    for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  var vid = '';
  try {
    vid = readCookie(COOKIE);
    if (!vid) {
      vid = localStorage.getItem(COOKIE) || uuid();
      writeCookie(COOKIE, vid);
    }
    localStorage.setItem(COOKIE, vid);   // survives cookie clearing in some browsers
  } catch (e) {
    vid = vid || uuid();
  }

  // ------------------------------------------------------------------
  // where did this visit come from
  // ------------------------------------------------------------------
  function param(key) {
    try {
      var q = new URLSearchParams(location.search);
      if (q.get(key)) return q.get(key);
      // our deep links keep the tag in front of the hash, and some routers
      // move the query behind it - read both places
      var h = location.hash.indexOf('?');
      if (h !== -1) {
        var q2 = new URLSearchParams(location.hash.slice(h + 1));
        if (q2.get(key)) return q2.get(key);
      }
    } catch (e) {}
    return '';
  }

  var SITE = location.hostname.indexOf('draw.') === 0 ? 'draw' : 'main';
  var utmSource = param('utm_source') || param('ref') || param('from');
  var utmCampaign = param('utm_campaign') || param('c');

  // ------------------------------------------------------------------
  // queue
  // ------------------------------------------------------------------
  var queue = [];
  var timer = null;
  var wallet = null;
  var pool = null;
  var sentPageview = false;

  function send(useBeacon) {
    if (!queue.length) return;
    var payload = {
      v: 1,
      vid: vid,
      site: SITE,
      referrer: document.referrer || '',
      utm_source: utmSource || '',
      utm_campaign: utmCampaign || '',
      wallet: wallet || '',
      pool: pool || '',
      events: queue.splice(0, queue.length)
    };
    var body = '';
    try { body = JSON.stringify(payload); } catch (e) { return; }

    // text/plain avoids a CORS preflight; the worker parses the body anyway
    try {
      if (useBeacon && navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      }
      fetch(ENDPOINT, {
        method: 'POST',
        body: body,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        keepalive: true,
        mode: 'cors',
        credentials: 'omit'
      }).catch(function () {});
    } catch (e) {}
  }

  function schedule() {
    if (queue.length >= FLUSH_AT_COUNT) { flush(); return; }
    if (timer) return;
    timer = setTimeout(flush, FLUSH_AFTER_MS);
  }

  function flush(useBeacon) {
    if (timer) { clearTimeout(timer); timer = null; }
    send(!!useBeacon);
  }

  function track(name, meta) {
    if (!name) return;
    var ev = { n: String(name), t: Date.now() };
    if (pool) ev.pool = pool;
    if (meta && typeof meta === 'object') ev.m = meta;
    queue.push(ev);
    schedule();
  }

  // ------------------------------------------------------------------
  // public API
  // ------------------------------------------------------------------
  var oa = {
    track: track,
    pool: function (p) { if (p === 'daily' || p === 'weekly') pool = p; },
    wallet: function (address, opts) {
      if (!address) { wallet = null; return; }
      var changed = wallet && wallet !== address;
      wallet = String(address);
      if (opts && opts.restored) track('wallet_restored');
      else if (changed) track('wallet_changed');
      else track('wallet_connected');
      flush();          // a connection is worth sending right away
    },
    // exposed for debugging from the console
    _state: function () { return { vid: vid, site: SITE, queued: queue.length }; }
  };
  window.oa = oa;

  // ------------------------------------------------------------------
  // automatic bits
  // ------------------------------------------------------------------
  function pageview() {
    if (sentPageview) return;
    sentPageview = true;
    track('pageview', { p: location.pathname + (location.hash || '') });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pageview);
  } else {
    pageview();
  }

  // Connect Wallet click. Explicit hook first: put data-oa="connect" on the
  // buttons. The text match is a fallback so nothing is missed on day one.
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('button, a, [role="button"]') : null;
    if (!el) return;
    if (el.getAttribute('data-oa') === 'connect') { track('connect_click'); return; }
    if (el.getAttribute('data-oa') === 'ignore') return;
    var text = (el.textContent || '').trim().toLowerCase();
    if (text.length < 40 && /connect\s*wallet|connexion|подключить/.test(text)) {
      track('connect_click');
    }
  }, true);

  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', function () { flush(true); });
})();
