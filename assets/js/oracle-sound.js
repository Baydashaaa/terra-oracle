/* Terra Oracle - UI sound (assets/js/oracle-sound.js)
   All sounds are synthesized with the Web Audio API, no audio files.

   Markup:
     <button data-sound-toggle></button>      on/off toggle (icon is filled in automatically)
     <a data-sound="nav">...</a>              explicit sound for this element
     <button data-sound="none">...</button>   silent element
     <div data-sound-hover>...</div>          quiet hover tick (desktop only)
     any other button / a[href] / [role=button] plays "click" by default

   Code:
     OracleSound.play('success')   connect | success | error | notify | win | zap | coin | levelup | click | nav
     OracleSound.tick(secondsLeft) countdown ticks, only for the last 10 seconds
     OracleSound.setEnabled(true|false), OracleSound.setVolume(0..1)
*/
(function () {
  'use strict';

  const STORE_KEY = 'oracle-sound';
  const AUTO_CLICK = true;   // default "click" on every button/link without data-sound
  const THROTTLE_MS = 80;    // same sound no more often than this

  // ---------- settings ----------
  let settings = { enabled: true, volume: 0.3 };
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && typeof s === 'object') settings = { ...settings, ...s };
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) {}
  }
  load();

  // ---------- audio graph ----------
  let ctx = null, master = null, dry = null, wet = null, noiseBuf = null;
  let unlocked = false;

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = settings.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    dry = ctx.createGain();
    dry.connect(master);

    // light "space" reverb from a generated impulse
    const verb = ctx.createConvolver();
    verb.buffer = impulse(1.8, 2.6);
    wet = ctx.createGain();
    wet.gain.value = 0.35;
    wet.connect(verb).connect(master);
    return ctx;
  }

  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function out(node, send) {
    node.connect(dry);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      node.connect(s).connect(wet);
    }
  }

  function tone(freq, dur, o = {}) {
    const t = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const peak = o.gain != null ? o.gain : 0.15;
    const a = Math.min(o.attack != null ? o.attack : 0.005, dur * 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    out(g, o.send != null ? o.send : 0.15);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, o = {}) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.Q.value = o.q != null ? o.q : 1.2;
    f.frequency.setValueAtTime(o.from || 800, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = ctx.createGain();
    const peak = o.gain != null ? o.gain : 0.08;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    out(g, o.send != null ? o.send : 0.2);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  const hz = m => 440 * Math.pow(2, (m - 69) / 12); // MIDI note -> Hz (72 = C5)

  // ---------- sound map ----------
  const SOUNDS = {
    click() {
      tone(880, 0.07, { to: 1320, gain: 0.1, send: 0.08 });
    },
    hover() {
      tone(1760, 0.035, { gain: 0.025, send: 0 });
    },
    nav() {
      noise(0.22, { from: 400, to: 3000, gain: 0.06 });
      tone(523, 0.12, { to: 784, gain: 0.05, delay: 0.03 });
    },
    connect() {
      [72, 76, 79].forEach((m, i) =>
        tone(hz(m), 0.5, { type: 'triangle', gain: 0.09, delay: i * 0.07, send: 0.3 }));
    },
    success() {
      [76, 80, 83, 88].forEach((m, i) =>
        tone(hz(m), 0.45, { gain: 0.08, delay: i * 0.06, send: 0.4 }));
      tone(hz(100), 0.6, { gain: 0.02, delay: 0.24, send: 0.6 });
    },
    error() {
      tone(330, 0.22, { to: 196, type: 'triangle', gain: 0.12, send: 0.1 });
      tone(247, 0.3, { to: 147, type: 'triangle', gain: 0.1, delay: 0.14, send: 0.1 });
    },
    notify() {
      tone(1318.5, 1.1, { gain: 0.08, send: 0.35 });
      tone(1318.5 * 2.76, 0.6, { gain: 0.025, send: 0.35 });
      tone(1975.5, 0.9, { gain: 0.04, delay: 0.12, send: 0.35 });
    },
    tick() {
      tone(1800, 0.025, { type: 'square', gain: 0.025, send: 0 });
    },
    tickFinal() {
      tone(2400, 0.04, { type: 'square', gain: 0.035, send: 0.05 });
    },
    win() {
      [72, 76, 79, 84, 88, 91].forEach((m, i) =>
        tone(hz(m), 0.5, { type: 'triangle', gain: 0.08, delay: i * 0.08, send: 0.4 }));
      [72, 76, 79, 84].forEach(m =>
        tone(hz(m), 1.6, { gain: 0.05, attack: 0.05, delay: 0.5, send: 0.5 }));
      for (let i = 0; i < 10; i++)
        tone(hz(96 + Math.floor(Math.random() * 12)), 0.25, { gain: 0.02, delay: 0.55 + i * 0.07, send: 0.7 });
    },
    zap() {
      tone(1600, 0.16, { to: 90, type: 'sawtooth', gain: 0.06, send: 0.15 });
      noise(0.1, { filter: 'highpass', from: 3000, gain: 0.05 });
    },
    coin() {
      tone(hz(83), 0.08, { type: 'square', gain: 0.05, send: 0.1 });
      tone(hz(88), 0.35, { type: 'square', gain: 0.05, delay: 0.07, send: 0.2 });
    },
    levelup() {
      [72, 79, 84].forEach((m, i) =>
        tone(hz(m), 0.3, { type: 'triangle', gain: 0.08, delay: i * 0.09, send: 0.3 }));
      tone(hz(91), 0.6, { gain: 0.05, delay: 0.27, send: 0.5 });
    }
  };

  // ---------- playback ----------
  const last = {};
  function play(name) {
    if (!settings.enabled || document.hidden) return;
    const fn = SOUNDS[name];
    if (!fn || !init()) return;
    if (ctx.state !== 'running') {
      if (!unlocked) return; // no user gesture yet: browser would queue it and burst later
      ctx.resume();
    }
    const now = performance.now();
    if (last[name] && now - last[name] < THROTTLE_MS) return;
    last[name] = now;
    try { fn(); } catch (e) { console.warn('[oracle-sound]', e); }
  }

  function tick(secondsLeft) {
    const s = Math.ceil(secondsLeft);
    if (s < 1 || s > 10) return;
    play(s <= 3 ? 'tickFinal' : 'tick');
  }

  function unlock() {
    unlocked = true;
    if (settings.enabled && init() && ctx.state === 'suspended') ctx.resume();
  }
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  document.addEventListener('keydown', unlock, { capture: true });

  // delegated click sounds
  document.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    const el = e.target.closest('[data-sound]');
    if (el) {
      const n = el.dataset.sound;
      if (n && n !== 'none') play(n);
      return;
    }
    if (AUTO_CLICK && e.target.closest('button, a[href], [role="button"]')) play('click');
  }, true);

  // hover ticks, only with a real mouse
  if (window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.addEventListener('pointerover', e => {
      if (!unlocked || !(e.target instanceof Element)) return;
      const el = e.target.closest('[data-sound-hover]');
      if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
      play('hover');
    });
  }

  // ---------- toggle ----------
  const SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  const SPEAKER = '<path d="M4 9v6h4l5 4V5L8 9H4z"/>';
  const ICON_ON = SVG + SPEAKER + '<path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const ICON_OFF = SVG + SPEAKER + '<path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>';

  function renderToggle(btn) {
    const on = settings.enabled;
    btn.innerHTML = on ? ICON_ON : ICON_OFF;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    btn.title = on ? 'Sound on' : 'Sound off';
    btn.classList.toggle('is-muted', !on);
  }

  function mount() {
    document.querySelectorAll('[data-sound-toggle]').forEach(btn => {
      if (btn._osMounted) return;
      btn._osMounted = true;
      btn.dataset.sound = 'none';
      if (btn.tagName === 'BUTTON') btn.type = 'button';
      renderToggle(btn);
      btn.addEventListener('click', () => setEnabled(!settings.enabled));
    });
  }

  function setEnabled(v) {
    settings.enabled = !!v;
    save();
    document.querySelectorAll('[data-sound-toggle]').forEach(renderToggle);
    if (settings.enabled) { unlock(); play('click'); }
  }

  function setVolume(v) {
    settings.volume = Math.max(0, Math.min(1, Number(v) || 0));
    save();
    if (master) master.gain.setTargetAtTime(settings.volume, ctx.currentTime, 0.02);
  }

  // keep several open tabs in sync
  window.addEventListener('storage', e => {
    if (e.key !== STORE_KEY) return;
    load();
    document.querySelectorAll('[data-sound-toggle]').forEach(renderToggle);
    if (master) master.gain.setTargetAtTime(settings.volume, ctx.currentTime, 0.02);
  });

  const style = document.createElement('style');
  style.textContent =
    '[data-sound-toggle] svg{display:block}' +
    '[data-sound-toggle].is-muted{opacity:.55}';
  document.head.appendChild(style);

  // auto-place the toggle right before the notifications bell (oracle-notify.js builds it later)
  function autoPlace() {
    const bell = document.getElementById('onf-bell');
    if (!bell) return;
    const host = bell.closest('.onf-wrap') || bell;
    const prev = host.previousElementSibling;
    if (prev && prev.classList.contains('osd-auto')) return;
    document.querySelectorAll('.osd-auto').forEach(b => b.remove());
    const btn = document.createElement('button');
    btn.className = 'onf-bell osd-auto';
    btn.setAttribute('data-sound-toggle', '');
    host.parentNode.insertBefore(btn, host);
    mount();
  }
  let placeQueued = false;
  new MutationObserver(() => {
    if (placeQueued) return;
    placeQueued = true;
    requestAnimationFrame(() => { placeQueued = false; autoPlace(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  autoPlace();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  // hook: wallet connected (wrapped the same way page/mobile-nav.js does it)
  window.addEventListener('load', () => {
    const orig = window.setWalletConnected;
    if (typeof orig !== 'function' || orig._osWrapped) return;
    const wrapped = function (address) {
      const r = orig.apply(this, arguments);
      if (address) play('connect');
      return r;
    };
    wrapped._osWrapped = true;
    window.setWalletConnected = wrapped;
  });

  // hooks: contract txs (contract-exec.js) - error on reject, success/error on confirmation
  window.addEventListener('load', () => {
    const send = window.sendExecuteContract;
    if (typeof send === 'function' && !send._osWrapped) {
      const w = function () {
        return send.apply(this, arguments).catch(e => { play('error'); throw e; });
      };
      w._osWrapped = true;
      window.sendExecuteContract = w;
    }
    const wait = window.waitForTx;
    if (typeof wait === 'function' && !wait._osWrapped) {
      const w = function () {
        return wait.apply(this, arguments).then(r => {
          if (r && r.status === 'confirmed') play('success');
          else if (r && r.status === 'failed') play('error');
          return r;
        });
      };
      w._osWrapped = true;
      window.waitForTx = w;
    }
  });

  // hooks: plain LUNC payments (app/sign.js) - success when sent, error on reject
  window.addEventListener('load', () => {
    ['sendLuncDirect', 'sendTwoMsgsDirect'].forEach(name => {
      const fn = window[name];
      if (typeof fn !== 'function' || fn._osWrapped) return;
      const w = function () {
        return Promise.resolve(fn.apply(this, arguments)).then(
          r => { play('success'); return r; },
          e => { play('error'); throw e; }
        );
      };
      w._osWrapped = true;
      window[name] = w;
    });
  });

  window.OracleSound = {
    play, tick, setEnabled, setVolume, mount,
    get enabled() { return settings.enabled; },
    get volume() { return settings.volume; },
    sounds: Object.keys(SOUNDS)
  };
})();
