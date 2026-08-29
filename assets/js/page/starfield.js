/* ── Starfield canvas - optimized (20fps, paused when hidden) ── */
(function() {
  // Disable on mobile/touch devices
  if (window.matchMedia('(hover: none)').matches) return;
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, stars, nebulas, rafId, lastTime = 0;
  const FPS = 20, INTERVAL = 1000 / FPS;
  // Fewer stars for better performance
  const STAR_COUNT = 90;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function initStars() {
    stars = Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.2 + 0.2,
      speed: Math.random() * 0.12 + 0.02,
      opacity: Math.random() * 0.6 + 0.2,
      twinkleSpeed: Math.random() * 0.008 + 0.003,
      twinkleDir: Math.random() > 0.5 ? 1 : -1,
      hue: Math.random() < 0.15 ? 'gold' : Math.random() < 0.25 ? 'blue' : 'white',
    }));
    nebulas = Array.from({ length: 4 }, (_, i) => ({
      x: [0.15, 0.85, 0.3, 0.7][i] * W,
      y: [0.2, 0.15, 0.8, 0.75][i] * H,
      r: Math.random() * 180 + 160,
      color: i % 2 === 0 ? 'rgba(84,147,247,0.045)' : 'rgba(167,100,250,0.035)',
      driftX: (Math.random() - 0.5) * 0.15,
      driftY: (Math.random() - 0.5) * 0.10,
    }));
  }

  function draw(ts) {
    rafId = requestAnimationFrame(draw);
    if (ts - lastTime < INTERVAL) return;
    lastTime = ts;
    ctx.clearRect(0, 0, W, H);
    nebulas.forEach(n => {
      n.x += n.driftX; n.y += n.driftY;
      if (n.x < -n.r || n.x > W + n.r) n.driftX *= -1;
      if (n.y < -n.r || n.y > H + n.r) n.driftY *= -1;
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      g.addColorStop(0, n.color); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
    });
    stars.forEach(s => {
      s.y += s.speed;
      if (s.y > H + 2) { s.y = -2; s.x = Math.random() * W; }
      s.opacity += s.twinkleSpeed * s.twinkleDir;
      if (s.opacity > 0.85 || s.opacity < 0.1) s.twinkleDir *= -1;
      const c = s.hue === 'gold' ? `rgba(245,197,24,${s.opacity})`
              : s.hue === 'blue' ? `rgba(130,180,255,${s.opacity})`
              : `rgba(220,230,255,${s.opacity})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = c; ctx.fill();
    });
  }

  // Pause when tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(rafId); rafId = null; }
    else if (!rafId) rafId = requestAnimationFrame(draw);
  });

  window.addEventListener('resize', () => { resize(); initStars(); });
  resize(); initStars();
  rafId = requestAnimationFrame(draw);
})();

window.openBagWalletPicker = function() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => {
    const dropdown = document.getElementById('wallet-dropdown');
    if (dropdown) dropdown.classList.add('open');
  }, 350);
};

/* ── NAV CONNECTOR LINES ─────────────────────────────────── */
function drawNavLines() {
  // Lines handled via CSS ::before pseudo-elements
}

// Mark active nav node
function _wrapShowPage() {
  if (typeof window.showPage !== 'function') return;
  if (window._showPageWrapped) return;
  window._showPageWrapped = true;
  const _orig = window.showPage;
  window.showPage = function(name, e, skipHistory) {
    _orig(name, e, skipHistory);
    document.querySelectorAll('.nav-node').forEach(function(n) {
      n.classList.toggle('active', n.dataset.page === name);
    });
  };
}
// Try immediately, fallback to DOMContentLoaded
_wrapShowPage();
document.addEventListener('DOMContentLoaded', _wrapShowPage);

window.addEventListener('load', () => { setTimeout(drawNavLines, 100); });
window.addEventListener('resize', drawNavLines);
