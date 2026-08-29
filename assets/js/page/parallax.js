/* ══════════════════════════════════════════════════════════
   PARALLAX + CURSOR ENERGY - optimized (disabled on mobile)
   ══════════════════════════════════════════════════════════ */
(function() {
  if (window.matchMedia('(hover: none)').matches) return;
  const cursorEnergy = document.getElementById('cursor-energy');
  const energyField  = document.getElementById('energy-field');
  let mx = window.innerWidth / 2, my = window.innerHeight / 2;
  let cx = mx, cy = my;
  let rafId = null, moved = false;

  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY; moved = true;
  });

  function tick() {
    rafId = requestAnimationFrame(tick);
    if (!moved) return;
    moved = false;
    cx += (mx - cx) * 0.07;
    cy += (my - cy) * 0.07;
    if (cursorEnergy) {
      cursorEnergy.style.left = cx + 'px';
      cursorEnergy.style.top  = cy + 'px';
    }
    if (energyField) {
      const ox = (mx / window.innerWidth  - 0.5) * 18;
      const oy = (my / window.innerHeight - 0.5) * 12;
      energyField.style.transform = `translate(${ox}px,${oy}px)`;
    }
    const orb1 = document.querySelector('.orb-1');
    const orb2 = document.querySelector('.orb-2');
    if (orb1) {
      const ox1 = (mx / window.innerWidth  - 0.5) * 30;
      const oy1 = (my / window.innerHeight - 0.5) * 20;
      orb1.style.transform = `translate(${ox1}px,${oy1}px)`;
    }
    if (orb2) {
      const ox2 = (mx / window.innerWidth  - 0.5) * -20;
      const oy2 = (my / window.innerHeight - 0.5) * -14;
      orb2.style.transform = `translate(${ox2}px,${oy2}px)`;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(rafId); rafId = null; }
    else if (!rafId) { rafId = requestAnimationFrame(tick); }
  });

  rafId = requestAnimationFrame(tick);
})();

/* ══════════════════════════════════════════════════════════
   ENERGY CAPSULE BUTTONS - hover sweep
   ══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.btn-primary, .lottery-btn, .treasury-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.setProperty('--sweep', '0');
    });
  });
});
