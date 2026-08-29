#!/usr/bin/env node
//
// stamp.cjs - расставляет метки ?v= в index.html по СОДЕРЖИМОМУ файлов.
//
// ЗАЧЕМ
// Метки ставились вручную датой, и это регулярно давало осечки: правишь файл,
// метку поднять забываешь, вернувшийся посетитель получает из кеша старую
// версию. Так уже было с app.js и style.css в Oracle Draw в августе 2026, и с
// chat.js в Terra Oracle 28 августа. Тегов на два сайта под сотню, руками это
// больше не держится.
//
// КАК
// Метка = первые 10 символов sha1 от содержимого файла. Меняется файл - меняется
// метка, не меняется - остаётся прежней. Значит скрипт идемпотентен: прогнал
// дважды подряд, второй раз ничего не поменял. В коммит попадают только те
// строки, чьи файлы действительно правились.
//
// ЗАПУСК из корня репозитория:
//   node dev/stamp.cjs            - проставить метки в index.html
//   node dev/stamp.cjs --check    - только проверить, ничего не писать
//   node dev/stamp.cjs a.html b.html   - указать файлы явно
//
// --check возвращает код 1, если есть устаревшие метки. Удобно позвать перед
// коммитом: увидишь, что забыл, до того как это увидят посетители.
//
// ЗАПУСКАЕТСЯ ТОЛЬКО РУКАМИ. Никакого workflow: бот, коммитивший метки сам,
// уже мешал править файлы через веб-интерфейс GitHub, и его убрали намеренно.
//
// ЧЕГО СКРИПТ НЕ ДЕЛАЕТ
// Не трогает ссылки без ?v= (у картинок версия зашита в имя), внешние адреса
// и пути, которых нет на диске - о последних он предупредит отдельно.
// Не заглядывает внутрь js: если бандл сам грузит модули, это мимо него.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check') || args.includes('--dry');
const targets = args.filter(a => !a.startsWith('--'));
if (!targets.length) targets.push('index.html');

const ROOT = process.cwd();
const HASH_LEN = 10;

// Ссылка на локальный файл, у которой уже есть метка ?v=
const REF = /((?:src|href)=")([^"?#]+)\?v=([^"&#]*)(")/g;

function stampOf(file) {
  const buf = fs.readFileSync(file);
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, HASH_LEN);
}

function isLocal(p) {
  return !/^(https?:)?\/\//.test(p) && !p.startsWith('data:') && !p.startsWith('#');
}

let totalChanged = 0, totalSame = 0, missing = [];

for (const target of targets) {
  if (!fs.existsSync(target)) {
    console.error(`НЕТ ФАЙЛА: ${target}`);
    process.exit(1);
  }

  const before = fs.readFileSync(target, 'utf8');
  const changes = [];

  const after = before.replace(REF, (whole, pre, ref, oldStamp, post) => {
    if (!isLocal(ref)) return whole;

    // путь считается от корня репо; ведущий слеш убираем
    const onDisk = path.join(ROOT, ref.replace(/^\/+/, ''));
    if (!fs.existsSync(onDisk)) {
      missing.push(ref);
      return whole;
    }

    const next = stampOf(onDisk);
    if (next === oldStamp) { totalSame++; return whole; }

    changes.push({ ref, from: oldStamp, to: next });
    totalChanged++;
    return `${pre}${ref}?v=${next}${post}`;
  });

  console.log(`\n${target}`);
  if (!changes.length) {
    console.log('  все метки на месте');
  } else {
    for (const c of changes) {
      console.log(`  ${c.ref}`);
      console.log(`      ${c.from || '(пусто)'} -> ${c.to}`);
    }
  }

  if (!checkOnly && changes.length) fs.writeFileSync(target, after);
}

if (missing.length) {
  console.log('\nССЫЛКИ НА НЕСУЩЕСТВУЮЩИЕ ФАЙЛЫ (метки не тронуты):');
  for (const m of [...new Set(missing)]) console.log('  ' + m);
}

console.log(`\nитого: обновлено ${totalChanged}, без изменений ${totalSame}` +
            (missing.length ? `, битых ссылок ${new Set(missing).size}` : ''));

if (checkOnly && totalChanged) {
  console.log('\n--check: есть устаревшие метки. Прогони без --check и закоммить.');
  process.exit(1);
}
if (missing.length) process.exit(1);
