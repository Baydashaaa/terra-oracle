// ─── KEPLR ──────────────────────────────────────────────────────────────────
// Connect button inside the buy modal. Previously hardcoded window.keplr and
// did NOT set walletProvider - Galaxy-only users got "No wallet found" and the
// global wallet state stayed out of sync with the modal. Now routes through
// the shared connectWallet(provider) flow with provider auto-detection.
async function connectLotteryKeplr() {
  // Already connected globally? Just sync the modal UI to that wallet.
  if (connectedWalletAddress) {
    lotteryAddress = connectedWalletAddress;
    syncDrawWalletUI(lotteryAddress);
    if (typeof updateBuyBtn === 'function') updateBuyBtn();
    return;
  }
  // Detect the best available provider and use the shared connect flow
  // (it sets walletProvider, persists the session and syncs all UI).
  let provider = null;
  if (window.keplr) provider = 'keplr';
  else if (window.galaxyStation) provider = 'galaxystation';
  else if (window.station) provider = 'station';
  if (!provider) { alert('No wallet found! Please install Keplr, Galaxy Station or Terra Station.'); return; }
  try {
    await connectWallet(provider);
    if (connectedWalletAddress) {
      lotteryAddress = connectedWalletAddress;
      syncDrawWalletUI(lotteryAddress);
      if (typeof updateBuyBtn === 'function') updateBuyBtn();
    }
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
  // WalletConnect providers use WC session for signing - return null here,
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

  // Keplr по умолчанию подменяет комиссию и memo своими и подписывает уже
  // изменённый документ. Ниже в TxRaw кладётся НАШ authInfoBytes - с чужой
  // подписью он не сходится, и цепь отвечает «signature verification failed»,
  // перечисляя поля signDoc, из-за чего кажется, будто дело в account number.
  //
  // Просим не трогать: тогда подписанное и отправленное совпадают, а наши
  // 600k газа, налог 0.5% и memo с номером раунда доезжают как есть.
  if (_keplr) {
    try {
      const prev = _keplr.defaultOptions || {};
      _keplr.defaultOptions = Object.assign({}, prev, {
        sign: Object.assign({}, prev.sign, {
          preferNoSetFee:  true,
          preferNoSetMemo: true,
        }),
      });
    } catch (e) { /* кошелёк без defaultOptions - не повод падать */ }
  }

  // For WC providers we don't have getOfflineSigner - get pubkey differently
  let pubkeyBytes;
  if (_isWC) {
    // WC doesn't expose pubkey before signing - use a 33-byte placeholder
    // The wallet will replace authInfoBytes.pubkey in the signed result
    pubkeyBytes = new Uint8Array(33);
  } else {
    const directSigner = _keplr.getOfflineSigner(chainId);
    const accounts     = await directSigner.getAccounts();
    pubkeyBytes        = accounts[0].pubkey;
  }

  const LCD_BASE = 'https://terra-classic-lcd.publicnode.com';
  // Узлы перебираем и падаем явно. Раньше при ошибке единственного узла
  // accountNumber молча становился нулём, подпись не сходилась, и цепь
  // отвечала тем же «signature verification failed» - причину приходилось
  // искать вслепую.
  const ACC_NODES = [
    LCD_BASE,
    'https://rest.cosmos.directory/terraclassic',
    'https://terra-classic-lcd.hexxagon.io',
  ];
  let accountNumber, sequence;
  for (const _node of ACC_NODES) {
    try {
      const r = await fetch(`${_node}/cosmos/auth/v1beta1/accounts/${fromAddr}`,
                            { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const d = await r.json();
      const acct = (d.account && (d.account.base_account || d.account)) || {};
      if (acct.account_number === undefined) continue;
      accountNumber = parseInt(acct.account_number, 10);
      sequence      = parseInt(acct.sequence || '0', 10);
      break;
    } catch (e) { /* следующий узел */ }
  }
  if (accountNumber === undefined) {
    throw new Error('Could not read your account from the chain. Check your connection and try again.');
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

  // Gas: здесь ОДНО MsgSend. Комментарий про «two MsgSend, real TX used
  // 467863» и лимит 600000 достались от sendMsgSends, откуда эта функция
  // копировалась, - и стоили 17 LUNC вместо 8.5 с каждой покупки.
  // 300000 - столько же, сколько sendMsgSends кладёт на одно сообщение,
  // с запасом больше чем вдвое к реальному расходу перевода.
  const GAS_LIMIT = 300000;
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
    // WalletConnect path - wallet signs remotely on mobile
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
    // Use OUR authInfoBytes - Keplr overrides gas in signed.authInfoBytes
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

  // Health check - don't take funds if the mint backend is down
  if (btn) { btn.disabled = true; btn.innerHTML = '<svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Checking service...'; }
  if (statusEl) statusEl.style.display = 'block';
  if (!(await isMintServiceUp(lotteryAddress))) {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Mint NFT'; }
    if (msgEl) msgEl.innerHTML = '<svg class="oi oi--amber"><use href="#i-warning"/></svg> Mint service is temporarily unavailable. Your funds are safe - please try again in a few minutes.';
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<svg class="oi oi--cyan"><use href="#i-hourglass"/></svg> Waiting for Keplr...'; }
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
      // WC - address is already stored from connection
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
    if (successMsg) successMsg.innerHTML = `<svg class="oi oi--gold"><use href="#i-ticket"/></svg> ${ticketCount} ticket${ticketCount > 1 ? 's' : ''} purchased successfully!`;
    if (txLink) {
      txLink.href = `https://finder.terraport.finance/mainnet/tx/${txHash}`;
      txLink.innerHTML = '<svg class="oi oi--cyan"><use href="#i-link"/></svg> ' + (txHash || '').slice(0,16) + '...';
    }

    if (btn) { btn.innerHTML = `Mint ${ticketCount > 1 ? ticketCount + ' NFTs' : 'NFT'} - ${fmt(ticketCount*pricePerTicket)} LUNC`; btn.disabled = false; }

    await loadAllData();

  } catch(e) {
    if (statusEl) statusEl.style.display = 'none';
    if (btn) { btn.disabled = false; btn.innerHTML = `Mint ${ticketCount > 1 ? ticketCount + ' NFTs' : 'NFT'} - ${fmt(ticketCount*LUNC_PER_TICKET)} LUNC`; }
    const emsg = (e && e.message) || String(e) || '';
    const userRejected = /reject|denied|cancel|user.?denied|code:?\s*4001/i.test(emsg);
    if (userRejected) {
      console.log('[buyTickets] user cancelled the transaction');
    } else {
      alert('Transaction failed: ' + emsg);
    }
  }
}
