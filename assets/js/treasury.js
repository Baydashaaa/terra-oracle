// ─── TREASURY MODULE · terra-oracle ──────────────────────────
const T_WALLETS = {
  treasury:  'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt', // Main Treasury
  daily:     'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px', // Daily Draw Pool
  weekly:    'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz', // Weekly Draw Pool
  rewards:   'terra1ty6fxd9u0jzae5lpzcs56rfclxg4q32hw5x4ce', // REP Rewards 25%
  reserve:   'terra10q6syec2e27x8g76a0mvm3frgvarl5dz27a2jz', // Reserve 15%
  liquidity: 'terra1gukarslv6c8n0s2259822l7059putpqxz405su', // Liquidity 50%
  dev:       'terra17g55uzkm6cr5fcl3vzcrmu73v8as4yvf2kktzr', // Development 10%
  // Circuit. Пул зон — такие же деньги протокола, как daily и weekly, и
  // входит в TVL. Кошелёк выкупа копит LUNC до порога покупки TCO и тоже
  // входит. Кошелёк сжигания держит TCO, а не LUNC, — в TVL НЕ входит.
  circuit:   'terra1lkcsxf2et3s64uwemyy257n0dcep0al40a4m55', // Circuit Pool
  tcoBuy:    'terra1x3axkacpes4d8q2svfeneqdtv8rvcvccrn66j5', // TCO buyback
  tcoBurn:   'terra10zptfez4jdvakrhu58q4nqj2te7mnpewqhu27a', // TCO held for burn
};
const T_TCO_TOKEN = 'terra1566znlxwke0kp9jkhe6qgapsmcfdmc7k9czh380tlx80va8zlsgqzvjtfp';
const T_TCO_BOND  = 'terra1xnejslpfa398nn2mexv34y8737fcq998zz4dsnq74qn464lu9m4s604du5';
const T_DRAW_WORKER = 'https://oracle-draw.vladislav-baydan.workers.dev';
const T_LCD = [
  // Раньше первым стоял terra-classic.publicnode.com — это RPC-хост, REST API
  // он не отдаёт. Каждый из семи запросов баланса сначала бился о него впустую.
  'https://terra-classic-lcd.publicnode.com',
  'https://lcd.terraclassic.community',
  'https://terra-classic-lcd.hexxagon.io',
];
function tFmt(uluna) {
  const n = uluna / 1_000_000;
  if (n >= 1_000_000) return (n/1_000_000).toFixed(2) + 'M LUNC';
  if (n >= 1_000)     return (n/1_000).toFixed(1) + 'K LUNC';
  return n.toLocaleString(undefined,{maximumFractionDigits:0}) + ' LUNC';
}
function tFmtUsd(uluna, price) {
  const usd = (uluna/1_000_000)*price;
  if (usd >= 1000) return '≈ $'+(usd/1000).toFixed(2)+'K USD';
  return '≈ $'+usd.toFixed(2)+' USD';
}
function tSet(id, val) { const e=document.getElementById(id); if(e) e.textContent=val; }
async function tFetchBal(addr) {
  for (const lcd of T_LCD) {
    try {
      const r = await fetch(`${lcd}/cosmos/bank/v1beta1/balances/${addr}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      const amt = d.balances?.find(b=>b.denom==='uluna')?.amount||'0';
      return parseInt(amt);
    } catch(e) { continue; }
  }
  return null;
}
async function tFetchPrice() {
  // Через воркер oracle-draw: там кэш в KV на 60 секунд и цепочка
  // CryptoCompare → CoinGecko. Прямой вызов CoinGecko из браузера шёл на
  // каждое открытие страницы, без кэша и без запасного источника, и упирался
  // в лимиты публичного API. Заодно цена на обоих сайтах теперь одна и та же.
  const W = (typeof O_DRAW_WORKER !== 'undefined' && O_DRAW_WORKER) || 'https://oracle-draw.vladislav-baydan.workers.dev';
  try {
    const r = await fetch(`${W}/lunc-price`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const d = await r.json();
      if (d.LUNC > 0) return d.LUNC;
    }
  } catch(e) {}
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=terra-luna&vs_currencies=usd', { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    if (d['terra-luna']?.usd) return d['terra-luna'].usd;
  } catch(e) {}
  return 0.00009;
}
let _countdownTimer = null;
function tStartCountdowns() {
  if (_countdownTimer) clearInterval(_countdownTimer);
  // Расписание и формат отсчёта — в общем файле assets/js/draw-schedule.js.
  // Он ПОБАЙТОВО тот же, что в репо oracle-draw (draw.terraoracle.io), и должен
  // грузиться обычным <script> ДО treasury.js. Своей арифметики здесь больше нет:
  // три независимые копии этой логики и разъехались 3 авг 2026.
  if (!window.DRAW_SCHEDULE) {
    console.error('[treasury] assets/js/draw-schedule.js не загружен — счётчики ' +
      'розыгрыша считать нечем. Проверь порядок <script> в index.html: ' +
      'draw-schedule.js должен идти ДО treasury.js.');
    return;
  }

  function tick() {
    var S = window.DRAW_SCHEDULE;
    // Один и тот же формат для обоих: >24ч → "1d 02:57", иначе → "02:57:23".
    // Раньше daily печатался с секундами, а weekly без — одинаковое время
    // выглядело по-разному и читалось как расхождение.
    tSet('t-daily-countdown',  S.format(S.msToNext('daily')));
    tSet('t-weekly-countdown', S.format(S.msToNext('weekly')));
  }
  tick(); _countdownTimer = setInterval(tick, 1000);
}
// Сумма uluna из событий transfer в логах транзакции. Для минта NFT
// (MsgExecuteContract) это единственное место, где видно движение монет —
// в самом сообщении LUNC не лежит. amount приходит строкой "N uluna" или
// "Nuluna", иногда несколько монет через запятую.
function sumTransferEvents(logs, wallet, dir) {
  if (!Array.isArray(logs)) return 0;
  const wantKey = dir === 'out' ? 'sender' : 'recipient';
  let total = 0;
  for (const lg of logs) {
    for (const ev of (lg.events || [])) {
      if (ev.type !== 'transfer') continue;
      // Атрибуты идут плоским списком recipient/sender/amount, повторяясь
      // тройками. Проходим окном по 3.
      const a = ev.attributes || [];
      for (let i = 0; i < a.length; i++) {
        if (a[i].key !== 'amount') continue;
        // ближайшие recipient и sender до этого amount
        let recipient = null, sender = null;
        for (let j = i; j >= 0; j--) {
          if (!sender && a[j].key === 'sender') sender = a[j].value;
          if (!recipient && a[j].key === 'recipient') recipient = a[j].value;
          if (sender && recipient) break;
        }
        const party = wantKey === 'sender' ? sender : recipient;
        const other = wantKey === 'sender' ? recipient : sender;
        if (party !== wallet) continue;
        if (other === wallet) continue; // самому себе
        for (const part of String(a[i].value).split(',')) {
          const m = part.trim().match(/^(\d+)\s*uluna$/);
          if (m) total += parseInt(m[1]);
        }
      }
    }
  }
  return total;
}

async function tLoadRecentTxs(retries = 5) {
  const el = document.getElementById('t-recent-txs');
  if (!el) {
    if (retries > 0) setTimeout(() => tLoadRecentTxs(retries - 1), 200);
    return;
  }
  el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:12px;">Loading transactions...</div>';

  // Helper: fetch txs for one wallet — tries FCD first, falls back to LCD
  const T_FCD = [
    'https://fcd.terra-classic.hexxagon.io',
    'https://terra-classic-fcd.publicnode.com',
    'https://columbus-fcd.terra.dev',
  ];

  // dir: 'in' — что пришло на кошелёк, 'out' — что с него ушло
  async function fetchTxsFor(wallet, limit, dir) {
    let txs = [];
    const evKey = dir === 'out' ? 'transfer.sender' : 'transfer.recipient';

    {
      for (const lcd of T_LCD) {
        try {
          const url = `${lcd}/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(`${evKey}='${wallet}'`)}&pagination.limit=${limit}&order_by=2`;
          const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) continue;
          const data = await r.json();
          // Convert LCD format to FCD-like format
          const bodies = data.txs || [];
          const metas  = data.tx_responses || [];
          txs = metas.map((meta, i) => ({
            txhash:    meta.txhash,
            timestamp: meta.timestamp,
            // События transfer — единственное место, где виден LUNC из
            // MsgExecuteContract (минт NFT): в самом сообщении его нет.
            // Старые ноды кладут их в logs[].events, новые — в плоский
            // tx_response.events. Сохраняем оба, sumTransferEvents съест любой.
            logs:   meta.logs || [],
            events: meta.events || [],
            tx: {
              value: {
                memo: bodies[i]?.body?.memo || '',
                msg:  (bodies[i]?.body?.messages || []).map(m => ({
                  type:  m['@type'] || '',
                  value: {
                    amount: m.amount, from_address: m.from_address, to_address: m.to_address,
                    // funds контрактного вызова — запасной путь, если логов нет
                    funds: m.funds || (m.msg && m.msg.funds) || null,
                  },
                })),
              },
            },
          }));
          if (txs.length) break;
        } catch(e) { continue; }
      }
    }

    const results = [];
    const CHAT_AMT     = 5_000_000_000;     // 5,000 LUNC
    const QA_AMT       = 100_000_000_000;   // 100,000 LUNC
    const TOL          = 0.08;

    // NFT tier thresholds — full price paid by user
    const NFT_TIERS = [
      { label: 'Legendary', min: 240_000_000_000, max: 260_000_000_000 },
      { label: 'Rare',      min:  120_000_000_000, max: 130_000_000_000 },
      { label: 'Common',    min:   23_000_000_000, max:  27_000_000_000 },
    ];

    for (const tx of txs) {
      const tsRaw = tx.timestamp ? new Date(tx.timestamp) : null;
      const ts = tsRaw
        ? tsRaw.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' ' + tsRaw.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
        : '';
      const tsMs = tsRaw ? tsRaw.getTime() : 0;
      const hash = tx.txhash || '';
      const memo = tx.tx?.value?.memo || tx.tx?.body?.memo || '';
      const msgs = tx.tx?.value?.msg  || tx.tx?.body?.messages || [];

      // Переводы самому себе не считаем ни в одну, ни в другую сторону
      let rawUluna = 0;
      // Who the money came from (or went to). This is what tells a question
      // apart from a draw share when both are 25,000 LUNC.
      let counterparty = '';
      let viaEvents = false;
      for (const msg of msgs) {
        const to    = msg.value?.to_address   || msg.to_address   || '';
        const from  = msg.value?.from_address || msg.from_address || '';
        const coins = msg.value?.coins || msg.value?.amount || msg.amount || [];
        const lunc  = Array.isArray(coins) ? coins.find(c => c.denom === 'uluna') : null;
        if (!lunc) continue;
        if (dir === 'out') { if (from === wallet && to !== wallet) { rawUluna += parseInt(lunc.amount); counterparty = counterparty || to; } }
        else               { if (to === wallet && from !== wallet) { rawUluna += parseInt(lunc.amount); counterparty = counterparty || from; } }
      }

      // MsgSend ничего не дал → это контрактная транзакция (минт NFT).
      // Читаем события transfer из логов: recipient/sender/amount, где amount —
      // строка вида "25000000000uluna". Отбираем по нужной стороне и по кошельку.
      if (!rawUluna) {
        // logs[].events (старые ноды) ИЛИ плоский events (новые) — приводим
        // к единому виду [{events:[...]}] и разбираем.
        const logSets = (tx.logs && tx.logs.length) ? tx.logs
                      : (tx.events && tx.events.length) ? [{ events: tx.events }]
                      : [];
        rawUluna = sumTransferEvents(logSets, wallet, dir);
        // No MsgSend means the transfer came out of a contract call, and the
        // only contract paying these wallets is the NFT one. That is a firmer
        // signal than any amount.
        if (rawUluna) viaEvents = true;
      }
      // Последний фолбэк — funds контрактного вызова (если логи не пришли)
      if (!rawUluna && dir === 'in') {
        for (const msg of msgs) {
          const funds = msg.value?.funds;
          const lunc  = Array.isArray(funds) ? funds.find(c => c.denom === 'uluna') : null;
          if (lunc) rawUluna += parseInt(lunc.amount);
        }
      }
      if (!rawUluna) continue;

      // Detect NFT tier by amount
      function detectNFTTier(amt) {
        for (const t of NFT_TIERS) {
          if (amt >= t.min && amt <= t.max) return t.label;
        }
        return null;
      }

      // Classify by destination wallet + amount
      // A mint reaches these wallets through the NFT contract, so it has no
      // MsgSend of its own. A draw share comes from a pool wallet. Anything
      // else arriving from an ordinary address is somebody paying for
      // something — and that holds whatever the discount was.
      const fromPool = counterparty === T_WALLETS.daily || counterparty === T_WALLETS.weekly;
      let label;
      if (dir === 'out') {
        label = wallet === T_WALLETS.daily  ? 'Daily draw — prize payout'
              : wallet === T_WALLETS.weekly ? 'Weekly draw — prize payout'
              : (memo || 'Treasury outflow');
      } else if (viaEvents) {
        const nftTier = detectNFTTier(rawUluna);
        const pool = wallet === T_WALLETS.weekly ? 'Weekly' : 'Daily';
        label = nftTier ? `Oracle Draw — ${pool} NFT | ${nftTier}` : `Oracle Draw — ${pool} NFT`;
      } else if (wallet === T_WALLETS.treasury) {
        if (fromPool)
          label = counterparty === T_WALLETS.daily
            ? 'Oracle Draw — Daily (10%)'
            : 'Oracle Draw — Weekly (10%)';
        else if (rawUluna >= CHAT_AMT*(1-TOL) && rawUluna <= CHAT_AMT*(1+TOL))
          label = 'DAO Chat message';
        else
          label = 'Q&A — Treasury';
      } else if (wallet === T_WALLETS.weekly) {
        label = fromPool ? (memo || 'Transfer') : 'Q&A — Weekly Pool';
      } else if (wallet === T_WALLETS.daily) {
        label = memo || 'Transfer';
      } else {
        label = memo || 'Transfer';
      }

      results.push({ label, amount: tFmt(rawUluna), hash, ts, tsMs, dir: dir === 'out' ? 'out' : 'in' });
    }
    return results;
  }

  try {
    // Три кошелька × два направления. Раньше спрашивали только
    // transfer.recipient, поэтому на странице было видно, как деньги
    // приходят, но не как уходят — выплаты победителям не показывались.
    const groups = await Promise.all([
      fetchTxsFor(T_WALLETS.treasury, 8, 'in'),
      fetchTxsFor(T_WALLETS.weekly,   8, 'in'),
      fetchTxsFor(T_WALLETS.daily,    8, 'in'),
      fetchTxsFor(T_WALLETS.treasury, 6, 'out'),
      fetchTxsFor(T_WALLETS.weekly,   6, 'out'),
      fetchTxsFor(T_WALLETS.daily,    6, 'out'),
    ]);

    // Одна транзакция может прийти из двух запросов (перевод между своими
    // кошельками) — оставляем по одной записи на пару хеш+направление
    const seen = new Set();
    const allTxs = groups.flat()
      .filter(t => { const k = t.hash + '|' + t.dir; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => b.tsMs - a.tsMs)
      .slice(0, 14);

    if (!allTxs.length) {
      el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:12px;">No transactions yet</div>';
      return;
    }

    // Направление читается тремя способами сразу — стрелкой, знаком и цветом
    const ARROW = {
      in:  '<path d="M12 4.6v14.8"/><path d="M6.4 13.6 12 19.4l5.6-5.8"/>',
      out: '<path d="M12 19.4V4.6"/><path d="M6.4 10.4 12 4.6l5.6 5.8"/>',
    };
    el.innerHTML = allTxs.map(tx => {
      const isOut = tx.dir === 'out';
      const c = isOut ? '#ff8a7a' : '#66ffaa';
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);gap:12px;">
        <div style="display:flex;align-items:center;gap:9px;min-width:0;flex:1;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">${isOut ? ARROW.out : ARROW.in}</svg>
          <div style="min-width:0;">
            <div style="font-size:11px;color:var(--text);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${tx.label}</div>
            <div style="font-size:10px;color:var(--muted);">${tx.ts}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
          <span style="font-size:11px;font-weight:700;color:${c};font-family:Rajdhani,sans-serif;">${isOut ? '\u2212' : '+'}${tx.amount}</span>
          <a href="https://finder.terraport.finance/mainnet/tx/${tx.hash}" target="_blank" title="${tx.hash}"
            style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:var(--accent);text-decoration:none;background:rgba(84,147,247,0.08);border:1px solid rgba(84,147,247,0.2);border-radius:5px;padding:3px 8px;white-space:nowrap;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 13.4a4.5 4.5 0 0 0 6.8.5l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5"/><path d="M13.4 10.6a4.5 4.5 0 0 0-6.8-.5l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/></svg>${tx.hash.slice(0,8)}</a>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;font-size:12px;">Could not load transactions</div>';
  }
}
async function loadTreasuryData() {
  const btn = document.getElementById('t-refresh-btn');
  if (btn) { btn.textContent='Loading…'; btn.disabled=true; }

  const [price, tB, dB, wB, rB, resB, liqB, devB, cB, buyB] = await Promise.all([
    tFetchPrice(),
    tFetchBal(T_WALLETS.treasury),
    tFetchBal(T_WALLETS.daily),
    tFetchBal(T_WALLETS.weekly),
    tFetchBal(T_WALLETS.rewards),
    tFetchBal(T_WALLETS.reserve),
    tFetchBal(T_WALLETS.liquidity),
    tFetchBal(T_WALLETS.dev),
    tFetchBal(T_WALLETS.circuit),
    tFetchBal(T_WALLETS.tcoBuy),
  ]);

  const setWallet = (balId, usdId, bal) => {
    if (bal!==null) { tSet(balId,tFmt(bal)); tSet(usdId,tFmtUsd(bal,price)); }
    else { tSet(balId,'Error'); tSet(usdId,'Node unreachable'); }
  };

  setWallet('t-oracle-bal',   't-oracle-usd',   tB);
  setWallet('t-draw-bal',     't-draw-usd',     dB);
  setWallet('t-weekly-bal',   't-weekly-usd',   wB);
  setWallet('t-rewards-bal',  't-rewards-usd',  rB);
  setWallet('t-reserve-bal',  't-reserve-usd',  resB);
  setWallet('t-liquidity-bal','t-liquidity-usd',liqB);
  setWallet('t-dev-bal',      't-dev-usd',      devB);
  setWallet('t-circuit-bal',  't-circuit-usd',  cB);

  // Доли считаются по ПОСТУПЛЕНИЯМ, а не по остаткам: план 25/15/50/10
  // управляет входящим потоком, а остаток уменьшается расходами. Считать
  // долю остатка и подписывать её «actual» значило бы обвинять кошелёк
  // разработки в недоборе ровно за то, что с него тратили.
  //
  // Запрос тяжелее остальных (четыре поиска по LCD), поэтому не ждём его:
  // страница уже наполнена, полосы дорисуются сами.
  tLoadDistributionFlow();

  // Circuit добавлен в состав TVL: пул зон и кошелёк выкупа держат такие же
  // деньги протокола. На графике это даёт ступеньку в момент выкатки — смена
  // состава, а не ошибка данных.
  const total = (tB||0)+(dB||0)+(wB||0)+(rB||0)+(resB||0)+(liqB||0)+(devB||0)+(cB||0)+(buyB||0);
  // График берёт отсюда сегодняшнюю точку. Без этого он рисовал последний
  // СНИМОК воркера и подписывал его «now», расходясь с заголовком на сумму,
  // изменившуюся с прошлого часа.
  window.__tvlTotalUluna = total;
  tSet('t-total-tvl', tFmt(total));
  tSet('t-total-usd', tFmtUsd(total,price));
  tSet('t-last-updated','Updated '+new Date().toLocaleTimeString());
  // Живой итог уходит в дельту: иначе она считается между снимками и после
  // вечернего розыгрыша расходится с показанным TVL на сумму выплаты.
  tLoadTvlDelta(total);

  tSetTco('t-tco-buy', buyB, '#38d9d0');
  tLoadCircuitStrip();

  if (btn) { btn.textContent='↻ Refresh'; btn.disabled=false; }
  tLoadRecentTxs();
}

// Полоса TCO: сколько зон продано, сколько TCO лежит до сжигания и насколько
// бондинг-кривая заполнена. Три независимых запроса — падение любого не должно
// ронять остальные, поэтому каждый в своём try.
// Ноль — это «ещё не накопилось», а не число, которым надо кричать. Крупный
// цветной 0 читался как поломка, поэтому пустое значение приглушается.
function tSetTco(id, uluna, color) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!uluna || uluna <= 0) {
    el.textContent = '—';
    el.style.color = 'var(--muted)';
    el.style.opacity = '.65';
  } else {
    el.textContent = tFmt(uluna);
    el.style.color = color;
    el.style.opacity = '1';
  }
}

async function tLoadCircuitStrip() {
  const smart = async (contract, msg) => {
    const q = btoa(JSON.stringify(msg));
    for (const node of T_LCD) {
      try {
        const r = await fetch(`${node}/cosmwasm/wasm/v1/contract/${contract}/smart/${q}`,
                              { signal: AbortSignal.timeout(8000) });
        const d = await r.json();
        if (d.data !== undefined) return d.data;
      } catch (e) { /* следующий узел */ }
    }
    return null;
  };

  try {
    const r = await fetch(`${T_DRAW_WORKER}/circuit/state`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const d = await r.json();
      tSet('t-circuit-zones', d.sold + '/' + d.maxZones);
    }
  } catch (e) { /* бейдж останется прочерком */ }

  try {
    const b = await smart(T_TCO_TOKEN, { balance: { address: T_WALLETS.tcoBurn } });
    // У TCO шесть знаков, как у LUNC, поэтому формат тот же
    if (b && b.balance !== undefined) tSetTco('t-tco-burn', Number(b.balance), '#ff8a7a');
  } catch (e) { /* прочерк */ }

  try {
    const info = await smart(T_TCO_BOND, { info: {} });
    if (info && info.completion_percentage !== undefined) {
      const pct = Number(info.completion_percentage) * 100;
      tSet('t-curve-pct', pct.toFixed(1) + '%');
      const bar = document.getElementById('t-curve-bar');
      if (bar) bar.style.width = Math.min(100, pct).toFixed(1) + '%';
      const raised = Number(info.vault_native || 0) / 1e6;
      tSet('t-curve-note', tFmt(Number(info.vault_native || 0)) + ' of 37.5M LUNC raised');
    }
  } catch (e) { /* прочерк */ }
}

// Сумма ПОСТУПЛЕНИЙ на кошелёк за период. Тот же способ, которым страница
// тянет список операций: поиск по LCD и сумма событий transfer.
//
// Возвращает { uluna, count, capped }. capped=true означает, что лимит
// выборки упёрся раньше начала периода, то есть данные неполные — об этом
// надо сказать вслух, а не показывать заниженную сумму как точную.
async function tInflowSince(wallet, sinceMs, limit = 100) {
  const q = encodeURIComponent(`transfer.recipient='${wallet}'`);
  for (const lcd of T_LCD) {
    try {
      const url = `${lcd}/cosmos/tx/v1beta1/txs?query=${q}&pagination.limit=${limit}&order_by=2`;
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const d = await r.json();
      const metas = d.tx_responses || [];
      if (!metas.length) return { uluna: 0, count: 0, capped: false };

      let total = 0, n = 0, oldest = Infinity;
      for (const m of metas) {
        const ts = m.timestamp ? Date.parse(m.timestamp) : 0;
        if (ts) oldest = Math.min(oldest, ts);
        if (ts < sinceMs) continue;
        // Старые ноды кладут события в logs[], новые — плоско в events
        const logs = (m.logs && m.logs.length) ? m.logs : [{ events: m.events || [] }];
        const amt = sumTransferEvents(logs, wallet, 'in');
        if (amt > 0) { total += amt; n++; }
      }
      return { uluna: total, count: n, capped: metas.length >= limit && oldest > sinceMs };
    } catch (e) { /* следующий узел */ }
  }
  return null;
}

// Доли по поступлениям за период. Именно этим управляет план 25/15/50/10 —
// в отличие от остатков, которые уменьшаются расходами.
async function tLoadDistributionFlow(days = 30) {
  const since = Date.now() - days * 24 * 3600 * 1000;
  const keys = [
    ['rewards',   T_WALLETS.rewards,   25],
    ['reserve',   T_WALLETS.reserve,   15],
    ['liquidity', T_WALLETS.liquidity, 50],
    ['dev',       T_WALLETS.dev,       10],
  ];

  const res = await Promise.all(keys.map(([, addr]) => tInflowSince(addr, since)));
  const ok = res.every((x) => x !== null);
  if (!ok) {
    keys.forEach(([k]) => tSet('t-' + k + '-pct', 'inflow unavailable'));
    return;
  }

  const total = res.reduce((s, x) => s + x.uluna, 0);
  const capped = res.some((x) => x.capped);

  keys.forEach(([k, , plan], i) => {
    const share = total > 0 ? (res[i].uluna / total) * 100 : 0;
    tSet('t-' + k + '-pct', total > 0
      ? share.toFixed(1) + '% of ' + days + 'd inflow'
      : 'no inflow in ' + days + 'd');
    const bar = document.getElementById('t-' + k + '-bar');
    if (bar) bar.style.width = Math.min(100, share).toFixed(1) + '%';
  });

  const note = document.getElementById('t-dist-note');
  if (note) {
    note.textContent = total > 0
      ? (capped
          ? 'Bars: share of the last ' + days + ' days of inflow. The sample hit its limit, so the window is shorter than ' + days + ' days.'
          : 'Bars: share of the last ' + days + ' days of inflow · ' + tFmt(total) + ' LUNC distributed. Marks show the target split.')
      : 'No inflow to the distribution wallets in the last ' + days + ' days.';
  }
}

// Копирование адреса кошелька. Clipboard API недоступен вне защищённого
// контекста и в части встроенных браузеров кошельков, поэтому есть запасной
// путь через скрытое textarea + execCommand.
function tCopyAddr(ev, addr) {
  ev.preventDefault();
  ev.stopPropagation();
  const btn = ev.currentTarget;
  const done = () => { btn.classList.add('ok'); setTimeout(() => btn.classList.remove('ok'), 1300); };
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = addr;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(addr).then(done).catch(fallback);
  } else {
    fallback();
  }
}
window.tCopyAddr = tCopyAddr;

// Изменение TVL за 24 часа. Снимок пишет крон воркера oracle-draw раз в час,
// поэтому первые сутки после запуска дельты ещё нет — тогда блок просто скрыт.
async function tLoadTvlDelta(liveTotal) {
  const el = document.getElementById('t-tvl-delta');
  if (!el) return;
  const W = (typeof O_DRAW_WORKER !== 'undefined' && O_DRAW_WORKER) || 'https://oracle-draw.vladislav-baydan.workers.dev';
  try {
    const r = await fetch(`${W}/treasury-history`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) { el.style.display = 'none'; return; }
    const d = await r.json();

    // Точка отсчёта — снимок суточной давности. Конец окна — ЖИВОЙ итог со
    // страницы, а не снимок воркера: тот пишется раз в час и после розыгрыша
    // отстаёт на сумму выплаты, из-за чего дельта и показанный TVL описывали
    // разные моменты.
    const prev = d.prev;
    if (!prev || typeof prev.uluna !== 'number') { el.style.display = 'none'; return; }
    const base = (typeof liveTotal === 'number' && liveTotal > 0)
      ? liveTotal
      : (d.current && d.current.uluna);
    if (typeof base !== 'number') { el.style.display = 'none'; return; }

    const deltaUluna = base - prev.uluna;
    // Фактическое окно, а не константа: при пропущенном снимке подпись
    // скажет 25h вместо того, чтобы соврать про сутки.
    const hours = Math.max(1, Math.round((Date.now() - prev.ts) / 3_600_000));
    const lunc = deltaUluna / 1_000_000;
    const up = deltaUluna >= 0;
    const color = up ? '#66ffaa' : '#ff8a7a';
    const sign  = up ? '+' : '−';
    const mag   = Math.abs(lunc);
    const val   = mag >= 1_000_000 ? (mag/1_000_000).toFixed(2)+'M'
                : mag >= 1_000     ? (mag/1_000).toFixed(1)+'K'
                : Math.round(mag).toString();
    // Треугольник, а не стрелка. В списке транзакций стрелки означают
    // направление движения денег (приход рисуется ВНИЗ), здесь — рост или
    // падение. Одинаковые фигуры с противоположной логикой на одном экране
    // читались как ошибка.
    const arr = up
      ? '<path d="M12 5.5 20.5 19h-17z"/>'
      : '<path d="M12 18.5 3.5 5h17z"/>';
    el.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:5px;color:' + color + ';">' +
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="' + color + '" stroke="none">' + arr + '</svg>' +
      sign + val + ' LUNC' +
      '</span>' +
      '<span style="color:var(--muted);font-weight:600;margin-left:6px;">' + hours + 'h</span>';
    el.style.display = 'block';
  } catch (e) {
    el.style.display = 'none';
  }
}

function showPage_treasury(e, _unused, skipHistory) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  const pg = document.getElementById('page-treasury');
  if (pg) pg.classList.add('active');
  if (!skipHistory && history.pushState) history.pushState({ page: 'treasury' }, '', '/treasury');
  try { sessionStorage.setItem('currentPage', 'treasury'); } catch(e) {}
  if (typeof smoothScrollTop==='function') smoothScrollTop();
  loadTreasuryData();
  tStartCountdowns();
}
