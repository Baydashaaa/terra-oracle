/* ════════════════════════════════════════════════════════════════
   ORACLE EYE — animated mascot + feedback widget (self-contained)
   ----------------------------------------------------------------
   Drop-in module. Include on any page with:
     <script src="assets/js/oracle-eye.js?v=1"></script>
   It injects its own styles, floating button and modal — no other
   markup needed. Works on terraoracle.io and draw.terraoracle.io.

   Sends feedback to the Oracle Eye worker (Telegram). Keeps all the
   original behaviour: bug/idea/other categories, custom label,
   screenshot attach + Ctrl+V paste + client-side compression,
   draggable button with saved position, JSON→FormData fallback.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__oracleEyeLoaded) return;        // guard against double-include
  window.__oracleEyeLoaded = true;

  var WORKER_URL = 'https://oracle-eye.vladislav-baydan.workers.dev/feedback';
  // Site label appended to the message (so Telegram shows where it came from)
  var SITE = (location.hostname.indexOf('draw.') === 0) ? 'draw.terraoracle.io' : 'terraoracle.io';

  var _fbType = 'bug';
  var _busy = false;
  var _oeDragging = false;

  /* ── Mascot phrases (no emojis) ──────────────────────────────── */
  var PHRASES = {
    open:   ["Hey! What's up?", "Got something for me?", "I'm all eyes"],
    bug:    ["Show me the bug", "What broke?"],
    idea:   ["Ooh, an idea!", "I'm listening"],
    other:  ["Go on, I'm listening"],
    sending:[". . ."],
    sent:   ["Thanks! Sent it", "Got it, thank you!"],
    error:  ["Hmm, try again"],
    empty:  ["Type something first"],
    hover:  ["Feedback?", "Spotted a bug?", "Share an idea?"]
  };
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* ── Styles ──────────────────────────────────────────────────── */
  var css = ''
    + '#oe-btn{position:fixed;right:24px;bottom:24px;width:102px;height:102px;border:none;background:none;cursor:grab;z-index:9998;padding:0;}'
    + '#oe-btn .oe-eye-wrap{width:102px;height:102px;}'
    + '#oe-bubble{position:fixed;z-index:9997;background:#16233f;border:1px solid rgba(84,147,247,0.4);border-radius:12px;padding:8px 13px;font-size:13px;color:#dce8ff;white-space:nowrap;font-family:inherit;opacity:0;transform:translateY(6px);transition:opacity .3s,transform .3s;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,0.4);}'
    + '#oe-bubble.show{opacity:1;transform:translateY(0);}'
    + '#oe-bubble:after{content:"";position:absolute;bottom:-7px;left:24px;width:12px;height:12px;background:#16233f;border-right:1px solid rgba(84,147,247,0.4);border-bottom:1px solid rgba(84,147,247,0.4);transform:rotate(45deg);}'
    + '#oe-overlay{position:fixed;inset:0;background:rgba(4,8,18,0.72);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;z-index:9999;}'
    + '#oe-overlay.open{display:flex;}'
    + '#oe-modal{width:340px;max-width:calc(100vw - 32px);background:#0c1322;border:1px solid rgba(84,147,247,0.25);border-radius:16px;padding:0 22px 22px;font-family:inherit;box-shadow:0 20px 60px rgba(0,0,0,0.5);}'
    + '#oe-eye-mount{display:flex;justify-content:center;margin-top:-26px;}'
    + '#oe-title{text-align:center;font-size:15px;font-weight:700;color:#fff;margin-top:4px;letter-spacing:0.02em;}'
    + '#oe-msg{text-align:center;font-size:12px;color:#9fb4d8;min-height:16px;margin:4px 0 14px;transition:opacity .25s;}'
    + '#oe-cats{display:flex;gap:7px;margin-bottom:12px;}'
    + '.oe-cat{flex:1;background:transparent;border:1px solid rgba(84,147,247,0.2);color:#9fb4d8;font-size:12px;padding:8px;border-radius:8px;cursor:pointer;font-family:inherit;transition:all .15s;}'
    + '.oe-cat.active{background:rgba(84,147,247,0.12);border-color:rgba(84,147,247,0.35);color:#7fb0ff;}'
    + '#oe-other{display:none;width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:11px;padding:7px 10px;margin-bottom:10px;outline:none;font-family:inherit;}'
    + '#oe-text{width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(84,147,247,0.2);border-radius:8px;color:#dce8ff;font-size:13px;padding:10px;min-height:70px;resize:none;outline:none;font-family:inherit;}'
    + '#oe-text:focus{border-color:rgba(84,147,247,0.5);}'
    + '#oe-text::placeholder{color:rgba(255,255,255,0.25);}'
    + '#oe-img-label{display:block;font-size:11px;color:rgba(255,255,255,0.35);padding:7px 12px;border:1px dashed rgba(255,255,255,0.15);border-radius:8px;text-align:center;cursor:pointer;margin:10px 0 12px;transition:all .2s;}'
    + '#oe-img-label:hover{border-color:rgba(84,147,247,0.4);color:#9fb4d8;}'
    + '#oe-img-prev{display:none;margin-bottom:12px;position:relative;}'
    + '#oe-img-prev img{width:100%;max-height:120px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,0.1);}'
    + '#oe-img-rm{position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.6);border:none;color:#fff;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:12px;line-height:1;}'
    + '#oe-foot{display:flex;gap:8px;margin-top:4px;}'
    + '#oe-cancel{flex:1;background:transparent;border:1px solid rgba(255,255,255,0.15);color:#9fb4d8;font-size:13px;padding:11px;border-radius:8px;cursor:pointer;font-family:inherit;}'
    + '#oe-send{flex:2;background:linear-gradient(135deg,#4178d4,#7b5cff);border:none;color:#fff;font-size:13px;font-weight:500;padding:11px;border-radius:8px;cursor:pointer;font-family:inherit;}'
    + '#oe-send:disabled{opacity:0.6;cursor:default;}'
    + '#oe-status{text-align:center;font-size:12px;margin-top:10px;min-height:16px;}';

  /* ── The Eye SVG-ish markup (sizes via .scale wrapper) ───────── */
  // size: button = 56, modal = 90 wide stage
  function eyeMarkup(scale) {
    // scale 1 ≈ 90px stage (modal). Button uses ~0.62.
    var W = Math.round(64 * scale), H = Math.round(84 * scale);
    var ballW = Math.round(54 * scale), ballH = Math.round(66 * scale);
    var irisS = Math.round(24 * scale), pupS = Math.round(10 * scale), shineS = Math.round(5 * scale);
    var baseW = Math.round(50 * scale), baseH = Math.round(20 * scale);
    return ''
      + '<div class="oe-bob" style="position:relative;width:' + W + 'px;height:' + H + 'px;">'
      +   '<div style="position:absolute;left:' + Math.round(7*scale) + 'px;top:' + Math.round(62*scale) + 'px;width:' + baseW + 'px;height:' + baseH + 'px;background:#0e1626;border:2px solid #1d2c44;border-radius:50%;"></div>'
      +   '<div class="oe-glow" style="position:absolute;left:' + Math.round(18*scale) + 'px;top:' + Math.round(67*scale) + 'px;width:' + Math.round(30*scale) + 'px;height:' + Math.round(7*scale) + 'px;border-radius:50%;background:#2d6cff;filter:blur(4px);opacity:.8;"></div>'
      +   '<div style="position:absolute;left:' + Math.round(5*scale) + 'px;top:0;width:' + ballW + 'px;height:' + ballH + 'px;border-radius:50% 50% 48% 48%;background:radial-gradient(circle at 38% 30%, #fdfdff 0%, #e3e9f5 45%, #c2ccdf 100%);border:2px solid #aeb8cc;overflow:hidden;box-shadow:0 0 14px rgba(70,130,255,0.4);">'
      +     '<div class="oe-iris" style="position:absolute;left:' + Math.round(15*scale) + 'px;top:' + Math.round(19*scale) + 'px;width:' + irisS + 'px;height:' + irisS + 'px;border-radius:50%;background:radial-gradient(circle at 40% 35%, #6db0ff 0%, #2f7be6 45%, #14346e 100%);border:2px solid #1a4ea0;transition:transform .45s cubic-bezier(.4,0,.2,1);">'
      +       '<div style="position:absolute;left:' + Math.round(6*scale) + 'px;top:' + Math.round(6*scale) + 'px;width:' + pupS + 'px;height:' + pupS + 'px;border-radius:50%;background:#0a1f45;"></div>'
      +       '<div style="position:absolute;left:' + Math.round(7*scale) + 'px;top:' + Math.round(4*scale) + 'px;width:' + shineS + 'px;height:' + shineS + 'px;border-radius:50%;background:#eaf3ff;"></div>'
      +     '</div>'
      +     '<div class="oe-lid" style="position:absolute;left:-2px;top:-2px;width:' + (ballW+2) + 'px;height:0;background:#c2ccdf;border-bottom:2px solid #aeb8cc;transition:height .12s ease;"></div>'
      +   '</div>'
      + '</div>';
  }

  /* ── Build DOM ───────────────────────────────────────────────── */
  function build() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.id = 'oe-btn';
    btn.title = 'Feedback & Bug Report';
    btn.innerHTML = '<div class="oe-eye-wrap" style="transform:scale(1.116);transform-origin:center;display:flex;align-items:center;justify-content:center;">' + eyeMarkup(1) + '</div>';
    document.body.appendChild(btn);

    var bubble = document.createElement('div');
    bubble.id = 'oe-bubble';
    document.body.appendChild(bubble);

    var overlay = document.createElement('div');
    overlay.id = 'oe-overlay';
    overlay.innerHTML = ''
      + '<div id="oe-modal">'
      +   '<div id="oe-eye-mount"><div style="width:90px;height:96px;display:flex;justify-content:center;">' + eyeMarkup(1) + '</div></div>'
      +   '<div id="oe-title">Oracle Eye</div>'
      +   '<div id="oe-msg"></div>'
      +   '<div id="oe-cats">'
      +     '<button class="oe-cat active" data-type="bug">Bug</button>'
      +     '<button class="oe-cat" data-type="idea">Idea</button>'
      +     '<button class="oe-cat" data-type="other">Other</button>'
      +   '</div>'
      +   '<input id="oe-other" type="text" placeholder="Custom label...">'
      +   '<textarea id="oe-text" placeholder="Describe the issue or idea..."></textarea>'
      +   '<label id="oe-img-label" for="oe-img">+ Attach or paste screenshot (Ctrl+V)</label>'
      +   '<input type="file" id="oe-img" accept="image/*" style="display:none;">'
      +   '<div id="oe-img-prev"><img id="oe-img-thumb"><button id="oe-img-rm" type="button">&times;</button></div>'
      +   '<div id="oe-foot">'
      +     '<button id="oe-cancel" type="button">Cancel</button>'
      +     '<button id="oe-send" type="button">Send</button>'
      +   '</div>'
      +   '<div id="oe-status"></div>'
      + '</div>';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);

    wireMascot();
    wireForm();
    wireDrag(btn);
  }

  /* ── Mascot animation ────────────────────────────────────────── */
  var _modalEye = {};
  function wireMascot() {
    var mount = document.querySelector('#oe-eye-mount');
    _modalEye.iris = mount.querySelector('.oe-iris');
    _modalEye.lid  = mount.querySelector('.oe-lid');
    _modalEye.bob  = mount.querySelector('.oe-bob');
    _modalEye.glow = mount.querySelector('.oe-glow');

    // Button eye (idle blink only)
    var bwrap = document.querySelector('#oe-btn');
    _btnEye.iris = bwrap.querySelector('.oe-iris');
    _btnEye.lid  = bwrap.querySelector('.oe-lid');
    _btnEye.glow = bwrap.querySelector('.oe-glow');

    // idle loops — modal eye
    setInterval(function () { if (!_busy && isOpen()) blink(_modalEye); }, 3600);
    var tk = 0;
    setInterval(function () { if (_busy || !isOpen()) return; tk++; moveIris(_modalEye, Math.sin(tk / 2) * 5, 0); }, 1500);
    setInterval(function () { if (_modalEye.glow) _modalEye.glow.style.opacity = (0.55 + Math.random() * 0.35).toFixed(2); }, 900);

    // idle loops — button eye (always, subtle)
    setInterval(function () { if (!isOpen()) blink(_btnEye); }, 4200);
    setInterval(function () { if (_btnEye.glow) _btnEye.glow.style.opacity = (0.5 + Math.random() * 0.35).toFixed(2); }, 1100);

    // ── Eye follows the cursor when it comes near the button ──
    var btnEl = document.querySelector('#oe-btn');
    var WATCH_RADIUS = 320;
    var MAX_OFFSET = 7;
    var btnIris = _btnEye.iris;
    var driftT = 0;
    var nearNow = false;

    if (btnIris) btnIris.style.transition = 'transform .15s ease-out';

    window.addEventListener('mousemove', function (e) {
      if (isOpen() || _oeDragging || !btnIris) return;
      var r = btnEl.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dx = e.clientX - cx, dy = e.clientY - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < WATCH_RADIUS) {
        nearNow = true;
        var len = dist || 1;
        btnIris.style.transition = 'transform .12s ease-out';
        btnIris.style.transform = 'translate(' + (dx / len * MAX_OFFSET).toFixed(1) + 'px,' + (dy / len * MAX_OFFSET).toFixed(1) + 'px)';
        if (_btnEye.glow) _btnEye.glow.style.opacity = '0.95';
      } else {
        nearNow = false;
      }
    });

    // gentle idle drift only when cursor is NOT near
    setInterval(function () {
      if (isOpen() || nearNow || !btnIris) return;
      driftT++;
      btnIris.style.transition = 'transform .8s ease-in-out';
      btnIris.style.transform = 'translate(' + (Math.sin(driftT / 2) * 3).toFixed(1) + 'px,' + (Math.cos(driftT / 3) * 2).toFixed(1) + 'px)';
    }, 1800);

    // ── Button speech bubble: on hover + occasionally while idle ──
    var btn = document.querySelector('#oe-btn');
    var bubble = document.querySelector('#oe-bubble');
    var bubbleTimer = null;

    function positionBubble() {
      var r = btn.getBoundingClientRect();
      // place bubble above the button, tail pointing down to it
      bubble.style.left = (r.left + 6) + 'px';
      bubble.style.top = (r.top - bubble.offsetHeight - 12) + 'px';
    }
    function showBubble(text, holdMs) {
      if (isOpen()) return;
      bubble.textContent = text;
      bubble.style.left = '-9999px'; bubble.style.top = '-9999px';
      bubble.classList.add('show');
      positionBubble();
      clearTimeout(bubbleTimer);
      if (holdMs) bubbleTimer = setTimeout(hideBubble, holdMs);
    }
    function hideBubble() { bubble.classList.remove('show'); }

    btn.addEventListener('mouseenter', function () { showBubble(pick(PHRASES.hover), 0); });
    btn.addEventListener('mouseleave', function () { hideBubble(); });

    // occasional idle greeting (when not hovered, not open)
    setInterval(function () {
      if (isOpen() || bubble.classList.contains('show')) return;
      if (Math.random() < 0.5) showBubble(pick(PHRASES.hover), 3000);
    }, 9000);

    window.addEventListener('resize', function () { if (bubble.classList.contains('show')) positionBubble(); });
    // keep bubble glued to button while dragging
    setInterval(function () { if (bubble.classList.contains('show')) positionBubble(); }, 200);
  }
  var _btnEye = {};

  function moveIris(eye, x, y) { if (eye.iris) eye.iris.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }
  function blink(eye) {
    if (!eye.lid) return;
    var ball = eye.lid.parentElement;
    eye.lid.style.height = (ball.offsetHeight) + 'px';
    setTimeout(function () { eye.lid.style.height = '0'; }, 130);
  }
  function react() {
    if (!_modalEye.bob) return Promise.resolve();
    var b = _modalEye.bob, n = 0;
    return new Promise(function (res) {
      var iv = setInterval(function () {
        b.style.transition = 'transform .1s'; b.style.transform = (n % 2 === 0) ? 'scale(1.1)' : 'scale(1)';
        n++; if (n > 5) { clearInterval(iv); b.style.transform = 'scale(1)'; res(); }
      }, 100);
    });
  }
  function say(text) {
    var el = document.querySelector('#oe-msg'); if (!el) return;
    el.style.opacity = '0';
    setTimeout(function () { el.textContent = text; el.style.opacity = '1'; }, 200);
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function isOpen() { var o = document.querySelector('#oe-overlay'); return o && o.classList.contains('open'); }

  /* ── Form logic ──────────────────────────────────────────────── */
  function wireForm() {
    document.querySelectorAll('.oe-cat').forEach(function (b) {
      b.addEventListener('click', function () { selectType(b, b.getAttribute('data-type')); });
    });
    document.querySelector('#oe-text').addEventListener('input', function () { if (!_busy) blink(_modalEye); });
    document.querySelector('#oe-img').addEventListener('change', function () { if (this.files[0]) attachImage(this.files[0], this.files[0].name); });
    document.querySelector('#oe-img-rm').addEventListener('click', removeImg);
    document.querySelector('#oe-cancel').addEventListener('click', closeModal);
    document.querySelector('#oe-send').addEventListener('click', submit);

    document.addEventListener('paste', function (e) {
      if (!isOpen()) return;
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
          var file = items[i].getAsFile();
          if (file) { attachImage(file, 'screenshot.png'); document.querySelector('#oe-img-label').textContent = 'Screenshot pasted'; e.preventDefault(); break; }
        }
      }
    });
  }

  function selectType(btn, type) {
    _fbType = type;
    document.querySelectorAll('.oe-cat').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    document.querySelector('#oe-other').style.display = (type === 'other') ? 'block' : 'none';
    if (type === 'bug') { say(pick(PHRASES.bug)); moveIris(_modalEye, 0, 8); setTimeout(function () { moveIris(_modalEye, 0, 0); }, 700); }
    else if (type === 'idea') { say(pick(PHRASES.idea)); react(); }
    else { say(pick(PHRASES.other)); }
  }

  function attachImage(file, name) {
    document.querySelector('#oe-img-label').textContent = (name || 'screenshot').slice(0, 30);
    var reader = new FileReader();
    reader.onload = function (e) {
      document.querySelector('#oe-img-thumb').src = e.target.result;
      document.querySelector('#oe-img-prev').style.display = 'block';
    };
    reader.readAsDataURL(file);
    try { var dt = new DataTransfer(); dt.items.add(file); document.querySelector('#oe-img').files = dt.files; } catch (e) {}
  }
  function removeImg() {
    document.querySelector('#oe-img').value = '';
    document.querySelector('#oe-img-prev').style.display = 'none';
    document.querySelector('#oe-img-label').textContent = '+ Attach or paste screenshot (Ctrl+V)';
  }

  function openModal() {
    document.querySelector('#oe-overlay').classList.add('open');
    say(pick(PHRASES.open));
    setTimeout(function () { document.querySelector('#oe-text').focus(); }, 100);
  }
  function closeModal() {
    document.querySelector('#oe-overlay').classList.remove('open');
    document.querySelector('#oe-text').value = '';
    document.querySelector('#oe-status').textContent = '';
    document.querySelectorAll('.oe-cat').forEach(function (b, i) { b.classList.toggle('active', i === 0); });
    _fbType = 'bug';
    removeImg();
    document.querySelector('#oe-other').style.display = 'none';
    var sb = document.querySelector('#oe-send'); sb.disabled = false; sb.textContent = 'Send';
  }

  async function submit() {
    if (_busy) return;
    var text = document.querySelector('#oe-text').value.trim();
    var status = document.querySelector('#oe-status');
    if (!text) { say(pick(PHRASES.empty)); return; }
    _busy = true;
    var btn = document.querySelector('#oe-send');
    btn.disabled = true; btn.textContent = 'Sending...';
    status.textContent = '';
    say(pick(PHRASES.sending));

    try {
      var wallet = (typeof connectedAddress !== 'undefined' && connectedAddress) ? connectedAddress
                 : (typeof globalWalletAddress !== 'undefined' && globalWalletAddress) ? globalWalletAddress
                 : 'anonymous';
      var custom = (document.querySelector('#oe-other').value || '').trim();
      var typeLabel = (_fbType === 'other' && custom) ? '[' + custom + ']'
                    : ({ bug: '[bug]', idea: '[idea]', other: '[other]' }[_fbType] || '[other]');
      var msg = typeLabel + ' *Oracle Feedback · ' + _fbType.toUpperCase() + '*\n\n' + text + '\n\n' + wallet + '\n' + SITE;

      var imgFile = document.querySelector('#oe-img').files[0];
      var imageBase64 = null, imageType = (imgFile && imgFile.type) || 'image/jpeg';
      if (imgFile) {
        imageBase64 = await compress(imgFile);
        imageType = 'image/jpeg';
      }

      var res;
      try {
        res = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg, image: imageBase64, imageType: imageType }),
        });
      } catch (fetchErr) {
        var fd = new FormData();
        fd.append('message', msg);
        if (imageBase64) { fd.append('image', imageBase64); fd.append('imageType', imageType); }
        res = await fetch(WORKER_URL, { method: 'POST', body: fd });
      }

      if (res && res.ok) {
        status.style.color = '#66ffaa';
        status.textContent = 'Sent! Thank you for your feedback.';
        say(pick(PHRASES.sent)); react();
        setTimeout(closeModal, 2000);
      } else {
        throw new Error('Server error ' + (res ? res.status : ''));
      }
    } catch (e) {
      status.style.color = '#ff6b6b';
      status.textContent = 'Failed to send. Try again.';
      say(pick(PHRASES.error));
      btn.disabled = false; btn.textContent = 'Send';
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

  /* ── Draggable button (saved position, click vs drag) ────────── */
  function wireDrag(btn) {
    var isDragging = false, justDragged = false;
    var startX = 0, startY = 0, startLeft = 0, startTop = 0;
    btn.style.cursor = 'grab';

    try {
      var saved = JSON.parse(localStorage.getItem('oe-btn-pos') || 'null');
      if (saved && saved.left && saved.top) {
        btn.style.left = saved.left; btn.style.top = saved.top;
        btn.style.bottom = 'auto'; btn.style.right = 'auto';
      }
    } catch (e) {}

    btn.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      isDragging = true; justDragged = false; _oeDragging = true;
      var rect = btn.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top; startX = e.clientX; startY = e.clientY;
      btn.style.left = startLeft + 'px'; btn.style.top = startTop + 'px';
      btn.style.bottom = 'auto'; btn.style.right = 'auto';
      btn.style.transition = 'none'; btn.style.cursor = 'grabbing';
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!isDragging) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) justDragged = true;
      btn.style.left = Math.max(0, Math.min(window.innerWidth - 110, startLeft + dx)) + 'px';
      btn.style.top  = Math.max(0, Math.min(window.innerHeight - 110, startTop + dy)) + 'px';
    });
    window.addEventListener('mouseup', function () {
      if (!isDragging) return;
      isDragging = false; _oeDragging = false; btn.style.cursor = 'grab'; btn.style.transition = '';
      if (justDragged) {
        try { localStorage.setItem('oe-btn-pos', JSON.stringify({ left: btn.style.left, top: btn.style.top })); } catch (e) {}
      } else { openModal(); }
      justDragged = false;
    });

    btn.addEventListener('touchstart', function (e) {
      isDragging = true; justDragged = false; _oeDragging = true;
      var t = e.touches[0]; var rect = btn.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top; startX = t.clientX; startY = t.clientY;
      btn.style.left = startLeft + 'px'; btn.style.top = startTop + 'px';
      btn.style.bottom = 'auto'; btn.style.right = 'auto'; btn.style.transition = 'none';
    }, { passive: true });
    window.addEventListener('touchmove', function (e) {
      if (!isDragging) return;
      var t = e.touches[0]; var dx = t.clientX - startX, dy = t.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) justDragged = true;
      btn.style.left = Math.max(0, Math.min(window.innerWidth - 110, startLeft + dx)) + 'px';
      btn.style.top  = Math.max(0, Math.min(window.innerHeight - 110, startTop + dy)) + 'px';
      if (justDragged) e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchend', function () {
      if (!isDragging) return;
      isDragging = false; _oeDragging = false; btn.style.transition = '';
      if (justDragged) {
        try { localStorage.setItem('oe-btn-pos', JSON.stringify({ left: btn.style.left, top: btn.style.top })); } catch (e) {}
      } else { openModal(); }
      justDragged = false;
    });
  }

  /* ── Init ────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }

  // Expose a couple of helpers (optional external use)
  window.OracleEye = { open: openModal, close: closeModal };
})();
