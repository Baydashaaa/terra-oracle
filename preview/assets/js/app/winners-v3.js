// ═══ WINNERS v3 - Circuit в списке и статистика раунда ═══════════════════
// Дополняет блок WINNERS v2 выше: объявления ниже по файлу перекрывают
// ранние, поэтому renderWinners и filterWinners переопределяются здесь, а
// mapWinnerEntry и renderWinnersStats остаются как были.
//
// Два добавления:
//   1. Раунды Circuit в разделе Winners. Живут ОТДЕЛЬНЫМ массивом, а не в
//      winnersData: тот читают ещё шесть мест (счётчики розыгрышей, последний
//      победитель daily, раздел Verify), и подмешивание туда восьми раундов
//      в сутки сломало бы их счёт.
//   2. Разбор раунда по клику: кто участвовал, сколько входов у каждого,
//      какая доля. Данные берутся из снимка в rounds/ - того же файла, по
//      которому раунд проверяется на странице Verify, так что показанное
//      совпадает с доказуемым.
//
// Фильтр All намеренно оставлен как был - daily и weekly. Circuit идёт раз в
// три часа, и в общей ленте он за неделю вытеснил бы всё остальное. Для него
// свой чип.

var circuitWinners = [];
var circuitWinnersLoaded = false;
var roundStatsCache = {};

// ── раунд Circuit → та же форма, что у daily/weekly ───────────────────────
function mapCircuitRound(r, roundNumber) {
  if (!r || r.status !== 'closed' || typeof r.winnerZone !== 'number') return null;

  var zonesBy = {};
  (r.blocks || []).forEach(function (b) {
    zonesBy[b.wallet] = (zonesBy[b.wallet] || 0) + (b.to - b.from + 1);
  });

  var prize = (r.split && r.split.prize) ? Math.round(r.split.prize / 1e6) : null;

  return {
    type: 'circuit',
    round: roundNumber,
    roundId: r.roundId,
    tickets: r.sold || 0,
    participants: Object.keys(zonesBy).length,
    blockHeight: r.blockHeight || null,
    blockHash: r.blockHash || null,
    time: r.closedAt ? Math.floor(new Date(r.closedAt).getTime() / 1000) : 0,
    zone: r.winnerZone,
    places: [{
      place: 1,
      address: r.winner,
      amount: prize,
      index: r.winnerZone,
      tx: r.txWinner || null
    }],
    paid: prize || 0
  };
}

async function loadCircuitWinners() {
  try {
    var res = await fetch(DRAW_WORKER + '/circuit/history?limit=60');
    if (!res.ok) return;
    var data = await res.json();
    var rounds = (data && data.rounds) || [];
    var closed = rounds.filter(function (r) { return r && r.status === 'closed'; });
    // История приходит новыми вперёд, а номер раунда должен расти со временем
    circuitWinners = closed.map(function (r, i) {
      return mapCircuitRound(r, closed.length - i);
    }).filter(Boolean);
  } catch (e) {
    console.warn('loadCircuitWinners:', e);
  }
  circuitWinnersLoaded = true;
  renderWinners();
}

// ── стили панели ─────────────────────────────────────────────────────────
function ensureRoundStatsStyle() {
  if (document.getElementById('rs-style')) return;
  var s = document.createElement('style');
  s.id = 'rs-style';
  s.textContent =
    '.wn-stats-panel{grid-column:1/-1;margin-top:10px;border-top:1px solid rgba(255,255,255,.10);padding-top:10px;font-size:12.5px}' +
    '.wn-stats-panel .rs-sum{color:#7fa8a5;margin-bottom:8px}' +
    '.wn-stats-panel table{width:100%;border-collapse:collapse}' +
    '.wn-stats-panel td{padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.06);white-space:nowrap}' +
    '.wn-stats-panel td.rs-a{width:100%;overflow:hidden;text-overflow:ellipsis}' +
    '.wn-stats-panel tr.rs-win td{color:#f4d03f}' +
    '.wn-stats-panel .rs-bar{display:inline-block;height:6px;border-radius:3px;background:#38d9d0;vertical-align:middle}' +
    '.wn-stats-panel tr.rs-win .rs-bar{background:#f4d03f}' +
    '.wn-stats{}' +
    '.wn-more{background:none;border:1px solid rgba(255,255,255,.18);color:#a8ece8;border-radius:6px;' +
      'padding:2px 9px;font-size:11px;cursor:pointer;margin-left:6px}' +
    '.wn-chip.c{background:rgba(56,217,208,.16);color:#38d9d0}';
  document.head.appendChild(s);
}

// ── снимок раунда → список участников ────────────────────────────────────
// Снимок daily/weekly хранит билеты как [кошелёк, входов, токен, тир],
// снимок Circuit - блоки зон как [кошелёк, от, до]. Приводим к одному виду.
function participantsFromSnapshot(snap, type) {
  var rows = [], total = 0;

  if (type === 'circuit') {
    var by = {};
    (snap.blocks || []).forEach(function (b) {
      var w = b[0], n = b[2] - b[1] + 1;
      by[w] = (by[w] || 0) + n;
      total += n;
    });
    rows = Object.keys(by).map(function (w) { return { address: w, count: by[w], note: null }; });
  } else {
    (snap.tickets || []).forEach(function (t) {
      total += t[1] || 0;
      rows.push({ address: t[0], count: t[1] || 0, note: t[3] || null });
    });
  }

  rows.sort(function (a, b) { return b.count - a.count; });
  return { rows: rows, total: total };
}

async function toggleRoundStats(roundId, type, btn) {
  ensureRoundStatsStyle();
  var card = btn && btn.closest('.wn-card');
  if (!card) return;

  var open = card.querySelector('.wn-stats-panel');
  if (open) { open.remove(); btn.textContent = 'stats'; return; }

  btn.textContent = 'loading…';
  var panel = document.createElement('div');
  panel.className = 'wn-stats-panel';
  card.appendChild(panel);

  var snap = roundStatsCache[roundId];
  if (!snap) {
    try {
      var r = await fetch('./rounds/' + roundId + '.json?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      snap = await r.json();
      roundStatsCache[roundId] = snap;
    } catch (e) {
      // Снимка может не быть у самых старых раундов и у тех, чей коммит не
      // сохранился. Молчать нельзя - иначе кнопка выглядит сломанной.
      panel.innerHTML = '<div class="rs-sum">No snapshot stored for this round.</div>';
      btn.textContent = 'stats';
      return;
    }
  }

  var winner = String((snap.winner) || '').toLowerCase();
  if (!winner && type !== 'circuit') {
    var wi = snap.winner_index;
    var t = (snap.tickets || [])[wi];
    if (t) winner = String(t[0]).toLowerCase();
  }

  var data = participantsFromSnapshot(snap, type);
  var unit = type === 'circuit' ? 'zone' : 'entry';
  var unitPl = type === 'circuit' ? 'zones' : 'entries';

  var rowsHtml = data.rows.map(function (p) {
    var share = data.total ? (p.count / data.total * 100) : 0;
    var mine = String(p.address).toLowerCase() === winner;
    return '<tr class="' + (mine ? 'rs-win' : '') + '">' +
      '<td class="rs-a" title="' + p.address + '">' + fmtAddr(p.address) +
        (mine ? ' &#9733;' : '') + '</td>' +
      '<td>' + p.count + '</td>' +
      '<td>' + share.toFixed(1) + '%</td>' +
      '<td><span class="rs-bar" style="width:' + Math.max(2, Math.round(share * 0.6)) + 'px"></span></td>' +
      '</tr>';
  }).join('');

  panel.innerHTML =
    '<div class="rs-sum">' + data.rows.length + ' participants &middot; ' +
      data.total + ' ' + (data.total === 1 ? unit : unitPl) +
      ' &middot; winner marked &#9733;</div>' +
    '<table>' + rowsHtml + '</table>';
  btn.textContent = 'hide';
}
window.toggleRoundStats = toggleRoundStats;

// ── фильтры ──────────────────────────────────────────────────────────────
// Присваивание, а не объявление: filterWinners и renderWinners уже объявлены
// выше по файлу. В обычном <script> повторное объявление легально и побеждает
// последнее, но репо помечен как ESM, и любая проверка синтаксиса на это
// ругается. Присваивание в window перезаписывает ту же глобальную привязку,
// поэтому вызовы по имени из старого кода попадают сюда.
window.filterWinners = function (f) {
  winnersFilter = f;
  ['all', 'daily', 'weekly', 'circuit', 'mine'].forEach(function (k) {
    var b = document.getElementById('wf-' + k);
    if (b) b.classList.toggle('active', k === f);
  });
  // ALL тоже показывает Circuit, поэтому подтягиваем историю и для него:
  // раньше вкладка ALL молчала о раундах, пока пользователь не открывал CIRCUIT.
  if ((f === 'circuit' || f === 'all' || f === 'mine') && !circuitWinnersLoaded) {
    loadCircuitWinners();
    return;
  }
  renderWinners();
};

// ── список карточек ──────────────────────────────────────────────────────
window.renderWinners = function () {
  var host = document.getElementById('wn-list');
  if (!host) return;
  ensureRoundStatsStyle();

  var me = String(
    (typeof connectedWalletAddress !== 'undefined' && connectedWalletAddress) ||
    (typeof lotteryAddress !== 'undefined' && lotteryAddress) || ''
  ).toLowerCase();

  var list;
  if (winnersFilter === 'daily')       list = (winnersData || []).filter(function (w) { return w.type === 'daily'; });
  else if (winnersFilter === 'weekly') list = (winnersData || []).filter(function (w) { return w.type === 'weekly'; });
  else if (winnersFilter === 'circuit') list = circuitWinners;
  else if (winnersFilter === 'mine') {
    list = (winnersData || []).concat(circuitWinners).filter(function (w) {
      return w.places.some(function (p) { return (p.address || '').toLowerCase() === me; });
    }).sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
  } else {
    list = (winnersData || []).concat(circuitWinners)
      .sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
  }

  renderWinnersStats(list);

  if (!list.length) {
    host.innerHTML = '<div class="wn-empty">' +
      (winnersFilter === 'mine' ? 'No wins for this wallet yet.'
       : winnersFilter === 'circuit'
         ? (circuitWinnersLoaded ? 'No Circuit rounds drawn yet.' : 'Loading Circuit rounds…')
         : 'No draws yet - mint your first Oracle Mask.') + '</div>';
    return;
  }

  host.innerHTML = list.slice(0, 60).map(function (w) {
    var isMine = me && w.places.some(function (p) { return (p.address || '').toLowerCase() === me; });

    var places = w.places.map(function (p) {
      var mine = me && (p.address || '').toLowerCase() === me;
      return '<div class="wn-place">' +
        '<span class="wn-medal p' + p.place + '">' + p.place + '</span>' +
        '<span class="wn-addr" title="' + (p.address || '') + '">' + fmtAddr(p.address) + '</span>' +
        (mine ? '<span class="wn-you">you</span>' : '') +
        '<span class="wn-amt">' + (p.amount ? fmt(p.amount) + ' LUNC' : '-') + '</span>' +
        '</div>';
    }).join('');

    var unit = w.type === 'circuit' ? 'zone' : 'entry';
    var facts = [];
    facts.push('<span class="wn-fact">' + w.tickets + ' ' +
      (w.tickets === 1 ? unit : unit + 's') + '</span>');
    if (w.participants) facts.push('<span class="wn-fact">' + w.participants +
      (w.participants === 1 ? ' participant' : ' participants') + '</span>');
    if (w.type === 'circuit' && typeof w.zone === 'number') {
      facts.push('<span class="wn-fact">zone ' + w.zone + '</span>');
    }
    if (w.blockHeight) {
      facts.push('<span class="wn-fact"><a href="https://finder.terraport.finance/mainnet/blocks/' +
        w.blockHeight + '" target="_blank" rel="noopener">block #' + w.blockHeight + '</a></span>');
    } else {
      facts.push('<span class="wn-fact" title="Draw made before the deadline-block upgrade">legacy</span>');
    }

    var chip = w.type === 'daily' ? 'd' : (w.type === 'weekly' ? 'w' : 'c');
    var label = w.type === 'daily' ? 'Daily' : (w.type === 'weekly' ? 'Weekly' : 'Circuit');

    return '<div class="wn-card is-' + w.type + (isMine ? ' is-mine' : '') + '">' +
      '<div class="wn-round"><b>#' + w.round + '</b>' +
        '<span class="wn-chip ' + chip + '">' + label + '</span></div>' +
      '<div class="wn-places">' + places + '</div>' +
      '<div class="wn-meta">' +
        '<div class="wn-date">' + fmtDate(w.time || 0) + '</div>' +
        '<div class="wn-facts">' + facts.join('') + '</div>' +
        (w.roundId
          ? '<button class="wn-more" onclick="toggleRoundStats(\'' + w.roundId + '\',\'' +
            w.type + '\',this)">stats</button>'
          : '') +
        (w.blockHash
          ? '<button class="wn-verify" onclick="openVerifyForRound(\'' + (w.roundId || '') + '\')">verify</button>'
          : '') +
      '</div>' +
    '</div>';
  }).join('');
};

/* ── Oracle Stats hooks (added automatically) ─────────────────── */
(function () {
  if (typeof setConnectedWallet !== 'function') return;
  var loadedAt = Date.now();
  var orig = setConnectedWallet;
  setConnectedWallet = window.setConnectedWallet = function (addr, provider) {
    var r = orig.apply(this, arguments);
    try {
      if (window.oa && addr) {
        // anything within 4s of load is an automatic restore, not a click
        var auto = (Date.now() - loadedAt) < 4000;
        oa.wallet(addr, auto ? { restored: true } : undefined);
      }
    } catch (e) {}
    return r;
  };
  if (typeof disconnectWallet === 'function') {
    var od = disconnectWallet;
    disconnectWallet = window.disconnectWallet = function () {
      try { window.oa && oa.wallet(null); } catch (e) {}
      return od.apply(this, arguments);
    };
  }
})();
