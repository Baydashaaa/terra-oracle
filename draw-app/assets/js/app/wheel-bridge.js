// ─── МОСТ К КОЛЕСУ V2 ─────────────────────────────────────────────────────────
// Файл назывался FORTUNE WHEEL и когда-то сам рисовал колесо. Рисование ушло
// в assets/js/wheel/, а здесь остались данные раунда, сообщения под колесом,
// карточка победителя и экспорт window.OracleDrawUI - единственная точка,
// через которую ядро V2 трогает страницу.
//
// 28 авг 2026 вычищено мёртвое наследие старого колеса: MAX_SECTORS (сектора
// теперь взвешенные, ограничения нет), ticksCanvas/ticksCtx/wheelDrawnOnce
// (свой канвас), TIER_ICONS, ENTRY_DEADLINE_MS и весь блок цветов участников
// (getParticipantColor, getNeonColors, две палитры) - цвета секторов живут
// в WheelTheme.js. Ни на одно из этих имён не ссылался ни один файл репо.
const ADMIN_WALLET = 'terra15jt5a9ycsey4hd6nlqgqxccl9aprkmg2mxmfc6';

let adminUnlocked = false;

// ── ДАННЫЕ РАУНДА ДЛЯ КОЛЕСА ────────────────────────────────────────────────
// Раньше эта функция строила wheelTickets и рисовала канвас вручную.
// Рисование целиком уехало в assets/js/wheel/. Здесь остались только
// данные и бейджи - колесо V2 забирает их через OracleDrawUI.participants().
let roundParticipants = [];   // [[адрес, билетов, tokenId|null, тир], ...]

function buildRoundParticipants() {
  const tickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const isDaily = currentLottery === 'daily';
  const pairs = [];

  // txhash имеет вид mint:<tokenId>:<i> - по нему группируем билеты
  // одного NFT и достаём его номер.
  //
  // Тир берём из самого билета (t.tier), а НЕ из размера группы:
  // если человек сминтил пять common одной транзакцией, группа из пяти
  // билетов выглядела бы как rare, хотя это пять обычных масок.
  let lastKey = null;
  for (const t of tickets) {
    const m       = /^mint:([^:]+):/.exec(t.txhash || '');
    const key     = m ? 'mint:' + m[1] : (t.txhash || '');
    const tokenId = m ? m[1] : null;
    const last    = pairs[pairs.length - 1];

    if (last && key && key === lastKey && last[0] === t.address) {
      last[1]++;
    } else {
      pairs.push([t.address, 1, tokenId, (t.tier || 'common').toLowerCase()]);
      lastKey = key;
    }
  }

  // Free entries (только weekly и только при наличии платных участников) -
  // так же, как их добавляет addFreeEntries в lottery-draw.js
  if (!isDaily && pairs.length) {
    for (const [addr, e] of Object.entries(freeEntriesData)) {
      const n = (e && e.total) || 0;
      if (n > 0) pairs.push([addr, n, null, 'common']);
    }
  }
  return pairs;
}

/**
 * NFT конкретного кошелька в текущем раунде.
 * Билеты развёрнуты по одному на entry, поэтому группируем по tokenId
 * из txhash вида mint:<tokenId>:<i> и считаем, сколько entries дал каждый.
 */
function roundNftsFor(address) {
  const tickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const byToken = new Map();

  for (const t of tickets) {
    if (t.address !== address) continue;
    const m  = /^mint:([^:]+):/.exec(t.txhash || '');
    const id = m ? m[1] : (t.txhash || 'unknown');
    if (!byToken.has(id)) {
      byToken.set(id, {
        tokenId: m ? m[1] : null,
        tier:    (t.tier || 'common').toLowerCase(),
        entries: 0,
        time:    t.time || 0
      });
    }
    byToken.get(id).entries++;
  }

  return Array.from(byToken.values())
    .sort((a, b) => b.entries - a.entries || (a.time - b.time));
}

function updateWheelTickets() {
  const tickets  = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const isDaily  = currentLottery === 'daily';
  const currency = 'LUNC';

  roundParticipants = buildRoundParticipants();

  // Бейджи под колесом
  const partEl = document.getElementById('wheel-participant-count');
  const tickEl = document.getElementById('wheel-ticket-count');
  const poolEl = document.getElementById('wheel-pool-display');

  const tiersRef = window.NFT_TIERS || (typeof NFT_TIERS !== 'undefined' ? NFT_TIERS : null);
  let realPool = 0;
  const seenTx = new Set();
  for (const t of tickets) {
    if (seenTx.has(t.txhash)) continue;
    seenTx.add(t.txhash);
    if (tiersRef && t.entries) {
      if (t.entries === tiersRef.legendary.entries) realPool += tiersRef.legendary.lunc;
      else if (t.entries === tiersRef.rare.entries) realPool += tiersRef.rare.lunc;
      else realPool += tiersRef.common.lunc;
    } else realPool += LUNC_PER_TICKET;
  }

  const paidAddrs = new Set(tickets.map(t => t.address));
  const hasPaid   = paidAddrs.size > 0;
  const totalFree = (!isDaily && hasPaid)
    ? Object.values(freeEntriesData).reduce((s, e) => s + (e.total || 0), 0) : 0;
  const freeOnly  = (!isDaily && hasPaid)
    ? Object.keys(freeEntriesData).filter(w => !paidAddrs.has(w)).length : 0;

  if (partEl) partEl.textContent = (paidAddrs.size + freeOnly) || 0;
  if (tickEl) tickEl.textContent = (tickets.length + totalFree) || 0;
  if (poolEl) poolEl.textContent = fmt(realPool * PRIZE_SHARE) + ' ' + currency;

  const badgeColor = isDaily ? '#f4d03f' : '#7eb8ff';
  if (partEl) { partEl.style.color = badgeColor; }
  if (tickEl) { tickEl.style.color = isDaily ? '#a060ff' : '#cc66ff'; }
  if (poolEl) { poolEl.style.color = '#66ffaa'; }

  // Колесо перестраивает сектора по живым участникам раунда
  if (window.oracleDrawV2 && window.oracleDrawV2.refreshLive) {
    window.oracleDrawV2.refreshLive();
  }
}

// ── Trigger spin (called at draw time OR by admin) ────────────────────────────
// ── ADMIN DEMO SPIN ONLY ─────────────────────────────────────────────────────
// Настоящий розыгрыш ведёт Draw V2 (DrawBridge): сектор ищется по адресу
// победителя из winners.json. Здесь остался только демо-прогон для админа,
// и он честно помечен как демо.

// ── Winner card - единственный писатель карточки результата ──────────────────
// Человекочитаемая дата раунда: '2026-07-27' → '27 Jul 2026'
function drawDateLabel(iso) {
  if (!iso) return null;
  const ts = Date.parse(iso + 'T20:00:00Z');
  if (Number.isNaN(ts)) return iso;
  const d = new Date(ts);
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

// Показанный результат - от последнего ожидавшегося розыгрыша, или он старше?
// Если старше, значит свежий розыгрыш ещё не записан в winners.json (упал,
// не отработал крон, не доехал коммит). Именно так 3 августа победитель
// недельной давности читался как свежий.
function isStaleRound(iso, pool) {
  if (!iso || !window.DRAW_SCHEDULE) return false;
  const prev = window.DRAW_SCHEDULE.prev(pool === 'weekly' ? 'weekly' : 'daily');
  if (!prev) return false;
  const ts = Date.parse(iso + 'T20:00:00Z');
  if (Number.isNaN(ts)) return false;
  return ts < prev.getTime() - 60000;   // минута допуска
}

function showWinnerCard(data) {
  const card = document.getElementById('wheel-winner-card');
  if (!card) return;
  const a = document.getElementById('ww-address');
  const p = document.getElementById('ww-prize');
  const t = document.getElementById('ww-tx');

  // ── Строка раунда ────────────────────────────────────────────────────────
  // Создаётся здесь, а не в index.html: карточка уже выложена, и лишняя
  // правка разметки означала бы ещё один деплой фронта.
  let r = document.getElementById('ww-round');
  if (!r) {
    r = document.createElement('div');
    r.id = 'ww-round';
    r.style.cssText = 'font-size:11px;letter-spacing:0.08em;margin-bottom:14px;';
    // сразу под шапкой «✦ Winner Selected ✦»
    const head = card.firstElementChild;
    if (head && head.nextSibling) card.insertBefore(r, head.nextSibling);
    else card.appendChild(r);
  }
  // Пул подписывается ВСЕГДА. 3 августа на вкладке Weekly висела карточка
  // daily-раунда, и понять это можно было только разбором winners.json.
  // С подписью подмена видна сразу.
  const pool = (data.pool === 'weekly' || data.pool === 'daily')
    ? data.pool
    : (window.currentLottery === 'weekly' ? 'weekly' : 'daily');
  const poolName  = pool === 'weekly' ? 'Weekly Draw' : 'Daily Draw';
  const poolColor = pool === 'weekly' ? 'rgba(167,139,250,0.95)' : 'rgba(212,160,23,0.95)';

  const label = drawDateLabel(data.date);
  const stale = isStaleRound(data.date, pool);

  const sep  = '<span style="color:var(--muted);opacity:0.45;"> · </span>';
  let html = '<span style="color:' + poolColor + ';font-weight:600;">' + poolName + '</span>';
  if (label) html += sep + '<span style="color:var(--muted);">Round of ' + label + '</span>';
  if (stale) html += '<div style="margin-top:4px;color:rgba(255,180,80,0.95);">' +
                     'Latest draw not recorded yet</div>';
  r.innerHTML = html;
  r.style.display = 'block';

  if (a) a.textContent = data.address || '-';
  if (p) p.textContent = (data.prize ? fmt(data.prize) + ' LUNC' : '-') +
                         (data.label ? ' · ' + data.label : '');
  if (t) {
    t.innerHTML = data.tx
      ? '<a href="https://finder.terraport.finance/mainnet/tx/' + data.tx +
        '" target="_blank" rel="noopener" style="font-size:11px;color:rgba(0,200,255,0.8);">View transaction</a>'
      : (data.label ? '<span style="font-size:11px;color:rgba(167,139,250,0.6);">' + data.label + '</span>' : '');
  }

  card.style.display = 'block';
  card.classList.remove('show');
  void card.offsetWidth;
  card.classList.add('show');
}

function setWheelMsg(msg, sub, color) {
  const m = document.getElementById('wheel-msg');
  const s = document.getElementById('wheel-submsg');
  if (m) { m.innerHTML = msg; m.style.color = color || '#00c8ff'; m.style.textShadow = '0 0 20px '+color+'88'; }
  if (s)   s.innerHTML = sub || '';
}


function updateBurnButtonState(open) {
  // Update burn buttons in My Bag
  document.querySelectorAll('.burn-btn').forEach(btn => {
    btn.disabled = !open;
    btn.style.opacity = open ? '1' : '0.4';
    btn.style.cursor  = open ? 'pointer' : 'not-allowed';
    btn.title = open ? '' : 'Entries closed - draw starting soon';
  });
  // Update buy button state
  const buyBtn = document.getElementById('btn-buy');
  if (buyBtn && !open) {
    buyBtn.style.opacity = '0.5';
    buyBtn.title = 'Round closing - wait for next draw';
  } else if (buyBtn) {
    buyBtn.style.opacity = '1';
    buyBtn.title = '';
  }
}

// Подпись под колесом («Next draw in {t}»). Раньше здесь был свой формат
// «26h 56m», из-за чего одно и то же время выглядело в Treasury как «1d 02:57»,
// а под колесом как «26h 56m» - читалось как расхождение. Теперь общий формат.
function formatDiffShort(ms) {
  return window.DRAW_SCHEDULE.format(ms);
}


// ── BRIDGE FOR DRAW V2 ───────────────────────────────────────────────────────
// Единственная точка, через которую новое ядро трогает старый UI.
window.OracleDrawUI = {
  // Сообщения и карточка - единственное, что колесо просит у страницы
  msg:            function(m, sub, c) { return setWheelMsg(m, sub, c); },
  card:           function(d) { return showWinnerCard(d); },
  entriesOpen:    function(open) { return updateBurnButtonState(open); },
  fmt:            function(v) { return fmt(v); },
  fmtShort:       function(ms) { return formatDiffShort(ms); },

  // Живые участники текущего раунда: [[адрес, билетов, tokenId, тир], ...]
  // Колесо строит из них сектора ДО розыгрыша. После розыгрыша модель
  // берётся из снимка rounds/<round_id>.json - он авторитетен для
  // winner_index, а этот список только предварительный показ.
  participants:   function() { return roundParticipants; },
  walletNfts:     function(addr) { return roundNftsFor(addr); },
  pool:           function() { return currentLottery; },

  wakeOracleEye:  function(on) {
    document.body.classList.toggle('oracle-predraw', !!on);
    if (window.oracleEye && typeof window.oracleEye.wake === 'function') {
      window.oracleEye.wake(!!on);
    }
  }
};
window.loadWinners = loadWinners;

// ── Admin panel wheel demo ────────────────────────────────────────────────────
