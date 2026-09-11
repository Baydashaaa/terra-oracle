// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT - закрытие раунда
// ═══════════════════════════════════════════════════════════════════════════
//
// Запускается по крону часто (раз в 10–15 минут). Сам решает, пора ли
// закрывать раунд: доска заполнена или истёк дедлайн. Если ни то ни другое -
// молча выходит.
//
// Порядок ровно тот же, что в lottery-draw.js, и по тем же причинам:
//   1. Блок берётся ПО ДЕДЛАЙНУ РАУНДА, а не последний на момент запуска.
//      Иначе результат зависит от того, когда стартовал раннер, и перезапуск
//      до удачного хеша становится возможен.
//   2. Фолбэка на sha256(Date.now()) НЕТ. Блок недоступен - раунд не
//      закрывается, зоны и банк остаются на месте до следующего запуска.
//   3. Победитель считается ЗДЕСЬ, воркер только фиксирует итог.
//
// ВАЖНО: package.json репозитория содержит "type": "module". Только import,
// только с явным расширением .js. require() здесь роняет всё на старте -
// так пропали daily 2026-08-02 и weekly 2026-08-03.
//
// ── НАЛОГ ЦЕПИ, 20 августа 2026 ────────────────────────────────────────────
// Предложение #12223 подняло налог с 0.5% до 1.5% со 2 августа 2026.
// Проверено на упавшем раунде circuit_2026-08-20-05-44-17 до единицы uluna:
// налог вычитается ИЗ СУММЫ ПЕРЕВОДА - получателю приходит amount*(1-tax),
// с отправителя списывается amount + газ. Комиссия налог НЕ включает
// (перевод 23 404 LUNC прошёл с комиссией 8.5 LUNC).
//
// Следствие: воркер засчитывает в пул ВАЛОВУЮ сумму платежа игрока, а на
// кошелёк ложится 98.5% от неё. Раздать 100% пула физически невозможно -
// последний перевод всегда упирается в insufficient funds. Поэтому суммы
// выплат масштабируются под то, что реально может лежать на кошельке.
//
// Второе изменение: все переводы уходят ОДНОЙ транзакцией. Раньше их было
// три-четыре подряд, и падение на середине оставляло раунд полуоплаченным и
// незакрытым (15 и 17 августа, потом 20-го). Теперь состояние двоичное:
// либо ушли все, либо ни один.

import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { stringToPath }            from '@cosmjs/crypto';
import { SigningStargateClient }   from '@cosmjs/stargate';
import fs   from 'fs';
import path from 'path';
import { selectZone, ownerOfZone } from './circuit-rule.js';

// ── Настройки ──────────────────────────────────────────────────────────────
const WORKER   = process.env.CIRCUIT_WORKER_URL || 'https://oracle-draw.vladislav-baydan.workers.dev';
const SECRET   = process.env.DISTRIBUTION_SECRET;
const MNEMONIC = process.env.OPERATOR_MNEMONIC_CIRCUIT;
const TREASURY = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt';
const DENOM    = 'uluna';
const PREFIX   = 'terra';
const RPC      = process.env.RPC_URL || 'https://terra-classic-rpc.publicnode.com:443';

const LCD_NODES = [
  'https://terra-classic-lcd.publicnode.com',
  'https://rest.cosmos.directory/terraclassic',
  'https://terra-classic-lcd.hexxagon.io',
  'https://lcd.terraclassic.community',
];

// Утешительная доля соседним блокам. Решение ещё не закреплено, поэтому
// вынесено флагом: 0 полностью отключает, логика остаётся нетронутой.
const NEIGHBOUR_SHARE = Number(process.env.CIRCUIT_NEIGHBOUR_SHARE ?? '0.05');

const MAX_WAIT_MS   = 10 * 60 * 1000;   // сколько ждать появления блока дедлайна
const SNAPSHOT_DIR  = 'rounds';

// Цена газа на цепи и неснижаемый остаток на кошельке. Резерв нужен, чтобы
// кошелёк не уходил в ноль: следующему раунду нужен газ ещё до того, как на
// него придут первые платежи.
const GAS_PRICE     = 28.325;
const FLOAT_RESERVE = 25_000_000;

// Газ на транзакцию с n переводами. Замер 20 августа: три MsgSend в одной
// транзакции съели 500 266 при лимите 500 000 - не хватило 266 единиц, и
// раунд не закрылся. Реальный расход около 165k на сообщение, берём с
// запасом вдвое: комиссия всё равно копеечная против размера пула.
const gasFor = (n) => 300_000 + 250_000 * n;

// Налог, если LCD не ответил. Занижать нельзя: заниженный налог = недостаток
// средств на последнем переводе, то есть ровно та поломка, от которой уходим.
const TAX_FALLBACK = Number(process.env.CHAIN_TAX_RATE ?? '0.015');

// Ниже этого масштаба выплата не идёт вообще. 0.9 - это тревожный порог:
// налог 1.5% даёт масштаб ~0.985, и если вдруг вышло сильно меньше, значит
// дело не в налоге, а в чём-то ещё, и платить вслепую нельзя.
const MIN_SCALE = 0.9;

const fmt = n => Math.floor(n).toLocaleString('en-US');
const lunc = u => fmt(u / 1e6) + ' LUNC';

// ── Воркер ─────────────────────────────────────────────────────────────────
async function getState() {
  const r = await fetch(WORKER + '/circuit/state', { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('circuit/state failed: ' + r.status);
  return r.json();
}

async function closeRound(body) {
  const r = await fetch(WORKER + '/circuit/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SECRET },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('circuit/close failed: ' + r.status + ' ' + JSON.stringify(d));
  return d;
}

// ── Налог цепи ─────────────────────────────────────────────────────────────
// Ставка задана governance и уже менялась (0.2 → 0.5 → 1.5). Хардкодить её
// нельзя: следующее предложение снова уронит выплаты. Читаем с цепи.
async function fetchTaxRate() {
  for (const base of LCD_NODES) {
    try {
      const r = await fetch(base + '/terra/treasury/v1beta1/tax_rate', {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      const v = Number(d?.tax_rate);
      // Ноль здесь означает «не тот параметр», а не «налога нет»: цепь
      // фактически удерживает 1.5%, это видно в теле каждой транзакции.
      // Поэтому ноль считаем неответом и уходим на запасное значение.
      if (Number.isFinite(v) && v > 0 && v < 0.2) return v;
    } catch (e) {
      console.warn('tax rate fetch failed from ' + base + ': ' + e.message);
    }
  }
  console.warn('WARNING: tax rate unavailable on all LCD nodes, using fallback ' + TAX_FALLBACK);
  return TAX_FALLBACK;
}

// ── Блоки ──────────────────────────────────────────────────────────────────
async function fetchBlock(heightOrLatest) {
  const suffix = heightOrLatest === 'latest' ? 'latest' : String(heightOrLatest);
  for (const base of LCD_NODES) {
    try {
      const res = await fetch(base + '/cosmos/base/tendermint/v1beta1/blocks/' + suffix, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const hashRaw = data?.block_id?.hash;
      const header  = data?.block?.header;
      if (!hashRaw || !header) continue;
      return {
        hash:   Buffer.from(hashRaw, 'base64').toString('hex').toUpperCase(),
        height: Number(header.height),
        timeMs: new Date(header.time).getTime(),
      };
    } catch (e) {
      console.warn('block fetch failed from ' + base + ': ' + e.message);
    }
  }
  return null;
}

// Первый блок с timestamp >= targetMs. Бинарный поиск, ~15 запросов.
async function findBlockAtOrAfter(targetMs) {
  const latest = await fetchBlock('latest');
  if (!latest) return null;
  if (latest.timeMs < targetMs) return null;      // дедлайн ещё не наступил в цепи

  const AVG_BLOCK_MS = 6000;
  const span = Math.ceil((latest.timeMs - targetMs) / AVG_BLOCK_MS * 2) + 100;
  let lo = Math.max(1, latest.height - span);
  let hi = latest.height;

  const loBlock = await fetchBlock(lo);
  if (!loBlock) return null;
  if (loBlock.timeMs >= targetMs) return loBlock;

  let best = latest;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const b = await fetchBlock(mid);
    if (!b) return null;
    if (b.timeMs >= targetMs) { best = b; hi = b.height; }
    else { lo = b.height; }
  }
  return best;
}

// Ждём по времени ЦЕПИ, а не по часам раннера: дедлайн определён в терминах
// блоков, и только это время имеет значение.
async function waitForDeadline(deadlineMs) {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    const latest = await fetchBlock('latest');
    if (latest && latest.timeMs >= deadlineMs) return true;
    const left = Math.round((deadlineMs - (latest?.timeMs ?? Date.now())) / 1000);
    console.log('waiting for the deadline block, ~' + left + 's by chain time');
    await new Promise(r => setTimeout(r, 15000));
  }
  return false;
}

// ── Победитель ─────────────────────────────────────────────────────────────
// selectZone и ownerOfZone переехали в circuit-rule.js: тот же модуль читает
// страница, чтобы показать пробег до выплаты. Пока копий было две, они могли
// разойтись - и тогда анимация показала бы одного победителя, а деньги ушли
// бы другому, молча. Формулу правим только там.

// Блоки, стоящие вплотную к победившему, но принадлежащие другим кошелькам
function neighboursOf(blocks, zone, sold) {
  const win = ownerOfZone(blocks, zone);
  const out = [];
  for (const side of [zone - 1, zone + 1]) {
    if (side < 0 || side >= sold) continue;
    const b = ownerOfZone(blocks, side);
    if (!b) continue;
    if (win && b.wallet === win.wallet) continue;
    if (out.some(x => x.wallet === b.wallet)) continue;
    out.push(b);
  }
  return out;
}

// ── Кошелёк ────────────────────────────────────────────────────────────────
async function getClient() {
  if (!MNEMONIC) throw new Error('OPERATOR_MNEMONIC_CIRCUIT is not set');
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, {
    prefix: PREFIX, hdPaths: [stringToPath("m/44'/330'/0'/0/0")],
  });
  const [account] = await wallet.getAccounts();
  const client = await SigningStargateClient.connectWithSigner(RPC, wallet);
  return { client, address: account.address };
}

// ── Отметки об уже отправленных переводах ──────────────────────────────────
// Скрипт падал на середине выплат: 15 августа не доплатил долю выкупа,
// 17-го чуть не отправил приз второй раз. Воркер хранит отметку по каждому
// переводу раунда, и повтор продолжает с места, а не начинает сначала.
//
// С переходом на одну транзакцию отметки стали страховкой второго уровня:
// сама выплата теперь атомарна, но отметки защищают от повтора, если
// транзакция прошла, а закрытие раунда не легло.
async function fetchPayoutMarks(roundId) {
  const r = await fetch(WORKER + '/circuit/payouts?roundId=' + encodeURIComponent(roundId),
                        { headers: { Authorization: 'Bearer ' + SECRET } });
  // Не знаем, что уже ушло - платить вслепую нельзя.
  if (!r.ok) throw new Error('cannot read payout marks: HTTP ' + r.status);
  return (await r.json()).marks || {};
}

async function markPayout(roundId, leg, txHash) {
  // Деньги ушли одной транзакцией, отметок нужно несколько. Каждая - с
  // повторами: сеть моргнула, а мы бы оставили раунд в самом опасном
  // состоянии «заплачено, но не записано».
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(WORKER + '/circuit/payouts', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId, leg, txHash }),
      });
      if (r.ok) return;
      lastErr = 'HTTP ' + r.status;
    } catch (e) {
      lastErr = e.message;
    }
    await new Promise(r => setTimeout(r, attempt * 3000));
  }
  throw new Error('SENT BUT NOT RECORDED - leg ' + leg + ', tx ' + txHash +
                  ' (' + lastErr + ') - record it manually before re-running');
}

// ── Отправка ───────────────────────────────────────────────────────────────
// Одна транзакция, сколько угодно получателей. Комиссия покрывает ТОЛЬКО газ:
// налог цепи вычитается из суммы перевода, а не добавляется к комиссии -
// проверено на живых транзакциях раунда 20 августа.
async function sendMany(client, from, legs, memo) {
  const msgs = legs.map(l => ({
    typeUrl: '/cosmos.bank.v1beta1.MsgSend',
    value: {
      fromAddress: from,
      toAddress:   l.to,
      amount:      [{ denom: DENOM, amount: String(Math.floor(l.uluna)) }],
    },
  }));
  // Лимит берём по замеру сети, а не по формуле: длина memo и количество
  // получателей двигают расход, и упереться в потолок посреди выплаты дорого.
  // Формула остаётся нижней границей на случай, если узел не даёт симуляцию.
  let gas = gasFor(msgs.length);
  try {
    const simulated = Math.ceil((await client.simulate(from, msgs, memo)) * 1.6);
    if (Number.isFinite(simulated)) gas = Math.max(gas, simulated);
  } catch (e) {
    console.warn('gas simulation unavailable (' + e.message + '), using ' + gas);
  }
  const fee = {
    amount: [{ denom: DENOM, amount: String(Math.ceil(gas * GAS_PRICE)) }],
    gas: String(gas),
  };
  console.log('gas limit ' + gas + ', fee ' + lunc(Math.ceil(gas * GAS_PRICE)));
  const res = await client.signAndBroadcast(from, msgs, fee, memo);
  if (res.code !== 0) throw new Error('tx failed: ' + res.rawLog);
  console.log('tx: ' + res.transactionHash);
  return res.transactionHash;
}

// ── Снимок раунда ──────────────────────────────────────────────────────────
// Пишется ПОСЛЕ выплат, но ДО вызова /circuit/close: если close не пройдёт,
// снимок останется и раунд можно будет разобрать вручную.
function writeSnapshot(round, blockInfo, zone, winner, payouts, money) {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const file = path.join(SNAPSHOT_DIR, round.roundId + '.json');
  const data = {
    _verify: [
      'Frozen board for this Circuit round, exactly as the draw used it.',
      '1. blocks are consecutive: [wallet, from, to]. The sold part has no gaps.',
      '2. total_sold must equal the sum of all block lengths.',
      '3. winner_zone = BigInt("0x" + block_hash) % total_sold',
      '4. the wallet owning winner_zone must equal `winner` below.',
      '',
      'The block is not the latest one at run time: it is the first block with a',
      'timestamp at or after the round deadline, found by binary search. That makes',
      'the result independent of when the script actually ran.',
      '',
      'payouts are the amounts put on the wire. Terra Classic deducts the chain tax',
      'from the transferred amount, so each recipient credits amount * (1 - tax_rate).',
      'payout_scale is the factor applied to the worker split so that the pool wallet,',
      'which itself received only (1 - tax_rate) of every player payment, can cover it.',
    ],
    round_id:    round.roundId,
    opened_at:   new Date(round.openedAt).toISOString(),
    deadline:    new Date(round.deadline).toISOString(),
    total_sold:  round.sold,
    max_zones:   round.maxZones,
    pool_uluna:  round.poolUluna,
    split:       round.split,
    tax_rate:     money.tax,
    payout_scale: money.scale,
    block_hash:   blockInfo.hash,
    block_height: blockInfo.height,
    block_time:   new Date(blockInfo.timeMs).toISOString(),
    randomness:  'terra-classic-block-hash-at-round-deadline',
    winner_zone: zone,
    winner:      winner.wallet,
    blocks:      round.blocks.map(b => [b.wallet, b.from, b.to]),
    payouts,
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log('snapshot written: ' + file);
  return file;
}

// ── Главное ────────────────────────────────────────────────────────────────
async function main() {
  const round = await getState();
  const now = Date.now();

  console.log('round ' + round.roundId + ' - ' + round.sold + '/' + round.maxZones +
              ' zones, pool ' + lunc(round.poolUluna));

  const full    = round.sold >= round.maxZones;
  const expired = now >= round.deadline;
  if (!full && !expired) {
    console.log('not time yet: ' + Math.round((round.deadline - now) / 60000) + ' min left, board not full');
    return;
  }

  // Недобор - деньги НЕ возвращаются, зоны и банк переносятся вперёд.
  // Блок здесь не нужен: розыгрыша не будет.
  if (round.sold < round.minZones) {
    console.log('below the minimum (' + round.sold + ' < ' + round.minZones + ') - merging into the next round');
    const res = await closeRound({});
    console.log('merged, carried ' + lunc(res.carried || 0) + ' into ' + res.nextRound);
    return;
  }

  // Блок дедлайна. Если ещё не наступил по времени цепи - ждём, но недолго:
  // упавший запуск не страшен, следующий крон повторит.
  if (!(await waitForDeadline(round.deadline))) {
    console.log('deadline block has not appeared within the wait window - leaving the round open');
    return;
  }
  const blockInfo = await findBlockAtOrAfter(round.deadline);
  if (!blockInfo) {
    console.log('could not resolve the deadline block - leaving the round open, will retry');
    return;
  }
  console.log('deadline block ' + blockInfo.height + ' at ' + new Date(blockInfo.timeMs).toISOString());
  console.log('hash ' + blockInfo.hash);

  const zone   = selectZone(blockInfo.hash, round.sold);
  const winner = ownerOfZone(round.blocks, zone);
  if (!winner) throw new Error('zone ' + zone + ' has no owner - board is inconsistent');
  console.log('winning zone ' + zone + ' -> ' + winner.wallet);

  const { client, address } = await getClient();

  // Кошельки долей TCO. Деньги переводятся туда сразу при закрытии раунда,
  // чтобы обязательство было видно НА ЦЕПОЧКЕ, а не только счётчиком в KV:
  // пропадёт база - пропадёт и след, а баланс кошелька проверит кто угодно.
  // Сюда стекается вся доля TCO (6% + 6%) и отсюда идёт единственная
  // покупка в конце эпохи.
  const TCO_BUYBACK_WALLET = 'terra1x3axkacpes4d8q2svfeneqdtv8rvcvccrn66j5';

  // ── Плановые суммы по данным воркера ─────────────────────────────────────
  // Утешительная доля соседям берётся ИЗ призового фонда, а не сверх.
  const prizeTotal = round.split.prize;
  const neigh      = NEIGHBOUR_SHARE > 0 ? neighboursOf(round.blocks, zone, round.sold) : [];
  const perNeigh   = neigh.length ? Math.floor(prizeTotal * NEIGHBOUR_SHARE / neigh.length) : 0;
  const toWinner   = prizeTotal - perNeigh * neigh.length;

  const dropUluna = round.split.tcoDrop || 0;
  const burnUluna = round.split.tcoBurn || 0;
  const tcoUluna  = dropUluna + burnUluna;
  if (tcoUluna <= 0) {
    console.log('WARNING: split has no tcoDrop/tcoBurn - worker is on the old format, TCO shares stay in the pool wallet');
  }

  const legs = [];
  legs.push({ id: 'winner', to: winner.wallet, planned: toWinner,
              memo: 'Circuit ' + round.roundId + ' - zone ' + zone });
  for (const n of neigh) {
    legs.push({ id: 'neighbour:' + n.wallet, to: n.wallet, planned: perNeigh, wallet: n.wallet,
                memo: 'Circuit ' + round.roundId + ' - neighbour of zone ' + zone });
  }
  legs.push({ id: 'treasury', to: TREASURY, planned: round.split.treasury,
              memo: 'Circuit ' + round.roundId + ' - treasury' });
  if (tcoUluna > 0) {
    legs.push({ id: 'tco', to: TCO_BUYBACK_WALLET, planned: tcoUluna,
                memo: 'Circuit ' + round.roundId + ' - TCO buyback share' });
  }

  // ── Что уже отправлено ───────────────────────────────────────────────────
  const marks = await fetchPayoutMarks(round.roundId);
  const done  = Object.keys(marks);
  if (done.length) console.log('already paid in an earlier run: ' + done.join(', '));

  const toPay = legs.filter(l => !marks[l.id]);

  // ── Масштабирование под то, что реально лежит на кошельке ────────────────
  // Пул в учёте воркера ВАЛОВОЙ, а на кошелёк с каждого платежа игрока легло
  // (1 - tax). Плюс отсюда же уходил газ прошлых операций. Поэтому масштаб
  // считается не от пула, а от фактического баланса: он и есть единственная
  // правда о том, сколько можно раздать.
  //
  // Пересчёт при повторе безопасен: выплата атомарна, значит неотмеченного
  // «наполовину отправленного» перевода не бывает, а отмеченные не трогаем.
  const tax     = await fetchTaxRate();
  const balRaw  = await client.getBalance(address, DENOM);
  const balance = Number(balRaw.amount);
  const gasCost = Math.ceil(gasFor(Math.max(toPay.length, 1)) * GAS_PRICE);
  const gross   = toPay.reduce((s, l) => s + l.planned, 0);
  const budget  = balance - gasCost - FLOAT_RESERVE;
  const scale   = gross > 0 ? Math.min(1, budget / gross) : 1;

  console.log('operator ' + address + ', balance ' + lunc(balance));
  console.log('chain tax ' + (tax * 100).toFixed(2) + '%, payout scale ' + scale.toFixed(6));

  if (gross > 0 && !(scale > MIN_SCALE)) {
    const short = gross + gasCost + FLOAT_RESERVE - balance;
    throw new Error('payout scale ' + scale.toFixed(4) + ' is below ' + MIN_SCALE +
                    ' - refusing to pay. Balance ' + lunc(balance) + ', unpaid legs ' +
                    lunc(gross) + '. Top up the operator wallet with ' + lunc(short) +
                    ' to pay in full, then re-run');
  }

  // Неоплаченные - по масштабу. Уже отмеченные показываем по плану: прошлый
  // запуск отправлял их без масштаба, и снимок раунда должен это отражать.
  for (const l of legs) l.uluna = marks[l.id] ? l.planned : Math.floor(l.planned * scale);

  // Слишком мелкое не отправляем: комиссия дороже перевода.
  const pending = toPay.filter(l => l.uluna >= 1_000_000);
  for (const l of toPay) {
    if (l.uluna < 1_000_000) console.log('too small to send (<1 LUNC), skipped: ' + l.id + ' -> ' + l.to);
  }
  const needed = pending.reduce((s, l) => s + l.uluna, 0);

  for (const l of legs) {
    const state = marks[l.id] ? 'ALREADY SENT ' + marks[l.id] : 'to send';
    console.log('  ' + l.id.padEnd(24) + lunc(l.uluna).padStart(16) +
                '  (planned ' + lunc(l.planned) + ')  ' + state);
  }
  console.log('to send now: ' + lunc(needed) + ' + ' + lunc(gasCost) + ' gas');

  if (process.env.DRY_RUN === '1') {
    console.log('DRY_RUN - nothing sent, exiting');
    return;
  }

  // Не хватает - НЕ отправляем ничего. Полуоплаченный раунд хуже незакрытого.
  if (pending.length && balance < needed + gasCost) {
    throw new Error('not enough funds: balance ' + lunc(balance) + ', need ' +
                    lunc(needed + gasCost) + ' - top up the operator wallet with ' +
                    lunc(needed + gasCost - balance) + ' and re-run');
  }

  // ── Одна транзакция на все переводы ──────────────────────────────────────
  if (pending.length) {
    const memo = 'Circuit ' + round.roundId + ' - payouts';
    console.log('sending ' + pending.length + ' payouts in one tx, ' + lunc(needed) + ' total');
    const tx = await sendMany(client, address, pending, memo);
    for (const l of pending) {
      await markPayout(round.roundId, l.id, tx);
      marks[l.id] = tx;
    }
  } else {
    console.log('everything was already paid in an earlier run - closing the round');
  }

  // ── Снимок и закрытие ────────────────────────────────────────────────────
  const netOf = u => u - Math.floor(u * tax);
  const payouts = { winner: null, neighbours: [], treasury: null, tcoDrop: null, tcoBurn: null };
  const legById = Object.fromEntries(legs.map(l => [l.id, l]));

  payouts.winner = {
    wallet: winner.wallet,
    uluna:  legById['winner'].uluna,
    received: netOf(legById['winner'].uluna),
    tx: marks['winner'] || null,
  };
  for (const n of neigh) {
    const l = legById['neighbour:' + n.wallet];
    payouts.neighbours.push({
      wallet: n.wallet, uluna: l.uluna, received: netOf(l.uluna),
      tx: marks[l.id] || null,
    });
  }
  payouts.treasury = {
    wallet: TREASURY,
    uluna:  legById['treasury'].uluna,
    received: netOf(legById['treasury'].uluna),
    tx: marks['treasury'] || null,
  };
  if (tcoUluna > 0) {
    // Суммы пишем раздельно: пропорция 6/6 должна быть видна в снимке
    // раунда, даже когда перевод один. Делим уже отмасштабированную сумму.
    const sent = legById['tco'].uluna;
    const dropPart = Math.floor(sent * (dropUluna / tcoUluna));
    payouts.tcoDrop = { wallet: TCO_BUYBACK_WALLET, uluna: dropPart,
                        purpose: 'rewards', tx: marks['tco'] || null };
    payouts.tcoBurn = { wallet: TCO_BUYBACK_WALLET, uluna: sent - dropPart,
                        purpose: 'burn', tx: marks['tco'] || null };
  }

  writeSnapshot(round, blockInfo, zone, winner, payouts, { tax, scale });

  const res = await closeRound({
    winnerZone:  zone,
    blockHash:   blockInfo.hash,
    blockHeight: blockInfo.height,
    blockTime:   new Date(blockInfo.timeMs).toISOString(),
    txWinner:    payouts.winner.tx,
  });
  console.log('round closed. TCO pending: ' + lunc(res.tcoPending || 0));
}

main().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
