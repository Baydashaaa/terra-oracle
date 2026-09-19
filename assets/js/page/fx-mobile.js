// Protocol flow на телефоне.
//
// Широкая SVG-схема (около 1100 px) на 390 px нечитаема. На узком экране
// показываем вертикальную версию, а схему прячем. Вертикальная версия
// СОБИРАЕТСЯ ИЗ САМОЙ SVG: узлы (.fx-node), рёбра (path#fxeN) и подписи
// процентов (textPath). Второй копии цифр нет - поменяли схему, поменялся
// и мобильный вид.
(function () {
  'use strict';

  var CSS =
    '.fxm{display:none}' +
    '@media (max-width:680px){' +
      '.fx-wrap:not(.fx-in-full){display:none !important}' +
      '.fxm{display:block}' +
    '}' +
    '.fxm-col{margin:6px 0 14px}' +
    '.fxm-h{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3,#8d89ab);margin:14px 2px 8px}' +
    '.fxm-node{position:relative;padding:12px 14px 12px 16px;border-radius:12px;margin-bottom:8px;' +
      'background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07)}' +
    '.fxm-node::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:2px;background:var(--c)}' +
    '.fxm-node b{display:block;font-size:14px;color:var(--ink,#fff)}' +
    '.fxm-node small{display:block;font-size:11.5px;color:var(--ink-3,#8d89ab);margin-top:2px}' +
    '.fxm-out{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px}' +
    '.fxm-out li{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-2,#c9c6e0)}' +
    '.fxm-out li i{font-style:normal;color:var(--c)}' +
    '.fxm-out li em{font-style:normal;font-weight:700;color:var(--c);font-size:12px}' +
    '.fxm-bar{grid-column:1 / -1;height:4px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden}' +
    '.fxm-bar span{display:block;height:100%;border-radius:inherit;background:var(--c)}' +
    '.fxm-seed{font-size:12px;color:#4ade80;padding:10px 12px;border:1px dashed rgba(74,222,128,.35);border-radius:10px;margin:4px 0 12px}';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function num(el, a) { return Number(el.getAttribute(a)) || 0; }

  // Узлы схемы: прямоугольник, цвет полоски, заголовок, подпись.
  function readNodes(svg) {
    var out = [];
    svg.querySelectorAll('.fx-node').forEach(function (g) {
      var rects = g.querySelectorAll('rect');
      var box = g.querySelector('.fx-box') || rects[0];
      if (!box) return;
      var bar = rects[1];
      var t = g.querySelector('.fx-t'), s = g.querySelector('.fx-s');
      out.push({
        x: num(box, 'x'), y: num(box, 'y'), w: num(box, 'width'), h: num(box, 'height'),
        color: (bar && bar.getAttribute('fill')) || '#a855f7',
        title: t ? t.textContent.trim() : '', sub: s ? s.textContent.trim() : '',
        out: []
      });
    });
    return out;
  }

  // Узел, у которого на этой точке правый (from) или левый (to) край.
  function nodeAt(nodes, x, y, edge) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var ex = edge === 'right' ? n.x + n.w : n.x;
      if (Math.abs(ex - x) <= 2 && y >= n.y - 2 && y <= n.y + n.h + 2) return n;
    }
    return null;
  }

  function build(svg) {
    var nodes = readNodes(svg);
    if (!nodes.length) return null;

    var labels = {};
    svg.querySelectorAll('textPath').forEach(function (tp) {
      var id = (tp.getAttribute('href') || tp.getAttribute('xlink:href') || '').replace('#', '');
      if (id) labels[id] = tp.textContent.trim();
    });

    svg.querySelectorAll('path[id^="fxe"]').forEach(function (p) {
      var d = p.getAttribute('d') || '';
      var pts = d.match(/-?\d+(\.\d+)?/g);
      if (!pts || pts.length < 4) return;
      var x1 = +pts[0], y1 = +pts[1], x2 = +pts[pts.length - 2], y2 = +pts[pts.length - 1];
      var a = nodeAt(nodes, x1, y1, 'right'), b = nodeAt(nodes, x2, y2, 'left');
      if (!a || !b) return;
      a.out.push({ to: b, label: labels[p.id] || '', color: p.getAttribute('stroke') || a.color });
    });

    // Колонки по x: платишь, копится, выплачивается.
    var xs = nodes.map(function (n) { return n.x; })
      .filter(function (x, i, arr) { return arr.indexOf(x) === i; })
      .sort(function (m, n) { return m - n; });
    var heads = Array.prototype.map.call(svg.querySelectorAll('.fx-h'), function (h) { return h.textContent.trim(); });

    var html = '';
    xs.forEach(function (x, ci) {
      var col = nodes.filter(function (n) { return n.x === x; }).sort(function (m, n) { return m.y - n.y; });
      html += '<div class="fxm-col"><div class="fxm-h">' + esc(heads[ci] || '') + '</div>';
      col.forEach(function (n) {
        html += '<div class="fxm-node" style="--c:' + esc(n.color) + '"><b>' + esc(n.title) + '</b>' +
          (n.sub ? '<small>' + esc(n.sub) + '</small>' : '');
        if (n.out.length) {
          html += '<ul class="fxm-out">';
          n.out.forEach(function (e) {
            var pct = parseFloat(e.label);
            html += '<li style="--c:' + esc(e.color) + '"><i>\u2192</i><span>' + esc(e.to.title) + '</span>' +
              '<em>' + esc(e.label) + '</em>' +
              (isFinite(pct) ? '<span class="fxm-bar"><span style="width:' + Math.min(100, pct) + '%"></span></span>' : '') +
              '</li>';
          });
          html += '</ul>';
        }
        html += '</div>';
      });
      html += '</div>';
    });

    var seed = svg.querySelector('.fx-chip-seed text');
    if (seed) html += '<div class="fxm-seed">\u21BA ' + esc(seed.textContent.trim()) + '</div>';

    var box = document.createElement('div');
    box.className = 'fxm';
    box.innerHTML = html;
    return box;
  }

  function start() {
    var wrap = document.querySelector('.fx-wrap');
    var svg = wrap && wrap.querySelector('svg');
    if (!svg) return;

    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var m = build(svg);
    if (!m) return;
    wrap.parentNode.insertBefore(m, wrap.nextSibling);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
