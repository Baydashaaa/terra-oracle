  (function () {
    // On mobile the desktop hero and lower desktop sections are hidden, so
    // this section (living in the desktop flow) used to fall to the very
    // bottom of the page. Move it up: right before the "Token" label of the
    // mobile layout. Desktop (>900px) keeps the original position.
    try {
      if (window.matchMedia('(max-width: 900px)').matches) {
        var wrap = document.getElementById('oc3-wrap');
        var labels = document.querySelectorAll('.mobile-section-label');
        var modulesLabel = null;
        labels.forEach(function (l) { if (!modulesLabel && /modules/i.test(l.textContent)) modulesLabel = l; });
        if (wrap && modulesLabel && modulesLabel.parentNode) {
          modulesLabel.parentNode.insertBefore(wrap, modulesLabel);
        }
      }
    } catch (e) {}

    var steps = [].slice.call(document.querySelectorAll('.oc3-step'));
    if (!steps.length) return;
    var num = document.getElementById('oc3num');
    var prog = document.getElementById('oc3prog');
    var reactor = document.querySelector('.oc3-reactor');

    // Цвет берём из --nc / --nc2 самого шага - второго списка цветов больше нет
    function stepColors(el) {
      var cs = getComputedStyle(el);
      return {
        c1: (cs.getPropertyValue('--nc')  || '#7B5CFF').trim(),
        c2: (cs.getPropertyValue('--nc2') || '#c4b5fd').trim()
      };
    }
    function paint(n) {
      var c = stepColors(steps[n]);
      if (reactor) {
        reactor.style.setProperty('--rc',  c.c1);
        reactor.style.setProperty('--rc2', c.c2);
      }
      if (num) num.style.color = c.c2;
    }
    function setActive(n) {
      steps.forEach(function (s, k) { s.classList.toggle('on', k === n); });
      num.textContent = '0' + (n + 1);
      paint(n);
      prog.style.strokeDashoffset = String(540 - 540 * ((n + 1) / 4));
    }

    // Стартовая раскраска под первый шаг; дугу прогресса не трогаем,
    // чтобы поведение при загрузке осталось прежним
    paint(0);
    steps.forEach(function (s, k) {
      s.addEventListener('click', function () { setActive(k); });
    });
  })();
