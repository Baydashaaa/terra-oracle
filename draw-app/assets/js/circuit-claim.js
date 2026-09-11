/* ═══════════════════════════════════════════════════════════════════════════
   CIRCUIT - получение наград TCO
   ---------------------------------------------------------------------------
   Панель «Your TCO rewards» с кнопкой Claim внутри #stage-circuit.

   ПОДКЛЮЧЕНИЕ: обычный <script>, ПОСЛЕ app.js и oracle-mint-v2.js -
   отсюда берутся CHAIN_ID, адрес кошелька и window.sendExecuteContract.

   Как это работает. Скрипт эпохи публикует в контракт корень НАКОПИТЕЛЬНОГО
   дерева и кладёт рядом с сайтом rewards-proofs.json с пруфами. В листе
   лежит «начислено за всё время», контракт помнит забранное и выдаёт
   разницу. Поэтому забирать можно когда угодно и за сколько угодно эпох
   сразу - ничего не сгорает.

   Отсюда же главное правило интерфейса: если доступная сумма меньше
   комиссии, честнее сказать «подожди», чем дать человеку потратить больше,
   чем он получит. Ради этого накопительная схема и выбиралась.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const CONTRACT = 'terra18pau9q25ykswgey8ckcfxhdln27nk23qv6af0pjs2vye5r5crmcs7w9fr0';
  const TCO_BOND = 'terra1xnejslpfa398nn2mexv34y8737fcq998zz4dsnq74qn464lu9m4s604du5';
  const PROOFS   = 'rewards-proofs.json';

  const LCD_NODES = [
    'https://terra-classic-lcd.publicnode.com',
    'https://rest.cosmos.directory/terraclassic',
    'https://terra-classic-lcd.hexxagon.io',
  ];

  // Примерная комиссия claim в LUNC. Ниже этого забирать бессмысленно.
  const CLAIM_FEE_LUNC = 17;

  const $ = (id) => document.getElementById(id);
  const chain = () => (typeof CHAIN_ID !== 'undefined' ? CHAIN_ID : 'columbus-5');

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

  // TCO с шестью знаками, как LUNC
  const tco = (u) => (Number(u) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });

  let proofsFile = null;    // содержимое rewards-proofs.json
  let myEntry = null;       // { amount, proof } для текущего кошелька
  let claimable = 0n;
  let price = 0;            // LUNC за один TCO, для оценки выгодности
  let busy = false;
  let lastWallet = null;

  /* ── запросы ───────────────────────────────────────────────────────────── */

  async function smartQuery(contract, msg) {
    const q = btoa(JSON.stringify(msg));
    let lastErr;
    for (const node of LCD_NODES) {
      try {
        const r = await fetch(`${node}/cosmwasm/wasm/v1/contract/${contract}/smart/${q}`,
                              { signal: AbortSignal.timeout(10000) });
        const d = await r.json();
        if (d.data !== undefined) return d.data;
        lastErr = new Error(d.message || 'bad response');
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('query failed');
  }

  /* ── разметка ──────────────────────────────────────────────────────────── */

  const CSS = `
  .cc { margin-top: 16px; border-top: 1px solid rgba(56,217,208,.18); padding-top: 16px; }
  .cc-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .cc-label { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #7fa8a5; }
  .cc-amt { font-size: 22px; font-weight: 700; color: #38d9d0; }
  .cc-amt small { font-size: 12px; font-weight: 500; color: #7fa8a5; margin-left: 6px; }
  .cc-btn { margin-left: auto; min-height: 42px; padding: 0 22px; border-radius: 10px;
    border: 1px solid #38d9d0; background: rgba(56,217,208,.14); color: #38d9d0;
    font-size: 15px; font-weight: 600; cursor: pointer; transition: background .15s; }
  .cc-btn:hover:not(:disabled) { background: rgba(56,217,208,.26); }
  .cc-btn:disabled { opacity: .45; cursor: default; }
  .cc-btn:focus-visible { outline: 2px solid #38d9d0; outline-offset: 2px; }
  .cc-meta { margin-top: 9px; font-size: 13px; color: #7fa8a5; line-height: 1.6; }
  .cc-meta b { color: #cfe9e7; font-weight: 600; }
  .cc-note { margin-top: 11px; padding: 10px 13px; border-radius: 9px; font-size: 13px;
    line-height: 1.55; display: none; }
  .cc-note.on { display: block; }
  .cc-note.warn { background: rgba(244,208,63,.09); border: 1px solid rgba(244,208,63,.3); color: #f0dda0; }
  .cc-note.err  { background: rgba(255,107,107,.09); border: 1px solid rgba(255,107,107,.3); color: #ffb3b3; }
  .cc-note.ok   { background: rgba(56,217,208,.09); border: 1px solid rgba(56,217,208,.3); color: #a8ece8; }
  .cc-note a { color: inherit; text-decoration: underline; }
  @media (max-width: 560px) { .cc-btn { margin-left: 0; flex-basis: 100%; } }
  `;

  const HTML = `
  <div class="cc">
    <div class="cc-row">
      <div>
        <div class="cc-label">Your TCO rewards</div>
        <div class="cc-amt" id="cc-amt">&mdash;<small>TCO</small></div>
      </div>
      <button type="button" class="cc-btn" id="cc-btn" disabled>Claim</button>
    </div>
    <div class="cc-meta" id="cc-meta">Every zone you claim earns a share of the TCO bought back each epoch.</div>
    <div class="cc-note" id="cc-note"></div>
  </div>`;

  function mount() {
    const stage = $('stage-circuit');
    if (!stage || $('cc-btn')) return false;
    const panel = stage.querySelector('.dg-panel');
    if (!panel) return false;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.innerHTML = HTML;
    panel.appendChild(box.firstElementChild);

    $('cc-btn').addEventListener('click', onClaim);
    return true;
  }

  function note(kind, html) {
    const el = $('cc-note');
    if (!el) return;
    el.className = 'cc-note on ' + kind;
    el.innerHTML = html;
  }
  function clearNote() {
    const el = $('cc-note');
    if (el) { el.className = 'cc-note'; el.innerHTML = ''; }
  }

  /* ── обновление состояния ──────────────────────────────────────────────── */

  async function loadProofs() {
    try {
      const r = await fetch(PROOFS + '?t=' + Date.now(), { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;          // файла ещё нет - эпоха не запускалась
      return await r.json();
    } catch (e) { return null; }
  }

  async function refresh() {
    if (busy) return;
    const wallet = myWallet();
    const amtEl = $('cc-amt');
    const btnEl = $('cc-btn');
    const metaEl = $('cc-meta');
    if (!amtEl) return;

    if (!wallet) {
      amtEl.innerHTML = '&mdash;<small>TCO</small>';
      btnEl.disabled = true;
      metaEl.textContent = 'Connect your wallet to see your rewards.';
      return;
    }

    if (!proofsFile) proofsFile = await loadProofs();

    if (!proofsFile) {
      amtEl.innerHTML = '&mdash;<small>TCO</small>';
      btnEl.disabled = true;
      metaEl.innerHTML = 'Rewards start after the first epoch. Your share is already being ' +
                         'recorded in LUNC with every round you take part in.';
      return;
    }

    myEntry = (proofsFile.proofs || {})[wallet] || null;

    if (!myEntry) {
      // Начислений нет - но, может, кошелёк уже всё забрал раньше
      let claimed = '0';
      try { claimed = (await smartQuery(CONTRACT, { claimed: { address: wallet } })).claimed; }
      catch (e) {}
      amtEl.innerHTML = '0<small>TCO</small>';
      btnEl.disabled = true;
      metaEl.innerHTML = Number(claimed) > 0
        ? 'Nothing new to claim. You have taken <b>' + tco(claimed) + ' TCO</b> so far.'
        : 'No rewards yet - take zones in a round that actually draws, and your share appears here.';
      return;
    }

    let res;
    try {
      res = await smartQuery(CONTRACT, {
        claimable: { address: wallet, amount: myEntry.amount, proof: myEntry.proof },
      });
    } catch (e) {
      amtEl.innerHTML = '&mdash;<small>TCO</small>';
      btnEl.disabled = true;
      metaEl.textContent = 'Could not reach the rewards contract. Try again in a moment.';
      return;
    }

    // Пруф не сошёлся с опубликованным корнем - файл устарел относительно
    // контракта. Молчать нельзя: человек видит цифру и не может её забрать.
    if (!res.proof_valid) {
      amtEl.innerHTML = '&mdash;<small>TCO</small>';
      btnEl.disabled = true;
      metaEl.innerHTML = 'The proof file is out of step with the contract - this usually ' +
                         'clears within a few minutes of a new epoch. Nothing is lost.';
      return;
    }

    claimable = BigInt(res.claimable);
    amtEl.innerHTML = tco(claimable) + '<small>TCO</small>';

    const parts = [];
    parts.push('allocated <b>' + tco(res.allocated) + '</b>');
    if (Number(res.claimed) > 0) parts.push('already taken <b>' + tco(res.claimed) + '</b>');
    parts.push('epoch <b>' + (proofsFile.epoch ?? '?') + '</b>');
    metaEl.innerHTML = parts.join(' &middot; ');

    if (claimable === 0n) {
      btnEl.disabled = true;
      btnEl.textContent = 'Nothing to claim';
      return;
    }

    btnEl.disabled = false;
    btnEl.textContent = 'Claim ' + tco(claimable) + ' TCO';

    // Стоит ли забирать прямо сейчас. Цену берём у кривой - та же, по которой
    // протокол выкупает TCO.
    if (!price) {
      try {
        const info = await smartQuery(TCO_BOND, { info: {} });
        price = Number(info.price) || 0;
      } catch (e) { /* без цены просто не показываем подсказку */ }
    }
    if (price > 0) {
      const worthLunc = (Number(claimable) / 1e6) * price;
      if (worthLunc < CLAIM_FEE_LUNC) {
        note('warn', 'This is worth about <b>' + Math.round(worthLunc) + ' LUNC</b> right now, ' +
                     'and the transaction costs around ' + CLAIM_FEE_LUNC + ' LUNC. Nothing expires - ' +
                     'letting it build up over a few epochs and claiming once is cheaper.');
      } else {
        clearNote();
      }
    }
  }

  /* ── получение ─────────────────────────────────────────────────────────── */

  async function onClaim() {
    if (busy || !myEntry) return;
    const wallet = myWallet();
    if (!wallet) return;

    const send = window.sendExecuteContract;
    if (typeof send !== 'function') {
      note('err', 'Wallet module not loaded. Reload the page and try again.');
      return;
    }

    busy = true;
    const btnEl = $('cc-btn');
    btnEl.disabled = true;
    btnEl.textContent = 'Waiting for wallet...';
    note('warn', 'Approve the transaction in your wallet.');

    try {
      const txHash = await send(
        wallet, CONTRACT,
        { claim: { amount: myEntry.amount, proof: myEntry.proof } },
        [], 'circuit rewards claim', chain()
      );
      note('ok', 'Rewards received. ' +
        '<a href="https://finder.terraport.finance/mainnet/tx/' + txHash + '" ' +
        'target="_blank" rel="noopener">' + String(txHash).slice(0, 12) + '&hellip;</a>');
      busy = false;
      await refresh();
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (/reject|denied|cancel|4001/i.test(msg)) clearNote();
      else note('err', 'Claim failed. ' + msg);
      busy = false;
      await refresh();
    }
  }

  /* ── старт ─────────────────────────────────────────────────────────────── */

  function boot() {
    if (!mount()) return;
    refresh();
    // Кошелёк подключается асинхронно; отдельного события в app.js нет.
    setInterval(() => {
      const w = myWallet();
      if (w !== lastWallet) { lastWallet = w; refresh(); }
    }, 1000);
    // Файл пруфов меняется раз в эпоху - перечитывать часто незачем.
    setInterval(() => { proofsFile = null; refresh(); }, 10 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
