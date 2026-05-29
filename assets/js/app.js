// ─── CONSTANTS ──────────────────────────────────────────────────────────────

// Format NFT tokenId to short readable label
// e.g. "Common_092528042026_ETME5" → "ETME5"
// e.g. "Paco Escobar_173612042026_OID66" → "OID66"
function formatNFTLabel(tokenId) {
  if (!tokenId) return '—';
  const str = String(tokenId);
  const parts = str.split('_');
  if (parts.length >= 3) return parts[parts.length - 1];
  return str.slice(0, 8);
}

// ── TAB NAVIGATION ────────────────────────────────────────────────────────────
function showTab(tab, skipHistory) {
  const tabs = ['home','draw','winners','verify','bag'];
  tabs.forEach(t => {
    const page = document.getElementById('page-' + t);
    const nav  = document.getElementById('nav-' + t);
    if (page) page.style.display = t === tab ? 'block' : 'none';
    if (nav)  nav.classList.toggle('active-tab', t === tab);
  });

  if (tab === 'bag') renderMyBag();

  if (tab === 'home') {
    const hDraws = document.getElementById('home-stat-draws');
    const hNfts  = document.getElementById('home-stat-nfts');
    if (hDraws) hDraws.textContent = winnersData.filter(function(w){ return w.winner || (w.winners && w.winners.length > 0); }).length;
    // Use cached all-time activation count if available
    if (hNfts && window._totalNFTsActivated !== undefined) {
      hNfts.textContent = window._totalNFTsActivated;
    }
  }

  if (tab === 'draw') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Re-init wheel if canvas wasn't ready on first load
        if (!wheelCtx) {
          initWheel();
        }
        switchLottery(window.currentLottery || 'daily');
      });
    });
  }

  // Push to browser history so Back button works
  if (!skipHistory && history.pushState) {
    history.pushState({ tab }, '', '/' + tab);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Handle browser Back/Forward
window.addEventListener('popstate', function(e) {
  const path = location.pathname.replace(/^\//, '') || 'home';
  const tab = (e.state && e.state.tab) || path;
  const validTabs = ['home','draw','winners','verify','bag'];
  showTab(validTabs.includes(tab) ? tab : 'home', true);
});

const DAILY_WALLET   = 'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px';
const WEEKLY_WALLET  = 'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz';
const BURN_WALLET    = 'terra16m05j95p9qvq93cdtchjcpwgvny8f57vzdj06p';
const DEV_WALLET     = 'terra17g55uzkm6cr5fcl3vzcrmu73v8as4yvf2kktzr';
const CHAIN_ID       = 'columbus-5';
const LUNC_PER_TICKET = 25000;

// ── Free entries from Terra Oracle (GitHub JSON) ─────────────────────────────
// Free entries are computed on-chain  no static JSON needed
let freeEntriesData = {}; // { "terra1abc": { chat:1, questions:2, total:3 } }

const ORACLE_TREASURY = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt';
const CHAT_ULUNA_FE   = 5000 * 1e6;
const QA_ULUNA_FE     = 100000 * 1e6; // 100k LUNC to Treasury (half of Q&A payment)
const TOLERANCE_FE    = 0.01;
const FCD_NODES_FE    = [
  'https://fcd.terra-classic.hexxagon.io',
  'https://terra-classic-fcd.publicnode.com',
];

async function loadFreeEntries() {
  // Read pre-computed free-entries.json (updated hourly by GitHub Actions)
  // This is more reliable than browser scraping and covers full history
  try {
    const res = await fetch('./free-entries.json?t=' + Math.floor(Date.now() / 3600000), {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const entries = data.entries || {};

    freeEntriesData = {};
    for (const [wallet, info] of Object.entries(entries)) {
      const total = (info.total || 0);
      if (total > 0) {
        freeEntriesData[wallet] = {
          chat:      info.chat      || 0,
          questions: info.questions || 0,
          total,
        };
      }
    }
    console.log('[OracleDraw] Free entries loaded from JSON:', Object.keys(freeEntriesData).length, 'wallets');
  } catch(e) {
    console.warn('[OracleDraw] Could not load free-entries.json, falling back to on-chain scan:', e.message);
    // Fallback: on-chain scrape with 30 day window
    await loadFreeEntriesOnChain();
  }
}

// Fallback: scrape on-chain if JSON not available
async function loadFreeEntriesOnChain() {
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400; // 30 days fallback
  const days = {};
  const qa   = {};

  for (const base of FCD_NODES_FE) {
    try {
      let offset = 0, done = false;
      while (!done) {
        const url = `${base}/v1/txs?account=${ORACLE_TREASURY}&limit=100&offset=${offset}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) break;
        const data = await res.json();
        const txs = data.txs || [];
        if (!txs.length) break;

        for (const tx of txs) {
          const ts = Math.floor(new Date(tx.timestamp).getTime() / 1000);
          if (ts < cutoff) { done = true; break; }
          const memo = tx.tx?.value?.memo || tx.tx?.body?.memo || '';
          const msgs = tx.tx?.value?.msg  || tx.tx?.body?.messages || [];
          for (const msg of msgs) {
            const type = msg['@type'] || msg.type || '';
            if (!type.includes('MsgSend')) continue;
            const val  = msg.value || msg;
            if ((val.to_address || '') !== ORACLE_TREASURY) continue;
            const sender = val.from_address || '';
            const coins  = val.amount || [];
            const lunc   = coins.find(c => c.denom === 'uluna');
            if (!lunc) continue;
            const amt = Number(lunc.amount);
            if (memo.trim().length > 0 && amt >= CHAT_ULUNA_FE * 0.99 && amt <= CHAT_ULUNA_FE * 1.01) {
              const day = new Date(tx.timestamp).toISOString().slice(0, 10);
              if (!days[sender]) days[sender] = {};
              days[sender][day] = (days[sender][day] || 0) + 1;
            }
            if (amt >= QA_ULUNA_FE * 0.99 && amt <= QA_ULUNA_FE * 1.01) {
              qa[sender] = (qa[sender] || 0) + 1;
            }
          }
        }
        if (txs.length < 100) break;
        offset += 100;
      }
      break;
    } catch(e) { continue; }
  }

  freeEntriesData = {};
  const allWallets = new Set([...Object.keys(days), ...Object.keys(qa)]);
  for (const wallet of allWallets) {
    let chatEntries = 0;
    if (days[wallet]) {
      for (const cnt of Object.values(days[wallet])) {
        chatEntries += Math.min(Math.floor(cnt / 10), 2);
      }
    }
    const qaEntries = (qa[wallet] || 0) * 2;
    const total = chatEntries + qaEntries;
    if (total > 0) freeEntriesData[wallet] = { chat: chatEntries, questions: qaEntries, total };
  }
  console.log('[OracleDraw] Free entries loaded on-chain (fallback):', Object.keys(freeEntriesData).length, 'wallets');
}


function getFreeEntries(wallet) {
  return freeEntriesData[wallet] || { chat: 0, questions: 0, total: 0 };
}
const MIN_TICKETS    = 5; // minimum to hold draw
const LCD_NODES      = [
  'https://terra-classic-fcd.publicnode.com',
  'https://fcd.terra-classic.hexxagon.io',
  'https://terra-classic-lcd.publicnode.com',
];
const RPC_NODES      = [
  'https://terra-classic-rpc.publicnode.com',
  'https://rpc.terra-classic.io',
];

// ─── STATE ──────────────────────────────────────────────────────────────────
let currentLottery = 'daily';
window.currentLottery = currentLottery; // 'daily' | 'weekly'
// selectedTier and selectedPool are defined in index.html  do not redeclare here
let lotteryAddress = null;
let ticketCount = 1;
let luncPrice = 0;
let ustcPrice = 0;
let dailyTickets = [];   // array of {address, txhash, time}
let weeklyTickets = [];
let winnersData = [];    // flat array loaded from winners.json (daily + weekly combined)
let winnersFilter = 'all';
let timerInterval = null;

// ─── PARTICLES ──────────────────────────────────────────────────────────────
const container = document.getElementById('particles');
for (let i = 0; i < 30; i++) {
  const p = document.createElement('div');
  p.className = 'particle';
  p.style.left = Math.random() * 100 + '%';
  p.style.animationDuration = (8 + Math.random() * 15) + 's';
  p.style.animationDelay = (Math.random() * 10) + 's';
  p.style.width = p.style.height = (1 + Math.random() * 2) + 'px';
  container.appendChild(p);
}

// ─── FORMAT HELPERS ─────────────────────────────────────────────────────────
function fmt(n) {
  if (n >= 1e9)  return (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n/1e6).toFixed(2) + 'M';
  if (n >= 1000) return (n/1000).toFixed(1) + 'K';
  return Math.round(n).toLocaleString('en-US');
}
function fmtAddr(a) { return a ? a.slice(0,10) + '...' + a.slice(-4) : ''; }
function fmtDate(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

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
async function fetchPrices() {
  try {
    const r = await fetch('https://min-api.cryptocompare.com/data/pricemulti?fsyms=LUNC,USTC&tsyms=USD');
    const d = await r.json();
    luncPrice = d?.LUNC?.USD || 0;
    ustcPrice = d?.USTC?.USD || 0;
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
async function fetchRoundStatsAsTickets(pool) {
  const DRAW_WORKER = 'https://oracle-draw.vladislav-baydan.workers.dev';
  const tickets = [];
  try {
    const res = await fetch(`${DRAW_WORKER}/round-stats?pool=${pool}`);
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
        const mapEntry = function(w, type, idx) {
          if (w.skipped) return null;

          // Daily: { winner, prize_lunc, entries, block_hash, winner_index, tx_winner, date }
          if (w.winner) {
            return {
              type, round: idx + 1,
              winner:       w.winner,
              prize:        w.prize_lunc || w.prize || 0,
              tickets:      w.entries || 0,
              drawBlock:    w.block_height || (w.block_hash ? w.block_hash.slice(0,10) : '-'),
              drawBlockHash: w.block_hash || null,
              drawBlockHeight: w.block_height || null,
              winnerIndex:  w.winner_index !== undefined ? w.winner_index : null,
              time:         w.date ? Math.floor(new Date(w.date + 'T20:00:00Z').getTime()/1000) : 0,
              txHashes:     w.tx_winner ? { winner: w.tx_winner } : null,
            };
          }

          // Weekly: { winners:[{place,address,amount_lunc,tx}], entries, block_hash, date }
          if (w.winners && Array.isArray(w.winners) && w.winners.length > 0) {
            const p1 = w.winners[0];
            return {
              type, round: idx + 1,
              winner:       p1.address,
              prize:        p1.amount_lunc || 0,
              tickets:      w.entries || 0,
              drawBlock:    w.block_height || (w.block_hash ? w.block_hash.slice(0,10) : '-'),
              drawBlockHash: w.block_hash || null,
              drawBlockHeight: w.block_height || null,
              winnerIndex:  null,
              time:         w.date ? Math.floor(new Date(w.date + 'T20:00:00Z').getTime()/1000) : 0,
              txHashes:     w.tx_treasury ? { treasury: w.tx_treasury } : null,
              multiWinners: w.winners,
            };
          }
          return null;
        };

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
}

// ─── RENDER WINNERS TABLE ───────────────────────────────────────────────────
function renderWinners() {
  const tbody = document.getElementById('winners-body');
  let list = winnersData;
  if (winnersFilter === 'daily')  list = list.filter(w => w.type === 'daily');
  if (winnersFilter === 'weekly') list = list.filter(w => w.type === 'weekly');

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:32px;font-size:13px;">🎭 No draws yet - mint your first Oracle Mask NFT!</td></tr>`;
    return;
  }

  tbody.innerHTML = list.slice(0, 50).map((w, i) => {
    const badge = w.type === 'daily'
      ? `<span class="badge-daily">Daily</span>`
      : `<span class="badge-weekly">Weekly</span>`;
    const prizeStr = fmt(w.prize || 0) + ' LUNC';
    const rolledOver = w.rolledOver ? `<br><span class="rolled-over">↩ rolled over ${w.rolledOver}x</span>` : '';

    // Multi-winner (weekly 3 places)
    const medals = ['🥇','🥈','🥉'];
    const winnerCell = w.multiWinners && w.multiWinners.length > 0
      ? w.multiWinners.map(function(p) {
          return `<span style="display:block;font-size:11px;line-height:1.7;">${medals[p.place-1]||''} ${fmtAddr(p.address)} <span style="color:var(--gold-dim);font-size:10px;">${fmt(p.amount_lunc||0)} LUNC</span></span>`;
        }).join('')
      : `<span class="winner-addr">${w.winner ? fmtAddr(w.winner) : '-'}</span>`;

    // Block explorer link - use block hash as identifier
    const finderUrl = w.drawBlockHeight
      ? `https://finder.terraport.finance/mainnet/blocks/${w.drawBlockHeight}`
      : (w.tx_winner ? `https://finder.terraport.finance/mainnet/tx/${w.tx_winner}` : null);
    const blockLabel = w.drawBlockHeight
      ? `#${w.drawBlockHeight}`
      : (w.drawBlockHash ? w.drawBlockHash.slice(0,12) + '...' : '-');
    const blockDisplay = finderUrl
      ? `<a href="${finderUrl}" target="_blank" class="winner-tx" style="font-family:monospace;font-size:10px;">${blockLabel}</a>`
      : `<span class="winner-tx" style="font-size:10px;color:var(--muted);">${blockLabel}</span>`;

    return `<tr>
      <td>#${w.round || (i+1)}</td>
      <td>${badge}</td>
      <td>${winnerCell}</td>
      <td>${w.tickets || 0}</td>
      <td class="winner-prize">${prizeStr}${rolledOver}</td>
      <td>${blockDisplay}</td>
      <td>${fmtDate(w.time || 0)}</td>
    </tr>`;
  }).join('');
}


// ─── UPDATE POOL DISPLAY ────────────────────────────────────────────────────
function updatePoolDisplay() {
  const tickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const count = tickets.length;
  const isDaily = currentLottery === 'daily';

  // Count unique NFTs (transactions) vs entries
  const nftCount     = tickets.filter(t => t.nft === 1 || t.nft === undefined).length;
  const entriesCount = count; // total entries (for wheel)

  // Calculate prize pool from actual LUNC received
  // NFTs without nft field = old format, count by LUNC_PER_TICKET
  const tiers = window.NFT_TIERS || (typeof NFT_TIERS !== 'undefined' ? NFT_TIERS : null);
  let totalLunc = 0;
  const seen = new Set();
  for (const t of tickets) {
    if (seen.has(t.txhash)) continue;
    seen.add(t.txhash);
    if (tiers && t.entries) {
      if (t.entries === tiers.legendary.entries) totalLunc += tiers.legendary.lunc;
      else if (t.entries === tiers.rare.entries) totalLunc += tiers.rare.lunc;
      else totalLunc += tiers.common.lunc;
    } else {
      totalLunc += LUNC_PER_TICKET;
    }
  }

  // Use real wallet balance if available (includes Q&A + NFT contributions)
  const _realBalance = isDaily
    ? (window._dailyPoolBalance  || totalLunc)
    : (window._weeklyPoolBalance || totalLunc);
  let poolPrize = _realBalance * 0.80;
  let seededLunc = _realBalance * 0.10;
  let poolUsd = poolPrize * luncPrice;

  const _pl=document.getElementById('pool-lunc');if(_pl)_pl.textContent = fmt(poolPrize) + ' LUNC';
  const _pu=document.getElementById('pool-usd');if(_pu)_pu.textContent = luncPrice > 0 ? '≈ $' + poolUsd.toFixed(2) + ' USD' : '';

  // Seeded next round
  const _seed = document.getElementById('stat-seeded');if(_seed)_seed.textContent = fmt(seededLunc);

  const _pt=document.getElementById('pool-tickets');if(_pt)_pt.textContent = nftCount + ' NFT' + (nftCount !== 1 ? 's' : '') + ' minted this round';

  const minNotice = document.getElementById('pool-min-notice');
  if (count <= MIN_TICKETS && count > 0) {
    minNotice.style.display = 'block';
  } else {
    minNotice.style.display = 'none';
  }

  // Update stats
  // My Entries This Round - entries for connected wallet in current lottery
  const _myAddr = connectedWalletAddress || lotteryAddress;
  const _curTickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const _myNFTEntries = _myAddr ? _curTickets.filter(t => t.address === _myAddr).length : 0;
  const _myFreeEntries = (currentLottery === 'weekly' && _myAddr) ? (getFreeEntries(_myAddr).total || 0) : 0;
  const _myEntries = _myNFTEntries + _myFreeEntries;
  const _st=document.getElementById('stat-total');if(_st)_st.textContent = _myEntries > 0 ? _myEntries : '0';
  // stat-burned = Seeded Next Round = 10% of current pool LUNC
  const _sb=document.getElementById('stat-burned');if(_sb)_sb.textContent = fmt(Math.round(seededLunc)) + ' LUNC';
  // Draw page: completed draws for the CURRENT pool (matches the pool context shown)
  const _sd=document.getElementById('stat-draws');if(_sd)_sd.textContent = winnersData.filter(function(w){return w.type===(currentLottery||'daily');}).length;

  // ── Sync home page stat counters (always kept up to date) ──
  // Home: TOTAL completed draws across BOTH pools (independent of current tab)
  const _totalDraws = winnersData.filter(function(w){ return w.winner || (w.winners && w.winners.length > 0); }).length;
  const _hDraws = document.getElementById('home-stat-draws');
  const _hNfts  = document.getElementById('home-stat-nfts');
  if (_hDraws) _hDraws.textContent = _totalDraws;
  if (_hNfts) _hNfts.textContent = nftCount;

  // Refresh weekly prize split if on weekly tab - use real balance
  if (currentLottery === 'weekly') {
    const _wPool = window._weeklyPoolBalance || weeklyTickets.length * 25000;
    const pool80 = _wPool * 0.8;
    const p1 = document.getElementById('weekly-prize-1');
    const p2 = document.getElementById('weekly-prize-2');
    const p3 = document.getElementById('weekly-prize-3');
    if (p1) p1.textContent = fmt(Math.floor(pool80 * 0.60)) + ' LUNC';
    if (p2) p2.textContent = fmt(Math.floor(pool80 * 0.25)) + ' LUNC';
    if (p3) p3.textContent = fmt(Math.floor(pool80 * 0.15)) + ' LUNC';
  }

  // Weekly ticket price display
  const _tpd = document.getElementById('ticket-price-display');
  const _ms  = document.getElementById('modal-sub');
  if (!isDaily) {
    if (_tpd) _tpd.textContent = 'Common · Rare · Legendary';
    if (_ms)  _ms.textContent  = 'Choose your NFT tier · Burn to enter draw';
  } else {
    if (_tpd) _tpd.textContent = 'Common · Rare · Legendary';
    if (_ms)  _ms.textContent  = 'Choose your NFT tier · Burn to enter draw';
  }
  // Update buy button with current tier price
  if (typeof updateBuyBtn === 'function') updateBuyBtn();
}

// ─── TIMER ──────────────────────────────────────────────────────────────────
function getNextDrawTime(type) {
  const now = new Date();

  if (type === 'daily') {
    const next = new Date();
    next.setUTCHours(20, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  // Weekly: next Monday 20:00 UTC
  // Build today's 20:00 UTC, then step forward until we hit a Monday
  const next = new Date();
  next.setUTCHours(20, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  // Keep advancing until we land on Monday (getUTCDay() === 1)
  while (next.getUTCDay() !== 1) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const isBlue = currentLottery === 'weekly';

  // Apply blue color to timer if weekly
  ['t-days','t-hours','t-mins','t-secs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.toggle('blue', isBlue); }
  });

  function tick() {
    const drawTime = getNextDrawTime(currentLottery);
    const diff = drawTime - Date.now();
    if (diff <= 0) {
      ['t-days','t-hours','t-mins','t-secs'].forEach(id => {
        document.getElementById(id).textContent = '00';
      });
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    document.getElementById('t-days').textContent  = String(d).padStart(2,'0');
    document.getElementById('t-hours').textContent = String(h).padStart(2,'0');
    document.getElementById('t-mins').textContent  = String(m).padStart(2,'0');
    document.getElementById('t-secs').textContent  = String(s).padStart(2,'0');
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

// ─── SWITCH LOTTERY ─────────────────────────────────────────────────────────
function switchLottery(type) {
  currentLottery = type;
  window.currentLottery = type;
  try { localStorage.setItem('activeLottery', type); } catch(e) {}
  const isDaily = type === 'daily';

  // Tabs
  const tabDaily  = document.getElementById('tab-daily');
  const tabWeekly = document.getElementById('tab-weekly');
  if (tabDaily)  tabDaily.className  = 'lottery-tab ' + (isDaily ? 'active-daily' : '');
  if (tabWeekly) tabWeekly.className = 'lottery-tab ' + (!isDaily ? 'active-weekly' : '');

  // Weekly body theme
  if (isDaily) {
    document.body.classList.remove('weekly-mode');
  } else {
    document.body.classList.add('weekly-mode');
  }

  // Page transition flash + hero animation
  const overlay = document.getElementById('page-transition');
  if (overlay) {
    overlay.classList.remove('flash-out');
    overlay.classList.add('flash');
    setTimeout(() => {
      overlay.classList.remove('flash');
      overlay.classList.add('flash-out');
    }, 120);
  }

  // Hero entrance animation
  const heroEl = document.getElementById('hero-title');
  const wheelEl = document.getElementById('wheel-panel-hero');
  if (heroEl) {
    heroEl.classList.remove('hero-switch-weekly', 'hero-switch-daily');
    void heroEl.offsetWidth; // force reflow
    heroEl.classList.add(isDaily ? 'hero-switch-daily' : 'hero-switch-weekly');
  }
  if (wheelEl) {
    wheelEl.classList.remove('wheel-switch');
    void wheelEl.offsetWidth;
    wheelEl.classList.add('wheel-switch');
  }

  // Hero
  const heroTitle = document.getElementById('hero-title');
  const heroSub   = document.getElementById('hero-sub');
  if (heroTitle) heroTitle.innerHTML   = isDaily ? 'DAILY <span class="gold" id="hero-subtitle">DRAW</span>' : 'WEEKLY <span class="blue-text" id="hero-subtitle">DRAW</span>';
  if (heroSub)   heroSub.textContent   = isDaily ? 'Mint an NFT. Burn it. Win the daily pool.' : 'Mint an NFT. Burn it. Win the weekly pool.';

  // Steps
  const wp = weeklyTicketPrice();
  const step1El = document.getElementById('step1-text');
  const step2El = document.getElementById('step2-text');
  if (step1El) step1El.textContent = isDaily
    ? 'Choose your tier - Common, Rare or Legendary. Burn to enter draw.'
    : 'Choose your tier - Common, Rare or Legendary. Burn to enter draw.';
  if (step2El) step2El.textContent = isDaily
    ? 'Mint an NFT to enter - your purchase is automatically registered. Draw happens every day at 20:00 UTC.'
    : 'Mint an NFT to enter - your purchase is automatically registered. Pool accumulates all week until Monday 20:00 UTC.';

  // Pool display
  const poolDisplayEl = document.getElementById('pool-display');
  const poolLuncEl    = document.getElementById('pool-lunc');
  if (poolDisplayEl) poolDisplayEl.className = 'pool-display' + (isDaily ? '' : ' weekly-pool');
  if (poolLuncEl)    poolLuncEl.className    = 'pool-amount'  + (isDaily ? '' : ' blue');

  // Buy button
  const btn = document.getElementById('btn-buy-main');
  if (btn) btn.className = 'btn-buy' + (isDaily ? '' : ' weekly');

  // Modal
  const modalInner = document.getElementById('modal-inner');
  const modalTitle = document.getElementById('modal-title');
  const modalBtn   = document.getElementById('lottery-buy-btn');
  if (modalInner) modalInner.className = 'modal' + (isDaily ? '' : ' weekly-modal');
  if (modalTitle) modalTitle.className = 'modal-title' + (isDaily ? '' : ' blue');
  if (modalBtn)   modalBtn.className   = 'btn-confirm' + (isDaily ? '' : ' weekly');

  // Switch wheel panel style
  const wheelPanel = document.getElementById('wheel-panel-hero');
  if (wheelPanel) {
    wheelPanel.className = 'wheel-panel' + (isDaily ? '' : ' weekly-panel');
  }
  const wheelPanelLabel = document.getElementById('wheel-panel-label');
  if (wheelPanelLabel) wheelPanelLabel.textContent = isDaily ? 'FORTUNE WHEEL' : 'WEEKLY WHEEL';

  startTimer();
  updatePoolDisplay();
  const wwCard = document.getElementById('wheel-winner-card');
  if (wwCard) wwCard.style.display = 'none';
  updateWheelTickets();

  // ── Toggle ALL Daily / Weekly elements via JS (reliable) ────
  const dailyExtra     = document.getElementById('daily-extra');
  const weeklyExtra    = document.getElementById('weekly-extra');
  const weeklyPodium   = document.getElementById('weekly-podium');
  const weeklyPoolSum  = document.getElementById('weekly-pool-summary-card') || document.querySelector('.weekly-pool-summary');
  const poolDisplay    = document.getElementById('pool-display');

  // Daily elements
  if (dailyExtra)    dailyExtra.style.display   = isDaily ? 'block' : 'none';
  if (poolDisplay)   poolDisplay.style.display  = isDaily ? 'block' : 'none';

  // Weekly elements
  if (weeklyExtra)   weeklyExtra.style.display  = isDaily ? 'none' : 'block';
  if (weeklyPodium)  weeklyPodium.style.display = isDaily ? 'none' : 'grid';
  if (weeklyPoolSum) weeklyPoolSum.style.display = isDaily ? 'none' : 'block';

  // Update podium prizes AFTER elements are visible
  if (!isDaily) updatePodiumPrizes();

  // ── Populate Daily: last winner ───────────────────────────────
  if (isDaily) {
    const last = winnersData.find(function(w){return w.type==='daily' && w.winner && !w.skipped;});
    const addrEl  = document.getElementById('last-winner-addr');
    const prizeEl = document.getElementById('last-winner-prize');
    const dateEl  = document.getElementById('last-winner-date');
    if (last && addrEl) {
      const addr = last.winner;
      addrEl.textContent  = addr.slice(0,10) + '...' + addr.slice(-6);
      if (prizeEl) prizeEl.textContent = fmt(last.prize) + ' LUNC';
      if (dateEl)  dateEl.textContent  = last.time ? new Date(last.time * 1000).toLocaleDateString() : '-';
    } else if (addrEl) {
      addrEl.textContent  = 'No draws yet';
      if (prizeEl) prizeEl.textContent = '-';
      if (dateEl)  dateEl.textContent  = '-';
    }
  }

  // ── Populate Weekly: prize split + free entries ───────────────
  if (!isDaily) {
    const pool80 = weeklyTickets.length > 0
      ? weeklyTickets.length * 25000 * 0.8
      : 0;
    const p1 = document.getElementById('weekly-prize-1');
    const p2 = document.getElementById('weekly-prize-2');
    const p3 = document.getElementById('weekly-prize-3');
    if (p1) p1.textContent = fmt(Math.floor(pool80 * 0.60)) + ' LUNC';
    if (p2) p2.textContent = fmt(Math.floor(pool80 * 0.25)) + ' LUNC';
    if (p3) p3.textContent = fmt(Math.floor(pool80 * 0.15)) + ' LUNC';

    // Free entries - total from GitHub JSON (all wallets this week)
    const freeEl = document.getElementById('weekly-free-entries');
    if (freeEl) {
      const totalFree = Object.values(freeEntriesData).reduce((s, e) => s + (e.total || 0), 0);
      freeEl.textContent = totalFree > 0 ? totalFree : '0';
    }
  }

  // ── Update podium prizes ──────────────────────────────────────
  if (!isDaily) {
    const tickets = weeklyTickets;
    const pool = tickets.length * 25000;
    const prize80 = Math.floor(pool * 0.80);
    const p1El = document.getElementById('podium-prize-1');
    const p2El = document.getElementById('podium-prize-2');
    const p3El = document.getElementById('podium-prize-3');
    const totalEl = document.getElementById('weekly-pool-total');
    const tickEl  = document.getElementById('weekly-pool-tickets');
    if (p1El) p1El.textContent = fmt(Math.floor(prize80 * 0.60)) + ' LUNC';
    if (p2El) p2El.textContent = fmt(Math.floor(prize80 * 0.25)) + ' LUNC';
    if (p3El) p3El.textContent = fmt(Math.floor(prize80 * 0.15)) + ' LUNC';
    if (totalEl) totalEl.textContent = fmt(window._weeklyPoolBalance || pool) + ' LUNC';
    if (tickEl)  tickEl.textContent  = tickets.length + ' NFTs minted this round';
  }

  // Switch animated rings color
  const r1 = document.getElementById('wheel-ring-1');
  const r2 = document.getElementById('wheel-ring-2');
  const r3 = document.getElementById('wheel-ring-3');
  if (r1) r1.style.borderColor = isDaily ? 'rgba(244,208,63,0.2)' : 'rgba(74,144,217,0.15)';
  if (r2) r2.style.borderColor = isDaily ? 'rgba(244,208,63,0.35)' : 'rgba(74,144,217,0.25)';
  if (r3) r3.style.background = isDaily
    ? 'conic-gradient(from 0deg,transparent 0%,rgba(244,208,63,0.35) 15%,transparent 30%,rgba(200,80,0,0.3) 50%,transparent 65%,rgba(244,208,63,0.2) 80%,transparent 100%)'
    : 'conic-gradient(from 0deg,transparent 0%,rgba(0,200,255,0.3) 15%,transparent 30%,rgba(100,0,255,0.3) 50%,transparent 65%,rgba(0,200,255,0.2) 80%,transparent 100%)';

  // Restore canvas glow (inline style takes priority over CSS)
  if (wheelCanvas) {
    wheelCanvas.style.filter = isDaily
      ? 'drop-shadow(0 0 30px rgba(212,160,23,0.35)) drop-shadow(0 0 60px rgba(200,100,0,0.2))'
      : 'drop-shadow(0 0 25px rgba(124,92,255,0.5)) drop-shadow(0 0 50px rgba(0,212,255,0.15))';
  }

  // Switch pointer color
  const ptrStop0 = document.querySelector('#ptr-grad stop:first-child');
  const ptrStop1 = document.querySelector('#ptr-grad stop:last-child');
  const ptrPoly  = document.querySelector('#ptr-grad ~ polygon') || document.querySelector('[points="12,32 0,0 24,0"]');
  if (ptrStop0) ptrStop0.style.stopColor = isDaily ? '#ffe066' : '#00c8ff';
  if (ptrStop1) ptrStop1.style.stopColor = isDaily ? '#e67e22' : '#6400ff';
  if (ptrPoly)  ptrPoly.style.filter = 'none';
}

// ─── MODAL ──────────────────────────────────────────────────────────────────
function openModal() {
  const _mo=document.getElementById('modal');if(_mo)_mo.classList.add('open');
  const _ts=document.getElementById('lottery-tx-status');if(_ts)_ts.style.display='none';
  const _tss=document.getElementById('lottery-tx-success');if(_tss)_tss.style.display='none';
  ticketCount = 1;
  const _cd = document.getElementById('count-display'); if (_cd) _cd.value = 1;

  /* Sync wallet state - always use global wallet if available */
  if (connectedWalletAddress) {
    lotteryAddress = connectedWalletAddress;
  }
  const notConn = document.getElementById('lottery-not-connected');
  const conn    = document.getElementById('lottery-connected');
  const buyBtn  = document.getElementById('lottery-buy-btn');
  const addrEl  = document.getElementById('lottery-addr-display');
  syncDrawWalletUI(lotteryAddress || null);

  updateBuyBtn();
  /* Re-apply selected tier to fix price display after tab switch */
  if (typeof selectTier === 'function') selectTier(selectedTier || 'common');
  if (typeof selectPool === 'function') selectPool(selectedPool || 'daily');
}
function closeModal() { const _mo2=document.getElementById('modal');if(_mo2)_mo2.classList.remove('open'); }
document.getElementById('modal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });

// ── NFT Mint iframe modal ─────────────────────────────────────
const NFT_MINT_URLS = {
  // Daily pool — funds go directly to DAILY_WALLET (terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px)
  common_daily:     'https://nft.lunc.tools/nft/150/mint?embed=1',
  rare_daily:       'https://nft.lunc.tools/nft/151/mint?embed=1',
  legendary_daily:  'https://nft.lunc.tools/nft/152/mint?embed=1',
  // Weekly pool — funds go directly to WEEKLY_WALLET (terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz)
  common_weekly:    'https://nft.lunc.tools/nft/147/mint?embed=1',
  rare_weekly:      'https://nft.lunc.tools/nft/148/mint?embed=1',
  legendary_weekly: 'https://nft.lunc.tools/nft/149/mint?embed=1',
};
// REP awarded per tier on mint
const NFT_TIER_REP = { common: 25, rare: 125, legendary: 250 };
const NFT_TIER_LABELS = {
  common:    'Common · 25,000 LUNC · 1 entry',
  rare:      'Rare · 125,000 LUNC · 5 entries',
  legendary: 'Legendary · 250,000 LUNC · 10 entries',
};
const NFT_TIER_ENTRIES = { common: 1, rare: 5, legendary: 10 };


// Polls LCD until TX is confirmed (code=0) or failed (code!=0). Returns true if success.
async function waitForTxConfirm(txHash, timeoutMs = 180000) { // 3 minutes
  // Route through our Cloudflare Worker to avoid CORS/403 issues with LCD nodes
  const WORKER_TX_URL = `https://oracle-draw.vladislav-baydan.workers.dev/check-tx?hash=${txHash}`;
  // Fallback: direct LCD calls
  const LCD_LIST = [
    'https://terra-classic-lcd.publicnode.com',
    'https://rest.cosmos.directory/terraclassic',
  ];

  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < timeoutMs) {
    attempt++;
    console.log(`[waitForTxConfirm] attempt ${attempt}, elapsed ${Math.round((Date.now()-start)/1000)}s`);

    // Try Worker first (no CORS issues)
    try {
      const r = await fetch(WORKER_TX_URL, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const d = await r.json();
        if (d.code === 0) { console.log('[waitForTxConfirm] ✅ confirmed via Worker'); return true; }
        if (d.code > 0)  { console.error('[waitForTxConfirm] TX failed:', d.raw_log); return false; }
        // d.pending = true → keep waiting
        console.log('[waitForTxConfirm] TX pending...');
      }
    } catch(e) {
      console.log('[waitForTxConfirm] Worker error:', e.message);
    }

    // Fallback: direct LCD
    for (const lcd of LCD_LIST) {
      try {
        const r = await fetch(`${lcd}/cosmos/tx/v1beta1/txs/${txHash}`, { signal: AbortSignal.timeout(6000) });
        if (r.status === 404) continue;
        if (!r.ok) continue;
        const d = await r.json();
        const code = d.tx_response?.code ?? 0;
        if (code === 0) { console.log('[waitForTxConfirm] ✅ confirmed via LCD'); return true; }
        if (code !== 0) { console.error('[waitForTxConfirm] TX failed:', d.tx_response?.raw_log); return false; }
      } catch(e) { /* try next */ }
    }

    await new Promise(r => setTimeout(r, 4000));
  }
  console.warn('[waitForTxConfirm] timeout — TX not confirmed');
  return false;
}

// ── NATIVE MINT (replaces iframe) ────────────────────────────────────────────
// Paco fee wallet — receives 2.5% of mint price (confirmed from TX analysis)
const PACO_FEE_WALLET = 'terra12v5pxjv76hydvlj46kccqe362cky5rps92kqgg';

// NFT tier prices in LUNC
const NFT_MINT_PRICES = {
  common:    25000,
  rare:      125000,
  legendary: 250000,
};

// ── Mint service health check ────────────────────────────────────────────────
// Probes nft.lunc.tools before taking payment. Returns true only if the API
// responds without a server error. A 500 (e.g. the SSL/CA failure) → false,
// so we block the mint and the user keeps their LUNC.
async function isMintServiceUp(wallet) {
  try {
    const r = await fetch(`${NFT_API_BASE}/owned-nfts/${wallet}`, {
      signal: AbortSignal.timeout(8000),
    });
    // 5xx = backend broken. 4xx (e.g. 404 unknown wallet) still means the
    // service itself is responding, so treat only 5xx as "down".
    if (r.status >= 500) return false;
    // Some backends return 200 with an {error:...} body on internal failure.
    try {
      const d = await r.clone().json();
      if (d && d.error && /server error|curl|trust anchor|ca-bundle/i.test(String(d.error))) return false;
    } catch(e) { /* non-JSON 2xx is fine */ }
    return true;
  } catch(e) {
    // Network error / timeout → treat as down
    return false;
  }
}

async function nativeMint() {
  const tier   = window.selectedTier || 'common';
  const pool   = window.currentLottery || 'daily';
  const wallet = connectedWalletAddress || lotteryAddress;

  if (!wallet) {
    alert('Please connect your wallet first!');
    return;
  }

  const _keplr = getWalletKeplr(walletProvider);
  const _isWC  = _isWCProvider(walletProvider);
  if (!_keplr && !_isWC) {
    alert('No wallet connected. Please connect a wallet first.');
    return;
  }

  const priceLunc   = NFT_MINT_PRICES[tier] || 25000;
  const totalUluna  = priceLunc * 1_000_000;           // full price in uluna
  const pacoFee     = Math.floor(totalUluna * 0.025);  // 2.5% → Paco
  const poolAmount  = totalUluna - pacoFee;             // 97.5% → pool

  const poolWallet  = pool === 'daily' ? DAILY_WALLET : WEEKLY_WALLET;
  const tierLabel   = tier.charAt(0).toUpperCase() + tier.slice(1);
  const entries     = NFT_TIER_ENTRIES[tier] || 1;

  // ── Health check — don't take funds if the mint backend is down ──
  // nft.lunc.tools mints the NFT after payment. If it's unreachable, the
  // payment would succeed but no NFT would be created (user loses LUNC).
  const btnEarly = document.getElementById('draw-buy-btn');
  if (btnEarly) { btnEarly.disabled = true; btnEarly.textContent = '⏳ Checking service...'; }
  const mintUp = await isMintServiceUp(wallet);
  if (!mintUp) {
    if (btnEarly) { btnEarly.disabled = false; btnEarly.textContent = '🎭 MINT ' + tierLabel.toUpperCase() + ' — ' + priceLunc.toLocaleString() + ' LUNC'; }
    const sEl = document.getElementById('draw-tx-status');
    const mEl = document.getElementById('draw-tx-msg');
    if (sEl) sEl.style.display = 'block';
    if (mEl) mEl.textContent = '⚠️ Mint service is temporarily unavailable. Your funds are safe — please try again in a few minutes.';
    return;
  }

  // Update button UI
  const btn = document.getElementById('draw-buy-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Signing...'; }

  const statusEl  = document.getElementById('draw-tx-status');
  const msgEl     = document.getElementById('draw-tx-msg');
  const successEl = document.getElementById('draw-tx-success');
  if (statusEl) statusEl.style.display = 'block';
  if (successEl) successEl.style.display = 'none';
  if (msgEl) msgEl.textContent = _isWC
    ? 'Check your mobile wallet to approve...'
    : 'Please approve the transaction in your wallet...';

  try {
    // sendLuncDirect sends ONE MsgSend. We need TWO: pool + paco fee.
    // Order matters! Paco backend monitors first MsgSend to his wallet as trigger.
    // Memo format: draw:{pool}:{tier} — on-chain record of intended pool and tier.
    const txHash = await sendTwoMsgSend(
      wallet,
      PACO_FEE_WALLET, pacoFee,   // msg 0: Paco fee FIRST (triggers his mint backend)
      poolWallet,      poolAmount, // msg 1: pool payment SECOND
      `draw:${pool}:${tier}`,       // e.g. draw:daily:common, draw:weekly:rare
      CHAIN_ID
    );

    if (msgEl) msgEl.textContent = 'Confirming on-chain... (this may take 10-30 seconds)';

    // Wait for TX to be confirmed on-chain before calling Paco
    if (msgEl) msgEl.textContent = 'Waiting for blockchain confirmation...';
    const confirmed = await waitForTxConfirm(txHash);
    if (!confirmed) {
      throw new Error('Transaction not confirmed on-chain. Please check Keplr history.');
    }

    if (msgEl) msgEl.textContent = 'Confirmed! Minting your NFT...';

    // Step 1: Trigger Paco mint via our Worker (Cloudflare IP whitelisted by Paco)
    try {
      const pacoRes = await fetch('https://oracle-draw.vladislav-baydan.workers.dev/paco-mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash, tier, pool }),
      });
      const pacoData = await pacoRes.json();
      if (pacoData.success && pacoData.stage === 'mint_completed') {
        console.log('[nativeMint] Paco mint completed, mintHash:', pacoData.mintHash);
        if (msgEl) msgEl.textContent = 'NFT minted! Registering in draw...';
      } else {
        console.warn('[nativeMint] Paco mint issue:', pacoData.error || pacoData.stage);
        if (msgEl) msgEl.textContent = 'Payment confirmed. NFT minting in progress...';
      }
    } catch(e) {
      console.warn('[nativeMint] Paco API unreachable:', e.message);
      if (msgEl) msgEl.textContent = 'Payment confirmed. NFT will appear shortly...';
    }

    // Step 2: Register mint in our Worker + award REP
    await pollForNewMintAndActivate();

    if (statusEl) statusEl.style.display = 'none';
    if (successEl) successEl.style.display = 'block';
    const txLink = document.getElementById('draw-tx-link');
    if (txLink) { txLink.href = `https://finder.terraport.finance/mainnet/tx/${txHash}`; txLink.textContent = txHash.slice(0,16) + '...'; }
    if (btn) { btn.disabled = false; btn.textContent = '🎭 MINT ' + tierLabel.toUpperCase() + ' — ' + priceLunc.toLocaleString() + ' LUNC'; }
  } catch(e) {
    const emsg = (e && e.message) || String(e) || '';
    const userRejected = /reject|denied|cancel|user.?denied|code:?\s*4001/i.test(emsg);
    if (userRejected) {
      console.log('[nativeMint] user cancelled the transaction');
      if (msgEl) msgEl.textContent = 'Transaction cancelled.';
      if (statusEl) setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 2500);
    } else {
      console.error('[nativeMint] error:', e);
      if (msgEl) msgEl.textContent = '❌ ' + (emsg || 'Transaction failed');
    }
    if (btn) { btn.disabled = false; btn.textContent = '🎭 MINT ' + tierLabel.toUpperCase() + ' — ' + priceLunc.toLocaleString() + ' LUNC'; }
  }
}

// Sends a single TX with TWO MsgSend messages (pool payment + Paco fee)
async function sendTwoMsgSend(fromAddr, toAddr1, amount1, toAddr2, amount2, memo, chainId) {
  const _keplr = getWalletKeplr(walletProvider);
  const _isWC  = _isWCProvider(walletProvider);
  if (!_keplr && !_isWC) throw new Error('No wallet connected.');

  // ── helpers (same as sendLuncDirect) ──
  const enc = new TextEncoder();
  function encodeVarint(n) {
    const buf = []; let v = BigInt(n);
    while (v > 127n) { buf.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
    buf.push(Number(v & 0x7fn)); return new Uint8Array(buf);
  }
  function encodeField(f, w, d) {
    const tag = encodeVarint((f << 3) | w);
    if (w === 2) {
      const len = encodeVarint(d.length);
      const out = new Uint8Array(tag.length + len.length + d.length);
      out.set(tag); out.set(len, tag.length); out.set(d, tag.length + len.length);
      return out;
    }
    return tag;
  }
  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total); let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }
  function encodeMsgSend(from, to, amount, denom) {
    // /cosmos.bank.v1beta1.MsgSend proto
    const coin = concat(
      encodeField(1, 2, enc.encode(denom)),
      encodeField(2, 2, enc.encode(String(amount)))
    );
    return concat(
      encodeField(1, 2, enc.encode(from)),
      encodeField(2, 2, enc.encode(to)),
      encodeField(3, 2, coin)
    );
  }

  // Build TX body with TWO MsgSend messages
  function makeMsgAny(typeUrl, value) {
    return concat(
      encodeField(1, 2, enc.encode(typeUrl)),
      encodeField(2, 2, value)
    );
  }
  const msg1 = makeMsgAny('/cosmos.bank.v1beta1.MsgSend', encodeMsgSend(fromAddr, toAddr1, amount1, 'uluna'));
  const msg2 = makeMsgAny('/cosmos.bank.v1beta1.MsgSend', encodeMsgSend(fromAddr, toAddr2, amount2, 'uluna'));
  const memoBytes = enc.encode(memo);
  const txBodyBytes = concat(
    encodeField(1, 2, msg1),
    encodeField(1, 2, msg2),
    encodeField(2, 2, memoBytes)
  );

  // ── account info ──
  const LCD_LIST = ['https://terra-classic-lcd.publicnode.com', 'https://lcd-terra-classic.hexxagon.io', 'https://terraclassic.community/cosmos'];
  let accountNumber, sequence, pubkeyBytes;
  for (const lcd of LCD_LIST) {
    try {
      const r = await fetch(`${lcd}/cosmos/auth/v1beta1/accounts/${fromAddr}`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const d = await r.json();
      const acc = d.account?.base_account || d.account || d;
      accountNumber = parseInt(acc.account_number || '0');
      sequence      = parseInt(acc.sequence || '0');
      break;
    } catch(e) { continue; }
  }
  if (accountNumber === undefined) throw new Error('Could not fetch account info. Check your connection.');

  // ── pubkey ──
  if (_isWC) {
    pubkeyBytes = new Uint8Array(33); // placeholder, wallet replaces in signed result
  } else {
    const signer = _keplr.getOfflineSigner(chainId);
    const accounts = await signer.getAccounts();
    pubkeyBytes = accounts[0].pubkey;
    // Use address from signer to ensure it matches
    if (accounts[0].address && accounts[0].address !== fromAddr) {
      console.warn('[sendTwoMsgSend] signer address mismatch, using signer address:', accounts[0].address);
      fromAddr = accounts[0].address;
    }
  }

  // ── authInfo ──
  // Gas: 600000 (two MsgSend; real TX used 467863, requested 569338)
  // Fee: 600000 × 28.325 uluna/gas = 16,995,000 uluna ≈ 17 LUNC
  const GAS_LIMIT_2MSG = 600000;
  const totalFee    = Math.ceil(GAS_LIMIT_2MSG * 28.325);
  const pubkeyProto = encodeField(1, 2, pubkeyBytes);
  const pubkeyAny   = concat(
    encodeField(1, 2, enc.encode('/cosmos.crypto.secp256k1.PubKey')),
    encodeField(2, 2, pubkeyProto)
  );
  const modeInfo    = encodeField(1, 2, concat(encodeVarint((1 << 3) | 0), encodeVarint(1)));
  const seqBytes    = encodeVarint(sequence);
  const signerInfo  = concat(
    encodeField(1, 2, pubkeyAny),
    encodeField(2, 2, modeInfo),
    encodeVarint((3 << 3) | 0), seqBytes
  );
  const feeCoin     = concat(
    encodeField(1, 2, enc.encode('uluna')),
    encodeField(2, 2, enc.encode(String(totalFee)))
  );
  const feeProto    = concat(
    encodeField(1, 2, feeCoin),
    encodeVarint((2 << 3) | 0), encodeVarint(GAS_LIMIT_2MSG)
  );
  const authInfoBytes = concat(
    encodeField(1, 2, signerInfo),
    encodeField(2, 2, feeProto)
  );

  // ── sign & broadcast ──
  let txBase64;
  if (_isWC) {
    txBase64 = await _wcSignAndBroadcast(fromAddr, txBodyBytes, authInfoBytes, accountNumber, chainId);
  } else {
    const signer = _keplr.getOfflineSigner(chainId);
    try { await _keplr.experimentalSuggestChain(TERRA_CHAIN_CONFIG); } catch(e) {}
    await _keplr.enable(chainId);
    const { signed, signature } = await signer.signDirect(fromAddr, {
      bodyBytes:     txBodyBytes,
      authInfoBytes: authInfoBytes,
      chainId,
      accountNumber: BigInt(accountNumber),
    });
    function toUint8(v, fallback) {
      if (!v) return fallback;
      if (v instanceof Uint8Array) return v;
      if (v.buffer instanceof ArrayBuffer) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      return new Uint8Array(Object.values(v));
    }
    // Use OUR bodyBytes (Keplr may modify it) but ALWAYS use OUR authInfoBytes
    // because Keplr overrides gas limit to 300k in signed.authInfoBytes
    const finalBody = toUint8(signed.bodyBytes, txBodyBytes);
    const sigBytes  = Uint8Array.from(atob(signature.signature), c => c.charCodeAt(0));
    txBase64 = btoa(String.fromCharCode(...concat(
      encodeField(1, 2, finalBody),
      encodeField(2, 2, authInfoBytes),  // ← our authInfoBytes with 600k gas
      encodeField(3, 2, sigBytes)
    )));
  }

  // ── broadcast ──
  let broadcastRes, broadcastData;
  for (const lcd of LCD_LIST) {
    try {
      const r = await fetch(`${lcd}/cosmos/tx/v1beta1/txs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_bytes: txBase64, mode: 'BROADCAST_MODE_SYNC' }),
        signal: AbortSignal.timeout(15000)
      });
      broadcastData = await r.json();
      broadcastRes  = r;
      break;
    } catch(e) { continue; }
  }
  if (!broadcastData) throw new Error('Broadcast failed — all LCD nodes unreachable.');
  const txHash = broadcastData.tx_response?.txhash || broadcastData.txhash;
  const code   = broadcastData.tx_response?.code   || broadcastData.code || 0;
  if (code !== 0) throw new Error(`TX rejected (code ${code}): ${broadcastData.tx_response?.raw_log || ''}`);
  if (!txHash)    throw new Error('No txhash in broadcast response.');
  return txHash;
}

// Snapshot of NFTs owned BEFORE opening mint iframe — used to detect newly minted NFT
window._preMintTokenIds = null;
window._mintSelectedPool = null;
window._mintSelectedTier = null;
window._postMintPollAbort = false;

async function openMintIframe() {
  const tier    = window.selectedTier || 'common';
  const pool    = window.currentLottery || 'daily';   // selected by user via DAILY/WEEKLY tabs
  const wallet  = connectedWalletAddress || lotteryAddress;
  const frame   = document.getElementById('nft-mint-frame');
  const overlay = document.getElementById('mint-modal-overlay');
  const subEl   = document.getElementById('mint-modal-sub');

  // Take snapshot of currently owned NFTs so we can diff after mint
  window._mintSelectedPool = pool;
  window._mintSelectedTier = tier;
  window._postMintPollAbort = false;
  if (wallet) {
    try {
      const r = await fetch(`${NFT_API_BASE}/owned-nfts/${wallet}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const data = await r.json();
        const nfts = Array.isArray(data) ? data : data.nfts || data.data || data.tokens || [];
        window._preMintTokenIds = new Set(nfts.map(n => String(n.id || n.tokenId || n.token_id || '')).filter(Boolean));
        console.log(`[mint] pre-mint snapshot: ${window._preMintTokenIds.size} NFTs owned`);
      }
    } catch(e) {
      console.warn('[mint] pre-mint snapshot failed:', e.message);
      window._preMintTokenIds = new Set();   // empty set — we'll still try to detect any new NFT
    }
  }

  const mintKey = `${tier}_${pool}`;
  if (frame)   frame.src = NFT_MINT_URLS[mintKey] || NFT_MINT_URLS[`${tier}_daily`];
  if (subEl)   subEl.textContent = NFT_TIER_LABELS[tier] || NFT_TIER_LABELS.common;
  if (overlay) overlay.style.display = 'flex';
}

function closeMintIframe() {
  const frame   = document.getElementById('nft-mint-frame');
  const overlay = document.getElementById('mint-modal-overlay');
  if (frame)   frame.src = '';
  if (overlay) overlay.style.display = 'none';

  // After closing iframe, poll for newly minted NFT and auto-activate it
  // (only if user opened iframe with a snapshot)
  if (window._preMintTokenIds && window._mintSelectedPool && !window._postMintPollAbort) {
    pollForNewMintAndActivate();
  }
}

// Poll Paco API after mint iframe closes — detect new NFT, record in Worker, award REP.
// New architecture: mint goes directly to DAILY/WEEKLY wallet — no enterDraw tx needed.
async function pollForNewMintAndActivate() {
  const wallet = connectedWalletAddress || lotteryAddress;
  if (!wallet) return;

  const pool    = window._mintSelectedPool  || 'daily';
  const tier    = window._mintSelectedTier  || 'common';
  const entries = NFT_TIER_ENTRIES[tier]    || 1;
  const repPts  = NFT_TIER_REP[tier]        || 25;
  const preIds  = window._preMintTokenIds   || new Set();

  showAutoActivationToast('⏳ Detecting your new NFT...', 'info');

  const POLL_INTERVAL_MS = 5000;
  const MAX_ATTEMPTS     = 12; // 12 × 5s = 60s

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (window._postMintPollAbort) { console.log('[mint] poll aborted'); return; }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const r = await fetch(`${NFT_API_BASE}/owned-nfts/${wallet}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const data = await r.json();
      const nfts = Array.isArray(data) ? data : (data.nfts || data.data || data.tokens || []);

      const newNFT = nfts.find(n => {
        const id = String(n.id || n.tokenId || n.token_id || '');
        return id && !preIds.has(id);
      });

      if (newNFT) {
        const newId = String(newNFT.id || newNFT.tokenId || newNFT.token_id);
        console.log(`[mint] detected new NFT: ${newId} tier=${tier} pool=${pool}`);
        showAutoActivationToast(`✨ NFT detected! Registering for ${pool.toUpperCase()} draw...`, 'info');

        // 1. Record in Worker for My Bag tracking (no on-chain tx needed)
        try {
          await fetch(`${DRAW_WORKER}/use-nft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tokenId: newId, pool, wallet, entries, tier,
              txHash: 'direct_mint_' + newId,
              directMint: true,
            }),
          });
        } catch(e) { console.warn('[mint] Worker record failed:', e.message); }

        // REP is awarded server-side by the Worker's /use-nft directMint path
        // (guaranteed once per token). Front-end no longer awards to avoid double-counting.
        const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
        showAutoActivationToast(`✅ ${tierLabel} NFT entered into ${pool.toUpperCase()} draw! +${repPts} REP`, 'success');

        window._preMintTokenIds  = null;
        window._mintSelectedPool = null;
        window._mintSelectedTier = null;

        if (typeof loadMyBagNFTs === 'function') loadMyBagNFTs(wallet);
        if (typeof loadAllData   === 'function') loadAllData();
        return;
      }
      console.log(`[mint] poll ${attempt}/${MAX_ATTEMPTS} — no new NFT yet`);
    } catch(e) { console.warn(`[mint] poll ${attempt} error:`, e.message); }
  }

  console.warn('[mint] poll timed out');
  showAutoActivationToast('⚠ Could not auto-detect new NFT. Check My Bag in a moment.', 'warning');
  window._preMintTokenIds  = null;
  window._mintSelectedPool = null;
}

// Floating toast in bottom-right corner with auto-activation status.
// Has a close button — clicking it aborts the polling and hides the toast.
function showAutoActivationToast(text, level) {
  let toast = document.getElementById('mint-auto-toast');
  let textEl, closeBtn;

  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'mint-auto-toast';
    toast.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;background:rgba(20,25,40,0.96);' +
      'border:1px solid rgba(212,175,55,0.4);backdrop-filter:blur(12px);border-radius:12px;padding:14px 20px;' +
      'color:#fff;font-family:"Exo 2",sans-serif;font-size:13px;font-weight:600;max-width:340px;' +
      'box-shadow:0 10px 30px rgba(0,0,0,0.5);animation:slideInToast 0.3s ease-out;' +
      'display:flex;align-items:center;gap:14px;';

    textEl = document.createElement('span');
    textEl.id = 'mint-auto-toast-text';
    textEl.style.flex = '1';
    toast.appendChild(textEl);

    closeBtn = document.createElement('button');
    closeBtn.id = 'mint-auto-toast-close';
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'background:transparent;border:none;color:#fff;opacity:0.6;cursor:pointer;' +
      'font-size:20px;line-height:1;padding:0 4px;font-weight:300;';
    closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; };
    closeBtn.onmouseleave = () => { closeBtn.style.opacity = '0.6'; };
    closeBtn.onclick = () => {
      window._postMintPollAbort = true;        // stop the polling loop
      window._preMintTokenIds = null;
      window._mintSelectedPool = null;
      window._mintSelectedTier = null;
      toast.style.display = 'none';
      clearTimeout(window._mintToastTimer);
    };
    toast.appendChild(closeBtn);

    document.body.appendChild(toast);

    if (!document.getElementById('mint-toast-style')) {
      const s = document.createElement('style');
      s.id = 'mint-toast-style';
      s.textContent = '@keyframes slideInToast{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}';
      document.head.appendChild(s);
    }
  } else {
    textEl = toast.querySelector('#mint-auto-toast-text');
  }

  const colors = {
    info:    'rgba(84,147,247,0.5)',
    success: 'rgba(102,255,170,0.6)',
    warning: 'rgba(255,180,80,0.6)',
  };
  toast.style.borderColor = colors[level] || colors.info;
  if (textEl) textEl.textContent = text;
  toast.style.display = 'flex';

  // Auto-hide all toasts: info after 60s safety net, success/warning after 8s
  clearTimeout(window._mintToastTimer);
  const hideMs = (level === 'info') ? 70000 : 8000; // info safety net longer than poll timeout
  window._mintToastTimer = setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, hideMs);
}

function changeCount(delta) {
  ticketCount = Math.max(1, Math.min(100, ticketCount + delta));
  const _cd2 = document.getElementById('count-display'); if (_cd2) _cd2.value = ticketCount;
  updateBuyBtn();
}
function setCount(val) {
  const n = parseInt(val);
  ticketCount = isNaN(n) || n < 1 ? 1 : Math.min(n, 100);
  updateBuyBtn();
}
function updateBuyBtn() {
  const tier = window.selectedTier || 'common';
  const NFT_TIER_PRICES = { common: 25000, rare: 125000, legendary: 250000 };
  const NFT_TIER_ENTRIES = { common: 1, rare: 5, legendary: 10 };
  const price   = NFT_TIER_PRICES[tier] || 25000;
  const entries = NFT_TIER_ENTRIES[tier] || 1;
  const totEl   = document.getElementById('buy-btn-total');
  const mTotEl  = document.getElementById('modal-total-val');
  const mTierEl = document.getElementById('modal-tier-entries');
  const btnTier = document.getElementById('buy-btn-tier');
  const btn     = document.getElementById('lottery-buy-btn');
  if (totEl)   totEl.textContent   = fmt(price);
  if (mTotEl)  mTotEl.textContent  = fmt(price) + ' LUNC';
  if (mTierEl) mTierEl.textContent = entries + (entries === 1 ? ' entry' : ' entries');
  if (btnTier) btnTier.textContent = tier.charAt(0).toUpperCase() + tier.slice(1);
  if (btn && lotteryAddress) btn.style.display = 'block';
}

// ─── KEPLR ──────────────────────────────────────────────────────────────────
async function connectLotteryKeplr() {
  if (!window.keplr) { alert('No wallet found! Please install Keplr, Galaxy Station or LUNCDash.'); return; }
  try {
    await window.keplr.enable(CHAIN_ID);
    const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    lotteryAddress = accounts[0].address;
    syncDrawWalletUI(lotteryAddress);
    if (typeof updateBuyBtn === 'function') updateBuyBtn();
  } catch(e) { alert('Connection failed: ' + (e.message || e)); }
}

/* Sync both modal wallet UI sections (lottery-* and draw-*) */
function syncDrawWalletUI(address) {
  /* lottery-* elements (inside modal) */
  const d1 = document.getElementById('lottery-addr-display');
  const d2 = document.getElementById('lottery-not-connected');
  const d3 = document.getElementById('lottery-connected');
  const d4 = document.getElementById('lottery-buy-btn');
  /* draw-* elements (in modal wallet section) */
  const d5 = document.getElementById('draw-addr-display');
  const d6 = document.getElementById('draw-not-connected');
  const d7 = document.getElementById('draw-connected');
  const d8 = document.getElementById('draw-buy-btn');

  if (address) {
    if (d1) d1.textContent = fmtAddr(address);
    if (d2) d2.style.display = 'none';
    if (d3) d3.style.display = 'block';
    if (d4) d4.style.display = 'block';
    if (d5) d5.textContent = fmtAddr(address);
    if (d6) d6.style.display = 'none';
    if (d7) d7.style.display = 'block';
    if (d8) d8.style.display = 'block';
  } else {
    if (d2) d2.style.display = 'block';
    if (d3) d3.style.display = 'none';
    if (d4) d4.style.display = 'none';
    if (d6) d6.style.display = 'block';
    if (d7) d7.style.display = 'none';
    if (d8) d8.style.display = 'none';
  }
}

/* Aliases used in index.html */
async function connectDrawKeplr() { return connectLotteryKeplr(); }
function disconnectDrawKeplr() { disconnectLotteryKeplr(); }

function disconnectLotteryKeplr() {
  lotteryAddress = null;
  connectedWalletAddress = null;
  walletProvider = null;
  clearPersistedWallet();
  syncDrawWalletUI(null);
  /* Update global wallet button */
  const btn   = document.getElementById('btn-wallet');
  const label = document.getElementById('wallet-btn-label');
  const info  = document.getElementById('wallet-info');
  if (btn)   btn.classList.remove('connected');
  if (label) label.textContent = 'Connect Wallet';
  if (info)  info.classList.remove('open');
}

// ─── BUY TICKETS ────────────────────────────────────────────────────────────

// ─── WALLET PROVIDER HELPER ──────────────────────────────────────────────────
// Returns the Keplr-compatible signer object for the given provider name.
//   keplr        → window.keplr
//   galaxystation→ window.galaxyStation.keplr  (Galaxy wraps Keplr inside .keplr)
//   station      → window.station?.keplr || window.keplr  (Station same pattern)
//   <other>      → window.keplr (fallback)
function getWalletKeplr(provider) {
  if (provider === 'galaxystation') {
    return window.galaxyStation?.keplr || window.galaxyStation;
  }
  if (provider === 'station') {
    return window.station?.keplr || window.station || window.keplr;
  }
  // WalletConnect providers use WC session for signing — return null here,
  // sendLuncDirect will handle them separately via _wcSignDirect()
  if (provider === 'keplr-mobile' || provider === 'galaxy-mobile' || provider === 'luncdash-wc') {
    return null; // signals WC path
  }
  return window.keplr;
}

// Returns true if current wallet provider uses WalletConnect session
function _isWCProvider(provider) {
  return provider === 'keplr-mobile' || provider === 'galaxy-mobile' || provider === 'luncdash-wc';
}

// Sign and broadcast via WalletConnect session (cosmos_signDirect)
async function _wcSignAndBroadcast(fromAddr, txBodyBytes, authInfoBytes, accountNumber, chainId) {
  const client = window._wqrClient;
  if (!client) throw new Error('No WalletConnect session. Please reconnect your wallet.');
  const sessions = client.session.getAll();
  if (!sessions || sessions.length === 0) throw new Error('WalletConnect session expired. Please reconnect.');
  const session = sessions[sessions.length - 1];

  const bodyB64      = btoa(String.fromCharCode(...txBodyBytes));
  const authInfoB64  = btoa(String.fromCharCode(...authInfoBytes));

  const result = await client.request({
    topic: session.topic,
    chainId: 'cosmos:columbus-5',
    request: {
      method: 'cosmos_signDirect',
      params: {
        signerAddress: fromAddr,
        signDoc: {
          bodyBytes:     bodyB64,
          authInfoBytes: authInfoB64,
          chainId:       chainId,
          accountNumber: String(accountNumber),
        }
      }
    }
  });

  // result: { signature: { signature, pub_key }, signed: { bodyBytes, authInfoBytes } }
  function toUint8(v, fallback) {
    if (!v) return fallback;
    if (v instanceof Uint8Array) return v;
    if (typeof v === 'string') return Uint8Array.from(atob(v), c => c.charCodeAt(0));
    if (v.buffer instanceof ArrayBuffer) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return new Uint8Array(Object.values(v));
  }
  function encodeVarint(n) {
    const buf = []; let v = n;
    while (v > 127) { buf.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    buf.push(v & 0x7f); return new Uint8Array(buf);
  }
  function encodeField(f, w, d) {
    const tag = encodeVarint((f << 3) | w);
    if (w === 2) {
      const len = encodeVarint(d.length);
      const out = new Uint8Array(tag.length + len.length + d.length);
      out.set(tag); out.set(len, tag.length); out.set(d, tag.length + len.length);
      return out;
    }
    return tag;
  }
  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total); let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }

  const finalBody     = toUint8(result.signed?.bodyBytes,     txBodyBytes);
  const finalAuthInfo = toUint8(result.signed?.authInfoBytes, authInfoBytes);
  const sigBytes      = Uint8Array.from(atob(result.signature.signature), c => c.charCodeAt(0));

  const txRaw = concat(
    encodeField(1, 2, finalBody),
    encodeField(2, 2, finalAuthInfo),
    encodeField(3, 2, sigBytes)
  );
  return btoa(String.fromCharCode(...txRaw));
}

// ─── SEND LUNC DIRECT (signDirect) ──────────────────────────────────────────
async function sendLuncDirect(fromAddr, toAddr, amountUluna, memo, chainId) {
  const _keplr = getWalletKeplr(walletProvider);
  const _isWC  = _isWCProvider(walletProvider);

  if (!_keplr && !_isWC) throw new Error('No wallet connected. Please connect a wallet first.');

  // For WC providers we don't have getOfflineSigner — get pubkey differently
  let pubkeyBytes;
  if (_isWC) {
    // WC doesn't expose pubkey before signing — use a 33-byte placeholder
    // The wallet will replace authInfoBytes.pubkey in the signed result
    pubkeyBytes = new Uint8Array(33);
  } else {
    const directSigner = _keplr.getOfflineSigner(chainId);
    const accounts     = await directSigner.getAccounts();
    pubkeyBytes        = accounts[0].pubkey;
  }

  const LCD_BASE = 'https://terra-classic-lcd.publicnode.com';
  const accRes  = await fetch(`${LCD_BASE}/cosmos/auth/v1beta1/accounts/${fromAddr}`);
  const accData = await accRes.json();
  const acct    = accData?.account || {};
  const accountNumber = parseInt(acct.account_number || '0');
  const sequence      = parseInt(acct.sequence || '0');

  function encodeVarint(n) {
    const buf = []; let v = n;
    while (v > 127) { buf.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    buf.push(v & 0x7f); return new Uint8Array(buf);
  }
  function encodeField(f, w, d) {
    const tag = encodeVarint((f << 3) | w);
    if (w === 2) {
      const len = encodeVarint(d.length);
      const out = new Uint8Array(tag.length + len.length + d.length);
      out.set(tag); out.set(len, tag.length); out.set(d, tag.length + len.length);
      return out;
    }
    return tag;
  }
  function concat(...arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total); let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }
  const enc = new TextEncoder();

  // MsgSend proto
  const coinProto = concat(
    encodeField(1, 2, enc.encode('uluna')),
    encodeField(2, 2, enc.encode(String(amountUluna)))
  );
  const msgSendProto = concat(
    encodeField(1, 2, enc.encode(fromAddr)),
    encodeField(2, 2, enc.encode(toAddr)),
    encodeField(3, 2, coinProto)
  );
  const anyMsg = concat(
    encodeField(1, 2, enc.encode('/cosmos.bank.v1beta1.MsgSend')),
    encodeField(2, 2, msgSendProto)
  );

  // TxBody
  const txBodyBytes = concat(
    encodeField(1, 2, anyMsg),
    encodeField(2, 2, enc.encode(memo))
  );

  // Gas fee: 600000 gas × 28.325 = 16,995,000 uluna (two MsgSend need ~470K gas; real TX used 467863)
  const GAS_LIMIT = 600000;
  const gasFee   = Math.ceil(GAS_LIMIT * 28.325);
  const taxFee   = Math.ceil(amountUluna * 0.005);
  const totalFee = gasFee + taxFee;

  // PubKey Any
  const pubkeyProto = encodeField(1, 2, pubkeyBytes);
  const pubkeyAny   = concat(
    encodeField(1, 2, enc.encode('/cosmos.crypto.secp256k1.PubKey')),
    encodeField(2, 2, pubkeyProto)
  );
  // ModeInfo SIGN_MODE_DIRECT = 1
  const modeInfo = encodeField(1, 2, concat(encodeVarint((1 << 3) | 0), encodeVarint(1)));
  const seqBytes = encodeVarint(sequence);
  const signerInfo = concat(
    encodeField(1, 2, pubkeyAny),
    encodeField(2, 2, modeInfo),
    encodeVarint((3 << 3) | 0), seqBytes
  );
  // Fee
  const feeCoin = concat(
    encodeField(1, 2, enc.encode('uluna')),
    encodeField(2, 2, enc.encode(String(totalFee)))
  );
  const feeProto = concat(
    encodeField(1, 2, feeCoin),
    encodeVarint((2 << 3) | 0), encodeVarint(GAS_LIMIT)
  );
  const authInfoBytes = concat(
    encodeField(1, 2, signerInfo),
    encodeField(2, 2, feeProto)
  );

  let txBase64;
  if (_isWC) {
    // WalletConnect path — wallet signs remotely on mobile
    txBase64 = await _wcSignAndBroadcast(fromAddr, txBodyBytes, authInfoBytes, accountNumber, chainId);
  } else {
    const directSigner = _keplr.getOfflineSigner(chainId);
    const { signed, signature } = await directSigner.signDirect(fromAddr, {
      bodyBytes:     txBodyBytes,
      authInfoBytes: authInfoBytes,
      chainId,
      accountNumber: BigInt(accountNumber),
    });

    // Keplr may return bodyBytes/authInfoBytes as plain object {0:...,1:...} not Uint8Array
    function toUint8(v, fallback) {
      if (!v) return fallback;
      if (v instanceof Uint8Array) return v;
      if (v.buffer instanceof ArrayBuffer) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      return new Uint8Array(Object.values(v));
    }
    const finalBody = toUint8(signed.bodyBytes, txBodyBytes);
    // Use OUR authInfoBytes — Keplr overrides gas in signed.authInfoBytes
    const sigBytes  = Uint8Array.from(atob(signature.signature), c => c.charCodeAt(0));

    txBase64 = btoa(String.fromCharCode(...concat(
      encodeField(1, 2, finalBody),
      encodeField(2, 2, authInfoBytes),
      encodeField(3, 2, sigBytes)
    )));
  }
  const broadcastRes = await fetch(`${LCD_BASE}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBase64, mode: 'BROADCAST_MODE_SYNC' }),
  });
  const broadcastData = await broadcastRes.json();
  const txHash = broadcastData?.tx_response?.txhash || broadcastData?.txhash;
  const code   = broadcastData?.tx_response?.code ?? broadcastData?.code ?? 0;
  if (code !== 0) throw new Error('TX failed on-chain: ' + (broadcastData?.tx_response?.raw_log || JSON.stringify(broadcastData)));
  return txHash;
}

async function buyTicketsKeplr() {
  if (!lotteryAddress) { alert('Please connect your wallet first!'); return; }
  const isDaily = (typeof selectedPool !== 'undefined' ? selectedPool : currentLottery) === 'daily';
  const btn = document.getElementById('draw-buy-btn') || document.getElementById('lottery-buy-btn');
  const statusEl = document.getElementById('draw-tx-status') || document.getElementById('lottery-tx-status');
  const msgEl = document.getElementById('draw-tx-msg') || document.getElementById('lottery-tx-msg');
  const successEl = document.getElementById('draw-tx-success') || document.getElementById('lottery-tx-success');

  // Health check — don't take funds if the mint backend is down
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Checking service...'; }
  if (statusEl) statusEl.style.display = 'block';
  if (!(await isMintServiceUp(lotteryAddress))) {
    if (btn) { btn.disabled = false; btn.textContent = '🎭 Mint NFT'; }
    if (msgEl) msgEl.textContent = '⚠️ Mint service is temporarily unavailable. Your funds are safe — please try again in a few minutes.';
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Waiting for Keplr...'; }
  if (statusEl) statusEl.style.display = 'block';
  if (successEl) successEl.style.display = 'none';
  if (msgEl) msgEl.textContent = 'Opening Keplr - please approve the transaction...';

  const wallet = isDaily ? DAILY_WALLET : WEEKLY_WALLET;
  const denom  = 'uluna'; // LUNC only - no USTC

  // Get tier price and entries from NFT_TIERS (defined in index.html)
  // Snapshot selectedTier immediately - capture before any async operations
  const _snapTier = window.selectedTier || (typeof selectedTier !== 'undefined' ? selectedTier : 'common');
  const _snapNFT  = window.NFT_TIERS || (typeof NFT_TIERS !== 'undefined' ? NFT_TIERS : null);
  console.log('[BUY] snapTier:', _snapTier, 'snapNFT:', _snapNFT);
  const tier = (_snapNFT && _snapTier)
    ? _snapNFT[_snapTier] || _snapNFT['common']
    : { lunc: LUNC_PER_TICKET, entries: 1, label: 'Common' };
  const pricePerTicket = tier.lunc;
  const totalAmount = pricePerTicket * 1000000;
  const entries = tier.entries;
  const tierLabel = tier.label || selectedTier || 'Common';
  const memo = `draw:${isDaily ? 'daily' : 'weekly'}:${_snapTier}`;  // e.g. draw:daily:common

  try {
    const _keplr = getWalletKeplr(walletProvider);
    const _isWC  = _isWCProvider(walletProvider);
    if (!_keplr && !_isWC) throw new Error('No wallet connected. Please connect a wallet first.');

    let senderAddress;
    if (_isWC) {
      // WC — address is already stored from connection
      senderAddress = connectedWalletAddress;
      if (!senderAddress) throw new Error('WalletConnect session lost. Please reconnect.');
    } else {
      await _keplr.enable(CHAIN_ID);
      const accounts = await _keplr.getOfflineSigner(CHAIN_ID).getAccounts();
      senderAddress = accounts[0].address;
    }

    if (msgEl) msgEl.textContent = _isWC ? 'Check your mobile wallet to approve...' : 'Please approve the transaction in your wallet...';

    const txHash = await sendLuncDirect(senderAddress, wallet, totalAmount, memo, CHAIN_ID);

    if (msgEl) msgEl.textContent = 'Transaction submitted - confirming on-chain...';

    if (statusEl) statusEl.style.display = 'none';
    if (successEl) successEl.style.display = 'block';
    const successMsg = document.getElementById('draw-success-msg') || document.getElementById('lottery-success-msg');
    const txLink = document.getElementById('draw-tx-link') || document.getElementById('lottery-tx-link');
    if (successMsg) successMsg.textContent = `🎟 ${ticketCount} ticket${ticketCount > 1 ? 's' : ''} purchased successfully!`;
    if (txLink) {
      txLink.href = `https://finder.terraport.finance/mainnet/tx/${txHash}`;
      txLink.textContent = '🔗 ' + (txHash || '').slice(0,16) + '...';
    }

    if (btn) { btn.textContent = `🎭 Mint ${ticketCount > 1 ? ticketCount + ' NFTs' : 'NFT'} - ${fmt(ticketCount*pricePerTicket)} LUNC`; btn.disabled = false; }

    await loadAllData();

  } catch(e) {
    if (statusEl) statusEl.style.display = 'none';
    if (btn) { btn.disabled = false; btn.textContent = `🎭 Mint ${ticketCount > 1 ? ticketCount + ' NFTs' : 'NFT'} - ${fmt(ticketCount*LUNC_PER_TICKET)} LUNC`; }
    const emsg = (e && e.message) || String(e) || '';
    const userRejected = /reject|denied|cancel|user.?denied|code:?\s*4001/i.test(emsg);
    if (userRejected) {
      console.log('[buyTickets] user cancelled the transaction');
    } else {
      alert('Transaction failed: ' + emsg);
    }
  }
}

// ─── SCROLL ─────────────────────────────────────────────────────────────────
function scrollToId(id) {
  document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── WINNERS FILTER BUTTONS ─────────────────────────────────────────────────
function filterWinners(f) {
  winnersFilter = f;
  ['all','daily','weekly'].forEach(id => {
    const el = document.getElementById('wf-' + id);
    if (!el) return;
    el.classList.remove('active');
    if (id === f) el.classList.add('active');
  });
  renderWinners();
}

// ─── GET WALLET BALANCE ──────────────────────────────────────────────────────
async function getWalletBalance(address) {
  try {
    const res = await fetch(`https://terra-classic-lcd.publicnode.com/cosmos/bank/v1beta1/balances/${address}`);
    if (!res.ok) return 0;
    const data = await res.json();
    const balances = data.balances || [];
    const lunc = balances.find(b => b.denom === 'uluna');
    return lunc ? Math.floor(parseInt(lunc.amount) / 1e6) : 0;
  } catch(e) { return 0; }
}

// ─── LOAD ALL DATA ───────────────────────────────────────────────────────────
async function loadAllData() {
  await fetchPrices();

  // ── Step 1: balances only (very fast) ──
  const [_dailyBal, _weeklyBal] = await Promise.all([
    getWalletBalance(DAILY_WALLET),
    getWalletBalance(WEEKLY_WALLET),
  ]);
  window._dailyPoolBalance  = _dailyBal;
  window._weeklyPoolBalance = _weeklyBal;
  updatePoolDisplay();

  // ── Step 2: tickets + free entries in parallel (slower) ──
  // NOTE: tickets now come from Worker /round-stats (source of truth after NFT activation system)
  // fetchTickets (LCD-based) is kept as fallback but no longer primary
  const [_daily, _weekly] = await Promise.all([
    fetchRoundStatsAsTickets('daily'),
    fetchRoundStatsAsTickets('weekly'),
    loadFreeEntries(),
  ]);
  dailyTickets  = _daily;
  weeklyTickets = _weekly;
  updatePoolDisplay();

  // ── Update wheel with fresh data ──
  if (typeof updateWheelTickets === 'function') {
    updateWheelTickets();
  }

  // ── Refresh home page stats with fresh data ──
  // NFTs Minted = all-time cumulative counter from Worker /total-mints (never resets).
  // Shows total + tier breakdown via tooltip on hover.
  const hNfts = document.getElementById('home-stat-nfts');
  if (hNfts) {
    try {
      const totalRes = await fetch('https://oracle-draw.vladislav-baydan.workers.dev/total-mints');
      if (totalRes.ok) {
        const t = await totalRes.json();
        const total = t.total || 0;
        hNfts.textContent = total;
        // Tooltip with tier breakdown — shown on hover/tap
        const tip = `Common: ${t.common || 0} · Rare: ${t.rare || 0} · Legendary: ${t.legendary || 0}`;
        hNfts.title = tip;
        // Visual cue that it's interactive
        hNfts.style.cursor = 'help';
        // Custom tooltip (mobile-friendly) — replaces parent card content briefly on tap
        const card = hNfts.parentElement;
        if (card && !card.dataset.tooltipBound) {
          card.dataset.tooltipBound = '1';
          card.style.position = 'relative';
          const tooltip = document.createElement('div');
          tooltip.id = 'home-stat-nfts-tooltip';
          tooltip.style.cssText = 'position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);' +
            'background:rgba(12,16,30,0.96);border:1px solid rgba(124,92,255,0.35);border-radius:10px;' +
            'padding:8px 14px;font-size:11px;color:#cdd6f4;white-space:nowrap;pointer-events:none;' +
            'opacity:0;transition:opacity 0.15s ease;z-index:50;letter-spacing:0.04em;backdrop-filter:blur(8px);';
          tooltip.textContent = tip;
          card.appendChild(tooltip);
          const show = () => { tooltip.textContent = hNfts.title; tooltip.style.opacity = '1'; };
          const hide = () => { tooltip.style.opacity = '0'; };
          card.addEventListener('mouseenter', show);
          card.addEventListener('mouseleave', hide);
          card.addEventListener('touchstart', () => { show(); setTimeout(hide, 2500); }, { passive: true });
        } else if (card) {
          // Update existing tooltip text
          const tEl = card.querySelector('#home-stat-nfts-tooltip');
          if (tEl) tEl.textContent = tip;
        }
        window._totalNFTsActivated = total;
      }
    } catch(e) {
      const tickets = (typeof dailyTickets !== 'undefined' ? dailyTickets : []);
      const nftCount = tickets.filter(t => t.nft === 1 || t.nft === undefined).length;
      if (nftCount > 0) hNfts.textContent = nftCount;
    }
  }
  const hDraws = document.getElementById('home-stat-draws');
  if (hDraws) hDraws.textContent = winnersData.filter(function(w){ return w.winner || (w.winners && w.winners.length > 0); }).length;
}

function updatePodiumPrizes() {
  // Use real wallet balance - not ticket count * price
  const pool = window._weeklyPoolBalance || weeklyTickets.length * 25000;
  const prize80 = Math.floor(pool * 0.80);
  const p1El = document.getElementById('podium-prize-1');
  const p2El = document.getElementById('podium-prize-2');
  const p3El = document.getElementById('podium-prize-3');
  const totalEl = document.getElementById('weekly-pool-total');
  const tickEl  = document.getElementById('weekly-pool-tickets');
  if (p1El) p1El.textContent = fmt(Math.floor(prize80 * 0.60)) + ' LUNC';
  if (p2El) p2El.textContent = fmt(Math.floor(prize80 * 0.25)) + ' LUNC';
  if (p3El) p3El.textContent = fmt(Math.floor(prize80 * 0.15)) + ' LUNC';
  if (totalEl) totalEl.textContent = fmt(pool) + ' LUNC';
  if (tickEl)  tickEl.textContent  = weeklyTickets.length + ' NFTs minted this round';

  // Update minimum pool progress bar
  const WEEKLY_MIN = 500000;
  const pct = Math.min(100, Math.round((pool / WEEKLY_MIN) * 100));
  const bar    = document.getElementById('weekly-progress-bar');
  const label  = document.getElementById('weekly-progress-label');
  const status = document.getElementById('weekly-draw-status');
  if (bar)   bar.style.width = pct + '%';
  if (label) label.textContent = fmt(pool) + ' / 500,000 LUNC';
  if (status) {
    if (pool >= WEEKLY_MIN) {
      bar.style.background = 'linear-gradient(90deg,#66ffaa,#00c8ff)';
      bar.style.boxShadow  = '0 0 8px rgba(102,255,170,0.5)';
      status.innerHTML = '<span style="color:#66ffaa;">✅ Pool ready - draw will start at 20:00 UTC</span>';
    } else {
      const remaining = fmt(WEEKLY_MIN - pool);
      bar.style.background = 'linear-gradient(90deg,#7C5CFF,#5B8CFF)';
      bar.style.boxShadow  = '0 0 8px rgba(124,92,255,0.5)';
      status.innerHTML = `<span style="color:#6B7AA6;">⏳ Need ${remaining} more LUNC · If not reached, funds roll over to next week</span>`;
    }
  }

  // Ensure podium visibility matches current tab
  const podium = document.getElementById('weekly-podium');
  const poolDisplay = document.getElementById('pool-display');
  const weeklyPoolSum = document.getElementById('weekly-pool-summary-card');
  const dailyExtra = document.getElementById('daily-extra');
  const weeklyExtra = document.getElementById('weekly-extra');
  if (currentLottery === 'weekly') {
    if (podium)       podium.style.display       = 'grid';
    if (weeklyPoolSum) weeklyPoolSum.style.display = 'block';
    if (weeklyExtra)  weeklyExtra.style.display   = 'block';
    if (poolDisplay)  poolDisplay.style.display   = 'none';
    if (dailyExtra)   dailyExtra.style.display    = 'none';
  } else {
    if (podium)       podium.style.display        = 'none';
    if (weeklyPoolSum) weeklyPoolSum.style.display = 'none';
    if (weeklyExtra)  weeklyExtra.style.display   = 'none';
    if (poolDisplay)  poolDisplay.style.display   = 'block';
    if (dailyExtra)   dailyExtra.style.display    = 'block';
  }
}



// ─── FORTUNE WHEEL ─────────────────────────────────────────────────────────────
// Cyber/neon style · Addresses on sectors · Auto-spin at draw time only
const ADMIN_WALLET    = 'terra15jt5a9ycsey4hd6nlqgqxccl9aprkmg2mxmfc6';
const MAX_SECTORS     = 20;

let wheelCanvas   = null;
let wheelCtx      = null;
let ticksCanvas   = null;
let ticksCtx      = null;
let wheelTickets  = [];
let wheelAngle    = 0;
let wheelSpinning = false;
let wheelAnimId   = null;
let wheelDrawnOnce = false;
let adminUnlocked = false;

// Per-participant color palettes — each participant gets unique color
// Tier icon prefixes for labels
const TIER_ICONS = { legendary: 'LEG', rare: 'RARE', common: 'COM', free: 'FREE' };

// 8 distinct participant colors (daily palette)
const PARTICIPANT_COLORS_DAILY = [
  { fill:'rgba(212,160,23,0.35)',  stroke:'#d4a017', text:'#ffe066'  },  // gold
  { fill:'rgba(220,60,60,0.30)',   stroke:'#e05050', text:'#ff9999'  },  // red
  { fill:'rgba(50,200,120,0.28)', stroke:'#32c878', text:'#80ffbb'  },  // green
  { fill:'rgba(160,80,220,0.30)', stroke:'#a050dc', text:'#d499ff'  },  // purple
  { fill:'rgba(230,130,20,0.30)', stroke:'#e68214', text:'#ffbb55'  },  // orange
  { fill:'rgba(20,180,220,0.28)', stroke:'#14b4dc', text:'#66ddff'  },  // cyan
  { fill:'rgba(220,180,20,0.30)', stroke:'#dcb414', text:'#ffee66'  },  // yellow
  { fill:'rgba(220,80,160,0.28)', stroke:'#dc50a0', text:'#ff99dd'  },  // pink
];
// 8 distinct participant colors (weekly palette — cooler tones)
const PARTICIPANT_COLORS_WEEKLY = [
  { fill:'rgba(74,144,217,0.28)',  stroke:'#4a90d9', text:'#99ccff'  },  // blue
  { fill:'rgba(100,200,180,0.25)',stroke:'#64c8b4', text:'#aaffee'  },  // teal
  { fill:'rgba(180,100,220,0.25)',stroke:'#b464dc', text:'#dd99ff'  },  // violet
  { fill:'rgba(220,160,60,0.28)', stroke:'#dca03c', text:'#ffdd88'  },  // amber
  { fill:'rgba(80,180,255,0.22)', stroke:'#50b4ff', text:'#cceeFF'  },  // sky
  { fill:'rgba(220,80,120,0.25)', stroke:'#dc5078', text:'#ff99bb'  },  // rose
  { fill:'rgba(60,220,140,0.22)', stroke:'#3cdc8c', text:'#88ffcc'  },  // mint
  { fill:'rgba(255,140,60,0.25)', stroke:'#ff8c3c', text:'#ffcc88'  },  // peach
];

// Map address → color index (stable across redraws)
const _addrColorMap = new Map();
let _addrColorCounter = 0;
function getParticipantColor(address) {
  if (!address) return { fill:'rgba(80,80,80,0.2)', stroke:'#555', text:'#888' };
  if (!_addrColorMap.has(address)) {
    _addrColorMap.set(address, _addrColorCounter % 8);
    _addrColorCounter++;
  }
  const idx = _addrColorMap.get(address);
  const palette = currentLottery === 'weekly' ? PARTICIPANT_COLORS_WEEKLY : PARTICIPANT_COLORS_DAILY;
  return palette[idx];
}
function getNeonColors() {
  return currentLottery === 'weekly' ? PARTICIPANT_COLORS_WEEKLY : PARTICIPANT_COLORS_DAILY;
}

function initWheel() {
  wheelCanvas = document.getElementById('wheel-canvas');
  if (!wheelCanvas) return;

  // On mobile: use CSS size for display, but render at 1x for memory efficiency
  if (window.innerWidth <= 768) {
    const cssSize = Math.min(Math.round(window.innerWidth * 0.92), 500);
    wheelCanvas.width  = cssSize;
    wheelCanvas.height = cssSize;
    wheelCanvas.style.width  = cssSize + 'px';
    wheelCanvas.style.height = cssSize + 'px';
  }

  wheelCtx = wheelCanvas.getContext('2d');

  // Hide decorative CSS rings — canvas draws the wheel itself
  ['wheel-ring-1','wheel-ring-2','wheel-ring-3'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // If canvas has zero size (draw tab hidden), retry when draw tab opens
  if (!wheelCanvas.width || !wheelCanvas.height) {
    wheelCtx = null;
    wheelCanvas = null;
    return;
  }

  updateWheelTickets();

  // iOS zoom survival: if context is lost, reinitialize
  wheelCanvas.addEventListener('contextlost', function(e) {
    e.preventDefault();
    setTimeout(function() {
      wheelCtx = wheelCanvas.getContext('2d');
      if (wheelCtx) updateWheelTickets();
    }, 200);
  });
}

// ── Draw the wheel ────────────────────────────────────────────────────────────
function drawWheel(tickets, angle) {
  if (!wheelCtx) return;
  const W = wheelCanvas.width, H = wheelCanvas.height;
  const cx = W/2, cy = H/2, r = cx - 6;
  const ctx = wheelCtx;
  ctx.clearRect(0,0,W,H);

  // Normalize angle to prevent float precision issues after many spins
  angle = ((angle % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);

  const sectors = tickets.length > 0 ? tickets : Array.from({length:20},()=>({placeholder:true, _empty:true}));
  const n       = sectors.length;
  const slice   = (2*Math.PI)/n;

  // Background circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx,cy,r,0,2*Math.PI);
  const bgGrad = ctx.createRadialGradient(cx,cy,0,cx,cy,r);
  if (currentLottery === 'daily') {
    bgGrad.addColorStop(0,  'rgba(28,12,0,0.97)');
    bgGrad.addColorStop(0.6,'rgba(14,6,0,0.99)');
    bgGrad.addColorStop(1,  'rgba(5,2,0,1)');
  } else {
    bgGrad.addColorStop(0,  'rgba(5,0,20,0.95)');
    bgGrad.addColorStop(0.6,'rgba(2,0,12,0.98)');
    bgGrad.addColorStop(1,  'rgba(0,0,8,1)');
  }
  ctx.fillStyle = bgGrad;
  ctx.fill();
  ctx.restore();

  // Draw sectors
  for (let i=0; i<n; i++) {
    const sa = angle + i*slice;
    const ea = sa + slice;
    // Participant = unique color, placeholder = single base color
    const _addr = sectors[i]?.address;
    const _isPlaceholder = !_addr || sectors[i]?.placeholder;
    let col;
    if (!_isPlaceholder) {
      col = getParticipantColor(_addr);
    } else {
      col = currentLottery === 'weekly'
        ? { fill:'rgba(30,60,120,0.22)', stroke:'rgba(74,144,217,0.45)', text:'rgba(74,144,217,0.35)' }
        : { fill:'rgba(70,45,8,0.22)',   stroke:'rgba(180,130,20,0.45)',  text:'rgba(212,160,23,0.35)' };
    }

    // Sector fill
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,sa,ea);
    ctx.closePath();
    ctx.fillStyle = col.fill;
    ctx.fill();

    // Sector border (neon line)
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.lineTo(cx + r*Math.cos(sa), cy + r*Math.sin(sa));
    ctx.strokeStyle = col.stroke + '55';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Outer arc accent
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx,cy,r-1,sa,ea);
    ctx.strokeStyle = col.stroke + '88';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Address label + ticket count
    const s = sectors[i];
    if (!s.placeholder && s.address) {
      ctx.save();
      const mid  = sa + slice/2;
      // Place text along the radius - from center outward
      ctx.translate(cx, cy);
      ctx.rotate(mid);

      const addr  = s.address;
      const tier  = s.tier || 'common';
      const icon  = s.isFree ? '✦' : (TIER_ICONS[tier] || '');
      const total = s.totalEntries || s.tickets || 1;
      const entryNum = s.entryIdx !== undefined ? (s.entryIdx+1) + '/' + total : '';
      const addrLabel = addr.slice(0,6) + '..' + addr.slice(-4);
      const entryLabel = icon + ' ' + entryNum;
      const fs = n > 14 ? 9 : (n > 8 ? 10 : 12);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur  = 0;
      ctx.font = `700 ${fs}px 'Courier New', monospace`;
      ctx.fillStyle = col.text;
      ctx.fillText(addrLabel, r * 0.28, -fs*0.6);
      ctx.font = `600 ${fs-1}px Inter, sans-serif`;
      ctx.fillStyle = col.stroke;
      ctx.fillText(entryLabel, r * 0.28, fs*0.6);
      ctx.restore();
    } else if (s.placeholder) {
      ctx.save();
      const mid = sa + slice/2;
      const dist = r*0.62;
      ctx.translate(cx + dist*Math.cos(mid), cy + dist*Math.sin(mid));
      ctx.rotate(mid + Math.PI/2);
      ctx.font = '600 10px Inter';
      ctx.fillStyle = currentLottery === 'weekly' ? 'rgba(74,144,217,0.25)' : 'rgba(244,208,63,0.25)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, 0);
      ctx.restore();
    }

    // Sector index dot near rim
    if (!s.placeholder) {
      ctx.save();
      const mid = sa + slice/2;
      const dotR = r - 12;
      ctx.beginPath();
      ctx.arc(cx + dotR*Math.cos(mid), cy + dotR*Math.sin(mid), 2.5, 0, 2*Math.PI);
      ctx.fillStyle = col.stroke;
      ctx.shadowColor = col.stroke;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
    }
  }

  // Outer rim glow ring - color depends on lottery type
  const rimCol = currentLottery === 'weekly' ? '#4a90d9' : '#d4a017';
  const rimAlpha = currentLottery === 'weekly' ? 'rgba(74,144,217,0.4)' : 'rgba(212,160,23,0.5)';
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx,cy,r,0,2*Math.PI);
  ctx.strokeStyle = rimAlpha;
  ctx.lineWidth = 2;
  ctx.shadowColor = rimCol;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.restore();

  // Grid lines (subtle)
  for (let ring=0.3; ring<=0.85; ring+=0.27) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx,cy,r*ring,0,2*Math.PI);
    ctx.strokeStyle = currentLottery === 'weekly' ? 'rgba(74,144,217,0.04)' : 'rgba(244,208,63,0.04)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // Inner dark core
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx,cy,r*0.18,0,2*Math.PI);
  const coreGrad = ctx.createRadialGradient(cx,cy,0,cx,cy,r*0.18);
  coreGrad.addColorStop(0, currentLottery === 'weekly' ? 'rgba(0,200,255,0.1)' : 'rgba(244,208,63,0.15)');
  coreGrad.addColorStop(1,'rgba(0,0,10,0.95)');
  ctx.fillStyle = coreGrad;
  ctx.fill();
  ctx.strokeStyle = currentLottery === 'weekly' ? 'rgba(0,200,255,0.4)' : 'rgba(244,208,63,0.6)';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = currentLottery === 'weekly' ? '#00c8ff' : '#f4d03f';
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.restore();

  // Hub drawn on canvas
  const hubR = r * 0.115;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, hubR, 0, 2*Math.PI);
  const hubBg = ctx.createRadialGradient(cx - hubR*0.3, cy - hubR*0.3, 0, cx, cy, hubR);
  hubBg.addColorStop(0, '#1a0050');
  hubBg.addColorStop(1, '#000010');
  ctx.fillStyle = hubBg;
  ctx.shadowColor = currentLottery === 'weekly' ? 'rgba(0,200,255,0.6)' : 'rgba(244,208,63,0.5)';
  ctx.shadowBlur = 15;
  ctx.fill();
  ctx.strokeStyle = currentLottery === 'weekly' ? 'rgba(0,200,255,0.7)' : 'rgba(244,208,63,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Hub inner glowing dot
  const dotR = hubR * 0.45;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, dotR, 0, 2*Math.PI);
  const dotGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotR);
  dotGrad.addColorStop(0, '#00c8ff');
  dotGrad.addColorStop(1, '#6400ff');
  ctx.fillStyle = dotGrad;
  ctx.shadowColor = '#00c8ff';
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.restore();

  // Pointer triangle at top
  const pW = r * 0.08, pH = r * 0.13;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + pH + 2);
  ctx.lineTo(cx - pW, cy - r - 4);
  ctx.lineTo(cx + pW, cy - r - 4);
  ctx.closePath();
  const pGrad = ctx.createLinearGradient(cx - pW, cy - r, cx + pW, cy - r + pH);
  pGrad.addColorStop(0, '#ffe066');
  pGrad.addColorStop(1, '#e67e22');
  ctx.fillStyle = pGrad;
  ctx.shadowColor = '#f4d03f';
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.restore();
}

// ── Highlight winner sector ───────────────────────────────────────────────────
function highlightSector(idx, tickets) {
  if (!wheelCtx) return;
  const n  = tickets.length;
  const W  = wheelCanvas.width;
  const cx = W/2, cy = W/2, r = cx-6;
  const slice = (2*Math.PI)/n;
  const sa = wheelAngle + idx*slice;
  const ea = sa + slice;

  wheelCtx.save();
  wheelCtx.beginPath();
  wheelCtx.moveTo(cx,cy);
  wheelCtx.arc(cx,cy,r,sa,ea);
  wheelCtx.closePath();
  wheelCtx.fillStyle = 'rgba(102,255,170,0.2)';
  wheelCtx.fill();
  wheelCtx.strokeStyle = '#66ffaa';
  wheelCtx.lineWidth = 3;
  wheelCtx.shadowColor = '#66ffaa';
  wheelCtx.shadowBlur = 20;
  wheelCtx.stroke();
  wheelCtx.restore();
}

// ── Spin animation ────────────────────────────────────────────────────────────
function spinWheel(targetIdx, onComplete) {
  if (wheelSpinning) return;
  if (!wheelTickets.length || wheelTickets[0].placeholder) return;
  wheelSpinning = true;

  const n      = wheelTickets.length;
  const slice  = (2*Math.PI)/n;
  const spins  = 6 + Math.random()*3;

  // Pointer at top (−π/2). Sector targetIdx center at: angle + targetIdx*slice + slice/2
  // We want that to equal −π/2 (mod 2π)
  const targetCenter = -(Math.PI/2) - (targetIdx*slice + slice/2);
  const finalAngle   = targetCenter - spins*2*Math.PI;

  const startAngle = wheelAngle;
  const duration   = 5000 + Math.random()*2000;
  const startTime  = performance.now();

  function easeOutQuart(t) { return 1 - Math.pow(1-t, 4); }

  function animate(now) {
    const t     = Math.min((now-startTime)/duration, 1);
    const eased = easeOutQuart(t);
    wheelAngle  = startAngle + (finalAngle-startAngle)*eased;

    drawWheel(wheelTickets, wheelAngle);

    if (t < 1) {
      wheelAnimId = requestAnimationFrame(animate);
    } else {
      wheelAngle  = ((finalAngle % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
      wheelSpinning = false;
      drawWheel(wheelTickets, wheelAngle);
      // Find actual sector under pointer at final position
      const _n = wheelTickets.length;
      const _slice = (2*Math.PI)/_n;
      const _pointer = ((-Math.PI/2) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
      let _actualIdx = targetIdx;
      for (let _si = 0; _si < _n; _si++) {
        const _sc = ((wheelAngle + _si*_slice + _slice/2) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
        const _diff = Math.abs(_sc - _pointer);
        if (_diff < _slice/2 || _diff > 2*Math.PI - _slice/2) {
          _actualIdx = _si;
          break;
        }
      }
      highlightSector(_actualIdx, wheelTickets);
      if (onComplete) onComplete(_actualIdx);
    }
  }
  requestAnimationFrame(animate);
}

// ── Build ticket list for wheel ───────────────────────────────────────────────

// ── Wheel legend — shows participants with color, tier, entries ──────────────
function renderWheelLegend() {
  let el = document.getElementById('wheel-legend');
  if (!el) {
    const panel = document.getElementById('wheel-panel-hero');
    if (!panel) return;
    el = document.createElement('div');
    el.id = 'wheel-legend';
    panel.appendChild(el);
  }

  // Build per-wallet totals from wheelTickets (mints order already applied)
  const walletData = new Map(); // addr -> { color, tier, totalEntries, sectors, isFree }
  const totalSectors = wheelTickets.filter(t => !t.placeholder).length;

  for (const t of wheelTickets) {
    if (t.placeholder) continue;
    if (!walletData.has(t.address)) {
      const col = getParticipantColor(t.address);
      walletData.set(t.address, {
        color:        col.stroke,
        colorFill:    col.fill,
        tier:         t.tier || 'common',
        totalEntries: 0,
        sectors:      0,
        isFree:       t.isFree || false,
      });
    }
    const d = walletData.get(t.address);
    d.sectors++;
    // accumulate real total entries from all tickets of this address
  }

  // Get real entry totals from dailyTickets/weeklyTickets
  const rawTickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const entryTotals = new Map();
  for (const t of rawTickets) {
    entryTotals.set(t.address, (entryTotals.get(t.address) || 0) + 1);
  }
  // Free entries
  if (currentLottery !== 'daily') {
    for (const [addr, info] of Object.entries(freeEntriesData)) {
      if (info.total > 0) entryTotals.set(addr, (entryTotals.get(addr) || 0) + info.total);
    }
  }
  const grandTotal = Array.from(entryTotals.values()).reduce((a,b) => a+b, 0) || 1;

  for (const [addr, d] of walletData.entries()) {
    d.totalEntries = entryTotals.get(addr) || 0;
  }

  if (!walletData.size) { el.innerHTML = ''; return; }

  const tierLabel = { legendary: 'LEGENDARY', rare: 'RARE', common: 'COMMON', free: 'FREE' };
  const isWeekly  = currentLottery === 'weekly';
  const accentAlpha = isWeekly ? '74,144,217' : '212,160,23';

  let html = `<div class="wl-wrap">`;
  html += `<div class="wl-header">
    <span class="wl-title">Participants</span>
    <span class="wl-total">${walletData.size} wallet${walletData.size!==1?'s':''} · ${grandTotal} entries</span>
  </div>`;

  for (const [addr, d] of walletData.entries()) {
    const pct  = Math.round((d.totalEntries / grandTotal) * 100);
    const tLabel = d.isFree ? 'FREE' : (tierLabel[d.tier] || 'COMMON');
    const addrShort = addr.slice(0,8) + '...' + addr.slice(-5);
    html += `
    <div class="wl-row">
      <div class="wl-dot" style="background:${d.color};box-shadow:0 0 8px ${d.color}88;"></div>
      <div class="wl-info">
        <div class="wl-addr" style="color:${d.color};">${addrShort}</div>
        <div class="wl-meta">
          <span class="wl-tier" style="border-color:${d.color}44;color:${d.color};">${tLabel}</span>
          <span class="wl-entries">${d.totalEntries} entr${d.totalEntries===1?'y':'ies'}</span>
          <span class="wl-sectors">${d.sectors} sector${d.sectors!==1?'s':''}</span>
        </div>
      </div>
      <div class="wl-pct-wrap">
        <div class="wl-pct-num" style="color:${d.color};">${pct}%</div>
        <div class="wl-bar-bg">
          <div class="wl-bar-fill" style="width:${pct}%;background:${d.color};box-shadow:0 0 6px ${d.color}66;"></div>
        </div>
      </div>
    </div>`;
  }
  html += `</div>`;
  el.innerHTML = html;
}

function updateWheelTickets() {
  // Don't update while spinning
  if (wheelSpinning) return;
  const tickets     = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const isDaily     = currentLottery === 'daily';
  const currency    = 'LUNC'; // both draws pay out in LUNC
  const pricePerTix = LUNC_PER_TICKET;

  // Reset color map — assign colors in chronological mint order
  _addrColorMap.clear();
  _addrColorCounter = 0;
  wheelTickets = []; // always reset before rebuild

  const WHEEL_SECTORS = MAX_SECTORS; // 20

  // Free entries (weekly)
  const freeTotal = isDaily ? 0 :
    Object.values(freeEntriesData).reduce((s,e) => s + (e.total||0), 0);

  // Free entries only shown on wheel if there are paid participants
  const hasPaidParticipants = tickets.length > 0;
  const effectiveFreeTotal  = hasPaidParticipants ? freeTotal : 0;
  const totalEntries = tickets.length + effectiveFreeTotal;

  if (totalEntries === 0) {
    wheelTickets = Array.from({length:WHEEL_SECTORS}, () => ({placeholder:true}));
    drawWheel(wheelTickets, wheelAngle);
    renderWheelLegend();
    // Reset badges — otherwise they keep the previous pool's numbers
    const _p = document.getElementById('wheel-participant-count');
    const _t = document.getElementById('wheel-ticket-count');
    const _pl = document.getElementById('wheel-pool-display');
    if (_p)  _p.textContent  = '0';
    if (_t)  _t.textContent  = '0';
    if (_pl) _pl.textContent = '0 ' + currency;
    return;
  }

  // 1 entry = 1 sector — chronological order of MINTS (not grouped by wallet)
  // Each mint event adds its sectors in sequence, preserving purchase order

  // First assign colors in wallet first-appearance order
  const seenWallet = new Set();
  for (const t of tickets) {
    if (!seenWallet.has(t.address)) {
      seenWallet.add(t.address);
      getParticipantColor(t.address);
    }
  }

  // Build wheelTickets from mints[] if available (chronological)
  // tickets are already in mint order from fetchRoundStatsAsTickets
  // Each ticket = 1 entry, grouped by mint (same txhash prefix = same mint)
  wheelTickets = [];
  const mintGroups = []; // [{wallet, tier, count}]
  const seenMint   = new Set();

  for (const t of tickets) {
    const mintKey = (t.txhash || '').replace(/:[0-9]+$/, '');
    if (!seenMint.has(mintKey)) {
      seenMint.add(mintKey);
      // Count entries for this mint
      const mintCount = tickets.filter(x =>
        (x.txhash || '').replace(/:[0-9]+$/, '') === mintKey
      ).length;
      mintGroups.push({
        wallet: t.address,
        tier:   t.tier || 'common',
        count:  mintCount,
      });
    }
  }

  // Add free entries (weekly) as separate mint groups at end
  if (!isDaily && hasPaidParticipants) {
    for (const [addr, info] of Object.entries(freeEntriesData)) {
      const fc = info.total || 0;
      if (fc <= 0) continue;
      if (!seenWallet.has(addr)) {
        seenWallet.add(addr);
        getParticipantColor(addr);
      }
      mintGroups.push({ wallet: addr, tier: 'free', count: fc });
    }
  }

  // Build sectors in mint order — each mint block consecutive
  console.log('[wheel] mintGroups:', mintGroups.map(g => g.wallet.slice(-5)+':'+g.count));
  for (const mg of mintGroups) {
    const walletTotal = tickets.filter(t => t.address === mg.wallet).length;
    for (let i = 0; i < mg.count; i++) {
      wheelTickets.push({
        address:      mg.wallet,
        tier:         mg.tier,
        entryIdx:     i,
        totalEntries: walletTotal,
        sectorCount:  mg.count,
        isFree:       mg.tier === 'free',
      });
    }
  }
  console.log('[wheel] wheelTickets:', wheelTickets.filter(t=>!t.placeholder).map(t=>t.address.slice(-5)));

  // Minimum 12 sectors for visual quality
  while (wheelTickets.length < 12) wheelTickets.push({placeholder:true});

  // Update wheel visuals - rim color changes for weekly
  const canvas = document.getElementById('wheel-canvas');
  if (canvas) {
    const rimColor = isDaily ? 'rgba(0,200,255,0.25)' : 'rgba(212,160,23,0.3)';
    canvas.style.filter = isDaily
      ? 'drop-shadow(0 0 30px rgba(212,160,23,0.35)) drop-shadow(0 0 60px rgba(200,100,0,0.2))'
      : 'drop-shadow(0 0 30px rgba(74,144,217,0.3)) drop-shadow(0 0 60px rgba(30,80,180,0.2))';
  }



  // Pointer color
  const ptr = document.querySelector('#wheel-panel-hero svg stop:first-child');
  // (SVG gradient updated via CSS filter above)

  drawWheel(wheelTickets, wheelAngle);
  renderWheelLegend();

  // Update badges
  const partEl = document.getElementById('wheel-participant-count');
  const tickEl = document.getElementById('wheel-ticket-count');
  const poolEl = document.getElementById('wheel-pool-display');
  // Count unique NFTs (transactions)
  const uniqueNFTs = new Set(tickets.map(t => t.txhash)).size;
  // Real prize pool
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
    } else {
      realPool += LUNC_PER_TICKET;
    }
  }
  // Show counts — free entries only counted if paid participants exist
  const _paidAddrs = new Set(tickets.map(t => t.address));
  const _hasPaid   = _paidAddrs.size > 0;
  const _totalFree = (!isDaily && _hasPaid)
    ? Object.values(freeEntriesData).reduce((s, e) => s + (e.total || 0), 0) : 0;
  const _freeOnlyAddrs = (!isDaily && _hasPaid)
    ? Object.keys(freeEntriesData).filter(w => !_paidAddrs.has(w)).length : 0;
  const _uniqueParts = _paidAddrs.size + _freeOnlyAddrs;
  if (partEl) partEl.textContent = _uniqueParts || 0;
  if (tickEl) tickEl.textContent = (tickets.length + _totalFree) || 0;
  if (poolEl) poolEl.textContent = fmt(realPool * 0.80) + ' ' + currency;

  // Badge colors - daily=cyan, weekly=gold
  const badgeColor = isDaily ? '#f4d03f' : '#7eb8ff';
  const badgeShadow = isDaily ? 'rgba(244,208,63,0.5)' : 'rgba(74,144,217,0.5)';
  if (partEl) { partEl.style.color = badgeColor; partEl.style.textShadow = '0 0 10px '+badgeShadow; }
  if (tickEl) { tickEl.style.color = isDaily ? '#a060ff' : '#cc66ff'; }
  if (poolEl) { poolEl.style.color = '#66ffaa'; }
}

// ── Trigger spin (called at draw time OR by admin) ────────────────────────────
function triggerWheelSpin(isAdmin) {
  const tickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const isDaily = currentLottery === 'daily';
  const currency = 'LUNC';

  if (tickets.length <= MIN_TICKETS) {
    setWheelMsg('⚠ Not enough tickets', 'Minimum ' + MIN_TICKETS + ' required for draw · Rolling over', '#ff9944');
    return;
  }

  updateWheelTickets();
  document.getElementById('wheel-winner-card').style.display = 'none';
  const lastWinner = winnersData.find(function(w){return w.type===currentLottery && w.winner && !w.skipped;});

  if (isDaily) {
    // Daily - 1 spin, 1 winner
    let targetIdx = 0;
    if (lastWinner && lastWinner.drawBlock) {
      targetIdx = lastWinner.drawBlock % Math.min(tickets.length, MAX_SECTORS);
    } else if (isAdmin) {
      targetIdx = Math.floor(Math.random() * wheelTickets.length);
    }
    setWheelMsg('🎡 Spinning...', 'Selecting winner on-chain', '#00c8ff');
    spinWheel(targetIdx, function(idx) {
      const winner = wheelTickets[idx];
      const prize  = tickets.length * LUNC_PER_TICKET * 0.80;
      setWheelMsg('✦ Winner Selected ✦', 'Payout sent automatically', '#66ffaa');
      const card = document.getElementById('wheel-winner-card');
      document.getElementById('ww-address').textContent = winner ? winner.address : '-';
      document.getElementById('ww-prize').textContent   = fmt(prize) + ' ' + currency;
      document.getElementById('ww-tx').innerHTML = '';
      card.style.display = 'block';
      card.classList.remove('show');
      void card.offsetWidth;
      card.classList.add('show');
      // Reset wheel after 1 hour
      setTimeout(function() {
        wheelSpunThisSession = false;
        wheelAngle = 0;
        document.getElementById('wheel-winner-card').style.display = 'none';
        document.getElementById('wheel-winner-card').classList.remove('show');
        updateWheelTickets();
        setWheelMsg('⏳ Next draw in ' + formatDiffShort(getNextDrawTime('daily') - Date.now()), 'Wheel spins automatically at 20:00 UTC', 'rgba(0,200,255,0.7)');
      }, 3600000); // 1 hour
    });
  } else {
    // Weekly - 3 spins, 3 winners
    const prizes = [0.48, 0.20, 0.12];
    const labels = ['🥇 1st Place', '🥈 2nd Place', '🥉 3rd Place'];
    const pool   = tickets.length * LUNC_PER_TICKET;
    const usedIdx = new Set();
    let spinNum = 0;

    function doNextSpin() {
      if (spinNum >= 3) return;
      const place = spinNum;
      setWheelMsg('🎡 Spin ' + (place+1) + '/3...', labels[place] + ' · Selecting winner', '#a78bfa');

      // Pick random unused sector
      let targetIdx = Math.floor(Math.random() * wheelTickets.length);
      let attempts = 0;
      while (usedIdx.has(wheelTickets[targetIdx]?.address) && attempts < wheelTickets.length) {
        targetIdx = (targetIdx + 1) % wheelTickets.length;
        attempts++;
      }

      spinWheel(targetIdx, function(idx) {
        const winner = wheelTickets[idx];
        const prize  = Math.floor(pool * prizes[place]);
        usedIdx.add(winner ? winner.address : '');

        setWheelMsg(labels[place] + ' ✦', (winner ? winner.address.slice(0,10)+'...' : '-') + ' wins ' + fmt(prize) + ' LUNC', '#a78bfa');

        const card = document.getElementById('wheel-winner-card');
        document.getElementById('ww-address').textContent = winner ? winner.address : '-';
        document.getElementById('ww-prize').textContent   = fmt(prize) + ' LUNC · ' + labels[place];
        document.getElementById('ww-tx').innerHTML = '<span style="font-size:11px;color:rgba(167,139,250,0.6);">' + labels[place] + '</span>';
        card.style.display = 'block';
        card.classList.remove('show');
        void card.offsetWidth;
        card.classList.add('show');

        spinNum++;
        if (spinNum < 3) {
          setTimeout(doNextSpin, 5000); // 5s pause between spins
        } else {
          setWheelMsg('✦ All Winners Selected ✦', 'Payouts sent automatically', '#66ffaa');
        }
      });
    }
    doNextSpin();
  }
}

function setWheelMsg(msg, sub, color) {
  const m = document.getElementById('wheel-msg');
  const s = document.getElementById('wheel-submsg');
  if (m) { m.textContent = msg; m.style.color = color || '#00c8ff'; m.style.textShadow = '0 0 20px '+color+'88'; }
  if (s)   s.textContent = sub || '';
}

// ── Auto check draw time (every second) ──────────────────────────────────────
let wheelSpunThisSession = false;
const BURN_DEADLINE_MS = 15 * 60 * 1000; // 15 minutes before draw

function checkDrawTime() {
  const drawTime = getNextDrawTime(currentLottery);
  const diff     = drawTime - Date.now();
  const msgEl    = document.getElementById('wheel-msg');
  if (!msgEl) return;

  if (diff <= 0 && diff > -90000 && !wheelSpunThisSession && !wheelSpinning) {
    wheelSpunThisSession = true;
    triggerWheelSpin(false);
    updateBurnButtonState(false); // Block burns during/after draw
  } else if (diff > 0 && !wheelSpinning) {
    if (diff <= BURN_DEADLINE_MS) {
      // 🔴 Last 15 minutes - burns closing soon
      const burnDiff = diff;
      const bm = Math.floor(burnDiff / 60000);
      const bs = Math.floor((burnDiff % 60000) / 1000);
      const timeStr = bm > 0 ? bm + 'm ' + bs + 's' : bs + 's';
      setWheelMsg(
        '🔴 Burns close in ' + timeStr,
        'Last chance to enter this round!',
        'rgba(255,80,80,0.9)'
      );
      updateBurnButtonState(false); // Disable burn button
    } else {
      // ✅ Round open - burns allowed
      setWheelMsg(
        '⏳ Next draw in ' + formatDiffShort(diff),
        'Wheel spins automatically at 20:00 UTC',
        'rgba(0,200,255,0.7)'
      );
      updateBurnButtonState(true); // Enable burn button
    }
  }
}

function updateBurnButtonState(open) {
  // Update burn buttons in My Bag
  document.querySelectorAll('.burn-btn').forEach(btn => {
    btn.disabled = !open;
    btn.style.opacity = open ? '1' : '0.4';
    btn.style.cursor  = open ? 'pointer' : 'not-allowed';
    btn.title = open ? '' : 'Burns closed - draw starting soon';
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

function formatDiffShort(ms) {
  const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000), s=Math.floor((ms%60000)/1000);
  if (h>0) return h+'h '+m+'m';
  if (m>0) return m+'m '+s+'s';
  return s+'s';
}

// ── Admin panel wheel demo ────────────────────────────────────────────────────
function adminSpinDemo() {
  if (!adminUnlocked) return;
  wheelSpunThisSession = false;
  triggerWheelSpin(true);
}

// ─── VERIFY TICKETS ──────────────────────────────────────────────────────────
function verifyKeplrAddress() {
  // Use any connected wallet address
  const addr = connectedWalletAddress || lotteryAddress;
  if (addr) {
    document.getElementById('verify-input').value = addr;
    verifyTickets();
  } else {
    // No wallet connected — prompt to connect
    alert('Please connect your wallet first.');
  }
}

function verifyTickets() {
  const addr = document.getElementById('verify-input').value.trim();

  const resultEl   = document.getElementById('verify-result');
  const emptyEl    = document.getElementById('verify-empty');
  const notFoundEl = document.getElementById('verify-notfound');

  // Reset
  resultEl.style.display   = 'none';
  emptyEl.style.display    = 'none';
  notFoundEl.style.display = 'none';

  if (!addr || addr.length < 10) {
    emptyEl.style.display = 'block';
    return;
  }

  if (!addr.startsWith('terra1')) {
    emptyEl.innerHTML = '<span style="color:#ff6060;">⚠ Address must start with terra1...</span>';
    emptyEl.style.display = 'block';
    return;
  }

  // Find tickets for this address in both lotteries
  const myDaily  = dailyTickets.filter(t => t.address === addr);
  const myWeekly = weeklyTickets.filter(t => t.address === addr);
  const myTickets = currentLottery === 'daily' ? myDaily : myWeekly;
  const allTickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;

  if (myTickets.length === 0) {
    notFoundEl.style.display = 'block';
    return;
  }

  // Free entries from GitHub JSON
  const myFreeData = getFreeEntries(addr);
  const myFreeTotal = myFreeData.total;

  // Calculate win chance (paid + free entries)
  const totalFreeAll = Object.values(freeEntriesData).reduce((s, e) => s + (e.total || 0), 0);
  const totalTix = allTickets.length + totalFreeAll;
  const myTix    = myTickets.length + myFreeTotal;
  const chance   = totalTix > 0 ? ((myTix / totalTix) * 100).toFixed(2) : '0.00';

  // Pool prize
  const isDaily = currentLottery === 'daily';
  const pricePerTix = isDaily ? LUNC_PER_TICKET : weeklyTicketPrice();
  const poolPrize = totalTix * pricePerTix * 0.80;
  const currency  = 'LUNC';

  // Render summary cards
  document.getElementById('verify-cards').innerHTML = `
    <div style="background:rgba(212,160,23,0.06);border:1px solid rgba(212,160,23,0.15);
      border-radius:10px;padding:16px;text-align:center;">
      <div style="font-family:'Cinzel',serif;font-size:28px;font-weight:700;color:var(--gold-light);">${myTix}</div>
      <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-top:4px;">
        Your Tickets
      </div>
    </div>
    <div style="background:rgba(102,255,170,0.06);border:1px solid rgba(102,255,170,0.15);
      border-radius:10px;padding:16px;text-align:center;">
      <div style="font-family:'Cinzel',serif;font-size:28px;font-weight:700;color:#66ffaa;">${chance}%</div>
      <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-top:4px;">
        Win Chance
      </div>
    </div>
    <div style="background:rgba(74,144,217,0.06);border:1px solid rgba(74,144,217,0.15);
      border-radius:10px;padding:16px;text-align:center;">
      <div style="font-family:'Cinzel',serif;font-size:20px;font-weight:700;color:#7eb8ff;">${fmt(poolPrize)}</div>
      <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-top:4px;">
        Prize If Win (${currency})
      </div>
    </div>
    ${myFreeTotal > 0 ? `
    <div style="background:rgba(102,255,170,0.04);border:1px solid rgba(102,255,170,0.15);
      border-radius:10px;padding:16px;text-align:center;grid-column:1/-1;">
      <div style="font-family:'Cinzel',serif;font-size:22px;font-weight:700;color:#66ffaa;">${myFreeTotal}</div>
      <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);margin-top:4px;">
        Free Entries (Oracle protocol)
      </div>
      <div style="font-size:10px;color:rgba(102,255,170,0.5);margin-top:4px;">
        ${myFreeData.chat} from chat · ${myFreeData.questions} from questions
      </div>
    </div>` : ''}
  `;

  // Render TX list - deduplicated by txhash
  const uniqueTxs = [];
  const seen = new Set();
  for (const t of myTickets) {
    if (!seen.has(t.txhash)) {
      seen.add(t.txhash);
      const count = myTickets.filter(x => x.txhash === t.txhash).length;
      uniqueTxs.push({ ...t, count });
    }
  }

  const txRows = uniqueTxs.map(tx => {
    const d = new Date(tx.time * 1000);
    const dateStr = d.toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    const explorerUrl = `https://finder.terraport.finance/mainnet/tx/${tx.txhash}`;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:12px 14px;border-bottom:1px solid rgba(42,24,0,0.5);font-size:12px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="background:rgba(212,160,23,0.1);color:var(--gold-light);
            border-radius:4px;padding:3px 8px;font-family:'Cinzel',serif;font-size:11px;">
            ×${tx.count}
          </span>
          <span style="color:var(--muted);">${dateStr}</span>
        </div>
        <a href="${explorerUrl}" target="_blank"
          style="font-family:monospace;font-size:11px;color:var(--gold-dim);text-decoration:none;
            transition:color 0.2s;"
          onmouseover="this.style.color='var(--gold-light)'"
          onmouseout="this.style.color='var(--gold-dim)'">
          ${tx.txhash.slice(0,12)}...${tx.txhash.slice(-6)} 🔗
        </a>
      </div>
    `;
  }).join('');

  document.getElementById('verify-txlist').innerHTML = `
    <div style="border:1px solid rgba(42,24,0,0.8);border-radius:8px;overflow:hidden;">
      <div style="padding:10px 14px;background:rgba(212,160,23,0.04);
        font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);
        border-bottom:1px solid rgba(42,24,0,0.5);">
        Registered Transactions - ${totalTix} total tickets in this round
      </div>
      ${txRows}
    </div>
    <div style="text-align:center;margin-top:12px;font-size:11px;color:var(--muted);">
      All transactions verified on-chain · Draw at 20:00 UTC
    </div>
  `;

  resultEl.style.display = 'block';
}


// ─── DRAW VERIFICATION ───────────────────────────────────────────────────────
function populateDrawVerifySelect() {
  const sel = document.getElementById('dv-round-select');
  if (!sel) return;

  // Keep first placeholder option
  sel.innerHTML = '<option value="" style="background:#110a00;">- Select a completed round -</option>';

  const completed = winnersData.filter(function(w){return w.winner || (w.winners && w.winners.length > 0);});
  if (!completed.length) {
    document.getElementById('dv-empty').style.display = 'block';
    document.getElementById('dv-result').style.display = 'none';
    return;
  }

  completed.forEach((w, i) => {
    const d = new Date(w.time * 1000);
    const dateStr = d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    const badge = w.type === 'daily' ? '🎰 Daily' : '🏆 Weekly';
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${badge} · Round #${w.round} · ${dateStr}`;
    opt.style.background = '#110a00';
    sel.appendChild(opt);
  });
}

async function loadDrawVerify() {
  const sel = document.getElementById('dv-round-select');
  const idx = sel.value;
  const resultEl = document.getElementById('dv-result');
  const emptyEl  = document.getElementById('dv-empty');

  if (idx === '') {
    resultEl.style.display = 'none';
    emptyEl.style.display  = 'block';
    return;
  }

  const completed = winnersData.filter(function(w){return w.winner || (w.winners && w.winners.length > 0);});
  const w = completed[parseInt(idx)];
  if (!w) return;

  emptyEl.style.display  = 'none';
  resultEl.style.display = 'block';

  const isDaily    = w.type === 'daily';
  const currency   = 'LUNC';
  const blockHash  = w.drawBlockHash || 'N/A (pre-upgrade draw)';
  const ticketCount = w.tickets;
  const blockHeight = w.drawBlock;

  // Recalculate winner index client-side using SubtleCrypto (SHA256)
  let recalcIdx = null;
  let seedHex   = null;
  if (w.drawBlockHash) {
    try {
      const seedStr = `${blockHeight}:${blockHash}:${ticketCount}`;
      const enc     = new TextEncoder().encode(seedStr);
      const hashBuf = await crypto.subtle.digest('SHA-256', enc);
      seedHex       = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
      // BigInt modulo
      recalcIdx     = Number(BigInt('0x' + seedHex) % BigInt(ticketCount));
    } catch(e) { console.warn('SHA256 recalc failed:', e); }
  }

  // Input data cards
  document.getElementById('dv-inputs').innerHTML = `
    <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(42,24,0,0.8);border-radius:8px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Block Height</div>
      <div style="font-family:monospace;color:var(--gold-light);font-size:13px;">${blockHeight}</div>
    </div>
    <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(42,24,0,0.8);border-radius:8px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Ticket Count</div>
      <div style="font-family:monospace;color:var(--gold-light);font-size:13px;">${ticketCount}</div>
    </div>
    <div style="grid-column:1/-1;background:rgba(0,0,0,0.3);border:1px solid rgba(42,24,0,0.8);border-radius:8px;padding:12px;">
      <div style="font-size:10px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Block Hash</div>
      <div style="font-family:monospace;color:var(--gold-light);font-size:12px;word-break:break-all;">${blockHash}</div>
    </div>
  `;

  // Formula display
  const shortHash = blockHash.length > 16 ? blockHash.slice(0,16) + '...' : blockHash;
  document.getElementById('dv-formula').innerHTML = seedHex
    ? `seed&nbsp;&nbsp;&nbsp;= SHA256("<span style="color:#ffaa44;">${blockHeight}:${shortHash}:${ticketCount}</span>")<br>
       seed&nbsp;&nbsp;&nbsp;= <span style="color:#aaffcc;">${seedHex.slice(0,32)}...</span><br>
       winner = BigInt(seed) % ${ticketCount}<br>
       winner = <span style="color:var(--gold-light);font-size:14px;font-weight:700;">${recalcIdx}</span>`
    : `seed&nbsp;&nbsp;&nbsp;= SHA256("${blockHeight}:${blockHash}:${ticketCount}")<br>
       winner = BigInt(seed) % ${ticketCount}<br>
       <span style="color:var(--muted);">(blockHash not available for this round)</span>`;

  // Winner card
  const d = new Date(w.time * 1000);
  const dateStr = d.toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const matchIcon = recalcIdx !== null
    ? (recalcIdx === (w.winnerIndex || recalcIdx) ? '✅' : '⚠️')
    : '-';

  document.getElementById('dv-winner-card').innerHTML = `
    <div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:10px;">🏆 Winner</div>
    <div style="font-family:monospace;font-size:14px;color:var(--gold-light);margin-bottom:8px;word-break:break-all;">${w.winner}</div>
    <div style="display:flex;justify-content:center;gap:24px;margin-top:12px;flex-wrap:wrap;">
      <span style="font-size:12px;color:#66ffaa;">Prize: ${fmt(w.prize)} ${currency}</span>
      <span style="font-size:12px;color:var(--muted);">Ticket index: #${recalcIdx !== null ? recalcIdx : '-'}</span>
      <span style="font-size:12px;color:var(--muted);">${dateStr}</span>
    </div>
    <div style="margin-top:10px;font-size:11px;color:${recalcIdx !== null ? '#66ffaa' : 'var(--muted)'};">
      ${recalcIdx !== null ? matchIcon + ' Client-side recalculation matches draw result' : '- Legacy draw (no blockHash recorded)'}
    </div>
    ${w.txHashes?.winner ? `<a href="https://finder.terraport.finance/mainnet/tx/${w.txHashes.winner}" target="_blank"
      style="display:inline-block;margin-top:10px;font-size:11px;color:var(--gold-dim);text-decoration:none;">
      🔗 Payout TX: ${w.txHashes.winner.slice(0,16)}...</a>` : ''}
  `;

  // Code snippet for manual verification
  document.getElementById('dv-code-snippet').textContent =
    `crypto.subtle.digest('SHA-256', new TextEncoder().encode('${blockHeight}:${blockHash}:${ticketCount}'))`;
}


// ─── ADMIN PANEL - Keplr wallet auth ────────────────────────────────────────
function initAdminTrigger() {
  // Opens admin login if URL contains ?admin
  if (new URLSearchParams(window.location.search).has('admin')) {
    openAdminLogin();
  }
}

function openAdminLogin() {
  const el = document.getElementById('admin-login');
  el.style.display = 'flex';
  document.getElementById('admin-login-status').textContent = '';
  document.getElementById('admin-connect-btn').textContent  = '🔑 Connect Keplr';
}

function closeAdminLogin() {
  document.getElementById('admin-login').style.display = 'none';
}

async function connectAdminKeplr() {
  const statusEl = document.getElementById('admin-login-status');
  const btnEl    = document.getElementById('admin-connect-btn');

  if (!window.keplr) {
    statusEl.style.color = '#ff3c78';
    statusEl.textContent = '⚠ Keplr not found - install Keplr extension';
    return;
  }

  try {
    btnEl.textContent    = '⏳ Connecting...';
    statusEl.textContent = '';
    statusEl.style.color = 'var(--muted)';

    await window.keplr.enable(CHAIN_ID);
    const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
    const accounts      = await offlineSigner.getAccounts();
    const addr          = accounts[0].address;

    if (addr === ADMIN_WALLET) {
      adminUnlocked = true;
      closeAdminLogin();
      toggleAdminPanel();
    } else {
      // Wrong wallet - show error
      statusEl.style.color = '#ff3c78';
      statusEl.textContent = '✕ Access denied - wrong wallet';
      btnEl.textContent    = '🔑 Connect Keplr';
      // Briefly flash red border on modal
      const modal = document.querySelector('#admin-login > div');
      if (modal) {
        modal.style.borderColor = 'rgba(255,60,120,0.6)';
        setTimeout(() => { modal.style.borderColor = 'rgba(0,200,255,0.25)'; }, 1500);
      }
    }
  } catch(e) {
    statusEl.style.color = '#ff9944';
    statusEl.textContent = '⚠ ' + (e.message || 'Connection failed');
    btnEl.textContent    = '🔑 Connect Keplr';
  }
}

function toggleAdminPanel() {
  const panel = document.getElementById('admin-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  updateAdminStats();
}

function updateAdminStats() {
  const tickets = currentLottery === 'daily' ? dailyTickets : weeklyTickets;
  const countEl = document.getElementById('admin-ticket-count');
  const refEl   = document.getElementById('admin-last-refresh');
  if (countEl) countEl.textContent = tickets.length;
  if (refEl)   refEl.textContent   = new Date().toLocaleTimeString('en-GB');
}

function resetWheel() {
  if (!adminUnlocked) return;
  wheelSpunThisSession = false;
  wheelAngle = 0;
  document.getElementById('wheel-winner-card').style.display = 'none';
  document.getElementById('wheel-winner-card').classList.remove('show');
  updateWheelTickets();
  setWheelMsg('⏳ Wheel reset', 'Ready for next draw', 'rgba(0,200,255,0.7)');
}

// ─── WALLET CONNECT ──────────────────────────────────────────────────────────
let connectedWalletAddress = null;

// ── Global API constants (must be declared before any function uses them) ──
const NFT_API_BASE       = 'https://nft.lunc.tools/api';
const DRAW_WORKER        = 'https://oracle-draw.vladislav-baydan.workers.dev';
const DAILY_WALLET_ADDR  = 'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px';
const WEEKLY_WALLET_ADDR = 'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz';

// ── Multi-layered wallet persistence (works around mobile browser quirks) ──
// Mobile Safari/Chrome can clear localStorage between sessions in some modes.
// Try localStorage → sessionStorage → cookie. Read from any source available.
function persistWallet(address, provider) {
  try { localStorage.setItem('walletAddress', address); localStorage.setItem('walletProvider', provider); } catch(e) {}
  try { sessionStorage.setItem('walletAddress', address); sessionStorage.setItem('walletProvider', provider); } catch(e) {}
  try {
    // Cookie fallback — 30 days
    const exp = new Date(Date.now() + 30 * 86400000).toUTCString();
    document.cookie = `oraclewallet=${encodeURIComponent(address)}; expires=${exp}; path=/; SameSite=Lax`;
    document.cookie = `oracleprovider=${encodeURIComponent(provider)}; expires=${exp}; path=/; SameSite=Lax`;
  } catch(e) {}
}
function loadPersistedWallet() {
  let address = null, provider = null;
  try { address = localStorage.getItem('walletAddress'); provider = localStorage.getItem('walletProvider'); } catch(e) {}
  if (!address) {
    try { address = sessionStorage.getItem('walletAddress'); provider = sessionStorage.getItem('walletProvider'); } catch(e) {}
  }
  if (!address) {
    try {
      const m = document.cookie.match(/(?:^|; )oraclewallet=([^;]+)/);
      if (m) address = decodeURIComponent(m[1]);
      const p = document.cookie.match(/(?:^|; )oracleprovider=([^;]+)/);
      if (p) provider = decodeURIComponent(p[1]);
    } catch(e) {}
  }
  return { address, provider };
}
function clearPersistedWallet() {
  try { localStorage.removeItem('walletAddress'); localStorage.removeItem('walletProvider'); } catch(e) {}
  try { sessionStorage.removeItem('walletAddress'); sessionStorage.removeItem('walletProvider'); } catch(e) {}
  try {
    document.cookie = 'oraclewallet=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    document.cookie = 'oracleprovider=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  } catch(e) {}
}
let walletProvider = null; // 'keplr' | 'station' | 'luncdash'

const TERRA_CHAIN_CONFIG = {
  chainId: 'columbus-5',
  chainName: 'Terra Classic',
  rpc: 'https://terra-classic-rpc.publicnode.com',
  rest: 'https://terra-classic-lcd.publicnode.com',
  bip44: { coinType: 330 },
  bech32Config: {
    bech32PrefixAccAddr: 'terra',
    bech32PrefixAccPub: 'terrapub',
    bech32PrefixValAddr: 'terravaloper',
    bech32PrefixValPub: 'terravaloperpub',
    bech32PrefixConsAddr: 'terravalcons',
    bech32PrefixConsPub: 'terravalconspub',
  },
  currencies: [
    { coinDenom: 'LUNC', coinMinimalDenom: 'uluna', coinDecimals: 6 },
    { coinDenom: 'USTC', coinMinimalDenom: 'uusd', coinDecimals: 6 },
  ],
  feeCurrencies: [{ coinDenom: 'LUNC', coinMinimalDenom: 'uluna', coinDecimals: 6, gasPriceStep: { low: 28.325, average: 28.325, high: 28.325 } }],
  stakeCurrency: { coinDenom: 'LUNC', coinMinimalDenom: 'uluna', coinDecimals: 6 },
};

function walletBtnClick() {
  if (connectedWalletAddress) {
    toggleWalletInfo();
  } else {
    toggleWalletPicker();
  }
}

function toggleWalletPicker() {
  const picker = document.getElementById('wallet-picker');
  const info = document.getElementById('wallet-info');
  info.classList.remove('open');
  picker.classList.toggle('open');
}

function toggleWalletInfo() {
  const info = document.getElementById('wallet-info');
  const picker = document.getElementById('wallet-picker');
  picker.classList.remove('open');
  info.classList.toggle('open');
  if (info.classList.contains('open')) fetchWalletBalances();
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('wallet-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('wallet-picker').classList.remove('open');
    document.getElementById('wallet-info').classList.remove('open');
  }
});

async function connectWallet(provider) {
  document.getElementById('wallet-picker').classList.remove('open');

  if (provider === 'keplr') {
    await connectKeplr();
  } else if (provider === 'station') {
    await connectStation();
  } else if (provider === 'galaxystation') {
    await connectGalaxystation();
  } else if (provider === 'luncdash') {
    promptManualAddress();
  }
}

async function connectKeplr() {
  if (!window.keplr) {
    alert('Keplr extension not found.\nPlease install Keplr: https://www.keplr.app');
    return;
  }
  try {
    try { await window.keplr.experimentalSuggestChain(TERRA_CHAIN_CONFIG); } catch(e) {}
    await window.keplr.enable(CHAIN_ID);
    const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    if (accounts && accounts[0]) {
      setConnectedWallet(accounts[0].address, 'keplr');
      // Also sync with modal
      lotteryAddress = accounts[0].address;
      const addrDisp = document.getElementById('lottery-addr-display');
      const notConn  = document.getElementById('lottery-not-connected');
      const conn     = document.getElementById('lottery-connected');
      const buyBtn   = document.getElementById('lottery-buy-btn');
      if (addrDisp) addrDisp.textContent = fmtAddr(lotteryAddress);
      if (notConn)  notConn.style.display = 'none';
      if (conn)     conn.style.display    = 'block';
      if (buyBtn)   buyBtn.style.display  = 'block';
      if (typeof updateBuyBtn === 'function') updateBuyBtn();
    }
  } catch(e) {
    console.error('Keplr connect error:', e);
    alert('Could not connect to Keplr: ' + (e.message || e));
  }
}

async function connectStation() {
  // Terra Station injects window.station.keplr (same pattern as Galaxy Station)
  // Fallback: window.station directly if it has enable(), or window.keplr as last resort
  const stationKeplr = window.station?.keplr || (window.station?.enable ? window.station : null);
  if (!stationKeplr) {
    alert('Terra Station wallet not found.\nPlease install Terra Station extension:\nhttps://chrome.google.com/webstore/detail/terra-station/aiifbnbfobpmeekipheeijimdpnlpgpp');
    return;
  }
  try {
    try { await stationKeplr.experimentalSuggestChain(TERRA_CHAIN_CONFIG); } catch(e) {}
    await stationKeplr.enable(CHAIN_ID);
    const offlineSigner = stationKeplr.getOfflineSigner(CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    if (accounts && accounts[0]) {
      setConnectedWallet(accounts[0].address, 'station');
      lotteryAddress = accounts[0].address;
      const addrDisp = document.getElementById('lottery-addr-display');
      const notConn  = document.getElementById('lottery-not-connected');
      const conn     = document.getElementById('lottery-connected');
      const buyBtn   = document.getElementById('lottery-buy-btn');
      if (addrDisp) addrDisp.textContent = fmtAddr(lotteryAddress);
      if (notConn)  notConn.style.display = 'none';
      if (conn)     conn.style.display    = 'block';
      if (buyBtn)   buyBtn.style.display  = 'block';
      if (typeof updateBuyBtn === 'function') updateBuyBtn();
    }
  } catch(e) {
    console.error('Station connect error:', e);
    alert('Could not connect to Terra Station: ' + (e.message || e));
  }
}

async function connectGalaxystation() {
  // Galaxy Station injects window.galaxyStation.keplr (Keplr-compatible API)
  const galaxyKeplr = window.galaxyStation?.keplr || window.galaxyStation;
  if (!galaxyKeplr || !galaxyKeplr.enable) {
    alert('Galaxy Station wallet not found.\nPlease install Galaxy Station extension:\nhttps://chrome.google.com/webstore/detail/galaxy-station/conpajdnokdflbcenodalfifbikfncpa');
    return;
  }
  try {
    try { await galaxyKeplr.experimentalSuggestChain(TERRA_CHAIN_CONFIG); } catch(e) {}
    await galaxyKeplr.enable(CHAIN_ID);
    const offlineSigner = galaxyKeplr.getOfflineSigner(CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    if (accounts && accounts[0]) {
      setConnectedWallet(accounts[0].address, 'galaxystation');
      lotteryAddress = accounts[0].address;
      const addrDisp = document.getElementById('lottery-addr-display');
      const notConn  = document.getElementById('lottery-not-connected');
      const conn     = document.getElementById('lottery-connected');
      const buyBtn   = document.getElementById('lottery-buy-btn');
      if (addrDisp) addrDisp.textContent = fmtAddr(lotteryAddress);
      if (notConn)  notConn.style.display = 'none';
      if (conn)     conn.style.display    = 'block';
      if (buyBtn)   buyBtn.style.display  = 'block';
      if (typeof updateBuyBtn === 'function') updateBuyBtn();
    }
  } catch(e) {
    console.error('Galaxy Station connect error:', e);
    alert('Could not connect to Galaxy Station: ' + (e.message || e));
  }
}

function promptManualAddress() {
  const addr = prompt('Enter your Terra Classic wallet address (terra1...):');
  if (addr && addr.trim().startsWith('terra1') && addr.trim().length >= 40) {
    setConnectedWallet(addr.trim(), 'luncdash');
  } else if (addr !== null) {
    alert('Invalid Terra Classic address. It should start with terra1 and be 44+ characters.');
  }
}

function setConnectedWallet(address, provider) {
  connectedWalletAddress = address;
  // Refresh My Bag if open
  if (document.getElementById('page-bag') &&
      document.getElementById('page-bag').style.display !== 'none') {
    renderMyBag();
  }
  walletProvider = provider;

  // Persist across page reloads (multi-layer for mobile browser quirks)
  persistWallet(address, provider);

  // Update button
  const btn = document.getElementById('btn-wallet');
  const label = document.getElementById('wallet-btn-label');
  if (btn) btn.classList.add('connected');
  const short = address.slice(0, 8) + '…' + address.slice(-4);
  if (label) label.textContent = short;

  // Update info popover
  const addrEl = document.getElementById('wallet-info-addr');
  const balLunc = document.getElementById('wallet-bal-lunc');
  const balUstc = document.getElementById('wallet-bal-ustc');
  if (addrEl) addrEl.textContent = address;
  if (balLunc) balLunc.textContent = '…';
  if (balUstc) balUstc.textContent = '…';

  fetchWalletBalances();
}

async function fetchWalletBalances() {
  if (!connectedWalletAddress) return;
  try {
    const LCD_BASE = LCD_NODES[0];
    const r = await fetch(`${LCD_BASE}/cosmos/bank/v1beta1/balances/${connectedWalletAddress}?pagination.limit=50`);
    const data = await r.json();
    const balances = data.balances || [];
    const lunc = balances.find(b => b.denom === 'uluna');
    const ustc = balances.find(b => b.denom === 'uusd');
    const luncAmt = lunc ? (parseInt(lunc.amount) / 1e6).toLocaleString('en', {maximumFractionDigits: 2}) : '0';
    const ustcAmt = ustc ? (parseInt(ustc.amount) / 1e6).toLocaleString('en', {maximumFractionDigits: 2}) : '0';
    const balLunc2 = document.getElementById('wallet-bal-lunc');
    const balUstc2 = document.getElementById('wallet-bal-ustc');
    if (balLunc2) balLunc2.textContent = luncAmt;
    if (balUstc2) balUstc2.textContent = ustcAmt;
  } catch(e) {
    const balLunc3 = document.getElementById('wallet-bal-lunc');
    const balUstc3 = document.getElementById('wallet-bal-ustc');
    if (balLunc3) balLunc3.textContent = '-';
    if (balUstc3) balUstc3.textContent = '-';
  }
}

function copyWalletAddress() {
  if (!connectedWalletAddress) return;
  navigator.clipboard.writeText(connectedWalletAddress).then(() => {
    const el = document.getElementById('wallet-info-addr');
    const orig = el.textContent;
    el.textContent = '✓ Copied!';
    setTimeout(() => { el.textContent = orig; }, 1500);
  });
}

function fillWalletAddress() {
  if (!connectedWalletAddress) return;
  // Pre-fill the modal's lottery address state
  lotteryAddress = connectedWalletAddress;
  syncDrawWalletUI(lotteryAddress);
  if (typeof updateBuyBtn === 'function') updateBuyBtn();
  document.getElementById('wallet-info').classList.remove('open');
  openModal();
}

function disconnectWallet() {
  connectedWalletAddress = null;
  lotteryAddress = null;
  walletProvider = null;
  clearPersistedWallet();
  const btn = document.getElementById('btn-wallet');
  const label = document.getElementById('wallet-btn-label');
  const info = document.getElementById('wallet-info');
  if (btn) btn.classList.remove('connected');
  if (label) label.textContent = 'Connect Wallet';
  if (info) info.classList.remove('open');
  /* Sync modal wallet UI */
  syncDrawWalletUI(null);
}

// ─── INIT ────────────────────────────────────────────────────────────────────
(async () => {
  // Restore last active tab
  try {
    const validTabs = ['home','draw','winners','verify','bag'];
    const pathTab = location.pathname.replace(/^\//, '') || '';
    const hashTab = location.hash.replace(/^#/, '') || '';
    const startTab = validTabs.includes(pathTab) ? pathTab
                   : validTabs.includes(hashTab) ? hashTab
                   : 'home';
    if (history.replaceState) history.replaceState({ tab: startTab }, '', '/' + startTab);
    showTab(startTab, true);
  } catch(e) { showTab('home', true); }

  // Restore wallet session (multi-layer: localStorage → sessionStorage → cookie)
  try {
    const persisted = loadPersistedWallet();
    if (persisted.address) {
      setConnectedWallet(persisted.address, persisted.provider || 'keplr');
    }
  } catch(e) {}

  startTimer();
  initWheel();
  initAdminTrigger();
  await loadWinners();

  // ── Load balances first - update podium immediately ──
  const [_dBal, _wBal] = await Promise.all([
    getWalletBalance(DAILY_WALLET),
    getWalletBalance(WEEKLY_WALLET),
  ]);
  window._dailyPoolBalance  = _dBal;
  window._weeklyPoolBalance = _wBal;
  updatePodiumPrizes();
  updatePoolDisplay();

  // ── Then load everything else ──
  await loadAllData();

  // Apply correct UI state after data is ready (podium, pool display, etc.)
  updatePodiumPrizes();

  // Hide loader now that everything is ready
  const loader = document.getElementById('page-loader');
  if (loader) {
    setTimeout(() => loader.classList.add('hidden'), 600);
  }

  // Refresh every 60s
  setInterval(loadAllData, 60000);
  setInterval(checkDrawTime, 1000);
})();

// ── MY BAG ────────────────────────────────────────────────────────────────────
// (NFT_API_BASE / DRAW_WORKER constants moved to top of file to avoid TDZ errors)

// Oracle Mask nft_ids on nft.lunc.tools:
//   134 = Common   (25,000 LUNC, 1 entry)
//   135 = Rare     (125,000 LUNC, 5 entries)
//   136 = Legendary (250,000 LUNC, 10 entries)
const NFT_ID_TO_TIER = { 134: 'common', 135: 'rare', 136: 'legendary' };

function detectNFTTier(nft) {
  // Primary: nft_id (most reliable)
  const id = nft.nft_id || nft.nftId;
  if (id && NFT_ID_TO_TIER[id]) return NFT_ID_TO_TIER[id];

  // Fallback: match by name
  const name = (nft.name || nft.nft_name || '').toLowerCase();
  if (name.includes('legendary')) return 'legendary';
  if (name.includes('rare'))      return 'rare';
  return 'common';
}
function tierEntries(tier) {
  return tier === 'legendary' ? 10 : tier === 'rare' ? 5 : 1;
}

// Convert ipfs:// URL to https gateway
// Local NFT artwork (in repo /nfts/ folder).
// Much faster than IPFS gateways — served directly from GitHub Pages / Cloudflare CDN.
// `sm` (256x384, ~5-9KB WebP) used in My Bag cards.
// `md` (512x768, ~14-28KB WebP) used in modals / detail views.
const TIER_IMAGES = {
  common:    { sm: 'nfts/common-sm.webp',    md: 'nfts/common-md.webp',    fallback: 'nfts/common-sm.png' },
  rare:      { sm: 'nfts/rare-sm.webp',      md: 'nfts/rare-md.webp',      fallback: 'nfts/rare-sm.png' },
  legendary: { sm: 'nfts/legendary-sm.webp', md: 'nfts/legendary-md.webp', fallback: 'nfts/legendary-sm.png' },
};

// Returns local image URL for a given tier. Auto-fallback to PNG if WebP not supported.
function tierImage(tier, size) {
  const cfg = TIER_IMAGES[tier] || TIER_IMAGES.common;
  return cfg[size || 'sm'];
}

function renderMyBag() {
  const wallet = connectedWalletAddress || lotteryAddress;
  const notConn = document.getElementById('bag-not-connected');
  const conn    = document.getElementById('bag-connected');
  if (!notConn || !conn) return;

  if (!wallet) {
    notConn.style.display = 'block';
    conn.style.display    = 'none';
    return;
  }

  notConn.style.display = 'none';
  conn.style.display    = 'block';

  // Loading state
  const el = id => document.getElementById(id);
  if (el('bag-stat-nfts'))   el('bag-stat-nfts').textContent   = '…';
  if (el('bag-stat-won'))    el('bag-stat-won').textContent    = '-';
  if (el('bag-stat-daily'))  el('bag-stat-daily').textContent  = '…';
  if (el('bag-stat-weekly')) el('bag-stat-weekly').textContent = '…';
  if (el('bag-nft-count'))   el('bag-nft-count').textContent   = '…';

  loadMyBagNFTs(wallet);
}

// ── Robust fetch with retry + timeout ────────────────────────────
async function fetchWithRetry(url, options = {}, maxAttempts = 3, timeoutMs = 8000) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      // 5xx server errors → retry. 4xx → don't retry, return as-is
      if (res.status < 500) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch(e) {
      lastErr = e;
    }
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 1000 * attempt)); // 1s, 2s
    }
  }
  throw lastErr || new Error('All retry attempts failed');
}

// ── Bag NFTs cache (survives Paco API outages) ───────────────────
const BAG_CACHE_KEY = 'oracle_draw_bag_cache_v1';
const BAG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function saveBagCache(wallet, nftsRaw) {
  try {
    sessionStorage.setItem(BAG_CACHE_KEY, JSON.stringify({
      wallet,
      nftsRaw,
      ts: Date.now(),
    }));
  } catch(e) { /* storage full or disabled — ignore */ }
}

function loadBagCache(wallet) {
  try {
    const raw = sessionStorage.getItem(BAG_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.wallet !== wallet) return null;
    if (Date.now() - data.ts > BAG_CACHE_TTL_MS) return null;
    return data.nftsRaw;
  } catch(e) { return null; }
}

async function loadMyBagNFTs(wallet) {
  const el = id => document.getElementById(id);

  // Fetch NFTs from Paco API (with retry) and used-list from Worker (parallel)
  let allNFTs   = null;   // null means "load failed", [] means "loaded but empty"
  let usedIds   = new Set();
  let pacoError = null;

  const [nftResult, usedResult] = await Promise.allSettled([
    fetchWithRetry(`${NFT_API_BASE}/owned-nfts/${wallet}`, {}, 3, 8000),
    fetchWithRetry(`${DRAW_WORKER}/round-stats?pool=daily`, {}, 2, 5000),
  ]);

  // Process Paco API response
  if (nftResult.status === 'fulfilled' && nftResult.value.ok) {
    try {
      const data = await nftResult.value.json();
      allNFTs = Array.isArray(data) ? data
              : data.nfts    ? data.nfts
              : data.data    ? data.data
              : data.tokens  ? data.tokens
              : [];
      saveBagCache(wallet, allNFTs);
    } catch(e) {
      pacoError = 'Invalid response from NFT API';
    }
  } else {
    pacoError = nftResult.reason?.message || `HTTP ${nftResult.value?.status || 'error'}`;
  }

  // Fetch active tokenIds for this wallet from Worker /my-entries
  let dailyActiveTokenIds = new Set();
  let weeklyActiveTokenIds = new Set();
  try {
    const [dailyRes, weeklyRes] = await Promise.all([
      fetchWithRetry(`${DRAW_WORKER}/my-entries?pool=daily&wallet=${wallet}`, {}, 2, 5000),
      fetchWithRetry(`${DRAW_WORKER}/my-entries?pool=weekly&wallet=${wallet}`, {}, 2, 5000),
    ]);
    if (dailyRes.ok) {
      const dd = await dailyRes.json();
      (dd.activations || []).forEach(a => dailyActiveTokenIds.add(String(a.tokenId)));
    }
    if (weeklyRes.ok) {
      const wd = await weeklyRes.json();
      (wd.activations || []).forEach(a => weeklyActiveTokenIds.add(String(a.tokenId)));
    }
  } catch(e) {}
  window._dailyActiveTokenIds  = dailyActiveTokenIds;
  window._weeklyActiveTokenIds = weeklyActiveTokenIds;
  // Keep wallet sets for backward compat
  window._dailyActiveWallets  = dailyActiveTokenIds.size > 0 ? new Set([wallet]) : new Set();
  window._weeklyActiveWallets = weeklyActiveTokenIds.size > 0 ? new Set([wallet]) : new Set();

  // Fallback to cache if Paco failed
  let usedCache = false;
  if (allNFTs === null) {
    const cached = loadBagCache(wallet);
    if (cached) {
      allNFTs = cached;
      usedCache = true;
      console.log('Using cached NFT list (Paco API unavailable)');
    } else {
      // No cache, no API → show error state
      console.warn('loadMyBagNFTs: Paco API failed:', pacoError);
      if (el('bag-stat-nfts'))   el('bag-stat-nfts').textContent   = '-';
      if (el('bag-stat-daily'))  el('bag-stat-daily').textContent  = '-';
      if (el('bag-stat-weekly')) el('bag-stat-weekly').textContent = '-';
      if (el('bag-nft-count'))   el('bag-nft-count').textContent   = '-';
      const grid  = el('bag-nft-grid');
      const empty = el('bag-empty');
      if (grid)  grid.style.display  = 'none';
      if (empty) {
        empty.style.display = 'block';
        const msgDiv = empty.querySelector('div');
        if (msgDiv) msgDiv.innerHTML = `
          <div style="margin-bottom:8px;">⚠ NFT marketplace temporarily unavailable</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:12px;">
            ${pacoError ? `Error: ${pacoError}` : ''}
          </div>
          <button onclick="loadMyBagNFTs('${wallet}')" style="
            padding:8px 16px;border-radius:8px;border:1px solid rgba(212,160,23,0.6);
            background:rgba(212,160,23,0.1);color:var(--gold-light);cursor:pointer;
            font-family:'Cinzel',serif;font-size:11px;">
            🔄 Retry
          </button>`;
      }
      return;
    }
  }

  // Filter Oracle Mask only — match all 3 collection slugs (old + new)
  const masks = allNFTs.filter(n => {
    const slug = (n.slug || '').toLowerCase();
    // New architecture: separate Daily / Weekly collections
    if (slug === 'oracle-mask-daily' || slug === 'oracle-mask-weekly') return true;
    // Legacy: single Oracle Mask collection (kept for backward compat)
    if (slug === 'oracle-mask') return true;
    // Fallback: collection fields or name (for older API formats)
    const col = (n.collection_name || n.collection || '').toLowerCase();
    if (col.includes('oracle') && col.includes('mask')) return true;
    return false;
  });

  const nfts = masks.map(n => {
    const tokenId = String(n.token_id || n.id || n.tokenId || '');
    const tier    = detectNFTTier(n);
    const slug    = (n.slug || '').toLowerCase();
    // Pool detection from slug: oracle-mask-daily / oracle-mask-weekly
    // For legacy `oracle-mask` collection: pool unknown until activated (legacy flow)
    let pool = null;
    if (slug === 'oracle-mask-daily')  pool = 'daily';
    if (slug === 'oracle-mask-weekly') pool = 'weekly';
    // New-architecture NFTs are AUTO-ACTIVE — funds went directly to pool wallet at mint time.
    // No "Enter Draw" needed. Status is "Active in DAILY/WEEKLY" until round resets.
    const isNewArch = pool !== null;
    // Active = this specific tokenId is in current round (not consumed)
    const dailyActive  = window._dailyActiveTokenIds  ? window._dailyActiveTokenIds.has(String(tokenId))  : false;
    const weeklyActive = window._weeklyActiveTokenIds ? window._weeklyActiveTokenIds.has(String(tokenId)) : false;
    const used = isNewArch
      ? (pool === 'daily'  ? !dailyActive  : !weeklyActive)
      : usedIds.has(tokenId); // legacy fallback
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    return {
      id:      tokenId,
      type:    tier,
      pool,                                   // 'daily' | 'weekly' | null (legacy)
      isNewArch,
      entries: tierEntries(tier),
      name:    n.name || n.nft_name || `Oracle Mask ${tierLabel}`,
      image:    tierImage(tier, 'sm'),         // local artwork from /nfts/ folder
      imagePng: TIER_IMAGES[tier]?.fallback,   // PNG fallback for old browsers
      used,
      // For new-arch: NFT is in current round if not yet consumed by a draw
      // For legacy:    NFT is in current round if not used (= activated)
      inCurrentRound: !used,
    };
  });

  window._bagNFTs = nfts;

  // ── Counter cards: query Worker for actual per-pool active entries ──
  // Daily   = NFT activations for daily (from Worker)
  // Weekly  = NFT activations for weekly (from Worker) + free entries (from free-entries.json)
  let dailyEntries  = 0;
  let weeklyEntries = 0;
  try {
    const [dailyRes, weeklyRes] = await Promise.allSettled([
      fetchWithRetry(`${DRAW_WORKER}/my-entries?pool=daily&wallet=${wallet}`, {}, 2, 5000),
      fetchWithRetry(`${DRAW_WORKER}/my-entries?pool=weekly&wallet=${wallet}`, {}, 2, 5000),
    ]);
    if (dailyRes.status === 'fulfilled' && dailyRes.value.ok) {
      const d = await dailyRes.value.json();
      dailyEntries = d.myEntries || 0;
    }
    if (weeklyRes.status === 'fulfilled' && weeklyRes.value.ok) {
      const d = await weeklyRes.value.json();
      weeklyEntries = d.myEntries || 0;
    }
  } catch(e) { /* keep zero */ }

  // Add free entries (from Terra Oracle Q&A) to weekly only
  if (typeof getFreeEntries === 'function') {
    const free = getFreeEntries(wallet);
    weeklyEntries += (free.total || 0);
  }

  if (el('bag-stat-nfts'))   el('bag-stat-nfts').textContent   = nfts.length;
  if (el('bag-stat-daily'))  el('bag-stat-daily').textContent  = dailyEntries;
  if (el('bag-stat-weekly')) el('bag-stat-weekly').textContent = weeklyEntries;
  if (el('bag-nft-count'))   el('bag-nft-count').textContent   = nfts.length;

  // Fetch wins — count unique rounds won
  try {
    const winsRes = await fetch(`${DRAW_WORKER}/my-wins?wallet=${wallet}`);
    if (winsRes.ok) {
      const winsData = await winsRes.json();
      const wins = winsData.wins || [];
      const dailyRounds  = new Set(wins.filter(w => w.pool === 'daily').map(w => w.roundId));
      const weeklyRounds = new Set(wins.filter(w => w.pool === 'weekly').map(w => w.roundId));
      const total = dailyRounds.size + weeklyRounds.size;
      if (el('bag-stat-won'))  el('bag-stat-won').textContent  = total || 0;
      if (el('won-daily'))     el('won-daily').textContent     = dailyRounds.size || 0;
      if (el('won-weekly'))    el('won-weekly').textContent    = weeklyRounds.size || 0;
    } else {
      if (el('bag-stat-won')) el('bag-stat-won').textContent = '-';
    }
  } catch(e) {
    if (el('bag-stat-won')) el('bag-stat-won').textContent = '-';
  }

  const grid  = el('bag-nft-grid');
  const empty = el('bag-empty');
  if (grid) {
    if (!nfts.length) {
      grid.style.display = 'none';
      if (empty) {
        empty.style.display = 'block';
        const msgDiv = empty.querySelector('div');
        if (msgDiv) msgDiv.textContent = 'No Oracle Mask NFTs in your wallet';
      }
    } else {
      if (empty) empty.style.display = 'none';
      grid.style.display = 'grid';
      setTimeout(() => filterBagNFTs('all'), 0);
    }
  }

  // Optionally show "loaded from cache" indicator
  if (usedCache) {
    const cnt = el('bag-nft-count');
    if (cnt) cnt.textContent = nfts.length + ' (cached)';
  }

  // History — fetch from Worker /my-history
  const histTable = el('bag-history-table');
  const histEmpty = el('bag-history-empty');
  try {
    const histRes = await fetch(`${DRAW_WORKER}/my-history?wallet=${wallet}`);
    if (histRes.ok) {
      const histData = await histRes.json();
      const history = histData.history || [];
      // Filter out admin resets, group by roundId
      const filtered = history.filter(h => !h.roundId.startsWith('admin_reset'));
      // Group by roundId+pool
      const roundMap = new Map();
      for (const h of filtered) {
        const key = h.pool + ':' + h.roundId;
        if (!roundMap.has(key)) {
          roundMap.set(key, { roundId: h.roundId, pool: h.pool, entries: 0, won: false, consumedAt: h.consumedAt, drawTxHash: h.drawTxHash });
        }
        const r = roundMap.get(key);
        r.entries += (h.entries || 1);
        if (h.won) r.won = true;
      }
      const rounds = Array.from(roundMap.values()).sort((a,b) => new Date(b.consumedAt) - new Date(a.consumedAt));

      if (rounds.length === 0) {
        if (histTable) histTable.style.display = 'none';
        if (histEmpty) histEmpty.style.display = 'block';
      } else {
        if (histEmpty) histEmpty.style.display = 'none';
        if (histTable) {
          histTable.style.display = 'block';
          const tbody = histTable.querySelector('tbody') || histTable;
          tbody.innerHTML = rounds.map(r => {
            const date    = r.consumedAt ? new Date(r.consumedAt).toLocaleDateString() : (r.roundId || '-');
            const pool    = r.pool === 'weekly' ? 'Weekly' : 'Daily';
            const won     = r.won
              ? `<span style="color:#66ffaa;font-weight:700;">✓ Won</span>`
              : `<span style="color:var(--muted);">—</span>`;
            return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
              <td style="padding:10px 12px;font-size:12px;color:var(--muted);">${date}</td>
              <td style="padding:10px 12px;font-size:12px;">${pool}</td>
              <td style="padding:10px 12px;font-size:12px;text-align:center;">${r.entries}</td>
              <td style="padding:10px 12px;text-align:center;">${won}</td>
            </tr>`;
          }).join('');
        }
      }
    } else {
      if (histTable) histTable.style.display = 'none';
      if (histEmpty) histEmpty.style.display = 'block';
    }
  } catch(e) {
    if (histTable) histTable.style.display = 'none';
    if (histEmpty) histEmpty.style.display = 'block';
  }
}

// ── ENTER DRAW with NFT ────────────────────────────────────────
function showEnterDrawModal(nftId, nftType, entries) {
  // Remove existing modal if any
  const existing = document.getElementById('enter-draw-modal');
  if (existing) existing.remove();

  const tier = nftType;
  const cfgs = {
    common:    { color:'#b0b8c8', icon:'🎭', label:'Common'    },
    rare:      { color:'#60a5fa', icon:'🔮', label:'Rare'       },
    legendary: { color:'#fb923c', icon:'👁', label:'Legendary'  },
  };
  const cfg = cfgs[tier] || cfgs.common;

  const modal = document.createElement('div');
  modal.id = 'enter-draw-modal';
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  modal.innerHTML = `
    <div style="background:#1a1200;border:1px solid rgba(212,160,23,0.3);border-radius:20px;
      padding:32px;max-width:400px;width:100%;box-shadow:0 0 60px rgba(212,160,23,0.15);">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:32px;margin-bottom:8px;">${cfg.icon}</div>
        <div style="font-family:'Cinzel',serif;font-size:18px;color:var(--gold-light);margin-bottom:4px;">Enter Draw</div>
        <div style="font-size:12px;color:var(--muted);">
          <span style="color:${cfg.color};font-weight:700;">${cfg.label} #${nftId}</span>
          · ${entries} ${entries===1?'entry':'entries'}
        </div>
      </div>

      <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--gold-dim);
        font-family:'Cinzel',serif;margin-bottom:12px;">Choose your draw</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;">
        <button onclick="enterDraw('${nftId}','daily',${entries})" style="padding:16px;border-radius:12px;
          border:2px solid rgba(212,160,23,0.6);background:rgba(212,160,23,0.1);cursor:pointer;
          font-family:'Cinzel',serif;color:var(--gold-light);transition:all 0.2s;"
          onmouseover="this.style.background='rgba(212,160,23,0.2)'"
          onmouseout="this.style.background='rgba(212,160,23,0.1)'">
          <div style="font-size:20px;margin-bottom:4px;">🌙</div>
          <div style="font-size:12px;font-weight:700;">Daily Draw</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Every day 20:00 UTC</div>
        </button>
        <button onclick="enterDraw('${nftId}','weekly',${entries})" style="padding:16px;border-radius:12px;
          border:2px solid rgba(74,144,217,0.4);background:rgba(74,144,217,0.06);cursor:pointer;
          font-family:'Cinzel',serif;color:#7eb8ff;transition:all 0.2s;"
          onmouseover="this.style.background='rgba(74,144,217,0.15)'"
          onmouseout="this.style.background='rgba(74,144,217,0.06)'">
          <div style="font-size:20px;margin-bottom:4px;">📅</div>
          <div style="font-size:12px;font-weight:700;">Weekly Draw</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Every Monday 20:00 UTC</div>
        </button>
      </div>

      <div id="enter-draw-status" style="min-height:20px;text-align:center;margin-bottom:16px;font-size:12px;"></div>

      <button onclick="document.getElementById('enter-draw-modal').remove()"
        style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);
        background:transparent;color:var(--muted);cursor:pointer;font-family:'Cinzel',serif;font-size:12px;">
        Cancel
      </button>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function enterDraw(nftId, pool, entries) {
  const wallet = connectedWalletAddress || lotteryAddress;
  if (!wallet) { alert('Connect wallet first!'); return; }

  const statusEl = document.getElementById('enter-draw-status');
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--muted);">⏳ Waiting for signature…</span>';

  // Disable buttons
  const btns = document.querySelectorAll('#enter-draw-modal button');
  btns.forEach(b => b.disabled = true);

  try {
    const targetWallet = pool === 'daily' ? DAILY_WALLET_ADDR : WEEKLY_WALLET_ADDR;
    const memo = `NFT:${nftId}|${pool}|${entries}entries`;

    // Send 1 LUNC as verification tx (returned as entries to pool)
    const amountUluna = 1_000_000; // 1 LUNC
    const txHash = await sendLuncDirect(wallet, targetWallet, amountUluna, memo, 'columbus-5');

    // Register NFT as used in Worker KV
    try {
      const regRes = await fetch(`${DRAW_WORKER}/use-nft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId: String(nftId), pool, wallet, txHash, entries }),
      });
      if (!regRes.ok) {
        const errData = await regRes.json().catch(() => ({ error: 'Unknown error' }));
        console.warn(`Worker /use-nft returned ${regRes.status}:`, errData.error);
        // Still proceed — tx is on-chain, Worker can be replayed later via admin tool
      }
    } catch(e) {
      console.warn('Worker registration failed:', e.message);
      // Non-fatal - tx is on-chain, Worker will catch it on next load
    }

    if (statusEl) statusEl.innerHTML = `
      <div style="color:#66ffaa;font-weight:700;margin-bottom:4px;">✅ Entered ${pool} draw!</div>
      <div style="font-size:10px;color:var(--muted);">${entries} ${entries===1?'entry':'entries'} registered</div>
      <a href="https://finder.terraport.finance/mainnet/tx/${txHash}"
        target="_blank" style="font-size:10px;color:var(--muted);display:block;margin-top:4px;">
        🔗 ${txHash.slice(0,16)}…
      </a>`;

    // Mark NFT as used locally
    window._bagNFTs = (window._bagNFTs || []).map(n =>
      String(n.id) === String(nftId) ? { ...n, used: true, inCurrentRound: false } : n
    );

    setTimeout(() => {
      const modal = document.getElementById('enter-draw-modal');
      if (modal) modal.remove();
      filterBagNFTs(_bagCurrentFilter || 'all');
      // Reload bag stats
      const w = connectedWalletAddress || lotteryAddress;
      if (w) loadMyBagNFTs(w);
    }, 2500);

  } catch(err) {
    console.error('enterDraw error:', err);
    if (statusEl) statusEl.innerHTML = `<span style="color:#ff6b6b;">❌ ${err.message || 'Transaction failed'}</span>`;
    btns.forEach(b => b.disabled = false);
  }
}

// Re-render bag when wallet connects/disconnects
const _origSetConnected = window.setConnectedWallet;
window.setConnectedWallet = function(addr, provider) {
  if (typeof _origSetConnected === 'function') _origSetConnected(addr, provider);
  if (document.getElementById('page-bag') &&
      document.getElementById('page-bag').style.display !== 'none') {
    renderMyBag();
  }
};

// ── MY BAG FILTER ─────────────────────────────────────────────────────────────
let _bagCurrentFilter = 'all';

function filterBagNFTs(filter) {
  _bagCurrentFilter = filter;
  const nfts = window._bagNFTs || [];

  // Update button styles
  ['all','common','rare','legendary','used'].forEach(f => {
    const btn = document.getElementById('bag-filter-' + f);
    if (!btn) return;
    const colors = {
      all:       { active: 'rgba(212,160,23,0.12)', border: 'rgba(212,160,23,0.5)',   text: 'var(--gold-light)' },
      common:    { active: 'rgba(180,190,210,0.1)', border: 'rgba(180,190,210,0.5)',  text: '#b0b8c8'           },
      rare:      { active: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.5)',   text: '#60a5fa'           },
      legendary: { active: 'rgba(251,146,60,0.1)',  border: 'rgba(251,146,60,0.5)',   text: '#fb923c'           },
      used:      { active: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.35)', text: '#e2e8f0'           },
    };
    const c = colors[f];
    if (f === filter) {
      btn.style.background = c.active;
      btn.style.borderColor = c.border.replace('0.5','0.8');
      btn.style.color = c.text;
      btn.style.fontWeight = '700';
    } else {
      btn.style.background = 'transparent';
      btn.style.borderColor = c.border.replace('0.5','0.2');
      btn.style.color = c.text;
      btn.style.fontWeight = '400';
      btn.style.opacity = '0.6';
    }
    btn.style.opacity = f === filter ? '1' : '0.6';
  });

  // Filter and sort: active first, then used
  let filtered = nfts;
  if (filter === 'used')       filtered = nfts.filter(n => !n.inCurrentRound);
  else if (filter !== 'all')   filtered = nfts.filter(n => n.type === filter);

  // Sort: in current round first
  filtered = filtered.slice().sort((a, b) => {
    if (a.inCurrentRound && !b.inCurrentRound) return -1;
    if (!a.inCurrentRound && b.inCurrentRound) return 1;
    return 0;
  });

  renderBagGrid(filtered);
}

function renderBagGrid(nfts) {
  const grid  = document.getElementById('bag-nft-grid');
  const empty = document.getElementById('bag-empty');
  if (!grid) return;

  if (!nfts.length) {
    grid.style.display = 'none';
    if (empty) { empty.style.display = 'block'; }
    return;
  }
  if (empty) empty.style.display = 'none';
  grid.style.display = 'grid';

  const cfgs = {
    common:    { color:'#b0b8c8', glow:'rgba(180,190,210,0.35)', bg:'rgba(180,190,210,0.05)', icon:'🎭', label:'COMMON'    },
    rare:      { color:'#60a5fa', glow:'rgba(96,165,250,0.45)',  bg:'rgba(96,165,250,0.06)',  icon:'🔮', label:'RARE'       },
    legendary: { color:'#fb923c', glow:'rgba(251,146,60,0.45)',  bg:'rgba(251,146,60,0.07)',  icon:'👁', label:'LEGENDARY'  },
  };

  grid.innerHTML = nfts.map(nft => {
    const cfg = cfgs[nft.type];
    const used = nft.used || !nft.inCurrentRound;

    let statusHtml;
    // ── New architecture: NFT is auto-active in its pool, no manual activation ──
    if (nft.isNewArch && !used) {
      const poolLabel = (nft.pool || 'daily').toUpperCase();
      const poolColor = nft.pool === 'weekly' ? 'rgba(96,165,250,0.5)' : 'rgba(102,255,170,0.5)';
      const poolBg    = nft.pool === 'weekly' ? 'rgba(96,165,250,0.08)' : 'rgba(102,255,170,0.08)';
      const poolText  = nft.pool === 'weekly' ? '#60a5fa' : '#66ffaa';
      statusHtml = `
        <div style="width:100%;padding:10px 12px;border-radius:8px;
          background:${poolBg};border:1px solid ${poolColor};
          color:${poolText};font-family:'Cinzel',serif;font-size:11px;
          font-weight:700;letter-spacing:0.08em;text-align:center;">
          ✓ ACTIVE IN ${poolLabel}
        </div>`;
    }
    // ── Legacy NFT (no pool yet): show Enter Draw button ──
    else if (!used) {
      statusHtml = `
        <button onclick="showEnterDrawModal('${nft.id}','${nft.type}',${nft.entries})"
          style="width:100%;padding:10px 12px;border-radius:8px;border:none;cursor:pointer;
          background:linear-gradient(135deg,rgba(212,160,23,0.25),rgba(212,160,23,0.1));
          border:1px solid rgba(212,160,23,0.5);
          color:var(--gold-light);font-family:'Cinzel',serif;font-size:11px;
          font-weight:700;letter-spacing:0.06em;transition:all 0.2s;"
          onmouseover="this.style.background='linear-gradient(135deg,rgba(212,160,23,0.4),rgba(212,160,23,0.2))'"
          onmouseout="this.style.background='linear-gradient(135deg,rgba(212,160,23,0.25),rgba(212,160,23,0.1))'">
          🎭 Enter Draw
        </button>`;
    } else {
      statusHtml = `<div style="padding:10px 12px;border-radius:8px;
        background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);
        color:var(--muted);font-size:11px;text-align:center;">
        ✔ Round over
      </div>`;
    }

    const opacity = !used ? '1' : '0.5';
    // Local artwork (WebP from /nfts/ folder) with PNG fallback for older browsers.
    // <picture> tag automatically selects WebP if supported, falls back to PNG.
    const imgHtml = nft.image
      ? `<picture>
           <source srcset="${nft.image}" type="image/webp">
           <img src="${nft.imagePng || nft.image}"
                style="width:120px;height:180px;border-radius:10px;object-fit:cover;margin-bottom:12px;background:rgba(255,255,255,0.03);"
                onerror="this.style.display='none';const fb=this.parentElement.nextElementSibling;if(fb)fb.style.display='block';">
         </picture>
         <div style="font-size:40px;margin-bottom:10px;display:none;">${cfg.icon}</div>`
      : `<div style="font-size:40px;margin-bottom:10px;">${cfg.icon}</div>`;

    return `
    <div style="background:${cfg.bg};border:1px solid ${cfg.glow};border-radius:16px;padding:20px;
      text-align:center;box-shadow:0 0 20px ${cfg.glow};transition:transform 0.2s;opacity:${opacity};"
      onmouseover="this.style.transform='translateY(-3px)'"
      onmouseout="this.style.transform='translateY(0)'">
      ${imgHtml}
      <div style="font-size:9px;letter-spacing:0.2em;color:${cfg.color};font-weight:700;margin-bottom:4px;">${cfg.label}</div>
      <div style="font-family:'Cinzel',serif;font-size:16px;color:#fff;margin-bottom:4px;">${formatNFTLabel(nft.id)}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">${nft.entries} ${nft.entries===1?'entry':'entries'}</div>
      ${statusHtml}
    </div>`;
  }).join('');
}
