// ═══ ПЕРЕКЛЮЧАТЕЛЬ ИГР ═════════════════════════════════════════════════════
// Рельс не заменяет switchLottery, а надстраивается над ним: daily и weekly
// по-прежнему идут через существующую функцию со всей её логикой, а Circuit
// просто прячет игровую сцену и показывает свою.
(function () {
  const COLORS = { daily:'#f4d03f', weekly:'#a78bfa', circuit:'#38d9d0' };

  window.selectGame = function (game) {
    document.querySelectorAll('.dg-game').forEach(b =>
      b.classList.toggle('on', b.dataset.g === game));

    const draw    = document.getElementById('stage-draw');
    const circuit = document.getElementById('stage-circuit');
    if (!draw || !circuit) return;

    if (game === 'circuit') {
      draw.style.display = 'none';
      circuit.style.display = 'block';
    } else {
      circuit.style.display = 'none';
      draw.style.display = 'block';
      if (typeof switchLottery === 'function') switchLottery(game);
    }
    try { localStorage.setItem('dgGame', game); } catch (e) {}
  };

  // Живые цифры в рельсе.
  // Пулы daily и weekly берём балансами кошельков напрямую: узел pool-lunc
  // в DOM держит только ВЫБРАННУЮ игру, а рельс должен показывать все три
  // сразу - иначе теряется весь смысл видеть их рядом.
  const POOL_WALLETS = {
    daily:  'terra1d9ga3dzhg63v6rmm8ahts55ekjpwlm6dusw5cwhpt60s6t0actqqsul6tm',
    weekly: 'terra19w39c3qz6kc756hap92x374reptah9kp5825f5c67hmquy383r5qd7dmd8',
  };
  const LCD = 'https://terra-classic-lcd.publicnode.com';
  const short = n => n >= 1e6 ? (n/1e6).toFixed(2) + 'M'
               : n >= 1e3 ? (n/1e3).toFixed(1) + 'K' : Math.round(n);

  async function refreshPools() {
    // Свёрнутая вкладка балансы не обновляет - смотреть в неё некому.
    if (document.visibilityState === 'hidden') return;
    for (const [game, addr] of Object.entries(POOL_WALLETS)) {
      try {
        // Пул - контракт: спрашиваем pot, а не баланс. Баланс включает
        // излишек, который в этом раунде не разыгрывается.
        const r = await fetch(LCD + '/cosmwasm/wasm/v1/contract/' + addr + '/smart/' + btoa('{"pot":{}}'),
                              { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const d = (await r.json())?.data || {};
        const sum = Number(d.pending || 0) + Number(d.carry || 0);
        const lunc = Math.min(sum, Number(d.balance || 0)) / 1e6;
        const el = document.getElementById('dg-' + game + '-pool');
        // Показываем приз, а не баланс кошелька: рядом центральный блок
        // печатает 80% от того же баланса, и две разные цифры про один и
        // тот же розыгрыш путают. Полоска ниже остаётся на балансе - она
        // меряет наполнение до порога, а не выигрыш.
        if (el) el.textContent = short(lunc * 0.80);
        const bar = document.getElementById('dg-' + game + '-bar');
        // Порог берём из контракта, если он уже загружен. min_pot = 0
        // означает, что порога нет: тогда полоса просто полная.
        const lim = (window.POOL_LIMITS || {})[game] || {};
        const target = Number(lim.minPot) || 0;
        if (bar) bar.style.width = (target > 0 ? Math.min(100, lunc / target * 100) : 100) + '%';
      } catch (e) {}
    }
  }

  // Отсчёты - из общего модуля расписания, без единого запроса
  function refreshTicks() {
    if (!window.DRAW_SCHEDULE) return;
    const S = window.DRAW_SCHEDULE;
    const d = document.getElementById('dg-daily-tick');
    const w = document.getElementById('dg-weekly-tick');
    if (d) d.textContent = S.format(S.msToNext('daily'));
    if (w) w.textContent = S.format(S.msToNext('weekly'));
  }

  // Circuit: доска и отсчёт из воркера. Пока эндпоинт не поднят - молча
  // оставляем прочерки, рельс не должен ломаться из-за 404.
  // Своего запроса тут больше нет: состояние раздаёт circuit-state.js,
  // единственный опросчик на всю страницу. Здесь только отрисовка.
  function renderCircuit(d) {
    // См. circuit-reveal.js: во время показа розыгрыша доска не наша.
    if (window.__circuitRevealBusy) return;
    if (!d) return;
    try {
      document.getElementById('dg-circuit-zones').textContent = d.sold;
      document.getElementById('dg-circuit-bar').style.width   = (d.sold / d.maxZones * 100) + '%';
      const m = Math.max(0, Math.round(d.msLeft / 60000));
      // Дедлайн прошёл: зоны заперты, ждём ближайшего запуска circuit-round.yml.
      // Крон стоит на */5, но GitHub под нагрузкой задерживает запуски по
      // расписанию, так что окно ожидания реально до 10-15 минут. Пустое слово
      // «closing» люди читают как поломку и начинают жать F5, поэтому пишем
      // «drawing» и объясняем прямо под цифрой, что происходит.
      const drawing = d.msLeft <= 0;
      const tick = drawing ? 'drawing' :
                   m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm';
      document.getElementById('dg-circuit-tick').textContent = tick;

      // Та же выборка кормит и сцену Circuit - второй запрос не нужен
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      set('cir-sold', d.sold);
      set('cir-pool', Math.round(d.poolUluna / 1e6).toLocaleString('en-US'));
      set('cir-left', tick);
      set('cir-left-sub', drawing
        ? 'zones are locked, picking the winner - usually a few minutes'
        : 'draws with ' + d.minZones + '+ zones');

      // Учащение такта на время розыгрыша делает circuit-state.js: при
      // msLeft <= 0 он сам переходит с 20 секунд на 5. Второго параллельного
      // таймера, который раньше жил рядом с двадцатисекундным, больше нет.
      const bd = document.getElementById('cir-board');
      if (bd && bd.children.length !== d.maxZones) {
        bd.innerHTML = Array.from({ length: d.maxZones }, () => '<i></i>').join('');
      }
      if (bd) Array.prototype.forEach.call(bd.children,
        (c, k) => c.className = k < d.sold ? 't' : '');
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', function () {
    let saved = null;
    try { saved = localStorage.getItem('dgGame'); } catch (e) {}
    if (saved === 'circuit') selectGame('circuit');
    refreshTicks(); refreshPools();
    // Состояние раунда приходит от circuit-state.js по подписке: свой
    // двадцатисекундный таймер убран, запрос теперь один на всех.
    if (window.CircuitState) window.CircuitState.subscribe(renderCircuit);
    else console.warn('[circuit] circuit-state.js не подключён');
    setInterval(refreshTicks, 1000);      // счётчик - локально, без сети
    setInterval(refreshPools, 45000);     // балансы меняются редко
  });
})();
