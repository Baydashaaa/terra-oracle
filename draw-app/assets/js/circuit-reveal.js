/* ═══════════════════════════════════════════════════════════════════════════
   CIRCUIT - показ розыгрыша
   ---------------------------------------------------------------------------
   На странице написано «A marker runs across it and stops on one», но самого
   бегунка в коде не было: раунд закрывался, доска молча обнулялась, и человек
   видел только пустое поле. Этот файл закрывает разрыв между обещанием и тем,
   что происходит на экране.

   ПОДКЛЮЧЕНИЕ: обычный <script>, ПОСЛЕ circuit-board.js (нужна та же палитра
   и та же доска).

   Откуда данные: /circuit/history отдаёт закрытый раунд целиком - winnerZone,
   winner, sold, blocks, split.prize, txWinner. Ничего считать заново не надо,
   воркер и скрипт выплат тут не участвуют. Показ - чистая косметика поверх уже
   состоявшегося результата, повлиять на деньги он не может по построению.

   Как ловим момент: сравниваем roundId из /circuit/state с прошлым. Сменился -
   значит предыдущий только что разыгран, и его надо показать. Состояние даёт
   circuit-state.js - он же сам учащает такт до 5 секунд, когда дедлайн прошёл,
   так что показ не опаздывает и без собственного опроса.

   Пока идёт показ, поднят флаг window.__circuitRevealBusy: circuit-board.js и
   refreshCircuit() в index.html на нём выходят сразу, иначе они затёрли бы
   старую доску новым пустым раундом прямо посреди пробега.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const SPIN_MS = 9000;    // сам пробег
  const HOLD_MS = 9000;    // сколько держим итог перед возвратом к доске
  const MAX_AGE_MS = 5 * 60 * 1000;  // раунд старше пяти минут не показываем
  const LS_KEY = 'circuitRevealShown';

  // Палитра и золотой - те же, что в circuit-board.js. Дублируются намеренно:
  // связывать два файла ради десяти строк дороже, чем разойтись в оттенках.
  const GOLD = '#f4d03f';
  const PALETTE = [
    '#38d9d0', '#7ec8ff', '#a78bfa', '#ff8fa3', '#7ee787',
    '#ffb86b', '#5eead4', '#c4b5fd', '#fca5a5', '#86efac',
  ];
  const GREY = '#5b6b78';

  const $ = (id) => document.getElementById(id);

  // Показ срабатывает раз в три часа и только у того, кто в этот момент на
  // странице - воспроизвести сбой по просьбе невозможно. Поэтому решения
  // пишутся в консоль всегда: следующий отчёт «у меня ничего не было» можно
  // будет разобрать по логу, а не по догадкам.
  const log = (m) => { try { console.log('[reveal] ' + m); } catch (e) {} };
  const base = () => (typeof DRAW_WORKER !== 'undefined' ? DRAW_WORKER : '');
  const short = (a) => String(a).slice(0, 9) + '…' + String(a).slice(-4);
  const lunc = (u) => Math.round(u / 1e6).toLocaleString('en-US');

  const ADDR_RE = /^terra1[0-9a-z]{38}$/i;
  function myWallet() {
    const ok = (v) => (typeof v === 'string' && ADDR_RE.test(v)) ? v : null;
    let a = null;
    try { a = ok(connectedWalletAddress); } catch (e) {}
    if (!a) { try { a = ok(lotteryAddress); } catch (e) {} }
    if (!a && typeof window._getConnectedAddress === 'function') {
      try { a = ok(window._getConnectedAddress()); } catch (e) {}
    }
    return a;
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  const REDUCED = typeof matchMedia === 'function' &&
                  matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── что уже показывали ────────────────────────────────────────────────── */
  // Без этого перезагрузка страницы крутила бы один и тот же раунд заново.
  function alreadyShown(id) {
    try { return localStorage.getItem(LS_KEY) === id; } catch (e) { return false; }
  }
  function markShown(id) {
    try { localStorage.setItem(LS_KEY, id); } catch (e) {}
  }

  /* ── стили ─────────────────────────────────────────────────────────────── */

  function ensureStyle() {
    if ($('cr-style')) return;
    const s = document.createElement('style');
    s.id = 'cr-style';
    s.textContent = `
      @keyframes cr-win-pulse {
        0%, 100% { box-shadow: 0 0 10px rgba(244,208,63,.75); }
        50%      { box-shadow: 0 0 22px rgba(244,208,63,1); }
      }
      #cr-caption { margin-top: 12px; font-size: 13px; line-height: 1.6; color: #cfe9e7;
        background: rgba(244,208,63,.07); border: 1px solid rgba(244,208,63,.32);
        border-radius: 9px; padding: 10px 14px; }
      #cr-caption b { color: ${GOLD}; }
      #cr-caption a { color: #a8ece8; }
      #cr-caption .cr-sub { display: block; color: #7fa8a5; font-size: 12px; margin-top: 3px; }
    `;
    document.head.appendChild(s);
  }

  function caption(html) {
    ensureStyle();
    let el = $('cr-caption');
    if (!el) {
      const board = $('cir-board');
      if (!board) return;
      el = document.createElement('div');
      el.id = 'cr-caption';
      board.insertAdjacentElement('afterend', el);
    }
    el.innerHTML = html;
  }
  function dropCaption() {
    const el = $('cr-caption');
    if (el) el.remove();
  }

  /* ── раскладка закрытого раунда ────────────────────────────────────────── */

  function holdersOf(round, me) {
    const order = [], map = {};
    const mine = me ? me.toLowerCase() : null;
    for (const b of round.blocks || []) {
      const key = String(b.wallet).toLowerCase();
      if (!map[key]) {
        map[key] = { wallet: b.wallet, ranges: [], mine: key === mine, idx: order.length };
        order.push(map[key]);
      }
      map[key].ranges.push([b.from, b.to]);
    }
    for (const h of order) h.color = h.idx < PALETTE.length ? PALETTE[h.idx] : GREY;
    return order;
  }

  // Красим доску под закрытый раунд и запоминаем стиль каждой клетки: бегунок
  // будет их временно подменять и обязан вернуть как было.
  function paintClosed(round, me) {
    const bd = $('cir-board');
    if (!bd || !bd.children.length) return null;
    const styles = new Array(bd.children.length).fill('');

    for (let k = 0; k < bd.children.length; k++) {
      const c = bd.children[k];
      // Непроданное поле гасим, чтобы взгляд держался на живой части доски
      c.style.cssText = k < round.sold ? 'opacity:.55' : 'opacity:.25';
    }
    for (const h of holdersOf(round, me)) {
      for (const [from, to] of h.ranges) {
        for (let k = from; k <= to && k < bd.children.length; k++) {
          const c = bd.children[k];
          if (!c) continue;
          c.style.background = h.mine ? 'rgba(244,208,63,.62)' : hexA(h.color, .48);
          c.style.outline = '1px solid ' + (h.mine ? GOLD : hexA(h.color, .85));
          c.style.opacity = '.55';
        }
      }
    }
    for (let k = 0; k < bd.children.length; k++) styles[k] = bd.children[k].style.cssText;
    return styles;
  }

  function clearBoard() {
    const bd = $('cir-board');
    if (!bd) return;
    Array.prototype.forEach.call(bd.children, (c) => { c.style.cssText = ''; });
  }

  /* ── пробег ────────────────────────────────────────────────────────────── */

  // Квадратичный ease-in-out: трогается мягко, разгоняется к середине и так
  // же мягко замирает. Кривая считает ПУТЬ, а не скорость, поэтому остановка
  // приходится ровно на выигрышную зону - без доводки рывком в конце.
  //
  // Кубическая версия смотрелась хуже: первую секунду бегунок стоял на месте
  // (ноль шагов), и это читалось как зависший интерфейс, а не как разгон.
  const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  function markCell(c) {
    c.style.background = 'rgba(255,255,255,.92)';
    c.style.outline = '1px solid #ffffff';
    c.style.boxShadow = '0 0 14px rgba(255,255,255,.85)';
    c.style.opacity = '1';
  }

  function spin(round, styles) {
    return new Promise((done) => {
      const bd = $('cir-board');
      const sold = round.sold;
      const win = round.winnerZone;
      if (!bd || !sold || typeof win !== 'number') return done();

      // Кругов тем меньше, чем длиннее ряд: на короткой доске два круга дают
      // разгон до одиннадцати зон в секунду в пике, на длинной хватает одного.
      const laps = sold >= 120 ? 1 : 2;
      const total = laps * sold + win;      // финиш ровно на победителе
      const t0 = performance.now();
      let prev = -1;

      function frame(now) {
        const t = Math.min(1, (now - t0) / SPIN_MS);
        const idx = Math.floor(ease(t) * total) % sold;
        if (idx !== prev) {
          if (prev >= 0 && bd.children[prev]) bd.children[prev].style.cssText = styles[prev];
          if (bd.children[idx]) markCell(bd.children[idx]);
          prev = idx;
        }
        if (t < 1) requestAnimationFrame(frame);
        else done();
      }
      requestAnimationFrame(frame);
    });
  }

  function landOn(round) {
    const bd = $('cir-board');
    const c = bd && bd.children[round.winnerZone];
    if (!c) return;
    c.style.background = 'rgba(244,208,63,.85)';
    c.style.outline = '2px solid ' + GOLD;
    c.style.opacity = '1';
    c.style.animation = 'cr-win-pulse 1.2s ease-in-out infinite';
  }

  /* ── показ целиком ─────────────────────────────────────────────────────── */

  async function play(round) {
    if (!round || round.status !== 'closed') return;
    if (typeof round.winnerZone !== 'number') return;
    const bd = $('cir-board');
    if (!bd || !bd.children.length) return;

    window.__circuitRevealBusy = true;
    markShown(round.roundId);
    log('показываем ' + round.roundId + ': зона ' + round.winnerZone + ' из ' + round.sold);

    const me = myWallet();
    const won = me && String(round.winner).toLowerCase() === me.toLowerCase();
    const prize = (round.split && round.split.prize) ? lunc(round.split.prize) : null;

    try {
      const styles = paintClosed(round, me);
      caption('<b>Drawing…</b><span class="cr-sub">the marker is running across ' +
              round.sold + ' claimed zones</span>');

      if (!REDUCED && styles) await spin(round, styles);
      landOn(round);

      const link = round.txWinner
        ? ' · <a href="https://finder.terraport.finance/mainnet/tx/' + round.txWinner +
          '" target="_blank" rel="noopener">transaction</a>'
        : '';
      caption(
        '<b>' + (won ? 'You won ' + (prize ? prize + ' LUNC' : 'this round') + '!'
                     : 'Zone ' + round.winnerZone + ' takes the round') + '</b>' +
        '<span class="cr-sub">' +
          (won ? 'Zone ' + round.winnerZone : short(round.winner)) +
          (prize && !won ? ' · ' + prize + ' LUNC' : '') +
          ' · ' + round.sold + ' zones claimed' + link +
        '</span>'
      );

      await new Promise((r) => setTimeout(r, HOLD_MS));
    } finally {
      clearBoard();
      dropCaption();
      window.__circuitRevealBusy = false;
    }
  }

  /* ── ловля момента ─────────────────────────────────────────────────────── */

  async function history(limit) {
    try {
      const r = await fetch(base() + '/circuit/history?limit=' + limit,
                            { signal: AbortSignal.timeout(8000) });
      if (!r.ok) { log('history: HTTP ' + r.status); return []; }
      const d = await r.json();
      return (d && Array.isArray(d.rounds)) ? d.rounds : [];
    } catch (e) { log('history: ' + (e && e.message ? e.message : e)); return []; }
  }

  let lastRoundId = null;

  async function tick(st) {
    if (window.__circuitRevealBusy) return;
    if (!$('cir-board')) return;
    if (!st) st = window.CircuitState && window.CircuitState.get();
    if (!st || !st.roundId) return;

    // Результат приезжает тем же тиком, что и смена раунда: воркер кладёт
    // сводку закрытого раунда в circuit_round одной записью со сменой
    // roundId. Раньше ходили в /circuit/history и не находили там ничего:
    // KV кэширует чтения на 60 секунд, а ретраи ждали пятнадцать.
    const lc = st.lastClosed;
    const fresh = lc && lc.closedAt && (Date.now() - lc.closedAt) < MAX_AGE_MS;

    if (lastRoundId === null) {
      lastRoundId = st.roundId;
      if (fresh && !alreadyShown(lc.roundId)) await show(lc);
      return;
    }

    if (st.roundId === lastRoundId) return;

    const closed = lastRoundId;
    lastRoundId = st.roundId;
    log('раунд сменился: ' + closed + ' -> ' + st.roundId);

    if (!lc || lc.roundId !== closed) {
      log('раунд ' + closed + ' слит по недобору - розыгрыша не было');
      return;
    }
    // Сверка идёт ДО alreadyShown: если локальный показ уже прошёл, расхождение
    // всё равно надо заметить. Разойтись эти два пути могут только при разном
    // правиле на сторонах - самая дорогая поломка здесь, и молчаливая.
    const loc = window.__circuitLocal;
    if (loc && loc.roundId === closed) {
      if (loc.winnerZone !== lc.winnerZone) {
        console.error('[reveal] РАСХОЖДЕНИЕ ' + closed + ': локально зона ' +
                      loc.winnerZone + ', воркер ' + lc.winnerZone);
      } else {
        log('локальный расчёт совпал с объявлением: зона ' + lc.winnerZone);
      }
    }

    if (alreadyShown(closed)) { log('этот раунд уже показывали, пропускаем'); return; }
    await show(lc);
  }

  // Локальный результат приходит раньше выплаты: браузер сам считает
  // победителя по блоку дедлайна. Показываем его сразу, не дожидаясь,
  // пока closer расплатится и объявит раунд.
  window.addEventListener('circuit-local-result', (ev) => {
    const r = ev && ev.detail;
    if (!r || window.__circuitRevealBusy) return;
    if (alreadyShown(r.roundId)) return;
    log('показываем локальный результат ' + r.roundId);
    show(r);
  });

  async function show(round) {
    window.__circuitRevealBusy = true;
    try { await play(round); }
    finally { window.__circuitRevealBusy = false; }
  }

  /* ── проверка без ожидания раунда ──────────────────────────────────────── */
  // Раунд закрывается раз в три часа, и ловить показ вживую - это караулить
  // экран полдня. С ?revealtest=1 в адресе последний закрытый раунд
  // проигрывается сразу и столько раз, сколько перезагрузишь страницу:
  // отметка «уже показывали» в тестовом режиме не ставится и не читается.
  //
  // Ключ ничего не меняет на цепи и никому, кроме открывшего эту ссылку, не
  // виден - розыгрыш давно состоялся, мы лишь перерисовываем его результат.
  async function selfTest() {
    const rounds = await history(5);
    const last = rounds.filter((r) => r && r.status === 'closed')[0];
    if (!last) {
      caption('<b>Nothing to replay</b><span class="cr-sub">' +
              '/circuit/history has no closed rounds yet</span>');
      return;
    }
    const keep = (() => { try { return localStorage.getItem(LS_KEY); } catch (e) { return null; } })();
    await play(last);
    // Возвращаем отметку как была, чтобы проверка не съела показ настоящего
    // раунда у того, кто потом откроет страницу обычной ссылкой.
    try {
      if (keep === null) localStorage.removeItem(LS_KEY);
      else localStorage.setItem(LS_KEY, keep);
    } catch (e) {}
  }

  function boot() {
    if (!$('stage-circuit')) return;

    // Ключ ищем и в строке запроса, и в хеше: страница живёт по адресам вида
    // /#draw, и параметр легко оказывается по ту сторону решётки.
    const testMode = /[?&]revealtest=1/.test(location.search) ||
                     /[?&#]revealtest=1/.test(location.hash);
    if (testMode) {
      // Доску строит refreshCircuit() из index.html; до этого клеток нет и
      // красить нечего. Ждём её появления, но не бесконечно.
      let waited = 0;
      const wait = setInterval(() => {
        const bd = $('cir-board');
        if (bd && bd.children.length) { clearInterval(wait); selfTest(); }
        else if (++waited > 40) clearInterval(wait);
      }, 400);
      return;
    }

    if (window.CircuitState) window.CircuitState.subscribe(tick);
    else console.warn('[circuit-reveal] circuit-state.js не подключён');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
