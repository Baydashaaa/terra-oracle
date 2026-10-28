// Цены в шапке: LUNC, USTC и TCO с изменением за 24 часа.
//
// Источник - /lunc-price воркера oracle-draw (кэш 60 с, CryptoCompare с
// запасным CoinGecko и биржами; TCO - с бондинг-кривой Terraport). Та же
// ручка кормит страницу Treasury, поэтому цифры на сайте везде одинаковые.
// Если он не ответил или отдал пустые цены: LUNC и USTC берутся из каталога
// oracle-events, а на экране остаются последние известные значения.
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
    // Нет свежей цены - оставляем последнюю показанную, а не прочерк:
    // иначе каждый сбой источника на минуту "стирал" цены в шапке.
    if (!priceEl || !(price > 0)) return;
    priceEl.innerHTML = usdHTML(price);        // только цифры и <sub>, без внешнего текста
    priceEl.title = '$' + price.toPrecision(6);
    var c = priceEl.nextElementSibling;
    if (!c) return;
    if (chg == null || !isFinite(chg)) { c.textContent = ''; return; }
    c.textContent = (chg >= 0 ? '+' : '') + Number(chg).toFixed(2) + '%';
    c.classList.toggle('up', chg >= 0);
    c.classList.toggle('down', chg < 0);
  }

  var KEY = 'oracle-ticker';
  function paint(d) {
    setOne(document.getElementById('tk1'), Number(d.LUNC), d.LUNC_24h);
    setOne(document.getElementById('tk2'), Number(d.TCO), d.TCO_24h);
    setOne(document.getElementById('tk3'), Number(d.USTC), d.USTC_24h);
  }
  function remember(d) {
    try {
      var old = JSON.parse(localStorage.getItem(KEY) || '{}');
      ['LUNC', 'TCO', 'USTC'].forEach(function (k) {
        if (Number(d[k]) > 0) { old[k] = Number(d[k]); old[k + '_24h'] = d[k + '_24h']; }
      });
      old.at = Date.now();
      localStorage.setItem(KEY, JSON.stringify(old));
    } catch (e) {}
  }

  // Запасной источник для LUNC и USTC - каталог oracle-events (CoinGecko с
  // ключом, обновляется раз в 30 минут). TCO там нет, он только у oracle-draw.
  var EV = 'https://oracle-events.vladislav-baydan.workers.dev/catalog';
  function fallback() {
    return fetch(EV).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      var a = (c && c.crypto && c.crypto.assets) || [];
      var f = function (id) { return a.find(function (x) { return x.id === id; }) || {}; };
      return { LUNC: f('terra-luna').price, LUNC_24h: f('terra-luna').change24h,
        USTC: f('terrausd').price, USTC_24h: f('terrausd').change24h };
    }).catch(function () { return null; });
  }

  function load() {
    fetch(W + '/lunc-price', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) {
        d = d || {};
        if (Number(d.LUNC) > 0 && Number(d.USTC) > 0) return d;
        return fallback().then(function (f) {
          if (!f) return d;
          if (!(Number(d.LUNC) > 0)) { d.LUNC = f.LUNC; d.LUNC_24h = f.LUNC_24h; }
          if (!(Number(d.USTC) > 0)) { d.USTC = f.USTC; d.USTC_24h = f.USTC_24h; }
          return d;
        });
      })
      .then(function (d) { paint(d); remember(d); });
  }

  function start() {
    var st = document.createElement('style');
    st.textContent = '.topbar .ticker .down{color:#f87171}' +
      '.topbar .ticker .pr sub{font-size:.68em;vertical-align:-.3em;line-height:0;margin:0 1px;opacity:.85}';
    document.head.appendChild(st);
    // Сразу показать последние известные цены, пока идёт запрос.
    try { var c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && Date.now() - c.at < 6 * 3600000) paint(c); } catch (e) {}
    load();
    setInterval(function () { if (document.visibilityState === 'visible') load(); }, EVERY);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
