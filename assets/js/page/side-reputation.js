// Правая колонка: карточка Your reputation.
// Показывает счёт подключённого кошелька, ранг и прогресс до следующего.
//
// Счёт берётся из /rep/scores - того же источника, по которому раздел
// Reputation определяет ранг. Значит карточка и раздел не разойдутся.
(function () {
  'use strict';

  var last = null;   // адрес, для которого уже нарисовали

  function $(id) { return document.getElementById(id); }

  function worker() {
    return (typeof window.WORKER_URL !== 'undefined' && window.WORKER_URL)
      || 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
  }

  function wallet() {
    return (typeof globalWalletAddress !== 'undefined' && globalWalletAddress) || null;
  }

  function paint(score) {
    var val = $('repVal'), rn = $('repRank'), bar = $('repBar'),
        pct = $('repPct'), next = $('repNext');
    if (!val) return;

    val.textContent = Number(score).toLocaleString('en-US') + ' REP';

    if (typeof getRank !== 'function' || typeof RANKS === 'undefined') {
      if (rn) rn.textContent = '-';
      return;
    }

    var rank = getRank(score);
    var nx = (typeof getNextRank === 'function') ? getNextRank(score) : null;

    if (rn) {
      rn.innerHTML = '<img class="rank-ic sm" src="assets/img/icons/r-' +
        rank.name.toLowerCase() + '.webp" alt="" width="112" height="112" loading="lazy">' +
        rank.name;
      rn.style.color = rank.color || '';
    }

    // Прогресс считаем внутри текущей ступени, а не от нуля: иначе на
    // высоких рангах полоса всегда была бы почти полной.
    var p;
    if (!nx) {
      p = 100;
      if (next) next.textContent = 'Top rank reached';
    } else {
      var from = rank.minScore || 0;
      var span = (nx.minScore - from) || 1;
      p = Math.max(0, Math.min(100, (score - from) / span * 100));
      if (next) {
        next.textContent = Math.round(nx.minScore - score).toLocaleString('en-US') +
          ' REP to ' + nx.name;
      }
    }
    if (bar) bar.style.width = p.toFixed(0) + '%';
    if (pct) pct.textContent = p.toFixed(0) + '%';
  }

  function reset() {
    var val = $('repVal'), rn = $('repRank'), bar = $('repBar'),
        pct = $('repPct'), next = $('repNext');
    if (val) val.textContent = '0 REP';
    if (rn) { rn.textContent = '-'; rn.style.color = ''; }
    if (bar) bar.style.width = '0%';
    if (pct) pct.textContent = '0%';
    if (next) next.textContent = 'Connect wallet to track your REP';
  }

  async function load() {
    var w = wallet();
    if (!$('repVal')) return;

    if (!w) { last = null; reset(); return; }
    if (w === last) return;          // уже нарисовано для этого адреса

    try {
      var r = await fetch(worker() + '/rep/scores', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      last = w;
      paint(Number((d.onchain || {})[w]) || 0);
    } catch (e) {
      var next = $('repNext');
      if (next) next.textContent = 'Score unavailable';
      console.warn('[side-reputation]', (e && (e.message || e.name)) || e);
    }
  }

  function wireButton() {
    var val = $('repVal');
    var card = val && val.closest('.card');
    var btn = card && card.querySelector('button.wide');
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', function () {
        if (typeof showRepPage === 'function') showRepPage('stats');
      });
    }
  }

  function start() {
    wireButton();
    reset();
    load();
    // Событие о подключении кошелька никто не шлёт, поэтому смотрим сами.
    // Запрос уходит только когда адрес изменился - см. проверку в load().
    setInterval(load, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
