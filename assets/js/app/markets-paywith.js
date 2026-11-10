/**
 * markets-paywith.js - прогноз на рынок любым токеном из списка.
 *
 * Над суммой в блоке прогноза - строка "Pay with": LUNC и токены, у которых
 * есть прямой пул к LUNC (список и пулы - orbitwire-proxy /tokens). Выбран
 * токен - одной транзакцией, одной подписью:
 *   1. обмен токена на LUNC в пуле, выбранном прокси (/route);
 *   2. прогноз этими LUNC.
 * Прогноз отправляется на минимум: ожидаемый выход за вычетом налога сети
 * (дважды: выход пула и перевод в рынок) и 1% на движение цены. Дал обмен
 * меньше - прогноз не проходит, и вся транзакция откатывается целиком:
 * токены остаются у человека. Дал больше - разница остаётся на кошельке.
 *
 * Обратно - "Collect as": выплату из рынка можно сразу получить в токене
 * из того же списка (claim + обмен одной транзакцией).
 *
 * Только mainnet: на тестнете этих токенов нет. Прогноз в LUNC идёт старым
 * путём, этот модуль его не трогает.
 * Загружать ПОСЛЕ markets.js и contract-exec.js.
 */
(function () {
  'use strict';

  /**
   * После публикации - сразу открыть новый рынок создателя. Номер рынка
   * берётся из событий транзакции создания (атрибут market_id), а не
   * угадывается: так первый прогноз точно уходит в его рынок.
   * Работает и на тестнете; выбор токена ниже - только mainnet.
   */
  window.mkOpenCreated = async function (hash) {
    let id = null;
    for (const base of PROPHECY_LCD) {
      try {
        const r = await fetch(`${base}/cosmos/tx/v1beta1/txs/${hash}`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const j = await r.json();
        for (const ev of (j.tx_response && j.tx_response.events) || []) {
          if (ev.type !== 'wasm') continue;
          // Узлы старых версий отдают атрибуты в base64.
          const list = ev.attributes || [];
          const plain = list.some((a) => a.key === 'action' || a.key === '_contract_address');
          const dec = (x) => { if (plain || typeof x !== 'string') return x; try { return atob(x); } catch (e) { return x; } };
          const at = {};
          list.forEach((a) => { at[dec(a.key)] = dec(a.value); });
          if (at._contract_address === PROPHECY_CONTRACT && at.action === 'create' && at.market_id) id = Number(at.market_id);
        }
        if (id) break;
      } catch (e) { /* следующий узел */ }
    }
    if (!id) { if (typeof renderMarkets === 'function') renderMarkets(false); return; }
    await openProphecyMarket(id);
    const tokensHint = PROPHECY_TESTNET ? '' : ' Pay with LUNC or with USTC, TERRA, JURIS and other tokens.';
    if (typeof mkToast === 'function') mkToast(`Your market is live. Make the first prediction so the next player has a rival.${tokensHint}`, 'ok');
  };

  if (typeof PROPHECY_TESTNET !== 'undefined' && PROPHECY_TESTNET) return;

  const PROXY = 'https://orbitwire-proxy.vladislav-baydan.workers.dev';
  const SLIP = 0.01;              // запас на движение цены между расчётом и блоком
  const GAS = 1200000;            // обмен + прогноз

  let tokens = null;              // [{ symbol, available, address, decimals, dex, pool, ... }]
  let pay = 'LUNC';
  let quote = null;               // ответ /route для текущей суммы
  let quoteKey = '';
  let timer = null;

  const esc = (s) => (typeof mktEsc === 'function' ? mktEsc(s) : String(s));
  // Логотип токена: LUNC - картинка сайта, остальные - через прокси (/logo),
  // чтобы CSP сайта разрешал один адрес, а не каждый сервер логотипов.
  const logo = (sym) => (sym === 'LUNC' ? 'assets/img/lunc.webp' : `${PROXY}/logo?sym=${encodeURIComponent(sym)}`);
  const chip = (attr, sym, on) => `<button type="button" ${attr}="${esc(sym)}" aria-pressed="${on}">`
    + `<img src="${logo(sym)}" alt="" width="18" height="18" loading="lazy" onerror="this.remove()"><span>${esc(sym)}</span></button>`;
  const tok = () => (tokens || []).find((t) => t.symbol === pay);
  const fmt = (n, d) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d == null ? 0 : d });

  async function loadTokens() {
    if (tokens) return tokens;
    try {
      const r = await fetch(PROXY + '/tokens', { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      tokens = (j.tokens || []).filter((t) => t.available);
    } catch (e) { tokens = []; }
    return tokens;
  }

  /** Сумма в поле - в единицах выбранного токена (дробная для токенов). */
  function amountInput() {
    const raw = (document.getElementById('bet-amount') || {}).value || '';
    const clean = String(raw).replace(/,/g, '').replace(/[^0-9.]/g, '');
    const v = Number(clean);
    return isFinite(v) && v > 0 ? clean : '';
  }

  function toRaw(str, decimals) {
    const [i, f = ''] = str.split('.');
    return (BigInt(i || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
  }

  /** Сколько LUNC уйдёт в прогноз, в uluna. */
  function minOut(q) {
    const tax = typeof mkTaxRate === 'function' ? mkTaxRate() : 0.005;
    const keep = 1 - SLIP - 2 * tax;
    return BigInt(Math.floor(Number(q.return_uluna) * Math.max(0, keep)));
  }

  // ── строка выбора ──────────────────────────────────────────────────────────
  function inject() {
    const box = document.querySelector('#markets-list .mk-betbox');
    if (!box || box.querySelector('.mk-pay') || !tokens || !tokens.length) return;
    const chips = ['LUNC', ...tokens.map((t) => t.symbol)].map((s) => chip('data-pay', s, s === pay)).join('');
    box.insertAdjacentHTML('afterbegin', `<div class="mk-pay"><span>Pay with</span><div class="mk-pay-row">${chips}</div></div>`);
    const amountRow = box.querySelector('.mk-amount');
    if (amountRow) {
      amountRow.insertAdjacentHTML('afterend', `<div class="mk-slide">
        <div class="mk-slide-top"><span class="mk-bal">Balance: …</span></div>
        <input type="range" class="mk-range" min="0" max="100" step="1" value="0" aria-label="Share of your balance">
        <div class="mk-pct">${[25, 50, 75].map((p) => `<button type="button" data-pct="${p}">${p}%</button>`).join('')}<button type="button" data-pct="100">Max</button></div>
      </div>`);
      const slide = box.querySelector('.mk-slide');
      const range = slide.querySelector('.mk-range');
      range.addEventListener('input', () => applyPct(Number(range.value)));
      slide.querySelector('.mk-pct').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-pct]');
        if (b) applyPct(Number(b.dataset.pct));
      });
      // Ввод руками - ползунок встаёт на соответствующую долю.
      const inp = document.getElementById('bet-amount');
      if (inp) inp.addEventListener('input', followInput);
    }
    box.querySelector('.mk-pay').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-pay]');
      if (!b) return;
      pay = b.dataset.pay;
      quote = null; quoteKey = '';
      const inp = document.getElementById('bet-amount');
      if (inp) inp.value = '';
      sync();
      paintBalance();
      window.updateBetCalc();
    });
    sync();
    paintBalance();
  }

  // ── ползунок: доля баланса ─────────────────────────────────────────────────
  // LUNC: сверху вычитаются газ и налог сети, иначе "Max" упирается в
  // нехватку средств на комиссию, и ограничивает максимум рынка на сторону.
  // Токен: весь баланс - газ платится в LUNC отдельно.
  const GAS_RESERVE_LUNC = 100;
  let balance = null;   // { sym, raw, decimals }
  let lastForce = 0;

  async function paintBalance(force) {
    // Блок прогноза перерисовывается после каждой транзакции - баланс берём
    // свежий, но не чаще раза в 15 с.
    if (force === undefined) force = Date.now() - lastForce > 15000;
    if (force) lastForce = Date.now();
    const box = document.querySelector('#markets-list .mk-slide');
    if (!box) return;
    const lbl = box.querySelector('.mk-bal');
    if (!mkWallet()) { lbl.textContent = 'Connect a wallet to use your balance'; box.classList.add('off'); return; }
    box.classList.remove('off');
    const want = pay;
    try {
      const rows = window.walletBalances ? await window.walletBalances.get(force) : null;
      const r = rows && rows.find((x) => x.symbol === want);
      if (want !== pay) return;
      balance = r && r.raw !== null ? { sym: want, raw: r.raw, decimals: r.decimals } : null;
    } catch (e) { balance = null; }
    lbl.innerHTML = balance
      ? `Balance: <b>${fmt(Number(balance.raw) / 10 ** balance.decimals, balance.decimals > 0 ? 4 : 0)} ${esc(want)}</b>`
      : 'Balance unavailable';
    followInput();
  }

  /** Доступно для прогноза, в единицах токена. Проценты ползунка - от
   *  этого числа; максимум рынка на сторону - только потолок суммы. */
  function usable() {
    if (!balance || balance.sym !== pay) return 0;
    let v = Number(balance.raw) / 10 ** balance.decimals;
    if (pay === 'LUNC') {
      const tax = typeof mkTaxRate === 'function' ? mkTaxRate() : 0.005;
      return Math.floor(Math.max(0, v * (1 - tax) - GAS_RESERVE_LUNC));
    }
    return v;
  }
  /** Потолок суммы: для LUNC - максимум рынка на сторону. */
  function cap(v) {
    if (pay !== 'LUNC') return v;
    const max = prophecyCfg ? Number(prophecyCfg.max_bet) / 1e6 : 0;
    return max ? Math.min(v, max) : v;
  }

  function applyPct(p) {
    const inp = document.getElementById('bet-amount');
    const u = usable();
    if (!inp || !u) return;
    let v = cap((u * p) / 100);
    // LUNC - целые; токен - до 6 знаков, вниз, чтобы не превысить баланс.
    v = pay === 'LUNC' ? Math.floor(v) : Math.floor(v * 1e6) / 1e6;
    inp.value = pay === 'LUNC' ? String(v) : String(v);
    const range = document.querySelector('#markets-list .mk-range');
    if (range) range.value = String(p);
    markPct(p);
    window.updateBetCalc();
  }

  function followInput() {
    const range = document.querySelector('#markets-list .mk-range');
    if (!range) return;
    const u = usable();
    const v = Number(String((document.getElementById('bet-amount') || {}).value || '').replace(/,/g, '')) || 0;
    const p = u ? Math.min(100, Math.round((v / u) * 100)) : 0;
    range.value = String(p);
    range.style.setProperty('--p', p + '%');
    markPct(null);
  }

  function markPct(p) {
    const range = document.querySelector('#markets-list .mk-range');
    if (range && p != null) range.style.setProperty('--p', p + '%');
    document.querySelectorAll('#markets-list .mk-pct button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.pct) === p)));
  }

  /** Подписи и пресеты под выбранный токен. */
  function sync() {
    const box = document.querySelector('#markets-list .mk-betbox');
    if (!box) return;
    box.querySelectorAll('.mk-pay button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pay === pay)));
    const em = box.querySelector('.mk-amount em');
    if (em) em.textContent = pay;
    const inp = document.getElementById('bet-amount');
    if (inp) inp.setAttribute('inputmode', pay === 'LUNC' ? 'numeric' : 'decimal');
    // Пресеты 10K-500K - в LUNC; для токена они не имеют смысла.
    const chips = box.querySelector('.mk-chips');
    if (chips) chips.hidden = pay !== 'LUNC';
  }

  // ── расчёт ────────────────────────────────────────────────────────────────
  const origCalc = window.updateBetCalc;
  window.updateBetCalc = function () {
    if (pay === 'LUNC' || !tok()) return origCalc.apply(this, arguments);
    const m = window._prophecyMarket;
    const box = document.getElementById('bet-calc');
    const btn = document.getElementById('bet-go');
    const side = betSide ? 'YES' : 'NO';
    const t = tok();
    const amt = amountInput();
    if (!m || !box) return;
    if (!amt) {
      box.textContent = `Enter an amount of ${t.symbol}. It is swapped to LUNC and predicted in the same transaction.`;
      if (btn && !btn.disabled) btn.textContent = `Choose an amount to predict ${side}`;
      return;
    }
    const raw = toRaw(amt, t.decimals);
    const key = t.symbol + ':' + raw;
    if (quote && quoteKey === key) return paintQuote(m, t, amt, side, box, btn);
    box.innerHTML = `<div class="row muted"><span>Finding the best ${esc(t.symbol)} → LUNC pool</span><b>…</b></div>`;
    if (btn && !btn.disabled) btn.textContent = 'Getting a quote…';
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const r = await fetch(`${PROXY}/route?token=${encodeURIComponent(t.symbol)}&amount=${raw}`, { signal: AbortSignal.timeout(10000) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'no route');
        if (key !== t.symbol + ':' + toRaw(amountInput() || '0', t.decimals)) return;   // сумму уже поменяли
        quote = j; quoteKey = key;
        paintQuote(m, t, amt, side, box, btn);
      } catch (e) {
        quote = null;
        box.innerHTML = `<div class="row muted"><span>No swap route right now</span><b>${esc(e.message || 'try again')}</b></div>`;
        if (btn && !btn.disabled) btn.textContent = 'Swap unavailable';
      }
    }, 450);
  };

  function paintQuote(m, t, amt, side, box, btn) {
    const outLunc = Number(quote.return_uluna) / 1e6;
    const pred = minOut(quote);
    const predLunc = Number(pred) / 1e6;
    const min = prophecyCfg ? Number(prophecyCfg.min_bet) / 1e6 : 0;
    const max = prophecyCfg ? Number(prophecyCfg.max_bet) / 1e6 : 0;
    const head = `<div class="row"><span>You pay</span><b>${fmt(amt, 6)} ${esc(t.symbol)}</b></div>
      <div class="row"><span>Swap on ${esc(quote.dex)}</span><b>≈ ${fmt(outLunc)} LUNC</b></div>`;
    if ((min && predLunc < min) || (max && predLunc > max)) {
      box.innerHTML = head + `<div class="row muted"><span>${predLunc < min ? 'Below the minimum' : 'Above the maximum'} of this market</span>
        <b>${fmt(predLunc < min ? min : max)} LUNC</b></div>`;
      if (btn && !btn.disabled) btn.textContent = predLunc < min ? 'Amount too small' : 'Amount too large';
      return;
    }
    const mult = payoutMultiplier(m, betSide, Number(pred));
    const payout = Math.floor(predLunc * mult);
    box.innerHTML = head + `
      <div class="row"><span>Predicted ${side}</span><b>${fmt(predLunc)} LUNC</b></div>
      <div class="row"><span>If ${side} wins</span><b class="y">${fmt(payout)} LUNC</b></div>
      <div class="row muted"><span>Payout</span><b>in LUNC, or back in ${esc(t.symbol)} with "Collect as"</b></div>
      <div class="row muted"><span>Kept aside for price move and tax</span><b>${fmt(outLunc - predLunc)} LUNC, stays in your wallet</b></div>
      ${quote.impact_bps > 300 ? `<div class="row muted"><span>Thin pool: the swap costs</span><b>${(quote.impact_bps / 100).toFixed(1)}%</b></div>` : ''}`;
    if (btn && !btn.disabled) btn.textContent = `Swap & predict ${side} · ${fmt(predLunc)} LUNC →`;
  }

  // ── отправка ──────────────────────────────────────────────────────────────
  const origSubmit = window.submitBet;
  window.submitBet = async function () {
    if (pay === 'LUNC' || !tok()) return origSubmit.apply(this, arguments);
    const m = window._prophecyMarket;
    const btn = document.getElementById('bet-go');
    const t = tok();
    if (!m || !btn) return;
    if (!mkWallet()) { mkToast('Connect a wallet first.', 'info'); return; }
    const amt = amountInput();
    if (!amt || !quote || quoteKey !== t.symbol + ':' + toRaw(amt, t.decimals)) { window.updateBetCalc(); return; }
    // Котировка старше 30 с - пересчитать перед подписью.
    if (Date.now() / 1000 - quote.at > 30) { quote = null; window.updateBetCalc(); mkToast('The price was refreshed. Check the amount and confirm again.', 'info'); return; }

    const raw = toRaw(amt, t.decimals);
    const pred = minOut(quote);
    const info = quote.token.info;
    // Обмен: родной токен - сообщение пулу с монетами; CW20 - send токену
    // с вложенным swap для пула. max_spread мягкий: жёсткую защиту даёт
    // сумма прогноза ниже - меньше LUNC после обмена, и всё откатится.
    const swap = info.native_token
      ? { contract: quote.pool, msg: { swap: { offer_asset: { info, amount: raw }, max_spread: '0.05' } }, funds: [{ denom: info.native_token.denom, amount: raw }] }
      : { contract: info.token.contract_addr, msg: { send: { contract: quote.pool, amount: raw, msg: btoa(JSON.stringify({ swap: { max_spread: '0.05' } })) } }, funds: [] };
    const predict = {
      contract: PROPHECY_CONTRACT,
      msg: { [PROPHECY_NET.predictMsg]: { market_id: m.id, side: betSide } },
      funds: [{ denom: 'uluna', amount: pred.toString() }],
    };

    btn.disabled = true;
    btn.textContent = 'Confirm in your wallet…';
    try {
      const hash = await window.sendExecuteMany(mkWallet(), [swap, predict],
        `oracle-prophecy: ${t.symbol} -> LUNC, prediction ${m.id}`, PROPHECY_CHAIN, GAS);
      if (window.OracleSound) window.OracleSound.play('coin');
      btn.textContent = 'Waiting for the block…';
      await mkTrack(hash, 'Swap and prediction', (r) => {
        quote = null;
        openProphecyMarket(m.id);
        if (typeof renderHomeMarkets === 'function') renderHomeMarkets();
        if (r.status === 'failed') {
          btn.disabled = false;
          mkToast('Nothing was spent: the swap gave less LUNC than needed or the market refused, so the whole transaction was undone.', 'err');
        }
      });
    } catch (e) {
      mkToast(e.message || 'Transaction failed', 'err');
      btn.disabled = false;
      window.updateBetCalc();
    }
  };

  // ── выплата в токене: "Collect as" ────────────────────────────────────────
  // Пул рынка весь в LUNC, и выплата из контракта - в LUNC. Выбран токен -
  // одной транзакцией: claim, затем обмен полученных LUNC на токен. Сумма
  // выплаты известна заранее (позиция в контракте), поэтому обмен считается
  // точно. Защита - belief_price + max_spread 1%: дал пул меньше - вся
  // транзакция откатывается, и выплата остаётся в контракте до следующей
  // попытки.
  let collectAs = 'LUNC';
  let cquote = null;

  /** Сколько LUNC уйдёт в обмен: выплата за вычетом налога сети с запасом. */
  function swapIn(payoutU) {
    const tax = typeof mkTaxRate === 'function' ? mkTaxRate() : 0.005;
    return BigInt(Math.floor(Number(payoutU) * Math.max(0, 1 - tax - 0.002)));
  }

  /** belief_price = сколько uluna за одну единицу токена, Decimal с 18 знаками. */
  function belief(offerU, retRaw) {
    const v = (BigInt(offerU) * 10n ** 18n) / BigInt(retRaw);
    const str = v.toString().padStart(19, '0');
    return (str.slice(0, -18) + '.' + str.slice(-18)).replace(/\.?0+$/, '');
  }

  async function myPayout() {
    const m = window._prophecyMarket;
    if (!m || !mkWallet()) return null;
    try {
      const pos = await prophecyQuery({ position: { market_id: m.id, address: mkWallet() } });
      return pos && !pos.claimed && Number(pos.payout) > 0 ? String(pos.payout) : null;
    } catch (e) { return null; }
  }

  function injectCollect() {
    const btn = document.querySelector('#markets-list button[onclick="submitClaim()"]');
    if (!btn || btn.previousElementSibling && btn.previousElementSibling.classList.contains('mk-pay')) return;
    const chips = ['LUNC', ...tokens.map((t) => t.symbol)].map((s) => chip('data-cas', s, s === collectAs)).join('');
    btn.insertAdjacentHTML('beforebegin', `<div class="mk-pay mk-cas"><span>Collect as</span><div class="mk-pay-row">${chips}</div><p class="mk-cas-q"></p></div>`);
    const row = btn.previousElementSibling;
    row.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-cas]');
      if (!b) return;
      collectAs = b.dataset.cas;
      cquote = null;
      row.querySelectorAll('button[data-cas]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.cas === collectAs)));
      paintCollect(row, btn);
    });
    paintCollect(row, btn);
  }

  async function paintCollect(row, btn) {
    const q = row.querySelector('.mk-cas-q');
    const label = btn.dataset.label || (btn.dataset.label = btn.textContent.trim());
    if (collectAs === 'LUNC') { q.textContent = ''; btn.textContent = label; return; }
    const t = tok2(collectAs);
    q.textContent = `Getting a ${collectAs} quote…`;
    const payout = await myPayout();
    if (!payout || !t) { q.textContent = 'Nothing to collect yet.'; return; }
    const offer = swapIn(payout);
    try {
      const r = await fetch(`${PROXY}/route?token=${encodeURIComponent(t.symbol)}&amount=${offer}&dir=from_lunc`, { signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'no route');
      if (collectAs !== t.symbol) return;
      cquote = { ...j, offer: offer.toString(), payout };
      const out = Number(j.return_amount) / 10 ** t.decimals;
      q.innerHTML = `Payout ${fmt(Number(payout) / 1e6)} LUNC. After the network tax, ${fmt(Number(offer) / 1e6)} LUNC is swapped on ${esc(j.dex)}: you receive <b>≈ ${fmt(out, out < 100 ? 4 : 2)} ${esc(t.symbol)}</b>. If the price moves more than 1% before the block, nothing happens and you can try again.`;
      btn.textContent = `Collect as ${t.symbol} →`;
    } catch (e) {
      cquote = null;
      q.textContent = `No ${collectAs} route right now (${e.message}). Collect in LUNC or try again.`;
      btn.textContent = label;
    }
  }

  const tok2 = (sym) => (tokens || []).find((t) => t.symbol === sym);

  const origClaim = window.submitClaim;
  window.submitClaim = async function () {
    if (collectAs === 'LUNC') return origClaim.apply(this, arguments);
    const m = window._prophecyMarket;
    if (!m || !mkWallet()) return;
    if (!cquote || Date.now() / 1000 - cquote.at > 30) {
      const row = document.querySelector('#markets-list .mk-cas');
      const btn = document.querySelector('#markets-list button[onclick="submitClaim()"]');
      if (row && btn) await paintCollect(row, btn);
      mkToast('The price was refreshed. Check the amount and press Collect again.', 'info');
      return;
    }
    const claim = { contract: PROPHECY_CONTRACT, msg: { claim: { market_id: m.id } }, funds: [] };
    const swap = {
      contract: cquote.pool,
      msg: { swap: { offer_asset: { info: { native_token: { denom: 'uluna' } }, amount: cquote.offer },
        belief_price: belief(cquote.offer, cquote.return_amount), max_spread: '0.01' } },
      funds: [{ denom: 'uluna', amount: cquote.offer }],
    };
    try {
      const hash = await window.sendExecuteMany(mkWallet(), [claim, swap],
        `oracle-prophecy: claim ${m.id} as ${collectAs}`, PROPHECY_CHAIN, 1300000);
      await mkTrack(hash, `Payout in ${collectAs}`, (r) => {
        cquote = null;
        openProphecyMarket(m.id);
        if (r.status === 'failed') mkToast('Nothing changed: the price moved more than 1%, so the payout stayed in the market. Try again or collect in LUNC.', 'err');
      });
    } catch (e) {
      mkToast(e.message || 'Transaction failed', 'err');
    }
  };

  window.addEventListener('oracle:wallet', () => { balance = null; setTimeout(() => paintBalance(true), 100); });

  // ── связка ────────────────────────────────────────────────────────────────
  function start() {
    loadTokens().then(() => { inject(); injectCollect(); });
    const list = document.getElementById('markets-list');
    if (list) new MutationObserver(() => { if (tokens) { inject(); injectCollect(); } }).observe(list, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
