/* ── ACCORDION ── */
function toggleAccordion(id) {
  const item = document.getElementById(id);
  if (!item) return;
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.mobile-accordion-item.open').forEach(function(el) { el.classList.remove('open'); });
  if (!isOpen) item.classList.add('open');
}

/* ── STICKY BAR: show only on home page ── */
(function() {
  function updateStickyBar() {
    const bar = document.getElementById('sticky-bottom-bar');
    if (!bar) return;
    const homePage = document.getElementById('page-home');
    const isHome = homePage && homePage.classList.contains('active');
    bar.style.display = isHome ? 'flex' : 'none';
  }
  document.addEventListener('DOMContentLoaded', function() {
    updateStickyBar();
    const observer = new MutationObserver(updateStickyBar);
    document.querySelectorAll('.page').forEach(function(p) {
      observer.observe(p, { attributes: true, attributeFilter: ['class'] });
    });
  });
})();
