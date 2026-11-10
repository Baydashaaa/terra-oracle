/**
 * wallet-balances.js - балансы в окне кошелька.
 *
 * Под адресом - LUNC и токены из списка, которые принимает Markets (тот же
 * список, что "Pay with": orbitwire-proxy /tokens), с логотипами. Ненулевые
 * сверху. Родные монеты - одним запросом к узлу, CW20 - запросом balance к
 * контракту токена. Обновляется при открытии окна и при смене кошелька.
 * Загружать ПОСЛЕ wallet.js.
 */
(function () {
  'use strict';

  const PROXY = 'https://orbitwire-proxy.vladislav-baydan.workers.dev';
  const LCDS = ['https://terra-classic-lcd.publicnode.com', 'https://lcd.terra-classic.hexxagon.io'];
  const FRESH_MS = 30 * 1000;

  let tokens = null;
  let last = { addr: null, at: 0, rows: null };
  let busy = false;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const logo = (sym) => (sym === 'LUNC' ? 'assets/img/lunc.webp' : `${PROXY}/logo?sym=${encodeURIComponent(sym)}`);
  const addr = () => (typeof globalWalletAddress !== 'undefined' ? globalWalletAddress : null);
  // Тестовый режим Markets - другая сеть, здесь балансы mainnet не к месту.
  const testnet = () => typeof PROPHECY_TESTNET !== 'undefined' && PROPHECY_TESTNET;

  async function lcd(path) {
    for (const base of LCDS) {
      try {
        const r = await fetch(base + path, { signal: AbortSignal.timeout(8000) });
        if (r.ok) return await r.json();
      } catch (e) { /* следующий узел */ }
    }
    throw new Error('node unavailable');
  }

  async function loadTokens() {
    if (tokens) return tokens;
    try {
      const r = await fetch(PROXY + '/tokens', { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      tokens = (j.tokens || []).filter((t) => t.available);
    } catch (e) { tokens = []; }
    return tokens;
  }

  /** Число в минимальных единицах -> короткая строка: 1.13M, 48.2K, 812.4. */
  function compact(raw, decimals) {
    const v = Number(BigInt(raw)) / 10 ** decimals;
    if (v >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (v >= 1e4) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return v === 0 ? '0' : v.toLocaleString('en-US', { maximumSignificantDigits: 4 });
  }

  async function fetchRows(a) {
    const list = await loadTokens();
    const bank = await lcd(`/cosmos/bank/v1beta1/balances/${a}?pagination.limit=200`);
    const coins = {};
    (bank.balances || []).forEach((c) => { coins[c.denom] = c.amount; });
    const rows = [{ symbol: 'LUNC', raw: coins.uluna || '0', decimals: 6 }];
    await Promise.all(list.map(async (t) => {
      let raw = '0';
      if (/^terra1/.test(t.address)) {
        try {
          const b64 = btoa(JSON.stringify({ balance: { address: a } }));
          const j = await lcd(`/cosmwasm/wasm/v1/contract/${t.address}/smart/${encodeURIComponent(b64)}`);
          raw = (j.data && j.data.balance) || '0';
        } catch (e) { raw = null; }
      } else {
        raw = coins[t.address] || '0';
      }
      rows.push({ symbol: t.symbol, raw, decimals: t.decimals || 6 });
    }));
    // LUNC первым, дальше по убыванию количества, нули в конце.
    const head = rows.shift();
    const val = (r) => (r.raw ? Number(r.raw) / 10 ** r.decimals : 0);
    rows.sort((x, y) => val(y) - val(x));
    return [head, ...rows];
  }

  function host() {
    const panel = document.getElementById('wallet-connected-panel');
    if (!panel) return null;
    let box = panel.querySelector('.wb');
    if (!box) {
      panel.querySelector('.wallet-disconnect').insertAdjacentHTML('beforebegin',
        '<div class="wb"><div class="wb-h"><span>Balances</span><button type="button" class="wb-r" aria-label="Refresh">↻</button></div><div class="wb-list"></div></div>');
      box = panel.querySelector('.wb');
      box.querySelector('.wb-r').addEventListener('click', (e) => { e.stopPropagation(); refresh(true); });
    }
    return box;
  }

  function paintAddr() {
    const el = document.getElementById('wallet-connected-addr');
    const a = addr();
    if (!el || !a || (el.dataset.a === a && el.querySelector('.wa-t'))) return;
    el.dataset.a = a;
    el.innerHTML = `<span class="wa-dot"></span><span class="wa-t">${esc(a.slice(0, 10))}…${esc(a.slice(-6))}</span>
      <button type="button" class="wa-c" aria-label="Copy address">Copy</button>`;
    el.querySelector('.wa-c').addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard && navigator.clipboard.writeText(a).then(() => {
        e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1400);
      });
    });
  }

  function paint(rows, state) {
    const box = host();
    if (!box) return;
    const list = box.querySelector('.wb-list');
    if (state === 'loading' && !rows) {
      list.innerHTML = Array.from({ length: 4 }, () => '<div class="wb-row sk"><i></i><b></b><em></em></div>').join('');
      return;
    }
    if (!rows) { list.innerHTML = '<p class="wb-none">Balances are not available right now.</p>'; return; }
    list.innerHTML = rows.map((r) => {
      const zero = r.raw !== null && BigInt(r.raw || '0') === 0n;
      return `<div class="wb-row${zero ? ' zero' : ''}">
        <img src="${logo(r.symbol)}" alt="" width="22" height="22" loading="lazy" onerror="this.style.visibility='hidden'">
        <b>${esc(r.symbol)}</b><em>${r.raw === null ? '-' : compact(r.raw, r.decimals)}</em></div>`;
    }).join('');
  }

  async function refresh(force) {
    const a = addr();
    if (!a || testnet()) { const b = document.querySelector('#wallet-connected-panel .wb'); if (b) b.remove(); return; }
    paintAddr();
    if (!force && last.addr === a && Date.now() - last.at < FRESH_MS && last.rows) { paint(last.rows); return; }
    if (busy) return;
    busy = true;
    paint(last.addr === a ? last.rows : null, 'loading');
    try {
      const rows = await fetchRows(a);
      if (addr() === a) { last = { addr: a, at: Date.now(), rows }; paint(rows); }
    } catch (e) {
      paint(last.addr === a ? last.rows : null);
    } finally { busy = false; }
  }

  // Балансы для других модулей (ползунок суммы в Markets): та же выборка
  // и тот же кэш на 30 с, без второго набора запросов к узлу.
  window.walletBalances = {
    async get(force) {
      const a = addr();
      if (!a || testnet()) return null;
      if (!force && last.addr === a && Date.now() - last.at < FRESH_MS && last.rows) return last.rows;
      const rows = await fetchRows(a);
      if (addr() === a) { last = { addr: a, at: Date.now(), rows }; paint(rows); }
      return rows;
    },
  };

  // Окно открыли - обновить; кошелёк сменили - сбросить.
  const origToggle = window.toggleWalletDropdown;
  window.toggleWalletDropdown = function () {
    const r = origToggle.apply(this, arguments);
    const dd = document.getElementById('wallet-dropdown');
    if (dd && dd.classList.contains('open')) refresh(false);
    return r;
  };
  window.addEventListener('oracle:wallet', () => { last = { addr: null, at: 0, rows: null }; refresh(true); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => refresh(false));
  else refresh(false);
})();
