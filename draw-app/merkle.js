/**
 * Построение накопительного merkle-дерева наград Circuit.
 *
 * ФОРМАТ ОБЯЗАН СОВПАДАТЬ С src/merkle.rs В КОНТРАКТЕ ДО БАЙТА. Расхождение
 * не падает с ошибкой - оно даёт корректный на вид пруф, который контракт
 * молча отвергает. Поэтому внизу файла есть самопроверка по эталонным
 * значениям, посчитанным независимо; она же продублирована тестами на Rust.
 *
 *   лист   sha256(utf8("<адрес><сумма>"))   без разделителя, сумма десятичная
 *   узел   sha256(меньший ++ больший)       пара сортируется по байтам
 *   нечётный лист поднимается на уровень выше БЕЗ изменения
 *   корень hex в нижнем регистре, 64 символа
 *
 * Запуск самопроверки:  node merkle.js --self-test
 */

import { createHash } from 'node:crypto';

const sha256 = (buf) => createHash('sha256').update(buf).digest();

/** Лист для пары (адрес, накопительная сумма в минимальных единицах). */
export function leafHash(address, amount) {
  return sha256(Buffer.from(String(address) + String(amount), 'utf8'));
}

/** Узел: пара сортируется, поэтому сторона соседа в пруфе не нужна. */
function nodeHash(a, b) {
  return Buffer.compare(a, b) <= 0
    ? sha256(Buffer.concat([a, b]))
    : sha256(Buffer.concat([b, a]));
}

/**
 * Строит дерево.
 *
 * @param {Array<{address: string, amount: string|bigint|number}>} entries
 *        Накопительные суммы - «начислено за всё время», не за эпоху.
 * @returns {{root: string, total: string, proofs: Object, leaves: number}}
 *        proofs[address] = { amount, proof: [hex, ...] }
 */
export function buildTree(entries) {
  if (!entries.length) throw new Error('Дерево из нуля листьев не строится');

  // Порядок листьев не влияет на проверку пруфа, но влияет на сам корень.
  // Сортируем по адресу, чтобы одни и те же данные всегда давали один корень
  // и результат можно было воспроизвести независимо.
  const rows = entries
    .map((e) => ({ address: e.address, amount: BigInt(e.amount) }))
    .filter((e) => e.amount > 0n)
    .sort((x, y) => (x.address < y.address ? -1 : x.address > y.address ? 1 : 0));

  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.address)) throw new Error('Адрес встречается дважды: ' + r.address);
    seen.add(r.address);
  }

  const leaves = rows.map((r) => leafHash(r.address, r.amount));

  // Пути соседей снизу вверх для каждого листа
  const proofs = rows.map(() => []);
  let level = leaves;
  let indices = rows.map((_, i) => [i]); // какие листья лежат под каждым узлом

  while (level.length > 1) {
    const next = [];
    const nextIndices = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        // Нечётный узел поднимается как есть - соседа нет, в пруф ничего
        // не добавляется. Ровно то же правило в контракте.
        next.push(level[i]);
        nextIndices.push(indices[i]);
        continue;
      }
      const left = level[i];
      const right = level[i + 1];
      for (const li of indices[i]) proofs[li].push(right.toString('hex'));
      for (const li of indices[i + 1]) proofs[li].push(left.toString('hex'));
      next.push(nodeHash(left, right));
      nextIndices.push([...indices[i], ...indices[i + 1]]);
    }
    level = next;
    indices = nextIndices;
  }

  const out = {};
  let total = 0n;
  rows.forEach((r, i) => {
    out[r.address] = { amount: r.amount.toString(), proof: proofs[i] };
    total += r.amount;
  });

  return {
    root: level[0].toString('hex'),
    total: total.toString(),
    leaves: rows.length,
    proofs: out,
  };
}

/** Проверка пруфа теми же правилами, что в контракте. */
export function verifyProof(root, address, amount, proof) {
  let hash = leafHash(address, amount);
  for (const sibling of proof) {
    const raw = Buffer.from(sibling, 'hex');
    if (raw.length !== 32) return false;
    hash = nodeHash(hash, raw);
  }
  return hash.toString('hex') === String(root).toLowerCase();
}

/* ── самопроверка ──────────────────────────────────────────────────────────
   Значения посчитаны независимо от этого кода. Если они разойдутся, значит
   формат уехал, и пруфы перестанут приниматься контрактом.               */

const REFERENCE = {
  leafA100: '3ea6cacf4686a16d3855c64d55be7ca5ab9079a0863d82e2c269e98783aa4ab0',
  leafA1e6: 'b32994573a16061339e27c7d1a7c93e4b7bf152f88bb59c521355d94c21d4084',
  nodeAB:   '0a52772019d0ae282846e87763ad560726351c8844ef24c82217dd5022e9bf3e',
  root3:    'afc0e54058acf105b1a7785ad0676974b2cb26aba4443b5e66a3cff50b4b5207',
};

export function selfTest() {
  const A = 'terra1x3axkacpes4d8q2svfeneqdtv8rvcvccrn66j5';
  const B = 'terra10zptfez4jdvakrhu58q4nqj2te7mnpewqhu27a';
  const C = 'terra1lkcsxf2et3s64uwemyy257n0dcep0al40a4m55';

  const fail = [];
  const check = (name, got, want) => {
    if (got !== want) fail.push(`${name}\n  получено: ${got}\n  ожидалось: ${want}`);
  };

  check('лист A(100)', leafHash(A, 100).toString('hex'), REFERENCE.leafA100);
  check('лист A(1000000)', leafHash(A, 1000000).toString('hex'), REFERENCE.leafA1e6);

  const ab = nodeHash(leafHash(A, 100), leafHash(B, 200));
  check('узел AB', ab.toString('hex'), REFERENCE.nodeAB);

  // Порядок сортировки адресов: terra10... < terra15... < terra1x...
  // поэтому дерево строится как ((B,C),A) - корень отличается от ((A,B),C).
  // Проверяем оба: сортированный вариант через buildTree и ручной по спеке.
  const manual = nodeHash(ab, leafHash(C, 300));
  check('корень ((A,B),C)', manual.toString('hex'), REFERENCE.root3);

  const tree = buildTree([
    { address: A, amount: 100 },
    { address: B, amount: 200 },
    { address: C, amount: 300 },
  ]);
  for (const [addr, rec] of Object.entries(tree.proofs)) {
    if (!verifyProof(tree.root, addr, rec.amount, rec.proof)) {
      fail.push(`пруф не сошёлся для ${addr}`);
    }
  }
  if (tree.total !== '600') fail.push('сумма листьев ' + tree.total + ' вместо 600');

  // Подделка суммы не должна проходить
  const first = Object.entries(tree.proofs)[0];
  if (verifyProof(tree.root, first[0], BigInt(first[1].amount) + 1n, first[1].proof)) {
    fail.push('пруф прошёл с изменённой суммой - проверка сломана');
  }

  if (fail.length) {
    console.error('САМОПРОВЕРКА НЕ ПРОШЛА:\n' + fail.join('\n'));
    return false;
  }
  console.log('самопроверка пройдена: формат совпадает со спецификацией контракта');
  console.log('корень дерева из трёх листьев:', tree.root);
  return true;
}

if (process.argv[2] === '--self-test') {
  process.exit(selfTest() ? 0 : 1);
}
