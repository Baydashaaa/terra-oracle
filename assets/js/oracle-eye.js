/* ════════════════════════════════════════════════════════════════
   ORACLE EYE v2 - feedback widget in the navbar (self-contained)
   ----------------------------------------------------------------
   <script src="assets/js/oracle-eye.js?v=..."></script>

   The eye sits in the top bar before the wallet button (on phones at
   the left edge). It blinks, follows the cursor, and turns amber when
   a JS error happens on the page - the error is attached to the report.
   Click opens a panel: Bug / Idea / Other, text, screenshot (attach or
   Ctrl+V), auto-attached context. Sends to the Oracle Eye worker
   (Telegram), JSON with a FormData fallback, same as v1.
   No top bar on the page (draw subdomain) - falls back to a fixed
   corner button.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__oracleEyeLoaded) return;
  window.__oracleEyeLoaded = true;
  // Inside the /draw iframe the outer page already shows its own eye.
  if (window.top !== window.self ||
      document.documentElement.classList.contains('is-embedded')) return;

  var WORKER_URL = 'https://oracle-eye.vladislav-baydan.workers.dev/feedback';
  var SITE = (location.hostname.indexOf('draw.') === 0) ? 'draw.terraoracle.io' : 'terraoracle.io';
  var MOBILE = '(max-width:760px)';

  var _fbType = 'bug';
  var _busy = false;
  var _errors = [];
  var _btn = null, _panel = null, _backdrop = null, _iris = null;

  // v1 leftovers: dragged position and the collapsed flag
  try { localStorage.removeItem('oe-btn-pos'); localStorage.removeItem('oe-collapsed'); } catch (e) {}

  var PHRASES = {
    open:   ["What did you notice?", "I'm all eyes", "Got something for me?"],
    bug:    ["Show me the bug", "What broke?"],
    idea:   ["An idea - I'm listening"],
    other:  ["Go on, I'm listening"],
    sending:["Sending..."],
    sent:   ["Sent. Thank you!"],
    error:  ["Not sent. Try again"],
    empty:  ["Type a few words first"]
  };
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* ── Error capture: starts at load, before the page breaks ───── */
  function pushError(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    if (!text || /^Script error\.?$/i.test(text) || /ResizeObserver loop/i.test(text)) return;
    if (_errors.indexOf(text) !== -1) return;
    _errors.push(text);
    if (_errors.length > 5) _errors.shift();
    refreshState();
  }
  window.addEventListener('error', function (e) {
    var f = e && e.filename ? String(e.filename) : '';
    if (/^(chrome|moz|safari)-extension:/.test(f)) return;       // extensions, not us
    if (e && e.message) pushError(e.message + (f ? ' @ ' + f.split('/').pop().split('?')[0] + ':' + (e.lineno || 0) : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    pushError('Unhandled: ' + (r && r.message ? r.message : String(r)));
  });

  /* ── Styles ──────────────────────────────────────────────────── */
  var css = ''
    + '@keyframes oeBlink{0%,93%,100%{transform:scaleY(1)}95.5%{transform:scaleY(.08)}}'
    + '#oe-nav{position:relative;width:44px;height:44px;padding:0;margin:0;border:0;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;transition:transform .2s;-webkit-tap-highlight-color:transparent;}'
    + '#oe-nav:hover,#oe-nav.open{transform:scale(1.06);}'
    + '#oe-nav:focus-visible{outline:2px solid #22D3EE;outline-offset:2px;border-radius:12px;}'
    + '#oe-nav svg{width:44px;height:44px;overflow:visible;display:block;}'
    + '#oe-nav .oe-aura{opacity:.55;transition:opacity .25s;}'
    + '#oe-nav:hover .oe-aura,#oe-nav.open .oe-aura,#oe-nav.oe-warn .oe-aura{opacity:1;}'
    + '#oe-nav .oe-rays{opacity:.7;transition:opacity .25s;}'
    + '#oe-nav:hover .oe-rays,#oe-nav.open .oe-rays{opacity:1;}'
    + '#oe-nav .oe-blinkg{transform-origin:24px 24px;transform-box:view-box;animation:oeBlink 7s infinite;}'
    + '#oe-nav .oe-irisg{transition:transform .14s ease-out;}'
    + '#oe-nav .oe-pupil{transform-origin:24px 24px;transform-box:view-box;transition:transform .2s;}'
    + '#oe-nav:hover .oe-pupil,#oe-nav.open .oe-pupil{transform:scale(1.25);}'
    + '#oe-badge{position:absolute;top:0;right:-2px;min-width:16px;height:16px;box-sizing:border-box;padding:0 4px;border-radius:8px;background:#FFB547;color:#1A1205;font:700 10px/16px "Exo 2",sans-serif;text-align:center;box-shadow:0 0 10px rgba(255,181,71,.6);display:none;pointer-events:none;}'
    + '#oe-nav.oe-warn #oe-badge{display:block;}'
    + '#oe-nav.oe-float{position:fixed;right:18px;bottom:18px;z-index:9998;}'
    + '@media ' + MOBILE + '{#oe-nav{order:-1;margin-right:auto;}}'

    + '#oe-backdrop{position:fixed;inset:0;z-index:9998;background:transparent;display:none;}'
    + '#oe-backdrop.open{display:block;}'
    + '#oe-panel{position:fixed;z-index:9999;width:380px;max-width:calc(100vw - 24px);box-sizing:border-box;padding:16px;border-radius:16px;'
    +   'background:linear-gradient(160deg,rgba(22,18,52,.97),rgba(11,15,30,.97));border:1px solid rgba(123,92,255,.35);'
    +   'box-shadow:0 18px 50px rgba(0,0,0,.6),0 0 32px rgba(123,92,255,.18);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);'
    +   'font-family:"Exo 2",sans-serif;color:#E8F0FF;display:none;max-height:calc(100dvh - 24px);overflow-y:auto;}'
    + '#oe-panel.open{display:block;animation:oeIn .18s ease;}'
    + '@keyframes oeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}'
    + '#oe-panel:before{content:"";position:absolute;top:0;left:16px;right:16px;height:1px;background:linear-gradient(90deg,transparent,#7B5CFF,#00D4FF,transparent);opacity:.7;}'
    + '#oe-panel .oe-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:12px;border-bottom:1px solid rgba(123,92,255,.2);}'
    + '#oe-panel .oe-ttl{font-family:"Rajdhani",sans-serif;font-size:15px;font-weight:700;letter-spacing:.18em;color:#fff;}'
    + '#oe-panel .oe-pill{display:flex;align-items:center;gap:7px;padding:5px 10px;border-radius:999px;background:rgba(34,211,238,.12);font-size:11px;}'
    + '#oe-panel .oe-pill i{width:7px;height:7px;border-radius:50%;background:#22D3EE;}'
    + '#oe-panel.oe-warn .oe-pill{background:rgba(255,181,71,.14);}'
    + '#oe-panel.oe-warn .oe-pill i{background:#FFB547;}'
    + '#oe-msg{font-size:12px;color:#9FB0D0;min-height:16px;margin:10px 0 2px;transition:opacity .2s;}'
    + '#oe-cats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:10px 0 12px;padding:4px;border-radius:12px;background:rgba(123,92,255,.06);border:1px solid rgba(123,92,255,.15);}'
    + '.oe-cat{height:36px;border-radius:9px;border:0;cursor:pointer;font:600 12px "Exo 2",sans-serif;letter-spacing:.04em;background:transparent;color:#8FA3C7;}'
    + '.oe-cat.active{background:linear-gradient(135deg,#3B1FCC,#7B5CFF);color:#fff;}'
    + '.oe-cat:focus-visible,#oe-send:focus-visible,#oe-cancel:focus-visible{outline:2px solid #22D3EE;outline-offset:2px;}'
    + '#oe-panel .oe-lbl{display:block;margin:0 0 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#a78bfa;}'
    + '#oe-other{display:none;width:100%;box-sizing:border-box;margin-bottom:10px;padding:9px 12px;border-radius:10px;border:1px solid rgba(123,92,255,.25);background:rgba(7,10,20,.6);color:#E8F0FF;font:13px "Exo 2",sans-serif;outline:none;}'
    + '#oe-text{width:100%;box-sizing:border-box;height:96px;resize:none;padding:12px;border-radius:12px;border:1px solid rgba(123,92,255,.25);background:rgba(7,10,20,.6);color:#E8F0FF;font:13px/1.5 "Exo 2",sans-serif;outline:none;}'
    + '#oe-text:focus,#oe-other:focus{border-color:rgba(167,139,250,.6);}'
    + '#oe-text::placeholder,#oe-other::placeholder{color:#6B82A8;}'
    + '#oe-img-label{display:block;margin:10px 0;padding:8px 12px;border:1px dashed rgba(123,92,255,.3);border-radius:10px;text-align:center;font-size:12px;color:#9FB0D0;cursor:pointer;transition:border-color .2s,color .2s;}'
    + '#oe-img-label:hover{border-color:rgba(167,139,250,.6);color:#E8F0FF;}'
    + '#oe-img-prev{display:none;margin-bottom:10px;position:relative;}'
    + '#oe-img-prev img{width:100%;max-height:120px;object-fit:cover;border-radius:10px;border:1px solid rgba(123,92,255,.25);}'
    + '#oe-img-rm{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;border:0;background:rgba(0,0,0,.65);color:#fff;cursor:pointer;font-size:13px;line-height:1;}'
    + '#oe-panel .oe-lbl2{margin:2px 0 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8FA3C7;}'
    + '#oe-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;}'
    + '#oe-chips span{padding:5px 10px;border-radius:999px;border:1px solid rgba(123,92,255,.22);background:rgba(123,92,255,.06);font-size:11px;color:#C9D6F0;}'
    + '#oe-chips span.warn{border-color:rgba(255,181,71,.5);background:rgba(255,181,71,.1);color:#FFD08A;}'
    + '#oe-foot{display:flex;gap:8px;}'
    + '#oe-cancel{flex:1;height:44px;border-radius:12px;border:1px solid rgba(123,92,255,.3);background:transparent;color:#9FB0D0;font:600 12px "Exo 2",sans-serif;cursor:pointer;}'
    + '#oe-send{flex:2;height:44px;border-radius:12px;border:1px solid rgba(123,92,255,.5);background:linear-gradient(135deg,#3B1FCC,#7B5CFF);color:#fff;font:700 12px "Exo 2",sans-serif;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;box-shadow:0 0 20px rgba(123,92,255,.35);}'
    + '#oe-send:disabled{opacity:.6;cursor:default;}'
    + '#oe-status{text-align:center;font-size:12px;margin-top:10px;min-height:16px;}'
    + '@media ' + MOBILE + '{'
    +   '#oe-backdrop{background:rgba(3,5,12,.6);}'
    +   '#oe-panel{left:0!important;right:0;top:auto!important;bottom:0;width:auto;max-width:none;border-radius:24px 24px 0 0;border-bottom:0;padding:10px 16px calc(20px + env(safe-area-inset-bottom,0px));max-height:85dvh;}'
    +   '#oe-panel .oe-grab{display:block;}'
    +   '#oe-text{font-size:16px;}'
    + '}'
    + '#oe-panel .oe-grab{display:none;width:44px;height:5px;border-radius:3px;background:rgba(167,139,250,.4);margin:0 auto 12px;}'
    + '@media (prefers-reduced-motion:reduce){#oe-nav .oe-blinkg{animation:none;}#oe-nav,#oe-nav .oe-irisg,#oe-nav .oe-pupil{transition:none;}#oe-panel.open{animation:none;}}';

  /* ── The All-seeing eye ──────────────────────────────────────── */
  var SVG = ''
    + '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">'
    + '<defs>'
    +   '<radialGradient id="oe-g-iris" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#9FF6FF"/><stop offset="35%" stop-color="#00D4FF"/><stop offset="75%" stop-color="#7B5CFF"/><stop offset="100%" stop-color="#2A1580"/></radialGradient>'
    +   '<radialGradient id="oe-g-iris-w" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFE7B0"/><stop offset="35%" stop-color="#FFB547"/><stop offset="75%" stop-color="#C2410C"/><stop offset="100%" stop-color="#5A1F05"/></radialGradient>'
    +   '<radialGradient id="oe-g-aura" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#00D4FF" stop-opacity=".45"/><stop offset="55%" stop-color="#7B5CFF" stop-opacity=".18"/><stop offset="100%" stop-color="#7B5CFF" stop-opacity="0"/></radialGradient>'
    +   '<radialGradient id="oe-g-aura-w" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFB547" stop-opacity=".5"/><stop offset="55%" stop-color="#FF8A3D" stop-opacity=".18"/><stop offset="100%" stop-color="#FF8A3D" stop-opacity="0"/></radialGradient>'
    +   '<radialGradient id="oe-g-sclera" cx="50%" cy="45%" r="60%"><stop offset="0%" stop-color="#241C58"/><stop offset="100%" stop-color="#070A16"/></radialGradient>'
    +   '<linearGradient id="oe-g-lid" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#7B5CFF"/><stop offset="100%" stop-color="#00D4FF"/></linearGradient>'
    +   '<linearGradient id="oe-g-ray" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#00D4FF" stop-opacity=".9"/><stop offset="100%" stop-color="#7B5CFF" stop-opacity="0"/></linearGradient>'
    +   '<clipPath id="oe-clip"><path d="M6 24C12 13 36 13 42 24C36 35 12 35 6 24Z"/></clipPath>'
    +   '<filter id="oe-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    + '</defs>'
    + '<circle class="oe-aura" cx="24" cy="24" r="23.5" fill="url(#oe-g-aura)"/>'
    + '<g class="oe-rays">'
    +   '<polygon points="22.8,10 25.2,10 24,2.5" fill="url(#oe-g-ray)"/>'
    +   '<polygon points="29.96,11.28 32.04,12.48 34.2,6.3" fill="url(#oe-g-ray)"/>'
    +   '<polygon points="15.96,12.48 18.04,11.28 13.8,6.3" fill="url(#oe-g-ray)"/>'
    +   '<polygon points="35.52,15.96 36.72,18.04 41,14.2" fill="url(#oe-g-ray)"/>'
    +   '<polygon points="11.28,18.04 12.48,15.96 7,14.2" fill="url(#oe-g-ray)"/>'
    + '</g>'
    + '<g class="oe-blinkg">'
    +   '<path d="M6 24C12 13 36 13 42 24C36 35 12 35 6 24Z" fill="url(#oe-g-sclera)"/>'
    +   '<g clip-path="url(#oe-clip)"><g class="oe-irisg">'
    +     '<circle class="oe-iris" cx="24" cy="24" r="7.4" fill="url(#oe-g-iris)" filter="url(#oe-glow)"/>'
    +     '<circle class="oe-pupil" cx="24" cy="24" r="3.3" fill="#02030A"/>'
    +     '<circle cx="26.6" cy="21.4" r="1.2" fill="#fff" opacity=".9"/>'
    +   '</g></g>'
    +   '<path d="M6 24C12 13 36 13 42 24C35 17.6 13 17.6 6 24Z" fill="url(#oe-g-lid)"/>'
    +   '<path d="M6 24C12 35 36 35 42 24C35 30.2 13 30.2 6 24Z" fill="url(#oe-g-lid)" opacity=".5"/>'
    + '</g>'
    + '</svg>';

  /* ── Build ───────────────────────────────────────────────────── */
  function build() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    _btn = document.createElement('button');
    _btn.id = 'oe-nav';
    _btn.type = 'button';
    _btn.title = 'Report a bug or share an idea';
    _btn.setAttribute('aria-label', 'Oracle Eye: report a bug or share an idea');
    _btn.setAttribute('aria-haspopup', 'dialog');
    _btn.setAttribute('aria-expanded', 'false');
    _btn.innerHTML = SVG + '<span id="oe-badge"></span>';
    // Random start, so the blink does not look mechanical
    _btn.querySelector('.oe-blinkg').style.animationDelay = (-Math.random() * 7).toFixed(2) + 's';
    _iris = _btn.querySelector('.oe-irisg');

    var wallet = document.getElementById('wallet-wrap');
    var bar = document.querySelector('.topbar');
    if (wallet && wallet.parentNode) wallet.parentNode.insertBefore(_btn, wallet);
    else if (bar) bar.appendChild(_btn);
    else { _btn.classList.add('oe-float'); document.body.appendChild(_btn); }

    _backdrop = document.createElement('div');
    _backdrop.id = 'oe-backdrop';
    document.body.appendChild(_backdrop);

    _panel = document.createElement('div');
    _panel.id = 'oe-panel';
    _panel.setAttribute('role', 'dialog');
    _panel.setAttribute('aria-label', 'Oracle Eye');
    _panel.innerHTML = ''
      + '<div class="oe-grab"></div>'
      + '<div class="oe-top"><div class="oe-ttl">ORACLE EYE</div><div class="oe-pill"><i></i><span id="oe-pill-txt">Watching</span></div></div>'
      + '<div id="oe-msg"></div>'
      + '<div id="oe-cats" role="group" aria-label="Type">'
      +   '<button type="button" class="oe-cat active" data-type="bug" aria-pressed="true">Bug</button>'
      +   '<button type="button" class="oe-cat" data-type="idea" aria-pressed="false">Idea</button>'
      +   '<button type="button" class="oe-cat" data-type="other" aria-pressed="false">Other</button>'
      + '</div>'
      + '<input id="oe-other" type="text" placeholder="Your own label" aria-label="Your own label">'
      + '<label class="oe-lbl" for="oe-text" id="oe-text-lbl">What went wrong?</label>'
      + '<textarea id="oe-text" placeholder="What you did and what you expected to happen"></textarea>'
      + '<label id="oe-img-label" for="oe-img">+ Attach or paste a screenshot (Ctrl+V)</label>'
      + '<input type="file" id="oe-img" accept="image/*" style="display:none">'
      + '<div id="oe-img-prev"><img id="oe-img-thumb" alt="Attached screenshot"><button id="oe-img-rm" type="button" aria-label="Remove screenshot">&times;</button></div>'
      + '<div class="oe-lbl2">Attached automatically</div>'
      + '<div id="oe-chips"></div>'
      + '<div id="oe-foot"><button id="oe-cancel" type="button">Cancel</button><button id="oe-send" type="button">Send report</button></div>'
      + '<div id="oe-status" role="status"></div>';
    document.body.appendChild(_panel);

    _btn.addEventListener('click', function () { isOpen() ? closePanel() : openPanel(); });
    _backdrop.addEventListener('click', closePanel);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) { closePanel(); _btn.focus(); } });
    window.addEventListener('resize', function () { if (isOpen()) placePanel(); });

    wireForm();
    wireGaze();
    refreshState();
  }

  /* ── Gaze: the pupil follows the cursor; idle glances on touch ─ */
  function setGaze(x, y) { if (_iris) _iris.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px)'; }
  function wireGaze() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var raf = 0, mx = 0, my = 0, lastMove = 0;
    document.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY; lastMove = Date.now();
      if (!raf) raf = requestAnimationFrame(function () {
        raf = 0;
        var r = _btn.getBoundingClientRect(); if (!r.width) return;
        var dx = mx - (r.left + r.width / 2), dy = my - (r.top + r.height / 2);
        var d = Math.hypot(dx, dy) || 1, m = Math.min(2.4, d / 90);
        setGaze(dx / d * m, dy / d * m * 0.6);
      });
    }, { passive: true });
    setInterval(function () {
      if (Date.now() - lastMove < 4000 || isOpen()) return;
      setGaze((Math.random() * 2 - 1) * 2.2, (Math.random() * 2 - 1) * 0.9);
    }, 3800);
  }

  /* ── State: normal / error caught ────────────────────────────── */
  function refreshState() {
    if (!_btn) return;
    var n = _errors.length, warn = n > 0;
    _btn.classList.toggle('oe-warn', warn);
    _btn.querySelector('#oe-badge').textContent = n ? String(n) : '';
    _btn.querySelector('.oe-iris').setAttribute('fill', warn ? 'url(#oe-g-iris-w)' : 'url(#oe-g-iris)');
    _btn.querySelector('.oe-aura').setAttribute('fill', warn ? 'url(#oe-g-aura-w)' : 'url(#oe-g-aura)');
    _btn.title = warn ? 'Something went wrong on this page - send a report' : 'Report a bug or share an idea';
    if (_panel) {
      _panel.classList.toggle('oe-warn', warn);
      _panel.querySelector('#oe-pill-txt').textContent = warn ? (n === 1 ? '1 error caught' : n + ' errors caught') : 'Watching';
    }
  }

  /* ── Context attached to every report ────────────────────────── */
  function browserName() {
    var u = navigator.userAgent, b = 'Browser';
    if (/Edg\//.test(u)) b = 'Edge'; else if (/OPR\//.test(u)) b = 'Opera';
    else if (/Firefox\//.test(u)) b = 'Firefox'; else if (/Chrome\//.test(u)) b = 'Chrome';
    else if (/Safari\//.test(u)) b = 'Safari';
    return b + (/Mobi|Android|iPhone|iPad/.test(u) ? ' mobile' : '');
  }
  function walletAddr() {
    return (typeof connectedAddress !== 'undefined' && connectedAddress) ? connectedAddress
         : (typeof globalWalletAddress !== 'undefined' && globalWalletAddress) ? globalWalletAddress
         : '';
  }
  function renderChips() {
    var page = location.pathname + location.hash;
    var html = '<span>Page ' + esc(page.length > 28 ? page.slice(0, 28) + '...' : page) + '</span>'
      + '<span>' + esc(browserName()) + ', ' + window.innerWidth + '×' + window.innerHeight + '</span>'
      + '<span>' + (walletAddr() ? 'Wallet connected' : 'No wallet') + '</span>'
      + '<span class="' + (_errors.length ? 'warn' : '') + '">Page errors: ' + _errors.length + '</span>';
    _panel.querySelector('#oe-chips').innerHTML = html;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // Telegram Markdown breaks on stray _ * ` [ in error text
  function plain(s) { return String(s).replace(/[_*`\[\]]/g, ' '); }

  /* ── Panel ───────────────────────────────────────────────────── */
  function isOpen() { return _panel && _panel.classList.contains('open'); }
  function placePanel() {
    if (window.matchMedia(MOBILE).matches || _btn.classList.contains('oe-float')) {
      _panel.style.left = ''; _panel.style.top = '';
      if (_btn.classList.contains('oe-float') && !window.matchMedia(MOBILE).matches) {
        _panel.style.left = 'auto'; _panel.style.right = '18px'; _panel.style.top = 'auto'; _panel.style.bottom = '74px';
      }
      return;
    }
    var r = _btn.getBoundingClientRect(), w = _panel.offsetWidth || 380;
    var left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    _panel.style.left = left + 'px';
    _panel.style.top = (r.bottom + 10) + 'px';
  }
  function openPanel() {
    renderChips();
    refreshState();
    _panel.classList.add('open');
    _backdrop.classList.add('open');
    _btn.classList.add('open');
    _btn.setAttribute('aria-expanded', 'true');
    placePanel();
    say(_errors.length ? 'Something broke on this page. Tell me what you did' : pick(PHRASES.open));
    setTimeout(function () { var t = _panel.querySelector('#oe-text'); if (t && !window.matchMedia(MOBILE).matches) t.focus(); }, 80);
  }
  function closePanel() {
    _panel.classList.remove('open');
    _backdrop.classList.remove('open');
    _btn.classList.remove('open');
    _btn.setAttribute('aria-expanded', 'false');
    resetForm();
  }
  function resetForm() {
    _panel.querySelector('#oe-text').value = '';
    _panel.querySelector('#oe-status').textContent = '';
    _panel.querySelector('#oe-other').value = '';
    selectType('bug', true);
    removeImg();
    var sb = _panel.querySelector('#oe-send'); sb.disabled = false; sb.textContent = 'Send report';
  }
  function say(text) {
    var el = _panel && _panel.querySelector('#oe-msg'); if (!el) return;
    el.style.opacity = '0';
    setTimeout(function () { el.textContent = text; el.style.opacity = '1'; }, 150);
  }

  /* ── Form ────────────────────────────────────────────────────── */
  var LABELS = { bug: 'What went wrong?', idea: 'Your idea', other: 'Your message' };
  var HINTS = { bug: 'What you did and what you expected to happen', idea: 'What would make Terra Oracle better', other: 'Anything you want to tell the team' };
  function selectType(type, silent) {
    _fbType = type;
    _panel.querySelectorAll('.oe-cat').forEach(function (b) {
      var on = b.getAttribute('data-type') === type;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    _panel.querySelector('#oe-other').style.display = (type === 'other') ? 'block' : 'none';
    _panel.querySelector('#oe-text-lbl').textContent = LABELS[type];
    _panel.querySelector('#oe-text').placeholder = HINTS[type];
    if (!silent) say(pick(PHRASES[type]));
  }
  function wireForm() {
    _panel.querySelectorAll('.oe-cat').forEach(function (b) {
      b.addEventListener('click', function () { selectType(b.getAttribute('data-type')); });
    });
    _panel.querySelector('#oe-img').addEventListener('change', function () { if (this.files[0]) attachImage(this.files[0], this.files[0].name); });
    _panel.querySelector('#oe-img-rm').addEventListener('click', removeImg);
    _panel.querySelector('#oe-cancel').addEventListener('click', closePanel);
    _panel.querySelector('#oe-send').addEventListener('click', submit);
    document.addEventListener('paste', function (e) {
      if (!isOpen()) return;
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
          var file = items[i].getAsFile();
          if (file) { attachImage(file, 'Screenshot pasted'); e.preventDefault(); break; }
        }
      }
    });
  }
  function attachImage(file, name) {
    _panel.querySelector('#oe-img-label').textContent = String(name || 'screenshot').slice(0, 30);
    var reader = new FileReader();
    reader.onload = function (e) {
      _panel.querySelector('#oe-img-thumb').src = e.target.result;
      _panel.querySelector('#oe-img-prev').style.display = 'block';
    };
    reader.readAsDataURL(file);
    try { var dt = new DataTransfer(); dt.items.add(file); _panel.querySelector('#oe-img').files = dt.files; } catch (e) {}
  }
  function removeImg() {
    _panel.querySelector('#oe-img').value = '';
    _panel.querySelector('#oe-img-prev').style.display = 'none';
    _panel.querySelector('#oe-img-label').textContent = '+ Attach or paste a screenshot (Ctrl+V)';
  }

  async function submit() {
    if (_busy) return;
    var text = _panel.querySelector('#oe-text').value.trim();
    var status = _panel.querySelector('#oe-status');
    if (!text) { say(pick(PHRASES.empty)); _panel.querySelector('#oe-text').focus(); return; }
    _busy = true;
    var btn = _panel.querySelector('#oe-send');
    btn.disabled = true; btn.textContent = 'Sending...';
    status.textContent = '';
    say(pick(PHRASES.sending));
    try {
      var custom = (_panel.querySelector('#oe-other').value || '').trim();
      var typeLabel = (_fbType === 'other' && custom) ? '[' + plain(custom) + ']'
                    : ({ bug: '[bug]', idea: '[idea]', other: '[other]' }[_fbType] || '[other]');
      var ctx = 'Page: ' + plain(location.pathname + location.hash)
              + '\nBrowser: ' + browserName() + ', ' + window.innerWidth + 'x' + window.innerHeight;
      if (_errors.length) ctx += '\nPage errors:\n' + _errors.map(function (e) { return '- ' + plain(e); }).join('\n');
      var msg = typeLabel + ' *Oracle Feedback · ' + _fbType.toUpperCase() + '*\n\n' + text
              + '\n\n' + (walletAddr() || 'anonymous') + '\n' + SITE + '\n\n' + ctx;

      var imgFile = _panel.querySelector('#oe-img').files[0];
      var imageBase64 = null, imageType = 'image/jpeg';
      if (imgFile) imageBase64 = await compress(imgFile);

      var res;
      try {
        res = await fetch(WORKER_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg, image: imageBase64, imageType: imageType })
        });
      } catch (fetchErr) {
        var fd = new FormData();
        fd.append('message', msg);
        if (imageBase64) { fd.append('image', imageBase64); fd.append('imageType', imageType); }
        res = await fetch(WORKER_URL, { method: 'POST', body: fd });
      }
      if (res && res.ok) {
        status.style.color = '#3EE6A8';
        status.textContent = 'Report sent. Thank you!';
        say(pick(PHRASES.sent));
        _errors = []; refreshState();
        setTimeout(closePanel, 1800);
      } else {
        throw new Error('Server error ' + (res ? res.status : ''));
      }
    } catch (e) {
      status.style.color = '#FF7A7A';
      status.textContent = 'Not sent. Check the connection and try again.';
      say(pick(PHRASES.error));
      btn.disabled = false; btn.textContent = 'Send report';
    }
    _busy = false;
  }

  function compress(imgFile) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var MAX = 1200, w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else { w = Math.round(w * MAX / h); h = MAX; }
          }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.75).split(',')[1]);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(imgFile);
    });
  }

  /* ── Init ────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

  window.OracleEye = {
    open: function () { if (_panel) openPanel(); },
    close: function () { if (_panel) closePanel(); },
    hide: function () {}, show: function () {}   // v1 API, nothing to hide in the navbar
  };
})();
