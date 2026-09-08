/* ═══════════════════════════════════════════════════════════════════════════
   CIRCUIT - чьи зоны на доске
   ---------------------------------------------------------------------------
   Каждому кошельку раунда свой цвет; твои зоны - золотые с ярким контуром.
   Под доской легенда: кто сколько держит и сколько осталось до розыгрыша.

   ПОДКЛЮЧЕНИЕ: обычный <script>, ПОСЛЕ app.js (нужен адрес кошелька).

   Почему цвет по ПОРЯДКУ ПОЯВЛЕНИЯ, а не по хешу адреса: порядок blocks
   одинаков у всех зрителей и не меняется в течение раунда, а хеш даёт
   случайные оттенки, которые сливаются друг с другом. Различимых на глаз
   цветов около десяти, поэтому одиннадцатый кошелёк и дальше - серые;
   в легенде они сворачиваются в «ещё N».

   Почему отдельный файл, а не правка circuit-buy.js: тот красит ПРЕДПРОСМОТР
   выбора - клетки [sold, sold+count-1], за границей проданных. Владение
   всегда внутри [0, sold-1]. Диапазоны не пересекаются.

   Красим инлайновым стилем: refreshCircuit() в index.html каждые 20 секунд
   переписывает className у всех клеток и стёр бы подсветку по классу.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const GOLD = '#f4d03f';

  // Десять различимых оттенков. Золотой не входит - он зарезервирован за
  // «твоими», иначе чужая зона иногда выглядела бы своей.
  const PALETTE = [
    '#38d9d0', '#7ec8ff', '#a78bfa', '#ff8fa3', '#7ee787',
    '#ffb86b', '#5eead4', '#c4b5fd', '#fca5a5', '#86efac',
  ];
  const GREY = '#5b6b78';

  const $ = (id) => document.getElementById(id);

  const ADDR_RE = /^terra1[0-9a-z]{38}$/i;
  const pickAddr = (v) => (typeof v === 'string' && ADDR_RE.test(v)) ? v : null;
  function myWallet() {
    let a = null;
    try { a = pickAddr(connectedWalletAddress); } catch (e) {}
    if (!a) { try { a = pickAddr(lotteryAddress); } catch (e) {} }
    if (!a && typeof window._getConnectedAddress === 'function') {
      try { a = pickAddr(window._getConnectedAddress()); } catch (e) {}
    }
    return a;
  }

  const base = () => (typeof DRAW_WORKER !== 'undefined' ? DRAW_WORKER : '');
  const short = (a) => String(a).slice(0, 9) + '…' + String(a).slice(-4);

  let painted = [];
  // Сколько раз уже ждали появления доски. Ограничение на случай, если
  // воркер недоступен и доска не построится вовсе - иначе таймеры плодятся.
  let waitingForBoard = 0;

  function clearPaint() {
    painted.forEach((c) => {
      c.style.background = '';
      c.style.boxShadow = '';
      c.style.outline = '';
    });
    painted = [];
  }

  function paintCell(c, color, mine) {
    c.style.background = mine ? 'rgba(244,208,63,.62)' : hexA(color, .48);
    c.style.boxShadow = mine ? '0 0 7px rgba(244,208,63,.6)' : 'none';
    c.style.outline = '1px solid ' + (mine ? GOLD : hexA(color, .85));
    painted.push(c);
  }

  // #rrggbb + альфа → rgba(...)
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ── раскладка раунда ──────────────────────────────────────────────────── */

  // Возвращает список держателей в порядке появления, с цветом и числом зон.
  function holdersOf(state, wallet) {
    const order = [];
    const map = {};
    const me = wallet ? wallet.toLowerCase() : null;

    for (const b of state.blocks || []) {
      const key = String(b.wallet).toLowerCase();
      if (!map[key]) {
        map[key] = { wallet: b.wallet, zones: 0, ranges: [], mine: key === me, idx: order.length };
        order.push(map[key]);
      }
      map[key].zones += b.to - b.from + 1;
      map[key].ranges.push([b.from, b.to]);
    }
    for (const h of order) h.color = h.idx < PALETTE.length ? PALETTE[h.idx] : GREY;
    return order;
  }

  function paintBoard(holders) {
    clearPaint();
    const bd = $('cir-board');
    if (!bd || !bd.children.length) return;
    for (const h of holders) {
      for (const [from, to] of h.ranges) {
        for (let k = from; k <= to && k < bd.children.length; k++) {
          const c = bd.children[k];
          if (c) paintCell(c, h.color, h.mine);
        }
      }
    }
  }

  /* ── легенда ───────────────────────────────────────────────────────────── */

  function ensureLegend() {
    if ($('cb-legend')) return $('cb-legend');
    const board = $('cir-board');
    if (!board) return null;
    const el = document.createElement('div');
    el.id = 'cb-legend';
    el.style.cssText = 'margin-top:10px;font-size:12px;color:#7fa8a5;display:flex;' +
                       'gap:14px;flex-wrap:wrap;align-items:center;line-height:1.7;';
    board.insertAdjacentElement('afterend', el);
    return el;
  }

  const swatch = (color, mine) =>
    '<i style="display:inline-block;width:11px;height:11px;border-radius:3px;' +
    'background:' + hexA(color, mine ? .62 : .48) + ';border:1px solid ' +
    (mine ? GOLD : hexA(color, .85)) + ';vertical-align:-1px;margin-right:6px;"></i>';

  const MAX_ROWS = 12;

  function renderLegend(state, holders) {
    const el = ensureLegend();
    if (!el) return;

    if (!state.sold) {
      el.innerHTML = '<span>The board is empty - the first zone claimed starts the row.</span>';
      return;
    }

    const parts = [];
    // Свои всегда первыми, иначе их приходится искать глазами
    const sorted = holders.slice().sort((a, b) => (b.mine - a.mine) || (b.zones - a.zones));

    sorted.slice(0, MAX_ROWS).forEach((h) => {
      const label = h.mine ? 'you' : short(h.wallet);
      const color = h.mine ? GOLD : h.color;
      parts.push('<span>' + swatch(color, h.mine) +
                 '<span style="color:' + (h.mine ? '#e9dca6' : '#cfe9e7') + '">' + label +
                 '</span> <b style="color:#cfe9e7">' + h.zones + '</b></span>');
    });
    if (sorted.length > MAX_ROWS) {
      const rest = sorted.slice(MAX_ROWS).reduce((s, h) => s + h.zones, 0);
      parts.push('<span>+' + (sorted.length - MAX_ROWS) + ' more · ' + rest + ' zones</span>');
    }

    parts.push('<span style="color:#5b7a86">' + holders.length +
               (holders.length === 1 ? ' holder' : ' holders') + '</span>');

    // Порог розыгрыша - самое непонятное место в правилах, поэтому прямым текстом
    if (state.sold < state.minZones) {
      parts.push('<span style="color:#f0dda0">' + (state.minZones - state.sold) +
                 ' more zones needed for this round to draw</span>');
    }

    el.innerHTML = parts.join('');
  }

  /* ── опрос ─────────────────────────────────────────────────────────────── */

  function refresh(state) {
    // Пока circuit-reveal.js показывает розыгрыш, доска принадлежит ему:
    // закрытый раунд держится на экране, и перекрашивать его под новый
    // (пустой) нельзя - пробег бегунка оборвётся на полуслове.
    if (window.__circuitRevealBusy) return;
    // Состояние приходит аргументом от circuit-state.js. Своего fetch тут
    // больше нет - три опросчика на одной странице выбирали дневной лимит
    // воркера с двух-трёх открытых вкладок.
    if (!state) state = window.CircuitState && window.CircuitState.get();
    if (!state) return;

    const holders = holdersOf(state, myWallet());

    // Доску строит refreshCircuit() из index.html при своём первом успешном
    // ответе. Мы можем оказаться раньше - тогда ждём её появления, а не
    // следующего двадцатисекундного круга: иначе после перезагрузки цвета
    // «слетают» и возвращаются только через полминуты.
    const bd = $('cir-board');
    if (bd && bd.children.length) {
      paintBoard(holders);
    } else if (waitingForBoard < 40) {          // доска ещё не построена
      waitingForBoard++;
      setTimeout(() => { paintBoard(holders); }, 400);
      setTimeout(() => refresh(state), 400);   // тем же состоянием, без запроса
    }
    renderLegend(state, holders);
  }

  function boot() {
    if (!$('stage-circuit')) return;
    if (window.CircuitState) window.CircuitState.subscribe(refresh);
    else console.warn('[circuit-board] circuit-state.js не подключён');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
