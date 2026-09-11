// ── MY BAG ────────────────────────────────────────────────────────────────────
// (NFT_API_BASE / DRAW_WORKER constants moved to top of file to avoid TDZ errors)

// Токены берутся из контракта через OracleNFT.getContractTokensLegacy.
// Прежние id коллекций на nft.lunc.tools (сервис отключён 31 авг 2026):
//   134 = Common   (25,000 LUNC, 1 entry)
//   135 = Rare     (125,000 LUNC, 5 entries)
//   136 = Legendary (250,000 LUNC, 10 entries)
const NFT_ID_TO_TIER = { 134: 'common', 135: 'rare', 136: 'legendary' };

function detectNFTTier(nft) {
  // Contract tokens carry their tier explicitly in metadata - no guessing.
  if (nft.tier && ['common','rare','legendary'].includes(String(nft.tier).toLowerCase())) {
    return String(nft.tier).toLowerCase();
  }
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
// Much faster than IPFS gateways - served directly from GitHub Pages / Cloudflare CDN.
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

// BAG_CACHE_* constants moved to top of file (TDZ fix)
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

  const el = id => document.getElementById(id);

  // ── Instant paint from cache (stale-while-revalidate, client-side) ──
  // If we have ANY cached NFT list for this wallet (even 30 min old), render
  // it immediately - no blank/"…" wait. loadMyBagNFTs() then refreshes in
  // the background and silently updates once fresh data arrives.
  const cachedNfts = loadBagCache(wallet, BAG_CACHE_MAX_AGE_MS);
  if (cachedNfts) {
    renderBagFromNFTs(wallet, cachedNfts, { fromCache: true });
  } else {
    // No cache at all - first-ever load for this wallet. Be explicit that
    // this is LOADING, not "no NFTs", so it doesn't look frozen/broken.
    if (el('bag-stat-nfts'))   el('bag-stat-nfts').textContent   = '…';
    if (el('bag-stat-won'))    el('bag-stat-won').textContent    = '-';
    if (el('bag-stat-daily'))  el('bag-stat-daily').textContent  = '…';
    if (el('bag-stat-weekly')) el('bag-stat-weekly').textContent = '…';
    if (el('bag-nft-count'))   el('bag-nft-count').textContent   = '…';
    const grid  = el('bag-nft-grid');
    const empty = el('bag-empty');
    if (grid)  grid.style.display  = 'none';
    if (empty) {
      empty.style.display = 'block';
      const msgDiv = empty.querySelector('div');
      if (msgDiv) msgDiv.innerHTML = `
        <div style="margin-bottom:8px;"><svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Loading your Oracle Masks…</div>
        <div style="font-size:11px;color:var(--muted);">First load can take up to ~60s if the marketplace API is slow. Later visits load instantly from cache.</div>`;
    }
  }

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

// ── Bag NFTs cache (survives Paco API outages AND tab close) ────────

function saveBagCache(wallet, nftsRaw) {
  try {
    localStorage.setItem(BAG_CACHE_KEY, JSON.stringify({ wallet, nftsRaw, ts: Date.now() }));
  } catch(e) { /* storage full or disabled - ignore */ }
}

function loadBagCache(wallet, maxAgeMs = BAG_CACHE_TTL_MS) {
  try {
    const raw = localStorage.getItem(BAG_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.wallet !== wallet) return null;
    if (Date.now() - data.ts > maxAgeMs) return null;
    return data.nftsRaw;
  } catch(e) { return null; }
}

async function loadMyBagNFTs(wallet) {
  const el = id => document.getElementById(id);

  // Collection now comes 100% from our own contract (Paco removed).
  // allNFTs starts empty; the contract merge below fills it.
  let allNFTs   = [];
  let usedIds   = new Set();
  let pacoError = null;

  // Warm the round-stats cache (used elsewhere on the page); no NFT source here.
  try { await fetchWithRetry(`${DRAW_WORKER}/round-stats?pool=daily`, {}, 1, 5000); } catch(e) {}

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
          <div style="margin-bottom:8px;"><svg class="oi oi--amber"><use href="#i-warning"/></svg> NFT marketplace temporarily unavailable</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:12px;">
            ${pacoError ? `Error: ${pacoError}` : ''}
          </div>
          <button onclick="loadMyBagNFTs('${wallet}')" style="
            padding:8px 16px;border-radius:8px;border:1px solid rgba(212,160,23,0.6);
            background:rgba(212,160,23,0.1);color:var(--gold-light);cursor:pointer;
            font-family:'Cinzel',serif;font-size:11px;">
            <svg class="oi oi--cyan"><use href="#i-refresh"/></svg> Retry
          </button>`;
      }
      // NB: раньше здесь стоял `return;`, из-за которого падение Paco скрывало
      // и новую контрактную коллекцию. Вместо выхода - пустой список, чтобы
      // рендер дошёл и показал контрактные NFT (их подмешиваем ниже).
      allNFTs = [];
    }
  }

  // ── Новая коллекция из собственного контракта ──────────────────────────────
  // Независимо от Paco: если контракт недоступен - вернётся [] и страница
  // отрисуется старой коллекцией; если Paco упал - отрисуется контрактной.
  try {
    if (window.OracleNFT && typeof OracleNFT.getContractTokensLegacy === 'function') {
      const contractNfts = await OracleNFT.getContractTokensLegacy(wallet);
      if (Array.isArray(contractNfts) && contractNfts.length) {
        allNFTs = contractNfts.concat(Array.isArray(allNFTs) ? allNFTs : []);
      }
    }
  } catch (e) {
    console.warn('[bag] contract collection unavailable:', e.message);
  }
  if (allNFTs === null) allNFTs = [];

  await renderBagFromNFTs(wallet, allNFTs, { usedIds, pacoError, usedCache });
}

// ── Pure render: takes an already-fetched NFT list and paints the whole
// My Bag page (masks grid, stat counters, history). Called both for an
// instant cache-paint (meta.fromCache=true) and after a real fetch resolves,
// so the UI never sits on ambiguous "…" placeholders longer than necessary.
async function renderBagFromNFTs(wallet, allNFTs, meta = {}) {
  const { usedIds = new Set(), pacoError = null, usedCache = false, fromCache = false } = meta;
  const el = id => document.getElementById(id);

  // Filter Oracle Mask only - match all 3 collection slugs (old + new)
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
    // New-architecture NFTs are AUTO-ACTIVE - funds went directly to pool wallet at mint time.
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

  // Fetch wins - count unique rounds won
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

  // Show a "cached" indicator - instant-paint from cache still refreshing,
  // or fallback-to-cache because the live API failed.
  if (usedCache || fromCache) {
    const cnt = el('bag-nft-count');
    if (cnt) cnt.textContent = nfts.length + (fromCache ? ' (refreshing…)' : ' (cached)');
  }

  // History - fetch from Worker /my-history
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
              : `<span style="color:var(--muted);">-</span>`;
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
