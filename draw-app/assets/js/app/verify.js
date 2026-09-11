// ─── VERIFY TICKETS ──────────────────────────────────────────────────────────
function verifyKeplrAddress() {
  // Use any connected wallet address
  const addr = connectedWalletAddress || lotteryAddress;
  if (addr) {
    document.getElementById('verify-input').value = addr;
    verifyTickets();
  } else {
    // No wallet connected - prompt to connect
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
    emptyEl.innerHTML = '<span style="color:#ff6060;"><svg class="oi oi--amber"><use href="#i-warning"/></svg> Address must start with terra1...</span>';
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
  const poolPrize = totalTix * pricePerTix * PRIZE_SHARE;
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
          ${tx.txhash.slice(0,12)}...${tx.txhash.slice(-6)} <svg class="oi oi--cyan"><use href="#i-link"/></svg>
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
// Полностью в блоке VERIFY v2 в конце файла: расчёт, отрисовка и выбор раунда.
