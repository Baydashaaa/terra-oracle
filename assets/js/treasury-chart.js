/* ═══════════════════════════════════════════════════════════════════════════
   TREASURY — график TVL
   ---------------------------------------------------------------------------
   Встраивается в блок «Total Protocol TVL» сам: находит #t-total-tvl,
   поднимается до карточки и вставляет себя между цифрами и кнопкой Refresh.
   Разметку index.html править не нужно — только добавить <script>.

   Данные: GET /treasury-series воркера oracle-draw. Почасовые точки за
   последние двое суток, дальше по одной на календарный день UTC.

   Почему свой SVG, а не библиотека: график нужен один, точек меньше сотни,
   а любая библиотека — это лишние 50–200 КБ и чужая типографика поверх
   аккуратно собранной темы сайта.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const W_URL = (typeof O_DRAW_WORKER !== 'undefined' && O_DRAW_WORKER)
    || 'https://oracle-draw.vladislav-baydan.workers.dev';

  const GOLD = 'var(--gold, #f5c518)';
  const MUTED = 'var(--muted, #7a8596)';

  // Диапазоны. «all» показывает всё, что накопил воркер.
  const RANGES = [
    { id: '48h', label: '48h', ms: 48 * 3600 * 1000 },
    { id: '7d',  label: '7d',  ms: 7 * 24 * 3600 * 1000 },
    { id: 'all', label: 'All', ms: null },
  ];

  let allPoints = [];
  let range = '48h';
  let mounted = false;

  const $ = (id) => document.getElementById(id);
  const fmtLunc = (u) => {
    const n = u / 1e6;
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return Math.round(n).toString();
  };
  const fmtWhen = (ts) => {
    const d = new Date(ts);
    const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    return day + ' ' + time + ' UTC';
  };

  /* ── разметка ──────────────────────────────────────────────────────────── */

  const CSS = `
  .tvc { flex: 1 1 320px; min-width: 240px; margin: 0 28px; position: relative; }
  .tvc-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
  .tvc-title { font-size:9px; letter-spacing:.2em; text-transform:uppercase; color:${MUTED}; }
  .tvc-ranges { display:flex; gap:4px; }
  .tvc-ranges button {
    background:transparent; border:1px solid rgba(245,197,24,.18); color:${MUTED};
    border-radius:6px; padding:2px 8px; font-family:'Exo 2',sans-serif; font-size:10px;
    cursor:pointer; transition:all .15s; }
  .tvc-ranges button:hover { border-color:rgba(245,197,24,.4); }
  .tvc-ranges button.on { color:${GOLD}; border-color:rgba(245,197,24,.55);
    background:rgba(245,197,24,.07); }
  .tvc-plot { position:relative; }
  .tvc-plot svg { display:block; width:100%; height:132px; overflow:visible; }
  /* Точка последнего значения вынесена из SVG: при preserveAspectRatio="none"
     единицы viewBox растягиваются по осям по-разному, и <circle> превращался
     в сплющенный эллипс. */
  .tvc-dot { position:absolute; width:7px; height:7px; border-radius:50%;
    transform:translate(-50%,-50%); pointer-events:none; }
  .tvc-dot::after { content:''; position:absolute; inset:-4px; border-radius:50%;
    background:inherit; opacity:.25; }
  .tvc-empty { font-size:11px; color:${MUTED}; padding:22px 0; text-align:center; }
  .tvc-tip {
    position:absolute; pointer-events:none; opacity:0; transition:opacity .12s;
    background:var(--surface, #12161f); border:1px solid rgba(245,197,24,.25);
    border-radius:8px; padding:6px 9px; white-space:nowrap; z-index:5;
    font-family:'Rajdhani',sans-serif; transform:translate(-50%, -100%); }
  .tvc-tip.on { opacity:1; }
  .tvc-tip b { display:block; font-size:14px; font-weight:800; color:${GOLD}; line-height:1.1; }
  .tvc-tip span { font-size:10px; color:${MUTED}; font-family:'Exo 2',sans-serif; }
  .tvc-foot { display:flex; justify-content:space-between; font-size:9px; color:${MUTED};
    margin-top:4px; font-family:'Exo 2',sans-serif; }
  @media (max-width: 900px) {
    .tvc { flex-basis:100%; margin:18px 0 0; order:3; }
  }
  `;

  function mount() {
    if (mounted) return true;
    const anchor = $('t-total-tvl');
    if (!anchor) return false;
    // Карточка TVL — родитель колонки с цифрами
    const hero = anchor.parentElement && anchor.parentElement.parentElement;
    if (!hero) return false;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.className = 'tvc';
    box.innerHTML =
      '<div class="tvc-head">' +
        '<span class="tvc-title">TVL history</span>' +
        '<span class="tvc-ranges" id="tvc-ranges"></span>' +
      '</div>' +
      '<div class="tvc-plot" id="tvc-plot"><div class="tvc-empty">loading…</div></div>' +
      '<div class="tvc-foot"><span id="tvc-from"></span><span id="tvc-to"></span></div>' +
      '<div class="tvc-tip" id="tvc-tip"></div>';

    // Между колонкой цифр и колонкой с кнопкой
    hero.insertBefore(box, anchor.parentElement.nextSibling);
    hero.style.flexWrap = 'wrap';

    const rr = $('tvc-ranges');
    RANGES.forEach((r) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = r.label;
      b.dataset.r = r.id;
      b.className = r.id === range ? 'on' : '';
      b.addEventListener('click', () => { range = r.id; syncRanges(); draw(); });
      rr.appendChild(b);
    });

    mounted = true;
    return true;
  }

  function syncRanges() {
    const rr = $('tvc-ranges');
    if (!rr) return;
    [...rr.children].forEach((b) => b.classList.toggle('on', b.dataset.r === range));
  }

  /* ── отрисовка ─────────────────────────────────────────────────────────── */

  // Ряд плюс сегодняшняя точка из живого итога, если он посчитан. Без неё
  // график заканчивался последним СНИМКОМ и подписывал его «now».
  function seriesWithLive() {
    const live = window.__tvlTotalUluna;
    if (typeof live !== 'number' || live <= 0 || !allPoints.length) return allPoints;
    const last = allPoints[allPoints.length - 1];
    // Снимок свежее пяти минут — живая точка его заменяет, а не добавляется
    const fresh = Date.now() - last.ts < 5 * 60 * 1000;
    const head = fresh ? allPoints.slice(0, -1) : allPoints;
    return head.concat([{ ts: Date.now(), uluna: live, live: true }]);
  }

  function visiblePoints() {
    // Имя намеренно не allPoints: затенять модульную переменную одноимённой
    // локальной — верный способ запутаться при следующей правке.
    const series = seriesWithLive();
    const r = RANGES.find((x) => x.id === range);
    if (!r || !r.ms) return series;
    const from = Date.now() - r.ms;
    const sel = series.filter((p) => p.ts >= from);
    return sel.length >= 2 ? sel : series;
  }

  function draw() {
    const plot = $('tvc-plot');
    if (!plot) return;
    const pts = visiblePoints();

    if (pts.length < 2) {
      plot.innerHTML = '<div class="tvc-empty">History is still building — the first points ' +
                       'appear within a few hours.</div>';
      $('tvc-from').textContent = '';
      $('tvc-to').textContent = '';
      return;
    }

    const W = 100, H = 34, PAD = 1.2;              // единицы viewBox
    const xs = pts.map((p) => p.ts);
    const ys = pts.map((p) => p.uluna);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    // Плоский ряд не должен схлопываться в линию по краю
    if (y1 === y0) { y0 -= 1; y1 += 1; }

    const px = (t) => ((t - x0) / (x1 - x0)) * W;
    const py = (v) => H - PAD - ((v - y0) / (y1 - y0)) * (H - PAD * 2);

    const line = pts.map((p, i) => (i ? 'L' : 'M') + px(p.ts).toFixed(2) + ' ' + py(p.uluna).toFixed(2)).join(' ');
    const area = line + ` L${W} ${H} L0 ${H} Z`;
    const last = pts[pts.length - 1];
    const rising = last.uluna >= pts[0].uluna;
    const stroke = rising ? '#66ffaa' : '#ff8a7a';

    plot.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="TVL history">` +
        `<defs><linearGradient id="tvcFill" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" stop-color="${stroke}" stop-opacity=".28"/>` +
          `<stop offset="1" stop-color="${stroke}" stop-opacity="0"/>` +
        `</linearGradient></defs>` +
        `<path d="${area}" fill="url(#tvcFill)"/>` +
        `<path d="${line}" fill="none" stroke="${stroke}" stroke-width=".7" ` +
              `stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +

        `<line id="tvc-guide" x1="0" y1="0" x2="0" y2="${H}" stroke="${stroke}" ` +
              `stroke-width=".4" stroke-dasharray="1 1.4" opacity="0" vector-effect="non-scaling-stroke"/>` +
      `</svg>`;

    const dot = document.createElement('div');
    dot.className = 'tvc-dot';
    dot.style.background = stroke;
    dot.style.left = (px(last.ts) / W * 100) + '%';
    dot.style.top = (py(last.uluna) / H * 100) + '%';
    plot.appendChild(dot);

    $('tvc-from').textContent = fmtWhen(pts[0].ts);
    $('tvc-to').textContent = 'now · ' + fmtLunc(last.uluna) + ' LUNC';

    bindHover(plot, pts, px, W);
  }

  function bindHover(plot, pts, px, W) {
    const tip = $('tvc-tip');
    const guide = plot.querySelector('#tvc-guide');
    if (!tip) return;

    plot.onmousemove = (e) => {
      const box = plot.getBoundingClientRect();
      const rel = (e.clientX - box.left) / box.width;      // 0..1
      const want = rel * W;
      // Ближайшая точка по горизонтали
      let best = pts[0], bestD = Infinity;
      for (const p of pts) {
        const d = Math.abs(px(p.ts) - want);
        if (d < bestD) { bestD = d; best = p; }
      }
      const cx = (px(best.ts) / W) * box.width;
      tip.innerHTML = '<b>' + fmtLunc(best.uluna) + ' LUNC</b><span>' + fmtWhen(best.ts) + '</span>';
      tip.style.left = cx + 'px';
      tip.style.top = '-6px';
      tip.classList.add('on');
      if (guide) { guide.setAttribute('x1', px(best.ts)); guide.setAttribute('x2', px(best.ts)); guide.setAttribute('opacity', '.7'); }
    };
    plot.onmouseleave = () => {
      tip.classList.remove('on');
      if (guide) guide.setAttribute('opacity', '0');
    };
  }

  /* ── загрузка ──────────────────────────────────────────────────────────── */

  async function load() {
    try {
      const r = await fetch(W_URL + '/treasury-series', { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('status ' + r.status);
      const d = await r.json();
      allPoints = (d.points || [])
        .filter((p) => p && typeof p.ts === 'number' && typeof p.uluna === 'number')
        .sort((a, b) => a.ts - b.ts);
      draw();
    } catch (e) {
      const plot = $('tvc-plot');
      if (plot) plot.innerHTML = '<div class="tvc-empty">History unavailable right now.</div>';
    }
  }

  function boot() {
    // Страница казны — вкладка SPA, блок может появиться позже загрузки.
    if (!mount()) { setTimeout(boot, 400); return; }
    load();
    setInterval(load, 5 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
