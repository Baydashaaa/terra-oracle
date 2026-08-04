/* ============================================================================
 * oracle-notify.js  ·  v1.2.1
 * Terra Oracle / Oracle Draw — unified notification system (phase 1)
 * ----------------------------------------------------------------------------
 * WHAT IT DOES
 *   · Bell button in the header with an unread badge
 *   · Dropdown panel with the last 10 notifications
 *   · Toasts (bottom-right) for events that arrive while the page is open
 *   · Read/unread state in localStorage, per wallet, per device
 *
 * SOURCES (phase 1 — no backend changes required)
 *   · Wins            → oracle-draw worker   GET /my-wins?wallet=
 *   · Answers to you  → terra-oracle worker  GET /questions   (KV-cached)
 *                       covers both "answer on my question" and
 *                       "reply to my answer" (via answer.replyTo)
 *
 * USAGE
 *   <script src="oracle-notify.js?v=1"></script>
 *   Nothing else. It self-mounts, finds the wallet, and starts polling.
 *   Optional override before the script tag:
 *     window.ORACLE_NOTIFY_CONFIG = { pollMs: 60000, maxItems: 10 };
 *
 * NOTES
 *   · Polls only while a wallet is connected AND the tab is visible.
 *   · On the very first run for a wallet everything is marked read, so the
 *     user is not hit with a wall of toasts for old history.
 * ========================================================================== */
(function () {
  'use strict';

  if (window.__oracleNotifyLoaded) return;
  window.__oracleNotifyLoaded = true;

  // ── Config ────────────────────────────────────────────────────────────────
  var CFG = Object.assign({
    drawWorker:   'https://oracle-draw.vladislav-baydan.workers.dev',
    oracleWorker: 'https://terra-oracle-questions.vladislav-baydan.workers.dev',
    pollMs:       60000,   // poll interval while tab is visible
    maxItems:     10,      // how many notifications to keep/show
    maxToasts:    3,       // stacked toasts at once
    toastMs:      7000,    // auto-dismiss delay
    chatLimit:    50,      // chat txs pulled per poll (matches the site's own)
    remindMins:   60,      // "draw in X minutes" reminder lead time
    dailyReminder: false,  // daily fires every 24h — off by default, weekly only
    toastGap:     12,      // gap between the navbar and the first toast
    toastTop:     null,    // fixed top offset in px; null = measure the navbar
  }, window.ORACLE_NOTIFY_CONFIG || {});

  // Chat lives on-chain: messages are 5,000 LUNC transfers to the Treasury with
  // the text in the tx memo. Replies are encoded in the memo as
  // ">" + first 16 chars of the parent txHash + "|" + text.
  var TREASURY_WALLET = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt';
  var CHAT_MIN_ULUNA  = 5000000000;
  var CHAT_MAX_ULUNA  = 5200000000;
  var SYSTEM_WALLETS  = [
    'terra15jt5a9ycsey4hd6nlqgqxccl9aprkmg2mxmfc6', // ADMIN
    'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt', // TREASURY
    'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px', // DAILY
    'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz', // WEEKLY
    'terra16m05j95p9qvq93cdtchjcpwgvny8f57vzdj06p', // COLLECTION
  ];

  var LS_PREFIX = 'oracleNotif:v1:';

  // ── Tiny helpers ──────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function shortAddr(a) {
    if (!a) return '';
    return a.length > 14 ? a.slice(0, 8) + '…' + a.slice(-4) : a;
  }
  function ago(ts) {
    var s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60)    return s + 's';
    if (s < 3600)  return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }
  // uluna → human LUNC ("123,500" / "1.2M"); null when the amount is unknown
  function lunc(uluna) {
    var n = Number(uluna);
    if (!uluna || isNaN(n) || n <= 0) return null;
    var v = n / 1e6;
    if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (v >= 1e3) return Math.round(v).toLocaleString('en-US');
    return String(Math.round(v));
  }

  function toSec(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
    var t = Date.parse(v);
    return isNaN(t) ? 0 : Math.floor(t / 1000);
  }

  // ── Wallet detection ──────────────────────────────────────────────────────
  // Both sites persist the same shape: localStorage.wallet_session
  // = { address, type, expires }. Globals are checked too, because the session
  // is restored early in app.js on some paths.
  function currentWallet() {
    try {
      var s = JSON.parse(localStorage.getItem('wallet_session') || 'null');
      if (s && s.address && (!s.expires || s.expires > Date.now())) return s.address;
    } catch (e) {}
    try { if (typeof connectedWalletAddress !== 'undefined' && connectedWalletAddress) return connectedWalletAddress; } catch (e) {}
    try { if (typeof lotteryAddress !== 'undefined' && lotteryAddress) return lotteryAddress; } catch (e) {}
    return null;
  }

  // ── Store (localStorage, per wallet) ──────────────────────────────────────
  function loadStore(wallet) {
    try {
      var raw = localStorage.getItem(LS_PREFIX + wallet);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.items)) return s;
      }
    } catch (e) {}
    return { init: false, items: [] };   // init=false → first run for this wallet
  }
  function saveStore(wallet, store) {
    try {
      store.items = store.items.slice(0, Math.max(CFG.maxItems, 30));
      localStorage.setItem(LS_PREFIX + wallet, JSON.stringify(store));
    } catch (e) {}
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  // Matches the sites' existing design language rather than inventing one:
  // the bell reuses the .wallet-btn recipe (transparent, 1px violet border,
  // 8px radius, Exo 2 uppercase), the panel reuses .wallet-dropdown (surface,
  // 10px radius, dropDown animation, 0.2em-tracked section title). CSS vars
  // are read where they exist (Terra Oracle) with fallbacks tuned to Oracle
  // Draw's palette, so one file looks native on both sites.
  function injectCss() {
    if (document.getElementById('oracle-notify-css')) return;
    var st = document.createElement('style');
    st.id = 'oracle-notify-css';
    st.textContent = [
      '@keyframes onfDrop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes onfPulse{0%,100%{box-shadow:0 0 10px rgba(123,92,255,0.20),inset 0 0 10px rgba(123,92,255,0.06)}',
      '50%{box-shadow:0 0 18px rgba(123,92,255,0.45),inset 0 0 14px rgba(123,92,255,0.14)}}',
      '@keyframes onfSweep{from{transform:translateX(-100%)}to{transform:translateX(400%)}}',

      '.onf-wrap{position:relative;display:inline-flex;flex:none;align-items:center;}',

      /* Bell — same geometry/typography as .wallet-btn */
      '.onf-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;',
      'width:36px;height:36px;padding:0;border-radius:8px;cursor:pointer;',
      'background:transparent;border:1px solid rgba(123,92,255,0.4);',
      'color:var(--accent,#7C5CFF);font-family:"Exo 2",sans-serif;',
      'box-shadow:0 0 10px rgba(123,92,255,0.20),inset 0 0 10px rgba(123,92,255,0.06);',
      'transition:all 0.2s ease;}',
      '.onf-bell:hover{background:rgba(123,92,255,0.08);border-color:var(--accent,#7C5CFF);',
      'box-shadow:0 0 16px rgba(123,92,255,0.40),inset 0 0 14px rgba(123,92,255,0.14);}',
      '.onf-bell svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;',
      'stroke-linecap:round;stroke-linejoin:round;transition:transform .2s;}',
      '.onf-bell:hover svg{transform:rotate(-8deg);}',
      '.onf-bell.has-unread{border-color:rgba(244,208,63,0.55);color:var(--gold,#f4d03f);',
      'animation:onfPulse 2.4s ease-in-out infinite;}',

      /* Badge — Rajdhani numerals, gold like the rest of the "value" accents */
      '.onf-badge{position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;padding:0 4px;',
      'display:none;align-items:center;justify-content:center;border-radius:5px;',
      'background:linear-gradient(135deg,#f4d03f,#e8a020);color:#141a28;',
      'font-family:"Rajdhani",sans-serif;font-size:11px;font-weight:700;line-height:1;',
      'box-shadow:0 0 10px rgba(244,208,63,0.55);}',
      '.onf-bell.has-unread .onf-badge{display:flex;}',

      /* Panel — .wallet-dropdown recipe */
      '.onf-panel{position:absolute;top:calc(100% + 8px);right:0;width:330px;max-width:calc(100vw - 24px);',
      'background:var(--surface,#0d1424);border:1px solid var(--border,rgba(123,92,255,0.22));',
      'border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.55);',
      'z-index:9600;overflow:hidden;display:none;font-family:"Exo 2",sans-serif;}',
      '.onf-panel.open{display:block;animation:onfDrop 0.18s ease;}',
      '.onf-head{display:flex;align-items:center;justify-content:space-between;gap:8px;',
      'padding:10px 12px 9px;border-bottom:1px solid var(--border,rgba(123,92,255,0.22));position:relative;overflow:hidden;}',
      /* thin scanline sweep across the header — echoes the site\'s sci-fi motion */
      '.onf-head::after{content:"";position:absolute;left:0;bottom:-1px;width:25%;height:1px;',
      'background:linear-gradient(90deg,transparent,var(--accent,#7C5CFF),transparent);',
      'animation:onfSweep 3.6s linear infinite;opacity:.7;}',
      '.onf-head b{font-size:9px;letter-spacing:0.2em;text-transform:uppercase;',
      'color:var(--muted,#6B7AA6);font-weight:700;}',
      '.onf-mark{font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;',
      'color:var(--accent,#7C5CFF);cursor:pointer;background:none;border:none;padding:0;',
      'font-family:"Exo 2",sans-serif;transition:opacity .15s;opacity:.75;}',
      '.onf-mark:hover{opacity:1;}',

      '.onf-list{max-height:min(60vh,400px);overflow-y:auto;scrollbar-width:thin;}',
      '.onf-item{display:flex;gap:10px;padding:11px 12px;position:relative;',
      'border-bottom:1px solid var(--border,rgba(123,92,255,0.13));cursor:pointer;text-decoration:none;',
      'transition:background 0.15s;}',
      '.onf-item:last-child{border-bottom:none;}',
      '.onf-item:hover{background:rgba(123,92,255,0.07);}',
      /* unread marker: left accent bar, same idea as the active nav node */
      '.onf-item.unread::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;',
      'background:var(--accent,#7C5CFF);box-shadow:0 0 8px rgba(123,92,255,0.8);}',
      '.onf-item.unread{background:rgba(123,92,255,0.06);}',

      '.onf-ic{flex:none;width:30px;height:30px;border-radius:7px;display:flex;',
      'align-items:center;justify-content:center;border:1px solid transparent;}',
      '.onf-ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;',
      'stroke-linecap:round;stroke-linejoin:round;}',
      '.onf-ic.win{background:rgba(244,208,63,0.08);border-color:rgba(244,208,63,0.35);color:var(--gold,#f4d03f);',
      'box-shadow:0 0 10px rgba(244,208,63,0.12);}',
      '.onf-ic.ans{background:rgba(96,165,250,0.08);border-color:rgba(96,165,250,0.35);color:#60a5fa;',
      'box-shadow:0 0 10px rgba(96,165,250,0.12);}',
      '.onf-ic.rep{background:rgba(123,92,255,0.08);border-color:rgba(123,92,255,0.38);color:#a98bff;',
      'box-shadow:0 0 10px rgba(123,92,255,0.14);}',
      '.onf-ic.chat{background:rgba(0,212,255,0.07);border-color:rgba(0,212,255,0.32);color:#00d4ff;',
      'box-shadow:0 0 10px rgba(0,212,255,0.12);}',
      '.onf-ic.draw{background:rgba(102,255,170,0.07);border-color:rgba(102,255,170,0.32);color:#66ffaa;',
      'box-shadow:0 0 10px rgba(102,255,170,0.12);}',

      '.onf-tx{min-width:0;flex:1;}',
      '.onf-t{display:block;font-size:12px;font-weight:700;color:var(--text,#e8eeff);line-height:1.35;}',
      '.onf-b{display:-webkit-box;font-size:11px;color:var(--muted,#9FB0D0);line-height:1.4;margin-top:2px;',
      '-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
      '.onf-meta{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:5px;}',
      '.onf-time{font-family:"Rajdhani",sans-serif;font-size:11px;font-weight:600;',
      'color:var(--muted,#6B7AA6);white-space:nowrap;letter-spacing:.04em;}',
      '.onf-dot{width:6px;height:6px;border-radius:50%;background:var(--accent,#7C5CFF);',
      'box-shadow:0 0 8px rgba(123,92,255,.9);}',
      '.onf-empty{padding:28px 14px;text-align:center;color:var(--muted,#6B7AA6);font-size:11px;',
      'letter-spacing:.06em;}',

      /* Toasts — glass card with a colored edge, matching .glass-btn surfaces.
         Anchored top-right under the navbar; --onf-top is measured from the
         real <nav> at runtime so both sites get the right offset. */
      '.onf-toasts{position:fixed;right:18px;top:var(--onf-top,92px);z-index:9500;display:flex;',
      'flex-direction:column;gap:10px;align-items:flex-end;pointer-events:none;',
      'max-width:calc(100vw - 36px);font-family:"Exo 2",sans-serif;}',
      '.onf-toast{pointer-events:auto;position:relative;display:flex;align-items:flex-start;gap:10px;',
      'width:300px;max-width:100%;padding:12px 12px 12px 14px;border-radius:10px;overflow:hidden;',
      'background:rgba(20,25,40,0.85);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
      'border:1px solid rgba(123,92,255,0.45);',
      'box-shadow:0 0 20px rgba(123,92,255,0.25),inset 0 0 12px rgba(123,92,255,0.06),0 12px 36px rgba(0,0,0,0.5);',
      'cursor:pointer;transform:translateX(16px);opacity:0;transition:opacity .28s ease,transform .28s ease;}',
      '.onf-toast.in{opacity:1;transform:translateX(0);}',
      '.onf-toast::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;',
      'background:linear-gradient(180deg,var(--accent,#7C5CFF),#00d4ff);}',
      '.onf-toast.win{border-color:rgba(244,208,63,0.5);',
      'box-shadow:0 0 22px rgba(244,208,63,0.22),inset 0 0 12px rgba(244,208,63,0.06),0 12px 36px rgba(0,0,0,0.5);}',
      '.onf-toast.win::before{background:linear-gradient(180deg,#f4d03f,#e8a020);}',
      '.onf-x{flex:none;background:none;border:none;color:var(--muted,#6B7AA6);cursor:pointer;',
      'font-size:16px;line-height:1;padding:0 2px;transition:color .15s;}',
      '.onf-x:hover{color:var(--text,#e8eeff);}',

      '@media (max-width:600px){',
      '.onf-panel{position:fixed;top:auto;right:8px;left:8px;width:auto;max-width:none;}',
      '.onf-toasts{left:12px;right:12px;bottom:auto;align-items:stretch;}',
      '.onf-toast{width:auto;}',
      '.onf-bell{width:34px;height:34px;}',
      '}',
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  var SVG_BELL = '<svg viewBox="0 0 24 24"><path d="M6.6 10.2a5.4 5.4 0 0 1 10.8 0c0 3.9 1.5 5.4 1.5 5.4H5.1s1.5-1.5 1.5-5.4Z"/><path d="M10 18.4a2.2 2.2 0 0 0 4 0"/></svg>';
  var ICONS = {
    win: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M16 5h3v2a3 3 0 0 1-3 3"/><path d="M8 5H5v2a3 3 0 0 0 3 3"/><path d="M10 17h4M9 20h6"/></svg>',
    ans: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>',
    rep: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M9 11h6M9 14h4"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 12h5"/></svg>',
    draw: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>',
  };

  // ── State ─────────────────────────────────────────────────────────────────
  var wallet = null, store = { init: false, items: [] }, timer = null, mounted = false;
  var elBell, elBadge, elPanel, elList, elToasts;

  // ── Mount ─────────────────────────────────────────────────────────────────
  function bellMarkup() {
    return '<button class="onf-bell" id="onf-bell" aria-label="Notifications" title="Notifications">' +
             SVG_BELL + '<span class="onf-badge" id="onf-badge">0</span>' +
           '</button>' +
           '<div class="onf-panel" id="onf-panel">' +
             '<div class="onf-head"><b>Notifications</b>' +
             '<button class="onf-mark" id="onf-mark">Mark all read</button></div>' +
             '<div class="onf-list" id="onf-list"></div>' +
           '</div>';
  }

  // Insert the bell next to the wallet control. Each site has its own header
  // structure, and Oracle Draw additionally has a separate mobile bar, so we
  // try the known anchors in order and fall back to a floating button.
  function mount() {
    if (mounted) return true;
    injectCss();

    var host = null;
    var mobBar = document.querySelector('.mob-nav-controls');   // Oracle Draw mobile
    var isMobileBar = mobBar && getComputedStyle(mobBar).display !== 'none';

    if (isMobileBar) {
      host = document.createElement('div');
      host.className = 'onf-wrap';
      var ham = mobBar.querySelector('#hamburger-btn');
      if (ham) mobBar.insertBefore(host, ham); else mobBar.appendChild(host);
    } else {
      var anchor = document.getElementById('wallet-wrap');       // both sites (desktop)
      if (anchor && anchor.parentNode) {
        host = document.createElement('div');
        host.className = 'onf-wrap';
        host.style.marginLeft = '8px';
        anchor.parentNode.insertBefore(host, anchor.nextSibling);
      }
    }

    if (!host) {                                                 // last resort
      host = document.createElement('div');
      host.className = 'onf-wrap';
      host.style.cssText = 'position:fixed;right:16px;bottom:80px;z-index:9400;';
      document.body.appendChild(host);
    }

    host.innerHTML = bellMarkup();
    elBell  = host.querySelector('#onf-bell');
    elBadge = host.querySelector('#onf-badge');
    elPanel = host.querySelector('#onf-panel');
    elList  = host.querySelector('#onf-list');

    elToasts = document.createElement('div');
    elToasts.className = 'onf-toasts';
    elToasts.id = 'onf-toasts';
    document.body.appendChild(elToasts);
    positionToasts();
    window.addEventListener('resize', positionToasts);
    window.addEventListener('scroll', positionToasts, { passive: true });

    elBell.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = elPanel.classList.toggle('open');
      if (open) {
        render();
        // Opening the panel is reading it. The badge used to clear only when a
        // specific item was clicked or "mark all" was pressed, so someone who
        // looked at their notifications and reloaded still saw the same count —
        // which reads as the page ignoring them.
        //
        // Marked after a beat so the unread bars are visible for a moment
        // first: they are the only thing distinguishing what is new.
        setTimeout(function () {
          if (elPanel.classList.contains('open')) markAllRead();
        }, 1200);
      }
    });
    host.querySelector('#onf-mark').addEventListener('click', function (e) {
      e.stopPropagation();
      markAllRead();
    });
    document.addEventListener('click', function (e) {
      if (elPanel && !elPanel.contains(e.target) && !elBell.contains(e.target)) {
        elPanel.classList.remove('open');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && elPanel) elPanel.classList.remove('open');
    });

    mounted = true;
    return true;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function unreadCount() {
    return store.items.filter(function (i) { return !i.read; }).length;
  }
  function refreshBadge() {
    if (!elBell) return;
    var n = unreadCount();
    elBell.classList.toggle('has-unread', n > 0);
    elBadge.textContent = n > 99 ? '99+' : String(n);
  }
  function render() {
    if (!elList) return;
    var items = store.items.slice(0, CFG.maxItems);
    if (!items.length) {
      elList.innerHTML = '<div class="onf-empty">' +
        (wallet ? 'No notifications yet' : 'Connect your wallet to see notifications') + '</div>';
    } else {
      elList.innerHTML = items.map(function (i) {
        return '<a class="onf-item ' + (i.read ? '' : 'unread') + '" data-id="' + esc(i.id) + '"' +
               (i.link ? ' href="' + esc(i.link) + '"' + (/^https?:/.test(i.link) ? ' target="_blank" rel="noopener"' : '') : ' href="javascript:void(0)"') + '>' +
                 '<span class="onf-ic ' + esc(i.kind) + '">' + (ICONS[i.kind] || ICONS.ans) + '</span>' +
                 '<span class="onf-tx"><span class="onf-t">' + esc(i.title) + '</span>' +
                 (i.body ? '<span class="onf-b">' + esc(i.body) + '</span>' : '') + '</span>' +
                 '<span class="onf-meta"><span class="onf-time">' + ago(i.ts) + '</span>' +
                 (i.read ? '' : '<span class="onf-dot"></span>') + '</span>' +
               '</a>';
      }).join('');
      Array.prototype.forEach.call(elList.querySelectorAll('.onf-item'), function (el) {
        el.addEventListener('click', function (ev) {
          var id = el.getAttribute('data-id');
          var it = store.items.find(function (x) { return x.id === id; });
          markRead(id);
          if (it && !it.link) { ev.preventDefault(); navigate(it); }   // in-app target
          if (elPanel) elPanel.classList.remove('open');
        });
      });
    }
    refreshBadge();
  }
  // Follow a notification: either an external URL, or an in-app target. On
  // Terra Oracle the Board is an SPA page (showPage), from Oracle Draw we hop
  // over to the main site.
  function navigate(item) {
    if (!item) return;
    if (item.link) {
      if (/^https?:/.test(item.link)) window.open(item.link, '_blank', 'noopener');
      else location.href = item.link;
      return;
    }
    if (item.go === 'board' || item.go === 'chat') {
      if (typeof window.showPage === 'function') { try { window.showPage(item.go); return; } catch (e) {} }
      window.open('https://terraoracle.io', '_blank', 'noopener');
      return;
    }
    if (item.go === 'draw') {
      // On the Draw site switch tabs in place; from Terra Oracle hop across.
      if (typeof window.showTab === 'function') { try { window.showTab('draw'); return; } catch (e) {} }
      window.open('https://draw.terraoracle.io', '_blank', 'noopener');
    }
  }

  function markRead(id) {
    var it = store.items.find(function (i) { return i.id === id; });
    if (it && !it.read) { it.read = true; saveStore(wallet, store); render(); }
  }
  function markAllRead() {
    store.items.forEach(function (i) { i.read = true; });
    saveStore(wallet, store);
    render();
  }

  // ── Toasts ────────────────────────────────────────────────────────────────
  // Keep the toast stack tucked just under the navbar. The two sites have
  // different nav heights (and it changes on mobile), so measure rather than
  // hardcode. Config can override with a fixed number.
  function positionToasts() {
    if (typeof CFG.toastTop === 'number') {
      document.documentElement.style.setProperty('--onf-top', CFG.toastTop + 'px');
      return;
    }
    var nav = document.querySelector('nav');
    var h = 0;
    if (nav) {
      var r = nav.getBoundingClientRect();
      // Only count it when it's actually pinned at the top (sticky/fixed);
      // if the page is scrolled past a static nav, fall back to the gap alone.
      h = Math.max(0, r.bottom);
      if (h > 200) h = r.height;
    }
    document.documentElement.style.setProperty('--onf-top', Math.round(h + CFG.toastGap) + 'px');
  }

  function toast(item) {
    if (!elToasts) return;
    positionToasts();
    while (elToasts.children.length >= CFG.maxToasts) elToasts.removeChild(elToasts.firstChild);

    var t = document.createElement('div');
    t.className = 'onf-toast' + (item.kind === 'win' ? ' win' : '');
    t.innerHTML = '<span class="onf-ic ' + esc(item.kind) + '">' + (ICONS[item.kind] || ICONS.ans) + '</span>' +
                  '<span class="onf-tx"><span class="onf-t">' + esc(item.title) + '</span>' +
                  (item.body ? '<span class="onf-b">' + esc(item.body) + '</span>' : '') + '</span>' +
                  '<button class="onf-x" aria-label="Dismiss">&times;</button>';
    elToasts.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });

    var killed = false;
    function kill() {
      if (killed) return; killed = true;
      t.classList.remove('in');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }
    t.querySelector('.onf-x').addEventListener('click', function (e) { e.stopPropagation(); kill(); });
    t.addEventListener('click', function () {
      markRead(item.id);
      navigate(item);
      kill();
    });
    setTimeout(kill, CFG.toastMs);
  }

  // ── Sources ───────────────────────────────────────────────────────────────
  function getJSON(url) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, 12000);
    return fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
      .then(function (r) { clearTimeout(to); return r.ok ? r.json() : null; })
      .catch(function () { clearTimeout(to); return null; });
  }

  // Wins — oracle-draw worker. No prize amount is stored per winner yet, so we
  // report pool + place and link to the on-chain draw tx.
  function fetchWins(w) {
    return getJSON(CFG.drawWorker + '/my-wins?wallet=' + encodeURIComponent(w)).then(function (d) {
      if (!d || !Array.isArray(d.wins)) return [];
      return d.wins.map(function (x) {
        var pool  = (x.pool === 'weekly') ? 'Weekly' : 'Daily';
        var place = Number(x.place || 1);
        var ord   = place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : place + 'th';
        var prize = lunc(x.amountUluna);
        return {
          id:    'win:' + (x.tokenId || '') + ':' + (x.roundId || ''),
          kind:  'win',
          ts:    toSec(x.wonAt),
          title: prize ? ('You won ' + prize + ' LUNC') : ('You won the ' + pool.toLowerCase() + ' draw'),
          body:  (prize ? (pool + ' draw · ') : '') + ord + ' place · ' + (x.tier || 'NFT') + ' ' + (x.tokenId || ''),
          link:  x.drawTxHash ? ('https://finder.terraport.finance/mainnet/tx/' + x.drawTxHash) : null,
        };
      });
    });
  }

  // Answers — terra-oracle worker. Two cases from one payload:
  //   1) somebody answered a question I asked
  //   2) somebody replied to an answer I wrote (answer.replyTo)
  function fetchAnswers(w) {
    return getJSON(CFG.oracleWorker + '/questions').then(function (d) {
      var qs = d && Array.isArray(d.questions) ? d.questions : [];
      var out = [];
      qs.forEach(function (q) {
        var mine = q.wallet === w;
        var myAnswerIds = {};
        (q.answers || []).forEach(function (a) { if (a.wallet === w) myAnswerIds[a.id] = true; });

        (q.answers || []).forEach(function (a) {
          if (!a || a.wallet === w) return;                  // ignore my own answers
          var isReplyToMe = a.replyTo && myAnswerIds[a.replyTo.answerId];
          if (!mine && !isReplyToMe) return;
          out.push({
            id:    'ans:' + a.id,
            kind:  isReplyToMe ? 'rep' : 'ans',
            ts:    toSec(a.createdAt),
            title: isReplyToMe
                     ? ((a.alias || shortAddr(a.wallet)) + ' replied to you')
                     : ((a.alias || shortAddr(a.wallet)) + ' answered your question'),
            body:  (a.text || '').slice(0, 140),
            // No per-question deep link exists (the site is an SPA), so we send
            // the user to the Board: in-page if we're on Terra Oracle, else
            // across to terraoracle.io.
            go:    'board',
          });
        });
      });
      return out;
    });
  }

  // Chat replies — read straight off-chain through the draw worker's tx proxy
  // (same source the chat page itself uses, so no new backend). We look for
  // messages whose memo reply-prefix points at one of MY message txHashes.
  function fetchChatReplies(w) {
    return getJSON(CFG.drawWorker + '/proxy-txs?wallet=' + TREASURY_WALLET + '&limit=' + CFG.chatLimit)
      .then(function (body) {
        var raw = (body && body.txs) || [];
        var msgs = [];

        raw.forEach(function (t) {
          var memo = (t.tx && t.tx.value && t.tx.value.memo) || '';
          if (!memo.trim()) return;
          // Same two-step memo repair the chat page does: UTF-8 re-decode for
          // emoji, then an optional base64 layer.
          try {
            var bytes = Uint8Array.from(memo, function (c) { return c.charCodeAt(0) & 0xFF; });
            var dec = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            if (dec !== memo) memo = dec;
          } catch (e) {}
          try {
            var b64 = decodeURIComponent(escape(atob(memo.trim())));
            if (b64 && b64.length) memo = b64;
          } catch (e) {}

          var sender = null, amt = 0;
          ((t.tx && t.tx.value && t.tx.value.msg) || []).forEach(function (m) {
            var v = m.value || m;
            if ((v.to_address || '') !== TREASURY_WALLET) return;
            sender = v.from_address || null;
            var coins = v.amount || [];
            var lunc = Array.isArray(coins) ? coins.find(function (c) { return c.denom === 'uluna'; }) : null;
            amt = lunc ? parseInt(lunc.amount, 10) : 0;
          });
          if (!sender || amt < CHAT_MIN_ULUNA || amt > CHAT_MAX_ULUNA) return;
          if (SYSTEM_WALLETS.indexOf(sender) !== -1) return;

          var replyTo = null, text = memo.slice(0, 256);
          var m2 = memo.match(/^>([A-Fa-f0-9]{16})\|(.*)$/);
          if (m2) { replyTo = m2[1]; text = m2[2]; }

          msgs.push({
            sender: sender,
            text: text,
            replyTo: replyTo,
            txHash: (t.txhash || ''),
            ts: toSec(t.timestamp),
          });
        });

        // My message hashes → what a reply prefix would point at (first 16 chars)
        var mine = {};
        msgs.forEach(function (m) {
          if (m.sender === w && m.txHash) mine[m.txHash.slice(0, 16).toUpperCase()] = true;
        });

        return msgs.filter(function (m) {
          return m.replyTo && m.sender !== w && mine[m.replyTo.toUpperCase()];
        }).map(function (m) {
          return {
            id:    'chat:' + m.txHash,
            kind:  'chat',
            ts:    m.ts,
            title: shortAddr(m.sender) + ' replied in chat',
            body:  m.text.slice(0, 140),
            go:    'chat',
          };
        });
      });
  }

  // ── Draw broadcasts (schedule is deterministic — no backend needed) ────────
  // Daily closes at 20:00 UTC, weekly on Monday 20:00 UTC — the same boundary
  // used by the worker's getCurrentRoundId().
  function roundInfo(pool) {
    var now = new Date();
    var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0, 0));
    if (pool === 'weekly') {
      var diffToMon = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - diffToMon);
      if (now.getTime() < d.getTime()) d.setUTCDate(d.getUTCDate() - 7);
      var end = new Date(d.getTime()); end.setUTCDate(end.getUTCDate() + 7);
      return { roundId: 'weekly_' + d.toISOString().slice(0, 10), endsAt: end.getTime() };
    }
    if (now.getTime() < d.getTime()) d.setUTCDate(d.getUTCDate() - 1);
    var e2 = new Date(d.getTime()); e2.setUTCDate(e2.getUTCDate() + 1);
    return { roundId: 'daily_' + d.toISOString().slice(0, 10), endsAt: e2.getTime() };
  }

  // Reminders fire once per round: the roundId is baked into the notification
  // id, so the normal de-dup in merge() prevents repeats across polls/devices.
  function fetchDrawReminders(w) {
    var pools = CFG.dailyReminder ? ['weekly', 'daily'] : ['weekly'];
    return Promise.all(pools.map(function (pool) {
      var info = roundInfo(pool);
      var minsLeft = Math.floor((info.endsAt - Date.now()) / 60000);
      if (minsLeft < 0 || minsLeft > CFG.remindMins) return [];

      return getJSON(CFG.drawWorker + '/round-stats?pool=' + pool).then(function (st) {
        var myEntries = (st && st.byWallet && st.byWallet[w]) || 0;
        var label = pool === 'weekly' ? 'Weekly' : 'Daily';
        return [{
          id:    'draw:' + info.roundId + ':soon',
          kind:  'draw',
          ts:    Math.floor(Date.now() / 1000),
          title: label + ' draw in ' + (minsLeft < 1 ? 'less than a minute' : minsLeft + ' min'),
          body:  myEntries
                   ? ('You have ' + myEntries + ' ' + (myEntries === 1 ? 'entry' : 'entries') + ' · ' +
                      ((st && st.totalEntries) || 0) + ' total')
                   : 'You have no entries yet — mint to join',
          go:    'draw',
        }];
      });
    })).then(function (arrs) { return [].concat.apply([], arrs); });
  }

  // Draw results — served from the snapshot /round-complete writes, so it stays
  // readable after the round rolls over. Winners already get a personal "You
  // won" from /my-wins, so here we only tell everyone else how it ended.
  function fetchDrawResults(w) {
    var pools = CFG.dailyReminder ? ['weekly', 'daily'] : ['weekly'];
    return Promise.all(pools.map(function (pool) {
      return getJSON(CFG.drawWorker + '/last-draw?pool=' + pool).then(function (d) {
        if (!d || !d.roundId || !d.winners || !d.winners.length) return [];
        if (d.winners.some(function (x) { return x.wallet === w; })) return []; // covered by /my-wins
        var first = d.winners.slice().sort(function (a, b) { return (a.place || 9) - (b.place || 9); })[0];
        var prize = lunc(first.amountUluna);
        var label = pool === 'weekly' ? 'Weekly' : 'Daily';
        return [{
          id:    'result:' + d.roundId,
          kind:  'draw',
          ts:    toSec(d.completedAt),
          title: label + ' draw complete',
          body:  'Winner ' + shortAddr(first.wallet) + (prize ? (' · ' + prize + ' LUNC') : '') +
                 ' · ' + (d.totalEntries || 0) + ' entries',
          go:    'draw',
        }];
      });
    })).then(function (arrs) { return [].concat.apply([], arrs); });
  }

  // ── Poll cycle ────────────────────────────────────────────────────────────
  function merge(fresh) {
    var known = {};
    store.items.forEach(function (i) { known[i.id] = true; });

    var added = fresh.filter(function (i) { return i.id && !known[i.id]; });
    if (!added.length) { refreshBadge(); return; }

    var firstRun = !store.init;
    added.forEach(function (i) { i.read = firstRun; });        // no toast wall on first run

    store.items = added.concat(store.items)
      .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    store.init = true;
    saveStore(wallet, store);

    if (!firstRun) {
      added.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); })
           .slice(-CFG.maxToasts)
           .forEach(toast);
    }
    render();
  }

  function poll() {
    if (!wallet) return;
    Promise.all([
      fetchWins(wallet).catch(function () { return []; }),
      fetchAnswers(wallet).catch(function () { return []; }),
      fetchChatReplies(wallet).catch(function () { return []; }),
      fetchDrawReminders(wallet).catch(function () { return []; }),
      fetchDrawResults(wallet).catch(function () { return []; }),
    ]).then(function (res) {
      merge([].concat(res[0], res[1], res[2], res[3], res[4]).filter(Boolean));
    });
  }

  function startPolling() {
    stopPolling();
    if (!wallet) return;
    poll();
    timer = setInterval(function () {
      if (document.visibilityState === 'visible') poll();
    }, CFG.pollMs);
  }
  function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }

  // ── Wallet lifecycle ──────────────────────────────────────────────────────
  function setWallet(addr) {
    if (addr === wallet) return;
    wallet = addr || null;
    store = wallet ? loadStore(wallet) : { init: false, items: [] };
    render();
    if (wallet) startPolling(); else stopPolling();
  }

  function hookWalletFns() {
    // Wrap the site's own connect/disconnect so we react immediately instead of
    // waiting for the next localStorage poll.
    ['setWalletConnected', 'disconnectWallet'].forEach(function (fn) {
      if (typeof window[fn] === 'function' && !window[fn].__onfHooked) {
        var prev = window[fn];
        var wrapped = function () {
          var r = prev.apply(this, arguments);
          setTimeout(function () { setWallet(currentWallet()); }, 60);
          return r;
        };
        wrapped.__onfHooked = true;
        window[fn] = wrapped;
      }
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    mount();
    hookWalletFns();
    setWallet(currentWallet());
    // Sites restore the session at different points during startup, and some
    // define setWalletConnected late — re-check for a while, then settle.
    var tries = 0;
    var iv = setInterval(function () {
      hookWalletFns();
      setWallet(currentWallet());
      if (++tries > 20) clearInterval(iv);           // ~20s
    }, 1000);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && wallet) poll();
    });
    window.addEventListener('storage', function (e) {
      if (e.key === 'wallet_session') setWallet(currentWallet());
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // ── Public API (for later phases / manual pushes) ──────────────────────────
  window.OracleNotify = {
    push: function (item) {                       // { kind, title, body, link }
      if (!item || !wallet) return;
      item.id = item.id || (item.kind || 'msg') + ':' + Date.now();
      item.ts = item.ts || Math.floor(Date.now() / 1000);
      item.kind = item.kind || 'ans';
      merge([item]);
    },
    refresh: poll,
    markAllRead: markAllRead,
    _state: function () { return { wallet: wallet, items: store.items }; },
  };
})();
