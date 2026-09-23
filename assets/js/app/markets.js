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

// Сеть раздела. ?testnet=1 ведёт на rebel-2 с тестовыми контрактами,
// ?testnet=0 возвращает на mainnet. Запоминается на вкладку: адрес теряет
// параметры при первом же переходе по меню.
const PROPHECY_TESTNET = (function () {
  try {
    if (/[?&]testnet=1/.test(location.search)) sessionStorage.setItem('mkTestnet', '1');
    if (/[?&]testnet=0/.test(location.search)) sessionStorage.removeItem('mkTestnet');
    return sessionStorage.getItem('mkTestnet') === '1';
  } catch (e) { return false; }
})();

const PROPHECY_NET = PROPHECY_TESTNET
  ? {
      chainId: 'rebel-2',
      lcd: ['https://lcd.luncblaze.com'],
      // oracle-prophecy 0.2.0 (code 2452) и oracle-court 0.1.0 (code 2454)
      prophecy: 'terra1m7vkkgvu4zz8vnh7c2lyspterzfkaeshnqvrqg4pqf2lkauvw69sgt6ktt',
      court: 'terra1st3mk29dwgd7wqg4w6zsw4cc78vpulhzed5anhnpshyv49ze446saar2za',
    }
  : {
      chainId: 'columbus-5',
      lcd: [
      'https://terra-classic-lcd.publicnode.com',
      'https://lcd.terra-classic.hexxagon.io',
      'https://fcd.terra-classic.hexxagon.io',
      ],
      // Адреса боевых 0.2.0 и суда подставляются при запуске; пока суда
      // нет, блоки спора на mainnet не показываются.
      prophecy: 'terra1w3f09yqcna09hgc562azuze8x4qdvnzanz429cwycm84m8lygffskwcu58',
      court: '',
    };

const PROPHECY_CONTRACT = PROPHECY_NET.prophecy;
const PROPHECY_LCD = PROPHECY_NET.lcd;
const PROPHECY_CHAIN = PROPHECY_NET.chainId;
const COURT_CONTRACT = PROPHECY_NET.court;

/**
 * Адрес подключённого кошелька. Сайт объявляет его через `let` в wallet.js,
 * а такая переменная НЕ становится свойством window: обращение через window
 * всегда undefined, и раздел отвечал "Connect a wallet first" при подключённом
 * кошельке. Читаем по имени, в том же порядке, что core.js.
 */
function mkWallet() {
  return (typeof globalWalletAddress !== 'undefined' && globalWalletAddress)
    || (typeof connectedAddress !== 'undefined' && connectedAddress)
    || null;
}

// Окно оспаривания живёт в конфиге контракта, а не в рынке: держим копию,
// чтобы показывать, сколько его осталось.
let prophecyCfg = null;

async function loadProphecyConfig() {
  if (prophecyCfg) return prophecyCfg;
  try { prophecyCfg = await prophecyQuery({ config: {} }); } catch (e) { /* не критично */ }
  return prophecyCfg;
}


// Цвет темы одинаков в значке и в подписи. Категория приходит из контракта
// строкой, незнакомая получает нейтральный цвет, а не ломает вёрстку.
const MARKET_COLORS = {
  economy: '#f4d03f',
  governance: '#a855f7',
  protocol: '#22d3ee',
  validators: '#4ade80',
  network: '#38bdf8',
  community: '#fb7185',
  macro: '#fb923c',
  // прежние значения - у рынков, созданных до переименования
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
// Какой список был открыт последним - для автообновления.
let mkLastResolved = false;

// ── чтение цепочки ──────────────────────────────────────────────────────────

async function prophecyQuery(msg) {
  const q = btoa(JSON.stringify(msg));
  for (const base of PROPHECY_LCD) {
    try {
      // AbortSignal.timeout не работает в части кошельковых браузеров:
      // запрос молча не уходит, и страница показывает "Chain unavailable".
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10000);
      let r;
      try {
        r = await fetch(`${base}/cosmwasm/wasm/v1/contract/${PROPHECY_CONTRACT}/smart/${q}`, {
          headers: { Accept: 'application/json' },
          signal: ctl.signal,
        });
      } finally { clearTimeout(timer); }
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
// Псевдоним fmt убран: это имя занимают модули Oracle Draw,
// и у них оно значит другое. В шаблонах ниже - fmtLunc.

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

// ── спека человеческим языком ───────────────────────────────────────────────
//
// Человек, решающий, ставить ли деньги, не должен читать "lt 6000000000000".
// Техническая правда никуда не девается - она уезжает под спойлер ниже.

const METRIC_TEXT = {
  total_supply:    { t: () => 'the total LUNC supply', u: 'lunc' },
  oracle_rate:     { t: (p) => `the LUNC oracle rate in ${String(p || '').replace(/^u/, '').toUpperCase()}`, u: 'raw' },
  staking_ratio:   { t: () => 'the share of LUNC staked', u: 'pct' },
  community_pool:  { t: () => 'the community pool', u: 'lunc' },
  validator_power: { t: (p) => `the stake delegated to ${shortAddr(p)}`, u: 'lunc' },
  proposal_passed: { t: (p) => `governance proposal #${mktEsc(p)}`, u: null },
};

const COMPARATOR_TEXT = { gt: 'above', gte: 'at least', lt: 'below', lte: 'at most' };

/** Большие числа словами: 6,000,000,000,000 читается хуже, чем 6T. Точное
 *  значение остаётся рядом в скобках, чтобы ничего не пряталось. */
function bigLunc(uluna) {
  const v = Number(uluna || 0) / 1e6;
  const exact = v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 1e12) return `${+(v / 1e12).toFixed(2)}T LUNC <span class="exact">(${exact})</span>`;
  if (v >= 1e9) return `${+(v / 1e9).toFixed(2)}B LUNC <span class="exact">(${exact})</span>`;
  if (v >= 1e6) return `${+(v / 1e6).toFixed(2)}M LUNC <span class="exact">(${exact})</span>`;
  return `${exact} LUNC`;
}

/** Высота блока в примерную дату. Кэш общий на страницу: тянуть последний
 *  блок на каждый рынок незачем. */
let _tip = null;
async function chainTip() {
  if (_tip) return _tip;
  for (const base of PROPHECY_LCD) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      let r;
      try {
        r = await fetch(`${base}/cosmos/base/tendermint/v1beta1/blocks/latest`,
          { headers: { Accept: 'application/json' }, signal: ctl.signal });
      } finally { clearTimeout(timer); }
      if (!r.ok) continue;
      const j = await r.json();
      _tip = { height: Number(j.block.header.height), time: Date.parse(j.block.header.time) / 1000 };
      return _tip;
    } catch (e) { /* следующий узел */ }
  }
  return null;
}

function approxDateText(height, tip) {
  if (!tip || !height) return '';
  const secs = tip.time + (Number(height) - tip.height) * 6;
  const d = new Date(secs * 1000);
  if (isNaN(d)) return '';
  const when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return Number(height) > tip.height ? ` &mdash; around ${when}` : ` &mdash; ${when}`;
}

/** Одна фраза, по которой понятно, за что держат деньги. */
function plainSpec(m, tip) {
  if (!m.spec.metric) {
    return `Settled by people against a stated criterion: ${mktEsc(m.spec.criterion)}`;
  }
  const info = METRIC_TEXT[m.spec.metric];
  const what = info ? info.t(m.spec.param) : mktEsc(m.spec.metric);
  const at = `at block <b>${Number(m.spec.height).toLocaleString('en-US')}</b>${approxDateText(m.spec.height, tip)}`;

  if (!info || info.u === null) return `Settles <b class="y">YES</b> if ${what} has passed, ${at}.`;

  const cmp = COMPARATOR_TEXT[m.spec.comparator] || m.spec.comparator;
  let th;
  if (info.u === 'lunc') th = bigLunc(m.spec.threshold);
  else if (info.u === 'pct') th = `${m.spec.threshold}%`;
  else th = mktEsc(m.spec.threshold);

  return `Settles <b class="y">YES</b> if ${what} is ${cmp} ${th}, ${at}.`;
}

// ── отрисовка ───────────────────────────────────────────────────────────────

/** Цвет категории в виде "r,g,b": CSS прототипа кладёт его в --c и сам
 *  разводит по рамке, тексту и фону. */
function catRgb(cat) {
  const hex = (MARKET_COLORS[cat] || '#8b96b8').replace('#', '');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
}

function shortAddr(a) {
  const s = String(a || '');
  return s.length > 16 ? s.slice(0, 9) + '…' + s.slice(-4) : s;
}

/** Строка состояния в шапке. Один текст на все виды карточек, чтобы
 *  крупная и обычная не разъезжались. */
/** Строка состояния в шапке. Один текст на все виды карточек, чтобы
 *  крупная и обычная не разъезжались. */
function statusLine(m) {
  if (m.status === 'settled') {
    return `<b class="${m.outcome ? 'y' : 'n'}">${m.outcome ? 'YES' : 'NO'}</b> · settled`;
  }
  if (m.status === 'void') return 'void · stakes returned';
  if (m.status === 'disputed') return '<b class="p">in court</b>';
  if (m.status === 'proposed') {
    // "Proposed" человеку ничего не говорит. Важно другое: идёт окно, внутри
    // которого исход ещё можно оспорить, и сколько его осталось.
    const ends = prophecyCfg && m.proposed_at
      ? Number(m.proposed_at) + Number(prophecyCfg.challenge_secs) : 0;
    return `<b class="p">verifying</b>${
      ends > Math.floor(Date.now() / 1000) ? ' · ' + cd(ends) : ''}`;
  }
  const left = timeLeft(m.bets_close_at);
  return left ? 'closes in ' + cd(m.bets_close_at) : 'awaiting resolution';
}

/** Сколько осталось от окна оспаривания. */
function challengeLeft(m) {
  if (!prophecyCfg || !m.proposed_at) return '';
  const ends = Number(m.proposed_at) + Number(prophecyCfg.challenge_secs);
  const s = ends - Math.floor(Date.now() / 1000);
  if (s <= 0) return '';
  const h = Math.floor(s / 3600), mn = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${mn}m` : `${mn}m`;
}

/** Подпись над процентами. Пока приём открыт, это текущее распределение;
 *  после закрытия банки уже не меняются, и это зафиксированный прогноз. */
function oddsCaption(m) {
  if (m.status === 'open' && timeLeft(m.bets_close_at)) return '';
  if (m.status === 'settled' || m.status === 'void') return 'Forecast at close';
  return 'Forecast at close · no more bets';
}


/** Состояние стороны рынка: открыт, закрыт, выиграла, проиграла.
 *  Одно место на карточку и на экран рынка, чтобы они не расходились. */
function sideState(m, isYes) {
  if (m.status === 'settled' && m.outcome !== null && m.outcome !== undefined) {
    return m.outcome === isYes ? 'won' : 'lost';
  }
  if (m.status === 'void') return 'void';
  if (m.status === 'open' && timeLeft(m.bets_close_at)) return 'open';
  return 'closed';
}

function oddsBlock(m) {
  const yes = Number(m.pot_yes), no = Number(m.pot_no);
  const total = yes + no;
  // Пустой рынок рисуем ровно посередине: 50 на 50 честнее, чем ноль,
  // который выглядит как проигрыш одной стороны.
  const pct = total ? Math.round((yes / total) * 100) : 50;
  const my = payoutMultiplier(m, true), mn = payoutMultiplier(m, false);
  const side = (isYes, label, p, mult) => {
    const st = sideState(m, isYes);
    // Коэффициент имеет смысл, только пока можно поставить.
    const sub = st === 'won' ? '<span class="m">won</span>'
      : st === 'lost' ? '<span class="m">lost</span>'
        : st === 'open' && mult ? `<span class="m">pays ×${mult.toFixed(2)}</span>`
          : st === 'closed' ? '<span class="m">closed</span>' : '';
    return `
    <button class="${isYes ? 'yes' : 'no'}" type="button" data-state="${st}">
      <span class="k">${label}</span>
      <span class="p">${p}%</span>
      ${sub}
    </button>`;
  };
  const cap = oddsCaption(m);
  return (cap ? `<div class="odds-cap">${cap}</div>` : '')
    + '<div class="odds">' + side(true, 'YES', pct, my)
    + side(false, 'NO', 100 - pct, mn) + '</div>';
}


function footBlock(m) {
  const total = Number(m.pot_yes) + Number(m.pot_no) + Number(m.boost || 0);
  return `
    <div class="foot">
      <span><img src="assets/img/icons/c-volume.webp" alt="" loading="lazy"><b>${fmtLunc(total)}</b> LUNC</span>
      <span><img src="assets/img/icons/c-users.webp" alt="" loading="lazy"><b>${m.bettors_yes + m.bettors_no}</b> players</span>
      ${Number(m.boost)
        ? `<span><img src="assets/img/lunc.webp" alt="" loading="lazy"><b>+${fmtLunc(m.boost)}</b> boost</span>`
        : ''}
    </div>`;
}

/** Метка происхождения исхода. Стоит рядом с категорией, потому что это
 *  ровно то, чем рынки отличаются друг от друга по доверию. */
function sourceTag(m) {
  return m.spec.metric
    ? '<span class="cat src on">on-chain spec</span>'
    : '<span class="cat src">human-resolved</span>';
}

function marketCard(m) {
  return `
  <article class="mkc" style="--c:${catRgb(m.category)}" onclick="openProphecyMarket(${m.id})">
    <div class="head">
      <span class="cat">${mktEsc(m.category)}</span>
      ${sourceTag(m)}
      <span class="left">${statusLine(m)}</span>
    </div>
    <h4>${mktEsc(m.question)}</h4>
    <div class="by">Created by ${mktEsc(shortAddr(m.creator))}</div>
    ${oddsBlock(m)}
    ${footBlock(m)}
  </article>`;
}

/** Тот же рынок, которому отдано больше места: фон баннера, крупный
 *  вопрос и проценты. Первый в списке, чтобы страница не начиналась
 *  плиткой одинаковых карточек. */
function featuredCard(m) {
  return `
  <article class="mkc big" style="--c:${catRgb(m.category)}" onclick="openProphecyMarket(${m.id})">
    <img class="art" src="assets/img/banner-markets.webp" alt="" loading="lazy">
    <div class="inner">
      <div class="head">
        <span class="cat feat">${m.promoted ? 'Featured'
          : (m.status === 'settled' || m.status === 'void') ? 'Latest result' : 'Closing next'}</span>
        <span class="cat">${mktEsc(m.category)}</span>
        ${sourceTag(m)}
        <span class="left">${statusLine(m)}</span>
      </div>
      <h4>${mktEsc(m.question)}</h4>
      <div class="by">Created by ${mktEsc(shortAddr(m.creator))}</div>
      ${m.ruling
        ? `<p class="desc">Court decision: ${mktEsc(m.ruling)}</p>`
        : m.reading && m.status === 'disputed'
          ? `<p class="desc">Disputed reading: ${mktEsc(m.reading)}</p>`
          : m.reading && m.status === 'proposed'
            ? `<p class="desc">Posted reading, still open to dispute: ${mktEsc(m.reading)}</p>`
            : m.reading ? `<p class="desc">${mktEsc(m.reading)}</p>` : ''}
      ${oddsBlock(m)}
      ${footBlock(m)}
    </div>
  </article>`;
}


function emptyPanel(text, sub) {
  return `<div style="border:1px solid var(--border);border-radius:16px;background:var(--surface);
    padding:40px 24px;text-align:center;">
    <div style="font-family:'Rajdhani',sans-serif;font-weight:700;font-size:20px;margin-bottom:8px;">${text}</div>
    <div style="font-size:13.5px;color:var(--muted);max-width:52ch;margin:0 auto;line-height:1.6;">${sub}</div>
  </div>`;
}

async function renderMarkets(resolved) {
  mkLastResolved = !!resolved;
  // Вкладки нужны списку. Возвращаясь из рынка, подсвечиваем ту, что открыта.
  const mkTabsEl = document.getElementById('mkTabs');
  if (mkTabsEl) {
    mkTabsEl.style.display = '';
    mkTabsEl.querySelectorAll('button').forEach((b, i) => {
      b.setAttribute('aria-pressed', String(i === (resolved ? 1 : 0)));
    });
  }
  const host = document.getElementById('markets-list');
  if (!host) return;
  openMarketId = null;

  if (!PROPHECY_CONTRACT) {
    host.innerHTML = emptyPanel('Opening soon',
      'Prediction markets fix a metric, a threshold and a block height before the first bet, ' +
      'so anyone can recompute the answer. The operator posts the outcome; the contract does not ' +
      'read the chain itself.');
    return;
  }

  // Контракт помечен в цепочке как TEST, admin и resolver - один кошелёк.
  // Пока это так, интерфейс обязан говорить об этом прямо.
  const TEST_BANNER = `
    <div style="border:1px solid rgba(255,170,60,0.35);background:rgba(255,170,60,0.07);
      border-radius:12px;padding:12px 14px;margin-bottom:16px;font-size:12.5px;
      color:#ffb14e;line-height:1.6;">
      ${COURT_CONTRACT
        ? `<strong>TEST deployment${PROPHECY_TESTNET ? ' · rebel-2' : ''}.</strong> The operator posts
           outcomes. Anyone can dispute one, and a court decides - the operator cannot vote in it.
           Bets are capped. Treat this as a preview, not a settled market.`
        : `<strong>TEST deployment.</strong> Outcomes are posted by the operator, not computed by the
           contract, and the same key can post and challenge them. Bets are capped. Treat this as a
           preview, not a settled market.`}
    </div>`;

  host.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:20px;">Loading markets…</div>';
  try {
    await loadProphecyConfig();
    const all = await loadProphecyMarkets();
    renderMarketStats(all);
    const live = ['open', 'locked', 'proposed', 'disputed'];
    const list = all.filter((m) => (resolved ? !live.includes(m.status) : live.includes(m.status)));
    // Свежие сверху: у открытых интереснее ближайшие к закрытию, у закрытых -
    // последние рассчитанные.
    list.sort((a, b) => (resolved ? b.id - a.id : a.bets_close_at - b.bets_close_at));
    // Первым идёт продвинутый рынок, а если такого нет - ближайший к
    // закрытию: список уже отсортирован. Один рынок на всю ширину, потому
    // что сетка из одной колонки выглядит как ошибка вёрстки.
    const feat = list.find((m) => m.promoted) || list[0];
    const rest = list.filter((m) => m !== feat);
    const grid = rest.length
      ? `<div class="mk-grid"><div>${featuredCard(feat)}</div>`
        + `<div class="mk-list">${rest.map(marketCard).join('')}</div></div>`
      : featuredCard(feat);
    host.innerHTML = TEST_BANNER + (list.length
      ? grid
      : emptyPanel(resolved ? 'Nothing settled yet' : 'No open markets',
          resolved ? 'Settled and voided markets will be listed here with their readings.'
                   : 'Be the first to open one.'));
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
      : () => mkToast('Market creation opens with the contract launch.');
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
/** Техническая часть: ровно то условие, на которое ставили люди, плюс
 *  готовая команда. Живёт внутри спойлера - нужна проверяющему, а не
 *  каждому, кто открыл рынок. */
function verifyBlock(m) {
  if (!m.spec.metric) {
    return `<div class="mk-plain">The agreement is the criterion above. Nothing here is read
      from the chain, so the outcome is posted by a person.</div>`;
  }
  const path = (METRIC_PATHS[m.spec.metric] || (() => ''))(m.spec.param || '');
  const cmd = `curl -s -H "x-cosmos-block-height: ${m.spec.height}" \\\n  "${PROPHECY_LCD[0]}${path}"`;
  const cond = m.spec.comparator
    ? `${mktEsc(m.spec.comparator)} <code>${mktEsc(m.spec.threshold)}</code>`
    : 'proposal passes';
  return `
    <div class="mk-spec">
      <div>Metric</div><div>${mktEsc(m.spec.metric)}${m.spec.param ? ' · ' + mktEsc(m.spec.param) : ''}</div>
      <div>Condition</div><div>${cond}</div>
      <div>Block height</div><div><code>${m.spec.height}</code></div>
    </div>
    <pre>${mktEsc(cmd)}</pre>
    <div class="mk-plain">The contract stored this the moment the market opened, so what you
      check now is the question people actually bet on. The outcome itself is posted by the
      operator: the contract records the claim, it does not verify the metric.</div>`;
}


/** Форма ставки. Выбор стороны переехал в крупные кнопки самого рынка -
 *  два набора кнопок на одном экране путали: люди жали в карточке и
 *  думали, что ставка сделана. */
function betForm(m) {
  return `
  <section class="card mk-bet">
    <h3>Place a bet</h3>
    <label class="mk-amount">
      <span>Amount</span>
      <input id="bet-amount" type="text" inputmode="numeric" placeholder="0"
             oninput="updateBetCalc()" autocomplete="off">
      <em>LUNC</em>
    </label>
    <div id="bet-calc" class="mk-calc">Pick a side above and enter an amount.</div>
    <button onclick="submitBet()" id="bet-go" class="ask-go mk-place">Place bet &rarr;</button>
    <div class="mk-plain">Terra Classic taxes every transfer, so a payout arrives about
      0.5% smaller than the figure shown.</div>
  </section>`;
}


function positionBlock(m, pos) {
  if (!pos || (!Number(pos.yes) && !Number(pos.no))) return '';
  const won = m.status === 'settled' && Number(m.outcome ? pos.yes : pos.no) > 0;
  const canClaim = (m.status === 'settled' && won) || m.status === 'void';
  const side = Number(pos.yes)
    ? `<b class="y">${fmtLunc(pos.yes)} LUNC</b> on yes`
    : '';
  const side2 = Number(pos.no)
    ? `<b class="n">${fmtLunc(pos.no)} LUNC</b> on no`
    : '';
  return `
  <section class="card mk-pos">
    <h3>Your position</h3>
    <div class="mk-pos-line">${[side, side2].filter(Boolean).join(' &nbsp;·&nbsp; ')}</div>
    ${Number(pos.payout) && !pos.claimed
      ? `<div class="mk-pos-pay">Pays <b>${fmtLunc(pos.payout)} LUNC</b> · about
          <b>${netLunc(pos.payout)} LUNC</b> after the 0.5% network tax${
          m.status === 'proposed' ? ', once the challenge window closes' : ''}</div>`
      : ''}
    ${pos.claimed
      ? `<div class="mk-pos-done">${m.status === 'void' ? 'Refunded' : 'Collected'} ✓</div>`
      : canClaim
        ? `<button onclick="submitClaim()" class="ask-go mk-place">${
            m.status === 'void' ? 'Take the refund' : 'Collect'} &rarr;</button>`
        : ''}
  </section>`;
}


/**
 * Одно место с тремя состояниями. Пока рынок принимает ставки - форма сверху.
 * Как только исход объявлен, форма исчезает совсем: ставить уже нельзя, и
 * предлагать бессмысленно. После расчёта экран превращается в доказательство.
 */
/** Рассчитанный рынок как доказательство: что прочитали, с чем сравнили
 *  и почему получился такой исход. Одна строка "Settled: NO" оставляла
 *  человека гадать. */
function evidenceBlock(m) {
  // Условие словами, как в "How this settles": сырое `lt 6000000000000000000`
  // в карточке, которую читают первой, ничего не говорит.
  const info = METRIC_TEXT[m.spec.metric];
  const th = !info ? mktEsc(m.spec.threshold)
    : info.u === 'lunc' ? bigLunc(m.spec.threshold)
      : info.u === 'pct' ? mktEsc(m.spec.threshold) + '%' : mktEsc(m.spec.threshold);
  const cond = m.spec.metric && m.spec.comparator
    ? `${COMPARATOR_TEXT[m.spec.comparator] || mktEsc(m.spec.comparator)} ${th}`
    : m.spec.metric ? 'proposal passed' : 'stated criterion';
  // При споре показание резолвера - одна из сторон, а не установленный
  // факт: суд мог его отвергнуть. Подписи говорят, кто что утверждал.
  const disputed = !!m.challenge_reading;
  return `
    <div class="mk-banner done mk-evidence">
      <h3>Settled · <b class="${m.outcome ? 'y' : 'n'}">${m.outcome ? 'YES' : 'NO'}</b></h3>
      ${m.reading ? `<div class="ev-row"><span>${disputed ? "Resolver's reading" : 'Reading'}</span><b>${mktEsc(m.reading)}</b></div>` : ''}
      <div class="ev-row"><span>Condition</span><b>${cond}</b></div>
      ${m.spec.height ? `<div class="ev-row"><span>Block</span><b>${Number(m.spec.height).toLocaleString('en-US')}</b></div>` : ''}
      ${m.challenge_reading ? `<div class="ev-row"><span>Challenger's reading</span><b>${mktEsc(m.challenge_reading)}</b></div>` : ''}
      ${m.ruling ? `<div class="ev-row"><span>Court decision</span><b>${mktEsc(m.ruling)}</b></div>` : ''}
      <div class="ev-row"><span>Therefore</span><b class="${m.outcome ? 'y' : 'n'}">${
        m.outcome ? 'YES' : 'NO'}</b></div>
    </div>`;
}

async function openProphecyMarket(id) {
  openMarketId = id;
  // На экране рынка вкладки списка только путали: у рассчитанного рынка
  // горела Open.
  const mkTabsHide = document.getElementById('mkTabs');
  if (mkTabsHide) mkTabsHide.style.display = 'none';
  const host = document.getElementById('markets-list');
  if (!host) return;
  host.innerHTML = '<div class="mk-loading">Loading…</div>';
  // Открытие рынка из середины списка оставляло страницу прокрученной,
  // и экран начинался с середины карточки.
  const main = document.querySelector('.main');
  if (main) main.scrollTop = 0;

  let m, pos = null, tip = null;
  await loadProphecyConfig();
  try {
    m = await prophecyQuery({ market: { market_id: id } });
    if (mkWallet()) {
      pos = await prophecyQuery({ position: { market_id: id, address: mkWallet() } });
    }
  } catch (e) {
    host.innerHTML = emptyPanel('Chain unavailable', 'Could not load this market.');
    return;
  }
  try { tip = await chainTip(); } catch (e) { /* дата необязательна */ }
  window._prophecyMarket = m;
  // Полоса статистики видна и над экраном рынка - обновляем и её, иначе
  // после закрытия спора она показывала старые числа.
  loadProphecyMarkets().then(renderMarketStats).catch(() => {});

  const open = m.status === 'open' && timeLeft(m.bets_close_at);

  let banner = '';
  if (m.status === 'proposed') {
    const left = challengeLeft(m);
    banner = `<div class="mk-banner warn">
      <h3>Verifying · expected ${m.outcome ? 'YES' : 'NO'}</h3>
      <p>A reading has been posted and payouts stay shut while it can still be disputed${
        left ? `. <b>${cd(Number(m.proposed_at) + Number(prophecyCfg.challenge_secs))}</b> left` : ''}.</p>
      ${m.reading ? `<p class="read">${mktEsc(m.reading)}</p>` : ''}</div>`;
  } else if (m.status === 'settled') {
    banner = evidenceBlock(m);
  } else if (m.status === 'disputed') {
    // Блок суда ниже говорит то же самое и показывает время - плашка
    // была третьим повтором одного статуса.
    banner = '';
  } else if (m.status === 'void') {
    // Причина аннулирования хранится только в атрибутах транзакции, в самом
    // рынке её нет - не выдумываем её здесь.
    banner = `<div class="mk-banner">
      <h3>Void · nobody won or lost</h3>
      <p>Every stake goes back untouched.</p>
      ${m.void_reason ? `<p class="read">Reason: ${mktEsc(m.void_reason)}</p>` : ''}
      ${m.bad_spec
        ? '<p>The question could not be verified, so the creator\'s bond went to the boost fund.</p>'
        : '<p>The creator\'s bond is returned.</p>'}</div>`;
  }

  // Стороны рынка и есть выбор ставки: одни и те же кнопки, чтобы не было
  // двух мест, где можно "выбрать" yes.
  const yes = Number(m.pot_yes), no = Number(m.pot_no);
  const total = yes + no;
  const pct = total ? Math.round((yes / total) * 100) : 50;
  const my = payoutMultiplier(m, true), mn = payoutMultiplier(m, false);
  const sideBtn = (isYes, label, p, mult, pot, players) => {
    const st = sideState(m, isYes);
    const sub = st === 'won' ? '<span class="m badge">WON</span>'
      : st === 'lost' ? '<span class="m">did not happen</span>'
        : st === 'open' && mult ? `<span class="m">pays ×${mult.toFixed(2)}</span>`
          : st === 'closed' ? '<span class="m">betting closed</span>' : '';
    return `
    <button class="${isYes ? 'yes' : 'no'}" type="button" data-state="${st}"
            data-side="${isYes ? 1 : 0}" aria-pressed="${open && betSide === isYes}"
            ${open ? `onclick="setBetSide(${isYes})"` : 'disabled'}>
      <span class="k">${label}</span>
      <span class="p">${p}%</span>
      ${sub}
      <span class="s">${fmtLunc(pot)} LUNC · ${players} ${players === 1 ? 'player' : 'players'}</span>
    </button>`;
  };

  host.innerHTML = `
    <div class="mk-back" onclick="renderMarkets(${m.status === 'open' || m.status === 'locked' ? 'false' : 'true'})">&larr; All markets</div>
    ${banner}
    <article class="mkc big mk-detail" style="--c:${catRgb(m.category)}">
      <img class="art" src="assets/img/banner-markets.webp" alt="" loading="lazy">
      <div class="inner">
        <div class="head">
          <span class="cat">${mktEsc(m.category)}</span>
          ${sourceTag(m)}
          <span class="left">${statusLine(m)}</span>
        </div>
        <h4>${mktEsc(m.question)}</h4>
        <div class="by">Created by ${mktEsc(shortAddr(m.creator))}</div>
        ${oddsCaption(m) ? `<div class="odds-cap">${oddsCaption(m)}</div>` : ''}
        <div class="odds" id="bet-side-row">
          ${sideBtn(true, 'YES', pct, my, yes, m.bettors_yes)}
          ${sideBtn(false, 'NO', 100 - pct, mn, no, m.bettors_no)}
        </div>
        ${!open && m.status === 'open'
          ? '<div class="mk-shut">Betting is closed, waiting for the outcome.</div>' : ''}
        ${footBlock(m)}
      </div>
    </article>
    <div id="mk-dispute"></div>
    ${positionBlock(m, pos)}
    ${open ? betForm(m) : ''}
    <section class="card mk-how">
      <h3>How this settles</h3>
      <p class="mk-lead">${plainSpec(m, tip)}</p>
      <details class="mk-verify">
        <summary>Check it against the chain yourself</summary>
        ${verifyBlock(m)}
      </details>
    </section>`;
  if (window.renderDispute) window.renderDispute(m);
}


// ── ставка и выплата ────────────────────────────────────────────────────────

/**
 * Переключение стороны меняет только подсветку кнопок и пересчитывает выплату.
 * Полная перерисовка тянула цепочку заново и стирала введённую сумму: человек
 * набирал 50,000, менял сторону и обнаруживал пустое поле.
 */
/**
 * Переключение стороны меняет только состояние кнопок и пересчитывает
 * выплату. Полная перерисовка тянула цепочку заново и стирала введённую
 * сумму: человек набирал 50,000, менял сторону и обнаруживал пустое поле.
 */
function setBetSide(side) {
  betSide = side;
  if (!window._prophecyMarket) return;
  document.querySelectorAll('#bet-side-row button').forEach((b) => {
    b.setAttribute('aria-pressed', String((b.dataset.side === '1') === betSide));
  });
  updateBetCalc();
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
  box.innerHTML = `<div class="row"><span>You stake</span><b>${lunc.toLocaleString('en-US')} LUNC</b></div>
    <div class="row"><span>If ${betSide ? 'YES' : 'NO'} wins</span><b class="y">${payout.toLocaleString('en-US')} LUNC</b></div>
    <div class="row"><span>Profit</span><b class="y">+${(payout - lunc).toLocaleString('en-US')} LUNC</b></div>
    <div class="row muted"><span>If it does not</span><b>the stake is gone</b></div>`;
}

async function submitBet() {
  const m = window._prophecyMarket;
  const btn = document.getElementById('bet-go');
  const raw = (document.getElementById('bet-amount') || {}).value || '';
  const lunc = Number(String(raw).replace(/[^0-9]/g, ''));
  if (!m || !lunc || !btn) return;
  if (!mkWallet()) { mkToast('Connect a wallet first.', 'info'); return; }

  btn.disabled = true;
  btn.textContent = 'Confirm in your wallet…';
  try {
    const hash = await window.sendExecuteContract(
      mkWallet(), PROPHECY_CONTRACT,
      { bet: { market_id: m.id, side: betSide } },
      [{ denom: 'uluna', amount: String(lunc * 1e6) }],
      'oracle-prophecy: bet ' + m.id, PROPHECY_CHAIN, 600000
    );
    console.log('[prophecy] bet tx', hash);
    mkToast('Bet sent. It shows up after the next block.', 'ok');
    btn.textContent = 'Sent, waiting for the block…';
    // Перерисовка с задержкой: сразу после отправки контракт ещё покажет
    // старые суммы, и человек решит, что ставка не прошла.
    setTimeout(() => openProphecyMarket(m.id), 7000);
  } catch (e) {
    mkToast(e.message || 'Transaction failed', 'err');
    btn.disabled = false;
    btn.textContent = 'Place bet';
  }
}

async function submitClaim() {
  const m = window._prophecyMarket;
  if (!m || !mkWallet()) return;
  try {
    const hash = await window.sendExecuteContract(
      mkWallet(), PROPHECY_CONTRACT,
      { claim: { market_id: m.id } }, [],
      'oracle-prophecy: claim ' + m.id, PROPHECY_CHAIN, 800000
    );
    console.log('[prophecy] claim tx', hash);
    mkToast('Payout requested. It arrives after the next block.', 'ok');
    setTimeout(() => openProphecyMarket(m.id), 7000);
  } catch (e) {
    mkToast(e.message || 'Transaction failed', 'err');
  }
}


// ── страница Markets: статистика и переключатель ────────────────────────────

function renderMarketStats(all) {
  const live = ['open', 'locked', 'proposed', 'disputed'];
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  const staked = all.reduce((s, m) => s + Number(m.pot_yes) + Number(m.pot_no), 0);
  const players = all.reduce((s, m) => s + m.bettors_yes + m.bettors_no, 0);
  set('mk-stat-open', all.filter((m) => live.includes(m.status)).length);
  set('mk-stat-vol', fmtLunc(staked));
  set('mk-stat-settled', all.filter((m) => m.status === 'settled').length);
  set('mk-stat-players', players.toLocaleString('en-US'));
}

function switchMarketView(btn, resolved) {
  const row = document.getElementById('mkTabs');
  if (row) row.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b === btn));
  });
  renderMarkets(resolved);
}

window.switchMarketView = switchMarketView;
window.renderMarketStats = renderMarketStats;


// ── живые таймеры и автообновление ─────────────────────────────────────────

/** 25:41, 04:12:33 или 1d 04:12:33. */
function fmtCountdown(s) {
  s = Math.max(0, Math.floor(s));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n) => String(n).padStart(2, '0');
  if (d) return `${d}d ${p(h)}:${p(m)}:${p(s % 60)}`;
  if (h) return `${p(h)}:${p(m)}:${p(s % 60)}`;
  return `${p(m)}:${p(s % 60)}`;
}

/** Отсчёт до момента `until` (секунды). Тикает один общий таймер ниже. */
function cd(until) {
  const s = Number(until) - Math.floor(Date.now() / 1000);
  return `<span class="mk-cd" data-until="${Number(until)}">${fmtCountdown(s)}</span>`;
}

function mkPageVisible() {
  const p = document.getElementById('page-markets');
  return !!(p && p.classList.contains('active'));
}

/** Человек печатает - экран не трогаем, иначе набранный текст пропадёт. */
function mkUserTyping() {
  return ['ch-reading', 'bet-amount'].some((id) => {
    const el = document.getElementById(id);
    return el && (el.value || document.activeElement === el);
  });
}

let mkRefreshing = false;
async function mkRefresh() {
  if (mkRefreshing || !mkPageVisible() || mkUserTyping()) return;
  mkRefreshing = true;
  try {
    if (openMarketId !== null) await openProphecyMarket(openMarketId);
    else await renderMarkets(mkLastResolved);
  } finally {
    mkRefreshing = false;
  }
}

// Один таймер на весь раздел: обновляет все отсчёты раз в секунду.
setInterval(() => {
  if (!mkPageVisible()) return;
  const now = Math.floor(Date.now() / 1000);
  let expired = false;
  document.querySelectorAll('#page-markets .mk-cd').forEach((el) => {
    const left = Number(el.dataset.until) - now;
    el.textContent = fmtCountdown(left);
    if (left <= 0 && !el.dataset.done) {
      el.dataset.done = '1';
      expired = true;
    }
  });
  // Ноль - значит сменилось состояние: закрылся приём, окно оспаривания или
  // голосование. Ждём блок, в котором это время уже прошло, и перечитываем.
  if (expired) setTimeout(mkRefresh, 7000);
}, 1000);

// Пока рынок в споре или ждёт оспаривания, его меняют другие люди: голоса,
// чужое оспаривание. Раз в 20 секунд перечитываем. Если статус тот же -
// перерисовываем только блок суда, без мигания и прокрутки; если сменился -
// весь экран.
setInterval(async () => {
  const cur = window._prophecyMarket;
  if (openMarketId === null || !cur || !mkPageVisible() || mkUserTyping()) return;
  if (cur.status !== 'disputed' && cur.status !== 'proposed') return;
  try {
    const m = await prophecyQuery({ market: { market_id: openMarketId } });
    if (m.status !== cur.status) { mkRefresh(); return; }
    if (m.status === 'disputed' && window.renderDispute) {
      window._prophecyMarket = m;
      window.renderDispute(m);
    }
  } catch (e) { /* узел не ответил - попробуем в следующий раз */ }
}, 20000);

// Тестовая сеть видна сразу, чтобы её невозможно было принять за настоящую.
if (PROPHECY_TESTNET) {
  const pg = document.getElementById('page-markets');
  if (pg && !document.getElementById('mk-testnet')) {
    pg.insertAdjacentHTML('afterbegin',
      '<div id="mk-testnet" class="mk-testnet">TESTNET · rebel-2 · test contracts, no real money</div>');
  }
}


// ── уведомления ────────────────────────────────────────────────────────────
//
// Вместо системного alert: снизу, в стиле раздела, исчезают сами. kind -
// 'ok', 'err' или 'info'.
function mkToast(msg, kind) {
  let box = document.getElementById('mk-toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'mk-toasts';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = 'mk-toast ' + (kind || 'info');
  // Ошибки кошелька приходят длинными и техническими - оставляем суть.
  let text = String(msg || '');
  const raw = text.match(/raw_log['":\s]*(.*)$/);
  if (raw) text = raw[1];
  if (/rejected by the user|Request rejected/i.test(text)) text = 'Cancelled in the wallet.';
  if (/insufficient funds/i.test(text)) text = 'Not enough LUNC to cover this and the network fee.';
  el.textContent = text.length > 220 ? text.slice(0, 217) + '…' : text;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, kind === 'err' ? 8000 : 5000);
}


/** Сколько придёт на кошелёк: выплаты из контракта теряют 0.5% налога,
 *  замер на rebel-2 сошёлся до uluna. */
function netLunc(uluna) {
  return (Number(uluna || 0) * 0.995 / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
