// ─── MODAL ──────────────────────────────────────────────────────────────────
function openModal() {
  const _mo=document.getElementById('modal');if(_mo)_mo.classList.add('open');
document.body.classList.add('modal-open');
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
  /* Пул берём из состояния страницы, а не из прошлого выбора в модалке.
     Второй аргумент - не транслировать обратно в switchLottery. */
  if (typeof selectPool === 'function') selectPool(window.currentLottery || 'daily', true);
}
function closeModal() { const _mo2=document.getElementById('modal');if(_mo2)_mo2.classList.remove('open'); document.body.classList.remove('modal-open'); }
document.getElementById('modal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });

// Минт идёт через собственный контракт (oracle-mint-v2.js). Прежняя
// схема с iframe на nft.lunc.tools удалена 31 авг 2026 вместе с сервисом:
// адреса минта, id коллекций Paco и опрос его API больше не нужны.

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
  console.warn('[waitForTxConfirm] timeout - TX not confirmed');
  return false;
}

// ── NATIVE MINT (replaces iframe) ────────────────────────────────────────────
// Paco fee wallet - receives 2.5% of mint price (confirmed from TX analysis)
const PACO_FEE_WALLET = 'terra12v5pxjv76hydvlj46kccqe362cky5rps92kqgg';

// NFT tier prices in LUNC
const NFT_MINT_PRICES = {
  common:    25000,
  rare:      125000,
  legendary: 250000,
};

// ── Mint service health check ────────────────────────────────────────────────
// Осталась заглушкой: у контрактного минта нет внешнего бэкенда, который
// можно опросить - бэкенд это сама цепочка. buy.js её всё ещё зовёт.
async function isMintServiceUp(wallet) {
  // Contract mint has no external backend to probe - the chain is always the
  // backend. Kept only so any stray caller still resolves. Always true.
  return true;
}

async function nativeMint() {
  // Contract-only mint. The whole payment+mint is one MsgExecuteContract,
  // handled in oracle-mint-v2.js. This wrapper forwards to it so the existing
  // button onclick keeps working without touching the markup.
  if (typeof window.nativeMintV2 !== 'function') {
    alert('Mint module not loaded. Please refresh the page.');
    return;
  }
  return window.nativeMintV2();
}

// Sends a single TX with one or more MsgSend messages.
// sends: [{ to, amount }, ...] - amounts in uluna.
async function sendMsgSends(fromAddr, sends, memo, chainId) {
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
  if (!Array.isArray(sends) || !sends.length) throw new Error('No transfers to send.');
  const msgFields = sends.map(sd => encodeField(1, 2,
    makeMsgAny('/cosmos.bank.v1beta1.MsgSend', encodeMsgSend(fromAddr, sd.to, sd.amount, 'uluna'))
  ));
  const memoBytes = enc.encode(memo || '');
  const txBodyBytes = concat(...msgFields, encodeField(2, 2, memoBytes));

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
      console.warn('[sendMsgSends] signer address mismatch, using signer address:', accounts[0].address);
      fromAddr = accounts[0].address;
    }
  }

  // ── authInfo ──
  // 300000 gas per MsgSend. One send = 8,497,500 uluna ≈ 8.5 LUNC, the same
  // figure the daily payouts use and that a 189K LUNC transfer went through
  // with. Two sends keep the previous 600000 exactly.
  const GAS_LIMIT = 300000 * sends.length;
  const totalFee  = Math.ceil(GAS_LIMIT * 28.325);
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
    encodeVarint((2 << 3) | 0), encodeVarint(GAS_LIMIT)
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
  if (!broadcastData) throw new Error('Broadcast failed - all LCD nodes unreachable.');
  const txHash = broadcastData.tx_response?.txhash || broadcastData.txhash;
  const code   = broadcastData.tx_response?.code   || broadcastData.code || 0;
  if (code !== 0) throw new Error(`TX rejected (code ${code}): ${broadcastData.tx_response?.raw_log || ''}`);
  if (!txHash)    throw new Error('No txhash in broadcast response.');
  return txHash;
}

// Old two-payment signature, kept as a thin wrapper. No callers today.
async function sendTwoMsgSend(fromAddr, toAddr1, amount1, toAddr2, amount2, memo, chainId) {
  return sendMsgSends(fromAddr,
    [{ to: toAddr1, amount: amount1 }, { to: toAddr2, amount: amount2 }],
    memo, chainId);
}

// Floating toast in bottom-right corner with auto-activation status.
// Has a close button - clicking it aborts the polling and hides the toast.
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
  if (textEl) textEl.innerHTML = text;
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
  const pool    = window.selectedPool || window.currentLottery || 'daily';
  const mTotEl  = document.getElementById('modal-total-val');
  const mTierEl = document.getElementById('modal-tier-entries');
  const btn     = document.getElementById('lottery-buy-btn');
  if (mTotEl)  mTotEl.textContent  = fmt(price) + ' LUNC';
  if (mTierEl) mTierEl.textContent = entries + (entries === 1 ? ' entry' : ' entries');
  if (btn && lotteryAddress) btn.style.display = 'block';
  renderBuyBtnLabel(tier, pool, price);
}

// Подпись кнопки минта собирается заново из состояния, а не правится через
// внутренние <span>. Причина: промежуточные статусы ('Waiting for Keplr...',
// 'Mint NFT') затирают innerHTML кнопки вместе со спанами, после чего старый
// код молча переставал обновлять подпись - она застывала на прошлом тире.
// Пул выведен в саму кнопку, чтобы перед нажатием не было сомнений.
function renderBuyBtnLabel(tier, pool, price) {
  const btn = document.getElementById('draw-buy-btn') || document.getElementById('lottery-buy-btn');
  if (!btn || btn.disabled) return;   // идёт транзакция - не трогаем статус
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const isDaily   = pool !== 'weekly';
  const poolCol   = isDaily ? '#f4d03f' : '#7ec8ff';
  btn.innerHTML =
    'Mint <span id=\"buy-btn-tier\">' + tierLabel + '</span>' +
    ' · <span id=\"buy-btn-pool\" style=\"color:' + poolCol + ';font-weight:800;letter-spacing:.06em;\">' +
      (isDaily ? 'DAILY' : 'WEEKLY') + '</span>' +
    ' - <span id=\"buy-btn-total\">' + fmt(price) + '</span> LUNC';
}
window.renderBuyBtnLabel = renderBuyBtnLabel;
