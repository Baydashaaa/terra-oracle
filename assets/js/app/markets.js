/**
 * markets.js - вкладка Markets на борде.
 *
 * Читает рынки прямо из контракта oracle-prophecy через LCD. Никакого
 * посредника между страницей и цепочкой нет намеренно: числа, которые видит
 * человек перед ставкой, должны приходить оттуда же, откуда их берёт расчёт.
 *
 * Пока боевой экземпляр не развёрнут, адрес пустой, и вкладка показывает
 * честное "скоро открытие" вместо выдуманных рынков.
 */

// Подставить адрес боевого экземпляра при запуске. Тестовый:
// terra1w3f09yqcna09hgc562azuze8x4qdvnzanz429cwycm84m8lygffskwcu58
const PROPHECY_CONTRACT = '';

const PROPHECY_LCD = [
  'https://terra-classic-lcd.publicnode.com',
  'https://lcd.terra-classic.hexxagon.io',
  'https://terraclassic-mainnet-lcd.autostake.com',
];

// Цвет темы одинаков в значке и в подписи. Категория приходит из контракта
// строкой, незнакомая получает нейтральный цвет, а не ломает вёрстку.
const MARKET_COLORS = {
  chain: '#22d3ee',
  crypto: '#f4d03f',
  sport: '#4ade80',
  politics: '#fb923c',
  world: '#a855f7',
};

let boardTab = 'questions';

// ── чтение цепочки ──────────────────────────────────────────────────────────

async function prophecyQuery(msg) {
  const q = btoa(JSON.stringify(msg));
  for (const base of PROPHECY_LCD) {
    try {
      const r = await fetch(`${base}/cosmwasm/wasm/v1/contract/${PROPHECY_CONTRACT}/smart/${q}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) continue;
      return (await r.json()).data;
    } catch (e) { /* следующий узел */ }
  }
  throw new Error('chain unavailable');
}

async function loadProphecyMarkets() {
  const out = [];
  let after = null;
  for (let page = 0; page < 10; page++) {
    const res = await prophecyQuery({ markets: { status: null, start_after: after, limit: 50 } });
    const list = (res && res.markets) || [];
    if (!list.length) break;
    out.push(...list);
    after = list[list.length - 1].id;
    if (list.length < 50) break;
  }
  return out;
}

// ── подготовка чисел ────────────────────────────────────────────────────────

const luncOf = (uluna) => Math.floor(Number(uluna || 0) / 1e6);

function fmtLunc(uluna) {
  return luncOf(uluna).toLocaleString('en-US');
}

/**
 * Коэффициент выплаты: своя ставка плюс доля проигравшего банка за вычетом
 * комиссии. Считается по тем же долям, что лежат в самом рынке, а не по
 * зашитым в код - у старых рынков они могут отличаться.
 */
function payoutMultiplier(m, side) {
  const yes = Number(m.pot_yes), no = Number(m.pot_no), boost = Number(m.boost || 0);
  const mine = side ? yes : no;
  const other = (side ? no : yes) + boost;
  if (!mine) return null;
  const kept = 10000 - m.fees.protocol_bps - m.fees.creator_bps - m.fees.boost_bps;
  return (mine + (other * kept) / 10000) / mine;
}

function timeLeft(ts) {
  const left = Number(ts) - Math.floor(Date.now() / 1000);
  if (left <= 0) return null;
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600),
        m = Math.floor((left % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── отрисовка ───────────────────────────────────────────────────────────────

function marketCard(m) {
  const yes = Number(m.pot_yes), no = Number(m.pot_no);
  const total = yes + no;
  // Пустой рынок рисуем ровно посередине: 50 на 50 честнее, чем ноль,
  // который выглядит как проигрыш одной стороны.
  const pct = total ? Math.round((yes / total) * 100) : 50;
  const color = MARKET_COLORS[m.category] || '#8b96b8';
  const chain = !!m.spec.metric;
  const left = timeLeft(m.bets_close_at);
  const my = payoutMultiplier(m, true), mn = payoutMultiplier(m, false);

  const status = m.status === 'settled'
    ? `<span style="color:${m.outcome ? '#22d3ee' : '#f472b6'};font-weight:600;">
         ${m.outcome ? 'YES' : 'NO'} · settled</span>`
    : m.status === 'void'
      ? '<span style="color:var(--muted);">void · stakes returned</span>'
      : m.status === 'proposed'
        ? '<span style="color:#f4d03f;">outcome proposed · challenge window</span>'
        : left ? `closes in ${left}` : 'bets closed';

  return `
  <div style="border:1px solid var(--border);border-radius:16px;background:var(--surface);
              padding:18px;margin-bottom:12px;position:relative;overflow:hidden;">
    <div style="position:absolute;inset:0;pointer-events:none;
                background:linear-gradient(90deg,rgba(34,211,238,0.10) ${pct}%,rgba(244,114,182,0.08) ${pct}%);"></div>
    <div style="position:relative;">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
        <span style="font-size:11px;font-weight:600;color:${color};border:1px solid ${color}55;
                     background:${color}18;padding:3px 9px;border-radius:8px;">
          ${escHTML(m.category)}${chain ? ' · settles itself' : ''}</span>
        <span style="font-size:12px;color:var(--muted);margin-left:auto;">${status}</span>
      </div>
      <div style="font-size:17px;font-weight:600;line-height:1.3;margin-bottom:12px;">
        ${escHTML(m.question)}</div>
      <div style="display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap;">
        <div><div style="font-family:'Rajdhani',sans-serif;font-weight:700;font-size:24px;color:#22d3ee;">
          ${pct}%</div>
          <div style="font-size:11px;color:var(--muted);">yes${my ? ` · ×${my.toFixed(2)}` : ''}</div></div>
        <div><div style="font-family:'Rajdhani',sans-serif;font-weight:700;font-size:24px;color:#f472b6;">
          ${100 - pct}%</div>
          <div style="font-size:11px;color:var(--muted);">no${mn ? ` · ×${mn.toFixed(2)}` : ''}</div></div>
        <div style="margin-left:auto;text-align:right;">
          <div style="font-family:'Rajdhani',sans-serif;font-weight:600;font-size:16px;">
            ${fmtLunc(total + Number(m.boost || 0))} LUNC</div>
          <div style="font-size:11px;color:var(--muted);">
            ${m.bettors_yes + m.bettors_no} players${Number(m.boost) ? ' · boosted' : ''}</div>
        </div>
      </div>
      ${m.reading ? `<div style="margin-top:12px;font-size:11.5px;color:var(--muted);
        border-top:1px solid var(--border);padding-top:10px;">${escHTML(m.reading)}</div>` : ''}
    </div>
  </div>`;
}

function emptyPanel(text, sub) {
  return `<div style="border:1px solid var(--border);border-radius:16px;background:var(--surface);
    padding:40px 24px;text-align:center;">
    <div style="font-family:'Rajdhani',sans-serif;font-weight:700;font-size:20px;margin-bottom:8px;">${text}</div>
    <div style="font-size:13.5px;color:var(--muted);max-width:52ch;margin:0 auto;line-height:1.6;">${sub}</div>
  </div>`;
}

async function renderMarkets(resolved) {
  const host = document.getElementById(resolved ? 'resolved-list' : 'markets-list');
  if (!host) return;

  if (!PROPHECY_CONTRACT) {
    host.innerHTML = emptyPanel('Opening soon',
      'Prediction markets settle against the chain itself: a metric, a threshold and a block ' +
      'height fixed before the first bet. Nobody announces the result - anyone can recompute it.');
    return;
  }

  host.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:20px;">Loading markets…</div>';
  try {
    const all = await loadProphecyMarkets();
    const live = ['open', 'locked', 'proposed'];
    const list = all.filter((m) => (resolved ? !live.includes(m.status) : live.includes(m.status)));
    // Свежие сверху: у открытых интереснее ближайшие к закрытию, у закрытых -
    // последние рассчитанные.
    list.sort((a, b) => (resolved ? b.id - a.id : a.bets_close_at - b.bets_close_at));
    host.innerHTML = list.length
      ? list.map(marketCard).join('')
      : emptyPanel(resolved ? 'Nothing settled yet' : 'No open markets',
          resolved ? 'Settled and voided markets will be listed here with their readings.'
                   : 'Be the first to open one.');
  } catch (e) {
    host.innerHTML = emptyPanel('Chain unavailable',
      'Could not read the markets contract. This is a node problem, not a market problem - try again shortly.');
  }
}

// ── переключение вкладок ────────────────────────────────────────────────────

function switchBoardTab(tab) {
  boardTab = tab;
  ['markets', 'questions', 'resolved'].forEach((t) => {
    const pane = document.getElementById(`board-pane-${t}`);
    const btn = document.getElementById(`board-tab-${t}`);
    if (pane) pane.style.display = t === tab ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });

  // Заголовок и кнопка принадлежат вкладке, а не странице: одно действие,
  // меняется только то, что именно создаётся.
  const title = document.getElementById('board-title');
  const btn = document.getElementById('board-action');
  if (title) {
    title.textContent = tab === 'questions' ? 'Active Questions'
      : tab === 'markets' ? 'Prediction Markets' : 'Settled';
  }
  if (btn) {
    btn.textContent = tab === 'questions' ? 'Ask a question' : 'Open a market';
    btn.onclick = tab === 'questions'
      ? () => showPage('ask')
      : () => alert('Market creation opens with the contract launch.');
    btn.style.display = tab === 'resolved' ? 'none' : '';
  }

  if (tab === 'markets') renderMarkets(false);
  if (tab === 'resolved') renderMarkets(true);
}

window.switchBoardTab = switchBoardTab;
window.renderMarkets = renderMarkets;
