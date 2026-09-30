/* multisig.js - панель мультисига совета (cw3_fixed_multisig v1.1.2)
 *
 * Мультисиг держит админку oracle-prophecy и oracle-court. Любое изменение
 * - предложение, два голоса из трёх, исполнение. Эта панель нужна, чтобы
 * участники делали всё это из Keplr или Galaxy, без терминала.
 *
 * Панель видят только участники: после подключения кошелька внизу слева
 * появляется значок "Council" со счётчиком открытых предложений. Открыть
 * вручную: openCouncil() в консоли или ?council в адресе.
 *
 * Подключать после contract-exec.js и markets.js: используются
 * sendExecuteContract, mkWallet, mkToast, mkConfirm, PROPHECY_CONTRACT,
 * COURT_CONTRACT, PROPHECY_CHAIN.
 */
(function () {
  'use strict';

  var MULTISIG = 'terra1vvwccg3ey00fg3xhux2cfgx2z5l47uuv0lzm72dtntctdqmf3wuqmdnm06';
  var CHAIN = 'columbus-5';
  var TREASURY = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt';
  var LCD = ['https://terra-classic-lcd.publicnode.com', 'https://lcd.terra-classic.hexxagon.io'];
  var FINDER = 'https://finder.terraport.finance/mainnet';
  // Газ: голос и предложение дешёвые, исполнение несёт вложенные сообщения
  // (миграция стоит около 300k), поэтому лимит с запасом.
  var GAS_LIGHT = 500000;
  var GAS_EXEC = 1800000;

  var OPEN_ON_LOAD = /[?&]council\b/.test(location.search);

  var S = { voters: [], threshold: 2, proposals: [], votes: {}, me: null, loading: false, tpl: 'test' };

  function names() {
    var n = {};
    n[MULTISIG] = 'Council multisig';
    n[TREASURY] = 'Treasury';
    if (typeof PROPHECY_CONTRACT !== 'undefined') n[PROPHECY_CONTRACT] = 'Markets contract';
    if (typeof COURT_CONTRACT !== 'undefined') n[COURT_CONTRACT] = 'Court contract';
    return n;
  }
  function label(addr) {
    var n = names()[addr];
    return n ? n + ' <code>' + short(addr) + '</code>' : '<code>' + esc(addr) + '</code>';
  }
  function short(a) { a = String(a || ''); return a.length > 20 ? a.slice(0, 10) + '...' + a.slice(-6) : esc(a); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function wallet() { return typeof mkWallet === 'function' ? mkWallet() : null; }
  function toast(t, k) { if (typeof mkToast === 'function') mkToast(t, k); else alert(t); }
  function isMember(a) { return !!a && S.voters.some(function (v) { return v.addr === a; }); }
  function b64(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
  function unb64(s) {
    try { return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch (e) { return null; }
  }
  function lunc(u) { return (Number(u) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 }); }

  async function q(msg) {
    var enc = btoa(JSON.stringify(msg));
    var err;
    for (var i = 0; i < LCD.length; i++) {
      try {
        var r = await fetch(LCD[i] + '/cosmwasm/wasm/v1/contract/' + MULTISIG + '/smart/' + enc);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return (await r.json()).data;
      } catch (e) { err = e; }
    }
    throw err;
  }

  async function load() {
    S.loading = true;
    try {
      var res = await Promise.all([
        q({ list_voters: {} }),
        q({ threshold: {} }),
        q({ reverse_proposals: { limit: 20 } }),
      ]);
      S.voters = res[0].voters || [];
      var th = res[1] && (res[1].absolute_count || res[1]);
      S.threshold = th && th.weight ? th.weight : 2;
      S.proposals = res[2].proposals || [];
      var open = S.proposals.filter(function (p) { return p.status === 'open' || p.status === 'passed'; });
      var lists = await Promise.all(open.map(function (p) {
        return q({ list_votes: { proposal_id: p.id } }).catch(function () { return { votes: [] }; });
      }));
      S.votes = {};
      open.forEach(function (p, i) { S.votes[p.id] = lists[i].votes || []; });
    } finally {
      S.loading = false;
    }
  }

  /* ── чтение сообщений предложения ─────────────────────────────────────── */

  function describe(m) {
    if (m.bank && m.bank.send) {
      var s = m.bank.send;
      var amt = (s.amount || []).map(function (c) {
        return c.denom === 'uluna' ? lunc(c.amount) + ' LUNC' : esc(c.amount + ' ' + c.denom);
      }).join(', ');
      return '<b>Send</b> ' + amt + ' to ' + label(s.to_address);
    }
    if (m.wasm && m.wasm.execute) {
      var e = m.wasm.execute;
      return '<b>Call</b> ' + label(e.contract_addr) + '<pre>' + esc(JSON.stringify(unb64(e.msg), null, 2)) + '</pre>' +
        ((e.funds || []).length ? '<div class="cm-warn">Attaches ' + esc(JSON.stringify(e.funds)) + '</div>' : '');
    }
    if (m.wasm && m.wasm.migrate) {
      var g = m.wasm.migrate;
      return '<b>Migrate</b> ' + label(g.contract_addr) + ' to code <b>' + esc(g.new_code_id) + '</b><pre>' +
        esc(JSON.stringify(unb64(g.msg), null, 2)) + '</pre>';
    }
    if (m.wasm && m.wasm.update_admin) {
      var u = m.wasm.update_admin;
      return '<b>Hand over the upgrade right</b> of ' + label(u.contract_addr) + ' to ' + label(u.admin);
    }
    if (m.wasm && m.wasm.clear_admin) {
      return '<div class="cm-warn"><b>Remove the upgrade right</b> of ' + label(m.wasm.clear_admin.contract_addr) +
        ' for good. The contract can never be migrated again.</div>';
    }
    return '<div class="cm-warn">Unrecognised message, read it carefully:</div><pre>' + esc(JSON.stringify(m, null, 2)) + '</pre>';
  }

  function expiresText(p) {
    var x = p.expires || {};
    if (x.at_time) {
      var t = Math.floor(Number(x.at_time) / 1e9) - Math.floor(Date.now() / 1000);
      if (t <= 0) return 'expired';
      var d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600);
      return (d ? d + 'd ' : '') + h + 'h left';
    }
    if (x.at_height) return 'until block ' + x.at_height;
    return '';
  }

  /* ── шаблоны новых предложений ────────────────────────────────────────── */

  var TEMPLATES = {
    test: { name: 'Test: send LUNC to the treasury', hint: 'Checks that proposing, voting and executing work. The multisig must hold the amount.' },
    prophecy: { name: 'Change the markets config', hint: 'Only the fields you list change. Amounts are in uluna: 1 LUNC = 1000000.' },
    court: { name: 'Change the court config', hint: 'Council, quorum, voting time. A change applies to disputes opened after it.' },
    migrate: { name: 'Migrate a contract', hint: 'Upload the new code first and check its checksum against the GitHub build.' },
    admin: { name: 'Hand over an admin', hint: 'Moves both the config admin and the upgrade right. Double check the address.' },
    custom: { name: 'Custom messages', hint: 'A JSON array of CosmosMsg. For experienced use only.' },
  };

  function contractOptions(withMs) {
    var o = [];
    if (typeof PROPHECY_CONTRACT !== 'undefined') o.push([PROPHECY_CONTRACT, 'Markets contract']);
    if (typeof COURT_CONTRACT !== 'undefined') o.push([COURT_CONTRACT, 'Court contract']);
    if (withMs) o.push([MULTISIG, 'Council multisig itself']);
    return o.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('');
  }

  function tplFields(k) {
    switch (k) {
      case 'test':
        return '<label>Amount, LUNC<input id="cm-f-amt" type="number" min="0.000001" step="any" value="1"></label>';
      case 'prophecy':
        return '<label>Fields to change (JSON)<textarea id="cm-f-json" rows="4">{"max_bet": "10000000000000"}</textarea></label>';
      case 'court':
        return '<label>Fields to change (JSON)<textarea id="cm-f-json" rows="4">{"voting_secs": 172800}</textarea></label>';
      case 'migrate':
        return '<label>Contract<select id="cm-f-c">' + contractOptions(true) + '</select></label>' +
          '<label>New code id<input id="cm-f-code" type="number" min="1" placeholder="11684"></label>' +
          '<label>Migrate message (JSON)<textarea id="cm-f-json" rows="2">{}</textarea></label>';
      case 'admin':
        return '<label>Contract<select id="cm-f-c">' + contractOptions(true) + '</select></label>' +
          '<label>New admin address<input id="cm-f-addr" type="text" placeholder="terra1..."></label>';
      default:
        return '<label>Messages (JSON array)<textarea id="cm-f-json" rows="6">[]</textarea></label>';
    }
  }

  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function parseJson(s, what) {
    try { return JSON.parse(s); } catch (e) { throw new Error(what + ' is not valid JSON.'); }
  }
  function isAddr(a) { return /^terra1[0-9a-z]{38}([0-9a-z]{20})?$/.test(a); }

  function buildMsgs(k) {
    switch (k) {
      case 'test': {
        var amt = Math.round(Number(val('cm-f-amt')) * 1e6);
        if (!(amt > 0)) throw new Error('Enter an amount.');
        return [{ bank: { send: { to_address: TREASURY, amount: [{ denom: 'uluna', amount: String(amt) }] } } }];
      }
      case 'prophecy':
      case 'court': {
        var fields = parseJson(val('cm-f-json'), 'Fields');
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Fields must be a JSON object.');
        var to = k === 'prophecy' ? PROPHECY_CONTRACT : COURT_CONTRACT;
        return [{ wasm: { execute: { contract_addr: to, msg: b64({ update_config: fields }), funds: [] } } }];
      }
      case 'migrate': {
        var code = Number(val('cm-f-code'));
        if (!(code > 0)) throw new Error('Enter the new code id.');
        return [{ wasm: { migrate: { contract_addr: val('cm-f-c'), new_code_id: code, msg: b64(parseJson(val('cm-f-json') || '{}', 'Migrate message')) } } }];
      }
      case 'admin': {
        var c = val('cm-f-c'), a = val('cm-f-addr');
        if (!isAddr(a)) throw new Error('That is not a terra1 address.');
        var out = [];
        // У контракта мультисига нет админа в конфиге, только право миграции.
        if (c !== MULTISIG) out.push({ wasm: { execute: { contract_addr: c, msg: b64({ update_config: { admin: a } }), funds: [] } } });
        out.push({ wasm: { update_admin: { contract_addr: c, admin: a } } });
        return out;
      }
      default: {
        var arr = parseJson(val('cm-f-json'), 'Messages');
        if (!Array.isArray(arr) || !arr.length) throw new Error('Messages must be a non-empty JSON array.');
        return arr;
      }
    }
  }

  /* ── действия ─────────────────────────────────────────────────────────── */

  async function send(msg, gas, memo) {
    var me = wallet();
    if (!me) { toast('Connect a wallet first.', 'info'); return null; }
    if (!isMember(me)) { toast('This wallet is not on the council.', 'err'); return null; }
    try {
      var hash = await window.sendExecuteContract(me, MULTISIG, msg, [], memo, CHAIN, gas);
      toast('Sent. Updating after the next block.', 'ok');
      setTimeout(refresh, 7000);
      return hash;
    } catch (e) {
      toast(e && e.message ? e.message : String(e), 'err');
      return null;
    }
  }

  async function propose() {
    var title = val('cm-title');
    var desc = val('cm-desc');
    if (!title) { toast('Give the proposal a title.', 'info'); return; }
    var msgs;
    try { msgs = buildMsgs(S.tpl); } catch (e) { toast(e.message, 'err'); return; }
    var preview = msgs.map(function (m) { return '<div class="cm-msg">' + describe(m) + '</div>'; }).join('');
    var ok = typeof mkConfirm === 'function'
      ? await mkConfirm({ title: 'Propose: ' + esc(title) + '?', body: '<p>Your wallet votes yes automatically. One more yes executes it.</p>' + preview, ok: 'Propose' })
      : confirm('Propose ' + title + '?');
    if (!ok) return;
    await send({ propose: { title: title, description: desc || title, msgs: msgs } }, GAS_LIGHT, 'council: propose');
  }

  window.councilVote = async function (id, v) {
    await send({ vote: { proposal_id: id, vote: v } }, GAS_LIGHT, 'council: vote ' + id);
  };
  window.councilExecute = async function (id) {
    var p = S.proposals.find(function (x) { return x.id === id; });
    var ok = typeof mkConfirm === 'function'
      ? await mkConfirm({ title: 'Execute proposal #' + id + '?', body: (p ? p.msgs.map(function (m) { return '<div class="cm-msg">' + describe(m) + '</div>'; }).join('') : ''), ok: 'Execute', tone: 'warn' })
      : confirm('Execute #' + id + '?');
    if (ok) await send({ execute: { proposal_id: id } }, GAS_EXEC, 'council: execute ' + id);
  };
  window.councilClose = async function (id) {
    await send({ close: { proposal_id: id } }, GAS_LIGHT, 'council: close ' + id);
  };

  /* ── разметка ─────────────────────────────────────────────────────────── */

  function proposalCard(p) {
    var me = wallet();
    var votes = S.votes[p.id] || [];
    var mine = votes.find(function (v) { return v.voter === me; });
    var yes = votes.filter(function (v) { return v.vote === 'yes'; }).length;
    var no = votes.filter(function (v) { return v.vote === 'no'; }).length;
    var member = isMember(me);
    var expired = expiresText(p) === 'expired';
    var actions = '';
    if (member && p.status === 'open' && !mine && !expired) {
      actions = '<button class="cm-b yes" onclick="councilVote(' + p.id + ',\'yes\')">Vote yes</button>' +
        '<button class="cm-b no" onclick="councilVote(' + p.id + ',\'no\')">Vote no</button>';
    }
    if (member && p.status === 'passed') {
      actions += '<button class="cm-b go" onclick="councilExecute(' + p.id + ')">Execute</button>';
    }
    if (member && (p.status === 'rejected' || (p.status === 'open' && expired))) {
      actions += '<button class="cm-b" onclick="councilClose(' + p.id + ')">Close</button>';
    }
    var tally = (p.status === 'open' || p.status === 'passed')
      ? '<span class="cm-tally">' + yes + ' yes, ' + no + ' no of ' + S.threshold + ' needed' +
        (mine ? ' &middot; you voted ' + esc(mine.vote) : '') + '</span>'
      : '';
    return '<article class="cm-p st-' + esc(p.status) + '">' +
      '<header><span class="cm-id">#' + p.id + '</span><h4>' + esc(p.title) + '</h4>' +
      '<span class="cm-st">' + esc(p.status) + '</span></header>' +
      (p.description && p.description !== p.title ? '<p class="cm-desc">' + esc(p.description) + '</p>' : '') +
      p.msgs.map(function (m) { return '<div class="cm-msg">' + describe(m) + '</div>'; }).join('') +
      '<footer>' + tally + '<span class="cm-exp">' + esc(expiresText(p)) + ' &middot; by ' + short(p.proposer) + '</span>' +
      '<span class="cm-act">' + actions + '</span></footer></article>';
  }

  function panelHtml() {
    var me = wallet();
    var member = isMember(me);
    var list = S.proposals.length
      ? S.proposals.map(proposalCard).join('')
      : '<p class="cm-empty">No proposals yet.</p>';
    var form = member
      ? '<section class="cm-new"><h3>New proposal</h3>' +
        '<div class="cm-tpls">' + Object.keys(TEMPLATES).map(function (k) {
          return '<button type="button" data-tpl="' + k + '" class="' + (S.tpl === k ? 'on' : '') + '">' + TEMPLATES[k].name + '</button>';
        }).join('') + '</div>' +
        '<p class="cm-hint">' + TEMPLATES[S.tpl].hint + '</p>' +
        '<label>Title<input id="cm-title" type="text" maxlength="120"></label>' +
        '<label>Why (shown to the other members)<textarea id="cm-desc" rows="2" maxlength="1000"></textarea></label>' +
        '<div id="cm-fields">' + tplFields(S.tpl) + '</div>' +
        '<button class="cm-b go" id="cm-propose">Review and propose</button></section>'
      : '<p class="cm-note">' + (me ? 'This wallet is not a council member. You can read, but not vote.' : 'Connect a council wallet to vote.') + '</p>';
    return '<div class="cm-box" role="dialog" aria-modal="true" aria-label="Council multisig">' +
      '<header class="cm-head"><div><h2>Council multisig</h2>' +
      '<p>' + S.threshold + ' of ' + S.voters.length + ' &middot; <a href="' + FINDER + '/address/' + MULTISIG + '" target="_blank" rel="noopener"><code>' + short(MULTISIG) + '</code></a></p></div>' +
      '<button class="cm-x" aria-label="Close" onclick="closeCouncil()">&times;</button></header>' +
      '<div class="cm-members">' + S.voters.map(function (v) {
        return '<span class="' + (v.addr === me ? 'me' : '') + '"><code>' + short(v.addr) + '</code>' + (v.addr === me ? ' you' : '') + '</span>';
      }).join('') + '</div>' +
      '<div class="cm-list">' + list + '</div>' + form + '</div>';
  }

  var CSS = '' +
    '.cm-wrap{position:fixed;inset:0;z-index:9000;background:rgba(8,6,22,.7);backdrop-filter:blur(6px);display:flex;justify-content:center;align-items:flex-start;overflow:auto;padding:40px 16px}' +
    '.cm-box{width:min(760px,100%);background:#12182A;border:1px solid rgba(123,92,255,.45);border-radius:14px;padding:22px 24px;color:#E8F0FF;box-shadow:0 0 28px -6px rgba(123,92,255,.55)}' +
    '.cm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.cm-head h2{margin:0;font:700 24px/1.1 Rajdhani,sans-serif}.cm-head p{margin:4px 0 0;color:#6B82A8;font-size:13px}.cm-head a{color:#C8B8FF}' +
    '.cm-x{all:unset;cursor:pointer;font-size:26px;line-height:1;color:#6B82A8;padding:0 4px}.cm-x:hover{color:#fff}' +
    '.cm-members{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 18px}.cm-members span{font-size:12px;padding:5px 9px;border:1px solid #1E2A42;border-radius:6px;color:#9fb0cf}.cm-members .me{border-color:#7B5CFF;color:#fff}' +
    '.cm-list{display:grid;gap:12px}.cm-empty,.cm-note{color:#6B82A8;font-size:14px}' +
    '.cm-p{border:1px solid #1E2A42;border-radius:10px;padding:14px 16px;background:#161E30}.cm-p.st-open{border-color:rgba(123,92,255,.5)}.cm-p.st-passed{border-color:rgba(232,200,64,.6)}' +
    '.cm-p header{display:flex;gap:10px;align-items:baseline}.cm-p h4{margin:0;flex:1;font:700 17px/1.2 Rajdhani,sans-serif}.cm-id{color:#7B5CFF;font-weight:700}' +
    '.cm-st{font-size:12px;text-transform:capitalize;color:#9fb0cf}.st-passed .cm-st{color:#E8C840}.st-executed .cm-st{color:#00FFB0}.st-rejected .cm-st{color:#ff6b6b}' +
    '.cm-desc{margin:6px 0 0;color:#C9D3EA;font-size:14px}' +
    '.cm-msg{margin-top:10px;font-size:14px;color:#C9D3EA}.cm-msg code{color:#C8B8FF}.cm-msg pre{margin:6px 0 0;padding:8px 10px;background:#0B0F1A;border-radius:6px;font-size:12px;overflow:auto;max-height:220px}' +
    '.cm-warn{color:#E8C840;font-size:13px;margin-top:4px}' +
    '.cm-p footer{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-top:12px;font-size:12.5px;color:#6B82A8}.cm-tally{color:#E8F0FF}.cm-act{margin-left:auto;display:flex;gap:8px}' +
    '.cm-b{all:unset;cursor:pointer;padding:8px 14px;border-radius:8px;border:1px solid #2A3654;font:700 14px/1 Rajdhani,sans-serif;letter-spacing:.03em;color:#E8F0FF}' +
    '.cm-b.yes{border-color:rgba(0,255,176,.5)}.cm-b.no{border-color:rgba(255,107,107,.5)}.cm-b.go{background:linear-gradient(90deg,#7B5CFF,#A855F7);border-color:transparent}.cm-b:hover{filter:brightness(1.15)}' +
    '.cm-new{margin-top:22px;padding-top:18px;border-top:1px solid #1E2A42;display:grid;gap:10px}.cm-new h3{margin:0;font:700 19px/1.2 Rajdhani,sans-serif}' +
    '.cm-tpls{display:flex;flex-wrap:wrap;gap:6px}.cm-tpls button{all:unset;cursor:pointer;font-size:12.5px;padding:6px 10px;border-radius:6px;border:1px solid #1E2A42;color:#9fb0cf}.cm-tpls button.on{border-color:#7B5CFF;color:#fff;background:rgba(123,92,255,.15)}' +
    '.cm-hint{margin:0;color:#6B82A8;font-size:13px}' +
    '.cm-new label{display:grid;gap:4px;font-size:13px;color:#9fb0cf}.cm-new input,.cm-new textarea,.cm-new select{background:#0B0F1A;border:1px solid #1E2A42;border-radius:6px;color:#E8F0FF;padding:8px 10px;font:13px/1.4 ui-monospace,monospace}' +
    '.cm-new .cm-b.go{justify-self:start}' +
    '#cm-chip{all:unset;position:fixed;z-index:8000;left:16px;bottom:16px;cursor:pointer;padding:8px 14px;border-radius:999px;background:#12182A;border:1px solid rgba(123,92,255,.6);color:#E8F0FF;font:700 13px/1 Rajdhani,sans-serif;letter-spacing:.04em;box-shadow:0 0 16px -4px rgba(123,92,255,.8)}' +
    '#cm-chip b{margin-left:6px;background:#7B5CFF;border-radius:999px;padding:2px 7px}' +
    '@media (max-width:600px){.cm-wrap{padding:0}.cm-box{border-radius:0;min-height:100%}.cm-act{margin-left:0}}';

  function ensureCss() {
    if (document.getElementById('cm-css')) return;
    var st = document.createElement('style');
    st.id = 'cm-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function render() {
    var wrap = document.getElementById('cm-wrap');
    if (!wrap) return;
    var keep = {};
    ['cm-title', 'cm-desc'].forEach(function (id) { keep[id] = val(id); });
    wrap.innerHTML = panelHtml();
    Object.keys(keep).forEach(function (id) { var el = document.getElementById(id); if (el) el.value = keep[id]; });
    wrap.querySelectorAll('[data-tpl]').forEach(function (b) {
      b.onclick = function () { S.tpl = b.getAttribute('data-tpl'); render(); };
    });
    var go = document.getElementById('cm-propose');
    if (go) go.onclick = propose;
  }

  async function refresh() {
    try { await load(); } catch (e) { toast('Could not read the multisig: ' + (e.message || e), 'err'); }
    render();
    chip();
  }

  window.openCouncil = async function () {
    ensureCss();
    var wrap = document.getElementById('cm-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'cm-wrap';
      wrap.className = 'cm-wrap';
      wrap.addEventListener('click', function (e) { if (e.target === wrap) window.closeCouncil(); });
      document.body.appendChild(wrap);
    }
    wrap.innerHTML = '<div class="cm-box"><p class="cm-note">Reading the multisig...</p></div>';
    await refresh();
  };
  window.closeCouncil = function () {
    var w = document.getElementById('cm-wrap');
    if (w) w.remove();
  };

  /* ── значок для участников ────────────────────────────────────────────── */

  function chip() {
    var me = wallet();
    var el = document.getElementById('cm-chip');
    if (!isMember(me)) { if (el) el.remove(); return; }
    ensureCss();
    if (!el) {
      el = document.createElement('button');
      el.id = 'cm-chip';
      el.type = 'button';
      el.onclick = window.openCouncil;
      document.body.appendChild(el);
    }
    var pending = S.proposals.filter(function (p) {
      if (p.status === 'passed') return true;
      if (p.status !== 'open' || expiresText(p) === 'expired') return false;
      return !(S.votes[p.id] || []).some(function (v) { return v.voter === me; });
    }).length;
    el.innerHTML = 'Council' + (pending ? '<b>' + pending + '</b>' : '');
    el.title = pending ? pending + ' proposal(s) waiting for you' : 'Council multisig';
  }

  var lastWallet = null;
  async function tick() {
    if (typeof PROPHECY_CHAIN !== 'undefined' && PROPHECY_CHAIN !== CHAIN) return;
    var me = wallet();
    if (me === lastWallet) return;
    lastWallet = me;
    if (!me && !OPEN_ON_LOAD) { chip(); return; }
    try { await load(); } catch (e) { return; }
    chip();
    if (document.getElementById('cm-wrap')) render();
  }

  setInterval(tick, 3000);
  setInterval(function () { if (isMember(wallet())) refresh(); }, 5 * 60 * 1000);
  if (OPEN_ON_LOAD) setTimeout(window.openCouncil, 1500);
})();
