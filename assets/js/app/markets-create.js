/**
 * markets-create.js - создание рынка в oracle-prophecy.
 *
 * Форма собирает условие, а вопрос и правило расчёта выводятся из него.
 * Отдельного поля "вопрос" нет намеренно: пока заголовок и спека были
 * двумя независимыми полями, они разошлись на первом же рынке.
 *
 * Перед отправкой выполняется тот же запрос, который потом ляжет в блок
 * Verify: человек видит, что метрика читается и что порог в тех же
 * единицах, до того как заплатил залог.
 *
 * Только ончейн-метрики. Свободный критерий (спорт, биржи, мировые
 * события) ждёт открытого challenge: пока оспорить исход может лишь
 * админ, такой рынок держится на одном ключе.
 *
 * Загружать ПОСЛЕ markets.js: оттуда берутся адрес контракта, список
 * узлов и catRgb.
 */

(function () {
  'use strict';

  var CONTRACT = typeof PROPHECY_CONTRACT !== 'undefined' ? PROPHECY_CONTRACT : '';
  var LCD = typeof PROPHECY_LCD !== 'undefined' ? PROPHECY_LCD
    : ['https://terra-classic-lcd.publicnode.com'];

  // ── метрики ───────────────────────────────────────────────────────────────
  //
  // cats  - в каких категориях метрика предлагается
  // path  - что дёргаем у LCD
  // pick  - как достать значение из ответа
  // unit  - в чём человек вводит порог и как это лечь в единицы цепочки
  // note  - обязано попасть в criterion, иначе исход можно оспорить

  function num(v) { return Number(v || 0); }

  var METRICS = {
    total_supply: {
      label: 'Total LUNC supply',
      cats: ['economy'],
      path: function () { return '/cosmos/bank/v1beta1/supply/by_denom?denom=uluna'; },
      pick: function (j) { return num(j.amount && j.amount.amount); },
      unit: { name: 'LUNC', mul: 1e6, dec: 0 },
      note: 'bank supply of uluna at the given height',
    },
    oracle_rate: {
      label: 'Oracle exchange rate',
      cats: ['economy'],
      param: { label: 'Currency', kind: 'denom' },
      path: function () { return '/terra/oracle/v1beta1/denoms/exchange_rates'; },
      pick: function (j, p) {
        var list = (j && j.exchange_rates) || [];
        for (var i = 0; i < list.length; i++) if (list[i].denom === p) return num(list[i].amount);
        return null;
      },
      unit: { name: 'rate', mul: 1, dec: 18 },
      note: 'oracle module weighted median rate for the denom at the given height',
    },
    staking_ratio: {
      label: 'Staking ratio',
      cats: ['network'],
      path: function () { return '/cosmos/staking/v1beta1/pool'; },
      pick: function (j) {
        var p = j && j.pool; if (!p) return null;
        var b = num(p.bonded_tokens), n = num(p.not_bonded_tokens);
        return b + n ? (b / (b + n)) * 100 : null;
      },
      unit: { name: '%', mul: 1, dec: 4 },
      // Эндпоинт отдаёт две суммы, а не готовое отношение: формула обязана
      // быть в критерии, иначе исход разойдётся с тем, что считал резолвер.
      note: 'bonded_tokens / (bonded_tokens + not_bonded_tokens) from the staking pool, in percent',
    },
    community_pool: {
      label: 'Community pool',
      cats: ['economy'],
      path: function () { return '/cosmos/distribution/v1beta1/community_pool'; },
      pick: function (j) {
        var list = (j && j.pool) || [];
        for (var i = 0; i < list.length; i++) if (list[i].denom === 'uluna') return num(list[i].amount);
        return null;
      },
      unit: { name: 'LUNC', mul: 1e6, dec: 0 },
      note: 'uluna balance of the community pool at the given height',
    },
    validator_power: {
      label: 'Validator stake',
      cats: ['validators'],
      param: { label: 'Validator address', kind: 'text', placeholder: 'terravaloper1…' },
      path: function (p) { return '/cosmos/staking/v1beta1/validators/' + p; },
      pick: function (j) { return j && j.validator ? num(j.validator.tokens) : null; },
      unit: { name: 'LUNC', mul: 1e6, dec: 0 },
      note: 'tokens delegated to the validator at the given height',
    },
    proposal_passed: {
      label: 'Governance proposal passes',
      cats: ['governance'],
      param: { label: 'Proposal id', kind: 'text', placeholder: '12345' },
      path: function (p) { return '/cosmos/gov/v1beta1/proposals/' + p; },
      pick: function (j) { return j && j.proposal ? j.proposal.status : null; },
      discrete: true,
      note: 'proposal status is PROPOSAL_STATUS_PASSED at the given height',
    },
  };

  var CATEGORIES = [
    { id: 'economy', label: 'Economy' },
    { id: 'governance', label: 'Governance' },
    { id: 'protocol', label: 'Protocol' },
    { id: 'validators', label: 'Validators' },
    { id: 'network', label: 'Network' },
  ];

  var COMPARATORS = [
    { v: 'gt', label: 'above' },
    { v: 'gte', label: 'at least' },
    { v: 'lt', label: 'below' },
    { v: 'lte', label: 'at most' },
  ];

  var DENOMS = ['uusd', 'ukrw', 'usdr', 'umnt', 'ueur', 'ucny', 'ujpy', 'ugbp',
    'uinr', 'ucad', 'uchf', 'uhkd', 'uaud', 'usgd', 'uthb', 'usek', 'unok',
    'udkk', 'uidr', 'uphp'];

  /** Метрики, которые имеют смысл в выбранной категории. */
  function metricsFor(cat) {
    return Object.keys(METRICS).filter(function (k) {
      return METRICS[k].cats.indexOf(cat) > -1;
    });
  }

  /** Категории, в которых есть хотя бы одна ончейн-метрика. Protocol
   *  сейчас пуст и в форме не показывается; появится метрика - вернётся
   *  сам, без правки списка. В фильтрах списка рынков он остаётся, он
   *  понадобится свободным критериям. */
  function usableCategories() {
    return CATEGORIES.filter(function (c) { return metricsFor(c.id).length > 0; });
  }

  // ── время ─────────────────────────────────────────────────────────────────
  //
  // Всё в UTC и своими списками. Родной input[type=datetime-local] рисует
  // подпись языком браузера: у половины пользователей это дд.мм.гггг, и они
  // же путают местное время с временем цепочки. Рынок разрешается по UTC,
  // значит и выбирать надо сразу UTC.

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Насколько раньше разрешения закрывается приём ставок. Контракт требует
  // зазор (bet_cutoff_secs), и задавать две даты руками ради этого - лишний
  // способ ошибиться.
  var LEADS = [
    { secs: 3600, label: '1 hour before' },
    { secs: 21600, label: '6 hours before' },
    { secs: 86400, label: '24 hours before' },
    { secs: 259200, label: '3 days before' },
  ];

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function utcText(ts, withTime) {
    if (!ts) return '';
    var d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return '';
    var s = d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    return withTime ? s + ', ' + pad2(d.getUTCHours()) + ':00 UTC' : s;
  }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }

  // ── состояние ─────────────────────────────────────────────────────────────

  var S = {
    category: 'economy',
    metric: 'total_supply',
    param: '',
    comparator: 'lt',
    threshold: '',
    resY: 0, resM: 0, resD: 0, resH: 20,   // момент разрешения, UTC
    lead: 86400,                            // за сколько закрывается приём
    promoted: false,
    height: null,
    cfg: null,
    chain: null,
    blockSecs: 6,
  };

  (function initDate() {
    var d = new Date(Date.now() + 7 * 86400000);
    S.resY = d.getUTCFullYear();
    S.resM = d.getUTCMonth();
    S.resD = d.getUTCDate();
  })();

  function resolveTs() {
    return Math.floor(Date.UTC(S.resY, S.resM, S.resD, S.resH, 0, 0) / 1000);
  }
  function closeTs() { return resolveTs() - S.lead; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtLuncLocal(u) {
    return Math.floor(Number(u || 0) / 1e6).toLocaleString('en-US');
  }

  // ── сеть ──────────────────────────────────────────────────────────────────

  // AbortSignal.timeout поддержан не везде: на части кошельковых браузеров
  // запрос просто не уходит.
  function get(url) {
    var c = new AbortController();
    var t = setTimeout(function () { c.abort(); }, 10000);
    return fetch(url, { headers: { Accept: 'application/json' }, signal: c.signal })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .finally(function () { clearTimeout(t); });
  }

  function lcdGet(path) {
    var i = 0;
    function next() {
      if (i >= LCD.length) return Promise.reject(new Error('chain unavailable'));
      return get(LCD[i++] + path).catch(next);
    }
    return next();
  }

  function query(msg) {
    return lcdGet('/cosmwasm/wasm/v1/contract/' + CONTRACT + '/smart/' + btoa(JSON.stringify(msg)))
      .then(function (j) { return j.data; });
  }

  // Реальное время блока меряем по двум точкам: на горизонте в месяц
  // ошибка в полсекунды даёт почти сутки.
  function loadChainTip() {
    return lcdGet('/cosmos/base/tendermint/v1beta1/blocks/latest').then(function (j) {
      var h = Number(j.block.header.height);
      var t = Date.parse(j.block.header.time) / 1000;
      S.chain = { height: h, time: t };
      var back = Math.max(h - 20000, 1);
      return lcdGet('/cosmos/base/tendermint/v1beta1/blocks/' + back)
        .then(function (j2) {
          var t2 = Date.parse(j2.block.header.time) / 1000;
          S.blockSecs = (t - t2) / (h - back);
        })
        .catch(function () { /* остаётся оценка по умолчанию */ });
    });
  }

  function heightAt(ts) {
    if (!S.chain || !ts) return null;
    var d = ts - S.chain.time;
    if (d <= 0) return null;
    return S.chain.height + Math.round(d / S.blockSecs);
  }

  // ── вопрос и правило из условия ───────────────────────────────────────────

  var PHRASE = {
    total_supply:    function () { return 'the total LUNC supply'; },
    oracle_rate:     function (p) { return 'the LUNC oracle rate in ' + String(p || '').replace(/^u/, '').toUpperCase(); },
    staking_ratio:   function () { return 'the share of LUNC staked'; },
    community_pool:  function () { return 'the community pool'; },
    validator_power: function (p) { return 'the stake delegated to ' + shortAddr(p); },
    proposal_passed: function (p) { return 'governance proposal #' + (p || '?'); },
  };

  var CMP_WORD = { gt: 'above', gte: 'at least', lt: 'below', lte: 'at most' };

  function shortAddr(a) {
    var s = String(a || '');
    return s.length > 20 ? s.slice(0, 12) + '…' + s.slice(-4) : (s || 'the validator');
  }

  /**
   * Порог словами. Сокращаем до T/B/M ТОЛЬКО если сокращение точное:
   * 6000000000000 это ровно 6T, а 5866600000000 - нет, и "5.87T" разошлось
   * бы с тем, что лежит в контракте. Длинное число честнее округления.
   */
  function thresholdText(m, typed) {
    var raw = String(typed == null ? '' : typed).replace(/[^0-9.]/g, '');
    if (!raw) return '';
    var v = Number(raw);
    if (!isFinite(v)) return '';
    if (m.unit.name === 'LUNC') {
      var exact = v.toLocaleString('en-US', { maximumFractionDigits: 0 });
      var steps = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M']];
      for (var i = 0; i < steps.length; i++) {
        if (v >= steps[i][0]) {
          var r = Math.round((v / steps[i][0]) * 100) / 100;
          // Меньше одного LUNC расхождения считаем точным попаданием: это
          // защита от двоичного представления, а не округление порога.
          if (Math.abs(r * steps[i][0] - v) < 1) return r + steps[i][1] + ' LUNC';
          return exact + ' LUNC';
        }
      }
      return exact + ' LUNC';
    }
    if (m.unit.name === '%') return v + '%';
    return raw;
  }

  function questionText() {
    var m = METRICS[S.metric];
    var what = (PHRASE[S.metric] || function () { return S.metric; })(S.param);
    var when = utcText(resolveTs(), false);
    var tail = when ? ' on ' + when + '?' : '?';
    if (m.param && !String(S.param).trim()) return '';
    if (m.discrete) return 'Will ' + what + ' have passed' + tail;
    var th = thresholdText(m, S.threshold);
    if (!th) return '';
    return 'Will ' + what + ' be ' + (CMP_WORD[S.comparator] || S.comparator) + ' ' + th + tail;
  }

  /** Уходит в контракт как criterion и остаётся там навсегда, поэтому
   *  пишется полностью: что читаем, где, с чем сравниваем, что значит YES. */
  function resolutionRule() {
    var m = METRICS[S.metric];
    var what = (PHRASE[S.metric] || function () { return S.metric; })(S.param);
    var at = 'at block ' + (S.height || '?') + ' (' + utcText(resolveTs(), true) + ')';
    if (m.discrete) {
      return 'YES if the status of ' + what + ' reported by the Terra Classic chain ' + at
        + ' is PROPOSAL_STATUS_PASSED. Otherwise NO. Source: ' + m.note + '.';
    }
    return 'YES if ' + what + ' reported by the Terra Classic chain ' + at + ' is '
      + (CMP_WORD[S.comparator] || S.comparator) + ' ' + thresholdText(m, S.threshold)
      + '. Otherwise NO. Source: ' + m.note + '.';
  }

  // ── спека ─────────────────────────────────────────────────────────────────

  function buildSpec() {
    var m = METRICS[S.metric];
    var raw = null;
    if (!m.discrete) {
      var v = String(S.threshold).replace(/[^0-9.]/g, '');
      if (v === '') return null;
      // Порог уходит в цепочку в микроединицах. Здесь ошибается каждый:
      // 6T LUNC и 6T uluna отличаются в миллион раз.
      raw = m.unit.mul === 1e6 ? String(Math.round(Number(v) * 1e6)) : v;
    }
    return {
      metric: S.metric,
      param: m.param ? (S.param || null) : null,
      comparator: m.discrete ? null : S.comparator,
      threshold: raw,
      height: S.height,
      criterion: resolutionRule(),
    };
  }

  function curlFor(spec) {
    return 'curl -s -H "x-cosmos-block-height: ' + (spec.height || '?') + '" \\\n  "'
      + LCD[0] + METRICS[spec.metric].path(spec.param || '') + '"';
  }

  // ── живая проверка ────────────────────────────────────────────────────────

  function fmtMetric(m, raw) {
    if (m.unit.mul === 1e6) return thresholdText(m, Number(raw || 0) / 1e6);
    if (m.unit.name === '%') return Number(raw).toFixed(2) + '%';
    return String(Number(raw).toFixed(Math.min(m.unit.dec, 12)))
      .replace(/0+$/, '').replace(/\.$/, '');
  }

  function hint(t) { return '<span class="mkf-hint">' + esc(t) + '</span>'; }

  function runCheck() {
    var box = document.getElementById('mkf-check');
    if (!box) return;
    var m = METRICS[S.metric];

    if (m.param && !String(S.param).trim()) {
      box.className = 'mkf-check';
      box.innerHTML = hint('Fill in ' + m.param.label.toLowerCase() + ' to run the check.');
      return;
    }
    if (!m.discrete && !String(S.threshold).trim()) {
      box.className = 'mkf-check';
      box.innerHTML = hint('Enter a value to run the check.');
      return;
    }
    var spec = buildSpec() || { metric: S.metric, param: S.param || null, height: S.height };

    box.className = 'mkf-check';
    box.innerHTML = hint('Reading the chain…');

    lcdGet(m.path(spec.param || '')).then(function (j) {
      var val = m.pick(j, spec.param);
      if (val === null || val === undefined) {
        box.className = 'mkf-check bad';
        box.innerHTML = '<b>Nothing to read.</b> The endpoint answered, but the value is not there. '
          + 'A market on this spec would have to be voided, and the bond burned. Check the parameter.';
        return;
      }

      if (m.discrete) {
        var passed = val === 'PROPOSAL_STATUS_PASSED';
        box.className = 'mkf-check ok';
        box.innerHTML = '<div class="mkf-row"><span>Status right now</span><b>' + esc(String(val)) + '</b></div>'
          + '<div class="mkf-row"><span>Would settle</span><b class="' + (passed ? 'y' : 'n') + '">'
          + (passed ? 'YES' : 'NO') + '</b></div>'
          + '<div class="mkf-note">A proposal that has already finished voting is not a market. '
          + 'Pick one that is still open.</div>'
          + '<pre>' + esc(curlFor(spec)) + '</pre>';
        return;
      }

      var th = Number(spec.threshold);
      var would = spec.comparator === 'lt' ? val < th
        : spec.comparator === 'lte' ? val <= th
          : spec.comparator === 'gt' ? val > th : val >= th;

      // Расхождение в тысячу раз почти всегда означает не тот масштаб:
      // LUNC вместо микроединиц, лишние или недостающие нули.
      var warn = '';
      if (th > 0 && val > 0) {
        var ratio = val / th;
        if (ratio >= 1000 || ratio <= 0.001) {
          var power = Math.round(Math.log10(ratio > 1 ? ratio : 1 / ratio));
          warn = '<div class="mkf-warn"><b>Check the units.</b> The metric and your value are about '
            + '10<sup>' + power + '</sup> apart. That usually means a wrong number of zeros: this '
            + 'market would be decided before it opens, and nobody would take the other side.</div>';
        }
      }

      box.className = 'mkf-check ' + (warn ? 'warn' : 'ok');
      box.innerHTML =
          '<div class="mkf-row"><span>Reads right now</span><b>' + esc(fmtMetric(m, val)) + '</b></div>'
        + '<div class="mkf-row"><span>Your value</span><b>' + esc(thresholdText(m, S.threshold)) + '</b></div>'
        + '<div class="mkf-row"><span>Would settle today</span><b class="' + (would ? 'y' : 'n') + '">'
        + (would ? 'YES' : 'NO') + '</b></div>'
        + warn
        + '<div class="mkf-note">If that is already the obvious answer, nobody will take the other side. '
        + 'A market worth opening is one you cannot call today.</div>'
        + '<pre>' + esc(curlFor(spec)) + '</pre>';
    }).catch(function () {
      box.className = 'mkf-check bad';
      box.innerHTML = '<b>Could not read it.</b> Either the parameter is wrong or every node is down. '
        + 'Do not create the market until this returns a value.';
    });
  }

  // ── валидация ─────────────────────────────────────────────────────────────

  function problems() {
    var out = [];
    var m = METRICS[S.metric];
    var now = Math.floor(Date.now() / 1000);
    var cut = S.cfg ? Number(S.cfg.bet_cutoff_secs) : 3600;

    if (m.param && !String(S.param).trim()) out.push(m.param.label + ' is required.');
    if (!m.discrete && !String(S.threshold).trim()) out.push('A value is required.');
    if (!questionText()) out.push('Fill in the condition - the question is built from it.');
    if (closeTs() <= now + 600) out.push('Predictions have to stay open at least ten more minutes.');
    if (S.lead < cut) {
      out.push('Predictions must close at least ' + Math.round(cut / 60)
        + ' minutes before resolution, or the outcome is visible while bets are open.');
    }
    if (!S.height) out.push('Block height could not be estimated. Reload and try again.');
    return out;
  }

  // ── свои выпадающие списки ────────────────────────────────────────────────
  //
  // Родной select рисует список средствами системы: его нельзя ни покрасить,
  // ни выровнять по остальному разделу.

  var ddHandlers = {};

  function dd(id, options, value, width) {
    var cur = null;
    for (var i = 0; i < options.length; i++) if (String(options[i].v) === String(value)) cur = options[i];
    return '<div class="mkf-dd" data-dd="' + id + '"' + (width ? ' style="max-width:' + width + '"' : '') + '>'
      + '<button type="button" class="mkf-dd-btn"><span>' + esc(cur ? cur.label : '—') + '</span>'
      + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button>'
      + '<div class="mkf-dd-list">'
      + options.map(function (o) {
        return '<button type="button" data-v="' + esc(o.v) + '"'
          + (String(o.v) === String(value) ? ' aria-selected="true"' : '') + '>' + esc(o.label) + '</button>';
      }).join('')
      + '</div></div>';
  }

  function onDD(id, fn) { ddHandlers[id] = fn; }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.mkf-dd-btn');
    var item = e.target.closest('.mkf-dd-list button');
    document.querySelectorAll('.mkf-dd.open').forEach(function (d) {
      if (!btn || d !== btn.parentNode) d.classList.remove('open');
    });
    if (btn) { btn.parentNode.classList.toggle('open'); return; }
    if (item) {
      var host = item.closest('.mkf-dd');
      host.classList.remove('open');
      var fn = ddHandlers[host.dataset.dd];
      if (fn) fn(item.dataset.v);
    }
  });

  // ── разметка ──────────────────────────────────────────────────────────────

  function dateFields() {
    var days = [], months = [], years = [], hours = [];
    var dim = daysInMonth(S.resY, S.resM);
    for (var d = 1; d <= dim; d++) days.push({ v: d, label: String(d) });
    for (var i = 0; i < 12; i++) months.push({ v: i, label: MONTHS[i] });
    var y0 = new Date().getUTCFullYear();
    for (var y = y0; y <= y0 + 3; y++) years.push({ v: y, label: String(y) });
    for (var h = 0; h < 24; h++) hours.push({ v: h, label: pad2(h) + ':00' });
    return '<div class="mkf-date">'
      + dd('resD', days, S.resD, '84px')
      + dd('resM', months, S.resM, '100px')
      + dd('resY', years, S.resY, '104px')
      + dd('resH', hours, S.resH, '116px')
      + '<span class="mkf-utc">UTC</span></div>';
  }

  function render() {
    var host = document.getElementById('mk-create-host');
    if (!host) return;
    var m = METRICS[S.metric];
    var bond = S.cfg ? Number(S.cfg.creation_bond) : 200000000000;
    var promo = S.cfg ? Number(S.cfg.promo_fee) : 0;
    var total = bond + (S.promoted ? promo : 0);
    var errs = problems();
    var q = questionText();
    var mList = metricsFor(S.category).map(function (k) {
      return { v: k, label: METRICS[k].label };
    });

    host.innerHTML = ''
      + '<h3 class="step-h"><span class="n">1</span>What do you want to predict?</h3>'
      + '<section class="card qform">'
      + '  <div class="field">'
      + '    <label>Category</label>'
      + '    <div class="chips" id="mkf-cats">'
      + usableCategories().map(function (c) {
        return '<button type="button" data-cat="' + c.id + '" aria-pressed="' + (S.category === c.id) + '">' + c.label + '</button>';
      }).join('')
      + '    </div>'
      + '  </div>'
      + '  <div class="qcols">'
      + '    <div class="field"><label>Metric</label>' + dd('metric', mList, S.metric) + '</div>'
      + (m.param ? '<div class="field"><label>' + esc(m.param.label) + '</label>'
        + (m.param.kind === 'denom'
          ? dd('param', DENOMS.map(function (d) { return { v: d, label: d.replace(/^u/, '').toUpperCase() }; }), S.param)
          : '<input type="text" id="mkf-param" placeholder="' + esc(m.param.placeholder || '') + '" value="' + esc(S.param) + '">')
        + '</div>' : '')
      + (m.discrete ? '' :
        '<div class="field"><label>Condition</label>' + dd('cmp', COMPARATORS, S.comparator) + '</div>'
        + '<div class="field"><label>Value <span class="opt">in ' + esc(m.unit.name) + '</span></label>'
        + '<input type="text" id="mkf-th" inputmode="decimal" placeholder="6000000000000" value="' + esc(S.threshold) + '"></div>')
      + '  </div>'
      + '  <div class="mkf-note">' + esc(m.note) + '</div>'
      + '</section>'

      + '<h3 class="step-h"><span class="n">2</span>Timing</h3>'
      + '<section class="card qform">'
      + '  <div class="field"><label>Resolution</label>' + dateFields()
      + '    <div class="mkf-note">The value is read at this moment. Always UTC, the same for everyone.</div>'
      + '  </div>'
      + '  <div class="field"><label>Predictions close</label>'
      + '    <div class="chips" id="mkf-lead">'
      + LEADS.map(function (l) {
        return '<button type="button" data-lead="' + l.secs + '" aria-pressed="' + (S.lead === l.secs) + '">' + l.label + '</button>';
      }).join('')
      + '    </div>'
      + '    <div class="mkf-note">Betting stops <b>' + esc(utcText(closeTs(), true))
      + '</b>. The gap exists so nobody can bet once the outcome is visible.</div>'
      + '  </div>'
      + '  <div class="mkf-note">'
      + (S.height
        ? 'Reading is taken at block <b>' + S.height + '</b>, estimated from '
        + S.blockSecs.toFixed(2) + 's per block. Blocks drift, so the height is what settles the '
        + 'market and the date is an approximation of it.'
        : 'Waiting for the chain to estimate the block height.')
      + '  </div>'
      + '</section>'

      + '<h3 class="step-h"><span class="n">3</span>Check it before you pay</h3>'
      + '<section class="card qform">'
      + '  <div id="mkf-check" class="mkf-check">' + hint('Fill the condition above, then run the check.') + '</div>'
      + '  <button type="button" class="ghost sm" id="mkf-run" style="margin-top:12px;">Run the check</button>'
      + '</section>'

      + '<h3 class="step-h"><span class="n">4</span>Preview</h3>'
      + '<section class="card qform mkf-preview">'
      + '  <div class="mkf-pcard" style="--c:' + (typeof catRgb === 'function' ? catRgb(S.category) : '139,150,184') + '">'
      + '    <div class="mkf-ptags"><span class="cat">' + esc(S.category) + '</span>'
      + '      <span class="cat src on">on-chain spec</span></div>'
      + '    <h4>' + (q ? esc(q) : '<span class="mkf-hint">The question appears once the condition is filled in.</span>') + '</h4>'
      + '    <div class="mkf-podds"><span class="y">YES 50%</span><span class="n">NO 50%</span></div>'
      + '    <div class="mkf-pdates">'
      + '      <div><span>Predictions close</span><b>' + esc(utcText(closeTs(), true)) + '</b></div>'
      + '      <div><span>Resolution</span><b>' + esc(utcText(resolveTs(), true)) + '</b></div>'
      + '    </div>'
      + '  </div>'
      + '  <div class="mkf-rule"><span>How this resolves</span>' + esc(resolutionRule()) + '</div>'
      + '  <div class="mkf-lock">Once published, the question, the metric, the value, the block and '
      + 'the resolution rule are fixed. Nobody can change them afterwards, including you.</div>'
      + '</section>'

      + '<section class="card summary">'
      + '  <img src="assets/img/icons/markets.webp" alt="" width="56" height="56">'
      + '  <div>'
      + '    <div class="t">Ready to publish</div>'
      + '    <div class="line">' + esc(S.category) + ' · creator fee <b>3%</b> of the losing pot</div>'
      + (errs.length
        ? '<div class="mkf-errs">' + errs.map(function (e) { return '<div>' + esc(e) + '</div>'; }).join('') + '</div>'
        : '<div class="mkf-ok-line">Bond comes back when the market settles. It is only lost if the '
        + 'question turns out to be unverifiable.</div>')
      + '  </div>'
      + '  <div class="price"><b>' + fmtLuncLocal(total) + ' LUNC</b><span>refundable bond'
      + (S.promoted && promo ? ' + promo' : '') + '</span></div>'
      + '  <button class="ask-go" id="mkf-go"' + (errs.length ? ' disabled style="opacity:.45;"' : '') + '>'
      + 'Publish prediction &rarr;</button>'
      + '</section>';

    wire();
  }

  function recalcHeight() { S.height = heightAt(resolveTs()); }

  function wire() {
    var cats = document.getElementById('mkf-cats');
    if (cats) cats.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cat]');
      if (!b) return;
      S.category = b.dataset.cat;
      // Метрика обязана принадлежать категории, иначе заголовок обещает
      // одно, а спека читает другое.
      var list = metricsFor(S.category);
      if (list.indexOf(S.metric) === -1) switchMetric(list[0], true);
      else render();
    });

    var lead = document.getElementById('mkf-lead');
    if (lead) lead.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-lead]');
      if (!b) return;
      S.lead = Number(b.dataset.lead);
      render();
    });

    onDD('metric', function (v) { switchMetric(v, true); });
    onDD('cmp', function (v) { S.comparator = v; render(); });
    onDD('param', function (v) { S.param = v; render(); });
    onDD('resD', function (v) { S.resD = Number(v); recalcHeight(); render(); });
    onDD('resM', function (v) {
      S.resM = Number(v);
      if (S.resD > daysInMonth(S.resY, S.resM)) S.resD = daysInMonth(S.resY, S.resM);
      recalcHeight(); render();
    });
    onDD('resY', function (v) {
      S.resY = Number(v);
      if (S.resD > daysInMonth(S.resY, S.resM)) S.resD = daysInMonth(S.resY, S.resM);
      recalcHeight(); render();
    });
    onDD('resH', function (v) { S.resH = Number(v); recalcHeight(); render(); });

    bind('mkf-param', 'input', function (v) { S.param = v; refreshPreview(); });
    bind('mkf-th', 'input', function (v) { S.threshold = v; refreshPreview(); });

    var run = document.getElementById('mkf-run');
    if (run) run.addEventListener('click', runCheck);

    var go = document.getElementById('mkf-go');
    if (go) go.addEventListener('click', submit);
  }

  function switchMetric(key, redraw) {
    S.metric = key;
    S.param = '';
    S.threshold = '';
    var nm = METRICS[key];
    if (nm.param && nm.param.kind === 'denom') S.param = DENOMS[0];
    if (redraw) render();
  }

  function bind(id, ev, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(ev, function () { fn(this.value); });
  }

  /** Обновление без полной перерисовки: render() сбрасывает фокус и
   *  каретку, и набирать значение становится невозможно. */
  function refreshPreview() {
    var q = questionText();
    var h = document.querySelector('.mkf-pcard h4');
    if (h) h.innerHTML = q ? esc(q)
      : '<span class="mkf-hint">The question appears once the condition is filled in.</span>';
    var r = document.querySelector('.mkf-rule');
    if (r) r.innerHTML = '<span>How this resolves</span>' + esc(resolutionRule());

    var errs = problems();
    var go = document.getElementById('mkf-go');
    if (go) { go.disabled = errs.length > 0; go.style.opacity = errs.length ? '.45' : ''; }
    var box = document.querySelector('.mkf-errs');
    if (box) {
      box.innerHTML = errs.map(function (e) { return '<div>' + esc(e) + '</div>'; }).join('');
      box.style.display = errs.length ? '' : 'none';
    }
  }

  // ── отправка ──────────────────────────────────────────────────────────────

  function submit() {
    if (problems().length) return;
    if (!mkWallet()) { alert('Connect a wallet first.'); return; }

    var spec = buildSpec();
    var bond = Number(S.cfg ? S.cfg.creation_bond : 0);
    var promo = S.promoted && S.cfg ? Number(S.cfg.promo_fee) : 0;
    var go = document.getElementById('mkf-go');
    go.disabled = true;
    go.textContent = 'Confirm in your wallet…';

    window.sendExecuteContract(
      mkWallet(), CONTRACT,
      {
        create: {
          question: questionText(),
          category: S.category,
          spec: spec,
          bets_close_at: closeTs(),
          resolve_after: resolveTs(),
          promoted: !!S.promoted,
        },
      },
      [{ denom: 'uluna', amount: String(bond + promo) }],
      'oracle-prophecy: create', PROPHECY_CHAIN, 700000
    ).then(function (hash) {
      console.log('[prophecy] create tx', hash);
      go.textContent = 'Sent, waiting for the block…';
      setTimeout(function () {
        closeCreate();
        if (typeof renderMarkets === 'function') renderMarkets(false);
      }, 7000);
    }).catch(function (e) {
      alert(e.message || 'Transaction failed');
      go.disabled = false;
      go.textContent = 'Publish prediction →';
    });
  }

  // ── открытие и закрытие ───────────────────────────────────────────────────

  function openCreate() {
    var panel = document.getElementById('mk-create');
    var list = document.getElementById('mk-browse');
    if (!panel) return;
    panel.style.display = '';
    if (list) list.style.display = 'none';

    if (!S.cfg) query({ config: {} }).then(function (c) { S.cfg = c; render(); }).catch(function () {});
    if (!S.chain) loadChainTip().then(function () { recalcHeight(); render(); }).catch(function () {});
    render();
  }

  function closeCreate() {
    var panel = document.getElementById('mk-create');
    var list = document.getElementById('mk-browse');
    if (panel) panel.style.display = 'none';
    if (list) list.style.display = '';
  }

  window.openMarketCreate = openCreate;
  window.closeMarketCreate = closeCreate;
})();
