/*!
 * oracle-terms.js - Terra Oracle terms gate
 * Read to the end -> tick the boxes -> sign with the wallet (ADR-36, free) -> site unlocks.
 *
 * Usage (in every page that needs the gate, as early as possible):
 *   1) set window.ORACLE_TERMS_CONFIG = { getSigner: myGetSigner } in an inline script
 *   2) load assets/js/oracle-terms.js?v=1 right after it
 *
 * Config (all optional):
 *   version        terms version string; bump it to force everyone to re-sign
 *   minAge         minimum age shown in the text and checkbox
 *   restricted     list of restricted jurisdictions
 *   chainId        'columbus-5'
 *   leaveUrl       where "Decline" sends the user
 *   logo           logo image next to the title
 *   getSigner      async () => ({ address, sign: async (message) => ({ pub_key, signature }) })
 *                  default: the wallet connected on the site, else Keplr / Galaxy / Terra Station
 *   onAccepted     async (record) => {}  e.g. POST the record to the Worker
 *   demo           true = fake signer, for previews only
 *
 * API: OracleTerms.init(cfg) / .record() / .hasAccepted(address) / .reset()
 * Event: window 'oracle-terms:accepted' with detail = record
 */
(function () {
  'use strict';

  var DEFAULTS = {
    version: '1.0',
    effectiveDate: '1 October 2026',
    chainId: 'columbus-5',
    storageKey: 'oracle-terms',
    minAge: 18,
    restricted: [
      'the United States', 'the United Kingdom', 'France', 'Australia', 'Singapore',
      'Cuba', 'Iran', 'North Korea', 'Syria',
      'the occupied regions of Crimea, Donetsk and Luhansk'
    ],
    leaveUrl: 'https://docs.terraoracle.io',
    logo: 'https://terraoracle.io/assets/img/tco.webp',
    telegram: 'https://t.me/terra_oracle',
    docs: 'https://docs.terraoracle.io',
    getSigner: null,
    onAccepted: null,
    demo: false
  };

  var cfg, termsHash, root, els = {};
  var state = { readPct: 0, reachedEnd: false, read: {}, signing: false };

  /* ---------------------------------------------------------------- text */

  function sections(c) {
    var list = c.restricted.join(', ');
    return [
      { id: 'what', title: 'What Terra Oracle is', items: [
        'Terra Oracle is a set of experimental, open-source applications on the Terra Classic blockchain: Q&A and chat, Oracle Draw (Daily, Weekly and Circuit), Markets, Oracle Score reputation and the TCO token.',
        'It is built by a small group of independent developers. It is not a company, bank, exchange, broker or licensed gambling operator. Nothing here is regulated or insured.',
        'Most rules live in smart contracts. Some parts are still run by the team: this website, background services (Cloudflare Workers, GitHub Actions), admin keys used for contract upgrades, and the council that decides disputes in Markets. The docs say which is which.',
        'These terms cover your use of this website and every section of it.'
      ]},
      { id: 'who', title: 'Who can use it', items: [
        'You must be at least ' + c.minAge + ' and legally able to enter an agreement where you live.',
        'You may not use Terra Oracle if you are located in, a resident of, or a citizen of ' + list + '. The same applies to anyone on a sanctions list.',
        'Laws on crypto, lotteries and prediction markets differ by country and change often. Checking that your use is legal is your job, not ours. If you are unsure, ask a lawyer before you continue.',
        'Using a VPN or someone else\u2019s wallet to get around these limits is not allowed.',
        'We may block access from any region or wallet at any time.'
      ]},
      { id: 'wallet', title: 'Your wallet, your responsibility', items: [
        'Terra Oracle never holds your keys. You sign every transaction yourself.',
        'We will never ask for your seed phrase. Anyone who does is a scammer, including people who say they are us.',
        'Blockchain transactions are final. A payment sent to the wrong address or for the wrong amount cannot be reversed by us.',
        'Every transaction costs gas, and Terra Classic may take a burn tax on transfers. Amounts shown before you sign are estimates.'
      ]},
      { id: 'risks', title: 'Risks you accept', warn: true, items: [
        'You can lose everything you put in. Only use what you can afford to lose completely.',
        'Smart contracts can contain bugs. Ours are open-source but have not been professionally audited.',
        'The Terra Classic chain can halt, fork, change its rules or lose value, as it has before.',
        'LUNC and TCO prices can move sharply. A prize may be worth much less by the time you receive it.',
        'We depend on outside services: public nodes, Cloudflare, GitHub and data providers. If they fail, the site or a round can be delayed or stop.',
        'A team key could be lost or stolen despite our care.'
      ]},
      { id: 'markets', title: 'Markets (predictions)', items: [
        'A prediction is a stake of LUNC on the outcome of an event. If your outcome loses, you lose your stake.',
        'Anyone can create a market by locking a 200,000 LUNC bond. A market with an unclear question, a duplicate of another market or a result nobody can check can be voided.',
        'In one market a wallet can predict from 1,000 to 1,000,000 LUNC.',
        'After the event a result is proposed. For 48 hours anyone can challenge it by posting a bond equal to the creation bond. A challenge goes to the council court, which votes for 48 hours. The court\u2019s decision is final.',
        'If an event is cancelled, postponed or cannot be resolved, the market is voided and stakes are returned. Network fees are not.',
        'Results of real-world events come from the source named in the market. Sources can be late or wrong; the challenge window exists to catch that.',
        'You may not predict on an event you can influence or where you have inside information, and you may not coordinate with others to push a result.'
      ]},
      { id: 'draw', title: 'Oracle Draw and Circuit', items: [
        'Minting an Oracle Mask NFT is your entry into a draw. It is a purchase, not a deposit, and it is not refunded.',
        'Winners are chosen from the hash of the first block at or after the deadline, by a published rule. Anyone can check the result.',
        'A round that does not reach its minimum number of entries rolls over, as described in the docs. No round guarantees a win.',
        'In Circuit, each extra zone you claim in a round costs more than the one before, and your NFT tier limits how many zones you can hold.',
        'Payouts are sent by an automated job and can be delayed.'
      ]},
      { id: 'posts', title: 'Q&A, chat and what you post', items: [
        'Questions, answers, chat messages and votes are public and may be stored on the blockchain forever. Do not post anything private.',
        'You are responsible for what you post. No illegal content, threats, harassment, doxxing, scams or spam.',
        'We may hide content on this site. We cannot delete what is already on the chain.',
        'Answers are other users\u2019 opinions, not professional advice.'
      ]},
      { id: 'rep', title: 'Reputation, rewards and TCO', items: [
        'Oracle Score (REP) measures activity. It is not money, cannot be sold and has no promised value.',
        'Discounts, reward shares and entry rules tied to REP can change.',
        'TCO is an experimental token. There is no promise about its price, liquidity or rewards, and buying it is not an investment in Terra Oracle or its developers.'
      ]},
      { id: 'advice', title: 'Not financial advice', items: [
        'Nothing on this site, in the docs or in our channels is financial, legal or tax advice. Market odds only show what other users predicted.',
        'You are responsible for any tax on winnings or payouts where you live.'
      ]},
      { id: 'forbidden', title: 'Things you must not do', items: [
        'Use several wallets or bots to farm REP, draw entries or rewards.',
        'Exploit a bug instead of reporting it in our Telegram.',
        'Manipulate markets, prices or votes.',
        'Use Terra Oracle to launder money, evade sanctions or fund anything illegal.',
        'If you break these rules we may block your wallet on this site and ask the court to void the markets involved.'
      ]},
      { id: 'privacy', title: 'Privacy', items: [
        'We do not ask for your name, email or ID.',
        'Your wallet address and everything it does on chain are public by the nature of the blockchain.',
        'This site keeps a few settings in your browser, including a record of your signature on these terms. We may also store that record (address, terms version, signature) to prove you accepted them.',
        'Our services run on Cloudflare and GitHub, which see technical data such as IP addresses under their own policies.'
      ]},
      { id: 'liability', title: 'No warranty, limited liability', items: [
        'Terra Oracle is provided as is, without warranties of any kind.',
        'To the fullest extent the law allows, the developers and council members are not liable for any loss, including lost funds, delayed or missed payouts, wrong data or results, and downtime.',
        'If any part of these terms cannot be enforced, the rest still applies.'
      ]},
      { id: 'changes', title: 'Changes to these terms', items: [
        'We may update these terms. A new version will ask you to read and sign again before you continue.',
        'The version and its fingerprint are shown at the bottom of this window, so you can always check exactly what you signed.'
      ]},
      { id: 'contact', title: 'Contact', items: [
        'Telegram: <a href="' + c.telegram + '" target="_blank" rel="noopener">t.me/terra_oracle</a>',
        'Documentation: <a href="' + c.docs + '" target="_blank" rel="noopener">docs.terraoracle.io</a>'
      ]}
    ];
  }

  function checks(c) {
    return [
      'I am at least ' + c.minAge + ' years old, and I am not located in, a resident of or a citizen of any restricted jurisdiction listed in section 2.',
      'I understand that I can lose everything I put into Terra Oracle, that transactions cannot be reversed, and that I alone am responsible for making sure my use is legal where I live.',
      'I have read and accept the Terra Oracle terms of use, version ' + c.version + '.'
    ];
  }

  function sectionsHtml(c) {
    return sections(c).map(function (s, i) {
      return '<section class="ot-sec' + (s.warn ? ' ot-sec--warn' : '') + '" id="ot-s-' + s.id + '" data-i="' + i + '">' +
        '<h3><span class="ot-sec-n">' + (i + 1) + '</span>' + s.title + '</h3>' +
        '<ul>' + s.items.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
        '<i class="ot-sec-end" data-i="' + i + '"></i>' +
        '</section>';
    }).join('');
  }

  /* ---------------------------------------------------------------- utils */

  async function sha256Hex(str) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function loadRecords() {
    try { return JSON.parse(localStorage.getItem(cfg.storageKey) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveRecord(rec) {
    try {
      var all = loadRecords();
      all[rec.address] = rec;
      all._last = rec.address;
      localStorage.setItem(cfg.storageKey, JSON.stringify(all));
    } catch (e) { /* storage blocked: gate will show again next visit */ }
  }
  function validRecord(rec) {
    return rec && rec.version === cfg.version && rec.termsHash === termsHash && rec.signature;
  }

  function signMessage(address, ts) {
    return [
      'Terra Oracle - terms of use',
      'Version: ' + cfg.version,
      'Terms fingerprint: ' + termsHash,
      'Wallet: ' + address,
      'Signed: ' + ts,
      '',
      'I confirm that I have read and accept the Terra Oracle terms of use.',
      'This signature is not a transaction and costs nothing.'
    ].join('\n');
  }

  /* Wallets that can sign messages. Uses the wallet already connected on the
     site if there is one (getActiveKeplr from app/sign.js), otherwise whatever
     is installed: Keplr, Galaxy Station, Terra Station. */
  function detectWallets() {
    var out = [], seen = [];
    function add(id, name, k) {
      if (k && typeof k.signArbitrary === 'function' && seen.indexOf(k) < 0) { seen.push(k); out.push({ id: id, name: name, k: k }); }
    }
    try {
      if (typeof getActiveProvider === 'function' && typeof getActiveKeplr === 'function' && getActiveProvider() !== 'luncdash') {
        add('active', 'Connected wallet', getActiveKeplr());
      }
    } catch (e) {}
    var g = window.galaxyStation, st = window.station;
    add('keplr', 'Keplr', window.keplr);
    add('galaxy', 'Galaxy Station', g && (g.keplr || g));
    add('station', 'Terra Station', st && (st.keplr || st));
    return out;
  }

  async function signerFrom(w) {
    var k = w.k;
    if (typeof k.enable === 'function') { try { await k.enable(cfg.chainId); } catch (e) {} }
    var address;
    if (typeof k.getOfflineSigner === 'function') {
      var acc = await k.getOfflineSigner(cfg.chainId).getAccounts();
      address = acc && acc[0] && acc[0].address;
    }
    if (!address && typeof k.getKey === 'function') address = (await k.getKey(cfg.chainId)).bech32Address;
    if (!address) throw new Error('The wallet did not return an address.');
    return { address: address, sign: function (msg) { return k.signArbitrary(cfg.chainId, address, msg); } };
  }

  function pickWallet(list) {
    if (list.length === 1 || list[0].id === 'active') return Promise.resolve(list[0]);
    return new Promise(function (resolve, reject) {
      var box = root.querySelector('.ot-pick');
      box.innerHTML = '<span class="ot-note">Sign with</span>' + list.map(function (w, i) {
        return '<button type="button" class="ot-pick-b" data-i="' + i + '">' + w.name + '</button>';
      }).join('');
      box.hidden = false;
      box.onclick = function (e) {
        var b = e.target.closest('.ot-pick-b');
        if (!b) return;
        box.hidden = true; box.onclick = null;
        resolve(list[+b.getAttribute('data-i')]);
      };
      els.pickCancel = function () { box.hidden = true; box.onclick = null; reject(new Error('cancel')); };
    });
  }

  async function defaultSigner() {
    var list = detectWallets();
    if (!list.length) {
      throw new Error('No wallet that can sign messages was found. Install Keplr or Galaxy Station, or open this site in the wallet\u2019s built-in browser.');
    }
    say(list.length > 1 && list[0].id !== 'active' ? 'Choose a wallet to sign with.' : 'Confirm the signature in your wallet...');
    var w = await pickWallet(list);
    say('Confirm the signature in your wallet...');
    return signerFrom(w);
  }

  function demoSigner() {
    return Promise.resolve({
      address: 'terra1demo0000000000000000000000000000000000',
      sign: function () {
        return new Promise(function (r) {
          setTimeout(function () { r({ pub_key: { type: 'tendermint/PubKeySecp256k1', value: 'DEMO' }, signature: 'DEMO' }); }, 900);
        });
      }
    });
  }

  /* ---------------------------------------------------------------- styles */

  var CSS = `
.ot-root{--v:#7B5CFF;--v2:#A855F7;--vl:#C8B8FF;--g:#E8C840;--t:#E8F0FF;--m:#6B82A8;--tx:#C9D3EA;--p:#110C28;--p2:#171036;--bd:#2A2152;--ln:rgba(123,92,255,.28);
position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;
background:rgba(12,8,30,.6);-webkit-backdrop-filter:blur(14px) saturate(115%);backdrop-filter:blur(14px) saturate(115%);
font:15px/1.65 "Exo 2",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--t);
transition:opacity .7s ease,backdrop-filter .9s ease,-webkit-backdrop-filter .9s ease}
.ot-root *{box-sizing:border-box}
.ot-root.ot-out{opacity:0;-webkit-backdrop-filter:blur(0);backdrop-filter:blur(0);pointer-events:none}
.ot-panel{position:relative;width:min(1000px,100%);height:min(820px,100%);display:grid;grid-template-rows:auto 1fr auto;
background:linear-gradient(180deg,var(--p2),var(--p) 40%);border:1px solid rgba(123,92,255,.45);border-radius:14px;
box-shadow:0 0 28px -6px rgba(123,92,255,.55),0 30px 90px -20px rgba(59,31,204,.6);overflow:hidden}
.ot-panel::before,.ot-panel::after,.ot-br1,.ot-br2{content:"";position:absolute;width:24px;height:24px;border-color:var(--v);border-style:solid;pointer-events:none;z-index:3}
.ot-panel::before{top:0;left:0;border-width:2px 0 0 2px;border-top-left-radius:14px}
.ot-panel::after{top:0;right:0;border-width:2px 2px 0 0;border-top-right-radius:14px}
.ot-br1{bottom:0;left:0;border-width:0 0 2px 2px;border-bottom-left-radius:14px}
.ot-br2{bottom:0;right:0;border-width:0 2px 2px 0;border-bottom-right-radius:14px}

.ot-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:22px 28px 18px;border-bottom:1px solid var(--bd)}
.ot-brand{display:flex;align-items:center;gap:14px}
.ot-mark{width:54px;height:54px;flex:none}
.ot-logo{width:54px;height:54px;flex:none;object-fit:contain;filter:drop-shadow(0 0 10px rgba(123,92,255,.55))}
.ot-title{font:700 28px/1.05 "Rajdhani",system-ui,sans-serif;letter-spacing:.02em;margin:0}
.ot-sub{margin:4px 0 0;color:var(--m);font-size:13.5px}
.ot-ver{font:600 13px/1 "Rajdhani",sans-serif;color:var(--vl);border:1px solid var(--ln);background:rgba(123,92,255,.08);padding:7px 11px;border-radius:6px;white-space:nowrap}

.ot-body{display:grid;grid-template-columns:228px 1fr;min-height:0}
.ot-rail{border-right:1px solid var(--bd);padding:18px 0;overflow:auto;scrollbar-width:none}
.ot-rail::-webkit-scrollbar{display:none}
.ot-rail ol{list-style:none;margin:0;padding:0;position:relative}
.ot-rail ol::before{content:"";position:absolute;left:27px;top:10px;bottom:10px;width:1px;background:var(--bd)}
.ot-rail li{position:relative}
.ot-rail button{all:unset;display:flex;align-items:center;gap:12px;width:100%;padding:6px 16px 6px 21px;font-size:13px;line-height:1.35;color:var(--m);cursor:default;box-sizing:border-box}
.ot-rail button .ot-dot{width:13px;height:13px;flex:none;transform:rotate(45deg) scale(.8);border:1px solid rgba(107,130,168,.6);background:var(--p);position:relative;z-index:1;transition:all .3s}
.ot-rail li.is-read button{color:var(--tx);cursor:pointer}
.ot-rail li.is-read .ot-dot{border-color:var(--v);background:var(--v);box-shadow:0 0 10px rgba(123,92,255,.7)}
.ot-rail li.is-now button{color:var(--t)}
.ot-rail li.is-now .ot-dot{border-color:var(--v2);background:var(--v2);box-shadow:0 0 0 4px rgba(168,85,247,.22),0 0 14px rgba(168,85,247,.7)}
.ot-rail button:focus-visible{outline:2px solid var(--v);outline-offset:-2px}

.ot-read{position:relative;min-height:0;overflow:hidden}
.ot-scroll{height:100%;overflow-y:auto;padding:24px 58px 40px 34px;scroll-behavior:smooth;scrollbar-width:none}
.ot-scroll::-webkit-scrollbar{display:none}
.ot-scroll:focus{outline:none}

.ot-track{position:absolute;top:18px;bottom:18px;right:14px;width:18px;cursor:pointer;touch-action:none;user-select:none}
.ot-track::before{content:"";position:absolute;left:8px;top:0;bottom:0;width:2px;background:var(--bd);border-radius:1px}
.ot-track-fill{position:absolute;left:8px;top:0;width:2px;height:0;background:linear-gradient(180deg,var(--v),var(--v2));box-shadow:0 0 8px rgba(123,92,255,.8);border-radius:1px;transition:height .25s ease}
.ot-tick{position:absolute;left:4px;width:10px;height:1px;background:rgba(107,130,168,.55);transition:background .3s}
.ot-tick.is-read{background:var(--vl)}
.ot-thumb{position:absolute;left:3px;width:12px;min-height:30px;border-radius:6px;cursor:grab;
background:linear-gradient(180deg,rgba(123,92,255,.95),rgba(168,85,247,.95));
box-shadow:0 0 0 1px rgba(200,184,255,.35),0 0 14px rgba(123,92,255,.75);transition:box-shadow .2s,width .2s,left .2s}
.ot-thumb::before,.ot-thumb::after{content:"";position:absolute;left:3px;right:3px;height:1px;background:rgba(232,240,255,.7);top:calc(50% - 3px)}
.ot-thumb::after{top:calc(50% + 2px)}
.ot-track:hover .ot-thumb,.ot-thumb.is-drag{width:14px;left:2px;box-shadow:0 0 0 1px rgba(200,184,255,.6),0 0 22px rgba(168,85,247,.9)}
.ot-thumb.is-drag{cursor:grabbing}

.ot-alert{border:1px solid rgba(232,200,64,.4);background:linear-gradient(90deg,rgba(232,200,64,.1),rgba(232,200,64,.02));border-radius:10px;padding:16px 20px;margin-bottom:28px}
.ot-alert h3{margin:0 0 8px;font:700 19px/1.2 "Rajdhani",sans-serif;color:var(--g);letter-spacing:.02em}
.ot-alert ul{margin:0;padding-left:18px}.ot-alert li{margin:4px 0;color:var(--tx)}
.ot-meta{color:var(--m);font-size:13px;margin:0 0 22px}
.ot-sec{max-width:68ch;margin:0 0 26px;position:relative}
.ot-sec h3{display:flex;align-items:baseline;gap:12px;margin:0 0 10px;font:700 21px/1.2 "Rajdhani",sans-serif;letter-spacing:.015em}
.ot-sec-n{font-size:15px;color:var(--v);min-width:22px}
.ot-sec ul{margin:0;padding:0 0 0 34px}
.ot-sec li{margin:0 0 8px;color:var(--tx)}
.ot-sec li::marker{color:var(--v)}
.ot-sec--warn h3,.ot-sec--warn .ot-sec-n{color:var(--g)}.ot-sec--warn li::marker{color:var(--g)}
.ot-sec a{color:var(--vl)}
.ot-sec-end{display:block;height:1px}
.ot-endmark{max-width:68ch;margin-top:10px;padding-top:18px;border-top:1px dashed var(--bd);color:var(--m);font-size:13px}

.ot-foot{border-top:1px solid var(--bd);padding:16px 28px 18px;background:rgba(8,5,22,.45)}
.ot-stages{display:grid;grid-template-columns:repeat(3,1fr);margin-bottom:14px}
.ot-stage{position:relative;padding-top:12px}
.ot-stage-bar{position:absolute;top:0;left:0;right:6px;height:3px;background:var(--bd);border-radius:2px;overflow:hidden}
.ot-stage-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--v),var(--v2));box-shadow:0 0 12px var(--v);transition:width .35s ease}
.ot-stage-l{font:700 14px/1.2 "Rajdhani",sans-serif;letter-spacing:.02em;color:var(--m);display:flex;justify-content:space-between;padding-right:10px}
.ot-stage.is-on .ot-stage-l{color:var(--t)}
.ot-stage-v{font-weight:600;color:var(--vl)}
.ot-locked{display:flex;align-items:center;gap:10px;margin:0 0 14px;color:var(--m);font-size:13.5px}
.ot-locked::before{content:"";width:9px;height:9px;border:1px solid var(--m);transform:rotate(45deg)}
.ot-locked.is-hidden{display:none}
.ot-checks{display:grid;gap:8px;margin:0 0 14px}
.ot-checks.is-locked{display:none}
.ot-checks.is-open{animation:ot-in .45s ease}
@keyframes ot-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.ot-check{display:flex;gap:12px;align-items:flex-start;font-size:13.5px;line-height:1.5;cursor:pointer;color:var(--tx)}
.ot-check input{appearance:none;-webkit-appearance:none;margin:2px 0 0;width:18px;height:18px;flex:none;border:1px solid var(--m);border-radius:4px;background:transparent;display:grid;place-items:center;cursor:pointer;transition:all .2s}
.ot-check input:checked{border-color:var(--v);background:var(--v);box-shadow:0 0 10px rgba(123,92,255,.6)}
.ot-check input:checked::after{content:"";width:9px;height:5px;border:solid #fff;border-width:0 0 2px 2px;transform:translateY(-1px) rotate(-45deg)}
.ot-check input:focus-visible{outline:2px solid var(--vl);outline-offset:2px}
.ot-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.ot-sign{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:10px;padding:12px 24px;border-radius:8px;cursor:pointer;
font:700 16px/1 "Rajdhani",sans-serif;letter-spacing:.03em;color:#fff;background:linear-gradient(90deg,var(--v),var(--v2));box-shadow:0 0 24px -4px rgba(123,92,255,.8);transition:filter .2s,opacity .2s}
.ot-sign:hover{filter:brightness(1.1)}
.ot-sign:disabled{cursor:not-allowed;opacity:.35;box-shadow:none;filter:grayscale(.5)}
.ot-sign:focus-visible{outline:2px solid var(--vl);outline-offset:3px}
.ot-note{color:var(--m);font-size:12.5px}
.ot-decline{all:unset;margin-left:auto;color:var(--m);font-size:13px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.ot-decline:focus-visible{outline:2px solid var(--v);outline-offset:3px}
.ot-pick{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}
.ot-pick[hidden]{display:none}
.ot-pick-b{all:unset;cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid rgba(123,92,255,.5);background:rgba(123,92,255,.1);color:var(--t);font:600 14px/1 "Rajdhani",sans-serif;letter-spacing:.03em}
.ot-pick-b:hover{background:rgba(123,92,255,.22)}
.ot-pick-b:focus-visible{outline:2px solid var(--vl);outline-offset:2px}
.ot-msg{margin-top:10px;font-size:13px;min-height:1em}
.ot-msg.is-err{color:#ff6b6b}.ot-msg.is-ok{color:var(--vl)}
.ot-fp{margin-top:6px;color:rgba(107,130,168,.8);font-size:11.5px;word-break:break-all}

.ot-granted{position:absolute;inset:0;display:grid;place-items:center;background:rgba(17,12,40,.94);opacity:0;pointer-events:none;transition:opacity .4s;z-index:4;text-align:center}
.ot-granted.is-on{opacity:1}
.ot-granted h3{font:700 32px/1.1 "Rajdhani",sans-serif;letter-spacing:.03em;margin:14px 0 6px}
.ot-granted p{color:var(--m);margin:0}
.ot-ring{width:74px;height:74px;margin:0 auto;border-radius:50%;border:2px solid var(--v);box-shadow:0 0 30px rgba(123,92,255,.6),inset 0 0 20px rgba(168,85,247,.3);display:grid;place-items:center}
.ot-ring::after{content:"";width:26px;height:13px;border:solid var(--vl);border-width:0 0 3px 3px;transform:translateY(-3px) rotate(-45deg)}

@media (max-width:760px){
  .ot-root{padding:0}
  .ot-panel{height:100%;border-radius:0}
  .ot-panel::before,.ot-panel::after,.ot-br1,.ot-br2{border-radius:0}
  .ot-body{grid-template-columns:1fr}
  .ot-rail{display:none}
  .ot-head{padding:16px 18px 14px}
  .ot-title{font-size:23px}
  .ot-logo,.ot-mark{width:46px;height:46px}
  .ot-scroll{padding:18px 40px 30px 18px}
  .ot-track{right:6px}
  .ot-foot{padding:12px 16px 14px}
  .ot-check{font-size:12.5px}
  .ot-decline{margin-left:0}
  .ot-ver,.ot-fp{display:none}
  .ot-locked,.ot-checks{margin-bottom:10px}
}
@media (prefers-reduced-motion:reduce){
  .ot-root,.ot-stage-bar i,.ot-granted,.ot-rail button .ot-dot,.ot-track-fill,.ot-thumb{transition:none}
  .ot-scroll{scroll-behavior:auto}
  .ot-checks.is-open{animation:none}
}`;

  var MARK = '<svg class="ot-mark" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="otg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7B5CFF"/><stop offset="1" stop-color="#A855F7"/></linearGradient></defs><circle cx="20" cy="20" r="17" fill="none" stroke="url(#otg)" stroke-width="2"/><circle cx="20" cy="20" r="9" fill="none" stroke="#C8B8FF" stroke-width="1.5" opacity=".7"/><circle cx="20" cy="20" r="3.2" fill="#C8B8FF"/></svg>';

  /* ---------------------------------------------------------------- mount */

  function mount(bodyHtml) {
    if (!document.getElementById('ot-fonts')) {
      var l = document.createElement('link');
      l.id = 'ot-fonts'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Exo+2:wght@400;500&display=swap';
      document.head.appendChild(l);
    }
    var st = document.createElement('style');
    st.id = 'ot-style'; st.textContent = CSS;
    document.head.appendChild(st);

    var secs = sections(cfg);
    root = document.createElement('div');
    root.className = 'ot-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'ot-title');
    root.innerHTML =
      '<div class="ot-panel"><i class="ot-br1"></i><i class="ot-br2"></i>' +
        '<header class="ot-head"><div class="ot-brand">' +
          (cfg.logo ? '<img class="ot-logo" src="' + cfg.logo + '" alt="Terra Oracle" width="54" height="54" onerror="this.replaceWith(document.createRange().createContextualFragment(window.OracleTerms._mark))">' : MARK) +
          '<div><h2 class="ot-title" id="ot-title">Terms of use</h2>' +
          '<p class="ot-sub">Read to the end to unlock the agreement.</p></div></div>' +
          '<span class="ot-ver">Terra Oracle, v' + cfg.version + '</span>' +
        '</header>' +
        '<div class="ot-body">' +
          '<nav class="ot-rail" aria-label="Sections"><ol>' +
            secs.map(function (s, i) {
              return '<li data-i="' + i + '"><button type="button" tabindex="-1"><span class="ot-dot"></span>' + s.title + '</button></li>';
            }).join('') +
          '</ol></nav>' +
          '<div class="ot-read">' +
          '<div class="ot-scroll" tabindex="0" aria-label="Terms text">' +
            '<div class="ot-alert"><h3>Before you start</h3><ul>' +
              '<li>Terra Oracle is experimental software on Terra Classic, not a licensed or regulated service.</li>' +
              '<li>You can lose all the LUNC you put in, and transactions cannot be reversed.</li>' +
              '<li>You alone are responsible for making sure that using it is legal where you live.</li>' +
            '</ul></div>' +
            '<p class="ot-meta">Effective ' + cfg.effectiveDate + '. These terms apply to the whole site: Q&amp;A, chat, Oracle Draw, Circuit, Markets, reputation and TCO.</p>' +
            bodyHtml +
            '<p class="ot-endmark" id="ot-end">End of the terms. The agreement below is now unlocked.</p>' +
          '</div>' +
          '<div class="ot-track" aria-hidden="true"><i class="ot-track-fill"></i><b class="ot-thumb"></b></div>' +
          '</div>' +
        '</div>' +
        '<footer class="ot-foot">' +
          '<div class="ot-stages">' +
            '<div class="ot-stage is-on" data-s="read"><div class="ot-stage-bar"><i></i></div><div class="ot-stage-l"><span>1. Read</span><span class="ot-stage-v">0%</span></div></div>' +
            '<div class="ot-stage" data-s="agree"><div class="ot-stage-bar"><i></i></div><div class="ot-stage-l"><span>2. Agree</span><span class="ot-stage-v">0 of 3</span></div></div>' +
            '<div class="ot-stage" data-s="sign"><div class="ot-stage-bar"><i></i></div><div class="ot-stage-l"><span>3. Sign</span><span class="ot-stage-v"></span></div></div>' +
          '</div>' +
          '<p class="ot-locked">The agreement unlocks when you reach the end of the terms.</p>' +
          '<div class="ot-checks is-locked">' +
            checks(cfg).map(function (t, i) {
              return '<label class="ot-check"><input type="checkbox" disabled data-c="' + i + '"><span>' + t + '</span></label>';
            }).join('') +
          '</div>' +
          '<div class="ot-actions">' +
            '<button type="button" class="ot-sign" disabled>Sign with wallet</button>' +
            '<span class="ot-note">Free. A signature, not a transaction.</span>' +
            '<button type="button" class="ot-decline">Decline and leave</button>' +
          '</div>' +
          '<div class="ot-pick" hidden></div>' +
          '<div class="ot-msg" role="status" aria-live="polite"></div>' +
          '<div class="ot-fp">Terms fingerprint (SHA-256): ' + termsHash + '</div>' +
        '</footer>' +
        '<div class="ot-granted" aria-hidden="true"><div><div class="ot-ring"></div><h3>Access granted</h3><p>Welcome to Terra Oracle.</p></div></div>' +
      '</div>';

    document.body.appendChild(root);
    lockPage(true);
    dropPreBlur();

    els.scroll = root.querySelector('.ot-scroll');
    els.rail = Array.prototype.slice.call(root.querySelectorAll('.ot-rail li'));
    els.checks = Array.prototype.slice.call(root.querySelectorAll('.ot-check input'));
    els.checkWrap = root.querySelector('.ot-checks');
    els.sign = root.querySelector('.ot-sign');
    els.msg = root.querySelector('.ot-msg');
    els.stage = {};
    ['read', 'agree', 'sign'].forEach(function (k) {
      var s = root.querySelector('.ot-stage[data-s="' + k + '"]');
      els.stage[k] = { el: s, bar: s.querySelector('.ot-stage-bar i'), v: s.querySelector('.ot-stage-v') };
    });

    bind();
    els.scroll.focus({ preventScroll: true });
  }

  function lockPage(on) {
    document.documentElement.style.overflow = on ? 'hidden' : '';
    Array.prototype.forEach.call(document.body.children, function (n) {
      if (n === root) return;
      if (on) { n.setAttribute('inert', ''); n.setAttribute('data-ot-inert', ''); }
      else if (n.hasAttribute('data-ot-inert')) { n.removeAttribute('inert'); n.removeAttribute('data-ot-inert'); }
    });
  }

  /* ---------------------------------------------------------------- behaviour */

  function bind() {
    var sc = els.scroll;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var i = +e.target.getAttribute('data-i');
          state.read[i] = true;
          if (els.rail[i]) els.rail[i].classList.add('is-read');
        }
      });
    }, { root: sc, threshold: 1 });
    Array.prototype.forEach.call(sc.querySelectorAll('.ot-sec-end'), function (n) { io.observe(n); });

    var secEls = Array.prototype.slice.call(sc.querySelectorAll('.ot-sec'));
    function onScroll() {
      var max = sc.scrollHeight - sc.clientHeight;
      var pct = max <= 0 ? 100 : Math.min(100, Math.round(sc.scrollTop / max * 100));
      if (pct > state.readPct) state.readPct = pct;
      if (!state.reachedEnd && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 8) unlockAgreement();

      var top = sc.getBoundingClientRect().top + 60, now = 0;
      secEls.forEach(function (s, i) { if (s.getBoundingClientRect().top <= top) now = i; });
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 8) now = secEls.length - 1;
      els.rail.forEach(function (li, i) { li.classList.toggle('is-now', i === now); });
      render();
      paintTrack();
    }
    sc.addEventListener('scroll', onScroll, { passive: true });
    setupTrack(secEls);
    onScroll();

    els.rail.forEach(function (li, i) {
      li.querySelector('button').addEventListener('click', function () {
        if (!li.classList.contains('is-read')) return;
        secEls[i].scrollIntoView({ block: 'start' });
      });
    });

    els.checks.forEach(function (c) { c.addEventListener('change', render); });
    els.sign.addEventListener('click', doSign);
    root.querySelector('.ot-decline').addEventListener('click', function () {
      if (cfg.leaveUrl) location.href = cfg.leaveUrl;
    });

    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(root.querySelectorAll('button:not([disabled]):not([tabindex="-1"]),input:not([disabled]),a[href],.ot-scroll'), function (n) { return n.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }


  /* custom scrollbar: section ticks, read fill, draggable thumb */
  function setupTrack(secEls) {
    var sc = els.scroll, tr = root.querySelector('.ot-track');
    els.track = tr; els.thumb = tr.querySelector('.ot-thumb'); els.fill = tr.querySelector('.ot-track-fill');
    els.ticks = secEls.map(function () { var t = document.createElement('i'); t.className = 'ot-tick'; tr.appendChild(t); return t; });

    function layout() {
      var H = sc.scrollHeight;
      secEls.forEach(function (s, i) { els.ticks[i].style.top = (s.offsetTop / H * 100) + '%'; });
      paintTrack();
    }
    layout();
    if (window.ResizeObserver) new ResizeObserver(layout).observe(sc.firstElementChild ? sc : sc);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
    window.addEventListener('resize', layout);

    var drag = null;
    function toScroll(clientY, offset) {
      var r = tr.getBoundingClientRect(), th = els.thumb.offsetHeight;
      var y = Math.max(0, Math.min(r.height - th, clientY - r.top - offset));
      sc.style.scrollBehavior = 'auto';
      sc.scrollTop = y / Math.max(1, r.height - th) * (sc.scrollHeight - sc.clientHeight);
    }
    tr.addEventListener('pointerdown', function (e) {
      var onThumb = e.target === els.thumb;
      var offset = onThumb ? e.clientY - els.thumb.getBoundingClientRect().top : els.thumb.offsetHeight / 2;
      drag = { offset: offset };
      els.thumb.classList.add('is-drag');
      tr.setPointerCapture(e.pointerId);
      toScroll(e.clientY, offset);
      e.preventDefault();
    });
    tr.addEventListener('pointermove', function (e) { if (drag) toScroll(e.clientY, drag.offset); });
    function end() { drag = null; els.thumb.classList.remove('is-drag'); sc.style.scrollBehavior = ''; }
    tr.addEventListener('pointerup', end);
    tr.addEventListener('pointercancel', end);
  }

  function paintTrack() {
    if (!els.track) return;
    var sc = els.scroll, h = els.track.clientHeight;
    var ratio = sc.clientHeight / Math.max(1, sc.scrollHeight);
    var th = Math.max(30, Math.round(h * ratio));
    var max = sc.scrollHeight - sc.clientHeight;
    var pos = max <= 0 ? 0 : sc.scrollTop / max;
    els.thumb.style.height = th + 'px';
    els.thumb.style.top = Math.round((h - th) * pos) + 'px';
    els.fill.style.height = (state.readPct) + '%';
    els.ticks.forEach(function (t, i) { t.classList.toggle('is-read', !!state.read[i]); });
    els.track.style.display = max <= 0 ? 'none' : '';
  }

  function unlockAgreement() {
    state.reachedEnd = true;
    state.readPct = 100;
    els.rail.forEach(function (li) { li.classList.add('is-read'); li.querySelector('button').removeAttribute('tabindex'); });
    els.checkWrap.classList.remove('is-locked');
    els.checkWrap.classList.add('is-open');
    root.querySelector('.ot-locked').classList.add('is-hidden');
    els.checks.forEach(function (c) { c.disabled = false; });
  }

  function render() {
    var s = els.stage;
    s.read.bar.style.width = state.readPct + '%';
    s.read.v.textContent = state.reachedEnd ? 'Done' : state.readPct + '%';

    var n = els.checks.filter(function (c) { return c.checked; }).length;
    s.agree.el.classList.toggle('is-on', state.reachedEnd);
    s.agree.bar.style.width = (n / els.checks.length * 100) + '%';
    s.agree.v.textContent = n + ' of ' + els.checks.length;

    var ready = state.reachedEnd && n === els.checks.length;
    s.sign.el.classList.toggle('is-on', ready);
    els.sign.disabled = !ready || state.signing;
  }

  function say(text, kind) {
    els.msg.textContent = text || '';
    els.msg.className = 'ot-msg' + (kind ? ' is-' + kind : '');
  }

  async function doSign() {
    if (els.sign.disabled) return;
    state.signing = true; render();
    say('Confirm the signature in your wallet...');
    try {
      var getSigner = cfg.demo ? demoSigner : (cfg.getSigner || defaultSigner);
      var signer = await getSigner();
      var ts = new Date().toISOString();
      var message = signMessage(signer.address, ts);
      var sig = await signer.sign(message);
      if (!sig || !sig.signature) throw new Error('The wallet returned no signature.');

      var rec = {
        address: signer.address,
        version: cfg.version,
        termsHash: termsHash,
        signedAt: ts,
        message: message,
        pubKey: sig.pub_key ? sig.pub_key.value : null,
        signature: sig.signature
      };
      saveRecord(rec);
      if (typeof cfg.onAccepted === 'function') {
        try { await cfg.onAccepted(rec); } catch (e) { console.warn('[oracle-terms] onAccepted failed:', e); }
      }
      els.stage.sign.bar.style.width = '100%';
      els.stage.sign.v.textContent = 'Signed';
      say('Signed by ' + signer.address.slice(0, 12) + '...' + signer.address.slice(-6), 'ok');
      grant(rec);
    } catch (e) {
      var m = (e && e.message) || String(e);
      if (/reject|denied|cancel/i.test(m)) m = 'Signature cancelled in the wallet. Sign to continue.';
      say(m, 'err');
      state.signing = false; render();
    }
  }

  function grant(rec) {
    var g = root.querySelector('.ot-granted');
    g.classList.add('is-on');
    setTimeout(function () {
      root.classList.add('ot-out');
      lockPage(false);
      setTimeout(function () { root.remove(); var s = document.getElementById('ot-style'); if (s) s.remove(); }, 900);
      window.dispatchEvent(new CustomEvent('oracle-terms:accepted', { detail: rec }));
    }, 1100);
  }

  /* ---------------------------------------------------------------- public */

  async function init(opts) {
    if (root) return null;
    cfg = Object.assign({}, DEFAULTS, opts || {});
    termsHash = await sha256Hex(cfg.version + '\n' + sectionsHtml(cfg) + '\n' + checks(cfg).join('\n'));

    var all = loadRecords();
    var last = all._last && all[all._last];
    if (validRecord(last)) {
      dropPreBlur();
      window.dispatchEvent(new CustomEvent('oracle-terms:accepted', { detail: last }));
      return last;
    }
    mount(sectionsHtml(cfg));
    return null;
  }

  window.OracleTerms = {
    init: init,
    record: function () { var a = loadRecords(); return a._last ? a[a._last] : null; },
    hasAccepted: function (address) { return validRecord(loadRecords()[address]); },
    reset: function () { try { localStorage.removeItem((cfg || DEFAULTS).storageKey); } catch (e) {} },
    get fingerprint() { return termsHash; },
    _mark: MARK
  };

  // Loaded in <head>: blur the page right away if this visitor has not signed,
  // so the site never flashes unlocked before the gate mounts.
  (function preBlur() {
    var c = window.ORACLE_TERMS_CONFIG || {};
    if (c === false) return;
    var key = c.storageKey || DEFAULTS.storageKey, ver = c.version || DEFAULTS.version, ok = false;
    try { var a = JSON.parse(localStorage.getItem(key) || '{}'); ok = !!(a._last && a[a._last] && a[a._last].version === ver); } catch (e) {}
    if (ok) return;
    var st = document.createElement('style');
    st.id = 'ot-pre';
    st.textContent = 'body>*:not(.ot-root){filter:blur(14px);pointer-events:none}';
    (document.head || document.documentElement).appendChild(st);
  })();
  function dropPreBlur() { var p = document.getElementById('ot-pre'); if (p) p.remove(); }

  function auto() {
    var c = window.ORACLE_TERMS_CONFIG;
    if (c === false) return;
    init(c || {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();
})();
