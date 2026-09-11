// ─── LCD FETCH ──────────────────────────────────────────────────────────────
async function lcdFetch(path) {
  for (const base of LCD_NODES) {
    try {
      const r = await Promise.race([
        fetch(base + path),
        new Promise((_, rej) => setTimeout(() => rej(), 6000))
      ]);
      if (r && r.ok) return await r.json();
    } catch {}
  }
  return null;
}

// ─── PRICE FETCH ────────────────────────────────────────────────────────────
// Routed through the Draw Worker proxy - CryptoCompare's public API started
// returning 401/CORS-blocked for direct browser requests from this domain.
// Cloudflare → CryptoCompare is a server-to-server call (not subject to
// browser CORS), with CoinGecko as an automatic fallback worker-side.
async function fetchPrices() {
  try {
    const r = await fetch(`${DRAW_WORKER}/lunc-price`);
    const d = await r.json();
    luncPrice = d?.LUNC || 0;
    ustcPrice = d?.USTC || 0;
  } catch {}
}

// ─── FETCH TICKETS FROM BLOCKCHAIN ──────────────────────────────────────────
async function fetchTickets(wallet, isDaily) {
  const cutoff = isDaily
    ? Math.floor(Date.now()/1000) - 86400
    : Math.floor(Date.now()/1000) - 7 * 86400;

  const tickets = [];
  const LCD_BASE = 'https://terra-classic-lcd.publicnode.com';

  try {
    let offset = 0;
    const limit = 50;
    while (true) {
      // LCD returns txs[] (bodies) + tx_responses[] (metadata with timestamp)  parallel arrays
      const url = `${LCD_BASE}/cosmos/tx/v1beta1/txs?events=transfer.recipient=%27${wallet}%27&pagination.limit=${limit}&order_by=2&pagination.offset=${offset}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) break;
      const data = await res.json();
      const txBodies    = data.txs || [];
      const txResponses = data.tx_responses || [];
      const count = Math.max(txBodies.length, txResponses.length);
      if (!count) break;

      let done = false;
      for (let idx = 0; idx < count; idx++) {
        const txBody = txBodies[idx];
        const txMeta = txResponses[idx];

        // Get timestamp from tx_response
        const timeStr = txMeta?.timestamp || '';
        const ts = timeStr ? Math.floor(new Date(timeStr).getTime() / 1000) : 0;
        if (ts < cutoff) { done = true; break; }

        // Get sender and amount from body.messages
        const msgs = txBody?.body?.messages || [];
        let fromAddr = null;
        let receivedUluna = 0;

        for (const msg of msgs) {
          const type = msg['@type'] || '';
          if (!type.includes('MsgSend')) continue;
          if ((msg.to_address || '') !== wallet) continue;
          fromAddr = msg.from_address || null;
          const coins = msg.amount || [];
          const lunc = coins.find(c => c.denom === 'uluna');
          if (lunc) receivedUluna = parseInt(lunc.amount);
        }

        if (!fromAddr || !receivedUluna) continue;

        const luncReceived = receivedUluna / 1e6;
        const grossLunc    = luncReceived / 0.995; // reverse 0.5% tax

        // Strict tier match  skip non-NFT payments (Q&A=100k, Chat=5k)
        const tiers = window.NFT_TIERS || (typeof NFT_TIERS !== 'undefined' ? NFT_TIERS : null);
        let entries = 0;
        if (tiers) {
          if (Math.abs(grossLunc - tiers.legendary.lunc) < tiers.legendary.lunc * 0.02) entries = tiers.legendary.entries;
          else if (Math.abs(grossLunc - tiers.rare.lunc) < tiers.rare.lunc * 0.02) entries = tiers.rare.entries;
          else if (Math.abs(grossLunc - tiers.common.lunc) < tiers.common.lunc * 0.02) entries = tiers.common.entries;
        }
        if (entries === 0) continue;

        const txhash = txMeta?.txhash || '';
        for (let i = 0; i < entries; i++) {
          tickets.push({ address: fromAddr, txhash, time: ts, entries, nft: i === 0 ? 1 : 0 });
        }
      }

      if (done || count < limit) break;
      offset += limit;
    }
  } catch(e) {
    console.warn('fetchTickets error:', e);
  }

  return tickets;
}


// ─── ROUND-BASED TICKETS from Worker /round-stats ───────────────────────────
// Source of truth for Daily/Weekly stats: Worker KV (activated NFTs in current round)
// Returns the same shape as fetchTickets() so wheel and stats code works unchanged.
/**
 * Билеты текущего раунда прямо из контракта oracle-pool.
 *
 * Раньше это был запрос к воркеру /round-stats, который вёл собственный учёт
 * в KV со времён офчейн-розыгрыша. После переезда он разошёлся с цепочкой:
 * колесо показывало уже разыгранные входы, а карточка приза - несуществующий
 * пул. Источник истины теперь один - контракт.
 *
 * Текущими считаются входы, которые ещё не забрал ни один расчёт: всё, что
 * идёт после last_entry_id последнего рассчитанного раунда. У пропущенного
 * раунда контракт сдвигает границу назад, поэтому его входы тоже попадут
 * сюда - ровно так, как их посчитает следующий execute_draw.
 */
async function fetchContractRoundTickets(pool) {
  const LCD  = 'https://terra-classic-lcd.publicnode.com';
  const addr = (typeof POOL_CONTRACTS !== 'undefined' && POOL_CONTRACTS[pool]) || '';
  const tickets = [];
  if (!addr) return tickets;

  const ask = async (msg) => {
    const r = await fetch(`${LCD}/cosmwasm/wasm/v1/contract/${addr}/smart/${btoa(JSON.stringify(msg))}`,
                          { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return (await r.json()).data;
  };

  try {
    const cfg = await ask({ config: {} });
    let after = 0;
    const lastSettled = Number(cfg.next_unsettled_id) - 1;
    if (lastSettled >= 1) {
      const r = await ask({ round: { round_id: lastSettled } });
      after = Number(r.last_entry_id || 0);
    }

    // Постранично, но не бесконечно: десять страниц по сто входов с запасом
    // перекрывают любой реальный раунд.
    const raw = [];
    let cursor = after;
    for (let page = 0; page < 10; page++) {
      const res = await ask({ entries: { start_after: cursor, limit: 100 } });
      const list = res.entries || [];
      if (!list.length) break;
      raw.push(...list);
      cursor = Number(list[list.length - 1].entry_id);
      if (list.length < 100) break;
    }

    // Сумма входов по кошельку - её показывает секция колеса
    const byWallet = {};
    for (const { entry } of raw) {
      byWallet[entry.minter] = (byWallet[entry.minter] || 0) + (Number(entry.entries) || 0);
    }

    const mints = [];
    for (const { entry_id, entry } of raw) {
      const n     = Number(entry.entries) || 0;
      const tier  = (/^(common|rare|legendary)/i.exec(entry.token_id || '') || [, 'common'])[1].toLowerCase();
      const timeS = Math.floor(Number(entry.recorded_at || 0) / 1e9) || Math.floor(Date.now() / 1000);
      mints.push({ wallet: entry.minter, tokenId: entry.token_id, tier, entries: n,
                   usedAt: new Date(timeS * 1000).toISOString() });
      for (let i = 0; i < n; i++) {
        tickets.push({
          address:     entry.minter,
          txhash:      `entry:${entry_id}:${i}`,
          time:        timeS,
          entries:     byWallet[entry.minter],
          mintEntries: n,
          tier,
          // Одна единица на вход, а не на билет: карточка считает по этому
          // полю число заминченных NFT в раунде.
          nft:         i === 0 ? 1 : 0,
        });
      }
    }

    window._roundMints        = mints.length ? mints : null;
    window._roundTotalEntries = tickets.length;
  } catch (e) {
    console.warn('fetchContractRoundTickets error:', e.message);
  }
  return tickets;
}

// Старое имя оставлено: его зовут data.js и init.js.
async function fetchRoundStatsAsTickets(pool) {
  return fetchContractRoundTickets(pool);
}

async function _fetchRoundStatsAsTickets_OLD_worker(pool) {
  const DRAW_WORKER = 'https://oracle-draw.vladislav-baydan.workers.dev';
  const tickets = [];
  try {
    const res = await fetch(`${DRAW_WORKER}/round-stats?pool=${pool}&_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      console.warn('round-stats HTTP', res.status);
      return tickets;
    }
    const data = await res.json();

    // Store raw mints for wheel chronological order
    window._roundMints        = data.mints || null;
    window._roundTotalEntries = data.totalEntries || 0;

    const byWallet     = data.byWallet     || {};
    const nftsByWallet = data.nftsByWallet || {};

    // Use mints[] for chronological order + correct tier/entries per mint
    if (data.mints && data.mints.length > 0) {
      for (const mint of data.mints) {
        const addr    = mint.wallet;
        const entries = mint.entries || 1;
        const total   = parseInt(byWallet[addr]) || entries;
        const nftNum  = parseInt(nftsByWallet[addr]) || 1;
        for (let i = 0; i < entries; i++) {
          tickets.push({
            address:     addr,
            txhash:      `mint:${mint.tokenId}:${i}`,
            time:        mint.usedAt ? Math.floor(new Date(mint.usedAt).getTime()/1000) : Math.floor(Date.now()/1000),
            entries:     total,        // total entries for this wallet
            mintEntries: entries,      // entries for THIS specific mint
            tier:        mint.tier || 'common',
            nft:         i < nftNum ? 1 : 0,
          });
        }
      }
    } else {
      // Fallback: byWallet without chronology or tier
      for (const [addr, entryCount] of Object.entries(byWallet)) {
        const n      = parseInt(entryCount) || 0;
        const nftNum = parseInt(nftsByWallet[addr]) || 1;
        for (let i = 0; i < n; i++) {
          tickets.push({
            address:     addr,
            txhash:      `activation:${addr}:${i}`,
            time:        Math.floor(Date.now()/1000),
            entries:     n,
            mintEntries: n,
            tier:        'common',
            nft:         i < nftNum ? 1 : 0,
          });
        }
      }
    }
  } catch(e) {
    console.warn('fetchRoundStatsAsTickets error:', e);
  }
  return tickets;
}


// ─── WEEKLY TICKET PRICE (≈ daily in USTC) ──────────────────────────────────
function weeklyTicketPrice() {
  // Weekly uses same LUNC price as Daily
  return LUNC_PER_TICKET;
}

// ─── LOAD WINNERS FROM winners.json ─────────────────────────────────────────
async function loadWinners() {
  try {
    const r = await fetch('./winners.json?t=' + Date.now());
    if (r.ok) {
      const raw = await r.json();
      let entries = [];

      if (raw && !Array.isArray(raw) && (raw.daily || raw.weekly)) {
        const mapEntry = mapWinnerEntry;   // см. блок WINNERS v2 ниже

        const daily  = (raw.daily  || []).map(function(w,i){ return mapEntry(w,'daily',i);  }).filter(Boolean);
        const weekly = (raw.weekly || []).map(function(w,i){ return mapEntry(w,'weekly',i); }).filter(Boolean);
        entries = daily.concat(weekly).sort(function(a,b){ return (b.time||0)-(a.time||0); });
      } else if (Array.isArray(raw)) {
        entries = raw.filter(function(w){ return !w.skipped && w.winner; });
      }

      winnersData = entries;
    }
  } catch(e) { console.warn('loadWinners:', e); winnersData = []; }
  renderWinners();
  populateDrawVerifySelect();
  // Circuit живёт в воркере, а не в winners.json, и грузится отдельно. Без
  // этого вызова вкладка ALL показывала только daily и weekly до тех пор,
  // пока пользователь не открывал CIRCUIT руками.
  if (typeof loadCircuitWinners === 'function' && !circuitWinnersLoaded) {
    loadCircuitWinners();
  }
}
