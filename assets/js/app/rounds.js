/**
 * rounds.js - пятиминутные раунды "вверх или вниз" (контракт oracle-rounds).
 *
 * Блок на странице Markets над списком рынков. Прогноз принимается на
 * следующий раунд, пока идёт текущий; цену старта и конца пишет керпер
 * (oracle-rounds-keeper). Живую цену и поток сделок берём у markets-live.js.
 *
 * Загружать ПОСЛЕ markets.js и markets-live.js.
 */
(function () {
  'use strict';

  const NET = (typeof PROPHECY_TESTNET !== 'undefined' && PROPHECY_TESTNET)
    ? { contract: 'terra1erumnyvvtjkxkgedwrasuefhczetzd2qcdms650g76f3dq658qlsu3fw99' }
    : { contract: '' };   // mainnet: адрес появится после деплоя
  if (!NET.contract) return;

  const ASSETS = [
    { id: 'BTC', name: 'Bitcoin', feed: 'BTC' },
    { id: 'ETH', name: 'Ethereum', feed: 'ETH' },
    { id: 'LUNC', name: 'LUNC', feed: 'LUNC' },
    { id: 'PAXG', name: 'Gold', feed: 'PAXG' },
  ];
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let cfg = null;
  let asset = 'BTC';
  let side = null;           // true - UP, false - DOWN
  let amount = 0;            // LUNC
  let rounds = [];           // последние раунды выбранного актива, новые первыми
  let positions = {};        // asset -> [PositionResponse]
  let busy = false;

  const now = () => Date.now() / 1000;
  const esc = (s) => (typeof mktEsc === 'function' ? mktEsc(s) : String(s));
  const live = () => window._mkLive || null;
  const fmtUsd = (p) => (live() ? live().fmtUsd(p) : '$' + p);
  const lunc = (u) => (typeof fmtLunc === 'function' ? fmtLunc(u) : String(Number(u) / 1e6));
  const wallet = () => (typeof mkWallet === 'function' ? mkWallet() : null);
  const toast = (m, k) => (typeof mkToast === 'function' ? mkToast(m, k) : alert(m));

  async function q(msg) {
    const b64 = btoa(JSON.stringify(msg));
    for (const base of PROPHECY_LCD) {
      try {
        const r = await fetch(`${base}/cosmwasm/wasm/v1/contract/${NET.contract}/smart/${encodeURIComponent(b64)}`,
          { signal: AbortSignal.timeout(8000) });
        if (r.ok) return (await r.json()).data;
      } catch (e) { /* следующий узел */ }
    }
    throw new Error('rounds unavailable');
  }

  const R = () => (cfg ? cfg.round_secs : 300);
  const epochNow = () => Math.floor(now() / R());
  const hm = (t) => { const d = new Date(t * 1000); return d.toTimeString().slice(0, 5); };
  const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

  // ── оценка выплаты ───────────────────────────────────────────────────────
  function estimate(r, up, amtU) {
    const mine = BigInt(up ? r.up : r.down) + amtU;
    const other = BigInt(up ? r.down : r.up);
    if (!other || !amtU) return null;
    const fee = cfg ? BigInt(cfg.fee_bps) : 300n;
    const share = other - (other * fee) / 10000n;
    return amtU + (share * amtU) / mine;
  }
  const pct = (r) => {
    const u = Number(r.up), d = Number(r.down);
    return u + d ? Math.round((u / (u + d)) * 100) : 50;
  };

  // ── разметка ─────────────────────────────────────────────────────────────
  function shell() {
    const tabs = ASSETS.map((a) => `<button type="button" data-a="${a.id}" aria-pressed="${a.id === asset}">${a.name}</button>`).join('');
    return `
      <section class="rd" id="rd" aria-label="Five-minute rounds">
        <header class="rd-top">
          <div class="rd-title"><i class="dot"></i><h3>5-minute rounds</h3><span>Up or down - settled every five minutes</span></div>
          <div class="rd-tabs" role="tablist">${tabs}</div>
        </header>
        <div class="rd-grid">
          <div class="rd-live">
            <div class="rd-nums">
              <div><span class="lbl">Start price</span><b class="lock">-</b></div>
              <div><span class="lbl">Now</span><b class="cur">-</b></div>
              <div class="rd-dl"><b class="dl"></b></div>
              <div class="rd-clock"><span class="lbl">Ends in</span><b class="end">--:--</b></div>
            </div>
            <div class="rd-chart">
              <svg viewBox="0 0 600 170" preserveAspectRatio="none" aria-hidden="true">
                <line class="tline" x1="0" x2="600"/><path class="line"/></svg>
              <span class="head"></span><span class="tpill">Start</span>
            </div>
            <div class="rd-strip" aria-label="Recent rounds"></div>
          </div>
          <div class="rd-bet">
            <div class="rd-next"><b class="nlabel">Next round</b><span class="nstart"></span></div>
            <div class="rd-sides">
              <button type="button" class="up" data-s="1"><span class="k">UP</span><span class="p">-</span><span class="m"></span></button>
              <button type="button" class="dn" data-s="0"><span class="k">DOWN</span><span class="p">-</span><span class="m"></span></button>
            </div>
            <div class="rd-chips"></div>
            <label class="rd-amt"><span>Amount</span><input type="text" inputmode="numeric" placeholder="0" autocomplete="off"><em>LUNC</em></label>
            <div class="rd-win"></div>
            <button type="button" class="rd-go" disabled>Pick UP or DOWN</button>
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
    el.querySelector('.rd-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      asset = b.dataset.a;
      el.querySelectorAll('.rd-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      rounds = [];
      el.querySelector('.rd-strip').innerHTML = '';
      feedOn();
      refresh();
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
      paintBet();
    });
    el.querySelector('.rd-amt input').addEventListener('input', (e) => {
      amount = Number(String(e.target.value).replace(/[^0-9]/g, '')) || 0;
      paintBet();
    });
    el.querySelector('.rd-go').addEventListener('click', submit);
    el.querySelector('.rd-mine').addEventListener('click', (e) => { if (e.target.closest('.rd-collect')) collect(); });
    feedOn();
  }

  function feedOn() {
    const el = document.getElementById('rd');
    const a = ASSETS.find((x) => x.id === asset);
    if (!el || !live() || !a) return;
    live().subscribe(a.feed, el);
  }

  function paintChips() {
    const host = document.querySelector('#rd .rd-chips');
    if (!host || !cfg || host.dataset.done) return;
    const min = Number(cfg.min_bet) / 1e6, max = Number(cfg.max_bet) / 1e6;
    // На mainnet минимум 1,000 LUNC - пресеты как у рынков. На тестнете минимум
    // меньше, и пресеты масштабируются от него.
    const base = min >= 1000 ? [10000, 50000, 200000, 500000] : [min, min * 5, min * 20, min * 50];
    host.innerHTML = base.filter((v) => v >= min && v <= max)
      .map((v) => `<button type="button" data-v="${v}">${v >= 1000 ? v / 1000 + 'K' : v}</button>`).join('');
    host.dataset.done = '1';
  }

  const nextRound = () => rounds.find((r) => r.epoch === epochNow() + 1)
    || { epoch: epochNow() + 1, up: '0', down: '0', up_count: 0, down_count: 0 };
  const liveRound = () => rounds.find((r) => r.epoch === epochNow());

  function paintBet() {
    const el = document.getElementById('rd');
    if (!el || !cfg) return;
    const r = nextRound();
    const p = pct(r);
    const amtU = BigInt(Math.round(amount)) * 1000000n;
    const sides = el.querySelectorAll('.rd-sides button');
    [[sides[0], true, p], [sides[1], false, 100 - p]].forEach(([b, up, pp]) => {
      const pool = up ? r.up : r.down;
      b.setAttribute('aria-pressed', String(side === up));
      b.querySelector('.p').textContent = Number(r.up) + Number(r.down) ? pp + '%' : '50%';
      const est = estimate(r, up, 1000000n * 1000n);
      b.querySelector('.m').textContent = `${lunc(pool)} LUNC${est ? ` · x${(Number(est) / 1e9).toFixed(2)}` : ''}`;
    });
    el.querySelector('.nstart').textContent = `${hm(r.epoch * R())} - ${hm((r.epoch + 1) * R())}`;
    const go = el.querySelector('.rd-go');
    const win = el.querySelector('.rd-win');
    const min = Number(cfg.min_bet) / 1e6, max = Number(cfg.max_bet) / 1e6;
    const closing = (r.epoch * R() - now()) < 10;
    if (side === null) { go.disabled = true; go.textContent = 'Pick UP or DOWN'; win.textContent = ''; return; }
    if (!amount) { go.disabled = true; go.textContent = 'Choose an amount'; win.textContent = ''; return; }
    if (amount < min || amount > max) {
      go.disabled = true; go.textContent = `${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')} LUNC`;
      win.textContent = ''; return;
    }
    const est = estimate(r, side, amtU);
    win.innerHTML = est
      ? `If ${side ? 'UP' : 'DOWN'} wins: <b>≈ ${lunc(est)} LUNC</b> <small>before the network tax</small>`
      : `Nobody on ${side ? 'DOWN' : 'UP'} yet. If it stays that way, you get your stake back.`;
    go.disabled = busy || closing;
    go.className = 'rd-go ' + (side ? 'up' : 'dn');
    go.textContent = busy ? 'Waiting for the block…' : closing ? 'Next round opens in a moment'
      : `Predict ${side ? 'UP' : 'DOWN'} · ${amount.toLocaleString('en-US')} LUNC`;
  }

  function paintStrip() {
    const host = document.querySelector('#rd .rd-strip');
    if (!host) return;
    const e0 = epochNow();
    const list = rounds.filter((r) => r.epoch < e0).slice(0, 5).reverse();
    const cell = (r) => {
      const o = r.outcome;
      const cls = o === 'up' ? 'up' : o === 'down' ? 'dn' : o === 'void' ? 'void' : 'wait';
      const txt = o === 'up' ? 'UP' : o === 'down' ? 'DOWN' : o === 'void' ? 'Refund' : '…';
      return `<span class="c ${cls}" title="${r.lock_price ? 'start ' + r.lock_price : ''}${r.close_price ? ', end ' + r.close_price : ''}">${hm(r.epoch * R())}<b>${txt}</b></span>`;
    };
    host.innerHTML = list.map(cell).join('')
      + `<span class="c now">${hm(e0 * R())}<b>Live</b></span>`
      + `<span class="c next">${hm((e0 + 1) * R())}<b>Next</b></span>`;
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
    const row = (p) => `<div class="r"><span>${p.asset} ${hm(p.epoch * R())}</span>
      <b class="${Number(p.up) ? 'up' : 'dn'}">${Number(p.up) ? 'UP ' + lunc(p.up) : 'DOWN ' + lunc(p.down)}</b>
      <em>${p.outcome === 'accepting' ? 'starts soon' : p.outcome === 'live' ? 'live' : 'settling'}</em></div>`;
    host.innerHTML = (open.length ? `<div class="h">Your rounds</div>${open.slice(0, 4).map(row).join('')}` : '')
      + (total ? `<button type="button" class="rd-collect">Collect ${lunc(total)} LUNC</button>` : '');
  }

  // ── живая часть: график и часы ───────────────────────────────────────────
  function frame() {
    const el = document.getElementById('rd');
    if (!el || !live()) return;
    const f = live().feeds[asset];
    const lr = liveRound();
    const lock = lr && lr.lock_price ? Number(lr.lock_price) : null;
    const endAt = (epochNow() + 1) * R();
    el.querySelector('.end').textContent = mmss(endAt - now());
    el.querySelector('.lock').textContent = lock ? fmtUsd(lock) : 'waiting';
    if (!f || !f.pts.length) return;
    const last = f.last;
    el.querySelector('.cur').textContent = fmtUsd(last);
    const upNow = lock ? last > lock : null;
    el.classList.toggle('is-up', upNow === true);
    el.classList.toggle('is-dn', upNow === false);
    if (lock) {
      const d = last - lock;
      el.querySelector('.dl').textContent = `${d >= 0 ? '▲' : '▼'} ${fmtUsd(Math.abs(d))} (${((d / lock) * 100).toFixed(3)}%)`;
    }
    // Окно графика - текущий раунд целиком.
    const t0 = epochNow() * R(), t1 = t0 + R();
    const pts = f.pts.filter((p) => p[0] >= t0 - 2);
    if (!pts.length) return;
    let lo = Infinity, hi = -Infinity;
    pts.forEach((p) => { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); });
    if (lock) { lo = Math.min(lo, lock); hi = Math.max(hi, lock); }
    const pad = Math.max(hi - lo, last * 0.0002) * 0.2;
    lo -= pad; hi += pad;
    const X = (t) => ((Math.max(t, t0) - t0) / (t1 - t0)) * 600;
    const Y = (p) => 170 - ((p - lo) / (hi - lo)) * 170;
    let d = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ');
    d += ' L' + X(now()).toFixed(1) + ',' + Y(last).toFixed(1);
    el.querySelector('.line').setAttribute('d', d);
    const head = el.querySelector('.head');
    head.style.left = (X(now()) / 6) + '%';
    head.style.top = (Y(last) / 1.7) + '%';
    const tl = el.querySelector('.tline'), pill = el.querySelector('.tpill');
    if (lock) {
      tl.setAttribute('y1', Y(lock)); tl.setAttribute('y2', Y(lock));
      tl.style.display = ''; pill.style.display = '';
      pill.style.top = (Y(lock) / 1.7) + '%';
    } else { tl.style.display = 'none'; pill.style.display = 'none'; }
    // Граница раунда: перечитываем, чтобы увидеть новую цену старта.
    if (endAt - now() < 0.5 && !el.dataset.flip) {
      el.dataset.flip = '1';
      setTimeout(() => { delete el.dataset.flip; refresh(); }, 12000);
    }
  }

  // ── данные ───────────────────────────────────────────────────────────────
  async function refresh() {
    if (!document.getElementById('rd')) return;
    try {
      if (!cfg) cfg = await q({ config: {} });
      const a = asset;
      const list = await q({ rounds: { asset: a, limit: 8 } });
      if (a !== asset) return;
      const prev = nextRound();
      rounds = list;
      const nr = nextRound();
      // Новый прогноз на следующий раунд - всплывашка над стороной.
      if (prev.epoch === nr.epoch && !REDUCED) {
        const du = Number(nr.up) - Number(prev.up), dd = Number(nr.down) - Number(prev.down);
        if (du > 0) pop(true, du);
        if (dd > 0) pop(false, dd);
      }
      paintChips(); paintBet(); paintStrip();
    } catch (e) { /* узел не ответил - следующий опрос */ }
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

  // ── связка ───────────────────────────────────────────────────────────────
  function visibleNow() {
    const el = document.getElementById('rd');
    if (!el) return false;
    const onMarket = typeof openMarketId !== 'undefined' && openMarketId !== null;
    el.hidden = onMarket;
    return !onMarket && el.offsetParent !== null && !document.hidden;
  }

  function start() {
    mount();
    refresh(); refreshMine();
    const mo = document.getElementById('markets-list');
    if (mo) new MutationObserver(visibleNow).observe(mo, { childList: true });
    let tick = 0;
    setInterval(() => {
      if (!visibleNow()) return;
      tick++;
      if (tick % 5 === 0) refresh();
      if (tick % 15 === 0) refreshMine();
      paintBet();
    }, 1000);
    const loop = () => { if (visibleNow()) frame(); setTimeout(() => requestAnimationFrame(loop), 250); };
    loop();
    document.addEventListener('oracle:wallet', refreshMine);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window._rounds = { refresh, refreshMine, get rounds() { return rounds; } };
})();
