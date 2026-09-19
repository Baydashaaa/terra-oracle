// Цены в шапке: LUNC и TCO с изменением за 24 часа.
//
// Источник - /lunc-price воркера oracle-draw (кэш 60 с, CryptoCompare с
// запасным CoinGecko; TCO - с бондинг-кривой Terraport). Та же ручка кормит
// страницу Treasury, поэтому цифры на сайте везде одинаковые.
// Раньше здесь стояли значения из макета и не обновлялись вовсе.
(function () {
  'use strict';

  var W = (typeof O_DRAW_WORKER !== 'undefined' && O_DRAW_WORKER) || 'https://oracle-draw.vladislav-baydan.workers.dev';
  var EVERY = 2 * 60 * 1000;

  // Столько знаков после запятой, чтобы было видно 4 значащие цифры:
  // 0.00005179, 0.00001813, 0.4123.
  function usd(p) {
    if (!(p > 0)) return '-';
    var d = Math.max(2, Math.ceil(-Math.log10(p)) + 3);
    return '$' + p.toFixed(Math.min(d, 12));
  }

  function setOne(priceEl, price, chg) {
    if (!priceEl) return;
    priceEl.textContent = usd(price);
    var c = priceEl.nextElementSibling;
    if (!c) return;
    if (chg == null || !isFinite(chg)) { c.textContent = ''; return; }
    c.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    c.classList.toggle('up', chg >= 0);
    c.classList.toggle('down', chg < 0);
  }

  function load() {
    fetch(W + '/lunc-price', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        setOne(document.getElementById('tk1'), Number(d.LUNC), d.LUNC_24h);
        setOne(document.getElementById('tk2'), Number(d.TCO), d.TCO_24h);
      })
      .catch(function () {});
  }

  function start() {
    var st = document.createElement('style');
    st.textContent = '.topbar .ticker .down{color:#f87171}';
    document.head.appendChild(st);
    load();
    setInterval(function () { if (document.visibilityState === 'visible') load(); }, EVERY);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
