/**
 * markets-create.js - создание рынка в oracle-prophecy.
 *
 * Форма собирает спецификацию и ПЕРЕД отправкой выполняет тот же запрос,
 * который потом ляжет в блок Verify. Человек видит, что метрика читается,
 * что порог в тех же единицах и что рынок не решён заранее - до того, как
 * заплатил залог.
 *
 * Только ончейн-метрики. Свободный критерий (спорт, биржи, мировые события)
 * ждёт открытого challenge: пока оспорить исход может лишь админ, такой рынок
 * держится на одном ключе, и предлагать его людям нечестно.
 *
 * Загружать ПОСЛЕ markets.js: оттуда берутся адрес контракта и список узлов.
 */

(function () {
  'use strict';

  var CONTRACT = typeof PROPHECY_CONTRACT !== 'undefined' ? PROPHECY_CONTRACT : '';
  var LCD = typeof PROPHECY_LCD !== 'undefined' ? PROPHECY_LCD
    : ['https://terra-classic-lcd.publicnode.com'];

  // ── метрики ───────────────────────────────────────────────────────────────
  //
  // path   - что дёргаем у LCD
  // pick   - как достать число из ответа
  // unit   - в чём человек вводит порог, и как это превратить в единицы цепочки
  // note   - то, что обязано попасть в criterion, иначе исход можно оспорить

  function num(v) { return Number(v || 0); }

  var METRICS = {
    total_supply: {
      label: 'Total LUNC supply',
      cats: ['economy', 'protocol'],
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
      cats: ['network', 'protocol'],
      path: function () { return '/cosmos/staking/v1beta1/pool'; },
      pick: function (j) {
        var p = j && j.pool; if (!p) return null;
        var b = num(p.bonded_tokens), n = num(p.not_bonded_tokens);
        return b + n ? (b / (b + n)) * 100 : null;
      },
      unit: { name: '%', mul: 1, dec: 4 },
      // Эндпоинт отдаёт две суммы, а не готовое отношение. Формула обязана
      // быть в критерии, иначе исход разойдётся с тем, что считал резолвер.
      note: 'bonded_tokens / (bonded_tokens + not_bonded_tokens) from the staking pool, in percent',
    },
    community_pool: {
      label: 'Community pool',
      cats: ['economy', 'protocol'],
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

  // Порядок как в меню фильтров. Значения совпадают с MARKET_COLORS в markets.js.
  var CATEGORIES = [
    { id: 'economy', label: 'Economy' },
    { id: 'governance', label: 'Governance' },
    { id: 'protocol', label: 'Protocol' },
    { id: 'validators', label: 'Validators' },
    { id: 'network', label: 'Network' },
  ];

  var COMPARATORS = [
    { id: 'gt', label: 'greater than' },
    { id: 'gte', label: 'at least' },
    { id: 'lt', label: 'below' },
    { id: 'lte', label: 'at most' },
  ];

  var DENOMS = ['uusd', 'ukrw', 'usdr', 'umnt', 'ueur', 'ucny', 'ujpy', 'ugbp',
    'uinr', 'ucad', 'uchf', 'uhkd', 'uaud', 'usgd', 'uthb', 'usek', 'unok',
    'udkk', 'uidr', 'uphp'];

  // ── вопрос и правило из условия ───────────────────────────────────────────
  //
  // Единственный источник истины - введённое условие. Заголовок и criterion
  // выводятся из него, поэтому разойтись, как случилось у тестового рынка,
  // им нечем.

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /** Дата всегда в UTC: цепочка живёт в UTC, и рынок должны одинаково
   *  понимать из любого часового пояса. */
  function utcText(local, withTime) {
    if (!local) return '';
    var d = new Date(local);
    if (isNaN(d.getTime())) return '';
    var s = d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    return withTime ? s + ', ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC' : s;
  }

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

  /** Порог в том же виде, в каком его увидит читатель: 6T LUNC, а не
   *  6000000000000000000. Считается из введённого значения, не из
   *  микроединиц. */
  function thresholdText(m, typed) {
    var v = Number(String(typed).replace(/[^0-9.]/g, ''));
    if (!isFinite(v)) return '';
    if (m.unit.name === 'LUNC') {
      var exact = v.toLocaleString('en-US', { maximumFractionDigits: 0 });
      if (v >= 1e12) return (+(v / 1e12).toFixed(2)) + 'T LUNC';
      if (v >= 1e9) return (+(v / 1e9).toFixed(2)) + 'B LUNC';
      if (v >= 1e6) return (+(v / 1e6).toFixed(2)) + 'M LUNC';
      return exact + ' LUNC';
    }
    if (m.unit.name === '%') return v + '%';
    return String(typed).trim();
  }

  /** Заголовок рынка. Без времени: точный момент живёт в правиле ниже и
   *  в блоке сроков, а в вопрос он влезает плохо. */
  function questionText() {
    var m = METRICS[S.metric];
    var what = (PHRASE[S.metric] || function () { return S.metric; })(S.param);
    var when = utcText(S.resolveAt, false);
    var tail = when ? ' on ' + when + '?' : '?';
    if (m.discrete) return 'Will ' + what + ' have passed' + tail;
    var cmp = CMP_WORD[S.comparator] || S.comparator;
    var th = thresholdText(m, S.threshold);
    if (!th) return '';
    return 'Will ' + what + ' be ' + cmp + ' ' + th + tail;
  }

  /** Правило расчёта. Уходит в контракт как criterion и остаётся там
   *  навсегда, поэтому пишется полностью и без сокращений: что читаем,
   *  где читаем, с чем сравниваем и что означает YES. */
  function resolutionRule() {
    var m = METRICS[S.metric];
    var what = (PHRASE[S.metric] || function () { return S.metric; })(S.param);
    var at = 'at block ' + (S.height || '?')
      + (S.resolveAt ? ' (' + utcText(S.resolveAt, true) + ')' : '');
    if (m.discrete) {
      return 'YES if the status of ' + what + ' reported by the Terra Classic chain '
        + at + ' is PROPOSAL_STATUS_PASSED. Otherwise NO. Source: ' + m.note + '.';
    }
    var cmp = CMP_WORD[S.comparator] || S.comparator;
    var th = thresholdText(m, S.threshold);
    return 'YES if ' + what + ' reported by the Terra Classic chain ' + at
      + ' is ' + cmp + ' ' + th + '. Otherwise NO. Source: ' + m.note + '.';
  }

  // ── состояние формы ───────────────────────────────────────────────────────

  var S = {
    category: 'economy',
    metric: 'total_supply',
    param: '',
    comparator: 'lt',
    threshold: '',
    closeAt: '',      // datetime-local
    resolveAt: '',
    promoted: false,
    height: null,     // расчётная высота под resolveAt
    cfg: null,        // config контракта
    chain: null,      // высота и время последнего блока
    blockSecs: 6,
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtLunc(u) {
    return Math.floor(Number(u || 0) / 1e6).toLocaleString('en-US');
  }

  // AbortSignal.timeout поддержан не везде: на части кошельковых браузеров
  // запрос просто не уходит. Контроллер с таймером работает одинаково.
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

  function lcdGet(path, height) {
    var i = 0;
    function next() {
      if (i >= LCD.length) return Promise.reject(new Error('chain unavailable'));
      var base = LCD[i++];
      var url = base + path;
      // Высота передаётся заголовком, но fetch к чужому узлу с произвольным
      // заголовком уходит в preflight. Поэтому для прошлых высот используем
      // тот же заголовок только там, где он действительно нужен - в проверке.
      var opts = height ? { headers: { 'x-cosmos-block-height': String(height) } } : null;
      return (opts ? fetchWithHeaders(url, opts) : get(url)).catch(next);
    }
    return next();
  }

  function fetchWithHeaders(url, opts) {
    var c = new AbortController();
    var t = setTimeout(function () { c.abort(); }, 10000);
    var h = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    return fetch(url, { headers: h, signal: c.signal })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .finally(function () { clearTimeout(t); });
  }

  function query(msg) {
    var q = btoa(JSON.stringify(msg));
    return lcdGet('/cosmwasm/wasm/v1/contract/' + CONTRACT + '/smart/' + q)
      .then(function (j) { return j.data; });
  }

  // ── высота блока по дате ──────────────────────────────────────────────────
  //
  // Реальное время блока меряем по двум точкам, а не берём «шесть секунд» на
  // веру: на Terra Classic оно плавает, и на горизонте в месяц ошибка в
  // полсекунды - это почти сутки.

  function loadChainTip() {
    return lcdGet('/cosmos/base/tendermint/v1beta1/blocks/latest').then(function (j) {
      var h = Number(j.block.header.height);
      var t = Date.parse(j.block.header.time) / 1000;
      var back = Math.max(h - 20000, 1);
      return lcdGet('/cosmos/base/tendermint/v1beta1/blocks/' + back)
        .then(function (j2) {
          var t2 = Date.parse(j2.block.header.time) / 1000;
          S.blockSecs = (t - t2) / (h - back);
          S.chain = { height: h, time: t };
        })
        .catch(function () { S.chain = { height: h, time: t }; });
    });
  }

  function heightAt(unixSecs) {
    if (!S.chain) return null;
    var d = unixSecs - S.chain.time;
    if (d <= 0) return null;
    return S.chain.height + Math.round(d / S.blockSecs);
  }

  function tsOf(local) {
    if (!local) return 0;
    return Math.floor(new Date(local).getTime() / 1000);
  }

  // ── спека ─────────────────────────────────────────────────────────────────

  function buildSpec() {
    var m = METRICS[S.metric];
    var raw = null;
    if (!m.discrete) {
      var v = String(S.threshold).replace(/[^0-9.]/g, '');
      if (v === '') return null;
      if (m.unit.mul === 1e6) {
        // Порог уходит в цепочку в микроединицах. Это место, где ошибается
        // каждый: 6T LUNC и 6T uluna отличаются в миллион раз.
        raw = String(Math.round(Number(v) * 1e6));
      } else {
        raw = v;
      }
    }
    // В контракт уходит полное правило, а не служебная подпись к метрике:
    // criterion неизменяем и остаётся единственным человеческим описанием
    // того, за что держат деньги.
    var human = resolutionRule();
    return {
      metric: S.metric,
      param: m.param ? (S.param || null) : null,
      comparator: m.discrete ? null : S.comparator,
      threshold: raw,
      height: S.height,
      criterion: human,
    };
  }

  function curlFor(spec) {
    var m = METRICS[spec.metric];
    return 'curl -s -H "x-cosmos-block-height: ' + (spec.height || '?') + '" \\\n  "'
      + LCD[0] + m.path(spec.param || '') + '"';
  }

  // ── живая проверка ────────────────────────────────────────────────────────
  //
  // Читаем метрику на ТЕКУЩЕЙ высоте и показываем, чем рынок разрешился бы
  // сегодня. Если ответ пустой - спека нерабочая, и залог сгорит.

  function fmtMetric(m, raw) {
    if (m.unit.mul === 1e6) {
      var v = Number(raw || 0) / 1e6;
      var exact = v.toLocaleString('en-US', { maximumFractionDigits: 0 });
      if (v >= 1e12) return (+(v / 1e12).toFixed(2)) + 'T LUNC (' + exact + ')';
      if (v >= 1e9) return (+(v / 1e9).toFixed(2)) + 'B LUNC (' + exact + ')';
      if (v >= 1e6) return (+(v / 1e6).toFixed(2)) + 'M LUNC (' + exact + ')';
      return exact + ' LUNC';
    }
    if (m.unit.name === '%') return Number(raw).toFixed(2) + '%';
    return String(Number(raw).toFixed(Math.min(m.unit.dec, 12)))
      .replace(/0+$/, '').replace(/\.$/, '');
  }

  function runCheck() {
    var box = document.getElementById('mkf-check');
    if (!box) return;
    var spec = buildSpec();
    var m = METRICS[S.metric];

    if (m.param && !S.param) { box.className = 'mkf-check'; box.innerHTML = hint('Fill in ' + m.param.label.toLowerCase() + ' to run the check.'); return; }
    if (!spec) { box.className = 'mkf-check'; box.innerHTML = hint('Enter a threshold to run the check.'); return; }

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

      // Сравнение порядков. Порог и значение хранятся в одних единицах,
      // поэтому расхождение в тысячу раз почти всегда означает, что
      // человек ввёл не то: LUNC вместо микроединиц, проценты вместо доли,
      // лишние или недостающие нули.
      var warn = '';
      if (th > 0 && val > 0) {
        var ratio = val / th;
        if (ratio >= 1000 || ratio <= 0.001) {
          var power = Math.round(Math.log10(ratio > 1 ? ratio : 1 / ratio));
          warn = '<div class="mkf-warn"><b>Check the units.</b> The metric and your threshold are '
            + 'about 10<sup>' + power + '</sup> apart. That usually means a wrong number of zeros: '
            + 'this market would be decided before it opens, and nobody would take the other side.</div>';
        }
      }

      box.className = 'mkf-check ' + (warn ? 'warn' : 'ok');
      box.innerHTML =
          '<div class="mkf-row"><span>Reads right now</span><b>' + esc(fmtMetric(m, val)) + '</b></div>'
        + '<div class="mkf-row"><span>Your threshold</span><b>' + esc(fmtMetric(m, th)) + '</b></div>'
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


  function hint(t) { return '<span class="mkf-hint">' + esc(t) + '</span>'; }

  // ── валидация ─────────────────────────────────────────────────────────────

  function problems() {
    var out = [];
    var m = METRICS[S.metric];
    var now = Math.floor(Date.now() / 1000);
    var close = tsOf(S.closeAt), resolve = tsOf(S.resolveAt);
    var cut = S.cfg ? Number(S.cfg.bet_cutoff_secs) : 3600;

    if (!questionText()) out.push('Fill in the condition - the question is built from it.');
    if (m.param && !S.param.trim()) out.push(m.param.label + ' is required.');
    if (!m.discrete && !String(S.threshold).trim()) out.push('A threshold is required.');
    if (!close) out.push('Set when betting closes.');
    else if (close <= now + 600) out.push('Betting has to stay open at least ten more minutes.');
    if (!resolve) out.push('Set when the market resolves.');
    else if (close && close + cut > resolve) {
      out.push('Resolution must be at least ' + Math.round(cut / 60)
        + ' minutes after betting closes - otherwise the outcome is visible while bets are still open.');
    }
    if (resolve && !S.height) out.push('Block height could not be estimated. Reload and try again.');
    return out;
  }

  // ── разметка ──────────────────────────────────────────────────────────────

  function render() {
    var host = document.getElementById('mk-create-host');
    if (!host) return;
    var m = METRICS[S.metric];
    var bond = S.cfg ? Number(S.cfg.creation_bond) : 200000000000;
    var promo = S.cfg ? Number(S.cfg.promo_fee) : 0;
    var total = bond + (S.promoted ? promo : 0);
    var errs = problems();
    var q = questionText();

    host.innerHTML = ''
      + '<h3 class="step-h"><span class="n">1</span>What do you want to predict?</h3>'
      + '<section class="card qform">'
      + '  <div class="field">'
      + '    <label>Category</label>'
      + '    <div class="chips" id="mkf-cats">'
      + CATEGORIES.map(function (c) {
        return '<button type="button" data-cat="' + c.id + '" aria-pressed="' + (S.category === c.id) + '">' + c.label + '</button>';
      }).join('')
      + '    </div>'
      + '  </div>'
      + '  <div class="qcols">'
      + '    <div class="field">'
      + '      <label>Metric</label>'
      + '      <select id="mkf-metric">'
      + Object.keys(METRICS).map(function (k) {
        return '<option value="' + k + '"' + (S.metric === k ? ' selected' : '') + '>' + METRICS[k].label + '</option>';
      }).join('')
      + '      </select>'
      + '    </div>'
      + (m.param ? '<div class="field"><label>' + esc(m.param.label) + '</label>'
        + (m.param.kind === 'denom'
          ? '<select id="mkf-param">' + DENOMS.map(function (d) {
            return '<option value="' + d + '"' + (S.param === d ? ' selected' : '') + '>' + d + '</option>';
          }).join('') + '</select>'
          : '<input type="text" id="mkf-param" placeholder="' + esc(m.param.placeholder || '') + '" value="' + esc(S.param) + '">')
        + '</div>' : '')
      + (m.discrete ? '' :
        '<div class="field"><label>Condition</label>'
        + '<select id="mkf-cmp">' + COMPARATORS.map(function (c) {
          return '<option value="' + c.id + '"' + (S.comparator === c.id ? ' selected' : '') + '>' + c.label + '</option>';
        }).join('') + '</select></div>'
        + '<div class="field"><label>Value <span class="opt">in ' + esc(m.unit.name) + '</span></label>'
        + '<input type="text" id="mkf-th" inputmode="decimal" placeholder="6000000000000" value="' + esc(S.threshold) + '"></div>')
      + '  </div>'
      + '  <div class="mkf-note">' + esc(m.note) + '</div>'
      + '</section>'

      + '<h3 class="step-h"><span class="n">2</span>Timing</h3>'
      + '<section class="card qform">'
      + '  <div class="qcols">'
      + '    <div class="field"><label>Predictions close</label>'
      + '      <input type="datetime-local" id="mkf-close" value="' + esc(S.closeAt) + '">'
      + '      <div class="mkf-note">' + (S.closeAt ? esc(utcText(S.closeAt, true)) : 'Until this moment people can take a side.') + '</div></div>'
      + '    <div class="field"><label>Resolution</label>'
      + '      <input type="datetime-local" id="mkf-resolve" value="' + esc(S.resolveAt) + '">'
      + '      <div class="mkf-note">' + (S.resolveAt ? esc(utcText(S.resolveAt, true)) : 'When the value is read.') + '</div></div>'
      + '  </div>'
      + '  <div class="mkf-note">'
      + (S.height
        ? 'Reading is taken at block <b>' + S.height + '</b>, estimated from '
        + S.blockSecs.toFixed(2) + 's per block. Blocks drift, so the height is what settles the '
        + 'market and the date is an approximation of it.'
        : 'Pick a resolution time to see which block the reading comes from.')
      + '  </div>'
      + '</section>'

      + '<h3 class="step-h"><span class="n">3</span>Check it before you pay</h3>'
      + '<section class="card qform">'
      + '  <div id="mkf-check" class="mkf-check">' + hint('Fill the condition above, then run the check.') + '</div>'
      + '  <button type="button" class="ghost sm" id="mkf-run" style="margin-top:12px;">Run the check</button>'
      + '</section>'

      + '<h3 class="step-h"><span class="n">4</span>Preview</h3>'
      + '<section class="card qform mkf-preview">'
      + '  <div class="mkf-pcard" style="--c:' + catRgb(S.category) + '">'
      + '    <div class="mkf-ptags"><span class="cat">' + esc(S.category) + '</span>'
      + '      <span class="cat src on">on-chain spec</span></div>'
      + '    <h4>' + (q ? esc(q) : '<span class="mkf-hint">The question appears once the condition is filled in.</span>') + '</h4>'
      + '    <div class="mkf-podds"><span class="y">YES 50%</span><span class="n">NO 50%</span></div>'
      + '    <div class="mkf-pdates">'
      + '      <div><span>Predictions close</span><b>' + (esc(utcText(S.closeAt, true)) || '—') + '</b></div>'
      + '      <div><span>Resolution</span><b>' + (esc(utcText(S.resolveAt, true)) || '—') + '</b></div>'
      + '    </div>'
      + '  </div>'
      + '  <div class="mkf-rule"><span>How this resolves</span>' + esc(resolutionRule()) + '</div>'
      + '  <div class="mkf-lock">Once published, the question, the metric, the threshold, the '
      + 'block and the resolution rule are fixed. Nobody can change them afterwards, including you.</div>'
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
      + '  <div class="price"><b>' + fmtLunc(total) + ' LUNC</b><span>refundable bond'
      + (S.promoted && promo ? ' + promo' : '') + '</span></div>'
      + '  <button class="ask-go" id="mkf-go"' + (errs.length ? ' disabled style="opacity:.45;"' : '') + '>'
      + 'Publish prediction &rarr;</button>'
      + '</section>';

    wire();
  }


  function wire() {
    var cats = document.getElementById('mkf-cats');
    if (cats) cats.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cat]');
      if (!b) return;
      S.category = b.dataset.cat;
      cats.querySelectorAll('button').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === b));
      });
      render();
    });

    bind('mkf-metric', 'change', function (v) {
      S.metric = v; S.param = ''; S.threshold = '';
      var m = METRICS[S.metric];
      if (m.param && m.param.kind === 'denom') S.param = DENOMS[0];
      if (m.cats.indexOf(S.category) === -1) S.category = m.cats[0];
      render();
    });
    // Предпросмотр обязан обновляться на каждый символ: он и есть вопрос,
    // который увидят люди.
    bind('mkf-param', 'input', function (v) { S.param = v; refreshPreview(); });
    bind('mkf-param', 'change', function (v) { S.param = v; refreshPreview(); });
    bind('mkf-cmp', 'change', function (v) { S.comparator = v; refreshPreview(); });
    bind('mkf-th', 'input', function (v) { S.threshold = v; refreshPreview(); });
    bind('mkf-close', 'change', function (v) { S.closeAt = v; render(); });
    bind('mkf-resolve', 'change', function (v) {
      S.resolveAt = v;
      S.height = heightAt(tsOf(v));
      render();
    });

    var run = document.getElementById('mkf-run');
    if (run) run.addEventListener('click', runCheck);

    var go = document.getElementById('mkf-go');
    if (go) go.addEventListener('click', submit);
  }

  /** Обновление предпросмотра без полной перерисовки: render() сбрасывает
   *  фокус и каретку, и набирать порог становится невозможно. */
  function refreshPreview() {
    var q = questionText();
    var h = document.querySelector('.mkf-pcard h4');
    if (h) h.innerHTML = q ? esc(q)
      : '<span class="mkf-hint">The question appears once the condition is filled in.</span>';
    var r = document.querySelector('.mkf-rule');
    if (r) r.innerHTML = '<span>How this resolves</span>' + esc(resolutionRule());
    refreshSummary();
  }


  function bind(id, ev, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(ev, function () { fn(this.value); });
  }

  // Пересчёт только сводки: полный render сбрасывает фокус и каретку в поле,
  // из-за чего набирать текст становится невозможно.
  function refreshSummary() {
    var errs = problems();
    var go = document.getElementById('mkf-go');
    if (go) {
      go.disabled = errs.length > 0;
      go.style.opacity = errs.length ? '.45' : '';
    }
    var box = document.querySelector('.mkf-errs');
    if (box) {
      box.innerHTML = errs.map(function (e) { return '<div>' + esc(e) + '</div>'; }).join('');
      box.style.display = errs.length ? '' : 'none';
    }
  }

  // ── отправка ──────────────────────────────────────────────────────────────

  function submit() {
    if (problems().length) return;
    if (!window.globalWalletAddress) { alert('Connect a wallet first.'); return; }

    var spec = buildSpec();
    var bond = Number(S.cfg ? S.cfg.creation_bond : 0);
    var promo = S.promoted && S.cfg ? Number(S.cfg.promo_fee) : 0;
    var go = document.getElementById('mkf-go');
    go.disabled = true;
    go.textContent = 'Confirm in your wallet…';

    window.sendExecuteContract(
      window.globalWalletAddress, CONTRACT,
      {
        create: {
          question: questionText(),
          category: S.category,
          spec: spec,
          bets_close_at: tsOf(S.closeAt),
          resolve_after: tsOf(S.resolveAt),
          promoted: !!S.promoted,
        },
      },
      [{ denom: 'uluna', amount: String(bond + promo) }],
      'oracle-prophecy: create', 'columbus-5'
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
      go.textContent = 'Create market →';
    });
  }

  // ── открытие и закрытие панели ────────────────────────────────────────────

  function openCreate() {
    var panel = document.getElementById('mk-create');
    var list = document.getElementById('mk-browse');
    if (!panel) return;
    panel.style.display = '';
    if (list) list.style.display = 'none';

    if (!S.cfg) {
      query({ config: {} }).then(function (c) { S.cfg = c; render(); }).catch(function () { render(); });
    }
    if (!S.chain) loadChainTip().then(render).catch(function () {});
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
