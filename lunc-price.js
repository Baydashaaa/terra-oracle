/*
 * lunc-price.js - цена LUNC в долларах для Terra Oracle / Oracle Draw
 *
 * Подключение:
 *   <script src="lunc-price.js"></script>
 *
 * Разметка - к любой сумме в LUNC добавь атрибут:
 *   <span data-lunc="1250000">1 250 000 LUNC</span>
 *   <span data-lunc="1250000000000" data-lunc-denom="u">...</span>   (в uluna)
 *
 * Рядом появится <span class="lunc-usd">≈ $62.01</span>.
 * Если API недоступен или цена не пришла - НИЧЕГО не появляется,
 * суммы в LUNC остаются как были. Страница не должна зависеть от API.
 *
 * Программно:
 *   const p = await LuncPrice.get();        // число или null
 *   LuncPrice.usd(1250000);                 // "$62.01" или null
 *   LuncPrice.refresh();                    // принудительно, минуя кэш
 */

(function (global) {
  'use strict';

  // Если CORS не пустит напрямую, поставь сюда адрес своего воркера,
  // например 'https://orbit-proxy.<твой>.workers.dev/pairs'
  // Твой воркер: своя схема (pairs/base/quote/pool), без priceUSD и объёмов,
  // limit игнорируется - всегда приходят все пары, около 290 КБ.
  const PROXY = 'https://orbitwire-proxy.vladislav-baydan.workers.dev/pairs?chain=columbus-5';
  const DIRECT = 'https://orbitwire.io/api/pairs?page=1&limit=5&sortBy=liquidity&order=desc&chain=columbus-5';

  const CACHE_KEY = 'lunc_price_v1';
  const TTL_MS = 5 * 60 * 1000;
  const TIMEOUT_MS = 8000;

  // что считаем долларом
  const USD = new Set(['USDC', 'USDC.ETH.AXL', 'USDT.ETH.AXL', 'USDT']);

  let inflight = null;

  /* ---------------- кэш ---------------- */

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (typeof c.price !== 'number' || !c.at) return null;
      return c;
    } catch { return null; }
  }

  function writeCache(price) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ price, at: Date.now() }));
    } catch {}
  }

  /* ---------------- загрузка ---------------- */

  // Работает с обеими схемами: прокси (pairs/base/quote) и OrbitWire
  // напрямую (data/baseToken/quoteToken, там есть готовый priceUSD).
  function extractLunc(body) {
    const list = Array.isArray(body) ? body : (body?.pairs || body?.data || []);
    if (!list.length) return null;

    let best = null;   // самая ликвидная пара LUNC против доллара

    for (const p of list) {
      const b = p.base || p.baseToken;
      const q = p.quote || p.quoteToken;
      if (!b?.symbol || !q?.symbol) continue;

      // если готовая цена есть - берём её сразу
      for (const t of [b, q]) {
        if (t.symbol === 'LUNC' && t.priceUSD) {
          const v = Number(t.priceUSD);
          if (Number.isFinite(v) && v > 0) return v;
        }
      }

      const price = Number(p.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      const liq = Number(p.liquidity) || 0;

      const bs = b.symbol.toUpperCase();
      const qs = q.symbol.toUpperCase();

      // price = сколько quote за один base
      let usdPerLunc = null;
      if (bs === 'LUNC' && USD.has(qs)) usdPerLunc = price;
      else if (qs === 'LUNC' && USD.has(bs)) usdPerLunc = 1 / price;
      if (usdPerLunc === null) continue;

      if (!best || liq > best.liq) best = { liq, price: usdPerLunc };
    }

    return best ? best.price : null;
  }

  async function fetchPrice() {
    const url = PROXY || DIRECT;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      return extractLunc(await res.json());
    } catch {
      return null;                    // сеть, CORS, таймаут - молча
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------------- публичное ---------------- */

  async function get(force) {
    if (!force) {
      const c = readCache();
      if (c && Date.now() - c.at < TTL_MS) return c.price;
    }
    if (inflight) return inflight;    // не дёргать API параллельно
    inflight = (async () => {
      const price = await fetchPrice();
      if (price) writeCache(price);
      inflight = null;
      // если не получилось - отдаём протухший кэш, он лучше пустоты
      if (!price) {
        const c = readCache();
        return c ? c.price : null;
      }
      return price;
    })();
    return inflight;
  }

  let lastPrice = null;

  function fmt(usd) {
    if (usd >= 1000) return '$' + Math.round(usd).toLocaleString('en-US');
    if (usd >= 1) return '$' + usd.toFixed(2);
    if (usd >= 0.01) return '$' + usd.toFixed(3);
    return '$' + usd.toFixed(5);
  }

  function usd(luncAmount, denom) {
    if (!lastPrice) return null;
    let n = Number(luncAmount);
    if (!Number.isFinite(n)) return null;
    if (denom === 'u') n = n / 1e6;
    return fmt(n * lastPrice);
  }

  /* ---------------- разметка ---------------- */

  function decorate(root) {
    if (!lastPrice) return;
    const nodes = (root || document).querySelectorAll('[data-lunc]');
    nodes.forEach((el) => {
      const text = usd(el.getAttribute('data-lunc'), el.getAttribute('data-lunc-denom'));
      if (!text) return;
      let tag = el.nextElementSibling;
      if (!tag || !tag.classList.contains('lunc-usd')) {
        tag = document.createElement('span');
        tag.className = 'lunc-usd';
        el.insertAdjacentElement('afterend', tag);
      }
      tag.textContent = ' ≈ ' + text;
      tag.title = 'Курс LUNC получен от OrbitWire, обновляется раз в 5 минут';
    });
  }

  async function init() {
    lastPrice = await get();
    if (!lastPrice) return;           // тихо выходим, разметка не трогается
    decorate();
    global.dispatchEvent(new CustomEvent('lunc-price', { detail: { price: lastPrice } }));
  }

  const api = {
    get,
    usd,
    decorate,
    refresh: async () => { lastPrice = await get(true); decorate(); return lastPrice; },
    get price() { return lastPrice; },
  };

  global.LuncPrice = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // обновление, пока вкладка открыта
  setInterval(() => { api.refresh(); }, TTL_MS);
})(window);
