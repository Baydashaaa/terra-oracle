// ─── AMINO SIGNING HELPER (no cosmjs) ────────────────────────────────────────
// ── Active wallet provider routing (Keplr / Galaxy Station / Terra Station) ──
// All three expose a Keplr-compatible signer (getOfflineSigner + signDirect).
// Galaxy/Station nest that interface under `.keplr`; we fall back to the object
// itself, which also carries getOfflineSigner. Keplr stays `window.keplr`, so the
// Keplr path is byte-for-byte unchanged.
function setActiveProvider(p) {
  window._activeWalletProvider = p;
  try { localStorage.setItem('wallet_provider', p); } catch(e) {}
}
function getActiveProvider() {
  if (window._activeWalletProvider) return window._activeWalletProvider;
  try { return localStorage.getItem('wallet_provider') || 'keplr'; } catch(e) { return 'keplr'; }
}
function getActiveKeplr() {
  const p = getActiveProvider();
  if (p === 'luncdash') return null; // view-only: address entered manually, no signer available
  if (p === 'galaxy') { const g = window.galaxyStation; if (g) return g.keplr || g; }
  if (p === 'station') { const s = window.station || window.galaxyStation; if (s) return s.keplr || s; }
  return window.keplr;
}
const VIEW_ONLY_MSG = 'This wallet was connected by address only (view-only). To sign transactions, connect via Keplr, Galaxy Station or Terra Station.';
async function enableActive(chainId) {
  const k = getActiveKeplr();
  if (k && typeof k.enable === 'function') { try { await k.enable(chainId); } catch(e) {} }
  return k;
}

async function sendLuncDirect(fromAddr, toAddr, amountUluna, memo, chainId) {
  const LCD   = 'https://terra-classic-lcd.publicnode.com';
  const CHAIN = chainId || 'columbus-5';

  // Get account info
  const accRes  = await fetch(`${LCD}/cosmos/auth/v1beta1/accounts/${fromAddr}`);
  const accData = await accRes.json();
  const acct    = accData?.account || {};
  const accountNumber = parseInt(acct.account_number || '0');
  const sequence      = parseInt(acct.sequence || '0');

  // Fee = gas + 0.5% tax
  const gasLimit = 300000;
  const gasFee   = Math.ceil(gasLimit * 28.325);
  const taxFee   = Math.ceil(amountUluna * 0.005);
  const totalFee = gasFee + taxFee;

  // Protobuf helpers
  function encodeVarint(n) { n=Number(n); const b=[]; while(n>127){b.push((n&0x7f)|0x80);n=Math.floor(n/128);}b.push(n&0x7f);return new Uint8Array(b); }
  function encodeField(f,w,d){const t=encodeVarint((f<<3)|w);if(w===2){const l=encodeVarint(d.length);const o=new Uint8Array(t.length+l.length+d.length);o.set(t);o.set(l,t.length);o.set(d,t.length+l.length);return o;}return t;}
  function concat(...a){const tot=a.reduce((s,x)=>s+x.length,0);const o=new Uint8Array(tot);let off=0;for(const x of a){o.set(x,off);off+=x.length;}return o;}
  const enc = new TextEncoder();

  // MsgSend
  const coinP  = concat(encodeField(1,2,enc.encode('uluna')), encodeField(2,2,enc.encode(String(amountUluna))));
  const msgSP  = concat(encodeField(1,2,enc.encode(fromAddr)), encodeField(2,2,enc.encode(toAddr)), encodeField(3,2,coinP));
  const anyMsg = concat(encodeField(1,2,enc.encode('/cosmos.bank.v1beta1.MsgSend')), encodeField(2,2,msgSP));
  const txBodyP = concat(encodeField(1,2,anyMsg), encodeField(2,2,enc.encode(memo)));

  // Get pubkey from Keplr
  const directSigner = getActiveKeplr().getOfflineSigner(CHAIN);
  const accounts = await directSigner.getAccounts();
  const pubkeyB   = accounts[0].pubkey;
  const pubkeyAny = concat(
    encodeField(1,2,enc.encode('/cosmos.crypto.secp256k1.PubKey')),
    encodeField(2,2,encodeField(1,2,pubkeyB))
  );

  // ModeInfo: SIGN_MODE_DIRECT = 1
  const modeInfoP = encodeField(1,2,concat(encodeVarint((1<<3)|0), encodeVarint(1)));

  // SignerInfo
  const signerP = concat(
    encodeField(1,2,pubkeyAny),
    encodeField(2,2,modeInfoP),
    encodeVarint((3<<3)|0), encodeVarint(sequence)
  );

  // Fee
  const feeCoinP  = concat(encodeField(1,2,enc.encode('uluna')), encodeField(2,2,enc.encode(String(totalFee))));
  const feeP      = concat(encodeField(1,2,feeCoinP), encodeVarint((2<<3)|0), encodeVarint(gasLimit));
  const authInfoP = concat(encodeField(1,2,signerP), encodeField(2,2,feeP));

  // Sign with signDirect
  const { signed, signature } = await directSigner.signDirect(fromAddr, {
    bodyBytes:     txBodyP,
    authInfoBytes: authInfoP,
    chainId:       CHAIN,
    accountNumber: BigInt(accountNumber),
  });

  // Use signed bytes (Keplr may have modified them)
  const finalBody     = signed.bodyBytes     || txBodyP;
  const finalAuthInfo = signed.authInfoBytes || authInfoP;
  const sigB          = Uint8Array.from(atob(signature.signature), c=>c.charCodeAt(0));
  const txRawP        = concat(encodeField(1,2,finalBody), encodeField(2,2,finalAuthInfo), encodeField(3,2,sigB));
  // btoa with String.fromCharCode fails on large arrays on mobile - use chunked approach
  let txBase64 = '';
  const chunkSize = 8192;
  for (let i = 0; i < txRawP.length; i += chunkSize) {
    txBase64 += String.fromCharCode(...txRawP.subarray(i, i + chunkSize));
  }
  txBase64 = btoa(txBase64);

  const res  = await fetch(`${LCD}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBase64, mode: 'BROADCAST_MODE_SYNC' }),
  });
  const data   = await res.json();
  const txHash = data?.tx_response?.txhash || data?.txhash;
  const code   = data?.tx_response?.code ?? data?.code ?? 0;
  if (code !== 0) throw new Error('TX failed: ' + (data?.tx_response?.raw_log || JSON.stringify(data)));

  // Poll for confirmation - max 5 × 4s
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const chk = await fetch(`${LCD}/cosmos/tx/v1beta1/txs/${txHash}`);
      if (chk.ok) {
        const chkData = await chk.json();
        if (chkData?.tx_response?.txhash) {
          if ((chkData.tx_response.code ?? 0) !== 0) throw new Error('TX failed on-chain: ' + chkData.tx_response.raw_log);
          return txHash;
        }
      }
    } catch(e) { if (e.message?.includes('TX failed')) throw e; }
  }

  if (code !== 0) throw new Error('TX failed: ' + (data?.tx_response?.raw_log || JSON.stringify(data)));
  return txHash;
}

// ─── FIX 1: Ask - исправлена fee (200,000 LUNC payment) ──────
// ─── Send two MsgSend in one TX (one signature) ───────────────
async function sendTwoMsgsDirect(fromAddr, to1, amount1, to2, amount2, memo, chainId) {
  const LCD   = 'https://terra-classic-lcd.publicnode.com';
  const CHAIN = chainId || 'columbus-5';

  const accRes  = await fetch(`${LCD}/cosmos/auth/v1beta1/accounts/${fromAddr}`);
  const accData = await accRes.json();
  const acct    = accData?.account || {};
  const accountNumber = parseInt(acct.account_number || '0');
  const sequence      = parseInt(acct.sequence || '0');

  const totalAmount = amount1 + amount2;
  // Gas scales with memo length (WritePerByte). 400k was too tight - long
  // questions hit out-of-gas at ~403k. 600k gives comfortable headroom.
  const gasLimit = 600000;
  const gasFee   = Math.ceil(gasLimit * 28.325);
  const taxFee   = Math.ceil(totalAmount * 0.005);
  const totalFee = gasFee + taxFee;

  function encodeVarint(n) { n=Number(n); const b=[]; while(n>127){b.push((n&0x7f)|0x80);n=Math.floor(n/128);}b.push(n&0x7f);return new Uint8Array(b); }
  function encodeField(f,w,d){const t=encodeVarint((f<<3)|w);if(w===2){const l=encodeVarint(d.length);const o=new Uint8Array(t.length+l.length+d.length);o.set(t);o.set(l,t.length);o.set(d,t.length+l.length);return o;}return t;}
  function concat(...a){const tot=a.reduce((s,x)=>s+x.length,0);const o=new Uint8Array(tot);let off=0;for(const x of a){o.set(x,off);off+=x.length;}return o;}
  const enc = new TextEncoder();

  function buildMsgSend(from, to, amount) {
    const coinP = concat(encodeField(1,2,enc.encode('uluna')), encodeField(2,2,enc.encode(String(amount))));
    const msgSP = concat(encodeField(1,2,enc.encode(from)), encodeField(2,2,enc.encode(to)), encodeField(3,2,coinP));
    return concat(encodeField(1,2,enc.encode('/cosmos.bank.v1beta1.MsgSend')), encodeField(2,2,msgSP));
  }

  const anyMsg1 = buildMsgSend(fromAddr, to1, amount1);
  const anyMsg2 = buildMsgSend(fromAddr, to2, amount2);
  const txBodyP = concat(encodeField(1,2,anyMsg1), encodeField(1,2,anyMsg2), encodeField(2,2,enc.encode(memo)));

  const directSigner = getActiveKeplr().getOfflineSigner(CHAIN);
  const accounts = await directSigner.getAccounts();
  const pubkeyB  = accounts[0].pubkey;
  const pubkeyAny = concat(
    encodeField(1,2,enc.encode('/cosmos.crypto.secp256k1.PubKey')),
    encodeField(2,2,encodeField(1,2,pubkeyB))
  );
  const modeInfoP = encodeField(1,2,concat(encodeVarint((1<<3)|0), encodeVarint(1)));
  const signerP   = concat(
    encodeField(1,2,pubkeyAny),
    encodeField(2,2,modeInfoP),
    encodeVarint((3<<3)|0), encodeVarint(sequence)
  );
  const feeCoinP  = concat(encodeField(1,2,enc.encode('uluna')), encodeField(2,2,enc.encode(String(totalFee))));
  const feeP      = concat(encodeField(1,2,feeCoinP), encodeVarint((2<<3)|0), encodeVarint(gasLimit));
  const authInfoP = concat(encodeField(1,2,signerP), encodeField(2,2,feeP));

  const { signed, signature } = await directSigner.signDirect(fromAddr, {
    bodyBytes:     txBodyP,
    authInfoBytes: authInfoP,
    chainId:       CHAIN,
    accountNumber: BigInt(accountNumber),
  });

  const finalBody     = signed.bodyBytes     || txBodyP;
  const finalAuthInfo = signed.authInfoBytes || authInfoP;
  const sigB          = Uint8Array.from(atob(signature.signature), c=>c.charCodeAt(0));
  const txRawP        = concat(encodeField(1,2,finalBody), encodeField(2,2,finalAuthInfo), encodeField(3,2,sigB));

  let txBase64 = '';
  const chunkSize = 8192;
  for (let i = 0; i < txRawP.length; i += chunkSize) {
    txBase64 += String.fromCharCode(...txRawP.subarray(i, i + chunkSize));
  }
  txBase64 = btoa(txBase64);

  const res  = await fetch(`${LCD}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBase64, mode: 'BROADCAST_MODE_SYNC' }),
  });
  const data   = await res.json();
  const txHash = data?.tx_response?.txhash || data?.txhash;
  const code   = data?.tx_response?.code ?? data?.code ?? 0;
  if (code !== 0) throw new Error('TX failed: ' + (data?.tx_response?.raw_log || JSON.stringify(data)));

  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const chk = await fetch(`${LCD}/cosmos/tx/v1beta1/txs/${txHash}`);
      if (chk.ok) {
        const chkData = await chk.json();
        if (chkData?.tx_response?.txhash) {
          if ((chkData.tx_response.code ?? 0) !== 0) throw new Error('TX failed on-chain: ' + chkData.tx_response.raw_log);
          return txHash;
        }
      }
    } catch(e) { if (e.message?.includes('TX failed')) throw e; }
  }
  return txHash;
}

// ── Shared discount calc (canonical, per protocol docs) ──────────────────────
// 1. Streak is fetched first: it provides both the 7-day discount (25%) and the
//    REP multiplier. Effective REP = base REP × streak multiplier - the SAME
//    number the profile page and leaderboard display, so rank always matches.
// 2. Final discount = the HIGHER of rank discount vs streak discount (they do
//    NOT stack). Canonical rules live in profile.js (combineDiscounts et al.).
// Used by both the button price preview and the actual transaction so they always agree.
async function getQuestionDiscountPct(addr) {
  let rankD = 0, streakD = 0, streakMult = 1.0, _streakDays = 0, _rankName = '';

  // ── Streak: 7+ days = 25% discount, and the REP multiplier for ranks ──
  try {
    const sr = await fetch(`${WORKER_URL}/streak?wallet=${addr}`);
    if (sr.ok) {
      const sd = await sr.json();
      _streakDays = sd.currentStreak || 0;
      if (_streakDays >= 7) streakD = (typeof STREAK_QUESTION_DISCOUNT !== 'undefined') ? STREAK_QUESTION_DISCOUNT : 25;
      streakMult = sd.multiplier || 1.0;
    }
  } catch(e) {}

  // ── Base REP, from the contract ───────────────────────────────────────────
  // This decides what someone pays, so it has to be the same number their
  // profile shows. It used to be recomputed here with its own copy of the
  // weights, which is how the discount came to disagree with the visible rank.
  let settled = false;
  try {
    if (typeof fetchOnChainScore === 'function') {
      const chain = await fetchOnChainScore(addr);
      if (chain && chain.rank > 0) {
        // All-time REP alone, matching the profile. If these two ever
        // disagree again, someone pays one rate while seeing another.
        if (typeof getRank === 'function') {
          const rk = getRank(chain.rank);
          rankD = (rk && rk.discount) ? rk.discount : 0;
          _rankName = (rk && rk.name) ? rk.name : '';
        }
        settled = true;
      }
    }
  } catch (e) {}

  // Fallback only, for when the chain is unreachable. Keeps the page usable;
  // the weights here must stay in step with the contract config.
  if (!settled) try {
    let rep = 0;
    // Q&A stats (questions, answers, upvotes)
    let qStats = null;
    if (typeof fetchQuestionStats === 'function') {
      try { qStats = await fetchQuestionStats(addr); } catch(e) {}
    }
    if (qStats) {
      const nQ = (qStats.myQuestions || []).length;
      const nA = (qStats.myAnswers || []).length;
      // Only answer upvotes score. Using the combined tally here inflated the
      // figure the discount is derived from.
      const up = (qStats.answerUpvotes !== undefined ? qStats.answerUpvotes : qStats.totalUpvotes) || 0;
      rep += nQ * 40 + nA * 40 + up * 20;
    }
    // Chat messages
    try {
      const cr = await fetch(`${WORKER_URL}/chat/count?wallet=${addr}`);
      if (cr.ok) { const cd = await cr.json(); rep += (cd.msgCount || cd.total || 0) * 5; }
    } catch(e) {}
    // Draw REP
    try {
      const dr = await fetch(`${WORKER_URL}/rep/draw?wallet=${addr}`);
      if (dr.ok) { const dd = await dr.json(); rep += dd.total || 0; }
    } catch(e) {}
    // Fallback: if everything above failed, use the partial score map
    if (!rep && window._walletScores && window._walletScores[addr]) rep = window._walletScores[addr];

    // Rank is computed on all-time REP alone - same as profile and leaderboard.
    if (typeof getRank === 'function') { const rk = getRank(rep); rankD = (rk && rk.discount) ? rk.discount : 0; _rankName = (rk && rk.name) ? rk.name : ''; }
  } catch(e) {}

  // Higher of the two, never summed (per docs).
  const pct = (typeof combineDiscounts === 'function') ? combineDiscounts(rankD, streakD) : Math.max(rankD, streakD);
  // Stash the breakdown so the price panel can show the WHY (streak vs rank)
  // without re-fetching everything.
  getQuestionDiscountPct._last = { pct, rankD, streakD, streakDays: _streakDays, rankName: _rankName };
  return pct;
}

// Update the verify button text with the user's real (discounted) price.
// Also fills the price panel above the button: base (struck through), the
// personal price, and a badge explaining WHY (streak vs rank) - driven by
// the breakdown stashed in getQuestionDiscountPct._last.
async function updateVerifyBtnPrice(addr) {
  try {
    const discPct = await getQuestionDiscountPct(addr);
    const tier    = getSelectedTier();
    const price   = tier.total - Math.round(tier.total * (discPct / 100));
    const btnEl   = document.getElementById('verify-btn');
    if (btnEl) {
      const disc = discPct > 0 ? ` (${discPct}% off)` : '';
      btnEl.textContent = `Pay ${price.toLocaleString()} LUNC & Unlock →${disc}`;
    }
    const nowEl   = document.getElementById('ask-price-now');
    const baseEl  = document.getElementById('ask-price-base');
    const badgeEl = document.getElementById('ask-price-badge');
    const badgeTx = document.getElementById('ask-price-badge-text');
    if (nowEl) nowEl.innerHTML = 'Your price: <b>' + price.toLocaleString() + ' LUNC</b>';
    // Base price is per-tariff, so it can't stay static in the HTML.
    const baseAmtEl = document.getElementById('ask-price-base-amt');
    if (baseAmtEl) baseAmtEl.textContent = tier.total.toLocaleString();
    if (discPct > 0) {
      if (baseEl)  baseEl.style.display = '';
      if (badgeEl) badgeEl.style.display = '';
      if (badgeTx) {
        const info = getQuestionDiscountPct._last || {};
        let reason = '';
        if (info.streakD >= info.rankD && info.streakD > 0) reason = (info.streakDays || 7) + '-day streak';
        else if (info.rankName) reason = info.rankName + ' rank';
        badgeTx.textContent = discPct + '% OFF' + (reason ? ' · ' + reason : '');
      }
    } else {
      if (baseEl)  baseEl.style.display = 'none';
      if (badgeEl) badgeEl.style.display = 'none';
    }
  } catch(e) {}
}

async function autoPayAndUnlock() {
  if (!connectedAddress) { alert('Connect wallet first!'); return; }
  const btn = document.getElementById('verify-btn');
  if (!getActiveKeplr()) {
    alert(getActiveProvider() === 'luncdash' ? VIEW_ONLY_MSG : 'Wallet extension not found. Please reconnect your wallet.');
    return;
  }
  // Before opening the wallet, check whether this address already paid and
  // never used it. checkUnusedPayment normally runs only on connect, so a
  // payment made afterwards - or a double click here - would otherwise be
  // charged for twice.
  const _btnText = btn.textContent;
  btn.textContent = '⏳ Checking...'; btn.disabled = true;
  try {
    await checkUnusedPayment(connectedAddress);
    if (readPaidQuestion()) {
      restorePaidQuestion();
      showTxStatus('success', '✅ You already have a paid question credit - form unlocked.');
      btn.textContent = _btnText; btn.disabled = false;
      return;
    }
  } catch (e) { /* a failed check must not block paying */ }

  btn.textContent = '⏳ Opening wallet...'; btn.disabled = true;
  try {
    await enableActive('columbus-5');
    const accounts = await getActiveKeplr().getOfflineSigner('columbus-5').getAccounts();
    const sender = accounts[0].address;

    // ── Discount = HIGHER of RANK discount / STREAK discount (per docs, not summed). ──
    // Rank uses effective REP (base × streak multiplier), same as profile page.
    // Same helper the button uses, so preview and charge always match.
    const discountPct = await getQuestionDiscountPct(sender);

    // Discount is % of the tariff total, subtracted from the Treasury leg only.
    // Pool leg is fixed per tariff - it is what the Worker matches on.
    const tier         = getSelectedTier();
    const treasuryBase = tier.total - tier.poolLeg;
    const toWeekly     = tier.poolLeg * 1e6;                                   // always fixed
    // Clamp so a large discount can never drive the Treasury leg to zero/negative.
    const discountAmt  = Math.min(Math.round(tier.total * (discountPct / 100)), treasuryBase - 1);
    const toTreasury   = Math.round((treasuryBase - discountAmt) * 1e6);
    const totalLunc    = tier.poolLeg + (treasuryBase - discountAmt);

    const discountLabel = discountAmt > 0
      ? ` (${discountPct}% off - saved ${discountAmt.toLocaleString()} LUNC)`
      : '';

    // Single TX with two MsgSend - one signature
    const txHash = await sendTwoMsgsDirect(
      sender,
      WEEKLY_DRAW_WALLET, toWeekly,
      TREASURY_WALLET, toTreasury,
      `Terra Oracle Q&A ${tier.label} - Weekly Pool + Treasury`, 'columbus-5'
    );

    // Store tx hash for question record
    document.getElementById('verified-tx-hidden').value = txHash;
    document.getElementById('verified-wallet-hidden').value = sender;
    savePaidQuestion(txHash, sender);

    const luncPaid = totalLunc.toLocaleString();
    showTxStatus('success', `✅ Payment confirmed! ${luncPaid} LUNC sent${discountLabel}. Form unlocked.`);
    setTimeout(() => {
      document.getElementById('tx-section').style.display = 'none';
      document.getElementById('keplr-connected').style.display = 'none';
      document.getElementById('ask-form').style.display = 'block';
    }, 1200);
  } catch(e) {
    btn.disabled = false;
    if (typeof connectedAddress !== 'undefined' && connectedAddress && typeof updateVerifyBtnPrice === 'function') {
      updateVerifyBtnPrice(connectedAddress);
    } else {
      btn.textContent = `Pay ${getSelectedTier().total.toLocaleString()} LUNC & Unlock`;
    }
    showTxStatus('error', '❌ ' + (e.message || 'Transaction cancelled.'));
  }
}

async function verifyTX() {
  const txHash = document.getElementById('tx-input').value.trim();
  const btn = document.getElementById('verify-btn');
  if (!txHash) { alert('Please enter a TX hash'); return; }
  btn.textContent = 'Checking...'; btn.disabled = true;
  document.getElementById('tx-status').style.display = 'none';
  let txData = null;
  try {
    const res = await fetch(`https://terra-classic-lcd.publicnode.com/cosmos/tx/v1beta1/txs/${txHash}`);
    if (res.ok) { txData = await res.json(); }
  } catch(e) {}
  btn.textContent = 'Verify'; btn.disabled = false;
  if (!txData || txData.error) { showTxStatus('error', '❌ Transaction not found. Check the hash and try again.'); return; }
  if (txData.code && txData.code !== 0) { showTxStatus('error', '❌ Transaction failed on-chain.'); return; }
  const msgs = txData.tx?.value?.msg || txData.tx?.body?.messages || [];
  let valid = false, foundAmount = 0;
  for (const msg of msgs) {
    const type = msg.type || msg['@type'] || '';
    const val = msg.value || msg;
    if (type.includes('MsgSend') || type.includes('bank')) {
      const toAddr = val.to_address || val.toAddress;
      const coins = val.amount || [];
      const lunc = Array.isArray(coins) ? coins.find(c => c.denom === 'uluna') : (coins.denom === 'uluna' ? coins : null);
      // Accept payment to Treasury OR Weekly Pool (split payment - either tx is valid proof)
      // Старый адрес пула тоже принимаем: в момент перехода у кого-то
      // могла остаться открытой прежняя версия страницы.
      if ((toAddr === TREASURY_WALLET || toAddr === WEEKLY_DRAW_WALLET ||
           toAddr === (typeof WEEKLY_DRAW_WALLET_LEGACY !== 'undefined' ? WEEKLY_DRAW_WALLET_LEGACY : '') ||
           toAddr === PROTOCOL_WALLET) && lunc) {
        foundAmount += parseInt(lunc.amount);
      }
    }
  }
  // Loosest tariff floor: Basic pays 25,000 to the pool + a discounted Treasury
  // leg. This is only a UX pre-check - the Worker re-verifies the exact pool leg
  // on-chain and is the authority on which tariff (and how many entries) applies.
  const MIN_ACCEPTED = 25000 * 1e6;
  if (foundAmount < MIN_ACCEPTED) { showTxStatus('error', `❌ Invalid payment. Expected 25,000+ LUNC to Oracle wallets. Found: ${(foundAmount/1000000).toLocaleString()} LUNC.`); return; }
  valid = true;
  document.getElementById('verified-tx-hidden').value = txHash;
  savePaidQuestion(txHash, document.getElementById('verified-wallet-hidden')?.value || '');
  showTxStatus('success', `✅ Payment verified! ${(foundAmount/1000000).toLocaleString()} LUNC confirmed. Form unlocked.`);
  setTimeout(() => {
    document.getElementById('tx-section').style.display = 'none';
    document.getElementById('keplr-connected').style.display = 'none';
    document.getElementById('ask-form').style.display = 'block';
  }, 1200);
}

function showTxStatus(type, msg) {
  const el = document.getElementById('tx-status');
  el.style.display = 'block';
  el.style.background = type === 'success' ? 'rgba(102,255,170,0.06)' : 'rgba(255,60,60,0.06)';
  el.style.border = type === 'success' ? '1px solid rgba(102,255,170,0.25)' : '1px solid rgba(255,60,60,0.25)';
  el.style.color = type === 'success' ? 'var(--green)' : '#ff6060';
  el.textContent = msg;
}

