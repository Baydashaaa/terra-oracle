/* markets-catalog.js - рынки на реальные события (каталог oracle-events).
 *
 * Создание рынка начинается с выбора категории. Terra Classic - прежняя
 * форма (метрики цепочки). Crypto - пилот каталога: актив из CoinGecko,
 * условие "выше / ниже", дата. Sport, Esports, World & Economy - следующие
 * этапы, пока помечены "Soon".
 *
 * Контракт тот же. У рынка вне цепочки нет метрики: в spec.param лежит
 * ссылка на источник (src=cg;asset=bitcoin;vs=usd;at=<unix>), в
 * spec.criterion - полное правило словами. Исход объявляет керпер,
 * прочитав CoinGecko; оспаривание и суд - как у всех рынков.
 *
 * Подключать после markets.js и markets-create.js.
 */
(function () {
  'use strict';

  var EVENTS_URL = 'https://oracle-events.vladislav-baydan.workers.dev';
  var LEADS = [3600, 21600, 86400, 259200, 604800];
  var LEAD_TEXT = { 3600: '1 hour', 21600: '6 hours', 86400: '24 hours', 259200: '3 days', 604800: '7 days' };
  // Рынок на цену закрывается заранее: чем ближе к сроку, тем меньше
  // неопределённости. 10% срока, но не меньше минимального зазора контракта.
  var CRYPTO_LEAD_SHARE = 0.10;
  var RES_HOUR = 20;

  var origOpen = window.openMarketCreate;
  var catalog = null, catalogErr = null;
  var C = { asset: null, cmp: 'gt', th: '', date: '', busy: false, dup: null };

  function esc(s) { return typeof mktEsc === 'function' ? mktEsc(s) : String(s == null ? '' : s); }
  function host() { return document.getElementById('mk-create-host'); }
  function cfg() { return typeof prophecyCfg !== 'undefined' ? prophecyCfg : null; }

  function loadCatalog() {
    return fetch(EVENTS_URL + '/catalog', { headers: { accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { catalog = j; catalogErr = null; return j; })
      .catch(function (e) { catalogErr = e.message || String(e); throw e; });
  }

  // ── выбор категории ───────────────────────────────────────────────────────

  var CATS = [
    { id: 'terra', name: 'Terra Classic', img: 'assets/img/tco.webp',
      sub: 'Supply, staking, oracle rates, validators and governance, read straight from the chain.' },
    { id: 'crypto', name: 'Crypto', img: 'assets/img/icons/stat-tvl.webp',
      sub: 'Will BTC, ETH, LUNC and others be above or below a price on a date. Resolved from CoinGecko.' },
    { id: 'sport', name: 'Sport', img: 'assets/img/icons/f-trending.webp', soon: true,
      sub: 'Football, basketball, hockey and more, with clear rules on regular time and overtime.' },
    { id: 'esports', name: 'Esports', img: 'assets/img/icons/circuit.webp', soon: true,
      sub: 'Dota 2, CS2 and League of Legends match winners.' },
    { id: 'world', name: 'World & Economy', img: 'assets/img/icons/g-participation.webp', soon: true,
      sub: 'Central bank decisions, inflation prints and other scheduled releases.' },
  ];

  function renderChooser() {
    var h = host();
    if (!h) return;
    h.innerHTML = '<h3 class="step-h"><span class="n">1</span>What is your market about?</h3>'
      + '<div class="mkx-cats">' + CATS.map(function (c) {
        return '<button type="button" class="mkx-cat' + (c.soon ? ' soon' : '') + '" data-cat="' + c.id + '"'
          + (c.soon ? ' disabled aria-disabled="true"' : '') + '>'
          + '<img src="' + c.img + '" alt="" loading="lazy">'
          + '<b>' + c.name + (c.soon ? ' <i>Soon</i>' : '') + '</b>'
          + '<span>' + c.sub + '</span></button>';
      }).join('') + '</div>';
    h.querySelectorAll('.mkx-cat:not(.soon)').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.cat === 'terra') { if (typeof origOpen === 'function') origOpen(); }
        else openCrypto();
      };
    });
  }

  // ── крипта ────────────────────────────────────────────────────────────────

  function defaultDate() {
    var d = new Date(Date.now() + 7 * 86400000);
    return d.toISOString().slice(0, 10);
  }
  function resolveTs() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(C.date)) return 0;
    var p = C.date.split('-').map(Number);
    return Math.floor(Date.UTC(p[0], p[1] - 1, p[2], RES_HOUR) / 1000);
  }
  function autoLead(ts) {
    var cut = cfg() ? Number(cfg().bet_cutoff_secs) : 3600;
    var left = ts - Math.floor(Date.now() / 1000);
    var min = Math.max(cut, Math.ceil(Math.max(0, left) * CRYPTO_LEAD_SHARE));
    for (var i = 0; i < LEADS.length; i++) if (LEADS[i] >= min) return LEADS[i];
    return null;
  }
  function closeTs() { var t = resolveTs(), l = t && autoLead(t); return t && l ? t - l : 0; }
  function maxDate() {
    // 7 дней - самый длинный зазор; 10% срока не должно его превысить.
    var d = new Date(Date.now() + Math.floor(604800 / CRYPTO_LEAD_SHARE) * 1000 - 86400000);
    return d.toISOString().slice(0, 10);
  }
  function minDate() {
    var d = new Date(Date.now() + 86400000);
    return d.toISOString().slice(0, 10);
  }
  function asset() {
    if (!catalog || !catalog.crypto) return null;
    return catalog.crypto.assets.find(function (a) { return a.id === C.asset; }) || null;
  }
  function cleanTh() { return String(C.th).replace(/[,\s$]/g, ''); }
  function fmtUsd(v) {
    var n = Number(v);
    if (!isFinite(n)) return String(v);
    var dec = n >= 1000 ? 0 : n >= 1 ? 2 : n >= 0.01 ? 4 : 8;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dec });
  }
  function dateText(ts) {
    var d = new Date(ts * 1000);
    return d.getUTCDate() + ' ' + d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ' + d.getUTCFullYear();
  }
  function timeText(ts) {
    var d = new Date(ts * 1000);
    return dateText(ts) + ', ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' UTC';
  }

  function paramStr() {
    return 'src=cg;asset=' + C.asset + ';vs=usd;at=' + resolveTs();
  }
  function question() {
    var a = asset();
    return 'Will ' + (a ? a.symbol : C.asset) + ' be ' + (C.cmp === 'gt' ? 'above' : 'below') + ' '
      + fmtUsd(cleanTh()) + ' at ' + String(RES_HOUR).padStart(2, '0') + ':00 UTC on ' + dateText(resolveTs()) + '?';
  }
  function criterion() {
    var a = asset();
    var name = a ? a.name + ' (' + a.symbol + ')' : C.asset;
    return 'YES if the CoinGecko price of ' + name + ' in USD at ' + timeText(resolveTs())
      + ' is ' + (C.cmp === 'gt' ? 'above' : 'below') + ' ' + cleanTh() + ' USD. The price is the last CoinGecko '
      + 'data point at or before that time, from /coins/' + C.asset + '/market_chart/range. NO otherwise. '
      + 'If CoinGecko has no data point within 90 minutes before that time, the market is voided and everyone is refunded.';
  }
  function spec() {
    return { metric: null, param: paramStr(), comparator: C.cmp, threshold: cleanTh(), height: null,
      criterion: criterion(), unit: null };
  }

  function problems() {
    var out = [];
    if (!C.asset) out.push('Pick an asset.');
    var th = cleanTh();
    if (!/^\d+(\.\d+)?$/.test(th) || Number(th) <= 0) out.push('Enter a price in USD, for example 100000 or 0.00005.');
    var t = resolveTs();
    if (!t) out.push('Pick a date.');
    else if (!autoLead(t)) out.push('That date is too far ahead. Pick one within ' + Math.floor(604800 / CRYPTO_LEAD_SHARE / 86400) + ' days.');
    else if (closeTs() <= Math.floor(Date.now() / 1000) + 600) out.push('That date is too close: predictions would close almost at once.');
    if (!(typeof mkWallet === 'function' && mkWallet())) out.push('Connect a wallet to publish.');
    if (C.dup) out.push('This exact market is already open.');
    return out;
  }

  function checkDup() {
    C.dup = null;
    if (!C.asset || !resolveTs() || !/^\d+(\.\d+)?$/.test(cleanTh()) || typeof loadProphecyMarkets !== 'function') return;
    var p = paramStr(), cmp = C.cmp, th = cleanTh();
    loadProphecyMarkets().then(function (all) {
      var live = { open: 1, locked: 1, proposed: 1, disputed: 1 };
      var hit = all.find(function (m) {
        return live[m.status] && m.spec && m.spec.param === p && m.spec.comparator === cmp && m.spec.threshold === th;
      });
      var was = C.dup;
      C.dup = hit ? hit.id : null;
      if (was !== C.dup) paintSummary();
    }).catch(function () {});
  }

  function previewMarket() {
    return {
      id: 0, question: question(), category: 'crypto', creator: (typeof mkWallet === 'function' && mkWallet()) || '',
      status: 'open', promoted: false, boost: '0', spec: spec(), bets_close_at: closeTs(), resolve_after: resolveTs(),
      pot_yes: '0', pot_no: '0', bettors_yes: 0, bettors_no: 0,
      fees: { protocol_bps: 500, creator_bps: 300, boost_bps: 200 },
    };
  }

  function openCrypto() {
    if (!C.date) C.date = defaultDate();
    renderCrypto();
    if (!catalog) loadCatalog().then(renderCrypto).catch(renderCrypto);
  }

  function renderCrypto() {
    var h = host();
    if (!h) return;
    var assets = catalog && catalog.crypto ? catalog.crypto.assets : null;
    var a = asset();
    var assetGrid = assets
      ? '<div class="mkx-assets">' + assets.map(function (x) {
        var ch = Number(x.change24h);
        return '<button type="button" class="mkx-asset" data-asset="' + esc(x.id) + '" aria-pressed="' + (C.asset === x.id) + '">'
          + '<img src="' + esc(x.image) + '" alt="" loading="lazy"><b>' + esc(x.symbol) + '</b>'
          + '<span>' + fmtUsd(x.price) + '</span>'
          + (isFinite(ch) ? '<em class="' + (ch >= 0 ? 'up' : 'down') + '">' + (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%</em>' : '')
          + '</button>';
      }).join('') + '</div>'
      : catalogErr
        ? '<div class="mk-plain">The price list is not available right now. Try again in a minute.</div>'
        : '<div class="mk-loading">Loading prices…</div>';

    var quick = a ? [-10, -5, 5, 10].map(function (p) {
      var v = a.price * (1 + p / 100);
      var dec = v >= 1000 ? 0 : v >= 1 ? 2 : v >= 0.01 ? 4 : 8;
      return '<button type="button" data-th="' + v.toFixed(dec) + '">' + (p > 0 ? '+' : '') + p + '%</button>';
    }).join('') : '';

    h.innerHTML = '<button type="button" class="mkx-backcat">&larr; Categories</button>'
      + '<h3 class="step-h"><span class="n">1</span>Which asset?</h3>'
      + '<section class="card qform">' + assetGrid + '</section>'
      + '<h3 class="step-h"><span class="n">2</span>Condition</h3>'
      + '<section class="card qform">'
      + '  <div class="mkx-cond">'
      + '    <div class="chips" id="mkx-cmp">'
      + '      <button type="button" data-cmp="gt" aria-pressed="' + (C.cmp === 'gt') + '">Above</button>'
      + '      <button type="button" data-cmp="lt" aria-pressed="' + (C.cmp === 'lt') + '">Below</button>'
      + '    </div>'
      + '    <label class="mkx-price"><span>$</span><input id="mkx-th" type="text" inputmode="decimal" autocomplete="off" placeholder="'
      + (a ? esc(String(a.price)) : '100000') + '" value="' + esc(C.th) + '"></label>'
      + '  </div>'
      + (a ? '<div class="mkx-quick"><span>Now ' + fmtUsd(a.price) + '</span>' + quick + '</div>' : '')
      + '</section>'
      + '<h3 class="step-h"><span class="n">3</span>When does it resolve?</h3>'
      + '<section class="card qform">'
      + '  <label class="mkx-date"><span>Resolution date</span><input id="mkx-date" type="date" min="' + minDate() + '" max="' + maxDate()
      + '" value="' + esc(C.date) + '"></label>'
      + '  <div class="mkf-pdates mkf-when" id="mkx-when"></div>'
      + '  <div class="mkf-note">The price is read at ' + String(RES_HOUR).padStart(2, '0') + ':00 UTC on that day. '
      + 'Predictions close a bit earlier, set for you: the closer to the deadline, the less is left to guess.</div>'
      + '</section>'
      + '<h3 class="step-h"><span class="n">4</span>Review and publish</h3>'
      + '<section class="card qform" id="mkx-sum"></section>';

    h.querySelector('.mkx-backcat').onclick = renderChooser;
    h.querySelectorAll('[data-asset]').forEach(function (b) {
      b.onclick = function () { C.asset = b.dataset.asset; C.th = ''; renderCrypto(); checkDup(); };
    });
    h.querySelectorAll('[data-cmp]').forEach(function (b) {
      b.onclick = function () { C.cmp = b.dataset.cmp; renderCrypto(); checkDup(); };
    });
    h.querySelectorAll('[data-th]').forEach(function (b) {
      b.onclick = function () { C.th = b.dataset.th; renderCrypto(); checkDup(); };
    });
    var th = document.getElementById('mkx-th');
    if (th) th.oninput = function () { C.th = th.value; paintSummary(); clearTimeout(th._t); th._t = setTimeout(checkDup, 500); };
    var dt = document.getElementById('mkx-date');
    if (dt) dt.onchange = function () { C.date = dt.value; paintSummary(); checkDup(); };
    paintSummary();
  }

  function paintSummary() {
    var when = document.getElementById('mkx-when');
    var t = resolveTs(), c = closeTs();
    if (when) {
      when.innerHTML = t && c
        ? '<div><span>Resolution</span><b>' + timeText(t) + '</b></div><div><span>Predictions close</span><b>' + timeText(c) + '</b></div>'
        : '';
    }
    var box = document.getElementById('mkx-sum');
    if (!box) return;
    var errs = problems();
    var bond = cfg() ? Number(cfg().creation_bond) : 200000e6;
    var ready = C.asset && t && c && /^\d+(\.\d+)?$/.test(cleanTh());
    box.innerHTML = (ready && typeof marketCard === 'function'
      ? '<div class="mkx-preview">' + marketCard(previewMarket()).replace(/onclick="[^"]*"/, '') + '</div>' : '')
      + '<div class="mkx-terms">'
      + '<div><span>Bond</span><b>' + (bond / 1e6).toLocaleString('en-US') + ' LUNC</b><em>comes back when the market settles</em></div>'
      + '<div><span>You earn</span><b>3%</b><em>of the losing side</em></div>'
      + '<div><span>Resolved from</span><b>CoinGecko</b><em>disputable for 48 hours, like every market</em></div>'
      + '</div>'
      + (C.dup ? '<div class="mkx-dup">This exact market is already open. <button type="button" id="mkx-join">Open it &rarr;</button></div>' : '')
      + (errs.length && !C.dup ? '<ul class="mkf-errs">' + errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '')
      + '<button type="button" class="ask-go mk-place" id="mkx-go"' + (errs.length || C.busy ? ' disabled' : '') + '>'
      + (C.busy ? 'Waiting for the block…' : 'Publish market &rarr;') + '</button>';
    var join = document.getElementById('mkx-join');
    if (join) join.onclick = function () { closeMarketCreate(); openProphecyMarket(C.dup); };
    var go = document.getElementById('mkx-go');
    if (go) go.onclick = submit;
  }

  function submit() {
    if (problems().length || C.busy) return;
    var bond = cfg() ? String(cfg().creation_bond) : '200000000000';
    C.busy = true;
    paintSummary();
    window.sendExecuteContract(
      mkWallet(), PROPHECY_CONTRACT,
      { create: { question: question(), category: 'crypto', spec: spec(),
        bets_close_at: closeTs(), resolve_after: resolveTs(), promoted: false } },
      [{ denom: 'uluna', amount: bond }],
      'oracle-prophecy: create', PROPHECY_CHAIN, 700000
    ).then(function (hash) {
      return mkTrack(hash, 'New market', function (r) {
        C.busy = false;
        if (r.status === 'failed') { paintSummary(); return; }
        C.asset = null; C.th = '';
        closeMarketCreate();
        if (typeof renderMarkets === 'function') renderMarkets(false);
      });
    }).catch(function (e) {
      C.busy = false;
      if (typeof mkToast === 'function') mkToast(e.message || 'Transaction failed', 'err');
      paintSummary();
    });
  }

  // ── вход ──────────────────────────────────────────────────────────────────

  window.openMarketCreate = function () {
    var panel = document.getElementById('mk-create');
    var list = document.getElementById('mk-browse');
    if (!panel) return;
    panel.style.display = '';
    if (list) list.style.display = 'none';
    if (typeof loadProphecyConfig === 'function') loadProphecyConfig();
    renderChooser();
    if (!catalog) loadCatalog().catch(function () {});
  };
  window.mkCatalog = function () { return catalog; };
})();
