function adminSpinWithTestWallets() {
  if (!adminUnlocked) return;

  const testWallets = [
    'terra1abc...1111', 'terra1def...2222', 'terra1ghi...3333',
    'terra1jkl...4444', 'terra1mno...5555', 'terra1pqr...6666',
    'terra1stu...7777', 'terra1vwx...8888',
  ];

  const isDaily = currentLottery === 'daily';
  const backup  = isDaily ? [...dailyTickets] : [...weeklyTickets];
  const fake    = testWallets.map(function(a) { return { address: a, txhash: 'test', time: Date.now()/1000 }; });

  if (isDaily) dailyTickets = fake;
  else         weeklyTickets = fake;

  wheelSpunThisSession = false;

  // Розыгрыш ведёт Draw V2; здесь только повтор последнего результата
  if (window.oracleDrawV2) window.oracleDrawV2.replay();

  // Restore real tickets after 2 minutes - enough time to see all 3 winners
  const restoreDelay = isDaily ? 70000 : 120000;
  setTimeout(function() {
    if (isDaily) dailyTickets = backup;
    else         weeklyTickets = backup;
    updateWheelTickets();
  }, restoreDelay);
}
