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
    { id: 'terra', name: 'Terra Classic', img: 'assets/img/icons/cat-terra.webp',
      sub: 'Supply, staking, oracle rates, validators and governance, read straight from the chain.' },
    { id: 'crypto', name: 'Crypto', img: 'assets/img/icons/cat-crypto.webp',
      sub: 'Will BTC, ETH, LUNC and others be above or below a price on a date. Resolved from CoinGecko.' },
    { id: 'sport', name: 'Sport', img: 'assets/img/icons/cat-sport.webp',
      sub: 'Football from 12 top competitions, with the regular-time rule spelled out. Basketball and hockey next.' },
    { id: 'esports', name: 'Esports', img: 'assets/img/icons/cat-esports.webp', soon: true,
      sub: 'Dota 2, CS2 and League of Legends match winners.' },
    { id: 'world', name: 'World & Economy', img: 'assets/img/icons/cat-world.webp', soon: true,
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
        else if (b.dataset.cat === 'sport') openSport();
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


  // ── спорт: футбол (football-data.org) ─────────────────────────────────────
  //
  // Все шаблоны - по основному времени: 90 минут плюс добавленное арбитром.
  // Дополнительное время и пенальти не считаются. Это записано и в вопросе,
  // и в правиле рынка, чтобы после матча не было споров.
  //
  // spec.param: src=fd;match=<id>;tpl=<шаблон>;c=<турнир>;h=<id хозяев>;a=<id гостей>
  // spec.comparator/threshold - только у тоталов (gt 2.5).

  var F = { comp: 'all', q: '', match: null, tpl: null, line: '2.5', busy: false, dup: null };
  var KICKOFF_CLOSE = 300;         // приём закрывается за 5 минут до начала
  var RESOLVE_AFTER = 3 * 3600;    // исход - не раньше чем через 3 часа после начала
  var LINES = ['1.5', '2.5', '3.5'];

  function fb() { return catalog && catalog.football ? catalog.football : null; }
  function compName(code) {
    var c = fb() && fb().comps.find(function (x) { return x.code === code; });
    return c ? c.name : code;
  }
  function match() {
    return fb() && fb().matches.find(function (m) { return m.id === F.match; }) || null;
  }
  function kickoff(m) { return Math.floor(Date.parse(m.utc) / 1000); }
  function localTime(ts) {
    var d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function dayLabel(ts) {
    var d = new Date(ts * 1000), t = new Date();
    var day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((day(d) - day(t)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  }

  function tplList(m) {
    return [
      { id: 'home_win', label: m.home.name + ' win', sub: 'in regular time' },
      { id: 'draw', label: 'Draw', sub: 'after 90 minutes' },
      { id: 'away_win', label: m.away.name + ' win', sub: 'in regular time' },
      { id: 'over', label: 'Goals over', sub: 'both teams, regular time', line: true },
    ];
  }

  function fQuestion(m) {
    var at = dayLabelShort(kickoff(m));
    if (F.tpl === 'home_win') return 'Will ' + m.home.name + ' beat ' + m.away.name + ' in regular time? (' + compName(m.comp) + ', ' + at + ')';
    if (F.tpl === 'away_win') return 'Will ' + m.away.name + ' win at ' + m.home.name + ' in regular time? (' + compName(m.comp) + ', ' + at + ')';
    if (F.tpl === 'draw') return 'Will ' + m.home.name + ' vs ' + m.away.name + ' be a draw after 90 minutes? (' + compName(m.comp) + ', ' + at + ')';
    return 'Will ' + m.home.name + ' vs ' + m.away.name + ' have over ' + F.line + ' goals in regular time? (' + compName(m.comp) + ', ' + at + ')';
  }
  function dayLabelShort(ts) {
    var d = new Date(ts * 1000);
    return d.getUTCDate() + ' ' + d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ' + d.getUTCFullYear();
  }
  function fCriterion(m) {
    var base = 'Match ' + m.home.name + ' vs ' + m.away.name + ', ' + compName(m.comp) + ', kick-off ' + timeText(kickoff(m))
      + ', football-data.org match ' + m.id + '. Regular time only: 90 minutes plus stoppage time added by the referee; '
      + 'extra time and penalty shoot-outs do not count. ';
    var rule = F.tpl === 'home_win' ? 'YES if ' + m.home.name + ' scored more goals than ' + m.away.name + ' in regular time. NO otherwise, including a draw.'
      : F.tpl === 'away_win' ? 'YES if ' + m.away.name + ' scored more goals than ' + m.home.name + ' in regular time. NO otherwise, including a draw.'
        : F.tpl === 'draw' ? 'YES if the regular-time score is level. NO otherwise.'
          : 'YES if both teams together scored more than ' + F.line + ' goals in regular time. NO otherwise.';
    return base + rule + ' Read from football-data.org after the match is marked finished. If the match is postponed, '
      + 'cancelled, abandoned or awarded, the market is voided and everyone is refunded.';
  }
  function fParam(m) {
    return 'src=fd;match=' + m.id + ';tpl=' + F.tpl + ';c=' + m.comp + ';h=' + m.home.id + ';a=' + m.away.id;
  }
  function fSpec(m) {
    var over = F.tpl === 'over';
    return { metric: null, param: fParam(m), comparator: over ? 'gt' : null, threshold: over ? F.line : null,
      height: null, criterion: fCriterion(m), unit: null };
  }
  function fClose(m) { return kickoff(m) - KICKOFF_CLOSE; }
  function fResolve(m) { return kickoff(m) + RESOLVE_AFTER; }

  function fProblems() {
    var out = [], m = match();
    if (!m) out.push('Pick a match.');
    else if (fClose(m) <= Math.floor(Date.now() / 1000) + 600) out.push('This match starts too soon to open a market.');
    if (!F.tpl) out.push('Pick what the market is about.');
    if (!(typeof mkWallet === 'function' && mkWallet())) out.push('Connect a wallet to publish.');
    if (F.dup) out.push('This exact market is already open.');
    return out;
  }

  function fCheckDup() {
    F.dup = null;
    var m = match();
    if (!m || !F.tpl || typeof loadProphecyMarkets !== 'function') return;
    var p = fParam(m), th = F.tpl === 'over' ? F.line : null;
    loadProphecyMarkets().then(function (all) {
      var live = { open: 1, locked: 1, proposed: 1, disputed: 1 };
      var hit = all.find(function (x) {
        return live[x.status] && x.spec && x.spec.param === p && (x.spec.threshold || null) === th;
      });
      var was = F.dup;
      F.dup = hit ? hit.id : null;
      if (was !== F.dup) fPaintSummary();
    }).catch(function () {});
  }

  function openSport() {
    renderSport();
    if (!catalog) loadCatalog().then(renderSport).catch(renderSport);
  }

  function crest(t) {
    return t && t.crest ? '<img src="' + esc(t.crest) + '" alt="" loading="lazy">' : '<i class="nocrest"></i>';
  }

  function matchList() {
    var data = fb();
    if (!data) return catalogErr ? '<div class="mk-plain">The fixture list is not available right now. Try again in a minute.</div>'
      : '<div class="mk-loading">Loading fixtures…</div>';
    var q = F.q.trim().toLowerCase();
    var list = data.matches.filter(function (m) {
      if (F.comp !== 'all' && m.comp !== F.comp) return false;
      if (!q) return true;
      return (m.home.name + ' ' + m.away.name + ' ' + compName(m.comp)).toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) return '<div class="mk-plain">No matches found. Try another team or competition.</div>';
    var out = '', day = '';
    list.slice(0, 80).forEach(function (m) {
      var d = dayLabel(kickoff(m));
      if (d !== day) { day = d; out += '<div class="mkx-day">' + esc(d) + '</div>'; }
      out += '<button type="button" class="mkx-match" data-match="' + m.id + '" aria-pressed="' + (F.match === m.id) + '">'
        + '<span class="t">' + esc(localTime(kickoff(m))) + '</span>'
        + '<span class="tm h">' + esc(m.home.name) + crest(m.home) + '</span>'
        + '<span class="vs">vs</span>'
        + '<span class="tm a">' + crest(m.away) + esc(m.away.name) + '</span>'
        + '<span class="c">' + esc(m.comp) + '</span></button>';
    });
    return '<div class="mkx-matches">' + out + '</div>';
  }

  function renderSport() {
    var h = host();
    if (!h) return;
    var data = fb(), m = match();
    var comps = data ? '<div class="chips mkx-comps">'
      + '<button type="button" data-comp="all" aria-pressed="' + (F.comp === 'all') + '">All</button>'
      + data.comps.map(function (c) {
        return '<button type="button" data-comp="' + esc(c.code) + '" aria-pressed="' + (F.comp === c.code) + '">'
          + (c.emblem ? '<img src="' + esc(c.emblem) + '" alt="" loading="lazy">' : '') + esc(c.name) + '</button>';
      }).join('') + '</div>' : '';
    var tpls = m ? '<div class="mkx-tpls">' + tplList(m).map(function (t) {
      return '<button type="button" class="mkx-tpl" data-tpl="' + t.id + '" aria-pressed="' + (F.tpl === t.id) + '">'
        + '<b>' + esc(t.label) + '</b><span>' + esc(t.sub) + '</span><em>90 min</em></button>';
    }).join('') + '</div>'
      + (F.tpl === 'over' ? '<div class="mkx-quick"><span>Line</span>' + LINES.map(function (l) {
        return '<button type="button" data-line="' + l + '" aria-pressed="' + (F.line === l) + '">Over ' + l + '</button>';
      }).join('') + '</div>' : '')
      : '<div class="mk-plain">Pick a match first.</div>';

    h.innerHTML = '<button type="button" class="mkx-backcat">&larr; Categories</button>'
      + '<h3 class="step-h"><span class="n">1</span>Which match?</h3>'
      + '<section class="card qform">'
      + '  <div class="mkx-sporttabs"><button type="button" aria-pressed="true">Football</button>'
      + '<button type="button" disabled>Basketball <i>Soon</i></button><button type="button" disabled>Hockey <i>Soon</i></button></div>'
      + comps
      + '  <label class="mk2-search mkx-search"><input id="mkx-q" type="search" placeholder="Search a team or competition" value="' + esc(F.q) + '"></label>'
      + matchList()
      + '</section>'
      + '<h3 class="step-h"><span class="n">2</span>What is the market about?</h3>'
      + '<section class="card qform">' + tpls
      + '<div class="mkf-note">Regular time only: 90 minutes plus stoppage time. Extra time and penalties do not count.</div></section>'
      + '<h3 class="step-h"><span class="n">3</span>Review and publish</h3>'
      + '<section class="card qform" id="mkx-sum"></section>';

    h.querySelector('.mkx-backcat').onclick = renderChooser;
    h.querySelectorAll('[data-comp]').forEach(function (b) { b.onclick = function () { F.comp = b.dataset.comp; renderSport(); }; });
    h.querySelectorAll('[data-match]').forEach(function (b) {
      b.onclick = function () { F.match = Number(b.dataset.match); F.tpl = null; renderSport(); };
    });
    h.querySelectorAll('[data-tpl]').forEach(function (b) { b.onclick = function () { F.tpl = b.dataset.tpl; renderSport(); fCheckDup(); }; });
    h.querySelectorAll('[data-line]').forEach(function (b) { b.onclick = function () { F.line = b.dataset.line; renderSport(); fCheckDup(); }; });
    var qi = document.getElementById('mkx-q');
    if (qi) qi.oninput = function () {
      F.q = qi.value;
      clearTimeout(qi._t);
      qi._t = setTimeout(function () {
        var pos = qi.selectionStart;
        renderSport();
        var again = document.getElementById('mkx-q');
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) {} }
      }, 250);
    };
    fPaintSummary();
  }

  function fPaintSummary() {
    var box = document.getElementById('mkx-sum');
    if (!box) return;
    var m = match(), errs = fProblems();
    var bond = cfg() ? Number(cfg().creation_bond) : 200000e6;
    var preview = '';
    if (m && F.tpl && typeof marketCard === 'function') {
      preview = '<div class="mkx-preview">' + marketCard({
        id: 0, question: fQuestion(m), category: 'sport', creator: (typeof mkWallet === 'function' && mkWallet()) || '',
        status: 'open', promoted: false, boost: '0', spec: fSpec(m), bets_close_at: fClose(m), resolve_after: fResolve(m),
        pot_yes: '0', pot_no: '0', bettors_yes: 0, bettors_no: 0, fees: { protocol_bps: 500, creator_bps: 300, boost_bps: 200 },
      }).replace(/onclick="[^"]*"/, '') + '</div>';
    }
    box.innerHTML = preview
      + (m ? '<div class="mkf-pdates mkf-when"><div><span>Predictions close</span><b>' + timeText(fClose(m)) + '</b></div>'
        + '<div><span>Kick-off</span><b>' + timeText(kickoff(m)) + '</b></div></div>' : '')
      + '<div class="mkx-terms">'
      + '<div><span>Bond</span><b>' + (bond / 1e6).toLocaleString('en-US') + ' LUNC</b><em>comes back when the market settles</em></div>'
      + '<div><span>You earn</span><b>3%</b><em>of the losing side</em></div>'
      + '<div><span>Resolved from</span><b>football-data.org</b><em>disputable for 48 hours, like every market</em></div>'
      + '</div>'
      + (F.dup ? '<div class="mkx-dup">This exact market is already open. <button type="button" id="mkx-join">Open it &rarr;</button></div>' : '')
      + (errs.length && !F.dup ? '<ul class="mkf-errs">' + errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '')
      + '<button type="button" class="ask-go mk-place" id="mkx-go"' + (errs.length || F.busy ? ' disabled' : '') + '>'
      + (F.busy ? 'Waiting for the block…' : 'Publish market &rarr;') + '</button>';
    var join = document.getElementById('mkx-join');
    if (join) join.onclick = function () { closeMarketCreate(); openProphecyMarket(F.dup); };
    var go = document.getElementById('mkx-go');
    if (go) go.onclick = fSubmit;
  }

  function fSubmit() {
    var m = match();
    if (!m || fProblems().length || F.busy) return;
    var bond = cfg() ? String(cfg().creation_bond) : '200000000000';
    F.busy = true;
    fPaintSummary();
    window.sendExecuteContract(
      mkWallet(), PROPHECY_CONTRACT,
      { create: { question: fQuestion(m), category: 'sport', spec: fSpec(m),
        bets_close_at: fClose(m), resolve_after: fResolve(m), promoted: false } },
      [{ denom: 'uluna', amount: bond }],
      'oracle-prophecy: create', PROPHECY_CHAIN, 700000
    ).then(function (hash) {
      return mkTrack(hash, 'New market', function (r) {
        F.busy = false;
        if (r.status === 'failed') { fPaintSummary(); return; }
        F.match = null; F.tpl = null;
        closeMarketCreate();
        if (typeof renderMarkets === 'function') renderMarkets(false);
      });
    }).catch(function (e) {
      F.busy = false;
      if (typeof mkToast === 'function') mkToast(e.message || 'Transaction failed', 'err');
      fPaintSummary();
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
