/**
 * markets-live.js - "прямой эфир" раздела Markets (по мотивам predict.fun).
 *
 * 1. Живая цена для крипто-рынков (src=cg): поток сделок Binance, цель
 *    пунктиром, "если бы закончилось сейчас". Только для показа - исход
 *    по-прежнему берётся из CoinGecko, и экран так и пишет.
 * 2. Мини-тикер цены на крипто-карточках.
 * 3. Карточки списка и главной обновляются сами раз в 20 с: проценты и пул
 *    докручиваются, новый прогноз всплывает "+N LUNC".
 * 4. Бегущая лента последних прогнозов по всем рынкам.
 *
 * markets.js не меняется: модуль следит за DOM и оборачивает
 * loadProphecyMarkets ради кэша. Загружать ПОСЛЕ markets.js и
 * markets-activity.js.
 */
(function () {
  'use strict';

  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const WINDOW_SECS = 300;       // сколько секунд цены на графике
  const LIST_POLL_MS = 20000;
  const TAPE_POLL_MS = 20000;

  const now = () => Date.now() / 1000;
  const esc = (s) => (typeof mktEsc === 'function' ? mktEsc(s) : String(s));
  const visible = () => typeof mkPageVisible !== 'function' || mkPageVisible();
  const onMarketScreen = () => typeof openMarketId !== 'undefined' && openMarketId !== null;

  // ── кэш рынков ────────────────────────────────────────────────────────────
  const cache = new Map();
  if (typeof loadProphecyMarkets === 'function') {
    const orig = loadProphecyMarkets;
    // Функция объявлена глобально, поэтому вызовы по имени внутри
    // markets.js пойдут через эту обёртку.
    window.loadProphecyMarkets = async function () {
      const all = await orig.apply(this, arguments);
      (all || []).forEach((m) => cache.set(Number(m.id), m));
      return all;
    };
  }

  // ── цена ──────────────────────────────────────────────────────────────────
  const BINANCE = {
    BTC: 'BTCUSDT', ETH: 'ETHUSDT', LUNC: 'LUNCUSDT', USTC: 'USTCUSDT', SOL: 'SOLUSDT', BNB: 'BNBUSDT',
    XRP: 'XRPUSDT', ADA: 'ADAUSDT', DOGE: 'DOGEUSDT', ATOM: 'ATOMUSDT', TRX: 'TRXUSDT', TON: 'TONUSDT',
    PAXG: 'PAXGUSDT',
  };
  const feeds = {};              // sym -> { pts: [[t, p]], subs: Set, last }
  let ws = null, wsSyms = '', wsFails = 0, cgTimer = null;

  function feed(sym) {
    if (!feeds[sym]) feeds[sym] = { pts: [], subs: new Set(), last: null, seeded: false };
    return feeds[sym];
  }

  function push(sym, p, t) {
    const f = feed(sym);
    t = t || now();
    const lastPt = f.pts[f.pts.length - 1];
    // Одна точка в секунду: сделок у BTC сотни в секунду.
    if (lastPt && Math.floor(lastPt[0]) === Math.floor(t)) lastPt[1] = p;
    else f.pts.push([t, p]);
    const cut = now() - WINDOW_SECS - 5;
    while (f.pts.length && f.pts[0][0] < cut) f.pts.shift();
    f.last = p;
  }

  // История для графика, когда Binance недоступен: Worker раундов отдаёт
  // последние сделки Coinbase или Gate по секундам.
  const HIST_URL = 'https://oracle-rounds-keeper.vladislav-baydan.workers.dev/hist?sym=';

  async function seed(sym) {
    const f = feed(sym);
    if (f.seeded || !BINANCE[sym]) return;
    f.seeded = true;
    const merge = (rows) => {
      const old = f.pts.slice();
      f.pts = [];
      rows.forEach(([t, p]) => push(sym, p, t));
      old.forEach((pt) => push(sym, pt[1], pt[0]));
    };
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${BINANCE[sym]}&interval=1s&limit=${WINDOW_SECS}`,
        { signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error();
      merge((await r.json()).map((k) => [Number(k[0]) / 1000, Number(k[4])]));
      return;
    } catch (e) { /* ниже - Worker */ }
    try {
      const r = await fetch(HIST_URL + sym, { signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      if (!r.ok || !j.pts || !j.pts.length) throw new Error();
      merge(j.pts);
    } catch (e) { f.seeded = false; }
  }

  function wantedSyms() {
    return Object.keys(feeds).filter((s) => feeds[s].subs.size && BINANCE[s]).sort();
  }

  function syncSocket() {
    const syms = wantedSyms();
    const key = syms.join(',');
    if (key === wsSyms && ws) return;
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    wsSyms = key;
    if (!syms.length) return;
    if (wsFails >= 3) { startCgPoll(); return; }
    const streams = syms.map((s) => BINANCE[s].toLowerCase() + '@aggTrade').join('/');
    try {
      ws = new WebSocket('wss://stream.binance.com:9443/stream?streams=' + streams);
    } catch (e) { wsFails++; startCgPoll(); return; }
    const back = {};
    syms.forEach((s) => { back[BINANCE[s]] = s; });
    ws.onopen = () => { wsFails = 0; };
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data).data;
        const sym = back[d.s];
        if (sym) push(sym, Number(d.p), d.T / 1000);
      } catch (e) { /* пропускаем кадр */ }
    };
    ws.onclose = () => {
      ws = null;
      wsFails++;
      setTimeout(() => { wsSyms = ''; syncSocket(); }, Math.min(30000, 2000 * wsFails));
    };
  }

  // Запасной путь, если Binance недоступен в регионе: CoinGecko раз в 30 с.
  const CG_ID = { BTC: 'bitcoin', ETH: 'ethereum', LUNC: 'terra-luna', USTC: 'terrausd', SOL: 'solana', BNB: 'binancecoin',
    XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', ATOM: 'cosmos', TRX: 'tron', TON: 'the-open-network', PAXG: 'pax-gold' };
  function startCgPoll() {
    if (cgTimer) return;
    const tick = async () => {
      const syms = Object.keys(feeds).filter((s) => feeds[s].subs.size && CG_ID[s]);
      if (!syms.length || !visible()) return;
      try {
        const r = await fetch('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids='
          + syms.map((s) => CG_ID[s]).join(','));
        const j = await r.json();
        syms.forEach((s) => { const v = j[CG_ID[s]] && j[CG_ID[s]].usd; if (v) push(s, Number(v)); });
      } catch (e) { /* следующий раз */ }
    };
    tick();
    cgTimer = setInterval(tick, 30000);
  }

  // ── запасные живые потоки ────────────────────────────────────────────────
  // Binance заблокирован у части провайдеров и стран. CoinGecko раз в 30 с
  // давал график ступеньками, поэтому сначала пробуем другие сокеты, тоже
  // посекундные: Coinbase для BTC, ETH и золота, Gate для LUNC.
  const ALT = {
    BTC: ['cb', 'BTC-USD'], ETH: ['cb', 'ETH-USD'], PAXG: ['cb', 'PAXG-USD'],
    SOL: ['cb', 'SOL-USD'], XRP: ['cb', 'XRP-USD'], ADA: ['cb', 'ADA-USD'], DOGE: ['cb', 'DOGE-USD'], ATOM: ['cb', 'ATOM-USD'],
    LUNC: ['gate', 'LUNC_USDT'], USTC: ['gate', 'USTC_USDT'], BNB: ['gate', 'BNB_USDT'], TRX: ['gate', 'TRX_USDT'], TON: ['gate', 'TON_USDT'],
  };
  const alt = { cb: null, gate: null, cbKey: '', gateKey: '' };
  const altOn = new Set();

  function altSync() {
    const want = (venue) => [...altOn].filter((s) => ALT[s] && ALT[s][0] === venue && feeds[s] && feeds[s].subs.size);
    const cbSyms = want('cb'), gateSyms = want('gate');
    const cbKey = cbSyms.sort().join(','), gateKey = gateSyms.sort().join(',');
    if (cbKey !== alt.cbKey) {
      if (alt.cb) { alt.cb.onclose = null; alt.cb.close(); alt.cb = null; }
      alt.cbKey = cbKey;
      if (cbSyms.length) {
        const back = {};
        cbSyms.forEach((s) => { back[ALT[s][1]] = s; });
        try {
          const w = new WebSocket('wss://ws-feed.exchange.coinbase.com');
          w.onopen = () => w.send(JSON.stringify({ type: 'subscribe', product_ids: Object.keys(back), channels: ['ticker'] }));
          w.onmessage = (ev) => {
            try { const d = JSON.parse(ev.data); if (d.type === 'ticker' && back[d.product_id]) push(back[d.product_id], Number(d.price)); } catch (e) { /* кадр */ }
          };
          w.onclose = () => { alt.cb = null; alt.cbKey = ''; setTimeout(altSync, 5000); };
          alt.cb = w;
        } catch (e) { /* остаётся CoinGecko */ }
      }
    }
    if (gateKey !== alt.gateKey) {
      if (alt.gate) { alt.gate.onclose = null; alt.gate.close(); alt.gate = null; }
      alt.gateKey = gateKey;
      if (gateSyms.length) {
        const back = {};
        gateSyms.forEach((s) => { back[ALT[s][1]] = s; });
        try {
          const w = new WebSocket('wss://api.gateio.ws/ws/v4/');
          w.onopen = () => w.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: 'spot.tickers', event: 'subscribe', payload: Object.keys(back) }));
          w.onmessage = (ev) => {
            try {
              const d = JSON.parse(ev.data);
              const r = d.result;
              if (d.channel === 'spot.tickers' && d.event === 'update' && r && back[r.currency_pair]) push(back[r.currency_pair], Number(r.last));
            } catch (e) { /* кадр */ }
          };
          w.onclose = () => { alt.gate = null; alt.gateKey = ''; setTimeout(altSync, 5000); };
          alt.gate = w;
        } catch (e) { /* остаётся CoinGecko */ }
      }
    }
  }

  function subscribe(sym, id) {
    if (!BINANCE[sym]) return;
    feed(sym).subs.add(id);
    seed(sym);
    syncSocket();
    // Binance молчит (блок провайдера, регион): через 5 с - другой живой
    // поток, а если и его нет - CoinGecko раз в 30 с.
    setTimeout(() => {
      if (feed(sym).last == null && ALT[sym]) { altOn.add(sym); altSync(); }
    }, 5000);
    setTimeout(() => { if (feed(sym).last == null) startCgPoll(); }, 12000);
  }
  function unsubscribeMissing() {
    Object.keys(feeds).forEach((s) => {
      feeds[s].subs.forEach((id) => { if (!document.contains(id)) feeds[s].subs.delete(id); });
    });
    syncSocket();
  }

  function fmtUsd(p) {
    if (p == null || !isFinite(p)) return '-';
    if (p >= 1000) return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 4 });
    return '$' + p.toLocaleString('en-US', { maximumSignificantDigits: 5 });
  }

  // ── что считается выигрышем ──────────────────────────────────────────────
  function cryptoInfo(m) {
    if (!m || typeof mkRef !== 'function') return null;
    const ref = mkRef(m);
    if (!ref || ref.src !== 'cg') return null;
    const sym = typeof mkRefSym === 'function' ? mkRefSym(ref) : '';
    const th = Number(m.spec && m.spec.threshold);
    const cmp = m.spec && m.spec.comparator;
    if (!sym || !BINANCE[sym] || !isFinite(th) || !cmp) return null;
    const at = Number(ref.at || m.resolve_after || 0);
    return { sym, th, cmp, at };
  }
  function yesNow(info, p) {
    if (info.cmp === 'gt') return p > info.th;
    if (info.cmp === 'gte') return p >= info.th;
    if (info.cmp === 'lt') return p < info.th;
    return p <= info.th;
  }
  const isLiveStatus = (m) => m && (m.status === 'open' || m.status === 'locked');

  // ── анимация чисел и всплывашки ──────────────────────────────────────────
  function tween(el, from, to, fmt, ms) {
    if (!el || from === to || REDUCED) { if (el) el.textContent = fmt(to); return; }
    const t0 = performance.now();
    ms = ms || 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    el.classList.remove('mkl-flash');
    void el.offsetWidth;
    el.classList.add('mkl-flash');
  }

  function bubble(host, text, kind) {
    if (!host || REDUCED) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const b = document.createElement('span');
    b.className = 'mkl-bubble ' + (kind || '');
    b.textContent = text;
    b.style.left = (30 + Math.random() * 40) + '%';
    host.appendChild(b);
    b.addEventListener('animationend', () => b.remove());
  }

  const shortLunc = (uluna) => {
    const v = Number(uluna || 0) / 1e6;
    if (v >= 1e6) return +(v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return +(v / 1e3).toFixed(1) + 'K';
    return Math.round(v).toString();
  };

  // ── живая цена на экране рынка ───────────────────────────────────────────
  function panelHtml(m, info) {
    const yesWord = info.cmp === 'lt' || info.cmp === 'lte' ? 'below' : 'above';
    return `
      <section class="mkl-price" data-sym="${info.sym}" style="--c:${typeof catRgb === 'function' ? catRgb(m.category) : '123,92,255'}">
        <div class="mkl-row">
          <div class="mkl-cell"><span class="lbl">Target</span><b class="tgt">${fmtUsd(info.th)}</b></div>
          <div class="mkl-cell"><span class="lbl">${info.sym} now</span><b class="cur">-</b></div>
          <div class="mkl-cell mkl-delta"><span class="lbl">To target</span><b class="dl">-</b></div>
          <div class="mkl-verdict" aria-live="polite"><i></i><span class="vt">Waiting for price</span></div>
        </div>
        <div class="mkl-chart">
          <svg viewBox="0 0 600 180" preserveAspectRatio="none" aria-label="${info.sym} price in the last five minutes against the target">
            <defs><linearGradient id="mklFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="currentColor" stop-opacity=".28"/>
              <stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
            <path class="area" fill="url(#mklFill)"/>
            <line class="tline" x1="0" x2="600"/>
            <path class="line"/>
          </svg>
          <span class="tpill">Target</span>
          <span class="head"></span>
          <div class="yax"><span></span><span></span><span></span></div>
        </div>
        <div class="mkl-x"><span></span><span></span><span></span></div>
        <p class="mkl-note">YES wins if ${info.sym} is ${yesWord} ${fmtUsd(info.th)} at the deadline. Live price from Binance for watching;
          the market itself settles on the CoinGecko price.</p>
      </section>`;
  }

  function drawPanel(el, info) {
    const f = feeds[info.sym];
    if (!f || !f.pts.length) return;
    const pts = f.pts;
    const last = pts[pts.length - 1][1];
    const t1 = now(), t0 = t1 - WINDOW_SECS;
    let lo = Infinity, hi = -Infinity;
    pts.forEach((q) => { if (q[0] >= t0) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); } });
    if (!isFinite(lo)) { lo = hi = last; }
    // Цель на графике, если она рядом; иначе - метка у края.
    const span0 = Math.max(hi - lo, last * 0.0005);
    const near = Math.abs(info.th - last) < span0 * 3;
    if (near) { lo = Math.min(lo, info.th); hi = Math.max(hi, info.th); }
    const pad = Math.max(hi - lo, last * 0.0005) * 0.18;
    lo -= pad; hi += pad;
    const W = 600, H = 180;
    const X = (t) => ((t - t0) / WINDOW_SECS) * W;
    const Y = (p) => H - ((p - lo) / (hi - lo)) * H;
    let d = '', x0 = null;
    pts.forEach((q, i) => {
      if (q[0] < t0 - 2) return;
      const x = X(Math.max(q[0], t0));
      if (x0 === null) x0 = x;
      d += (d ? ' L' : 'M') + x.toFixed(1) + ',' + Y(q[1]).toFixed(1);
    });
    d += ' L' + X(t1).toFixed(1) + ',' + Y(last).toFixed(1);
    el.querySelector('.line').setAttribute('d', d);
    // Заливка закрывается под первой точкой, а не в левом углу: иначе при
    // короткой истории получался косой клин через весь график.
    el.querySelector('.area').setAttribute('d', d + ` L${W},${H} L${(x0 || 0).toFixed(1)},${H} Z`);

    const yesN = yesNow(info, last);
    el.classList.toggle('is-yes', yesN);
    el.classList.toggle('is-no', !yesN);

    const tl = el.querySelector('.tline'), pill = el.querySelector('.tpill');
    if (near) {
      const ty = Y(info.th);
      tl.setAttribute('y1', ty); tl.setAttribute('y2', ty); tl.style.display = '';
      pill.style.top = (ty / H * 100) + '%';
      pill.textContent = 'Target';
      pill.className = 'tpill';
    } else {
      tl.style.display = 'none';
      const above = info.th > last;
      pill.textContent = `Target ${fmtUsd(info.th)} ${above ? '\u2191' : '\u2193'}`;
      pill.className = 'tpill edge ' + (above ? 'top' : 'bot');
      pill.style.top = '';
    }
    const head = el.querySelector('.head');
    head.style.top = (Y(last) / H * 100) + '%';

    const curEl = el.querySelector('.cur');
    const prev = Number(curEl.dataset.v || 0);
    curEl.textContent = fmtUsd(last);
    curEl.dataset.v = last;
    if (prev && prev !== last && !REDUCED) {
      curEl.classList.remove('up', 'down');
      void curEl.offsetWidth;
      curEl.classList.add(last > prev ? 'up' : 'down');
    }
    const diff = info.th - last;
    const pct = (diff / last) * 100;
    el.querySelector('.dl').textContent = (diff >= 0 ? '+' : '\u2212') + fmtUsd(Math.abs(diff))
      + ' (' + (pct >= 0 ? '+' : '\u2212') + Math.abs(pct).toFixed(2) + '%)';
    el.querySelector('.vt').textContent = `If it ended now: ${yesN ? 'YES' : 'NO'}`;

    const ys = el.querySelectorAll('.yax span');
    ys[0].textContent = fmtUsd(hi); ys[1].textContent = fmtUsd((hi + lo) / 2); ys[2].textContent = fmtUsd(lo);
    const xs = el.querySelectorAll('.mkl-x span');
    const hm = (t) => { const dd = new Date(t * 1000); return dd.toTimeString().slice(0, 8); };
    xs[0].textContent = hm(t0); xs[1].textContent = hm(t0 + WINDOW_SECS / 2); xs[2].textContent = hm(t1);
  }

  function mountScreen() {
    const m = window._prophecyMarket;
    const body = document.querySelector('#markets-list .mk2-body');
    if (!body || !m) return;
    const info = cryptoInfo(m);
    const existing = body.querySelector('.mkl-price');
    if (!info || !isLiveStatus(m) || (info.at && info.at < now())) { if (existing) existing.remove(); return; }
    if (existing && existing.dataset.mid === String(m.id)) return;
    if (existing) existing.remove();
    const pos = body.querySelector(':scope > .mk2-pos');
    if (pos) pos.insertAdjacentHTML('afterend', panelHtml(m, info));
    else body.insertAdjacentHTML('afterbegin', panelHtml(m, info));
    const el = body.querySelector('.mkl-price');
    el.dataset.mid = String(m.id);
    el._info = info;
    subscribe(info.sym, el);
  }

  // ── тикер на карточках ───────────────────────────────────────────────────
  const cardId = (card) => {
    const mm = String(card.getAttribute('onclick') || '').match(/openProphecyMarket\((\d+)\)/);
    return mm ? Number(mm[1]) : null;
  };

  function spark(sym) {
    const f = feeds[sym];
    if (!f || f.pts.length < 2) return '';
    const pts = f.pts.slice(-90);
    let lo = Infinity, hi = -Infinity;
    pts.forEach((q) => { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); });
    const r = hi - lo || 1;
    return pts.map((q, i) => (i ? 'L' : 'M') + (i / (pts.length - 1) * 100).toFixed(1) + ','
      + (22 - ((q[1] - lo) / r) * 20).toFixed(1)).join(' ');
  }

  function mountCards() {
    document.querySelectorAll('#markets-list .mk2c, #home-markets-grid .mk2c').forEach((card) => {
      const id = cardId(card);
      const m = id != null && cache.get(id);
      const info = m && cryptoInfo(m);
      if (!info || !isLiveStatus(m) || (info.at && info.at < now())) return;
      let t = card.querySelector('.mkl-tick');
      if (!t) {
        const head = card.querySelector('.mk2-head');
        if (!head) return;
        head.insertAdjacentHTML('afterend', `<div class="mkl-tick"><i class="dot"></i>
          <span class="sym">${info.sym}</span><b class="cur">-</b><span class="dl"></span>
          <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path/></svg></div>`);
        t = card.querySelector('.mkl-tick');
        t._info = info;
        subscribe(info.sym, t);
      }
    });
  }

  function drawCards() {
    document.querySelectorAll('.mkl-tick').forEach((t) => {
      const info = t._info, f = info && feeds[info.sym];
      if (!f || f.last == null) return;
      const p = f.last;
      t.querySelector('.cur').textContent = fmtUsd(p);
      const pct = ((info.th - p) / p) * 100;
      const yesN = yesNow(info, p);
      t.classList.toggle('is-yes', yesN);
      t.classList.toggle('is-no', !yesN);
      t.querySelector('.dl').textContent = `${Math.abs(pct).toFixed(2)}% ${pct > 0 ? 'below' : 'above'} target, ${yesN ? 'YES' : 'NO'} now`;
      t.querySelector('path').setAttribute('d', spark(info.sym));
    });
  }

  // ── карточки обновляются сами ────────────────────────────────────────────
  const snap = new Map();      // id -> { y, n, total }
  const sumOf = (m) => ({ y: Number(m.pot_yes), n: Number(m.pot_no), total: Number(m.pot_yes) + Number(m.pot_no) + Number(m.boost || 0) });

  async function pollList() {
    if (!visible() || onMarketScreen()) return;
    const cards = document.querySelectorAll('#markets-list .mk2c, #home-markets-grid .mk2c');
    if (!cards.length || typeof loadProphecyMarkets !== 'function') return;
    let all;
    try { all = await window.loadProphecyMarkets(); } catch (e) { return; }
    const byId = new Map(all.map((m) => [Number(m.id), m]));
    document.querySelectorAll('#markets-list .mk2c, #home-markets-grid .mk2c').forEach((card) => {
      const id = cardId(card), m = byId.get(id);
      if (!m) return;
      const before = snap.get(id), after = sumOf(m);
      snap.set(id, after);
      if (!before || (before.y === after.y && before.n === after.n && before.total === after.total)) return;
      if (typeof marketCardRaw !== 'function') return;
      const big = card.classList.contains('big');
      const oldPct = before.y + before.n ? Math.round(before.y / (before.y + before.n) * 100) : 50;
      const newPct = after.y + after.n ? Math.round(after.y / (after.y + after.n) * 100) : 50;
      const tmp = document.createElement('div');
      try { tmp.innerHTML = big ? featuredCard(m) : marketCard(m); } catch (e) { return; }
      const fresh = tmp.firstElementChild;
      if (!fresh) return;
      card.replaceWith(fresh);
      // Проценты и пул докручиваются от прежних значений.
      const pctFmt = (v) => String(Math.round(v));
      const g = fresh.querySelectorAll('.mk2-gauge-top .y, .mk2-gauge-top .n');
      const nSmall = g.length === 2 && g[1].querySelector('small');
      if (g.length === 2 && g[0].firstChild && nSmall && nSmall.previousSibling) {
        const yNode = g[0].firstChild, nNode = nSmall.previousSibling;
        animateText(yNode, oldPct, newPct, pctFmt);
        animateText(nNode, 100 - oldPct, 100 - newPct, (v) => ' ' + Math.round(v));
      }
      const odds = fresh.querySelectorAll('.odds .p');
      if (odds.length === 2 && before.y && before.n) {
        tween(odds[0], oldPct, newPct, (v) => Math.round(v) + '%');
        tween(odds[1], 100 - oldPct, 100 - newPct, (v) => Math.round(v) + '%');
      }
      const pool = fresh.querySelector('.mk2-foot .pool b');
      if (pool) tween(pool, before.total, after.total, (v) => fmtLunc(v), 1200);
      const dy = after.y - before.y, dn = after.n - before.n;
      if (dy > 0) bubble(fresh, `+${shortLunc(dy)} LUNC YES`, 'y');
      if (dn > 0) setTimeout(() => bubble(fresh, `+${shortLunc(dn)} LUNC NO`, 'n'), dy > 0 ? 350 : 0);
      fresh.classList.add('mkl-pulse');
      setTimeout(() => fresh.classList.remove('mkl-pulse'), 1600);
    });
    mountCards();
  }

  // Текстовый узел внутри span: tween работает с элементом, тут - с узлом.
  function animateText(node, from, to, fmt) {
    if (!node || from === to || REDUCED) return;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 900);
      node.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function seedSnapshots() {
    document.querySelectorAll('#markets-list .mk2c, #home-markets-grid .mk2c').forEach((card) => {
      const id = cardId(card), m = cache.get(id);
      if (m && !snap.has(id)) snap.set(id, sumOf(m));
    });
  }

  // ── экран рынка: проценты и всплывашки при новых прогнозах ───────────────
  let screenPct = null;
  function watchScreenSides() {
    const row = document.getElementById('bet-side-row');
    const m = window._prophecyMarket;
    if (!row || !m || row.dataset.mkl) return;
    row.dataset.mkl = '1';
    const y = Number(m.pot_yes), n = Number(m.pot_no);
    const pct = y + n ? Math.round(y / (y + n) * 100) : 50;
    if (screenPct && screenPct.id === m.id && screenPct.pct !== pct && y && n) {
      const p = row.querySelectorAll('.p');
      if (p.length === 2) {
        tween(p[0], screenPct.pct, pct, (v) => Math.round(v) + '%');
        tween(p[1], 100 - screenPct.pct, 100 - pct, (v) => Math.round(v) + '%');
      }
    }
    screenPct = { id: m.id, pct };
  }

  function watchFeed() {
    const host = document.getElementById('mk-activity');
    const row = document.getElementById('bet-side-row');
    if (!host || !row) return;
    host.querySelectorAll('.mk-feed .r.new:not([data-mkl])').forEach((r, i) => {
      r.dataset.mkl = '1';
      const b = r.querySelector('b');
      if (!b) return;
      const yes = b.classList.contains('y');
      const amt = (b.textContent.match(/^[\d,.]+/) || [''])[0];
      const btn = row.querySelector(yes ? 'button.yes' : 'button.no');
      setTimeout(() => bubble(btn || row, `+${amt} LUNC`, yes ? 'y' : 'n'), i * 300);
    });
  }

  // ── лента прогнозов ──────────────────────────────────────────────────────
  let tapeSeen = new Set(), tapeItems = [];
  async function lcd(path) {
    for (const base of (typeof PROPHECY_LCD !== 'undefined' ? PROPHECY_LCD : [])) {
      try {
        const r = await fetch(base + path, { signal: AbortSignal.timeout(10000) });
        if (r.ok) return await r.json();
      } catch (e) { /* следующий узел */ }
    }
    throw new Error('lcd');
  }
  function attrs(ev) {
    const list = ev.attributes || [];
    const plain = list.some((a) => a.key === 'action' || a.key === '_contract_address');
    const dec = (s) => { if (plain || typeof s !== 'string') return s; try { return atob(s); } catch (e) { return s; } };
    const o = {};
    list.forEach((a) => { o[dec(a.key)] = dec(a.value); });
    return o;
  }
  async function loadTape() {
    if (typeof PROPHECY_CONTRACT === 'undefined' || !PROPHECY_CONTRACT) return [];
    const q = `wasm._contract_address='${PROPHECY_CONTRACT}' AND wasm.action='bet'`;
    const j = await lcd('/cosmos/tx/v1beta1/txs?query=' + encodeURIComponent(q)
      + '&order_by=ORDER_BY_DESC&pagination.limit=15');
    const out = [];
    ((j && j.tx_responses) || []).forEach((r) => {
      if (r.code) return;
      const msgs = (r.tx && r.tx.body && r.tx.body.messages) || [];
      (r.events || []).forEach((ev) => {
        if (ev.type !== 'wasm') return;
        const a = attrs(ev);
        if (a._contract_address !== PROPHECY_CONTRACT || a.action !== 'bet') return;
        out.push({ key: r.txhash + a.market_id + a.side, t: Date.parse(r.timestamp) / 1000, id: Number(a.market_id),
          yes: a.side === 'yes', amount: Number(a.amount || 0), who: (msgs[0] && msgs[0].sender) || '' });
      });
    });
    return out;
  }
  function ago(t) {
    const s = Math.max(0, Math.floor(now() - t));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function tapeHtml() {
    const item = (b) => {
      // Прогноз раунда: своя подпись и переход к раунду этого актива.
      if (b.round) {
        return `<a class="it ${b.yes ? 'y' : 'n'}" href="#" data-round="${esc(b.asset)}">
          <span class="w">${esc(b.house ? 'House' : typeof shortAddr === 'function' ? shortAddr(b.who) : b.who.slice(0, 10))}</span>
          <b>${shortLunc(b.amount)} LUNC ${b.yes ? 'UP' : 'DOWN'}</b>
          <span class="q">${esc(b.label)}</span>
          <span class="a">${ago(b.t)}</span></a>`;
      }
      const m = cache.get(b.id);
      const q = m ? m.question : `Market #${b.id}`;
      return `<a class="it ${b.yes ? 'y' : 'n'}" href="#" onclick="openProphecyMarket(${b.id});return false">
        <span class="w">${esc(typeof shortAddr === 'function' ? shortAddr(b.who) : b.who.slice(0, 10))}</span>
        <b>${shortLunc(b.amount)} LUNC ${b.yes ? 'YES' : 'NO'}</b>
        <span class="q">${esc(q.length > 64 ? q.slice(0, 62) + '\u2026' : q)}</span>
        <span class="a">${ago(b.t)}</span></a>`;
    };
    const run = tapeItems.map(item).join('');
    // Дорожка повторена дважды, чтобы прокрутка шла без шва.
    return `<span class="lbl"><i></i>Live</span><div class="trk"><div class="run">${run}${run}</div></div>`;
  }
  async function pollTape() {
    const anchor = document.querySelector('#page-markets #markets-list');
    if (!anchor || !visible()) return;
    let tape = document.getElementById('mkl-tape');
    if (onMarketScreen()) { if (tape) tape.hidden = true; return; }
    let list = [];
    try { list = await loadTape(); } catch (e) { /* рынки не ответили - покажем раунды */ }
    // Прогнозы пятиминутных раундов (rounds.js) - в ту же ленту, по времени.
    if (typeof window._roundsTape === 'function') {
      try { list = list.concat(await window._roundsTape()); } catch (e) { /* без раундов */ }
    }
    list.sort((a, b) => b.t - a.t);
    if (!list.length) return;
    const fresh = list.filter((b) => !tapeSeen.has(b.key));
    if (!fresh.length && tape) { tape.hidden = false; return; }
    fresh.forEach((b) => tapeSeen.add(b.key));
    tapeItems = list.slice(0, 12);
    if (!tape) {
      // Лента - сразу под шапкой раздела: над раундами, если они есть, иначе
      // над статистикой. Внизу, над списком, её не замечали.
      const top = document.getElementById('rd') || document.getElementById('mkStats') || anchor;
      top.insertAdjacentHTML('beforebegin', '<div id="mkl-tape" class="mkl-tape" role="marquee" aria-label="Latest predictions"></div>');
      tape = document.getElementById('mkl-tape');
      tape.addEventListener('click', (e) => {
        const a = e.target.closest('[data-round]');
        if (!a) return;
        e.preventDefault();
        if (window._rounds && window._rounds.open) window._rounds.open(a.dataset.round);
      });
    }
    tape.hidden = false;
    tape.innerHTML = tapeHtml();
    const run = tape.querySelector('.run');
    if (run) run.style.setProperty('--dur', Math.max(30, tapeItems.length * 6) + 's');
  }

  // ── связка ───────────────────────────────────────────────────────────────
  let raf = null, lastDraw = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - lastDraw < 250 || !visible()) return;  // 4 кадра в секунду хватает
    lastDraw = t;
    document.querySelectorAll('.mkl-price').forEach((el) => drawPanel(el, el._info));
    drawCards();
  }

  let pending = false;
  function onDom() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      mountScreen();
      mountCards();
      seedSnapshots();
      watchScreenSides();
      watchFeed();
      unsubscribeMissing();
      const tape = document.getElementById('mkl-tape');
      if (tape) tape.hidden = onMarketScreen();
    });
  }

  function start() {
    ['markets-list', 'home-markets-grid'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) new MutationObserver(onDom).observe(el, { childList: true, subtree: true });
    });
    onDom();
    // Главная могла отрисоваться раньше этого модуля - кэш тогда пуст.
    setTimeout(() => {
      if (!cache.size && typeof window.loadProphecyMarkets === 'function') {
        window.loadProphecyMarkets().then(onDom).catch(() => {});
      }
    }, 2000);
    raf = requestAnimationFrame(frame);
    setInterval(pollList, LIST_POLL_MS);
    setInterval(pollTape, TAPE_POLL_MS);
    setTimeout(pollTape, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  // Для проверки из консоли.
  // feeds/subscribe/fmtUsd нужны раундам (rounds.js): один поток цен на страницу.
  window._mkLive = { feeds, cache, pollList, pollTape, subscribe, fmtUsd, unsubscribeMissing };
})();
