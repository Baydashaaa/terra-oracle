// ─── INIT ────────────────────────────────────────────────────────────────────
(async () => {
  // Restore last active tab
  try {
    const validTabs = ['home','draw','winners','verify','bag'];
    const pathTab = location.pathname.replace(/^\//, '') || '';
    const hashTab = location.hash.replace(/^#/, '') || '';
    const startTab = validTabs.includes(pathTab) ? pathTab
                   : validTabs.includes(hashTab) ? hashTab
                   : 'home';
    // Параметры адреса переживают нормализацию пути - см. пояснение в showTab.
    if (history.replaceState) {
      history.replaceState({ tab: startTab }, '', '/' + startTab + location.search);
    }
    showTab(startTab, true);
  } catch(e) { showTab('home', true); }

  // Restore wallet session (multi-layer: localStorage → sessionStorage → cookie)
  try {
    const persisted = loadPersistedWallet();
    if (persisted.address) {
      setConnectedWallet(persisted.address, persisted.provider || 'keplr');
    }
  } catch(e) {}

  startTimer();
  initAdminTrigger();
  await loadWinners();

  // ── Load balances first - update podium immediately ──
  const [_dBal, _wBal] = await Promise.all([
    getPoolAmount('daily'),
    getPoolAmount('weekly'),
  ]);
  window._dailyPoolBalance  = _dBal;
  window._weeklyPoolBalance = _wBal;
  updatePodiumPrizes();
  updatePoolDisplay();

  // ── Then load everything else ──
  await loadAllData();

  // Apply correct UI state after data is ready (podium, pool display, etc.)
  updatePodiumPrizes();

  // Hide loader now that everything is ready
  const loader = document.getElementById('page-loader');
  if (loader) {
    setTimeout(() => loader.classList.add('hidden'), 600);
  }

  // If the user landed directly on /bag (wallet already restored earlier in
  // this boot sequence), do one final guaranteed re-render now that the full
  // boot sequence (loadWinners, loadAllData, etc.) has actually finished.
  // This matches exactly what happens when a user manually switches away
  // from and back to My Bag (which is confirmed to always work correctly) -
  // it just does that same successful pass automatically, without requiring
  // the user to click away first.
  //
  // renderMyBag живёт теперь в bag.js, а он грузится ПОСЛЕ этого файла.
  // Пока всё лежало в одном app.js, вызов работал за счёт подъёма объявлений.
  // Теперь гарантию даёт готовность документа: отложенные скрипты выполняются
  // целиком ДО события DOMContentLoaded, значит после него функция точно
  // объявлена. Если событие уже прошло (а к этому месту мы приходим после
  // двух сетевых ожиданий, так что обычно так и есть) - зовём сразу.
  const _renderBagIfOpen = () => {
    try {
      const bagPage = document.getElementById('page-bag');
      if (bagPage && bagPage.style.display !== 'none' && (connectedWalletAddress || lotteryAddress)) {
        renderMyBag();
      }
    } catch(e) {}
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _renderBagIfOpen, { once: true });
  } else {
    _renderBagIfOpen();
  }

  // Refresh every 60s
  setInterval(loadAllData, 60000);
  // Отсчёт, фазы и запуск колеса целиком у Draw V2 - старого таймера
  // с локальными часами больше нет.
})();
