// Hero news slider. Slide 0 = original hero, then every .hero-news block in order.
// Autoplay is driven by the progress bar animation: when it ends, the next slide opens.
// Hover or keyboard focus pauses it (CSS), reduced motion disables autoplay.
(function () {
  const hero = document.querySelector('#page-home .hero');
  if (!hero) return;
  const news = Array.from(hero.querySelectorAll('.hero-news'));
  if (!news.length) return;

  const copy = hero.querySelector('.copy');
  const total = news.length + 1;
  let cur = 0;

  const nav = document.createElement('div');
  nav.className = 'hero-dots';
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Slides');
  const dots = [];
  for (let i = 0; i < total; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hero-dot';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', 'Slide ' + (i + 1));
    b.innerHTML = '<span class="bar"><span class="fill"></span></span>';
    b.addEventListener('click', () => go(i));
    nav.appendChild(b);
    dots.push(b);
  }
  hero.appendChild(nav);

  function go(i) {
    cur = (i + total) % total;
    news.forEach((n, k) => {
      const on = k + 1 === cur;
      n.classList.toggle('is-active', on);
      n.inert = !on;
    });
    if (copy) copy.inert = cur !== 0;
    dots.forEach((d, k) => {
      d.classList.toggle('is-active', k === cur);
      d.setAttribute('aria-selected', k === cur ? 'true' : 'false');
    });
  }

  nav.addEventListener('animationend', (e) => {
    if (e.target.classList.contains('fill') && e.target.closest('.hero-dot.is-active')) go(cur + 1);
  });

  let x0 = null;
  hero.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  hero.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) go(cur + (dx < 0 ? 1 : -1));
  });

  go(0);
})();
