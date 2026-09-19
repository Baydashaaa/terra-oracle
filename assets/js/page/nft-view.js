// NFT Collection: переключатель вида "крупные карточки / компактная сетка".
//
// Карточки рисует vote.js (filterOracleBagNFTs) с inline-стилями, поэтому
// компактный вид сделан классом на #o-bag-grid и правилами с !important:
// остаётся только картинка, тир виден по цветной рамке карточки, а
// "Round over" - по уже существующей полупрозрачности.
// Выбор запоминается. Без сохранённого выбора телефон открывает компактный вид.
(function () {
  'use strict';

  var KEY = 'nft-view';

  var CSS =
    '.nft-view{display:inline-flex;gap:4px;margin-left:auto;padding:3px;border-radius:10px;' +
      'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}' +
    '.nft-view button{appearance:none;border:0;background:none;width:32px;height:28px;border-radius:7px;' +
      'display:grid;place-items:center;cursor:pointer;color:var(--ink-3,#8d89ab)}' +
    '.nft-view button svg{width:16px;height:16px}' +
    '.nft-view button[aria-pressed="true"]{background:rgba(124,58,237,.85);color:#fff}' +
    '.nft-view button:focus-visible{outline:2px solid var(--cyan,#22d3ee);outline-offset:1px}' +
    '#o-bag-grid.nft-compact{grid-template-columns:repeat(auto-fill,minmax(92px,1fr)) !important;gap:8px !important}' +
    '#o-bag-grid.nft-compact > div{padding:6px !important;border-radius:12px !important;box-shadow:none !important}' +
    '#o-bag-grid.nft-compact > div > :not(picture){display:none !important}' +
    '#o-bag-grid.nft-compact picture img{width:100% !important;height:auto !important;aspect-ratio:2/3;' +
      'margin:0 !important;border-radius:8px !important;display:block}';

  var ICON_BIG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="18" rx="2"/><rect x="13" y="3" width="8" height="18" rx="2"/></svg>';
  var ICON_SMALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="5" height="7" rx="1"/><rect x="9.5" y="3" width="5" height="7" rx="1"/><rect x="16" y="3" width="5" height="7" rx="1"/><rect x="3" y="14" width="5" height="7" rx="1"/><rect x="9.5" y="14" width="5" height="7" rx="1"/><rect x="16" y="14" width="5" height="7" rx="1"/></svg>';

  function start() {
    var grid = document.getElementById('o-bag-grid');
    var bar = document.querySelector('.nft-bar');
    if (!grid || !bar) return;

    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var sw = document.createElement('div');
    sw.className = 'nft-view';
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', 'Card size');
    sw.innerHTML =
      '<button type="button" data-v="large" title="Large cards" aria-label="Large cards">' + ICON_BIG + '</button>' +
      '<button type="button" data-v="compact" title="Compact grid" aria-label="Compact grid">' + ICON_SMALL + '</button>';
    var h = bar.querySelector('.nft-h');
    if (h && h.nextSibling) bar.insertBefore(sw, h.nextSibling); else bar.appendChild(sw);

    function apply(v) {
      grid.classList.toggle('nft-compact', v === 'compact');
      sw.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-v') === v ? 'true' : 'false');
      });
    }

    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    apply(saved || (window.matchMedia('(max-width:680px)').matches ? 'compact' : 'large'));

    sw.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]');
      if (!b) return;
      var v = b.getAttribute('data-v');
      apply(v);
      try { localStorage.setItem(KEY, v); } catch (e2) {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
