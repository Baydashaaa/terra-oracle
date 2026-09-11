// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT - эпоха наград TCO
// ═══════════════════════════════════════════════════════════════════════════
//
// Раз в неделю: покупает TCO на всё, что накопилось от долей раундов, делит
// купленное пополам (награды / сжигание), пополняет claim-контракт, пересчитывает
// накопительное дерево и публикует корень.
//
// Почему партией, а не после каждого раунда: доля игрока за раунд - центы,
// и раздача переводами стоила бы дороже самой раздачи. Здесь одна покупка,
// ноль переводов игрокам, каждый забирает сам когда накопится.
//
// ПОЧЕМУ ОДИН КОШЕЛЁК. Обе доли (6% наград + 6% сжигания) стекаются на
// кошелёк выкупа, и только его ключ нужен этому скрипту. Бёрн-кошелёк лишь
// принимает готовый TCO - его ключ в CI не попадает никогда, что важно:
// там мешок токенов копится месяцами до вайтлиста.
//
// СЖИГАНИЕ НЕ ВЫПОЛНЯЕТСЯ. До попадания в белый список половина просто
// лежит на бёрн-кошельке. Включать - отдельным решением.
//
// package.json репозитория имеет "type": "module": только import, только с
// явным расширением .js.

import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { stringToPath }            from '@cosmjs/crypto';
import { SigningCosmWasmClient }   from '@cosmjs/cosmwasm-stargate';
import { calculateFee, GasPrice }  from '@cosmjs/stargate';
import fs   from 'fs';
import path from 'path';
import { buildTree } from './merkle.js';

// ── Настройки ──────────────────────────────────────────────────────────────
const WORKER    = process.env.CIRCUIT_WORKER_URL || 'https://oracle-draw.vladislav-baydan.workers.dev';
const MNEMONIC  = process.env.CIRCUIT_BUYBACK_MNEMONIC;
const RPC       = process.env.RPC_URL || 'https://terra-classic-rpc.publicnode.com:443';
const PREFIX    = 'terra';
const DENOM     = 'uluna';

// Кривая, токен, бёрн-кошелёк, claim-контракт
const BOND      = process.env.TCO_BOND    || 'terra1xnejslpfa398nn2mexv34y8737fcq998zz4dsnq74qn464lu9m4s604du5';
// Покупка идёт ЧЕРЕЗ ФАБРИКУ, а не напрямую в кривую: сам бонд принимает
// swap_buy только от неё ("Unauthorized - only terra1vd595gq..."). Поля при
// этом те же - contract_address указывает, какую кривую дёрнуть.
const BOND_FACTORY = process.env.TCO_BOND_FACTORY || 'terra1vd595gqyekq05p8hy9t0r9q68jtk5whleqt5py4wdwrqfykz74lqrmw8q5';
const TOKEN     = process.env.TCO_TOKEN   || 'terra1566znlxwke0kp9jkhe6qgapsmcfdmc7k9czh380tlx80va8zlsgqzvjtfp';
const BURN_WALLET = process.env.TCO_BURN_WALLET || 'terra10zptfez4jdvakrhu58q4nqj2te7mnpewqhu27a';
// Ожидаемый адрес кошелька выкупа. Сверяется с тем, что вывелся из
// мнемоники: несовпадение означает не ту фразу или не тот путь деривации,
// и продолжать нельзя.
const BUYBACK_WALLET = process.env.TCO_BUYBACK_WALLET || 'terra1x3axkacpes4d8q2svfeneqdtv8rvcvccrn66j5';
// Terra Classic - coin type 330. По умолчанию cosmjs берёт 118, и та же
// мнемоника даёт совершенно другой адрес.
const HD_PATH = process.env.CIRCUIT_HD_PATH || "m/44'/330'/0'/0/0";
const REWARDS   = process.env.CIRCUIT_REWARDS_CONTRACT;   // адрес claim-контракта

// Из какой мнемоники ДОЛЖЕН получиться кошелёк выкупа. Сверка обязательна:
// в секрет один раз уже попала фраза постороннего счёта, и скрипт этого
// не заметил - просто увидел нулевой баланс и вышел.
const EXPECTED_WALLET = process.env.CIRCUIT_BUYBACK_ADDRESS || 'terra1x3axkacpes4d8q2svfeneqdtv8rvcvccrn66j5';

// Порог: покупать на меньшее бессмысленно - комиссия свопа съест больше
const THRESHOLD_ULUNA = BigInt(process.env.CIRCUIT_EPOCH_THRESHOLD_ULUNA || 50_000_000_000);
// Оставляем на комиссии следующих транзакций этой же эпохи
const GAS_RESERVE_ULUNA = BigInt(process.env.CIRCUIT_GAS_RESERVE_ULUNA || 300_000_000);
// Допуск на то, что между симуляцией и отправкой кто-то купит.
// Комиссию свопа 3% НЕ вычитаем: она уже учтена в amount_out.
const SLIPPAGE_BPS = BigInt(process.env.CIRCUIT_SLIPPAGE_BPS || 200);  // 2%

const LEDGER_FILE = 'rewards-ledger.json';
const PROOFS_FILE = 'rewards-proofs.json';

const LCD_NODES = [
  'https://terra-classic-lcd.publicnode.com',
  'https://rest.cosmos.directory/terraclassic',
  'https://terra-classic-lcd.hexxagon.io',
  'https://lcd.terraclassic.community',
];

const GAS_PRICE = GasPrice.fromString('28.325uluna');
const DRY = process.env.DRY_RUN === '1';

const lunc = (u) => (Number(u) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });

// ── LCD ────────────────────────────────────────────────────────────────────
async function lcdQuery(contract, msg) {
  const q = Buffer.from(JSON.stringify(msg)).toString('base64');
  let lastErr;
  for (const node of LCD_NODES) {
    try {
      const r = await fetch(`${node}/cosmwasm/wasm/v1/contract/${contract}/smart/${q}`,
                            { signal: AbortSignal.timeout(15000) });
      const d = await r.json();
      if (d.data !== undefined) return d.data;
      lastErr = new Error(d.message || JSON.stringify(d).slice(0, 200));
    } catch (e) { lastErr = e; }
  }
  throw new Error('запрос к ' + contract + ' не прошёл: ' + lastErr.message);
}

async function nativeBalance(addr) {
  let lastErr;
  for (const node of LCD_NODES) {
    try {
      const r = await fetch(`${node}/cosmos/bank/v1beta1/balances/${addr}/by_denom?denom=${DENOM}`,
                            { signal: AbortSignal.timeout(15000) });
      const d = await r.json();
      if (d?.balance?.amount !== undefined) return BigInt(d.balance.amount);
      lastErr = new Error(JSON.stringify(d).slice(0, 200));
    } catch (e) { lastErr = e; }
  }
  throw new Error('баланс не прочитан: ' + lastErr.message);
}

const tokenBalance = async (addr) =>
  BigInt((await lcdQuery(TOKEN, { balance: { address: addr } })).balance);

// ── Реестр ─────────────────────────────────────────────────────────────────
// processedUluna - сколько пожизненных LUNC-начислений кошелька уже
// пересчитано в TCO. tcoUluna - сколько TCO ему причитается всего.
function loadLedger() {
  if (!fs.existsSync(LEDGER_FILE)) {
    return { epoch: 0, updatedAt: null, dustTco: '0', wallets: {}, history: [] };
  }
  return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
}

function saveLedger(l) {
  l.history = (l.history || []).slice(-50);
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(l, null, 2) + '\n');
}

// ── Транзакции ─────────────────────────────────────────────────────────────
// Газ считаем симуляцией с запасом 1.6 - та же настройка, что в deploy-скриптах.
async function exec(client, sender, contract, msg, funds, memo) {
  if (DRY) { console.log('DRY_RUN: не отправляю', JSON.stringify(msg).slice(0, 120)); return null; }
  const gas = await client.simulate(sender, [{
    typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
    value: {
      sender, contract,
      msg: new TextEncoder().encode(JSON.stringify(msg)),
      funds: funds || [],
    },
  }], memo);
  const fee = calculateFee(Math.ceil(gas * 1.6), GAS_PRICE);
  const res = await client.execute(sender, contract, msg, fee, memo, funds || []);
  if (res.code) throw new Error('tx failed: ' + res.rawLog);
  console.log('   tx: ' + res.transactionHash);
  return res.transactionHash;
}

// ── Основное ───────────────────────────────────────────────────────────────
async function main() {
  if (!MNEMONIC) throw new Error('CIRCUIT_BUYBACK_MNEMONIC не задан');
  if (!REWARDS)  throw new Error('CIRCUIT_REWARDS_CONTRACT не задан - контракт наград ещё не развёрнут');

  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, {
    prefix: PREFIX,
    hdPaths: [stringToPath(HD_PATH)],
  });
  const [account] = await wallet.getAccounts();
  const me = account.address;
  console.log('кошелёк выкупа: ' + me);

  if (me !== BUYBACK_WALLET) {
    throw new Error(
      'из мнемоники вывелся ' + me + ', а ожидался ' + BUYBACK_WALLET +
      '. Проверь CIRCUIT_BUYBACK_MNEMONIC и путь деривации (' + HD_PATH + ').'
    );
  }

  if (me !== EXPECTED_WALLET) {
    throw new Error(
      'мнемоника даёт не тот кошелёк.\n' +
      '  получен:  ' + me + '\n' +
      '  ожидался: ' + EXPECTED_WALLET + '\n' +
      'Проверь секрет CIRCUIT_BUYBACK_MNEMONIC. Ничего не потрачено.'
    );
  }

  // ── 1. Хватает ли накопленного ───────────────────────────────────────────
  const balance = await nativeBalance(me);
  console.log('баланс: ' + lunc(balance) + ' LUNC');

  if (balance <= GAS_RESERVE_ULUNA) {
    console.log('на кошельке только резерв на комиссии - выходим');
    return;
  }
  // Налог на переводы забирается сверх суммы, поэтому оставляем ещё процент.
  let spend = (balance - GAS_RESERVE_ULUNA) * 100n / 101n;

  if (spend < THRESHOLD_ULUNA) {
    console.log('накоплено ' + lunc(spend) + ' LUNC, порог ' + lunc(THRESHOLD_ULUNA) +
                ' - покупать рано, ждём следующей эпохи');
    return;
  }

  // ── 2. Кому сколько причитается ──────────────────────────────────────────
  const r = await fetch(WORKER + '/circuit/rewards?all=1', { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('/circuit/rewards?all=1 вернул ' + r.status);
  const registry = await r.json();

  const ledger = loadLedger();
  const deltas = {};
  let sumDelta = 0n;
  for (const [addr, rec] of Object.entries(registry.wallets || {})) {
    const lifetime  = BigInt(rec.uluna || 0);
    const processed = BigInt(ledger.wallets[addr]?.processedUluna || 0);
    if (lifetime <= processed) continue;
    deltas[addr] = lifetime - processed;
    sumDelta += deltas[addr];
  }

  if (sumDelta === 0n) {
    console.log('новых начислений нет - покупку откладываем, LUNC остаётся на кошельке');
    return;
  }
  console.log('новых начислений: ' + lunc(sumDelta) + ' LUNC у ' +
              Object.keys(deltas).length + ' кошельков');

  // ── 3. Покупка ───────────────────────────────────────────────────────────
  const sim = await lcdQuery(BOND, { simulate: { offer: DENOM, amount: String(spend) } });
  const expected = BigInt(sim.amount_out);
  const minOut = expected * (10000n - SLIPPAGE_BPS) / 10000n;
  console.log('покупаем на ' + lunc(spend) + ' LUNC → ожидаем ' + lunc(expected) +
              ' TCO, минимум ' + lunc(minOut));

  const before = await tokenBalance(me);
  const client = await SigningCosmWasmClient.connectWithSigner(RPC, wallet);

  const txSwap = await exec(client, me, BOND_FACTORY,
    { swap_buy: { contract_address: BOND, min_amount_out: String(minOut) } },
    [{ denom: DENOM, amount: String(spend) }],
    'Circuit epoch ' + (ledger.epoch + 1) + ' - TCO buyback');

  if (DRY) { console.log('DRY_RUN: дальше не идём'); return; }

  const after  = await tokenBalance(me);
  const bought = after - before;
  if (bought <= 0n) throw new Error('после свопа баланс TCO не вырос - покупка не прошла');
  console.log('куплено: ' + lunc(bought) + ' TCO');

  // ── 4. Делим пополам ─────────────────────────────────────────────────────
  const toBurn    = bought / 2n;
  const toRewards = bought - toBurn;   // нечётный остаток - в награды

  console.log('на сжигание: ' + lunc(toBurn) + ' TCO → ' + BURN_WALLET);
  const txBurn = await exec(client, me, TOKEN,
    { transfer: { recipient: BURN_WALLET, amount: String(toBurn) } }, [],
    'Circuit epoch ' + (ledger.epoch + 1) + ' - burn share (burn itself deferred)');

  console.log('в контракт наград: ' + lunc(toRewards) + ' TCO → ' + REWARDS);
  const txFund = await exec(client, me, TOKEN,
    { send: {
        contract: REWARDS,
        amount: String(toRewards),
        msg: Buffer.from(JSON.stringify({ fund: {} })).toString('base64'),
    } }, [],
    'Circuit epoch ' + (ledger.epoch + 1) + ' - fund rewards');

  // ── 5. Раскладываем купленное по кошелькам ───────────────────────────────
  // Остаток от округления не теряется: копится в реестре и раздаётся
  // со следующей эпохой.
  const pot = toRewards + BigInt(ledger.dustTco || 0);
  let handed = 0n;
  for (const [addr, delta] of Object.entries(deltas)) {
    const share = pot * delta / sumDelta;
    handed += share;
    const cur = ledger.wallets[addr] || { processedUluna: '0', tcoUluna: '0' };
    cur.tcoUluna = String(BigInt(cur.tcoUluna) + share);
    cur.processedUluna = String(BigInt(cur.processedUluna) + delta);
    ledger.wallets[addr] = cur;
  }
  ledger.dustTco = String(pot - handed);
  console.log('роздано ' + lunc(handed) + ' TCO, остаток от округления ' + ledger.dustTco);

  // ── 6. Дерево и корень ───────────────────────────────────────────────────
  const entries = Object.entries(ledger.wallets)
    .map(([address, v]) => ({ address, amount: v.tcoUluna }))
    .filter((e) => BigInt(e.amount) > 0n);

  const tree = buildTree(entries);
  const epoch = ledger.epoch + 1;
  console.log('дерево: ' + tree.leaves + ' листьев, всего ' + lunc(tree.total) +
              ' TCO, корень ' + tree.root);

  const txRoot = await exec(client, me, REWARDS,
    { update_root: { root: tree.root, epoch, total_allocated: tree.total } }, [],
    'Circuit epoch ' + epoch + ' - publish root');

  // ── 7. Файлы ─────────────────────────────────────────────────────────────
  fs.writeFileSync(PROOFS_FILE, JSON.stringify({
    _verify: [
      'Cumulative TCO allocations for Circuit participants.',
      'amount is the LIFETIME allocation, not this epoch - the contract pays the',
      'difference against what the address has already claimed.',
      'leaf = sha256("<address><amount>"), nodes hash the sorted pair, root is hex.',
      'Rebuild it yourself: node merkle.js --self-test pins the format.',
    ],
    epoch,
    root: tree.root,
    total: tree.total,
    contract: REWARDS,
    token: TOKEN,
    generatedAt: new Date().toISOString(),
    proofs: tree.proofs,
  }, null, 2) + '\n');

  ledger.epoch = epoch;
  ledger.updatedAt = new Date().toISOString();
  (ledger.history = ledger.history || []).push({
    epoch,
    at: ledger.updatedAt,
    spentUluna: String(spend),
    boughtTco: String(bought),
    priceLuncPerTco: (Number(spend) / Number(bought)).toFixed(9),
    toBurn: String(toBurn),
    toRewards: String(toRewards),
    handed: String(handed),
    wallets: Object.keys(deltas).length,
    txSwap, txBurn, txFund, txRoot,
  });
  saveLedger(ledger);

  console.log('эпоха ' + epoch + ' закрыта');
}

main().catch((e) => { console.error('ОШИБКА: ' + e.message); process.exit(1); });
