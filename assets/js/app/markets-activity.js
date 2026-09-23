/**
 * markets-activity.js - график прогноза и лента ставок на экране рынка.
 *
 * Источник - события транзакций в цепочке. Контракт пишет в событие каждой
 * ставки номер рынка, сторону и сумму, а время и адрес берутся из самой
 * транзакции. Поэтому историю не нужно хранить отдельно: узел отдаёт её
 * поиском по событиям, и её может перепроверить кто угодно.
 *
 * Узлы на Cosmos SDK 0.50 принимают параметр `query=`, а не `events=`:
 * со старым форматом отвечают "query cannot be empty".
 *
 * Загружать ПОСЛЕ markets.js.
 */

(function () {
  'use strict';

  const MAX_BETS = 100;

  function nowSecs() { return Math.floor(Date.now() / 1000); }

  function agoText(t) {
    const s = nowSecs() - t;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  }

  // ── чтение ────────────────────────────────────────────────────────────────

  async function lcdJson(path) {
    for (const base of PROPHECY_LCD) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      try {
        const r = await fetch(base + path, { headers: { Accept: 'application/json' }, signal: ctl.signal });
        if (!r.ok) continue;
        return await r.json();
      } catch (e) {
        /* следующий узел */
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error('activity unavailable');
  }

  /** Атрибуты событий на SDK 0.50 приходят строками, на старых версиях -
   *  в base64. Узнаём по тому, читается ли ключ action как есть. */
  function attrsOf(ev) {
    const list = ev.attributes || [];
    const plain = list.some((a) => a.key === 'action' || a.key === '_contract_address');
    const dec = (s) => {
      if (plain || typeof s !== 'string') return s;
      try { return atob(s); } catch (e) { return s; }
    };
    const out = {};
    for (const a of list) out[dec(a.key)] = dec(a.value);
    return out;
  }

  /** Ставки одного рынка, по времени. Разбор вынесен отдельно, чтобы его
   *  можно было проверить на сохранённом ответе узла. */
  function parseBets(json, marketId) {
    const out = [];
    for (const r of (json && json.tx_responses) || []) {
      if (r.code) continue;
      const t = Math.floor(Date.parse(r.timestamp) / 1000);
      const msgs = (r.tx && r.tx.body && r.tx.body.messages) || [];
      const sender = (msgs[0] && msgs[0].sender) || '';
      for (const ev of r.events || []) {
        if (ev.type !== 'wasm') continue;
        const a = attrsOf(ev);
        if (a._contract_address !== PROPHECY_CONTRACT) continue;
        if (a.action !== 'bet' || Number(a.market_id) !== Number(marketId)) continue;
        out.push({ t, yes: a.side === 'yes', amount: Number(a.amount || 0), who: sender, hash: r.txhash });
      }
    }
    return out.sort((x, y) => x.t - y.t);
  }

  async function loadBets(marketId) {
    const q = `wasm._contract_address='${PROPHECY_CONTRACT}' AND wasm.action='bet' AND wasm.market_id=${Number(marketId)}`;
    const json = await lcdJson('/cosmos/tx/v1beta1/txs?query=' + encodeURIComponent(q)
      + `&order_by=ORDER_BY_ASC&pagination.limit=${MAX_BETS}`);
    return parseBets(json, marketId);
  }

  // ── график ────────────────────────────────────────────────────────────────

  /**
   * Доля YES в банке после каждой ставки, ступеньками. Это не вероятность в
   * строгом смысле, а то, как толпа распределила деньги, - так и подписано.
   */
  function chartHtml(bets, m) {
    if (bets.length < 2) return '';
    const W = 600, H = 130, P = 6;
    let y = 0, n = 0;
    const pts = bets.map((b) => {
      if (b.yes) y += b.amount; else n += b.amount;
      return { t: b.t, p: (y / (y + n)) * 100, b };
    });
    const open = m.status === 'open' && Number(m.bets_close_at) > nowSecs();
    const t0 = pts[0].t;
    const t1 = Math.max(pts[pts.length - 1].t, open ? nowSecs() : Number(m.bets_close_at)) || t0 + 1;
    const X = (t) => P + ((t - t0) / Math.max(t1 - t0, 1)) * (W - 2 * P);
    const Y = (p) => P + ((100 - p) / 100) * (H - 2 * P);

    let d = `M${X(pts[0].t).toFixed(1)},${Y(pts[0].p).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` H${X(pts[i].t).toFixed(1)} V${Y(pts[i].p).toFixed(1)}`;
    }
    d += ` H${X(t1).toFixed(1)}`;
    const area = `${d} V${H - P} H${X(pts[0].t).toFixed(1)} Z`;
    const dots = pts.map((q) => `<circle cx="${X(q.t).toFixed(1)}" cy="${Y(q.p).toFixed(1)}" r="3.2">
        <title>${fmtLunc(q.b.amount)} LUNC on ${q.b.yes ? 'YES' : 'NO'} · YES ${Math.round(q.p)}% after</title></circle>`).join('');
    const last = Math.round(pts[pts.length - 1].p);

    return `
      <div class="mk-chart-head">
        <span>Share of the pot on YES, bet by bet</span>
        <b class="${last >= 50 ? 'y' : 'n'}">YES ${last}%</b>
      </div>
      <div class="mk-chart">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="YES share over time">
          <line x1="${P}" x2="${W - P}" y1="${Y(50)}" y2="${Y(50)}" class="mid"/>
          <path d="${area}" class="area"/>
          <path d="${d}" class="line"/>
          ${dots}
        </svg>
        <div class="mk-chart-axis"><span>100%</span><span>50%</span><span>0%</span></div>
      </div>`;
  }

  // ── лента ─────────────────────────────────────────────────────────────────

  function feedHtml(bets) {
    const me = typeof mkWallet === 'function' ? mkWallet() : null;
    const rows = bets.slice().reverse().slice(0, 10).map((b) => `
      <div class="r">
        <span class="who${b.who === me ? ' me' : ''}">${b.who === me ? 'You' : mktEsc(shortAddr(b.who))}</span>
        <b class="${b.yes ? 'y' : 'n'}">${fmtLunc(b.amount)} LUNC on ${b.yes ? 'YES' : 'NO'}</b>
        <span class="ago">${agoText(b.t)}</span>
      </div>`).join('');
    const more = bets.length > 10 ? `<div class="mk-plain">and ${bets.length - 10} earlier</div>` : '';
    return `<div class="mk-feed">${rows}</div>${more}`;
  }

  // ── точка входа ───────────────────────────────────────────────────────────

  /** Вызывается с экрана рынка и из опроса раз в 20 секунд. Заглушка -
   *  только при первой отрисовке, чтобы блок не мигал. */
  window.renderActivity = async function (m) {
    const host = document.getElementById('mk-activity');
    if (!host || !m) return;
    if (!host.innerHTML.trim()) host.innerHTML = '<div class="mk-loading">Loading activity…</div>';
    let bets;
    try {
      bets = await loadBets(m.id);
    } catch (e) {
      if (!host.querySelector('.mk-feed')) host.innerHTML = '';
      return;
    }
    // Экран могли уже сменить на другой рынок, пока шёл запрос.
    if (!window._prophecyMarket || window._prophecyMarket.id !== m.id) return;
    host.innerHTML = `
      <section class="card mk-activity">
        <h3>Activity</h3>
        ${bets.length
          ? chartHtml(bets, m) + feedHtml(bets)
          : '<p class="mk-lead-sm">No bets yet. The first one shows up here.</p>'}
      </section>`;
  };

  // Для проверки из консоли: await mkBetHistory(2)
  window.mkBetHistory = loadBets;
  window._mkParseBets = parseBets;
})();
