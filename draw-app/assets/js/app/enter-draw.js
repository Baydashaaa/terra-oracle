// ── ENTER DRAW with NFT ────────────────────────────────────────
function showEnterDrawModal(nftId, nftType, entries) {
  // Remove existing modal if any
  const existing = document.getElementById('enter-draw-modal');
  if (existing) existing.remove();

  const tier = nftType;
  const cfgs = {
    common:    { color:'#b0b8c8', icon:'<svg class="oi oi--muted"><use href="#i-mask"/></svg>', label:'Common'    },
    rare:      { color:'#60a5fa', icon:'<svg class="oi oi--cyan"><use href="#i-orb"/></svg>', label:'Rare'       },
    legendary: { color:'#fb923c', icon:'<svg class="oi oi--amber"><use href="#i-eye"/></svg>', label:'Legendary'  },
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
          <div style="font-size:20px;margin-bottom:4px;"><svg class="oi oi--gold"><use href="#i-reels"/></svg></div>
          <div style="font-size:12px;font-weight:700;">Daily Draw</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Daily 20:00 UTC · except Mon</div>
        </button>
        <button onclick="enterDraw('${nftId}','weekly',${entries})" style="padding:16px;border-radius:12px;
          border:2px solid rgba(74,144,217,0.4);background:rgba(74,144,217,0.06);cursor:pointer;
          font-family:'Cinzel',serif;color:#7eb8ff;transition:all 0.2s;"
          onmouseover="this.style.background='rgba(74,144,217,0.15)'"
          onmouseout="this.style.background='rgba(74,144,217,0.06)'">
          <div style="font-size:20px;margin-bottom:4px;"><svg class="oi oi--cyan"><use href="#i-trophy"/></svg></div>
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
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--muted);"><svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Waiting for signature…</span>';

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
        // Still proceed - tx is on-chain, Worker can be replayed later via admin tool
      }
    } catch(e) {
      console.warn('Worker registration failed:', e.message);
      // Non-fatal - tx is on-chain, Worker will catch it on next load
    }

    if (statusEl) statusEl.innerHTML = `
      <div style="color:#66ffaa;font-weight:700;margin-bottom:4px;"><svg class="oi oi--green"><use href="#i-check"/></svg> Entered ${pool} draw!</div>
      <div style="font-size:10px;color:var(--muted);">${entries} ${entries===1?'entry':'entries'} registered</div>
      <a href="https://finder.terraport.finance/mainnet/tx/${txHash}"
        target="_blank" style="font-size:10px;color:var(--muted);display:block;margin-top:4px;">
        <svg class="oi oi--cyan"><use href="#i-link"/></svg> ${txHash.slice(0,16)}…
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
    if (statusEl) statusEl.innerHTML = `<span style="color:#ff6b6b;"><svg class="oi oi--red"><use href="#i-cross"/></svg> ${err.message || 'Transaction failed'}</span>`;
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
