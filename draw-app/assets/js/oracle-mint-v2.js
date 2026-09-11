/* oracle-mint-v2.js - v1.0.0
 *
 * Минт Oracle Mask через собственный CW721-контракт.
 * Заменяет старую схему «два MsgSend + memo-триггер + опрос Paco API».
 *
 * Подключать ПОСЛЕ app.js - использует его глобальные хелперы:
 *   walletProvider, getWalletKeplr(), _isWCProvider(), _wcSignAndBroadcast(),
 *   TERRA_CHAIN_CONFIG, CHAIN_ID, connectedWalletAddress, lotteryAddress
 *
 *   <script src="js/app.js?v=X"></script>
 *   <script src="js/oracle-nft-client.js?v=1"></script>
 *   <script src="js/oracle-mint-v2.js?v=1"></script>
 */
(function () {
  'use strict';

  var CONTRACT = 'terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx';
  var GAS_LIMIT = 900000;              // замер на тестовом минте: ~530k, берём с запасом
  var GAS_PRICE = 28.325;              // uluna за единицу газа, минимум сети
  var LCD_LIST = [
    'https://terra-classic-lcd.publicnode.com',
    'https://lcd-terra-classic.hexxagon.io',
    'https://terraclassic.community/cosmos',
  ];

  // ── protobuf-хелперы (те же, что в sendTwoMsgSend) ────────────────────────
  var enc = new TextEncoder();

  function encodeVarint(n) {
    var buf = [], v = BigInt(n);
    while (v > 127n) { buf.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
    buf.push(Number(v & 0x7fn));
    return new Uint8Array(buf);
  }

  function encodeField(f, w, d) {
    var tag = encodeVarint((f << 3) | w);
    if (w === 2) {
      var len = encodeVarint(d.length);
      var out = new Uint8Array(tag.length + len.length + d.length);
      out.set(tag); out.set(len, tag.length); out.set(d, tag.length + len.length);
      return out;
    }
    return tag;
  }

  function concat() {
    var arrays = Array.prototype.slice.call(arguments);
    var total = arrays.reduce(function (s, a) { return s + a.length; }, 0);
    var out = new Uint8Array(total), off = 0;
    arrays.forEach(function (a) { out.set(a, off); off += a.length; });
    return out;
  }

  /**
   * /cosmwasm.wasm.v1.MsgExecuteContract
   *   1 sender (string), 2 contract (string), 3 msg (bytes JSON), 5 funds (repeated Coin)
   * Внимание: funds - поле 5, а не 4 (поле 4 в wasmd устарело).
   */
  function encodeMsgExecuteContract(sender, contract, msgJson, funds) {
    var parts = [
      encodeField(1, 2, enc.encode(sender)),
      encodeField(2, 2, enc.encode(contract)),
      encodeField(3, 2, enc.encode(JSON.stringify(msgJson))),
    ];
    (funds || []).forEach(function (c) {
      var coin = concat(
        encodeField(1, 2, enc.encode(c.denom)),
        encodeField(2, 2, enc.encode(String(c.amount)))
      );
      parts.push(encodeField(5, 2, coin));
    });
    return concat.apply(null, parts);
  }

  function makeMsgAny(typeUrl, value) {
    return concat(encodeField(1, 2, enc.encode(typeUrl)), encodeField(2, 2, value));
  }

  function toUint8(v, fallback) {
    if (!v) return fallback;
    if (v instanceof Uint8Array) return v;
    if (v.buffer instanceof ArrayBuffer) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return new Uint8Array(Object.values(v));
  }

  // ── подпись и отправка ────────────────────────────────────────────────────

  /**
   * Отправляет одно MsgExecuteContract. Возвращает txHash.
   * Логика подписи повторяет sendTwoMsgSend из app.js, включая обход
   * подмены gas limit кошельком Keplr.
   */
  async function sendExecuteContract(fromAddr, contract, msgJson, funds, memo, chainId) {
    var _keplr = getWalletKeplr(walletProvider);
    var _isWC  = _isWCProvider(walletProvider);
    if (!_keplr && !_isWC) throw new Error('No wallet connected.');

    var msgAny = makeMsgAny(
      '/cosmwasm.wasm.v1.MsgExecuteContract',
      encodeMsgExecuteContract(fromAddr, contract, msgJson, funds)
    );
    var txBodyBytes = concat(
      encodeField(1, 2, msgAny),
      encodeField(2, 2, enc.encode(memo || ''))
    );

    // account_number / sequence
    var accountNumber, sequence;
    for (var i = 0; i < LCD_LIST.length; i++) {
      try {
        var r = await fetch(LCD_LIST[i] + '/cosmos/auth/v1beta1/accounts/' + fromAddr,
                            { signal: AbortSignal.timeout(6000) });
        if (!r.ok) continue;
        var d = await r.json();
        var acc = (d.account && (d.account.base_account || d.account)) || d;
        accountNumber = parseInt(acc.account_number || '0', 10);
        sequence      = parseInt(acc.sequence || '0', 10);
        break;
      } catch (e) { /* следующая нода */ }
    }
    if (accountNumber === undefined) throw new Error('Could not fetch account info. Check your connection.');

    // pubkey из кошелька
    var pubkeyBytes;
    if (_isWC) {
      pubkeyBytes = await _wcGetPubkey(fromAddr, chainId);
    } else {
      var key = await _keplr.getKey(chainId);
      pubkeyBytes = toUint8(key.pubKey, null);
    }
    if (!pubkeyBytes) throw new Error('Could not read wallet public key.');

    var pubkeyAny = makeMsgAny('/cosmos.crypto.secp256k1.PubKey', encodeField(1, 2, pubkeyBytes));
    var modeInfo  = encodeField(1, 2, concat(encodeVarint((1 << 3) | 0), encodeVarint(1))); // SIGN_MODE_DIRECT
    var seqBytes  = encodeVarint(sequence);
    var signerInfo = concat(
      encodeField(1, 2, pubkeyAny),
      encodeField(2, 2, modeInfo),
      encodeVarint((3 << 3) | 0), seqBytes
    );

    var totalFee = Math.ceil(GAS_LIMIT * GAS_PRICE);
    var feeCoin  = concat(
      encodeField(1, 2, enc.encode('uluna')),
      encodeField(2, 2, enc.encode(String(totalFee)))
    );
    var feeProto = concat(
      encodeField(1, 2, feeCoin),
      encodeVarint((2 << 3) | 0), encodeVarint(GAS_LIMIT)
    );
    var authInfoBytes = concat(
      encodeField(1, 2, signerInfo),
      encodeField(2, 2, feeProto)
    );

    var txBase64;
    if (_isWC) {
      txBase64 = await _wcSignAndBroadcast(fromAddr, txBodyBytes, authInfoBytes, accountNumber, chainId);
    } else {
      var signer = _keplr.getOfflineSigner(chainId);
      try { await _keplr.experimentalSuggestChain(TERRA_CHAIN_CONFIG); } catch (e) {}
      await _keplr.enable(chainId);
      var res = await signer.signDirect(fromAddr, {
        bodyBytes: txBodyBytes,
        authInfoBytes: authInfoBytes,
        chainId: chainId,
        accountNumber: BigInt(accountNumber),
      });
      var finalBody = toUint8(res.signed.bodyBytes, txBodyBytes);
      var sigBytes  = Uint8Array.from(atob(res.signature.signature), function (c) { return c.charCodeAt(0); });
      // ВАЖНО: берём СВОЙ authInfoBytes - Keplr переписывает gas limit на 300k,
      // а минту нужно больше. Та же причина, что в sendTwoMsgSend.
      txBase64 = btoa(String.fromCharCode.apply(null, concat(
        encodeField(1, 2, finalBody),
        encodeField(2, 2, authInfoBytes),
        encodeField(3, 2, sigBytes)
      )));
    }

    var broadcastData = null;
    for (var j = 0; j < LCD_LIST.length; j++) {
      try {
        var br = await fetch(LCD_LIST[j] + '/cosmos/tx/v1beta1/txs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tx_bytes: txBase64, mode: 'BROADCAST_MODE_SYNC' }),
          signal: AbortSignal.timeout(15000),
        });
        broadcastData = await br.json();
        break;
      } catch (e) { /* следующая нода */ }
    }
    if (!broadcastData) throw new Error('Broadcast failed - all LCD nodes unreachable.');

    var resp   = broadcastData.tx_response || broadcastData;
    var code   = resp.code || 0;
    var txHash = resp.txhash;
    if (code !== 0) throw new Error('TX rejected (code ' + code + '): ' + (resp.raw_log || ''));
    if (!txHash)    throw new Error('No txhash in broadcast response.');
    return txHash;
  }

  /** Pubkey для WalletConnect-сессии. */
  async function _wcGetPubkey(addr, chainId) {
    try {
      if (typeof window._wcGetAccountPubkey === 'function') {
        return toUint8(await window._wcGetAccountPubkey(addr, chainId), null);
      }
    } catch (e) {}
    return null;
  }

  // ── ждём попадания в блок и достаём token_id из события ───────────────────

  /**
   * Опрашивает LCD, пока транзакция не попадёт в блок.
   * Возвращает { ok, tokenId, tier, entries, pool, rawLog }.
   */
  async function waitForMint(txHash, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 60000);
    while (Date.now() < deadline) {
      for (var i = 0; i < LCD_LIST.length; i++) {
        try {
          var r = await fetch(LCD_LIST[i] + '/cosmos/tx/v1beta1/txs/' + txHash,
                              { signal: AbortSignal.timeout(8000) });
          if (!r.ok) continue;
          var d = await r.json();
          var resp = d.tx_response;
          if (!resp || !resp.height || resp.height === '0') continue;
          if (resp.code && resp.code !== 0) {
            return { ok: false, rawLog: resp.raw_log || 'transaction failed' };
          }
          var out = { ok: true, tokenId: null, tier: null, entries: null, pool: null };
          (resp.events || []).forEach(function (ev) {
            if (ev.type !== 'wasm') return;
            var a = {};
            (ev.attributes || []).forEach(function (attr) { a[attr.key] = attr.value; });
            if (a.action === 'oracle_mint') {
              out.tokenId = a.token_id;
              out.tier    = a.tier;
              out.entries = parseInt(a.entries || '1', 10);
              out.pool    = a.pool;
            }
          });
          return out;
        } catch (e) { /* следующая нода */ }
      }
      await new Promise(function (res) { setTimeout(res, 3000); });
    }
    return { ok: false, rawLog: 'timeout waiting for confirmation' };
  }

  // ── новый обработчик кнопки минта ─────────────────────────────────────────

  async function nativeMintV2() {
    var tier   = window.selectedTier   || 'common';
    // Пул выбирается в модалке минта; window.currentLottery - состояние вкладок
    // страницы. selectPool() держит их синхронными, но читаем в приоритетном
    // порядке, чтобы выбор пользователя не мог потеряться ни при каком раскладе.
    var pool   = window.selectedPool || window.currentLottery || 'daily';
    var wallet = (typeof connectedWalletAddress !== 'undefined' && connectedWalletAddress) || lotteryAddress;

    if (!wallet) { alert('Please connect your wallet first!'); return; }
    if (!getWalletKeplr(walletProvider) && !_isWCProvider(walletProvider)) {
      alert('No wallet connected. Please connect a wallet first.');
      return;
    }

    var btn       = document.getElementById('draw-buy-btn');
    var statusEl  = document.getElementById('draw-tx-status');
    var msgEl     = document.getElementById('draw-tx-msg');
    var successEl = document.getElementById('draw-tx-success');
    var tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);

    // Раньше здесь стоял btn.textContent - он уничтожал вложенные
    // <span id="buy-btn-tier"> / <span id="buy-btn-total">, после чего
    // selectTier() и updateBuyBtn() молча переставали находить их и подпись
    // навсегда застывала на только что сминченном тире. renderBuyBtnLabel()
    // собирает кнопку заново вместе со спанами и выводит пул.
    function resetBtn(priceLunc) {
      if (!btn) return;
      btn.disabled = false;
      if (typeof window.renderBuyBtnLabel === 'function') {
        window.renderBuyBtnLabel(
          window.selectedTier || tier,
          window.selectedPool || window.currentLottery || pool,
          priceLunc || 0
        );
        return;
      }
      btn.textContent = 'Mint ' + tierLabel.toUpperCase() +
        (priceLunc ? ' - ' + priceLunc.toLocaleString() + ' LUNC' : '');
    }
    function say(text) {
      if (statusEl) statusEl.style.display = 'block';
      if (msgEl) msgEl.textContent = text;
    }

    if (msgEl) msgEl.textContent = '';
    if (statusEl) statusEl.style.display = 'none';
    if (successEl) successEl.style.display = 'none';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparing...'; }

    var priceLunc = 0;
    try {
      // Цену берём из контракта, а не из локальной константы - рассинхрон исключён.
      var price = await OracleNFT.getMintPrice(tier);
      priceLunc = Math.round(Number(price) / 1e6);

      if (btn) btn.textContent = '⏳ Signing...';
      say('Please approve the transaction in your wallet...');
      try {
        if (window.oa) { oa.pool(pool); oa.wallet(wallet, { restored: true });
          oa.track('mint_start', { tier: tier, pool: pool }); }
      } catch (e) {}

      var txHash = await sendExecuteContract(
        wallet,
        CONTRACT,
        { extension: { msg: { mint: {
          tier: tier,
          pool: pool,
          // см. OracleNFT.freshEntropy - один генератор на обе ветки минта
          entropy: OracleNFT.freshEntropy(),
        } } } },
        [{ denom: 'uluna', amount: String(price) }],
        'draw:' + pool + ':' + tier,
        CHAIN_ID
      );

      say('Confirming on-chain... (10-30 seconds)');
      var result = await waitForMint(txHash, 90000);

      if (!result.ok) {
        throw new Error(result.rawLog || 'Transaction failed on-chain.');
      }

      try {
        if (window.oa) oa.track('tx_ok', { tier: result.tier || tier,
                                           pool: result.pool || pool });
      } catch (e) {}

      // Регистрация в раунде. Оплата и NFT уже неотменяемо прошли -
      // если воркер не ответит, NFT всё равно у пользователя.
      // Ответ воркера раньше игнорировался целиком: если регистрация падала,
      // NFT не попадал в раунд и REP не начислялся - молча, без следа в консоли.
      var reg = null;
      try {
        var regRes = await fetch(DRAW_WORKER + '/register-mint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet: wallet,
            txHash: txHash,
            tokenId: result.tokenId,
            tier: result.tier || tier,
            entries: result.entries,
            pool: result.pool || pool,
          }),
          signal: AbortSignal.timeout(10000),
        });
        reg = await regRes.json().catch(function () { return null; });
        if (!regRes.ok) {
          console.error('[mint-v2] /register-mint HTTP ' + regRes.status, reg);
        } else if (reg && reg.alreadyRegistered) {
          console.log('[mint-v2] токен уже был зарегистрирован (крон reconcile опередил)');
        } else {
          console.log('[mint-v2] зарегистрирован:', reg);
        }
      } catch (e) {
        console.error('[mint-v2] /register-mint не ответил, NFT в безопасности:', e.message);
      }

      if (statusEl) statusEl.style.display = 'none';
      if (successEl) {
        successEl.style.display = 'block';
        successEl.textContent = '✅ Minted ' + (result.tokenId || tierLabel) +
                                ' - active in ' + String(result.pool || pool).toUpperCase();
      }
      resetBtn(priceLunc);

      if (typeof loadMyBagNFTs === 'function') { try { loadMyBagNFTs(wallet); } catch (e) {} }

      return txHash;
    } catch (err) {
      console.error('[mint-v2]', err);
      var m = String(err && err.message || err);
      try {
        if (window.oa) {
          var rejected = /rejected|denied|Request rejected|cancel/i.test(m);
          oa.track(rejected ? 'tx_reject' : 'tx_fail',
                   { tier: tier, e: m.slice(0, 80) });
        }
      } catch (e2) {}
      if (/Wrong payment/i.test(m))        say('⚠️ Price changed while you were signing. Please try again.');
      else if (/paused/i.test(m))          say('⚠️ Minting is temporarily paused. Please try again later.');
      else if (/SoldOut|sold out/i.test(m))say('⚠️ This tier is sold out.');
      else if (/insufficient funds/i.test(m)) say('⚠️ Not enough LUNC in your wallet (price + gas fee).');
      else if (/rejected|denied|Request rejected/i.test(m)) say('Transaction cancelled.');
      else say('⚠️ ' + m);
      resetBtn(priceLunc);
      return null;
    }
  }

  window.sendExecuteContract = sendExecuteContract;
  window.waitForMint         = waitForMint;
  window.nativeMintV2        = nativeMintV2;
  window.ORACLE_NFT_CONTRACT = CONTRACT;
})();
