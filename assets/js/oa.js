/**
 * Oracle Stats - front end collector.
 *
 * v4: tracks in-app route changes (the sites are single page apps, so the
 * first load used to be the only pageview) and clicks on outbound links
 * (X, Telegram, GitHub, partners).
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
  // Path as a human would name it: route without the query string.
  function page() {
    var h = location.hash || '';
    var q = h.indexOf('?');
    if (q !== -1) h = h.slice(0, q);
    var path = (location.pathname || '/') + h;
    return path.length > 120 ? path.slice(0, 120) : path;
  }

  var lastPage = '';

  function pageview() {
    var p = page();
    if (p === lastPage) return;   // same route, not a new view
    lastPage = p;
    sentPageview = true;
    track('pageview', { p: p });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pageview);
  } else {
    pageview();
  }

  // Both sites are single page apps: the route changes without a reload, so
  // without these listeners every visit would look like one page.
  window.addEventListener('hashchange', pageview);
  window.addEventListener('popstate', pageview);
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    if (typeof orig !== 'function') return;
    history[m] = function () {
      var r = orig.apply(this, arguments);
      setTimeout(pageview, 0);
      return r;
    };
  });

  // Connect Wallet click.
  // The text match alone is not enough: on both sites the wallet picker markup
  // lives inside the button, so textContent carries the whole dropdown.
  var ID_RE = /wallet[-_]?(btn|label|nav|picker|connect)|connect[-_]?wallet/i;
  var FN_RE = /connectWallet|WalletPicker|connectKeplr|connectStation|connectGalaxy|openWallet/i;
  var lastConnectClick = 0;

  function looksLikeConnect(el) {
    if (!el || !el.getAttribute) return false;
    var da = el.getAttribute('data-oa');
    if (da === 'connect') return true;
    if (da === 'ignore') return false;
    if (ID_RE.test(el.id || '')) return true;
    if (FN_RE.test(el.getAttribute('onclick') || '')) return true;
    return false;
  }

  // Where we send people: X, Telegram, GitHub, partner sites. The other half
  // of the funnel - traffic we hand away.
  var OWN_HOST = /(^|\.)terraoracle\.io$/i;

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a) {
      var href = a.getAttribute('href') || '';
      if (/^https?:/i.test(href)) {
        try {
          var u = new URL(href, location.href);
          if (u.hostname && !OWN_HOST.test(u.hostname)) {
            track('outbound', {
              h: u.hostname.replace(/^www\./, '').slice(0, 40),
              p: page(),
              u: (u.pathname + u.search).slice(0, 60)
            });
            flush();
          }
        } catch (er) {}
      }
    }

    var node = e.target;
    // the clicked node's own text - short, unlike the whole button
    var own = (node && node.textContent || '').trim().toLowerCase();
    var hit = own.length < 30 &&
              /connect\s*wallet|^connect$|connexion|подключить/.test(own);

    for (var i = 0; node && i < 5; i++) {
      if (node.getAttribute && node.getAttribute('data-oa') === 'ignore') return;
      if (looksLikeConnect(node)) { hit = true; break; }
      node = node.parentElement;
    }
    if (!hit) return;

    // Already connected: this tap opens the account menu, it is not an
    // intent to connect. Counting it would inflate visitor -> click.
    if (wallet) return;

    // Opening the picker and then choosing a wallet is one intent. On a phone
    // that takes well over three seconds, so the window has to be generous.
    var now = Date.now();
    if (now - lastConnectClick < 30000) return;
    lastConnectClick = now;
    track('connect_click');
  }, true);

  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', function () { flush(true); });
})();
