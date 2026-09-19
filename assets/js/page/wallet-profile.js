// Публичная карточка участника: OracleProfile.open('terra1...'),
// или клик по любому элементу с data-profile="terra1...".
//
// Открывается окном поверх страницы и работает без подключённого кошелька:
// всё берётся из публичных данных.
//   REP и ранг   /rep/scores           onchain = all-time REP, от него ранг
//                                      (как на странице профиля после фикса 2026-08-08)
//   Q&A          /questions            вопросы, ответы, принятые, апвоуты
//   Circuit      /circuit/history      blocks[].wallet
//   розыгрыши    winners.json          запись раунда содержит адрес победителя
//   NFT          NFT-контракт          owner_tokens с метаданными (tier, pool, minted_at)
// Ранги НЕ дублируем: берём getRank / getRankBadgeHTML / RANKS из profile.js.
(function () {
  'use strict';

  var Q_WORKER    = 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
  var DRAW_WORKER = 'https://oracle-draw.vladislav-baydan.workers.dev';
  var DATA_ORIGIN = 'https://draw.terraoracle.io';
  var LCD         = 'https://terra-classic-lcd.publicnode.com';
  var NFT         = 'terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx';
  var ICONS       = 'assets/img/icons/';

  var modal = null, feed = [];

  function getJSON(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function num(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }

  function lunc(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(Math.round(n));
  }

  function ago(sec) {
    var d = Math.floor(Date.now() / 1000) - sec;
    if (d < 60)     return 'just now';
    if (d < 3600)   return Math.floor(d / 60) + ' min ago';
    if (d < 86400)  { var h = Math.floor(d / 3600); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
    var days = Math.floor(d / 86400);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  function short(a) { a = String(a || ''); return a.length > 16 ? a.slice(0, 8) + '\u2026' + a.slice(-4) : a; }

  function nftTokens(owner) {
    var out = [];
    function page(after) {
      var q = { extension: { msg: { owner_tokens: { owner: owner, limit: 100 } } } };
      if (after) q.extension.msg.owner_tokens.start_after = after;
      var b64 = encodeURIComponent(btoa(JSON.stringify(q)));
      return getJSON(LCD + '/cosmwasm/wasm/v1/contract/' + NFT + '/smart/' + b64).then(function (r) {
        var t = (r && r.data && r.data.tokens) || [];
        out = out.concat(t);
        return t.length === 100 ? page(t[t.length - 1].token_id) : out;
      });
    }
    return page(null).catch(function () { return out; });
  }

  // ─── ранги из profile.js ─────────────────────────────────────

  function rankInfo(score) {
    var info = { name: '', badge: '', next: null, pct: 100 };
    try {
      if (typeof getRankBadgeHTML === 'function') info.badge = getRankBadgeHTML(score);
      if (typeof getRank === 'function') {
        var r = getRank(score) || {};
        info.name = r.name || r.title || r.label || '';
        if (typeof RANKS !== 'undefined') {
          var nx = RANKS.find(function (x) { return x.minScore > score; });
          if (nx) {
            var base = r.minScore || 0;
            info.next = { name: nx.name || nx.title || nx.label || '', need: nx.minScore - score };
            info.pct = Math.max(0, Math.min(100, Math.round((score - base) / (nx.minScore - base) * 100)));
          }
        }
      }
    } catch (e) {}
    return info;
  }

  // ─── сбор данных ─────────────────────────────────────────────

  function collect(w) {
    return Promise.all([
      getJSON(Q_WORKER + '/rep/scores'),
      getJSON(Q_WORKER + '/questions'),
      getJSON(DRAW_WORKER + '/circuit/history?limit=50'),
      getJSON(DATA_ORIGIN + '/winners.json?t=' + Math.floor(Date.now() / 3600000)),
      nftTokens(w)
    ]).then(function (res) {
      var sc = res[0] || {};
      var rep = (sc.onchain && sc.onchain[w] != null) ? Number(sc.onchain[w]) : Number((sc.scores || {})[w]) || 0;

      var st = { rep: rep, asked: 0, answers: 0, accepted: 0, upvotes: 0,
                 zones: 0, zonesPaid: 0, wins: 0, won: 0, nft: [], alias: '' };
      var items = [];

      ((res[1] && res[1].questions) || []).forEach(function (q) {
        if (q.wallet === w) {
          st.asked++;
          if (q.alias) st.alias = q.alias;
          if (q.createdAt) items.push({ type: 'questions', view: 'board', target: { q: q.id }, ts: q.createdAt,
            ic: 'ask.webp', text: 'Asked a question', sub: q.text,
            amt: q.paymentAmount ? lunc(q.paymentAmount) + ' LUNC' : '', tone: 'var(--ink-2)' });
        }
        (q.answers || []).forEach(function (a) {
          if (a.wallet !== w) return;
          var acc = q.chosenAnswerId && q.chosenAnswerId === a.id;
          st.answers++;
          st.upvotes += Number(a.votes) || 0;
          if (acc) st.accepted++;
          if (a.createdAt) items.push({ type: 'answers', view: 'board', target: { q: q.id, a: a.id }, ts: a.createdAt,
            ic: acc ? 'reputation.webp' : 'p-answers.webp', text: acc ? 'Answer accepted' : 'Answered', sub: q.text,
            amt: acc ? '+60 REP' : (a.votes ? '\u2191' + a.votes : ''), tone: acc ? 'var(--green)' : 'var(--ink-3)' });
        });
      });

      ((res[2] && res[2].rounds) || []).forEach(function (r) {
        (r.blocks || []).forEach(function (b) {
          if (b.wallet !== w) return;
          var z = (Number(b.to) - Number(b.from) + 1) || 1;
          st.zones += z;
          st.zonesPaid += (Number(b.paid) || 0) / 1e6;
          if (b.at) items.push({ type: 'circuit', view: 'draw', target: { tab: 'circuit' }, ts: Math.floor(b.at / 1000),
            ic: 'circuit.webp', text: z === 1 ? 'Claimed a Circuit zone' : 'Claimed ' + z + ' Circuit zones', sub: '',
            amt: b.paid ? lunc(b.paid / 1e6) + ' LUNC' : '', tone: 'var(--amber)' });
        });
      });

      // Формат записи победителя в winners.json разный у Daily и Weekly,
      // поэтому просто ищем адрес внутри записи раунда.
      ['daily', 'weekly'].forEach(function (pool) {
        ((res[3] && res[3][pool]) || []).forEach(function (r) {
          if (r.skipped || JSON.stringify(r).indexOf(w) < 0) return;
          st.wins++;
          var ts = Math.floor(Date.parse(r.date + 'T20:00:00Z') / 1000);
          if (isFinite(ts)) items.push({ type: 'draws', view: 'draw', target: { tab: pool }, ts: ts,
            ic: 'draw.webp', text: 'Won the ' + (pool === 'weekly' ? 'Weekly' : 'Daily') + ' draw', sub: r.date,
            amt: '', tone: 'var(--cyan)' });
        });
      });

      (res[4] || []).forEach(function (t) {
        var m = t.metadata || t.extension || {};
        var tier = String(m.tier || String(t.token_id).split('-')[0]).toLowerCase();
        var pool = String(m.pool || '').toLowerCase();
        st.nft.push({ id: t.token_id, tier: tier, pool: pool });
        if (m.minted_at) items.push({ type: 'nft', view: pool ? 'draw' : 'nft', target: pool ? { tab: pool } : {},
          ts: Number(m.minted_at), ic: 'nft.webp',
          text: 'Minted ' + tier.charAt(0).toUpperCase() + tier.slice(1) + ' NFT', sub: pool ? pool + ' draw' : '',
          amt: '', tone: 'var(--ink-2)' });
      });

      var now = Math.floor(Date.now() / 1000) + 300;
      items = items.filter(function (a) { return a.ts && a.ts <= now; });
      items.sort(function (a, b) { return b.ts - a.ts; });
      return { st: st, items: items };
    });
  }

  // ─── отрисовка ───────────────────────────────────────────────

  var TIER_ORDER = ['legendary', 'epic', 'rare', 'common'];
  var TIER_TONE  = { common: 'var(--ink-2)', rare: 'var(--cyan)', epic: '#b18cff', legendary: 'var(--amber)' };

  function avatarHTML(w) {
    var src = '';
    try { if (typeof getProfileAvatar === 'function') src = getProfileAvatar(w) || ''; } catch (e) {}
    if (src) return '<img class="wp-ava" src="' + esc(src) + '" alt="">';
    try { if (typeof walletAvatar === 'function') { var a = walletAvatar(w); if (a) return '<span class="wp-ava">' + a + '</span>'; } } catch (e) {}
    return '<span class="wp-ava wp-ava-empty"></span>';
  }

  function nameOf(w, alias) {
    try { if (typeof getProfileNickname === 'function') { var n = getProfileNickname(w); if (n) return n; } } catch (e) {}
    return alias || short(w);
  }

  function stat(v, label) { return '<div class="wp-stat"><b>' + v + '</b><span>' + label + '</span></div>'; }

  function body(w, d) {
    var st = d.st, rk = rankInfo(st.rep);
    var tiers = {};
    st.nft.forEach(function (n) { tiers[n.tier] = (tiers[n.tier] || 0) + 1; });
    var nftLine = st.nft.length
      ? TIER_ORDER.filter(function (t) { return tiers[t]; }).map(function (t) {
          return '<span class="wp-tier" style="color:' + (TIER_TONE[t] || 'var(--ink-2)') + '">' + tiers[t] + ' ' + t + '</span>';
        }).join('')
      : '<span class="wp-muted">No NFTs yet</span>';

    feed = d.items.slice(0, 30);
    var rows = feed.length ? feed.map(function (a, i) {
      return '<li class="act-go" role="button" tabindex="0" data-i="' + i + '">' +
        '<img class="ico" src="' + ICONS + a.ic + '" alt="" width="96" height="96" loading="lazy">' +
        '<span class="tx"><b>' + esc(a.text) + '</b><span>' + ago(a.ts) +
        (a.sub ? ' \u00b7 ' + esc(String(a.sub).slice(0, 60)) : '') + '</span></span>' +
        '<span class="amt" style="color:' + a.tone + '">' + esc(a.amt) + '</span></li>';
    }).join('') : '<li><span class="tx"><b>No activity yet</b><span>&nbsp;</span></span></li>';

    return '' +
      '<div class="wp-top">' + avatarHTML(w) +
        '<div class="wp-id"><b>' + esc(nameOf(w, st.alias)) + '</b>' +
          '<button type="button" class="wp-addr" data-copy="' + esc(w) + '" title="Copy address">' + esc(short(w)) + ' <span>copy</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="wp-rank">' +
        '<div class="wp-rep"><b>' + num(st.rep) + ' REP</b>' + (rk.badge || (rk.name ? '<span class="wp-muted">' + esc(rk.name) + '</span>' : '')) + '</div>' +
        '<div class="wp-bar"><i style="width:' + rk.pct + '%"></i></div>' +
        '<div class="wp-muted">' + (rk.next ? num(rk.next.need) + ' REP to ' + esc(rk.next.name) : 'Top rank reached') + '</div>' +
      '</div>' +
      '<div class="wp-grid">' +
        stat(st.asked, 'Questions') + stat(st.answers, 'Answers') + stat(st.accepted, 'Accepted') + stat(st.upvotes, 'Upvotes') +
        stat(st.nft.length, 'NFTs') + stat(st.zones, 'Circuit zones') + stat(st.wins, 'Draw wins') + stat(lunc(st.zonesPaid), 'LUNC in Circuit') +
      '</div>' +
      '<div class="wp-nft">' + nftLine + '</div>' +
      '<div class="wp-h">Activity</div>' +
      '<ul class="acts wp-feed">' + rows + '</ul>';
  }

  function build() {
    modal = document.createElement('div');
    modal.className = 'act-modal wp-modal';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="act-dialog wp-dialog" role="dialog" aria-modal="true" aria-label="Participant profile">' +
        '<div class="act-head"><h3>Participant</h3><button type="button" class="act-x" aria-label="Close">\u00d7</button></div>' +
        '<div class="wp-body"></div>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('.act-x')) return close();
      var cp = e.target.closest('[data-copy]');
      if (cp) {
        var v = cp.getAttribute('data-copy');
        (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () {
          var s = cp.querySelector('span'); if (s) { s.textContent = 'copied'; setTimeout(function () { s.textContent = 'copy'; }, 1500); }
        }).catch(function () {});
        return;
      }
      var li = e.target.closest('.act-go');
      if (li) go(li);
    });
    modal.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.act-go')) { e.preventDefault(); go(e.target.closest('.act-go')); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.hidden) close();
    });
  }

  function go(li) {
    var it = feed[Number(li.getAttribute('data-i'))];
    if (!it) return;
    close();
    if (window.OracleActivity && typeof window.OracleActivity.go === 'function') window.OracleActivity.go(it);
  }

  function open(w) {
    w = String(w || '').trim();
    if (!/^terra1[0-9a-z]{38,58}$/.test(w)) return;
    if (!modal) build();
    var b = modal.querySelector('.wp-body');
    b.innerHTML = '<div class="wp-muted" style="padding:24px 4px">Loading\u2026</div>';
    modal.hidden = false;
    document.documentElement.classList.add('act-lock');
    modal.querySelector('.act-x').focus();

    // Ник и аватар чужого кошелька могут быть ещё не в кэше profile.js.
    var prof = (typeof loadProfileFromWorker === 'function')
      ? Promise.resolve(loadProfileFromWorker(w)).catch(function () {}) : Promise.resolve();

    Promise.all([collect(w), prof]).then(function (r) {
      if (modal.hidden) return;
      b.innerHTML = body(w, r[0]);
    });
  }

  function close() {
    if (!modal) return;
    modal.hidden = true;
    document.documentElement.classList.remove('act-lock');
  }

  // Любой элемент с data-profile="terra1..." открывает карточку по клику.
  // Фаза перехвата и stopPropagation: клик по нику в карточке вопроса
  // не должен заодно раскрывать сам вопрос.
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-profile]');
    if (!el || (modal && modal.contains(el))) return;
    var w = el.getAttribute('data-profile');
    if (!/^terra1[0-9a-z]{38,58}$/.test(w)) return;
    e.preventDefault();
    e.stopPropagation();
    open(w);
  }, true);

  window.OracleProfile = { open: open, close: close };
})();
