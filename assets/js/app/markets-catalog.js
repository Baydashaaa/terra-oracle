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
      sub: 'Football from 12 top competitions, NBA and NHL, with the regular-time and overtime rules spelled out.' },
    { id: 'esports', name: 'Esports', img: 'assets/img/icons/cat-esports.webp',
      sub: 'Dota 2, CS2 and League of Legends series winners. Resolved from PandaScore.' },
    { id: 'world', name: 'World & Economy', img: 'assets/img/icons/cat-world.webp',
      sub: 'Fed rate decisions and US inflation releases. Resolved from FRED.' },
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
        else if (b.dataset.cat === 'esports') openEsports();
        else if (b.dataset.cat === 'world') openWorld();
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


  // ── спорт: футбол (football-data.org), NBA и NHL (ESPN) ───────────────────
  //
  // Правило каждого шаблона записано в вопросе и в criterion рынка:
  //   футбол - только основное время (90 минут + добавленное), без
  //            дополнительного времени и пенальти;
  //   NBA    - с овертаймами, ничьих нет;
  //   NHL    - два вида победы: "в основное время" (60 минут, ничья = NO)
  //            и "с овертаймом и буллитами"; тоталы только по основному времени.
  //
  // spec.param:
  //   футбол: src=fd;match=<id>;tpl=<шаблон>;c=<турнир>;h=<id>;a=<id>
  //   NBA/NHL: src=espn;lg=nba|nhl;ev=<id>;tpl=<шаблон>;h=<abbr>;a=<abbr>
  // spec.comparator/threshold - только у тоталов (gt <линия>).

  var F = { sport: 'football', comp: 'all', q: '', match: null, tpl: null, line: null, busy: false, dup: null };
  var KICKOFF_CLOSE = 300;          // приём закрывается за 5 минут до начала
  var RESOLVE_AFTER = { football: 3 * 3600, nba: 4 * 3600, nhl: 4 * 3600 };
  var SPORTS = {
    football: { name: 'Football', source: 'football-data.org', lines: ['1.5', '2.5', '3.5'], unit: 'goals' },
    nba: { name: 'Basketball', league: 'NBA', source: 'ESPN', lines: ['210.5', '220.5', '230.5', '240.5'], unit: 'points' },
    nhl: { name: 'Hockey', league: 'NHL', source: 'ESPN', lines: ['4.5', '5.5', '6.5'], unit: 'goals' },
  };

  function fb() { return catalog && catalog.football ? catalog.football : null; }
  function compName(code) {
    if (F.sport !== 'football') return SPORTS[F.sport].league;
    var c = fb() && fb().comps.find(function (x) { return x.code === code; });
    return c ? c.name : code;
  }
  /** Матчи выбранного вида спорта в одном виде. */
  function games() {
    if (F.sport === 'football') return fb() ? fb().matches : null;
    var d = catalog && catalog[F.sport];
    if (!d) return null;
    return d.games.map(function (g) {
      return { id: g.id, utc: g.utc, comp: SPORTS[F.sport].league,
        home: { id: g.home.abbr, name: g.home.name, crest: g.home.logo },
        away: { id: g.away.abbr, name: g.away.name, crest: g.away.logo } };
    });
  }
  function match() {
    var list = games();
    return list && list.find(function (m) { return String(m.id) === String(F.match); }) || null;
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
  function dayLabelShort(ts) {
    var d = new Date(ts * 1000);
    return d.getUTCDate() + ' ' + d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ' + d.getUTCFullYear();
  }

  function tplList(m) {
    if (F.sport === 'nba') return [
      { id: 'home_win', label: m.home.name + ' win', sub: 'overtime counts', tag: 'incl. OT' },
      { id: 'away_win', label: m.away.name + ' win', sub: 'overtime counts', tag: 'incl. OT' },
      { id: 'over', label: 'Points over', sub: 'both teams, overtime counts', tag: 'incl. OT', line: true },
    ];
    if (F.sport === 'nhl') return [
      { id: 'home_win_reg', label: m.home.name + ' win', sub: 'in 60 minutes, a tie is NO', tag: 'regulation' },
      { id: 'away_win_reg', label: m.away.name + ' win', sub: 'in 60 minutes, a tie is NO', tag: 'regulation' },
      { id: 'home_win', label: m.home.name + ' win', sub: 'overtime and shootout count', tag: 'incl. OT/SO' },
      { id: 'away_win', label: m.away.name + ' win', sub: 'overtime and shootout count', tag: 'incl. OT/SO' },
      { id: 'over', label: 'Goals over', sub: 'both teams, 60 minutes only', tag: 'regulation', line: true },
    ];
    return [
      { id: 'home_win', label: m.home.name + ' win', sub: 'in regular time', tag: '90 min' },
      { id: 'draw', label: 'Draw', sub: 'after 90 minutes', tag: '90 min' },
      { id: 'away_win', label: m.away.name + ' win', sub: 'in regular time', tag: '90 min' },
      { id: 'over', label: 'Goals over', sub: 'both teams, regular time', tag: '90 min', line: true },
    ];
  }
  function line() { return F.line || SPORTS[F.sport].lines[1]; }

  function fQuestion(m) {
    var tail = ' (' + compName(m.comp) + ', ' + dayLabelShort(kickoff(m)) + ')';
    var H = m.home.name, A = m.away.name, U = SPORTS[F.sport].unit;
    if (F.sport === 'football') {
      if (F.tpl === 'home_win') return 'Will ' + H + ' beat ' + A + ' in regular time?' + tail;
      if (F.tpl === 'away_win') return 'Will ' + A + ' win at ' + H + ' in regular time?' + tail;
      if (F.tpl === 'draw') return 'Will ' + H + ' vs ' + A + ' be a draw after 90 minutes?' + tail;
      return 'Will ' + H + ' vs ' + A + ' have over ' + line() + ' goals in regular time?' + tail;
    }
    if (F.sport === 'nba') {
      if (F.tpl === 'home_win') return 'Will the ' + H + ' beat the ' + A + '?' + tail;
      if (F.tpl === 'away_win') return 'Will the ' + A + ' win at the ' + H + '?' + tail;
      return 'Will ' + A + ' at ' + H + ' score over ' + line() + ' points?' + tail;
    }
    if (F.tpl === 'home_win_reg') return 'Will ' + H + ' beat ' + A + ' in regulation?' + tail;
    if (F.tpl === 'away_win_reg') return 'Will ' + A + ' win at ' + H + ' in regulation?' + tail;
    if (F.tpl === 'home_win') return 'Will ' + H + ' beat ' + A + ', overtime and shootout included?' + tail;
    if (F.tpl === 'away_win') return 'Will ' + A + ' win at ' + H + ', overtime and shootout included?' + tail;
    return 'Will ' + A + ' at ' + H + ' have over ' + line() + ' ' + U + ' in regulation?' + tail;
  }

  function fCriterion(m) {
    var S = SPORTS[F.sport], H = m.home.name, A = m.away.name;
    var who = F.tpl.indexOf('home') === 0 ? H : A, other = who === H ? A : H;
    var head = H + ' vs ' + A + ', ' + compName(m.comp) + ', start ' + timeText(kickoff(m)) + ', '
      + (F.sport === 'football' ? 'football-data.org match ' : 'ESPN event ') + m.id + '. ';
    var tail = ' Read from ' + S.source + ' after the game is marked final. If it is postponed, cancelled, '
      + 'abandoned or awarded, the market is voided and everyone is refunded.';
    var rule;
    if (F.sport === 'football') {
      head += 'Regular time only: 90 minutes plus stoppage time added by the referee; extra time and penalty shoot-outs do not count. ';
      rule = F.tpl === 'draw' ? 'YES if the regular-time score is level. NO otherwise.'
        : F.tpl === 'over' ? 'YES if both teams together scored more than ' + line() + ' goals in regular time. NO otherwise.'
          : 'YES if ' + who + ' scored more goals than ' + other + ' in regular time. NO otherwise, including a draw.';
    } else if (F.sport === 'nba') {
      head += 'Overtime counts; the final score includes every overtime period. ';
      rule = F.tpl === 'over' ? 'YES if both teams together scored more than ' + line() + ' points. NO otherwise.'
        : 'YES if ' + who + ' won the game. NO otherwise.';
    } else if (F.tpl === 'home_win_reg' || F.tpl === 'away_win_reg') {
      head += 'Regulation only: the three 20-minute periods; overtime and the shootout do not count. ';
      rule = 'YES if ' + who + ' scored more goals than ' + other + ' in regulation. NO otherwise, including a tie after 60 minutes.';
    } else if (F.tpl === 'over') {
      head += 'Regulation only: the three 20-minute periods; overtime and the shootout do not count. ';
      rule = 'YES if both teams together scored more than ' + line() + ' goals in regulation. NO otherwise.';
    } else {
      head += 'Overtime and the shootout count: the official winner of the game. ';
      rule = 'YES if ' + who + ' won the game. NO otherwise.';
    }
    return head + rule + tail;
  }

  function fParam(m) {
    if (F.sport === 'football') return 'src=fd;match=' + m.id + ';tpl=' + F.tpl + ';c=' + m.comp + ';h=' + m.home.id + ';a=' + m.away.id;
    return 'src=espn;lg=' + F.sport + ';ev=' + m.id + ';tpl=' + F.tpl
      + ';h=' + String(m.home.id || '').toLowerCase() + ';a=' + String(m.away.id || '').toLowerCase();
  }
  function fSpec(m) {
    var over = F.tpl === 'over';
    return { metric: null, param: fParam(m), comparator: over ? 'gt' : null, threshold: over ? line() : null,
      height: null, criterion: fCriterion(m), unit: null };
  }
  function fClose(m) { return kickoff(m) - KICKOFF_CLOSE; }
  function fResolve(m) { return kickoff(m) + RESOLVE_AFTER[F.sport]; }

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
    var p = fParam(m), th = F.tpl === 'over' ? line() : null;
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

  // Логотип команды. Если картинки нет или она не загрузилась, на её месте
  // кружок с инициалами, а не значок битой картинки.
  function initials(name) {
    var w = String(name || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
    return (w.length > 1 ? w[0][0] + w[1][0] : String(w[0] || '?').slice(0, 2)).toUpperCase();
  }
  function crest(t, name) {
    var ini = esc(initials(name || (t && t.name)));
    if (!t || !t.crest) return '<i class="nocrest">' + ini + '</i>';
    return '<img src="' + esc(t.crest) + '" alt="" loading="lazy" referrerpolicy="no-referrer" '
      + 'onerror="var i=document.createElement(\'i\');i.className=\'nocrest\';i.textContent=\'' + ini + '\';this.replaceWith(i)">';
  }

  function matchList() {
    var list = games();
    if (!list) return catalogErr ? '<div class="mk-plain">The fixture list is not available right now. Try again in a minute.</div>'
      : catalog ? '<div class="mk-plain">No fixtures for this sport right now.</div>'
        : '<div class="mk-loading">Loading fixtures…</div>';
    var q = F.q.trim().toLowerCase();
    list = list.filter(function (m) {
      if (F.sport === 'football' && F.comp !== 'all' && m.comp !== F.comp) return false;
      if (!q) return true;
      return (m.home.name + ' ' + m.away.name + ' ' + compName(m.comp)).toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) return '<div class="mk-plain">No matches found. Try another team or competition.</div>';
    var out = '', day = '';
    list.slice(0, 80).forEach(function (m) {
      var d = dayLabel(kickoff(m));
      if (d !== day) { day = d; out += '<div class="mkx-day">' + esc(d) + '</div>'; }
      out += '<button type="button" class="mkx-match" data-match="' + esc(m.id) + '" aria-pressed="' + (String(F.match) === String(m.id)) + '">'
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
    var comps = F.sport === 'football' && data ? '<div class="chips mkx-comps">'
      + '<button type="button" data-comp="all" aria-pressed="' + (F.comp === 'all') + '">All</button>'
      + data.comps.map(function (c) {
        return '<button type="button" data-comp="' + esc(c.code) + '" aria-pressed="' + (F.comp === c.code) + '">'
          + (c.emblem ? '<img src="' + esc(c.emblem) + '" alt="" loading="lazy">' : '') + esc(c.name) + '</button>';
      }).join('') + '</div>' : '';
    var tpls = m ? '<div class="mkx-tpls">' + tplList(m).map(function (t) {
      return '<button type="button" class="mkx-tpl" data-tpl="' + t.id + '" aria-pressed="' + (F.tpl === t.id) + '">'
        + '<b>' + esc(t.label) + '</b><span>' + esc(t.sub) + '</span><em>' + esc(t.tag) + '</em></button>';
    }).join('') + '</div>'
      + (F.tpl === 'over' ? '<div class="mkx-quick"><span>Line</span>' + SPORTS[F.sport].lines.map(function (l) {
        return '<button type="button" data-line="' + l + '" aria-pressed="' + (line() === l) + '">Over ' + l + '</button>';
      }).join('') + '</div>' : '')
      : '<div class="mk-plain">Pick a match first.</div>';
    var note = F.sport === 'football' ? 'Regular time only: 90 minutes plus stoppage time. Extra time and penalties do not count.'
      : F.sport === 'nba' ? 'Overtime counts: the final score includes every overtime period.'
        : 'Regulation markets count 60 minutes only. "Incl. OT/SO" markets use the official winner after overtime and the shootout.';

    h.innerHTML = '<button type="button" class="mkx-backcat">&larr; Categories</button>'
      + '<h3 class="step-h"><span class="n">1</span>Which match?</h3>'
      + '<section class="card qform">'
      + '  <div class="mkx-sporttabs">' + Object.keys(SPORTS).map(function (k) {
        return '<button type="button" data-sport="' + k + '" aria-pressed="' + (F.sport === k) + '">' + SPORTS[k].name
          + (SPORTS[k].league ? ' <i>' + SPORTS[k].league + '</i>' : '') + '</button>';
      }).join('') + '</div>'
      + comps
      + '  <label class="mk2-search mkx-search"><input id="mkx-q" type="search" placeholder="Search a team or competition" value="' + esc(F.q) + '"></label>'
      + matchList()
      + '</section>'
      + '<h3 class="step-h"><span class="n">2</span>What is the market about?</h3>'
      + '<section class="card qform">' + tpls + '<div class="mkf-note">' + esc(note) + '</div></section>'
      + '<h3 class="step-h"><span class="n">3</span>Review and publish</h3>'
      + '<section class="card qform" id="mkx-sum"></section>';

    h.querySelector('.mkx-backcat').onclick = renderChooser;
    h.querySelectorAll('[data-sport]').forEach(function (b) {
      b.onclick = function () { F.sport = b.dataset.sport; F.match = null; F.tpl = null; F.line = null; F.comp = 'all'; renderSport(); };
    });
    h.querySelectorAll('[data-comp]').forEach(function (b) { b.onclick = function () { F.comp = b.dataset.comp; renderSport(); }; });
    h.querySelectorAll('[data-match]').forEach(function (b) {
      b.onclick = function () { F.match = b.dataset.match; F.tpl = null; renderSport(); };
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
        + '<div><span>Start</span><b>' + timeText(kickoff(m)) + '</b></div></div>' : '')
      + '<div class="mkx-terms">'
      + '<div><span>Bond</span><b>' + (bond / 1e6).toLocaleString('en-US') + ' LUNC</b><em>comes back when the market settles</em></div>'
      + '<div><span>You earn</span><b>3%</b><em>of the losing side</em></div>'
      + '<div><span>Resolved from</span><b>' + esc(SPORTS[F.sport].source) + '</b><em>disputable for 48 hours, like every market</em></div>'
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

  // ── киберспорт (PandaScore) ───────────────────────────────────────────────
  //
  // Рынок на победителя серии (bo1/bo3/bo5) по данным PandaScore.
  // spec.param: src=ps;g=<игра>;m=<id матча>;tpl=t1|t2;t1=<id>;t2=<id>
  // Победа техническим поражением, перенос и отмена - аннулирование.

  var ES_GAMES = { dota2: 'Dota 2', csgo: 'CS2', lol: 'League of Legends' };
  var E = { game: 'dota2', q: '', match: null, tpl: null, busy: false, dup: null };

  function esList() {
    var d = catalog && catalog.esports;
    return d && d.games ? (d.games[E.game] || []) : null;
  }
  function esMatch() {
    var l = esList();
    return l && l.find(function (m) { return String(m.id) === String(E.match); }) || null;
  }
  function esResolve(m) { return kickoff(m) + (Number(m.bo) || 3) * 5400 + 3600; }
  function esQuestion(m) {
    var w = E.tpl === 't1' ? m.home : m.away, o = E.tpl === 't1' ? m.away : m.home;
    return 'Will ' + w.full + ' beat ' + o.full + '? (' + ES_GAMES[E.game] + ', ' + (m.league || 'match') + ', Bo' + (m.bo || '?') + ', '
      + dayLabelShort(kickoff(m)) + ')';
  }
  function esCriterion(m) {
    var w = E.tpl === 't1' ? m.home : m.away, o = E.tpl === 't1' ? m.away : m.home;
    return ES_GAMES[E.game] + ' match ' + m.home.full + ' vs ' + m.away.full + ', ' + (m.league || '') + (m.event ? ' (' + m.event + ')' : '')
      + ', best of ' + (m.bo || '?') + ', scheduled ' + timeText(kickoff(m)) + ', PandaScore match ' + m.id + '. '
      + 'YES if ' + w.full + ' wins the series. NO if ' + o.full + ' wins it or it ends in a draw. '
      + 'Read from PandaScore after the match is marked finished. If it is cancelled, postponed beyond 7 days, '
      + 'or decided by forfeit, the market is voided and everyone is refunded.';
  }
  function esParam(m) {
    return 'src=ps;g=' + E.game + ';m=' + m.id + ';tpl=' + E.tpl + ';t1=' + m.home.id + ';t2=' + m.away.id;
  }
  function esSpec(m) {
    return { metric: null, param: esParam(m), comparator: null, threshold: null, height: null, criterion: esCriterion(m), unit: null };
  }

  function openEsports() {
    renderEsports();
    if (!catalog) loadCatalog().then(renderEsports).catch(renderEsports);
  }

  function renderEsports() {
    var h = host();
    if (!h) return;
    var list = esList(), m = esMatch();
    var q = E.q.trim().toLowerCase();
    var rows = !list ? (catalogErr ? '<div class="mk-plain">The match list is not available right now.</div>' : '<div class="mk-loading">Loading matches…</div>')
      : (function () {
        var l = list.filter(function (x) {
          return !q || (x.home.full + ' ' + x.away.full + ' ' + (x.league || '') + ' ' + (x.event || '')).toLowerCase().indexOf(q) >= 0;
        });
        if (!l.length) return '<div class="mk-plain">No matches found.</div>';
        var out = '', day = '';
        l.slice(0, 80).forEach(function (x) {
          var d = dayLabel(kickoff(x));
          if (d !== day) { day = d; out += '<div class="mkx-day">' + esc(d) + '</div>'; }
          out += '<button type="button" class="mkx-match" data-esm="' + esc(x.id) + '" aria-pressed="' + (String(E.match) === String(x.id)) + '">'
            + '<span class="t">' + esc(localTime(kickoff(x))) + '</span>'
            + '<span class="tm h">' + esc(x.home.name) + crest({ crest: x.home.logo }, x.home.name) + '</span>'
            + '<span class="vs">Bo' + esc(x.bo || '?') + '</span>'
            + '<span class="tm a">' + crest({ crest: x.away.logo }, x.away.name) + esc(x.away.name) + '</span>'
            + '<span class="c">' + esc(x.league || '') + '</span></button>';
        });
        return '<div class="mkx-matches">' + out + '</div>';
      })();
    var tpls = m ? '<div class="mkx-tpls">'
      + ['t1', 't2'].map(function (t) {
        var team = t === 't1' ? m.home : m.away;
        return '<button type="button" class="mkx-tpl" data-est="' + t + '" aria-pressed="' + (E.tpl === t) + '">'
          + '<b>' + esc(team.full) + ' win</b><span>wins the series</span><em>Bo' + esc(m.bo || '?') + '</em></button>';
      }).join('') + '</div>' : '<div class="mk-plain">Pick a match first.</div>';

    h.innerHTML = '<button type="button" class="mkx-backcat">&larr; Categories</button>'
      + '<h3 class="step-h"><span class="n">1</span>Which match?</h3>'
      + '<section class="card qform">'
      + '  <div class="mkx-sporttabs">' + Object.keys(ES_GAMES).map(function (k) {
        return '<button type="button" data-esg="' + k + '" aria-pressed="' + (E.game === k) + '">' + ES_GAMES[k] + '</button>';
      }).join('') + '</div>'
      + '  <label class="mk2-search mkx-search"><input id="mkx-eq" type="search" placeholder="Search a team or tournament" value="' + esc(E.q) + '"></label>'
      + rows + '</section>'
      + '<h3 class="step-h"><span class="n">2</span>Who wins?</h3>'
      + '<section class="card qform">' + tpls + '<div class="mkf-note">The series winner, as PandaScore records it. A forfeit voids the market.</div></section>'
      + '<h3 class="step-h"><span class="n">3</span>Review and publish</h3>'
      + '<section class="card qform" id="mkx-sum"></section>';

    h.querySelector('.mkx-backcat').onclick = renderChooser;
    h.querySelectorAll('[data-esg]').forEach(function (b) { b.onclick = function () { E.game = b.dataset.esg; E.match = null; E.tpl = null; renderEsports(); }; });
    h.querySelectorAll('[data-esm]').forEach(function (b) { b.onclick = function () { E.match = b.dataset.esm; E.tpl = null; renderEsports(); }; });
    h.querySelectorAll('[data-est]').forEach(function (b) { b.onclick = function () { E.tpl = b.dataset.est; renderEsports(); genericDup(E, esParam(esMatch()), null, function () { paintGeneric(E, esFlow()); }); }; });
    var qi = document.getElementById('mkx-eq');
    if (qi) qi.oninput = function () {
      E.q = qi.value; clearTimeout(qi._t);
      qi._t = setTimeout(function () { var p = qi.selectionStart; renderEsports(); var a = document.getElementById('mkx-eq'); if (a) { a.focus(); try { a.setSelectionRange(p, p); } catch (e) {} } }, 250);
    };
    paintGeneric(E, esFlow());
  }

  function esFlow() {
    var m = esMatch();
    return {
      ready: !!(m && E.tpl), category: 'esports', source: 'PandaScore',
      question: m && E.tpl ? esQuestion(m) : '', spec: m && E.tpl ? esSpec(m) : null,
      close: m ? kickoff(m) - KICKOFF_CLOSE : 0, resolve: m ? esResolve(m) : 0,
      when: m ? [['Predictions close', kickoff(m) - KICKOFF_CLOSE], ['Scheduled start', kickoff(m)]] : [],
      problems: [!m && 'Pick a match.', m && !E.tpl && 'Pick the winner the market is about.',
        m && kickoff(m) - KICKOFF_CLOSE <= Math.floor(Date.now() / 1000) + 600 && 'This match starts too soon to open a market.'],
    };
  }

  // ── мир и экономика (FRED) ────────────────────────────────────────────────
  //
  // ФРС: решение по ставке - по верхней границе целевого диапазона (FRED
  //      DFEDTARU) на следующий день после решения против дня до заседания.
  // CPI: годовая инфляция США по индексу CPI-U без сезонной поправки (FRED
  //      CPIAUCNS), месяц к тому же месяцу год назад, с округлением до 0.1,
  //      как в официальном релизе BLS.
  // spec.param: src=fred;ev=<id события>;tpl=cut|hold|hike|yoy;d=<дата>|ref=<ГГГГ-ММ>

  var W = { ev: null, tpl: null, th: '', busy: false, dup: null };
  function econ() { return catalog && catalog.economy; }
  function wEvent() { var e = econ(); return e && e.events.find(function (x) { return x.id === W.ev; }) || null; }
  function evTs(e) { return Math.floor(Date.parse(e.at) / 1000); }
  function wClose(e) { return e.type === 'fomc' ? evTs(e) - 30 * 3600 : evTs(e) - 3600; }
  function wResolve(e) { return e.type === 'fomc' ? evTs(e) + 30 * 3600 : evTs(e) + 3 * 3600; }
  function pct(v) { return Number(v).toFixed(2).replace(/0$/, '') + '%'; }

  function wQuestion(e) {
    if (e.type === 'fomc') {
      var verb = { cut: 'cut', hold: 'hold', hike: 'raise' }[W.tpl];
      return 'Will the Fed ' + verb + ' rates at the ' + e.meeting + ' meeting?';
    }
    var mon = new Date(e.ref + '-01T00:00:00Z').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return 'Will US CPI inflation for ' + mon + ' be above ' + W.th + '% year over year?';
  }
  function wCriterion(e) {
    if (e.type === 'fomc') {
      var d = e.at.slice(0, 10);
      var rule = { cut: 'lower than', hold: 'equal to', hike: 'higher than' }[W.tpl];
      return 'Federal Reserve decision of the ' + e.meeting + ' FOMC meeting, announced ' + timeText(evTs(e)) + '. '
        + 'YES if the upper bound of the federal funds target range (FRED series DFEDTARU) on the first day after ' + d
        + ' is ' + rule + ' its value on the last day before the meeting. NO otherwise. '
        + 'If the meeting is moved by more than 7 days or the series is not updated within 7 days, the market is voided.';
    }
    return 'US consumer price inflation for ' + e.ref + ': the 12-month change in the CPI-U, all items, not seasonally adjusted '
      + '(FRED series CPIAUCNS, the same index as the BLS headline), rounded to one decimal place as BLS reports it. '
      + 'YES if it is above ' + W.th + '%. NO otherwise. Scheduled release ' + timeText(evTs(e)) + '. '
      + 'If the figure is not published within 7 days of the scheduled release, the market is voided.';
  }
  function wParam(e) {
    return 'src=fred;ev=' + e.id + ';tpl=' + (e.type === 'fomc' ? W.tpl : 'yoy') + ';' + (e.type === 'fomc' ? 'd=' + e.at.slice(0, 10) : 'ref=' + e.ref);
  }
  function wSpec(e) {
    var cpi = e.type === 'cpi';
    return { metric: null, param: wParam(e), comparator: cpi ? 'gt' : null, threshold: cpi ? String(W.th).replace(/[%\s]/g, '') : null,
      height: null, criterion: wCriterion(e), unit: null };
  }

  function openWorld() {
    renderWorld();
    if (!catalog) loadCatalog().then(renderWorld).catch(renderWorld);
  }

  function renderWorld() {
    var h = host();
    if (!h) return;
    var d = econ(), e = wEvent();
    var list = !d ? (catalogErr ? '<div class="mk-plain">The calendar is not available right now.</div>' : '<div class="mk-loading">Loading the calendar…</div>')
      : !d.events.length ? '<div class="mk-plain">No scheduled releases far enough ahead right now.</div>'
        : '<div class="mkx-tpls">' + d.events.map(function (x) {
          return '<button type="button" class="mkx-tpl" data-wev="' + esc(x.id) + '" aria-pressed="' + (W.ev === x.id) + '">'
            + '<b>' + esc(x.name) + '</b><span>' + esc(timeText(evTs(x))) + '</span><em>' + (x.type === 'fomc' ? 'Fed' : 'BLS') + '</em></button>';
        }).join('') + '</div>';
    var ctx = d ? '<div class="mkx-quick"><span>Now: Fed target ' + (d.fedLower != null ? pct(d.fedLower) + ' - ' + pct(d.fedUpper) : 'n/a')
      + (d.cpiLast ? ' · CPI ' + esc(d.cpiLast.month) + ': ' + d.cpiLast.yoy + '% y/y' : '') + '</span></div>' : '';
    var tpls = '';
    if (e && e.type === 'fomc') {
      tpls = '<div class="mkx-tpls">' + [['cut', 'Cut', 'the upper bound goes down'], ['hold', 'Hold', 'no change'], ['hike', 'Hike', 'the upper bound goes up']].map(function (t) {
        return '<button type="button" class="mkx-tpl" data-wtpl="' + t[0] + '" aria-pressed="' + (W.tpl === t[0]) + '"><b>' + t[1] + '</b><span>' + t[2] + '</span><em>Fed</em></button>';
      }).join('') + '</div>';
    } else if (e && e.type === 'cpi') {
      var last = d.cpiLast ? d.cpiLast.yoy : null;
      tpls = '<div class="mkx-cond"><span class="mkx-label">Above</span><label class="mkx-price"><input id="mkx-wth" type="text" inputmode="decimal" placeholder="'
        + (last != null ? last.toFixed(1) : '3.0') + '" value="' + esc(W.th) + '"><span>% y/y</span></label></div>'
        + (last != null ? '<div class="mkx-quick"><span>Last ' + last + '%</span>' + [-0.2, -0.1, 0.1, 0.2].map(function (dlt) {
          var v = (last + dlt).toFixed(1); return '<button type="button" data-wq="' + v + '">' + v + '%</button>';
        }).join('') + '</div>' : '');
    } else tpls = '<div class="mk-plain">Pick a release first.</div>';

    h.innerHTML = '<button type="button" class="mkx-backcat">&larr; Categories</button>'
      + '<h3 class="step-h"><span class="n">1</span>Which release?</h3>'
      + '<section class="card qform">' + ctx + list
      + '<div class="mkf-note">Dates are taken from the official Federal Reserve and BLS calendars and can move; the rule of each market covers that.</div></section>'
      + '<h3 class="step-h"><span class="n">2</span>Condition</h3>'
      + '<section class="card qform">' + tpls + '</section>'
      + '<h3 class="step-h"><span class="n">3</span>Review and publish</h3>'
      + '<section class="card qform" id="mkx-sum"></section>';

    h.querySelector('.mkx-backcat').onclick = renderChooser;
    h.querySelectorAll('[data-wev]').forEach(function (b) { b.onclick = function () { W.ev = b.dataset.wev; W.tpl = null; W.th = ''; renderWorld(); }; });
    var redup = function () { var ev = wEvent(); if (ev && (ev.type === 'cpi' ? /^\d+(\.\d+)?$/.test(W.th) : W.tpl)) genericDup(W, wParam(ev), ev.type === 'cpi' ? W.th : null, function () { paintGeneric(W, wFlow()); }); };
    h.querySelectorAll('[data-wtpl]').forEach(function (b) { b.onclick = function () { W.tpl = b.dataset.wtpl; renderWorld(); redup(); }; });
    h.querySelectorAll('[data-wq]').forEach(function (b) { b.onclick = function () { W.th = b.dataset.wq; renderWorld(); redup(); }; });
    var th = document.getElementById('mkx-wth');
    if (th) th.oninput = function () { W.th = th.value.replace(/[%\s,]/g, ''); paintGeneric(W, wFlow()); clearTimeout(th._t); th._t = setTimeout(redup, 500); };
    paintGeneric(W, wFlow());
  }

  function wFlow() {
    var e = wEvent();
    var ok = e && (e.type === 'fomc' ? !!W.tpl : /^\d+(\.\d+)?$/.test(W.th));
    return {
      ready: !!ok, category: 'world', source: 'FRED',
      question: ok ? wQuestion(e) : '', spec: ok ? wSpec(e) : null,
      close: e ? wClose(e) : 0, resolve: e ? wResolve(e) : 0,
      when: e ? [['Predictions close', wClose(e)], [e.type === 'fomc' ? 'Decision' : 'Release', evTs(e)]] : [],
      problems: [!e && 'Pick a release.', e && !ok && (e.type === 'fomc' ? 'Pick cut, hold or hike.' : 'Enter an inflation level, for example 3.0.'),
        e && wClose(e) <= Math.floor(Date.now() / 1000) + 600 && 'This release is too close to open a market.'],
    };
  }

  // ── общее для киберспорта и экономики: дубли, сводка, публикация ─────────

  function genericDup(st, param, th, repaint) {
    st.dup = null;
    if (typeof loadProphecyMarkets !== 'function') return;
    loadProphecyMarkets().then(function (all) {
      var live = { open: 1, locked: 1, proposed: 1, disputed: 1 };
      var hit = all.find(function (x) { return live[x.status] && x.spec && x.spec.param === param && (x.spec.threshold || null) === (th || null); });
      var was = st.dup;
      st.dup = hit ? hit.id : null;
      if (was !== st.dup) repaint();
    }).catch(function () {});
  }

  function paintGeneric(st, f) {
    var box = document.getElementById('mkx-sum');
    if (!box) return;
    var errs = f.problems.filter(Boolean);
    if (!(typeof mkWallet === 'function' && mkWallet())) errs.push('Connect a wallet to publish.');
    if (st.dup) errs.push('This exact market is already open.');
    var bond = cfg() ? Number(cfg().creation_bond) : 200000e6;
    var preview = f.ready && typeof marketCard === 'function' ? '<div class="mkx-preview">' + marketCard({
      id: 0, question: f.question, category: f.category, creator: (typeof mkWallet === 'function' && mkWallet()) || '',
      status: 'open', promoted: false, boost: '0', spec: f.spec, bets_close_at: f.close, resolve_after: f.resolve,
      pot_yes: '0', pot_no: '0', bettors_yes: 0, bettors_no: 0, fees: { protocol_bps: 500, creator_bps: 300, boost_bps: 200 },
    }).replace(/onclick="[^"]*"/, '') + '</div>' : '';
    box.innerHTML = preview
      + (f.when.length ? '<div class="mkf-pdates mkf-when">' + f.when.map(function (w) { return '<div><span>' + w[0] + '</span><b>' + timeText(w[1]) + '</b></div>'; }).join('') + '</div>' : '')
      + '<div class="mkx-terms">'
      + '<div><span>Bond</span><b>' + (bond / 1e6).toLocaleString('en-US') + ' LUNC</b><em>comes back when the market settles</em></div>'
      + '<div><span>You earn</span><b>3%</b><em>of the losing side</em></div>'
      + '<div><span>Resolved from</span><b>' + esc(f.source) + '</b><em>disputable for 48 hours, like every market</em></div>'
      + '</div>'
      + (st.dup ? '<div class="mkx-dup">This exact market is already open. <button type="button" id="mkx-join">Open it &rarr;</button></div>' : '')
      + (errs.length && !st.dup ? '<ul class="mkf-errs">' + errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '')
      + '<button type="button" class="ask-go mk-place" id="mkx-go"' + (errs.length || st.busy ? ' disabled' : '') + '>'
      + (st.busy ? 'Waiting for the block…' : 'Publish market &rarr;') + '</button>';
    var join = document.getElementById('mkx-join');
    if (join) join.onclick = function () { closeMarketCreate(); openProphecyMarket(st.dup); };
    var go = document.getElementById('mkx-go');
    if (go) go.onclick = function () {
      if (errs.length || st.busy) return;
      st.busy = true; paintGeneric(st, f);
      window.sendExecuteContract(
        mkWallet(), PROPHECY_CONTRACT,
        { create: { question: f.question, category: f.category, spec: f.spec, bets_close_at: f.close, resolve_after: f.resolve, promoted: false } },
        [{ denom: 'uluna', amount: cfg() ? String(cfg().creation_bond) : '200000000000' }],
        'oracle-prophecy: create', PROPHECY_CHAIN, 700000
      ).then(function (hash) {
        return mkTrack(hash, 'New market', function (r) {
          st.busy = false;
          if (r.status === 'failed') { paintGeneric(st, f); return; }
          closeMarketCreate();
          if (typeof renderMarkets === 'function') renderMarkets(false);
        });
      }).catch(function (e) {
        st.busy = false;
        if (typeof mkToast === 'function') mkToast(e.message || 'Transaction failed', 'err');
        paintGeneric(st, f);
      });
    };
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
