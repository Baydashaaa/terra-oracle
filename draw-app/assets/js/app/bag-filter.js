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
    common:    { color:'#b0b8c8', glow:'rgba(180,190,210,0.35)', bg:'rgba(180,190,210,0.05)', icon:'<svg class="oi oi--muted"><use href="#i-mask"/></svg>', label:'COMMON'    },
    rare:      { color:'#60a5fa', glow:'rgba(96,165,250,0.45)',  bg:'rgba(96,165,250,0.06)',  icon:'<svg class="oi oi--cyan"><use href="#i-orb"/></svg>', label:'RARE'       },
    legendary: { color:'#fb923c', glow:'rgba(251,146,60,0.45)',  bg:'rgba(251,146,60,0.07)',  icon:'<svg class="oi oi--amber"><use href="#i-eye"/></svg>', label:'LEGENDARY'  },
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
          <svg class="oi oi--violet"><use href="#i-mask"/></svg> Enter Draw
        </button>`;
    } else {
      statusHtml = `<div style="padding:10px 12px;border-radius:8px;
        background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);
        color:var(--muted);font-size:11px;text-align:center;">
        <svg class="oi oi--green"><use href="#i-check"/></svg> Round over
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
