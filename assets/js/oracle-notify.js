/* ============================================================================
 * oracle-notify.js  ·  v1.0.0
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
  }, window.ORACLE_NOTIFY_CONFIG || {});

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
  function injectCss() {
    if (document.getElementById('oracle-notify-css')) return;
    var st = document.createElement('style');
    st.id = 'oracle-notify-css';
    st.textContent = [
      '.onf-wrap{position:relative;display:inline-flex;flex:none;}',
      '.onf-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;',
      'width:36px;height:36px;border-radius:999px;cursor:pointer;color:#cfe0ff;',
      'background:rgba(84,147,247,0.10);border:1px solid rgba(84,147,247,0.35);',
      'transition:border-color .2s,box-shadow .2s,background .2s;padding:0;}',
      '.onf-bell:hover{border-color:rgba(84,147,247,0.85);box-shadow:0 0 14px rgba(84,147,247,0.30);}',
      '.onf-bell svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
      '.onf-badge{position:absolute;top:-4px;right:-4px;min-width:17px;height:17px;padding:0 4px;',
      'display:none;align-items:center;justify-content:center;border-radius:999px;',
      'background:linear-gradient(135deg,#7B5CFF,#5b8cff);color:#fff;font-size:10px;font-weight:700;',
      'line-height:1;box-shadow:0 0 10px rgba(123,92,255,0.7);}',
      '.onf-bell.has-unread .onf-badge{display:flex;}',
      '.onf-bell.has-unread{color:#a9c6ff;border-color:rgba(123,92,255,0.6);}',

      '.onf-panel{position:absolute;top:calc(100% + 10px);right:0;width:330px;max-width:calc(100vw - 24px);',
      'background:rgba(11,16,32,0.97);border:1px solid rgba(84,147,247,0.28);border-radius:14px;',
      'box-shadow:0 18px 50px rgba(0,0,0,0.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
      'z-index:9600;overflow:hidden;display:none;}',
      '.onf-panel.open{display:block;}',
      '.onf-head{display:flex;align-items:center;justify-content:space-between;gap:8px;',
      'padding:11px 13px;border-bottom:1px solid rgba(84,147,247,0.18);}',
      '.onf-head b{font-size:13px;color:#eaf1ff;font-weight:600;letter-spacing:.02em;}',
      '.onf-mark{font-size:11px;color:#7eb8ff;cursor:pointer;background:none;border:none;padding:0;}',
      '.onf-mark:hover{text-decoration:underline;}',
      '.onf-list{max-height:min(60vh,400px);overflow-y:auto;scrollbar-width:thin;}',
      '.onf-item{display:flex;gap:10px;padding:11px 13px;border-bottom:1px solid rgba(84,147,247,0.10);',
      'cursor:pointer;text-decoration:none;}',
      '.onf-item:last-child{border-bottom:none;}',
      '.onf-item:hover{background:rgba(84,147,247,0.07);}',
      '.onf-item.unread{background:rgba(123,92,255,0.09);}',
      '.onf-ic{flex:none;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;}',
      '.onf-ic svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
      '.onf-ic.win{background:rgba(244,208,63,0.14);color:#f4d03f;}',
      '.onf-ic.ans{background:rgba(0,212,255,0.13);color:#00d4ff;}',
      '.onf-ic.rep{background:rgba(123,92,255,0.15);color:#a98bff;}',
      '.onf-tx{min-width:0;flex:1;}',
      '.onf-t{font-size:12.5px;font-weight:600;color:#eaf1ff;line-height:1.35;}',
      '.onf-b{font-size:11.5px;color:#93a7c9;line-height:1.35;margin-top:2px;',
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
      '.onf-meta{flex:none;text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:5px;}',
      '.onf-time{font-size:10.5px;color:#66789a;white-space:nowrap;}',
      '.onf-dot{width:7px;height:7px;border-radius:999px;background:#7B5CFF;box-shadow:0 0 8px rgba(123,92,255,.9);}',
      '.onf-empty{padding:26px 14px;text-align:center;color:#66789a;font-size:12px;}',

      '.onf-toasts{position:fixed;right:16px;bottom:16px;z-index:9500;display:flex;flex-direction:column;',
      'gap:9px;align-items:flex-end;pointer-events:none;max-width:calc(100vw - 32px);}',
      '.onf-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;width:300px;max-width:100%;',
      'background:rgba(11,16,32,0.97);border:1px solid rgba(123,92,255,0.45);border-radius:12px;padding:11px 12px;',
      'box-shadow:0 12px 36px rgba(0,0,0,0.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
      'cursor:pointer;transform:translateY(10px);opacity:0;transition:opacity .25s ease,transform .25s ease;}',
      '.onf-toast.in{opacity:1;transform:translateY(0);}',
      '.onf-x{flex:none;background:none;border:none;color:#66789a;cursor:pointer;font-size:15px;line-height:1;padding:2px;}',
      '.onf-x:hover{color:#cfe0ff;}',

      '@media (max-width:600px){',
      '.onf-panel{position:fixed;top:auto;right:8px;left:8px;width:auto;max-width:none;}',
      '.onf-toasts{left:12px;right:12px;bottom:12px;align-items:stretch;}',
      '.onf-toast{width:auto;}',
      '}',
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  var SVG_BELL = '<svg viewBox="0 0 24 24"><path d="M6.6 10.2a5.4 5.4 0 0 1 10.8 0c0 3.9 1.5 5.4 1.5 5.4H5.1s1.5-1.5 1.5-5.4Z"/><path d="M10 18.4a2.2 2.2 0 0 0 4 0"/></svg>';
  var ICONS = {
    win: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M16 5h3v2a3 3 0 0 1-3 3"/><path d="M8 5H5v2a3 3 0 0 0 3 3"/><path d="M10 17h4M9 20h6"/></svg>',
    ans: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>',
    rep: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M9 11h6M9 14h4"/></svg>',
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

    elBell.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = elPanel.classList.toggle('open');
      if (open) render();
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
    if (item.go === 'board') {
      if (typeof window.showPage === 'function') { try { window.showPage('board'); return; } catch (e) {} }
      window.open('https://terraoracle.io', '_blank', 'noopener');
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
  function toast(item) {
    if (!elToasts) return;
    while (elToasts.children.length >= CFG.maxToasts) elToasts.removeChild(elToasts.firstChild);

    var t = document.createElement('div');
    t.className = 'onf-toast';
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
        return {
          id:    'win:' + (x.tokenId || '') + ':' + (x.roundId || ''),
          kind:  'win',
          ts:    toSec(x.wonAt),
          title: 'You won the ' + pool.toLowerCase() + ' draw',
          body:  ord + ' place · ' + (x.tier || 'NFT') + ' ' + (x.tokenId || ''),
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
    ]).then(function (res) {
      merge([].concat(res[0], res[1]).filter(Boolean));
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
