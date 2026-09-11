/* ═══════════════════════════════════════════════════════════════════════════
   CIRCUIT - покупка зон
   ---------------------------------------------------------------------------
   Заменяет заглушку «buying zones opens shortly» внутри #stage-circuit.

   ПОДКЛЮЧЕНИЕ: обычный <script>, ОБЯЗАТЕЛЬНО после app.js -
   отсюда берутся DRAW_WORKER, CHAIN_ID, lotteryAddress и sendLuncDirect.
   Они объявлены через const/let на верхнем уровне, то есть в window их нет;
   ссылки идут по имени, поэтому порядок загрузки важен.

   ЦЕНУ НЕ СЧИТАЕМ. Всё - из GET /circuit/quote: totalUluna, perZone, payTo,
   остаток потолка, какие зоны достанутся. Иначе формула наценки рано или
   поздно разъедется с воркером.

   ЖИВУЧЕСТЬ. Между отправкой LUNC и зачётом в воркере есть окно, в котором
   деньги уже ушли. Хеш кладётся в localStorage ДО первой попытки зачёта и
   стирается только после успеха, поэтому закрытая вкладка или упавшая сеть
   не теряют покупку - при следующей загрузке зачёт продолжится сам.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const PENDING_KEY = 'circuit_pending_v1';
  const QUOTE_DEBOUNCE_MS = 350;

  // Задержки между попытками зачёта: транзакция должна попасть в индекс LCD.
  // Суммарно около 100 секунд, дальше покупка остаётся в localStorage и
  // предлагается кнопкой, а не теряется.
  const RETRY_MS = [2000, 3000, 4000, 5000, 7000, 9000, 12000, 15000, 20000, 25000];

  const base = () => (typeof DRAW_WORKER !== 'undefined' ? DRAW_WORKER : '');
  const chain = () => (typeof CHAIN_ID !== 'undefined' ? CHAIN_ID : 'columbus-5');
  // Кошелёк подключается несколькими путями, и каждый заполняет СВОЮ переменную:
  // кнопка в шапке пишет connectedWalletAddress, поток Draw - lotteryAddress,
  // и при подключении через шапку вторая остаётся null. Поэтому перебираем
  // источники и проверяем формат, а не полагаемся на одно имя.
  const ADDR_RE = /^terra1[0-9a-z]{38}$/i;
  const pickAddr = (v) => (typeof v === 'string' && ADDR_RE.test(v)) ? v : null;

  function myWallet() {
    let a = null;
    try { a = pickAddr(connectedWalletAddress); } catch (e) {}
    if (!a) { try { a = pickAddr(lotteryAddress); } catch (e) {} }
    if (!a && typeof window._getConnectedAddress === 'function') {
      try { a = pickAddr(window._getConnectedAddress()); } catch (e) {}
    }
    return a;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  let count = 1;
  let quote = null;        // последний успешный ответ /circuit/quote
  let quoteErr = null;     // { error, ... } - причина, по которой купить нельзя
  let busy = false;        // идёт покупка - блокируем повторные нажатия
  let quoteTimer = null;
  let lastWallet = null;

  /* ── разметка ──────────────────────────────────────────────────────────── */

  const CSS = `
  .cb { margin-top: 18px; border-top: 1px solid rgba(56,217,208,.18); padding-top: 18px; }
  .cb-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .cb-step { display: flex; align-items: center; gap: 2px;
    border: 1px solid rgba(56,217,208,.3); border-radius: 8px; overflow: hidden; }
  .cb-step button { width: 38px; height: 38px; background: rgba(56,217,208,.06);
    border: 0; color: #38d9d0; font-size: 20px; line-height: 1; cursor: pointer; }
  .cb-step button:hover:not(:disabled) { background: rgba(56,217,208,.16); }
  .cb-step button:disabled { opacity: .3; cursor: default; }
  .cb-step input { width: 62px; height: 38px; background: transparent; border: 0;
    color: #e8f6f5; text-align: center; font-size: 16px; font-weight: 600; }
  .cb-step input:focus { outline: none; background: rgba(56,217,208,.08); }
  .cb-price { font-size: 22px; font-weight: 700; color: #38d9d0; letter-spacing: .5px; }
  .cb-price small { font-size: 12px; font-weight: 500; color: #7fa8a5; margin-left: 6px; }
  .cb-buy { flex: 0 1 260px; margin-left: auto; min-height: 44px; padding: 0 22px; border-radius: 10px;
    border: 1px solid #38d9d0; background: rgba(56,217,208,.14); color: #38d9d0;
    font-size: 15px; font-weight: 600; cursor: pointer; transition: background .15s; }
  .cb-buy:hover:not(:disabled) { background: rgba(56,217,208,.26); }
  .cb-buy:disabled { opacity: .45; cursor: default; }
  .cb-buy:focus-visible { outline: 2px solid #38d9d0; outline-offset: 2px; }
  .cb-meta { margin-top: 10px; font-size: 13px; color: #7fa8a5; line-height: 1.6; }
  .cb-meta b { color: #cfe9e7; font-weight: 600; }
  .cb-note { margin-top: 12px; padding: 11px 13px; border-radius: 9px; font-size: 13px;
    line-height: 1.55; display: none; }
  .cb-note.on { display: block; }
  .cb-note.warn { background: rgba(244,208,63,.09); border: 1px solid rgba(244,208,63,.3); color: #f0dda0; }
  .cb-note.err  { background: rgba(255,107,107,.09); border: 1px solid rgba(255,107,107,.3); color: #ffb3b3; }
  .cb-note.ok   { background: rgba(56,217,208,.09); border: 1px solid rgba(56,217,208,.3); color: #a8ece8; }
  .cb-note a { color: inherit; text-decoration: underline; }
  .cb-note button { margin-top: 8px; padding: 6px 14px; border-radius: 7px; cursor: pointer;
    background: transparent; border: 1px solid currentColor; color: inherit; font-size: 12px; }
  .cb-spin { display: inline-block; width: 11px; height: 11px; margin-right: 7px;
    border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
    animation: cb-rot .7s linear infinite; vertical-align: -1px; }
  @keyframes cb-rot { to { transform: rotate(360deg); } }
  /* Подсветка выбираемых зон. Красится инлайном (см. paintPreview), но сама
     пульсация живёт классом-независимо: анимация по имени, keyframes здесь.
     Анимируемые свойства перебивают инлайновые значения, поэтому инлайн
     остаётся статическим запасным видом для reduced-motion. */
  @keyframes cb-zone-pulse {
    0%, 100% { background: rgba(255,255,255,.28); box-shadow: 0 0 4px rgba(255,255,255,.30);
               outline-color: rgba(255,255,255,.55); }
    50%      { background: rgba(255,255,255,.85); box-shadow: 0 0 12px rgba(255,255,255,.85);
               outline-color: rgba(255,255,255,1); }
  }
  @media (prefers-reduced-motion: reduce) { .cb-spin { animation: none; } }
  @media (max-width: 560px) { .cb-buy { flex-basis: 100%; } }
  `;

  const HTML = `
  <div class="cb">
    <div class="cb-row">
      <div class="cb-step">
        <button type="button" id="cb-minus" aria-label="One zone fewer">&minus;</button>
        <input id="cb-count" type="text" inputmode="numeric" value="1" aria-label="Zones to claim">
        <button type="button" id="cb-plus" aria-label="One zone more">+</button>
      </div>
      <div class="cb-price" id="cb-price">&mdash;<small>LUNC</small></div>
      <button type="button" class="cb-buy" id="cb-buy" disabled>Connect wallet</button>
    </div>
    <div class="cb-meta" id="cb-meta">Zones are claimed back to back from the first free one.</div>
    <div class="cb-note" id="cb-note"></div>
  </div>`;

  function mount() {
    const stage = $('stage-circuit');
    if (!stage || $('cb-buy')) return false;
    const soon = stage.querySelector('.dg-cir-soon');
    if (!soon) return false;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.innerHTML = HTML;
    soon.replaceWith(box.firstElementChild);

    $('cb-minus').addEventListener('click', () => bump(-1));
    $('cb-plus').addEventListener('click', () => bump(+1));
    $('cb-count').addEventListener('input', onType);
    $('cb-count').addEventListener('blur', () => { $('cb-count').value = count; });
    $('cb-buy').addEventListener('click', onBuy);
    return true;
  }

  /* ── счётчик зон ───────────────────────────────────────────────────────── */

  function bump(d) {
    setCount(count + d);
  }
  function onType() {
    const n = parseInt($('cb-count').value.replace(/\D/g, ''), 10);
    setCount(isNaN(n) ? 1 : n, true);
  }
  function setCount(n, fromInput) {
    count = Math.max(1, Math.min(250, n));
    if (!fromInput) $('cb-count').value = count;
    scheduleQuote();
  }

  /* ── цена ──────────────────────────────────────────────────────────────── */

  function scheduleQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(refreshQuote, QUOTE_DEBOUNCE_MS);
  }

  async function refreshQuote() {
    const wallet = myWallet();
    if (!wallet) { quote = null; quoteErr = null; render(); return; }

    try {
      const r = await fetch(
        base() + '/circuit/quote?wallet=' + encodeURIComponent(wallet) + '&count=' + count,
        { signal: AbortSignal.timeout(10000) }
      );
      const d = await r.json().catch(() => ({}));
      if (r.ok) { quote = d; quoteErr = null; }
      else      { quote = null; quoteErr = d; }
    } catch (e) {
      quote = null;
      quoteErr = { error: 'network', reason: 'Price unavailable - check your connection.' };
    }
    render();
  }

  function render() {
    const priceEl = $('cb-price');
    const buyEl = $('cb-buy');
    const metaEl = $('cb-meta');
    if (!priceEl) return;

    if (busy) return; // во время покупки надписями управляет onBuy

    const wallet = myWallet();
    if (!wallet) {
      clearPreview();
      priceEl.innerHTML = '&mdash;<small>LUNC</small>';
      buyEl.disabled = true;
      buyEl.textContent = 'Connect wallet';
      metaEl.textContent = 'Connect a wallet holding an Oracle Mask to claim zones.';
      return;
    }

    if (quote) {
      priceEl.innerHTML = fmt(quote.totalLunc) + '<small>LUNC</small>';
      buyEl.disabled = false;
      buyEl.textContent = 'Claim ' + count + (count > 1 ? ' zones' : ' zone');
      const left = quote.cap - quote.owned;
      paintPreview(quote.wouldGet.from, quote.wouldGet.to);
      metaEl.innerHTML =
        'Zones <b>' + quote.wouldGet.from + '&ndash;' + quote.wouldGet.to + '</b> &middot; ' +
        '<b>' + quote.tier + '</b> mask, ' + left + ' of ' + quote.cap + ' left this round' +
        (quote.owned ? ' &middot; you hold <b>' + quote.owned + '</b>' : '') +
        ' &middot; next zone <b>' + fmt(quote.nextAfter / 1e6) + '</b> LUNC';
      return;
    }

    // Купить нельзя - объясняем почему и что делать.
    clearPreview();
    priceEl.innerHTML = '&mdash;<small>LUNC</small>';
    buyEl.disabled = true;
    buyEl.textContent = 'Claim zones';
    const e = quoteErr || {};
    if (e.error === 'no Oracle Mask') {
      buyEl.textContent = 'Oracle Mask required';
      metaEl.textContent = 'An Oracle Mask is the pass into Circuit. Mint one in the Draw tab - it works in every round.';
    } else if (e.error === 'tier cap exceeded') {
      metaEl.innerHTML = 'Your <b>' + e.tier + '</b> mask allows ' + e.cap +
        ' zones per round. You hold ' + e.owned + ' - ' + e.allowed + ' left. Lower the count to continue.';
      if (e.allowed > 0) { setTimeout(() => setCount(e.allowed), 0); }
    } else if (e.error === 'not enough zones left') {
      metaEl.innerHTML = 'Only <b>' + e.free + '</b> zones left on the board. Lower the count to continue.';
      if (e.free > 0) { setTimeout(() => setCount(e.free), 0); }
    } else {
      metaEl.textContent = e.reason || e.error || 'Price unavailable right now.';
    }
  }

  /* ── подсветка выбранных зон на доске ──────────────────────────────────── */
  // Красим ИНЛАЙНОВЫМ стилем, а не классом: refreshCircuit() в index.html
  // каждые 20 секунд переписывает className у всех клеток и стёр бы подсветку.
  // Инлайн переживает это, и чужой код трогать не нужно.
  //
  // Цвет нейтральный белый, а не бирюзовый: бирюза совпадала с цветом одного
  // из кошельков в палитре доски, и выбор было не отличить от чужого владения.
  // Белого в палитре нет, поэтому он читается однозначно как «сейчас выбираю».

  let painted = [];

  // Пульсацию отключаем тем, кто просил меньше движения в системе.
  const REDUCED = typeof matchMedia === 'function' &&
                  matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clearPreview() {
    painted.forEach((c) => {
      c.style.background = '';
      c.style.boxShadow = '';
      c.style.outline = '';
      c.style.opacity = '';
      c.style.animation = '';
    });
    painted = [];
  }

  function paintPreview(from, to) {
    clearPreview();
    const bd = $('cir-board');
    if (!bd || !bd.children.length) return;
    for (let k = from; k <= to && k < bd.children.length; k++) {
      const c = bd.children[k];
      if (!c) continue;
      c.style.background = 'rgba(255,255,255,.55)';
      c.style.boxShadow = '0 0 8px rgba(255,255,255,.55)';
      c.style.outline = '1px solid rgba(255,255,255,.9)';
      c.style.opacity = '1';
      if (!REDUCED) c.style.animation = 'cb-zone-pulse 2.4s ease-in-out infinite';
      painted.push(c);
    }
  }

  /* ── сообщения ─────────────────────────────────────────────────────────── */

  function note(kind, html) {
    const el = $('cb-note');
    if (!el) return;
    el.className = 'cb-note on ' + kind;
    el.innerHTML = html;
  }
  function clearNote() {
    const el = $('cb-note');
    if (el) { el.className = 'cb-note'; el.innerHTML = ''; }
  }
  const finderLink = (h) =>
    '<a href="https://finder.terraport.finance/mainnet/tx/' + h + '" target="_blank" rel="noopener">' +
    h.slice(0, 12) + '&hellip;</a>';

  /* ── покупка ───────────────────────────────────────────────────────────── */

  async function onBuy() {
    if (busy) return;
    const wallet = myWallet();
    if (!wallet) return;

    busy = true;
    clearNote();
    const buyEl = $('cb-buy');
    buyEl.disabled = true;

    try {
      // Цена берётся заново: свои же покупки в этом раунде её двигают.
      buyEl.textContent = 'Checking price...';
      const r = await fetch(
        base() + '/circuit/quote?wallet=' + encodeURIComponent(wallet) + '&count=' + count,
        { signal: AbortSignal.timeout(10000) }
      );
      const q = await r.json().catch(() => ({}));
      if (!r.ok) {
        quoteErr = q; quote = null;
        busy = false; render();
        return;
      }

      // Раунд нужен в memo, чтобы платёж был самодостаточен на цепочке.
      // Заодно ловим блокировку перед стартом раунда: сказать об этом до
      // открытия кошелька лучше, чем после подписи и потраченной комиссии.
      let roundId = '';
      try {
        const sr = await fetch(base() + '/circuit/state', { signal: AbortSignal.timeout(8000) });
        const sd = await sr.json();
        roundId = sd.roundId || '';
        if (sd.locked) {
          note('warn', 'The round is about to start - claiming is closed for a moment. ' +
                       'Your funds have not moved. Try again when the next round opens.');
          busy = false;
          render();
          return;
        }
      } catch (e) { /* состояние недоступно - идём дальше, воркер проверит сам */ }

      buyEl.textContent = 'Waiting for wallet...';
      note('warn', 'Approve the transfer in your wallet. Do not close this tab.');

      const send = (typeof window.sendLuncDirect === 'function')
        ? window.sendLuncDirect
        : (typeof sendLuncDirect === 'function' ? sendLuncDirect : null);
      if (!send) throw new Error('Wallet module not loaded. Reload the page.');

      const memo = roundId ? 'circuit:' + roundId + ':' + count : 'circuit:' + count;
      const txHash = await send(wallet, q.payTo, q.totalUluna, memo, chain());
      if (!txHash) throw new Error('No transaction hash returned.');

      // Сначала записываем, потом зачитываем: между этими шагами покупку
      // терять нельзя.
      const pending = { wallet, count, txHash, at: Date.now() };
      savePending(pending);

      await settle(pending);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (/reject|denied|cancel|4001/i.test(msg)) clearNote();
      else note('err', 'Could not send the transaction. ' + msg);
    } finally {
      busy = false;
      render();
    }
  }

  /** Зачёт оплаченной покупки. Вызывается и после оплаты, и при загрузке
      страницы, если в localStorage остался неподтверждённый хеш. */
  async function settle(p) {
    const buyEl = $('cb-buy');

    for (let i = 0; i <= RETRY_MS.length; i++) {
      let r, d;
      try {
        r = await fetch(base() + '/circuit/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: p.wallet, count: p.count, txHash: p.txHash })
        });
        d = await r.json().catch(() => ({}));
      } catch (e) {
        d = { error: 'network' };
        r = { status: 0, ok: false };
      }

      // Успех - либо сейчас, либо транзакция уже была зачтена раньше
      // (её вернёт 409 'tx already used' с тем же блоком зон).
      const already = r.status === 409 && /already used/i.test(d.error || '');
      if ((r.status === 200 && d.ok) || already) {
        clearPending();
        const b = d.block || {};
        note('ok', 'Zones <b>' + b.from + '&ndash;' + b.to + '</b> are yours. ' +
                   finderLink(p.txHash) +
                   (d.boardFull ? '<br>The board is full - the round starts in a moment.' : ''));
        if (buyEl) buyEl.textContent = 'Claim zones';
        refreshBoard();
        scheduleQuote();
        return true;
      }

      // 202 - оплата ещё не в индексе. Это ожидаемо в первые секунды.
      if (r.status === 202 || d.pending) {
        if (buyEl) buyEl.textContent = 'Confirming...';
        note('warn', '<span class="cb-spin"></span>Payment sent, waiting for the chain to confirm it. ' +
                     finderLink(p.txHash));
        if (i < RETRY_MS.length) { await sleep(RETRY_MS[i]); continue; }
        break;
      }

      // Сеть моргнула - пробуем ещё, оплата уже прошла.
      if (r.status === 0) {
        if (i < RETRY_MS.length) { await sleep(RETRY_MS[i]); continue; }
        break;
      }

      // Настоящий отказ воркера. Деньги ушли, зоны не выданы - говорим прямо.
      stuck(p, d.error || 'Round rejected the payment.');
      return false;
    }

    stuck(p, 'The chain is slow to confirm.');
    return false;
  }

  /** Оплата прошла, зачёт - нет. Хеш остаётся в localStorage, даём кнопку. */
  function stuck(p, why) {
    note('err',
      '<b>Payment sent, zones not credited yet.</b><br>' + why +
      ' Your transaction ' + finderLink(p.txHash) +
      ' is saved - retry below, or reopen this page later and it will finish on its own. ' +
      'Nothing is lost and you will not be charged twice.' +
      '<br><button type="button" id="cb-retry">Retry now</button>');
    const btn = $('cb-retry');
    if (btn) btn.addEventListener('click', async () => {
      btn.disabled = true;
      note('warn', '<span class="cb-spin"></span>Retrying...');
      await settle(p);
    });
  }

  function savePending(p) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch (e) {}
  }
  function clearPending() {
    try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
  }
  function loadPending() {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      // Защита от повторного зачёта живёт в воркере 7 суток; старше - бесполезно.
      if (!p || !p.txHash || Date.now() - p.at > 7 * 24 * 3600 * 1000) { clearPending(); return null; }
      return p;
    } catch (e) { return null; }
  }

  /* ── доска после покупки ───────────────────────────────────────────────── */
  // Свой лёгкий апдейт, чтобы не ждать двадцатисекундного интервала в index.html.
  async function refreshBoard() {
    try {
      const r = await fetch(base() + '/circuit/state', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      const d = await r.json();
      const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
      set('cir-sold', d.sold);
      set('cir-pool', fmt(d.poolUluna / 1e6));
      set('dg-circuit-zones', d.sold);
      const bar = $('dg-circuit-bar');
      if (bar) bar.style.width = (d.sold / d.maxZones * 100) + '%';
      clearPreview();
      const bd = $('cir-board');
      if (bd && bd.children.length === d.maxZones) {
        Array.prototype.forEach.call(bd.children, (c, k) => { c.className = k < d.sold ? 't' : ''; });
      }
    } catch (e) {}
  }

  /* ── старт ─────────────────────────────────────────────────────────────── */

  function boot() {
    if (!mount()) return;

    // Кошелёк подключается асинхронно и может смениться - следим и
    // перезапрашиваем цену, отдельного события в app.js нет.
    setInterval(() => {
      const w = myWallet();
      if (w !== lastWallet) { lastWallet = w; scheduleQuote(); }
    }, 1000);

    const p = loadPending();
    if (p) {
      note('warn', '<span class="cb-spin"></span>Finishing your previous purchase&hellip;');
      settle(p);
    }
    scheduleQuote();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
