/* oracle-nft-client.js - v2.0.0 (contract-only)
 *
 * Клиент коллекции Oracle Mask на собственном CW721-контракте.
 * My Bag = ОДИН запрос owner_tokens (метаданные уже он-чейн).
 *
 * Подключение:  <script src="assets/js/oracle-nft-client.js?v=1"></script>
 */
(function (global) {
  'use strict';

  var CFG = {
    // Боевой контракт Oracle Mask на columbus-5 (code_id 11546)
    contract: 'terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx',
    // LCD-ноды Terra Classic; перебираются по кругу при ошибке
    lcd: [
      'https://terra-classic-lcd.publicnode.com',
      'https://lcd-terra-classic.hexxagon.io',
      'https://terraclassic.community/cosmos',
    ],
    denom: 'uluna',
    timeoutMs: 10000,
    retries: 2,
    // Кэш ответов LCD в памяти, мс
    cacheTtlMs: 15000,
  };

  var cache = new Map();

  function configure(patch) {
    if (!patch) return CFG;
    Object.keys(patch).forEach(function (k) { CFG[k] = patch[k]; });
    return CFG;
  }

  function b64(obj) {
    var json = JSON.stringify(obj);
    if (typeof btoa === 'function') {
      return btoa(unescape(encodeURIComponent(json)));
    }
    return Buffer.from(json, 'utf8').toString('base64');
  }

  function fetchJson(url, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    var opts = ctrl ? { signal: ctrl.signal } : {};
    return fetch(url, opts)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        return r.json();
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  /** Умный запрос к контракту с перебором LCD-нод и ретраями. */
  function smartQuery(query, opts) {
    opts = opts || {};
    if (!CFG.contract) return Promise.reject(new Error('oracle-nft-client: contract address is not configured'));

    var key = CFG.contract + '|' + JSON.stringify(query);
    if (!opts.noCache) {
      var hit = cache.get(key);
      if (hit && Date.now() - hit.at < CFG.cacheTtlMs) return Promise.resolve(hit.value);
    }

    var path = '/cosmwasm/wasm/v1/contract/' + CFG.contract + '/smart/' + b64(query);
    var attempts = [];
    for (var r = 0; r <= CFG.retries; r++) {
      for (var i = 0; i < CFG.lcd.length; i++) attempts.push(CFG.lcd[i] + path);
    }

    var idx = 0;
    function next(lastErr) {
      if (idx >= attempts.length) return Promise.reject(lastErr || new Error('all LCD nodes failed'));
      var url = attempts[idx++];
      return fetchJson(url, CFG.timeoutMs)
        .then(function (j) {
          var data = j && j.data;
          if (data === undefined) throw new Error('malformed LCD response');
          if (!opts.noCache) cache.set(key, { at: Date.now(), value: data });
          return data;
        })
        .catch(next);
    }
    return next(null);
  }

  // ---------------------------------------------------------------- queries

  function getConfig() {
    return smartQuery({ extension: { msg: { config: {} } } });
  }

  /** Все тиры с ценами и текущим количеством минтов. */
  function getTiers() {
    return smartQuery({ extension: { msg: { tiers: {} } } })
      .then(function (r) { return (r && r.tiers) || []; });
  }

  /** Точная цена минта в uluna - фронт не считает её сам. */
  function getMintPrice(tierKey) {
    return smartQuery({ extension: { msg: { tier: { key: String(tierKey).toLowerCase() } } } })
      .then(function (r) { return r.tier.price; });
  }

  function getStats() {
    return smartQuery({ extension: { msg: { stats: {} } } });
  }

  /**
   * NFT владельца из НОВОГО контракта. Один запрос - сразу с метаданными.
   * Пагинация прозрачная: тянет все страницы по 100.
   */
  function getContractTokens(owner) {
    var out = [];
    function page(startAfter) {
      var q = { extension: { msg: { owner_tokens: { owner: owner, limit: 100 } } } };
      if (startAfter) q.extension.msg.owner_tokens.start_after = startAfter;
      return smartQuery(q, { noCache: true }).then(function (res) {
        var tokens = (res && res.tokens) || [];
        tokens.forEach(function (t) {
          var m = t.metadata || {};
          out.push({
            source: 'contract',
            tokenId: t.token_id,
            tier: m.tier || guessTier(t.token_id),
            entries: m.entries || 1,
            pool: m.pool || null,
            name: m.name || t.token_id,
            image: m.image || null,
            description: m.description || null,
            mintedAt: m.minted_at ? m.minted_at * 1000 : null,
            mintPrice: m.mint_price || null,
            tokenUri: t.token_uri || null,
          });
        });
        if (tokens.length === 100) return page(tokens[tokens.length - 1].token_id);
        return out;
      });
    }
    return page(null);
  }

  function guessTier(tokenId) {
    var m = /^([a-z]+)-/.exec(String(tokenId || '').toLowerCase());
    return m ? m[1] : 'unknown';
  }

  /**
   * My Bag: токены владельца из контракта. Один запрос, метаданные он-чейн.
   * Возвращает { tokens, contractOk }.
   */
  function getOwnedTokens(owner) {
    return getContractTokens(owner).then(function (tokens) {
      tokens.sort(function (a, b) { return (b.mintedAt || 0) - (a.mintedAt || 0); });
      return { tokens: tokens, contractOk: true };
    }).catch(function (e) {
      console.error('[oracle-nft] contract query failed:', e.message);
      return { tokens: [], contractOk: false };
    });
  }

  // ---------------------------------------------------------------- entropy
  /**
   * 32 случайных байта в base64 для поля mint.entropy.
   *
   * crypto.getRandomValues, а не Math.random: значение уходит в накопитель
   * раунда, и предсказуемость здесь означала бы предсказуемость победителя.
   */
  function freshEntropy() {
    var b = new Uint8Array(32);
    (window.crypto || window.msCrypto).getRandomValues(b);
    var s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  // ------------------------------------------------------------------ mint

  /**
   * Готовое тело MsgExecuteContract для существующего роутера подписи.
   * Оплата и минт - одна транзакция: либо всё, либо ничего.
   *
   *   const msg = OracleNFT.buildMintMsg({ sender, tier:'legendary', pool:'weekly', price });
   *   await walletProvider.signAndBroadcast([msg]);
   */
  function buildMintMsg(opts) {
    if (!opts || !opts.sender) throw new Error('buildMintMsg: sender is required');
    if (!opts.tier) throw new Error('buildMintMsg: tier is required');
    var pool = String(opts.pool || 'weekly').toLowerCase();
    if (pool !== 'daily' && pool !== 'weekly') throw new Error('buildMintMsg: pool must be daily or weekly');
    if (!opts.price) throw new Error('buildMintMsg: price is required (use getMintPrice)');

    var exec = { extension: { msg: { mint: {
      tier: String(opts.tier).toLowerCase(),
      pool: pool,
      entropy: opts.entropy || freshEntropy(),
    } } } };
    if (opts.recipient) exec.extension.msg.mint.recipient = opts.recipient;

    return {
      typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
      sender: opts.sender,
      contract: CFG.contract,
      msg: exec,
      funds: [{ denom: CFG.denom, amount: String(opts.price) }],
    };
  }

  /** Свежая цена + готовое сообщение одним вызовом. */
  function prepareMint(opts) {
    return getMintPrice(opts.tier).then(function (price) {
      return { price: price, msg: buildMintMsg(Object.assign({}, opts, { price: price })) };
    });
  }


  // -------------------------------------------------------------- adapter

  /**
   * Переводит токены контракта в форму, которую уже понимает renderBagFromNFTs
   * в app.js (slug + token_id + name + tier). Позволяет подмешать новую
   * коллекцию в существующий рендер, ничего в нём не переписывая.
   */
  function toLegacyNfts(tokens) {
    return (tokens || [])
      .filter(function (t) { return t.source === 'contract'; })
      .map(function (t) {
        return {
          slug: 'oracle-mask-' + (t.pool || 'weekly'),
          token_id: t.tokenId,
          id: t.tokenId,
          name: t.name,
          tier: t.tier,
          entries: t.entries,
          image: t.image,
          minted_at: t.mintedAt,
          _source: 'contract',
        };
      });
  }

  /** Токены контракта сразу в legacy-форме - одним вызовом для app.js. */
  function getContractTokensLegacy(owner) {
    return getContractTokens(owner).then(toLegacyNfts).catch(function (e) {
      console.error('[oracle-nft] contract query failed:', e.message);
      return [];
    });
  }

  global.OracleNFT = {
    configure: configure,
    config: CFG,
    smartQuery: smartQuery,
    getConfig: getConfig,
    getTiers: getTiers,
    getMintPrice: getMintPrice,
    getStats: getStats,
    getContractTokens: getContractTokens,
    getOwnedTokens: getOwnedTokens,
    freshEntropy: freshEntropy,
    buildMintMsg: buildMintMsg,
    prepareMint: prepareMint,
    toLegacyNfts: toLegacyNfts,
    getContractTokensLegacy: getContractTokensLegacy,
  };
})(typeof window !== 'undefined' ? window : globalThis);
