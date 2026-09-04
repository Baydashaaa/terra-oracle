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
const PROPHECY_CONTRACT = 'terra1w3f09yqcna09hgc562azuze8x4qdvnzanz429cwycm84m8lygffskwcu58';

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

/** Запрос, которым любой перепроверит исход. Это ядро всей механики,
 *  поэтому строится из спецификации рынка, а не пишется руками. */
const METRIC_PATHS = {
  oracle_rate: () => '/terra/oracle/v1beta1/denoms/exchange_rates',
  total_supply: () => '/cosmos/bank/v1beta1/supply/by_denom?denom=uluna',
  staking_ratio: () => '/cosmos/staking/v1beta1/pool',
  community_pool: () => '/cosmos/distribution/v1beta1/community_pool',
  validator_power: (p) => `/cosmos/staking/v1beta1/validators/${p}`,
  proposal_passed: (p) => `/cosmos/gov/v1beta1/proposals/${p}`,
};

/**
 * Экранирование. На сайте розыгрыша такая функция лежит в app.js, здесь её
 * нет, и вызов внутри try превращал ReferenceError в "Chain unavailable":
 * сообщение указывало на узел, хотя виноват был скрипт.
 */
function mktEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

let boardTab = 'questions';
let openMarketId = null;
let betSide = true;

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

/**
 * Мелкие суммы показываем с дробью, крупные - целыми.
 * Округление вниз на 4.7 LUNC давало "4 LUNC" и выглядело как обман; на
 * тысячах дробь наоборот мешает читать.
 */
function fmtLunc(uluna) {
  const v = Number(uluna || 0) / 1e6;
  if (v && v < 1000) {
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return Math.floor(v).toLocaleString('en-US');
}

/** Короткое имя для разметки: в шаблонах оно встречается десятки раз. */
const fmt = fmtLunc;

/**
 * Коэффициент выплаты: своя ставка плюс доля проигравшего банка за вычетом
 * комиссии. Считается по тем же долям, что лежат в самом рынке, а не по
 * зашитым в код - у старых рынков они могут отличаться.
 */
function payoutMultiplier(m, side, extra) {
  const yes = Number(m.pot_yes) + (side && extra ? extra : 0);
  const no = Number(m.pot_no) + (!side && extra ? extra : 0);
  const boost = Number(m.boost || 0);
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
  <div onclick="openProphecyMarket(${m.id})" style="border:1px solid var(--border);border-radius:16px;
              background:var(--surface);padding:18px;margin-bottom:12px;position:relative;
              overflow:hidden;cursor:pointer;">
    <div style="position:absolute;inset:0;pointer-events:none;
                background:linear-gradient(90deg,rgba(34,211,238,0.10) ${pct}%,rgba(244,114,182,0.08) ${pct}%);"></div>
    <div style="position:relative;">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
        <span style="font-size:11px;font-weight:600;color:${color};border:1px solid ${color}55;
                     background:${color}18;padding:3px 9px;border-radius:8px;">
          ${mktEsc(m.category)}${chain ? ' · settles itself' : ''}</span>
        <span style="font-size:12px;color:var(--muted);margin-left:auto;">${status}</span>
      </div>
      <div style="font-size:17px;font-weight:600;line-height:1.3;margin-bottom:12px;">
        ${mktEsc(m.question)}</div>
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
        border-top:1px solid var(--border);padding-top:10px;">${mktEsc(m.reading)}</div>` : ''}
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
  openMarketId = null;

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
window.openProphecyMarket = openProphecyMarket;
window.setBetSide = setBetSide;
window.updateBetCalc = updateBetCalc;
window.submitBet = submitBet;
window.submitClaim = submitClaim;

// ── экран одного рынка ──────────────────────────────────────────────────────

/** Блок проверки: спецификация плюс готовая команда. Строится из полей
 *  рынка, поэтому показывает ровно то условие, на которое ставили люди. */
function verifyBlock(m) {
  if (!m.spec.metric) {
    return `<div style="font-size:13.5px;color:var(--muted);line-height:1.7;">
      Resolved by people against a stated criterion:<br>${mktEsc(m.spec.criterion)}</div>`;
  }
  const path = (METRIC_PATHS[m.spec.metric] || (() => ''))(m.spec.param || '');
  const cmd = `curl -s -H "x-cosmos-block-height: ${m.spec.height}" \\\n  "${PROPHECY_LCD[0]}${path}"`;
  const cond = m.spec.comparator
    ? `${mktEsc(m.spec.comparator)} <code>${mktEsc(m.spec.threshold)}</code>`
    : 'proposal passes';
  return `
    <div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:13.5px;">
      <div style="color:var(--muted);">Metric</div><div>${mktEsc(m.spec.metric)}${m.spec.param ? ' · ' + mktEsc(m.spec.param) : ''}</div>
      <div style="color:var(--muted);">Condition</div><div>${cond}</div>
      <div style="color:var(--muted);">Block height</div><div><code>${m.spec.height}</code></div>
    </div>
    <pre style="background:rgba(0,0,0,.35);border:1px solid var(--border);border-radius:12px;
      padding:14px;overflow-x:auto;font-size:12px;color:#9fb4d8;margin:12px 0 0;">${mktEsc(cmd)}</pre>
    <div style="font-size:12px;color:var(--muted);margin-top:10px;line-height:1.6;">
      The contract stored this the moment the market opened, so what you check now is the
      question people actually bet on.</div>`;
}

function betForm(m) {
  const my = payoutMultiplier(m, true), mn = payoutMultiplier(m, false);
  const btn = (side, label, mult, color) => `
    <button onclick="setBetSide(${side})" style="flex:1;padding:14px;border-radius:14px;cursor:pointer;
      background:${betSide === side ? color + '22' : 'transparent'};
      border:1px solid ${betSide === side ? color + '99' : 'var(--border)'};
      color:${betSide === side ? color : 'var(--muted)'};
      font-family:'Rajdhani',sans-serif;font-weight:700;font-size:17px;">
      ${label}${mult ? ' · ×' + mult.toFixed(2) : ''}</button>`;

  return `
  <div style="border:1px solid var(--border);border-radius:16px;background:var(--surface);
    padding:20px;margin-bottom:12px;">
    <div style="font-family:'Rajdhani',sans-serif;font-weight:700;font-size:19px;margin-bottom:14px;">Place a bet</div>
    <div style="display:flex;gap:10px;margin-bottom:14px;">${btn(true, 'Yes', my, '#22d3ee')}${btn(false, 'No', mn, '#f472b6')}</div>
    <input id="bet-amount" type="text" inputmode="numeric" placeholder="Amount in LUNC"
      oninput="updateBetCalc()" style="width:100%;background:rgba(255,255,255,.04);
      border:1px solid var(--border);border-radius:12px;color:var(--text);
      font-family:'Rajdhani',sans-serif;font-weight:600;font-size:18px;padding:13px 15px;
      outline:none;margin-bottom:12px;box-sizing:border-box;">
    <div id="bet-calc" style="background:rgba(255,255,255,.03);border:1px solid var(--border);
      border-radius:12px;padding:13px 15px;font-size:13px;color:var(--muted);line-height:1.7;
      margin-bottom:14px;">Enter an amount to see what a correct call pays.</div>
    <button onclick="submitBet()" id="bet-go" style="width:100%;padding:15px;border-radius:14px;
      border:1px solid rgba(34,211,238,.5);background:rgba(34,211,238,.14);color:#22d3ee;
      font-family:'Rajdhani',sans-serif;font-weight:700;font-size:17px;cursor:pointer;">Place bet</button>
    <div style="font-size:12px;color:var(--muted);margin-top:10px;line-height:1.6;">
      Payouts arrive about 1.5% smaller than shown: Terra Classic taxes every transfer.</div>
  </div>`;
}

function positionBlock(m, pos) {
  if (!pos || (!Number(pos.yes) && !Number(pos.no))) return '';
  const won = m.status === 'settled' && Number(m.outcome ? pos.yes : pos.no) > 0;
  const canClaim = (m.status === 'settled' && won) || m.status === 'void';
  return `
  <div style="border:1px dashed rgba(168,85,247,.45);border-radius:16px;padding:16px 18px;
       margin-bottom:12px;font-size:13.5px;">
    Your position:
    ${Number(pos.yes) ? `<b style="font-family:'Rajdhani',sans-serif;font-size:16px;">${fmt(pos.yes)} LUNC on yes</b> ` : ''}
    ${Number(pos.no) ? `<b style="font-family:'Rajdhani',sans-serif;font-size:16px;">${fmt(pos.no)} LUNC on no</b>` : ''}
    ${Number(pos.payout) ? `<div style="margin-top:8px;">Pays <b style="color:#22d3ee;">${fmt(pos.payout)} LUNC</b>${
      m.status === 'proposed' ? ' once the challenge window closes' : ''}</div>` : ''}
    ${pos.claimed ? '<div style="margin-top:8px;color:var(--muted);">Already claimed.</div>'
      : canClaim ? `<button onclick="submitClaim()" style="margin-top:10px;padding:12px 22px;
          border-radius:12px;border:1px solid rgba(34,211,238,.5);background:rgba(34,211,238,.14);
          color:#22d3ee;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:16px;
          cursor:pointer;">${m.status === 'void' ? 'Take the refund' : 'Collect'}</button>` : ''}
  </div>`;
}

/**
 * Одно место с тремя состояниями. Пока рынок принимает ставки - форма сверху.
 * Как только исход объявлен, форма исчезает совсем: ставить уже нельзя, и
 * предлагать бессмысленно. После расчёта экран превращается в доказательство.
 */
async function openProphecyMarket(id) {
  openMarketId = id;
  const host = document.getElementById(boardTab === 'resolved' ? 'resolved-list' : 'markets-list');
  if (!host) return;
  host.innerHTML = '<div style="color:var(--muted);padding:20px;">Loading…</div>';

  let m, pos = null;
  try {
    m = await prophecyQuery({ market: { market_id: id } });
    if (window.globalWalletAddress) {
      pos = await prophecyQuery({ position: { market_id: id, address: window.globalWalletAddress } });
    }
  } catch (e) {
    host.innerHTML = emptyPanel('Chain unavailable', 'Could not load this market.');
    return;
  }
  window._prophecyMarket = m;

  const yes = Number(m.pot_yes), no = Number(m.pot_no), total = yes + no;
  const pct = total ? Math.round((yes / total) * 100) : 50;
  const left = timeLeft(m.bets_close_at);
  const color = MARKET_COLORS[m.category] || '#8b96b8';

  let banner = '';
  if (m.status === 'proposed') {
    banner = `<div style="border:1px solid rgba(244,208,63,.4);background:rgba(244,208,63,.08);
      border-radius:14px;padding:16px 18px;margin-bottom:14px;">
      <div style="font-family:'Rajdhani',sans-serif;font-weight:700;font-size:19px;">
        Proposed: ${m.outcome ? 'YES' : 'NO'}</div>
      <div style="font-size:13px;color:var(--muted);margin-top:4px;">
        Payouts stay shut until the challenge window closes. Until then the reading can be disputed.</div>
      ${m.reading ? `<div style="font-size:12.5px;color:#9fb4d8;margin-top:8px;">${mktEsc(m.reading)}</div>` : ''}
    </div>`;
  } else if (m.status === 'settled') {
    banner = `<div style="border:1px solid rgba(34,211,238,.4);background:rgba(34,211,238,.1);
      border-radius:14px;padding:16px 18px;margin-bottom:14px;">
      <div style="font-family:'Rajdhani',sans-serif;font-weight:700;font-size:19px;">
        Settled: ${m.outcome ? 'YES' : 'NO'}</div>
      ${m.reading ? `<div style="font-size:12.5px;color:#9fb4d8;margin-top:6px;">${mktEsc(m.reading)}</div>` : ''}
    </div>`;
  } else if (m.status === 'void') {
    banner = `<div style="border:1px solid var(--border);border-radius:14px;padding:16px 18px;
      margin-bottom:14px;color:var(--muted);font-size:13.5px;">
      Void. Every stake goes back untouched.${m.reading ? '<br>' + mktEsc(m.reading) : ''}</div>`;
  }

  host.innerHTML = `
    <div onclick="renderMarkets(${boardTab === 'resolved'})" style="color:var(--muted);font-size:13px;
      cursor:pointer;margin-bottom:14px;display:inline-block;">&larr; All markets</div>
    ${banner}
    <div style="border:1px solid var(--border);border-radius:16px;background:var(--surface);
      padding:22px;margin-bottom:12px;">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
        <span style="font-size:11.5px;font-weight:600;color:${color};border:1px solid ${color}55;
          background:${color}18;padding:3px 10px;border-radius:8px;">
          ${mktEsc(m.category)}${m.spec.metric ? ' · settles itself' : ''}</span>
        <span style="margin-left:auto;font-family:'Rajdhani',sans-serif;font-weight:700;
          font-size:16px;color:#f4d03f;">${left ? 'closes in ' + left : ''}</span>
      </div>
      <div style="font-family:'Rajdhani',sans-serif;font-weight:700;font-size:27px;
        line-height:1.2;margin-bottom:16px;">${mktEsc(m.question)}</div>
      <div style="display:flex;height:66px;border-radius:14px;overflow:hidden;
        border:1px solid var(--border);margin-bottom:14px;">
        <div style="flex:0 0 ${pct}%;display:flex;flex-direction:column;justify-content:center;
          padding:0 16px;background:linear-gradient(180deg,rgba(34,211,238,.22),rgba(34,211,238,.06));">
          <b style="font-family:'Rajdhani',sans-serif;font-size:20px;color:#22d3ee;">Yes · ${pct}%</b>
          <span style="font-size:11.5px;color:var(--muted);">${fmt(yes)} LUNC · ${m.bettors_yes} players</span>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;
          padding:0 16px;text-align:right;background:linear-gradient(180deg,rgba(244,114,182,.2),rgba(244,114,182,.05));">
          <b style="font-family:'Rajdhani',sans-serif;font-size:20px;color:#f472b6;">${100 - pct}% · No</b>
          <span style="font-size:11.5px;color:var(--muted);">${fmt(no)} LUNC · ${m.bettors_no} players</span>
        </div>
      </div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;">
        <div><b style="font-family:'Rajdhani',sans-serif;font-size:18px;">${fmt(total + Number(m.boost || 0))}</b>
          <div style="font-size:11.5px;color:var(--muted);">pot, LUNC</div></div>
        ${Number(m.boost) ? `<div><b style="font-family:'Rajdhani',sans-serif;font-size:18px;color:#f4d03f;">+${fmt(m.boost)}</b>
          <div style="font-size:11.5px;color:var(--muted);">treasury boost</div></div>` : ''}
      </div>
    </div>
    ${positionBlock(m, pos)}
    ${m.status === 'open' && left ? betForm(m) : ''}
    <div style="border:1px solid var(--border);border-radius:16px;background:var(--surface);padding:20px;">
      <div style="font-family:'Rajdhani',sans-serif;font-weight:700;font-size:19px;margin-bottom:14px;">
        ${m.status === 'settled' || m.status === 'proposed' ? 'Verify it yourself' : 'How this settles'}</div>
      ${verifyBlock(m)}
    </div>`;
}

// ── ставка и выплата ────────────────────────────────────────────────────────

function setBetSide(side) {
  betSide = side;
  if (openMarketId) openProphecyMarket(openMarketId);
}

function updateBetCalc() {
  const m = window._prophecyMarket;
  const box = document.getElementById('bet-calc');
  const raw = (document.getElementById('bet-amount') || {}).value || '';
  const lunc = Number(String(raw).replace(/[^0-9]/g, ''));
  if (!m || !box) return;
  if (!lunc) {
    box.textContent = 'Enter an amount to see what a correct call pays.';
    return;
  }
  // Собственная ставка входит в расчёт: без неё цифра завышена, и человек
  // считает по коэффициенту, которого уже не будет.
  const mult = payoutMultiplier(m, betSide, lunc * 1e6);
  const payout = Math.floor(lunc * mult);
  box.innerHTML = `If ${betSide ? 'yes' : 'no'} wins you collect
    <b style="color:var(--text);font-family:'Rajdhani',sans-serif;font-size:15px;">
    ${payout.toLocaleString('en-US')} LUNC</b> - your ${lunc.toLocaleString('en-US')} back plus
    ${(payout - lunc).toLocaleString('en-US')} from the losing pot.<br>
    If it does not, the stake is gone.`;
}

async function submitBet() {
  const m = window._prophecyMarket;
  const btn = document.getElementById('bet-go');
  const raw = (document.getElementById('bet-amount') || {}).value || '';
  const lunc = Number(String(raw).replace(/[^0-9]/g, ''));
  if (!m || !lunc || !btn) return;
  if (!window.globalWalletAddress) { alert('Connect a wallet first.'); return; }

  btn.disabled = true;
  btn.textContent = 'Confirm in your wallet…';
  try {
    const hash = await window.sendExecuteContract(
      window.globalWalletAddress, PROPHECY_CONTRACT,
      { bet: { market_id: m.id, side: betSide } },
      [{ denom: 'uluna', amount: String(lunc * 1e6) }],
      'oracle-prophecy: bet ' + m.id, 'columbus-5'
    );
    console.log('[prophecy] bet tx', hash);
    btn.textContent = 'Sent, waiting for the block…';
    // Перерисовка с задержкой: сразу после отправки контракт ещё покажет
    // старые суммы, и человек решит, что ставка не прошла.
    setTimeout(() => openProphecyMarket(m.id), 7000);
  } catch (e) {
    alert(e.message || 'Transaction failed');
    btn.disabled = false;
    btn.textContent = 'Place bet';
  }
}

async function submitClaim() {
  const m = window._prophecyMarket;
  if (!m || !window.globalWalletAddress) return;
  try {
    const hash = await window.sendExecuteContract(
      window.globalWalletAddress, PROPHECY_CONTRACT,
      { claim: { market_id: m.id } }, [],
      'oracle-prophecy: claim ' + m.id, 'columbus-5'
    );
    console.log('[prophecy] claim tx', hash);
    setTimeout(() => openProphecyMarket(m.id), 7000);
  } catch (e) {
    alert(e.message || 'Transaction failed');
  }
}
