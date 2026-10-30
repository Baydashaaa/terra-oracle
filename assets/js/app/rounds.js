/**
 * rounds.js - пятиминутные раунды "вверх или вниз" (контракт oracle-rounds).
 *
 * Вид - по образцу predict.fun: карточки активов (цель, текущая цена,
 * сколько осталось), под ними экран раунда с графиком против цели, лентой
 * раундов и панелью прогноза. Те же карточки - на главной.
 *
 * Прогноз принимается на следующий раунд, пока идёт текущий. Цену старта и
 * конца пишет керпер (oracle-rounds-keeper). Живая цена - из markets-live.js.
 * Загружать ПОСЛЕ markets.js и markets-live.js.
 */
(function () {
  'use strict';

  const NET = (typeof PROPHECY_TESTNET !== 'undefined' && PROPHECY_TESTNET)
    ? { contract: 'terra1erumnyvvtjkxkgedwrasuefhczetzd2qcdms650g76f3dq658qlsu3fw99', houseMax: 500 }
    : { contract: '', houseMax: 50000 };   // mainnet: адрес появится после деплоя
  // houseMax - потолок ответной ставки казны (MATCH_MAX_ULUNA у керпера), LUNC.
  if (!NET.contract) return;

  const ASSETS = [
    { id: 'BTC', sym: 'BTC', name: 'Bitcoin', color: '#F7931A' },
    { id: 'ETH', sym: 'ETH', name: 'Ethereum', color: '#8C8CFF' },
    { id: 'LUNC', sym: 'LUNC', name: 'Terra Classic', color: '#F2D45C' },
    { id: 'PAXG', sym: 'Gold', name: 'Gold', color: '#E9C46A' },
  ];

  // Монеты: LUNC - картинка сайта, остальные - векторные, в одной манере:
  // объёмный круг с бликом и ободком.
  let coinN = 0;
  function coin(id, size) {
    if (id === 'LUNC') return `<img class="coin" src="assets/img/lunc.webp" alt="" width="${size}" height="${size}">`;
    const n = ++coinN;
    const base = {
      BTC: ['#FFC266', '#F7931A', '#C46A00'],
      ETH: ['#A9B0FF', '#6C72E8', '#3B3FA8'],
      PAXG: ['#5A4618', '#33280E', '#171106'],
    }[id];
    const glyph = id === 'BTC'
      ? `<text x="32" y="44" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="34" fill="#fff" transform="rotate(14 32 32)">\u20bf</text>`
      : id === 'ETH'
        ? `<g fill="#fff"><path d="M32 10 18.5 32.4 32 40.4l13.5-8z" opacity=".95"/><path d="M32 10v30.4l13.5-8z" opacity=".7"/><path d="M32 43 18.5 35 32 54l13.5-19z" opacity=".95"/><path d="M32 43v11l13.5-19z" opacity=".7"/></g>`
        : `<defs><linearGradient id="cg${n}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE9A3"/><stop offset=".55" stop-color="#E9B949"/><stop offset="1" stop-color="#A9761A"/></linearGradient></defs>
           <path d="M15 42h34l-5-14H20z" fill="url(#cg${n}b)"/><path d="M20 28h24l-2.6-7H22.6z" fill="url(#cg${n}b)" opacity=".9"/>
           <path d="M15 42h34l-1.2 3H16.2z" fill="#8A5E12"/><path d="M22 30h20" stroke="#FFF4CC" stroke-width="1.4" opacity=".7"/>`;
    return `<svg class="coin" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
      <defs><radialGradient id="cg${n}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="${base[0]}"/><stop offset=".6" stop-color="${base[1]}"/><stop offset="1" stop-color="${base[2]}"/></radialGradient></defs>
      <circle cx="32" cy="32" r="30" fill="url(#cg${n})"/>
      <circle cx="32" cy="32" r="28.5" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1.5"/>
      <ellipse cx="24" cy="16" rx="13" ry="6" fill="#fff" opacity=".18" transform="rotate(-20 24 16)"/>
      ${glyph}</svg>`;
  }

  // Таймер по цифре в ячейке фиксированной ширины: у шрифта сайта цифры
  // разной ширины, и время прыгало при смене секунд.
  const digits = (str) => [...str].map((c) => (c === ':' ? '<span class="sep">:</span>' : `<span class="dg">${c}</span>`)).join('');
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let cfg = null;
  let asset = 'BTC';
  let side = null;            // true - UP, false - DOWN
  let amount = 0;             // LUNC
  const rounds = {};          // asset -> последние раунды, новые первыми
  let positions = {};         // asset -> [PositionResponse]
  let busy = false;
  let state = 'loading';      // loading | ok | down

  const now = () => Date.now() / 1000;
  const live = () => window._mkLive || null;
  const fmtUsd = (p) => (p == null ? '-' : live() ? live().fmtUsd(p) : '$' + p);
  const lunc = (u) => (typeof fmtLunc === 'function' ? fmtLunc(u) : String(Number(u) / 1e6));
  const wallet = () => (typeof mkWallet === 'function' ? mkWallet() : null);
  const toast = (m, k) => (typeof mkToast === 'function' ? mkToast(m, k) : alert(m));
  const A = (id) => ASSETS.find((a) => a.id === id);

  // Тестовый LCD не отдаёт CORS: браузер его не читает. Тогда идём через
  // keeper-Worker (/q - только чтение и только этот контракт). Что сработало
  // первым, то и запоминаем.
  const PROXY = 'https://oracle-rounds-keeper.vladislav-baydan.workers.dev/q?m=';
  // На тестнете прямой узел без CORS: каждый запрос ждал таймаута 10 с, прежде
  // чем уйти на Worker. Там сразу идём через Worker.
  let viaProxy = PROPHECY_LCD.some((u) => /luncblaze/.test(u));
  async function q(msg) {
    const b64 = btoa(JSON.stringify(msg));
    if (viaProxy) {
      try {
        const r = await fetch(PROXY + encodeURIComponent(b64), { signal: AbortSignal.timeout(10000) });
        const j = await r.json();
        if (r.ok) return j.data;
      } catch (e) { /* ниже - прямой узел */ }
    }
    let last;
    for (const base of PROPHECY_LCD) {
      try {
        const r = await fetch(`${base}/cosmwasm/wasm/v1/contract/${NET.contract}/smart/${encodeURIComponent(b64)}`,
          { signal: AbortSignal.timeout(10000) });
        if (r.ok) return (await r.json()).data;
        last = new Error(`${base} ${r.status}`);
      } catch (e) { last = e; }
    }
    if (!viaProxy) {
      try {
        const r = await fetch(PROXY + encodeURIComponent(b64), { signal: AbortSignal.timeout(10000) });
        const j = await r.json();
        if (r.ok) { viaProxy = true; return j.data; }
        last = new Error(j.error || 'proxy ' + r.status);
      } catch (e) { last = e; }
    }
    console.warn('[rounds] query failed', msg, last);
    throw last || new Error('rounds unavailable');
  }

  const R = () => (cfg ? cfg.round_secs : 300);
  const epochNow = () => Math.floor(now() / R());
  const hm = (t) => new Date(t * 1000).toTimeString().slice(0, 5);
  const mmss = (s) => { s = Math.max(0, Math.floor(s)); return [Math.floor(s / 60), s % 60].map((x) => String(x).padStart(2, '0')); };
  const liveRound = (a) => (rounds[a] || []).find((r) => r.epoch === epochNow());
  const nextRound = (a) => (rounds[a] || []).find((r) => r.epoch === epochNow() + 1)
    || { epoch: epochNow() + 1, up: '0', down: '0', up_count: 0, down_count: 0 };
  const lockOf = (a) => { const r = liveRound(a); return r && r.lock_price ? Number(r.lock_price) : null; };
  const priceOf = (a) => { const f = live() && live().feeds[a]; return f && f.last != null ? f.last : null; };

  /** Выплата при победе. Пустую сторону за минуту до старта закрывает казна
   *  той же суммой (до houseMax), поэтому соперник есть всегда. */
  function estimate(r, up, amtU) {
    const mine = BigInt(up ? r.up : r.down) + amtU;
    let other = BigInt(up ? r.down : r.up);
    if (!other) {
      const cap = BigInt(NET.houseMax) * 1000000n;
      other = mine < cap ? mine : cap;
    }
    if (!other || !amtU) return null;
    const fee = BigInt(cfg ? cfg.fee_bps : 300);
    return amtU + ((other - (other * fee) / 10000n) * amtU) / mine;
  }

  // ── карточка актива (раздел и главная) ───────────────────────────────────
  function cardHtml(a, sel) {
    // Свой id градиента у каждой карточки: если ссылаться на градиент из
    // скрытой страницы, Chrome его не рисует.
    const gid = 'rdcf' + (++coinN);
    return `<button type="button" class="rdc" data-a="${a.id}" aria-pressed="${!!sel}" style="--ac:${a.color}">
      <span class="rdc-h">${coin(a.id, 34)}<span class="tt"><b>${a.sym} Up or Down</b><small>${a.name}</small></span><em>5 min</em></span>
      <svg class="rdc-sp" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
        <path class="sa" fill="url(#${gid})"/><path class="sl"/></svg>
      <span class="rdc-f">
        <span><small>Target</small><b class="t">-</b></span>
        <span><small>Current</small><b class="c">-</b></span>
        <span class="r"><small>Time left</small><b class="tl">--:--</b></span>
      </span>
    </button>`;
  }

  function paintCards(root) {
    root.querySelectorAll('.rdc').forEach((card) => {
      const a = card.dataset.a;
      const lock = lockOf(a), p = priceOf(a);
      card.querySelector('.t').textContent = lock ? fmtUsd(lock) : '-';
      const c = card.querySelector('.c');
      c.textContent = fmtUsd(p);
      card.classList.toggle('is-up', !!(lock && p && p > lock));
      card.classList.toggle('is-dn', !!(lock && p && p < lock));
      const [m, s] = mmss((epochNow() + 1) * R() - now());
      const lEl = card.querySelector('.tl');
      if (lEl.dataset.v !== m + s) { lEl.dataset.v = m + s; lEl.innerHTML = digits(`${m}:${s}`); }
      const f = live() && live().feeds[a];
      if (f && f.pts.length > 1) {
        const pts = f.pts.slice(-120);
        let lo = Infinity, hi = -Infinity;
        pts.forEach((q2) => { lo = Math.min(lo, q2[1]); hi = Math.max(hi, q2[1]); });
        const rng = hi - lo || 1;
        const d = pts.map((q2, i) =>
          (i ? 'L' : 'M') + (i / (pts.length - 1) * 100).toFixed(1) + ',' + (27 - ((q2[1] - lo) / rng) * 24).toFixed(1)).join(' ');
        card.querySelector('.rdc-sp .sl').setAttribute('d', d);
        card.querySelector('.rdc-sp .sa').setAttribute('d', d + ' L100,30 L0,30 Z');
      }
    });
  }

  // ── экран раунда ─────────────────────────────────────────────────────────
  function shell() {
    return `
      <section class="rd" id="rd" aria-label="Five-minute rounds">
        <div class="rd-cards">${ASSETS.map((a) => cardHtml(a, a.id === asset)).join('')}</div>
        <div class="rd-main">
          <div class="rd-box rd-left">
            <header class="rd-head">
              <span class="ic"></span>
              <div><h3></h3><span class="range"></span></div>
              <span class="rd-live"><i></i>Live</span>
            </header>
            <div class="rd-figs">
              <div><small>Price to beat</small><b class="lock">-</b><span class="sub lsub"></span></div>
              <div><small>Current price</small><b class="cur">-</b><span class="dl"></span></div>
              <div class="rd-clock">
                <span class="u"><b class="mm"></b><small>Min</small></span>
                <span class="colon">:</span>
                <span class="u"><b class="ss"></b><small>Sec</small></span>
              </div>
            </div>
            <div class="rd-plot">
              <div class="rd-chart">
                <svg viewBox="0 0 600 180" preserveAspectRatio="none" aria-hidden="true">
                  <defs><linearGradient id="rdArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
                  <path class="area" fill="url(#rdArea)"/><line class="tline" x1="0" x2="600"/><path class="line"/></svg>
                <span class="head"></span>
                <p class="rd-empty">Loading price…</p>
              </div>
              <div class="rd-yax"><span></span><span></span><span></span><em class="tpill">Target</em></div>
            </div>
            <div class="rd-x"><span></span><span></span><span></span></div>
            <div class="rd-strip" aria-label="Recent rounds"></div>
          </div>
          <div class="rd-box rd-right">
            <div class="rd-next"><b>Next round</b><span class="nrange"></span></div>
            <p class="rd-note">Predictions for the next round close when it starts. The price at that moment is its target.</p>
            <div class="rd-sides">
              <button type="button" class="up" data-s="1"><b>UP</b><span class="p">50%</span></button>
              <button type="button" class="dn" data-s="0"><b>DOWN</b><span class="p">50%</span></button>
            </div>
            <div class="rd-tap"><span>One-tap amount</span></div>
            <div class="rd-chips"></div>
            <label class="rd-amt"><span>Or type</span><input type="text" inputmode="numeric" placeholder="0" autocomplete="off"><em>LUNC</em></label>
            <button type="button" class="rd-go" disabled>Pick UP or DOWN</button>
            <div class="rd-pool"></div>
            <p class="rd-house"></p>
            <div class="rd-mine"></div>
          </div>
        </div>
      </section>`;
  }

  function mount() {
    if (document.getElementById('rd')) return;
    const anchor = document.getElementById('mkStats');
    if (!anchor) return;
    anchor.insertAdjacentHTML('beforebegin', shell());
    const el = document.getElementById('rd');
    el.querySelector('.rd-cards').addEventListener('click', (e) => {
      const b = e.target.closest('.rdc');
      if (b) select(b.dataset.a);
    });
    el.querySelector('.rd-sides').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-s]');
      if (!b) return;
      side = b.dataset.s === '1';
      paintBet();
    });
    el.querySelector('.rd-chips').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      amount = Number(b.dataset.v);
      el.querySelector('.rd-amt input').value = amount.toLocaleString('en-US');
      el.querySelectorAll('.rd-chips button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      paintBet();
    });
    el.querySelector('.rd-amt input').addEventListener('input', (e) => {
      amount = Number(String(e.target.value).replace(/[^0-9]/g, '')) || 0;
      el.querySelectorAll('.rd-chips button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      paintBet();
    });
    el.querySelector('.rd-go').addEventListener('click', submit);
    el.querySelector('.rd-mine').addEventListener('click', (e) => { if (e.target.closest('.rd-collect')) collect(); });
    paintHead();
  }

  function select(a) {
    asset = a;
    document.querySelectorAll('#rd .rdc').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.a === a)));
    const el = document.getElementById('rd');
    if (el) el.querySelector('.rd-strip').innerHTML = '';
    paintHead(); paintBet(); paintStrip();
  }

  function paintHead() {
    const el = document.getElementById('rd');
    if (!el) return;
    const a = A(asset);
    el.querySelector('.rd-head .ic').innerHTML = coin(a.id, 44);
    el.querySelector('.rd-head h3').textContent = `${a.name} Up or Down · 5 min`;
    const e0 = epochNow();
    el.querySelector('.range').textContent = `${hm(e0 * R())} - ${hm((e0 + 1) * R())}`;
  }

  function paintChips() {
    const host = document.querySelector('#rd .rd-chips');
    if (!host) return;
    const min = cfg ? Number(cfg.min_bet) / 1e6 : 1000, max = cfg ? Number(cfg.max_bet) / 1e6 : 1e6;
    // mainnet: минимум 1,000 LUNC - пресеты как у рынков. На тестнете минимум
    // меньше, и пресеты масштабируются от него.
    const base = min >= 1000 ? [10000, 50000, 200000, 500000] : [min, min * 5, min * 20, min * 50];
    const r = nextRound(asset);
    host.innerHTML = base.filter((v) => v >= min && v <= max).map((v) => {
      const amtU = BigInt(v) * 1000000n;
      const est = side === null ? null : estimate(r, side, amtU);
      return `<button type="button" data-v="${v}" aria-pressed="${amount === v}">
        <b>${v >= 1000 ? v / 1000 + 'K' : v}</b><small>${est ? 'Win ' + lunc(est) : side === null ? 'LUNC' : 'Win -'}</small></button>`;
    }).join('');
  }

  function paintBet() {
    const el = document.getElementById('rd');
    if (!el) return;
    if (!cfg) { paintChips(); return; }
    const r = nextRound(asset);
    const u = Number(r.up), d = Number(r.down);
    const p = u + d ? Math.round((u / (u + d)) * 100) : 50;
    const [up, dn] = el.querySelectorAll('.rd-sides button');
    up.setAttribute('aria-pressed', String(side === true));
    dn.setAttribute('aria-pressed', String(side === false));
    up.querySelector('.p').textContent = p + '%';
    dn.querySelector('.p').textContent = (100 - p) + '%';
    el.querySelector('.nrange').textContent = `${hm(r.epoch * R())} - ${hm((r.epoch + 1) * R())}`;
    el.querySelector('.rd-pool').innerHTML = `<span>UP pool <b>${lunc(r.up)}</b></span><span>DOWN pool <b>${lunc(r.down)}</b></span>`;
    // Одна сторона пустая - казна закроет её за минуту до старта.
    const empty = u && !d ? 'DOWN' : d && !u ? 'UP' : !u && !d ? 'the other side' : '';
    const houseAt = hm(r.epoch * R() - 60);
    el.querySelector('.rd-house').textContent = empty
      ? `Nobody on ${empty} yet. At ${houseAt} the house takes it with the same amount, up to ${NET.houseMax.toLocaleString('en-US')} LUNC.`
      : '';
    paintChips();

    const go = el.querySelector('.rd-go');
    const min = Number(cfg.min_bet) / 1e6, max = Number(cfg.max_bet) / 1e6;
    const closing = r.epoch * R() - now() < 10;
    go.className = 'rd-go' + (side === true ? ' up' : side === false ? ' dn' : '');
    if (side === null) { go.disabled = true; go.textContent = 'Pick UP or DOWN'; return; }
    if (!amount) { go.disabled = true; go.textContent = 'Choose an amount'; return; }
    if (amount < min || amount > max) {
      go.disabled = true; go.textContent = `${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')} LUNC per side`; return;
    }
    const est = estimate(r, side, BigInt(Math.round(amount)) * 1000000n);
    go.disabled = busy || closing;
    go.textContent = busy ? 'Waiting for the block…' : closing ? 'Next round opens in a moment'
      : `Predict ${side ? 'UP' : 'DOWN'} · ${amount.toLocaleString('en-US')} LUNC${est ? ` · win ≈ ${lunc(est)}` : ''}`;
  }

  function paintStrip() {
    const host = document.querySelector('#rd .rd-strip');
    if (!host) return;
    const e0 = epochNow();
    const list = (rounds[asset] || []).filter((r) => r.epoch < e0).slice(0, 4).reverse();
    const pill = (r) => {
      const o = r.outcome;
      const cls = o === 'up' ? 'up' : o === 'down' ? 'dn' : o === 'void' ? 'void' : 'wait';
      const mark = o === 'up' ? '\u25b2' : o === 'down' ? '\u25bc' : o === 'void' ? '\u21ba' : '\u2026';
      const tip = r.lock_price && r.close_price ? `${fmtUsd(Number(r.lock_price))} to ${fmtUsd(Number(r.close_price))}` : o === 'void' ? 'refunded' : 'settling';
      return `<span class="p ${cls}" title="${tip}"><i>${mark}</i>${hm(r.epoch * R())}</span>`;
    };
    host.innerHTML = list.map(pill).join('')
      + `<span class="p now"><i></i>Live ${hm(e0 * R())}</span>`
      + `<span class="p next">${hm((e0 + 1) * R())}</span>`;
  }

  function paintMine() {
    const host = document.querySelector('#rd .rd-mine');
    if (!host) return;
    if (!wallet()) { host.innerHTML = ''; return; }
    const all = [];
    Object.entries(positions).forEach(([a, list]) => (list || []).forEach((p) => all.push({ ...p, asset: a })));
    const due = all.filter((p) => !p.claimed && Number(p.payout) > 0);
    const open = all.filter((p) => ['accepting', 'live', 'closing'].includes(p.outcome));
    const total = due.reduce((s, p) => s + Number(p.payout), 0);
    const row = (p) => `<div class="r"><span>${A(p.asset).sym} ${hm(p.epoch * R())}</span>
      <b class="${Number(p.up) ? 'up' : 'dn'}">${Number(p.up) ? 'UP ' + lunc(p.up) : 'DOWN ' + lunc(p.down)}</b>
      <em>${p.outcome === 'accepting' ? 'starts soon' : p.outcome === 'live' ? 'live' : 'settling'}</em></div>`;
    host.innerHTML = (open.length ? `<div class="h">Your rounds</div>${open.slice(0, 4).map(row).join('')}` : '')
      + (total ? `<button type="button" class="rd-collect">Collect ${lunc(total)} LUNC</button>` : '');
  }

  // ── график ───────────────────────────────────────────────────────────────
  function frame() {
    const el = document.getElementById('rd');
    if (!el) return;
    paintCards(el);
    const e0 = epochNow(), t0 = e0 * R(), t1 = t0 + R();
    const [m, s] = mmss(t1 - now());
    const clk = el.querySelector('.rd-clock');
    if (clk.dataset.v !== m + s) {
      clk.dataset.v = m + s;
      clk.querySelector('.mm').innerHTML = digits(m);
      clk.querySelector('.ss').innerHTML = digits(s);
    }
    clk.classList.toggle('hot', t1 - now() < 30);
    const lock = lockOf(asset);
    const lr = liveRound(asset);
    el.querySelector('.lock').textContent = lock ? fmtUsd(lock) : '-';
    el.querySelector('.lsub').textContent = lock ? ''
      : state === 'down' ? 'Contract not reachable, retrying' : lr && lr.outcome === 'void' ? 'No start price - this round refunds'
        : state === 'loading' ? 'Loading' : 'Set at the round start';
    const p = priceOf(asset);
    el.querySelector('.cur').textContent = fmtUsd(p);
    const dl = el.querySelector('.dl');
    const upNow = lock && p ? p > lock : null;
    el.classList.toggle('is-up', upNow === true);
    el.classList.toggle('is-dn', upNow === false);
    dl.textContent = lock && p ? `${p >= lock ? '\u25b2' : '\u25bc'} ${Math.abs(((p - lock) / lock) * 100).toFixed(3)}%` : '';

    const f = live() && live().feeds[asset];
    const pts = f ? f.pts.filter((q2) => q2[0] >= t0 - 2) : [];
    const empty = el.querySelector('.rd-empty');
    const show = pts.length > 0;
    empty.hidden = show;
    el.querySelector('.rd-chart svg').style.visibility = show ? '' : 'hidden';
    el.querySelector('.head').style.display = show ? '' : 'none';
    el.querySelector('.tpill').style.display = show && lock ? '' : 'none';
    const xs = el.querySelectorAll('.rd-x span');
    xs[0].textContent = hm(t0); xs[1].textContent = new Date((t0 + R() / 2) * 1000).toTimeString().slice(0, 5); xs[2].textContent = hm(t1);
    if (!show) { empty.textContent = 'Waiting for the first price…'; return; }

    let lo = Infinity, hi = -Infinity;
    pts.forEach((q2) => { lo = Math.min(lo, q2[1]); hi = Math.max(hi, q2[1]); });
    if (lock) { lo = Math.min(lo, lock); hi = Math.max(hi, lock); }
    const pad = Math.max(hi - lo, p * 0.0003) * 0.25;
    lo -= pad; hi += pad;
    const X = (t) => ((Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0)) * 600;
    const Y = (v) => 180 - ((v - lo) / (hi - lo)) * 180;
    const d = pts.map((q2, i) => (i ? 'L' : 'M') + X(q2[0]).toFixed(1) + ',' + Y(q2[1]).toFixed(1)).join(' ')
      + ' L' + X(now()).toFixed(1) + ',' + Y(p).toFixed(1);
    el.querySelector('.line').setAttribute('d', d);
    el.querySelector('.area').setAttribute('d', d + ` L${X(now()).toFixed(1)},180 L${X(pts[0][0]).toFixed(1)},180 Z`);
    const head = el.querySelector('.head');
    head.style.left = (X(now()) / 6) + '%';
    head.style.top = (Y(p) / 1.8) + '%';
    const tl = el.querySelector('.tline');
    if (lock) {
      tl.setAttribute('y1', Y(lock)); tl.setAttribute('y2', Y(lock)); tl.style.display = '';
      el.querySelector('.tpill').style.top = (Y(lock) / 1.8) + '%';
    } else tl.style.display = 'none';
    const ys = el.querySelectorAll('.rd-yax span');
    ys[0].textContent = fmtUsd(hi); ys[1].textContent = fmtUsd((hi + lo) / 2); ys[2].textContent = fmtUsd(lo);

    if (t1 - now() < 0.6 && !el.dataset.flip) {
      el.dataset.flip = '1';
      setTimeout(() => { delete el.dataset.flip; paintHead(); refresh(); }, 12000);
    }
  }

  // ── данные ───────────────────────────────────────────────────────────────
  async function refresh() {
    try {
      if (!cfg) cfg = await q({ config: {} });
      const lists = await Promise.all(ASSETS.map((a) => q({ rounds: { asset: a.id, limit: 8 } })));
      const prev = nextRound(asset);
      ASSETS.forEach((a, i) => { rounds[a.id] = lists[i]; });
      state = 'ok';
      const nr = nextRound(asset);
      if (prev.epoch === nr.epoch && !REDUCED) {
        const du = Number(nr.up) - Number(prev.up), dd = Number(nr.down) - Number(prev.down);
        if (du > 0) pop(true, du);
        if (dd > 0) pop(false, dd);
      }
      paintBet(); paintStrip();
    } catch (e) {
      state = 'down';
    }
  }

  async function refreshMine() {
    const w = wallet();
    if (!w || !document.getElementById('rd')) { positions = {}; paintMine(); return; }
    try {
      const res = await Promise.all(ASSETS.map((a) => q({ positions: { address: w, asset: a.id, limit: 20 } })));
      ASSETS.forEach((a, i) => { positions[a.id] = res[i]; });
      paintMine();
    } catch (e) { /* позже */ }
  }

  function pop(up, uluna) {
    const b = document.querySelector(`#rd .rd-sides .${up ? 'up' : 'dn'}`);
    if (!b) return;
    const s = document.createElement('span');
    s.className = 'mkl-bubble ' + (up ? 'y' : 'n');
    s.textContent = `+${lunc(uluna)} LUNC`;
    s.style.left = '50%';
    b.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  }

  // ── транзакции ───────────────────────────────────────────────────────────
  async function submit() {
    const w = wallet();
    if (!w) { toast('Connect a wallet first.', 'info'); return; }
    if (side === null || !amount || busy) return;
    const epoch = epochNow() + 1;
    busy = true; paintBet();
    try {
      const hash = await window.sendExecuteContract(
        w, NET.contract, { predict: { asset, epoch, up: side } },
        [{ denom: 'uluna', amount: String(BigInt(Math.round(amount)) * 1000000n) }],
        `oracle-rounds: ${asset} ${side ? 'up' : 'down'} ${epoch}`, PROPHECY_CHAIN, 400000);
      if (window.OracleSound) window.OracleSound.play('coin');
      const done = (r) => { busy = false; refresh(); refreshMine(); if (r && r.status === 'failed') paintBet(); };
      if (typeof mkTrack === 'function') await mkTrack(hash, 'Prediction', done);
      else done();
    } catch (e) {
      busy = false; paintBet();
      toast(/not taking predictions/i.test(e.message) ? 'That round has just started. Try the next one.' : (e.message || 'Transaction failed'), 'err');
    }
  }

  async function collect() {
    const w = wallet();
    if (!w) return;
    const btn = document.querySelector('#rd .rd-collect');
    if (btn) { btn.disabled = true; btn.textContent = 'Confirm in your wallet…'; }
    try {
      for (const a of ASSETS) {
        const epochs = (positions[a.id] || []).filter((p) => !p.claimed && Number(p.payout) > 0).map((p) => p.epoch);
        if (!epochs.length) continue;
        const hash = await window.sendExecuteContract(w, NET.contract, { claim: { asset: a.id, epochs } }, [],
          `oracle-rounds: collect ${a.id}`, PROPHECY_CHAIN, 300000 + epochs.length * 40000);
        if (typeof mkTrack === 'function') await mkTrack(hash, 'Payout', () => {});
      }
    } catch (e) { toast(e.message || 'Transaction failed', 'err'); }
    refreshMine();
  }

  // ── главная ──────────────────────────────────────────────────────────────
  function mountHome() {
    if (document.getElementById('rd-home')) return;
    const anchor = document.getElementById('home-markets');
    if (!anchor) return;
    anchor.insertAdjacentHTML('beforebegin', `
      <section class="rd-home" id="rd-home" aria-label="Five-minute rounds">
        <div class="rd-home-h"><h3><i></i>5-minute rounds</h3><a href="/markets">All rounds</a></div>
        <div class="rd-cards">${ASSETS.map((a) => cardHtml(a, false)).join('')}</div>
      </section>`);
    const sec = document.getElementById('rd-home');
    const go = (a) => {
      select(a);
      if (typeof mkOpenFromHome === 'function') mkOpenFromHome(0);
      // В разделе могла остаться открытой форма создания рынка или экран
      // одного рынка - тогда раунды не видны.
      if (typeof window.closeMarketCreate === 'function') window.closeMarketCreate();
      if (typeof openMarketId !== 'undefined' && openMarketId !== null && typeof renderMarkets === 'function') renderMarkets(false);
      setTimeout(() => { const el = document.getElementById('rd'); if (el) el.scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' }); }, 300);
    };
    sec.addEventListener('click', (e) => {
      const b = e.target.closest('.rdc');
      if (b) { e.preventDefault(); go(b.dataset.a); }
      else if (e.target.closest('.rd-home-h a')) { e.preventDefault(); go(asset); }
    });
  }

  // ── связка ───────────────────────────────────────────────────────────────
  function visible(id) {
    const el = document.getElementById(id);
    return !!el && el.offsetParent !== null && !document.hidden;
  }

  function start() {
    mount(); mountHome();
    const hosts = [document.getElementById('rd'), document.getElementById('rd-home')].filter(Boolean);
    if (live()) ASSETS.forEach((a) => hosts.forEach((h) => live().subscribe(a.id, h)));
    refresh(); refreshMine();
    const mo = document.getElementById('markets-list');
    const hideOnMarket = () => {
      const el = document.getElementById('rd');
      if (el) el.hidden = typeof openMarketId !== 'undefined' && openMarketId !== null;
    };
    if (mo) new MutationObserver(hideOnMarket).observe(mo, { childList: true });
    let tick = 0;
    setInterval(() => {
      const onMarkets = visible('rd'), onHome = visible('rd-home');
      if (!onMarkets && !onHome) return;
      tick++;
      if (tick % 5 === 0) refresh();
      if (onMarkets && tick % 15 === 0) refreshMine();
      if (onMarkets) paintBet();
    }, 1000);
    const loop = () => {
      if (visible('rd')) frame();
      const h = document.getElementById('rd-home');
      if (h && visible('rd-home')) paintCards(h);
      setTimeout(() => requestAnimationFrame(loop), 250);
    };
    loop();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window._rounds = { refresh, refreshMine, rounds, get state() { return state; } };
})();
