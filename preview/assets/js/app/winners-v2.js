// ═══ WINNERS v2 ═══════════════════════════════════════════════════════════
// Заменяет mapEntry внутри loadWinners и функцию renderWinners.
//
// Что чинится помимо вида:
//   1. У weekly в «Prize» попадало только ПЕРВОЕ место. У раунда #16 стояло
//      278.0K, хотя выплачено 278.0K + 115.8K = 393.8K. Теперь сумма.
//   2. У weekly терялся winner_index каждого места - из-за этого раздел
//      Verify не с чем было сверять. Теперь переносится.
//   3. Когда у старой записи нет block_height, в «Draw Block» подставлялся
//      кусок хеша - отсюда строки вида i8OQSVnEah8E… Теперь честное «-».
//   4. prize_lunc отсутствует у самых старых раундов → показывалось
//      «0 LUNC», будто никто ничего не выиграл. Теперь «-» и пометка legacy.

// ── маппер записи winners.json → строка списка ────────────────────────────
function mapWinnerEntry(w, type, idx) {
  if (!w || w.skipped) return null;

  var base = {
    type: type,
    round: idx + 1,
    roundId: w.round_id || null,
    tickets: w.entries || 0,
    participants: w.participants || null,
    blockHeight: w.block_height || null,
    blockHash: w.block_hash || null,
    blockTime: w.block_time || null,
    time: w.date ? Math.floor(new Date(w.date + 'T20:00:00Z').getTime() / 1000) : 0,
    legacy: !w.block_height          // до перехода на блок по дедлайну раунда
  };

  // Daily - один победитель
  if (w.winner) {
    base.places = [{
      place: 1,
      address: w.winner,
      amount: w.prize_lunc || w.prize || null,
      index: (w.winner_index !== undefined ? w.winner_index : null),
      tx: w.tx_winner || null
    }];
  }
  // Weekly - сколько мест реально разыграно. Их до трёх: пул делится
  // 48/20/12, но placesCount = min(3, уникальных участников), поэтому
  // при двух участниках мест два. Список строится по факту, без допущений.
  else if (Array.isArray(w.winners) && w.winners.length) {
    base.places = w.winners.map(function (p) {
      return {
        place: p.place,
        address: p.address,
        amount: p.amount_lunc || null,
        index: (p.winner_index !== undefined ? p.winner_index : null),
        tx: p.tx || null
      };
    });
  } else {
    return null;
  }

  // Сумма ВСЕХ выплат раунда, а не первого места
  base.paid = base.places.reduce(function (s, p) { return s + (p.amount || 0); }, 0);

  // ── Совместимость со старой формой записи ────────────────────────────────
  // winnersData читают ещё шесть мест: счётчики розыгрышей (строки 52, 619,
  // 623, 1966), последний победитель daily (811) и раздел Verify (2523, 2554).
  // Все они проверяют `w.winner || w.winners.length` и берут w.tickets,
  // w.drawBlock*, w.winnerIndex. Пока Verify не переписан, старые поля
  // обязаны остаться - иначе разделы молча опустеют.
  base.winner          = base.places[0].address;
  base.prize           = base.places[0].amount || 0;
  base.winnerIndex     = base.places[0].index;
  base.drawBlockHash   = base.blockHash;
  base.drawBlockHeight = base.blockHeight;
  base.drawBlock       = base.blockHeight || '-';
  base.txHashes        = base.places[0].tx ? { winner: base.places[0].tx } : (w.tx_treasury ? { treasury: w.tx_treasury } : null);
  if (type === 'weekly') {
    base.winners      = w.winners;      // ждут именно исходный массив
    base.multiWinners = w.winners;
  }
  return base;
}

// ── сводка над списком ────────────────────────────────────────────────────
function renderWinnersStats(list) {
  var el = document.getElementById('wn-stats');
  if (!el) return;

  var paid = 0, best = 0, wallets = {};
  list.forEach(function (w) {
    paid += w.paid || 0;
    w.places.forEach(function (p) {
      if ((p.amount || 0) > best) best = p.amount || 0;
      if (p.address) wallets[p.address] = 1;
    });
  });

  var cells = [
    [fmt(paid) + ' LUNC', 'total paid out'],
    [String(list.length), 'draws'],
    [fmt(best) + ' LUNC', 'biggest prize'],
    [String(Object.keys(wallets).length), 'winners']
  ];
  el.innerHTML = cells.map(function (c) {
    return '<div class="wn-stat"><b>' + c[0] + '</b><span>' + c[1] + '</span></div>';
  }).join('');
}

// ── список карточек ───────────────────────────────────────────────────────
function renderWinners() {
  var host = document.getElementById('wn-list');
  if (!host) return;

  var list = winnersData || [];
  if (winnersFilter === 'daily')  list = list.filter(function (w) { return w.type === 'daily'; });
  if (winnersFilter === 'weekly') list = list.filter(function (w) { return w.type === 'weekly'; });

  // На этом сайте адрес лежит в connectedWalletAddress, фолбэк - lotteryAddress
  var me = String(
    (typeof connectedWalletAddress !== 'undefined' && connectedWalletAddress) ||
    (typeof lotteryAddress !== 'undefined' && lotteryAddress) || ''
  ).toLowerCase();
  if (winnersFilter === 'mine') {
    list = (winnersData || []).filter(function (w) {
      return w.places.some(function (p) { return (p.address || '').toLowerCase() === me; });
    });
  }

  renderWinnersStats(winnersFilter === 'mine' ? list : (winnersData || []));

  if (!list.length) {
    host.innerHTML = '<div class="wn-empty">' +
      (winnersFilter === 'mine'
        ? 'No wins for this wallet yet.'
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

    var facts = [];
    facts.push('<span class="wn-fact">' + w.tickets + (w.tickets === 1 ? ' entry' : ' entries') + '</span>');
    if (w.participants) facts.push('<span class="wn-fact">' + w.participants +
      (w.participants === 1 ? ' participant' : ' participants') + '</span>');
    if (w.blockHeight) {
      facts.push('<span class="wn-fact"><a href="https://finder.terraport.finance/mainnet/blocks/' +
        w.blockHeight + '" target="_blank" rel="noopener">block #' + w.blockHeight + '</a></span>');
    } else {
      facts.push('<span class="wn-fact" title="Draw made before the deadline-block upgrade">legacy</span>');
    }

    return '<div class="wn-card is-' + w.type + (isMine ? ' is-mine' : '') + '">' +
      '<div class="wn-round"><b>#' + w.round + '</b>' +
        '<span class="wn-chip ' + (w.type === 'daily' ? 'd' : 'w') + '">' +
        (w.type === 'daily' ? 'Daily' : 'Weekly') + '</span></div>' +
      '<div class="wn-places">' + places + '</div>' +
      '<div class="wn-meta">' +
        '<div class="wn-date">' + fmtDate(w.time || 0) + '</div>' +
        '<div class="wn-facts">' + facts.join('') + '</div>' +
        (w.blockHash
          ? '<button class="wn-verify" onclick="openVerifyForRound(\'' + (w.roundId || '') + '\')">verify</button>'
          : '') +
      '</div>' +
    '</div>';
  }).join('');
}

// Переход в раздел проверки с уже выбранным раундом.
// Ищем по roundId в самих данных, а не по option'ам: список строит
// populateDrawVerifySelect, и порядок в нём совпадает с completed-выборкой.
function openVerifyForRound(roundId) {
  showTab('verify');
  setTimeout(function () {
    var completed = vfRounds();
    var idx = completed.findIndex(function (w) { return w.roundId === roundId; });
    if (idx < 0) return;
    var sel = document.getElementById('vf-select');
    if (sel) sel.value = String(idx);
    renderDrawVerify(idx);
  }, 60);
}

window.openVerifyForRound = openVerifyForRound;
