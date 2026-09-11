// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT - локальный результат раунда
// ═══════════════════════════════════════════════════════════════════════════
//
// Зачем: раунд закрывается скриптом, который сначала платит, потом объявляет.
// Показ, привязанный к объявлению, всегда приходит после денег - человек
// видит приход на кошелёк раньше, чем узнаёт, что выиграл. Здесь браузер
// считает победителя сам, как только дедлайн прошёл в цепи, и показывать
// можно сразу. Выплата догоняет позже и служит подтверждением.
//
// Правило берётся из circuit-rule.js - того же модуля, что использует
// закрывающий скрипт. Разойтись они не могут по построению.
//
// Модуль ES, поэтому подключается через <script type="module">, а результат
// передаётся обычному circuit-reveal.js через window.

import { circuitLocalResult } from '../../circuit-rule.js';

const log = (m) => { try { console.log('[local] ' + m); } catch (e) {} };

let workingOn = null;   // roundId, по которому уже считаем или посчитали

async function tick(st) {
  if (!st || !st.roundId || !st.deadline) return;
  if (workingOn === st.roundId) return;
  if (Date.now() < st.deadline) return;
  if (st.sold < 20) return;

  workingOn = st.roundId;
  log('дедлайн прошёл, считаем ' + st.roundId + ' локально');

  let res;
  try {
    res = await circuitLocalResult(st);
  } catch (e) {
    log('расчёт не удался: ' + (e && e.message ? e.message : e));
    return;
  }
  if (!res) { log('считать нечего'); return; }

  // Форма та же, что у lastClosed от воркера: play() не должен различать,
  // откуда пришли данные. Приза из split хватает на подпись, ссылки на
  // транзакцию нет и быть не может - деньги ещё не ушли.
  res.status = 'closed';
  res.split = st.split || null;
  res.closedAt = Date.now();

  window.__circuitLocal = res;
  log('зона ' + res.winnerZone + ' из ' + res.sold + ', блок ' + res.blockHeight);
  try { window.dispatchEvent(new CustomEvent('circuit-local-result', { detail: res })); }
  catch (e) {}
}

function boot() {
  if (!document.getElementById('stage-circuit')) return;
  if (window.CircuitState) window.CircuitState.subscribe(tick);
  else console.warn('[circuit-local] circuit-state.js не подключён');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
