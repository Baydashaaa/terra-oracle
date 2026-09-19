// Цены в шапке: LUNC, USTC и TCO с изменением за 24 часа.
//
// Источник - /lunc-price воркера oracle-draw (кэш 60 с, CryptoCompare с
// запасным CoinGecko и биржами; TCO - с бондинг-кривой Terraport). Та же
// ручка кормит страницу Treasury, поэтому цифры на сайте везде одинаковые.
(function () {
  'use strict';

  var W = (typeof O_DRAW_WORKER !== 'undefined' && O_DRAW_WORKER) || 'https://oracle-draw.vladislav-baydan.workers.dev';
  var EVERY = 2 * 60 * 1000;

  // Мелкие цены - через нижний индекс для числа нулей, как на DEX-скринерах:
  // 0.00005144 -> $0.0₄5144 (четыре нуля после запятой), значащих цифр 4.
  function usdHTML(p) {
    if (!(p > 0)) return '-';
    if (p >= 1) return '$' + p.toFixed(2);
    if (p >= 0.01) return '$' + p.toFixed(4);
    var z = Math.floor(-Math.log10(p));          // нулей сразу после запятой
    var sig = Math.round(p * Math.pow(10, z + 4));
    if (sig >= 100000) { sig = Math.round(sig / 10); z -= 1; }
    else if (sig >= 10000) { sig = Math.round(sig / 10); }
    var digits = String(sig).replace(/0+$/, '') || '0';
    if (z < 3) return '$0.' + new Array(z + 1).join('0') + digits;
    return '$0.0<sub>' + z + '</sub>' + digits;
  }

  function setOne(priceEl, price, chg) {
    if (!priceEl) return;
    priceEl.innerHTML = usdHTML(price);        // только цифры и <sub>, без внешнего текста
    priceEl.title = price > 0 ? '$' + price.toPrecision(6) : '';
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
        setOne(document.getElementById('tk3'), Number(d.USTC), d.USTC_24h);
      })
      .catch(function () {});
  }

  function start() {
    var st = document.createElement('style');
    st.textContent = '.topbar .ticker .down{color:#f87171}' +
      '.topbar .ticker .pr sub{font-size:.68em;vertical-align:-.3em;line-height:0;margin:0 1px;opacity:.85}';
    document.head.appendChild(st);
    load();
    setInterval(function () { if (document.visibilityState === 'visible') load(); }, EVERY);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
