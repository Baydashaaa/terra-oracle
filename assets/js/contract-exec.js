/* contract-exec.js - v1.0.0
 *
 * Подпись и отправка одного MsgExecuteContract. Код вырезан из проверенного
 * oracle-mint-v2.js сайта розыгрыша: он уже год подписывает минты на живых
 * деньгах, и переписывать его ради второго сайта было бы хуже, чем повторить.
 *
 * Файл ОБЩИЙ для terra-oracle и oracle-draw, как oa.js: правка в одном месте
 * требует правки во втором.
 *
 * Подключать ПОСЛЕ app.js - используются его глобальные хелперы:
 *   getWalletKeplr()/getActiveKeplr(), _isWCProvider(), _wcSignAndBroadcast()
 *   - имена ищутся по факту, потому что на двух сайтах они разные
 *
 * Экспортирует window.sendExecuteContract(from, contract, msg, funds, memo, chainId)
 * -> txHash. Комиссию и газ задаёт вызывающая сторона через GAS_LIMIT ниже.
 */
(function () {
  'use strict';

  // Замер на живой сети 3 сентября: Settle рынка с двумя участниками съел
  // 1 376 097 газа. Ставка и Claim дешевле, но лимит один на все вызовы,
  // поэтому берём с запасом от самого дорогого.
  var GAS_LIMIT = 1800000;
  var GAS_PRICE = 28.325;
  var LCD_LIST = [
    'https://terra-classic-lcd.publicnode.com',
    'https://lcd.terra-classic.hexxagon.io',
    'https://terraclassic-mainnet-lcd.autostake.com',
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
    // Два сайта называют одни и те же хелперы по-разному: на розыгрыше это
    // getWalletKeplr/_isWCProvider, на terraoracle.io - getActiveKeplr из
    // sign.js. Файл общий, поэтому имена ищутся, а не предполагаются.
    var _keplr = (typeof getWalletKeplr === 'function')
      ? getWalletKeplr(typeof walletProvider !== 'undefined' ? walletProvider : null)
      : (typeof getActiveKeplr === 'function' ? getActiveKeplr() : window.keplr);
    var _isWC = (typeof _isWCProvider === 'function')
      ? _isWCProvider(typeof walletProvider !== 'undefined' ? walletProvider : null)
      : false;
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
      if (typeof _wcSignAndBroadcast !== 'function') {
        throw new Error('WalletConnect signing is not available on this page.');
      }
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


  window.sendExecuteContract = sendExecuteContract;
})();
