// ═══ VERIFY v2 ═══════════════════════════════════════════════════════════
// Заменяет расчёт на странице Verify & Proof.
//
// Прежний код считал seed как SHA256("<height>:<hash>:<count>") - такой
// формулы в lottery-draw.js нет вообще, она была выдумана. На раунде
// weekly_2026-08-03 она давала индекс 1, тогда как скрипт записал 10 и 12.
// «Совпадение» проходило только потому, что один кошелёк держал 12 билетов
// из 13 и оба индекса указывали на него. Сверка тоже была фиктивной:
// `recalcIdx === (w.winnerIndex || recalcIdx)` при отсутствии winnerIndex
// сравнивает число само с собой.
//
// Здесь воспроизводится РЕАЛЬНЫЙ алгоритм, оба варианта:
//   daily  - index = BigInt("0x" + block_hash) % total
//   weekly - seed<0> = block_hash
//            для каждого места p: seed = sha256(seed + String(p))
//                                 index = BigInt("0x" + seed) % total
//                                 пока билет принадлежит уже выигравшему
//                                 кошельку - index сдвигается на +1 по кругу

// ── утилиты ───────────────────────────────────────────────────────────────
async function vfSha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Байты из base64: секрет, энтропия и результат контракта лежат в снимке
// именно так, а хеширует контракт СЫРЫЕ байты, не их текстовую запись.
function vfB64(s) {
  const bin = atob(s || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function vfHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function vfB64FromBytes(bytes) {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s);
}

function vfConcat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let at = 0;
  parts.forEach(p => { out.set(p, at); at += p.length; });
  return out;
}

/** u64 big-endian - в этом виде контракт подмешивает round_id и номер места. */
function vfBe64(n) {
  const out = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}

async function vfSha256Bytes(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(buf);
}

// Пара [addr, n] в снимке = n подряд идущих билетов
function vfExpandTickets(pairs) {
  const flat = [];
  (pairs || []).forEach(p => { for (let i = 0; i < (p[1] || 0); i++) flat.push(p[0]); });
  return flat;
}

// Диапазоны билетов по кошелькам - для карты и подписей
function vfRanges(pairs) {
  const out = []; let at = 0;
  (pairs || []).forEach(p => {
    const n = p[1] || 0;
    out.push({ address: p[0], from: at, to: at + n - 1, count: n });
    at += n;
  });
  return out;
}

async function vfLoadSnapshot(roundId) {
  if (!roundId) return null;
  try {
    const r = await fetch('./rounds/' + roundId + '.json?t=' + Date.now());
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

// ── воспроизведение розыгрыша контракта (commit-reveal) ───────────────────
// Отличается от прежней схемы принципиально: случайность даёт не хеш блока, а
// пара «секрет кипера + энтропия минтеров», причём секрет публикуется ТОЛЬКО
// в момент расчёта, а его хеш зафиксирован при открытии раунда. Поэтому здесь
// две проверки вместо одной:
//   1. sha256(secret) совпадает с seed_hash, обещанным при открытии;
//   2. sha256(secret + entropy + round_id) даёт записанный result,
//      из которого и выводятся места.
//
// Формула контракта, дословно (src/contract.rs):
//   result   = sha256(secret ‖ entropy ‖ be64(round_id))
//   seed<p>  = sha256(seed<p-1> ‖ be64(p)),  seed<-1> = result
//   index    = u128(первые 16 байт seed, big-endian) % total
//   занято   - index двигается на +1 по кругу, пока не найдётся новый минтер
async function vfReplayContract(snap, tickets) {
  const total = tickets.length;
  if (!total || !snap || !snap.secret || !snap.entropy) return null;

  const secret  = vfB64(snap.secret);
  const entropy = vfB64(snap.entropy);
  const roundId = Number(snap.contract_round_id);

  const seedHashOk = snap.seed_hash
    ? vfB64FromBytes(await vfSha256Bytes(secret)) === snap.seed_hash
    : null;

  const result = await vfSha256Bytes(vfConcat([secret, entropy, vfBe64(roundId)]));
  const resultOk = snap.result ? vfB64FromBytes(result) === snap.result : null;

  // Сколько мест разыгрывалось - берём из записи раунда, а не из догадки:
  // у daily одно, у weekly три, но при малом числе кошельков контракт
  // заполнит меньше.
  const recorded = Array.isArray(snap.winner_index) ? snap.winner_index
                 : (snap.winner_index !== undefined ? [snap.winner_index] : []);
  const places = Math.max(1, Math.min(recorded.length || 1, new Set(tickets).size));

  const used = new Set();
  const steps = [];
  let seed = result;

  for (let place = 0; place < places; place++) {
    seed = await vfSha256Bytes(vfConcat([seed, vfBe64(place)]));
    let acc = 0n;
    for (let i = 0; i < 16; i++) acc = (acc << 8n) | BigInt(seed[i]);
    const raw = Number(acc % BigInt(total));

    let index = raw, shifted = 0;
    while (used.has(tickets[index]) && shifted < total) {
      index = (index + 1) % total; shifted++;
    }
    used.add(tickets[index]);
    steps.push({
      place: place + 1,
      seed: vfHex(seed),
      seedLabel: place === 0 ? 'sha256(result + be64(0))'
                             : 'sha256(prev seed + be64(' + place + '))',
      raw, index, shifted, address: tickets[index],
    });
  }
  return { steps, seedHashOk, resultOk, resultHex: vfHex(result) };
}

// ── воспроизведение розыгрыша ─────────────────────────────────────────────
async function vfReplay(pool, blockHash, tickets) {
  const total = tickets.length;
  if (!total || !blockHash) return [];

  if (pool === 'daily') {
    const index = Number(BigInt('0x' + blockHash) % BigInt(total));
    return [{ place: 1, seed: blockHash, seedLabel: 'block hash', raw: index,
              index, shifted: 0, address: tickets[index] }];
  }

  // weekly - цепочка мест, seed каждого следующего считается от предыдущего
  const placesCount = Math.min(3, new Set(tickets).size);
  const used = new Set();
  const steps = [];
  let seed = blockHash;

  for (let place = 0; place < placesCount; place++) {
    seed = await vfSha256Hex(seed + String(place));
    const raw = Number(BigInt('0x' + seed) % BigInt(total));
    let index = raw, shifted = 0;
    while (used.has(tickets[index]) && shifted < total) {
      index = (index + 1) % total; shifted++;
    }
    used.add(tickets[index]);
    steps.push({ place: place + 1, seed, seedLabel: 'sha256(prev seed + "' + place + '")',
                 raw, index, shifted, address: tickets[index] });
  }
  return steps;
}

// ── отрисовка ─────────────────────────────────────────────────────────────
async function renderDrawVerify(idx) {
  const host  = document.getElementById('vf-result');
  const empty = document.getElementById('vf-empty');
  if (!host) return;

  const completed = vfRounds();
  const w = completed[parseInt(idx)];
  if (!w) { if (empty) empty.style.display = 'block'; host.style.display = 'none'; return; }
  if (empty) empty.style.display = 'none';
  host.style.display = 'block';

  host.innerHTML = '<div class="vf-loading">Loading round snapshot…</div>';

  const snap = await vfLoadSnapshot(w.roundId);

  // Circuit проверяется иначе: вместо списка билетов - доска зон, вместо
  // индекса - номер зоны. Правило то же, что в circuit-rule.js и в блоке
  // _verify самого снимка: зона = BigInt("0x" + block_hash) % total_sold.
  if (w.type === 'circuit') {
    host.innerHTML = vfCircuitHtml(w, snap);
    return;
  }

  // Без снимка воспроизвести нечего: список билетов после закрытия раунда
  // не восстанавливается - /round-complete проставляет consumedInRound.
  if (!snap || !snap.tickets) {
    host.innerHTML =
      '<div class="vf-verdict vf-na"><b>Cannot be replayed</b>' +
      '<span>No entry snapshot was written for this round. Snapshots start from ' +
      'the first draw after the 1 Aug 2026 upgrade - earlier rounds only have the ' +
      'recorded result.</span></div>' + vfInputsHtml(w, null);
    return;
  }

  const tickets = vfExpandTickets(snap.tickets);
  const ranges  = vfRanges(snap.tickets);

  // Контрактные раунды узнаём по наличию секрета: у них нет хеша блока вовсе.
  const chain = snap.contract_round_id !== undefined && snap.secret
    ? await vfReplayContract(snap, tickets)
    : null;
  const steps = chain
    ? chain.steps
    : await vfReplay(w.type, w.blockHash || snap.block_hash, tickets);

  if (!chain && !(w.blockHash || snap.block_hash)) {
    host.innerHTML =
      '<div class="vf-verdict vf-na"><b>Cannot be replayed</b>' +
      '<span>This round has neither a block hash nor a contract secret.</span></div>' +
      vfInputsHtml(w, snap);
    return;
  }

  // Записанные индексы: у daily число, у weekly массив
  const recorded = Array.isArray(snap.winner_index) ? snap.winner_index
                 : (snap.winner_index !== undefined ? [snap.winner_index] : []);

  const checks = steps.map((s, i) => {
    const rec  = recorded[i];
    const addr = (w.places[i] || {}).address;
    return {
      step: s,
      recorded: rec,
      indexOk: rec !== undefined ? s.index === rec : null,
      addrOk:  addr ? s.address === addr : null
    };
  });
  const allOk = checks.length > 0 && checks.every(c => c.indexOk !== false && c.addrOk !== false);
  const anyRecorded = checks.some(c => c.recorded !== undefined);

  host.innerHTML =
    vfVerdictHtml(allOk && (!chain || chain.resultOk !== false), anyRecorded, w) +
    (chain ? vfCommitHtml(chain, snap) : '') +
    vfInputsHtml(w, snap) +
    vfStepsHtml(checks, tickets.length, w) +
    vfMapHtml(ranges, tickets.length, checks) +
    vfReproduceHtml(w, snap, tickets.length, chain);
}

function vfVerdictHtml(ok, anyRecorded, w) {
  if (!anyRecorded) {
    return '<div class="vf-verdict vf-na"><b>Replayed, nothing to compare against</b>' +
      '<span>This round has no recorded winner index, so the replay cannot be ' +
      'checked against it. The wallets below still come from the real algorithm.</span></div>';
  }
  return ok
    ? '<div class="vf-verdict vf-ok"><b>Verified</b><span>Replaying the draw in your ' +
      'browser produces exactly the indices and wallets recorded on chain.</span></div>'
    : '<div class="vf-verdict vf-bad"><b>Mismatch</b><span>The replay does not match the ' +
      'recorded result. Something is wrong - please report this round.</span></div>';
}

/**
 * Карточка обязательства: показывает, что секрет был зафиксирован ДО того,
 * как появились участники, и что из него получается именно записанный
 * результат. Это и есть суть commit-reveal, ради которой схему меняли.
 */
function vfCommitHtml(chain, snap) {
  const pill = (ok) => ok === null ? ''
    : (ok ? '<span class="vf-ok-pill">matches</span>'
          : '<span class="vf-bad-pill">does not match</span>');
  return '<div class="vf-card"><div class="vf-h">Commit &amp; reveal</div>' +
    '<div class="vf-kv">' +
      '<div><span>Contract round</span><b>#' + snap.contract_round_id + '</b></div>' +
      '<div><span>sha256(secret) vs seed_hash</span><b>' + pill(chain.seedHashOk) + '</b></div>' +
      '<div><span>sha256(secret+entropy+id) vs result</span><b>' + pill(chain.resultOk) + '</b></div>' +
    '</div>' +
    '<div class="vf-hash"><span>seed_hash (committed at open)</span><code>' +
      (snap.seed_hash || '&mdash;') + '</code></div>' +
    '<div class="vf-hash"><span>secret (revealed at settle)</span><code>' +
      (snap.secret || '&mdash;') + '</code></div>' +
    '<div class="vf-hash"><span>entropy (from minters)</span><code>' +
      (snap.entropy || '&mdash;') + '</code></div>' +
    '<div class="vf-hash"><span>result</span><code>' + chain.resultHex + '</code></div>' +
    '</div>';
}

function vfInputsHtml(w, snap) {
  // У контрактных раундов высоты блока нет: строку показываем только там, где
  // она есть, иначе в проверке остаётся прочерк, который выглядит поломкой.
  const onChain = snap && snap.contract_round_id !== undefined && snap.secret;
  const rows = onChain ? [
    ['Pool',          w.type === 'daily' ? 'Daily' : 'Weekly'],
    ['Round',         w.roundId || ('#' + w.round)],
    ['Settled at',    w.blockTime || '&mdash;'],
    ['Total entries', snap.total]
  ] : [
    ['Pool',         w.type === 'daily' ? 'Daily' : 'Weekly'],
    ['Round',        w.roundId || ('#' + w.round)],
    ['Block height', w.blockHeight
        ? '<a href="https://finder.terraport.finance/mainnet/blocks/' + w.blockHeight +
          '" target="_blank" rel="noopener">' + w.blockHeight + '</a>'
        : '&mdash;'],
    ['Block time',   w.blockTime || '&mdash;'],
    ['Total entries', snap ? snap.total : (w.tickets || '&mdash;')]
  ];
  return '<div class="vf-card"><div class="vf-h">Input data</div>' +
    '<div class="vf-kv">' + rows.map(r =>
      '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('') + '</div>' +
    (w.blockHash
      ? '<div class="vf-hash"><span>Block hash</span><code>' + w.blockHash + '</code></div>'
      : '') +
    (snap
      ? '<a class="vf-src" href="./rounds/' + w.roundId + '.json" target="_blank" rel="noopener">' +
        'entry snapshot &rarr;</a>' : '') +
    '</div>';
}

function vfStepsHtml(checks, total, w) {
  const intro = w.type === 'daily'
    ? 'One winner. The block hash is read as a number and divided by the entry count &mdash; ' +
      'the remainder is the winning entry.'
    : 'Up to three places. Each place uses a seed derived from the <em>previous</em> one, ' +
      'so the chain has to be replayed in order. If a place lands on a wallet that already ' +
      'won, the index moves forward one entry at a time until it reaches a new wallet.';

  const body = checks.map(c => {
    const s = c.step;
    const mark = c.indexOk === null ? '' :
      (c.indexOk ? '<span class="vf-ok-pill">matches record</span>'
                 : '<span class="vf-bad-pill">recorded ' + c.recorded + '</span>');
    return '<div class="vf-step">' +
      '<div class="vf-step-h"><span class="vf-place p' + s.place + '">' + s.place + '</span>' +
        '<span class="vf-step-t">' + (checks.length > 1 ? 'Place ' + s.place : 'Winner') + '</span>' +
        mark + '</div>' +
      '<div class="vf-calc">' +
        '<div><i>seed</i> = ' + s.seedLabel + '</div>' +
        '<div><i>&nbsp;</i>&nbsp;&nbsp;<code>' + s.seed.slice(0, 40) + '&hellip;</code></div>' +
        '<div><i>index</i> = BigInt("0x" + seed) % ' + total + ' = <b>' + s.raw + '</b></div>' +
        (s.shifted
          ? '<div class="vf-shift">wallet already won &rarr; moved ' + s.shifted +
            ' entr' + (s.shifted > 1 ? 'ies' : 'y') + ' forward &rarr; <b>' + s.index + '</b></div>'
          : '') +
      '</div>' +
      '<div class="vf-lands">entry <b>#' + s.index + '</b> belongs to <code>' + s.address + '</code></div>' +
    '</div>';
  }).join('');

  return '<div class="vf-card"><div class="vf-h">How this round was drawn</div>' +
    '<p class="vf-intro">' + intro + '</p>' + body + '</div>';
}

// Карта билетов - то, что делает результат наглядным: видно, в чей отрезок попал индекс
function vfMapHtml(ranges, total, checks) {
  const winIdx = checks.map(c => c.step.index);
  const bar = ranges.map((r, i) => {
    const hit = winIdx.filter(x => x >= r.from && x <= r.to);
    return '<div class="vf-seg' + (hit.length ? ' hit' : '') + '" ' +
      'style="flex:' + r.count + '" title="' + r.address + ' · entries ' + r.from + '-' + r.to + '">' +
      (hit.length ? '<span>' + hit.join(', ') + '</span>' : '') + '</div>';
  }).join('');

  const list = ranges.map(r => {
    const hit = winIdx.filter(x => x >= r.from && x <= r.to);
    return '<div class="vf-row' + (hit.length ? ' hit' : '') + '">' +
      '<code>' + fmtAddr(r.address) + '</code>' +
      '<span class="vf-range">' + (r.count === 1 ? 'entry ' + r.from : 'entries ' + r.from + '&ndash;' + r.to) + '</span>' +
      '<span class="vf-cnt">' + r.count + '</span>' +
      (hit.length ? '<span class="vf-hitmark">won at #' + hit.join(', #') + '</span>' : '') +
    '</div>';
  }).join('');

  return '<div class="vf-card"><div class="vf-h">Entry map</div>' +
    '<p class="vf-intro">Every entry in the order the draw used it. Segment width = share of ' +
    'the pool. The winning index falls inside one wallet&rsquo;s range &mdash; that is the whole result.</p>' +
    '<div class="vf-bar">' + bar + '</div>' +
    '<div class="vf-rows">' + list + '</div></div>';
}

function vfReproduceHtml(w, snap, total, chain) {
  // Контрактный раунд считается иначе во всём: хешируются СЫРЫЕ байты, номер
  // места подмешивается как big-endian u64, индекс берётся из первых 16 байт.
  // Показывать здесь старую формулу с хешем блока значило бы врать: такого
  // хеша у этих раундов нет вовсе.
  if (chain) {
    const code =
      '// секрет, энтропия и результат - base64 из снимка\n' +
      'const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));\n' +
      'const be64 = n => { const o = new Uint8Array(8); let v = BigInt(n);\n' +
      '  for (let i = 7; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };\n' +
      'const sha = async b => new Uint8Array(await crypto.subtle.digest("SHA-256", b));\n' +
      'const cat = a => { const o = new Uint8Array(a.reduce((n,x)=>n+x.length,0));\n' +
      '  let k = 0; a.forEach(x => { o.set(x, k); k += x.length; }); return o; };\n\n' +
      '// 1. секрет действительно тот, что обещали при открытии\n' +
      'await sha(b64(secret))                 // === seed_hash\n\n' +
      '// 2. результат раунда\n' +
      'let s = await sha(cat([b64(secret), b64(entropy), be64(' +
        snap.contract_round_id + ')]));      // === result\n\n' +
      '// 3. места по порядку\n' +
      'for (let p = 0; p < ' + chain.steps.length + '; p++) {\n' +
      '  s = await sha(cat([s, be64(p)]));\n' +
      '  let acc = 0n;\n' +
      '  for (let i = 0; i < 16; i++) acc = (acc << 8n) | BigInt(s[i]);\n' +
      '  let i = Number(acc % ' + total + 'n);\n' +
      '  // дальше i двигается на +1 по кругу, пока кошелёк уже выигрывал\n' +
      '}';
    return '<div class="vf-card vf-repro"><div class="vf-h">Reproduce it yourself</div>' +
      '<p class="vf-intro">Всё нужное лежит в снимке раунда и в самом контракте: ' +
      '<code>{"proof":{"round_id":' + snap.contract_round_id + '}}</code>. ' +
      'Хеш блока здесь ни при чём - случайность даёт пара «секрет кипера + энтропия минтеров».</p>' +
      '<pre>' + code + '</pre></div>';
  }

  const code = w.type === 'daily'
    ? 'BigInt("0x" + "' + (w.blockHash || '').slice(0, 24) + '...") % ' + total + 'n'
    : 'let s = "' + (w.blockHash || '').slice(0, 24) + '...";\n' +
      'for (let p = 0; p < 3; p++) {\n' +
      '  s = sha256(s + String(p));            // hex\n' +
      '  let i = Number(BigInt("0x" + s) % ' + total + 'n);\n' +
      '  // skip forward while entries[i] already won\n' +
      '}';
  return '<div class="vf-card vf-repro"><div class="vf-h">Reproduce it yourself</div>' +
    '<p class="vf-intro">Take the block hash from the block explorer above and the entry list ' +
    'from the snapshot, then run:</p><pre>' + code + '</pre></div>';
}

// ── Circuit: проверка одной формулой ─────────────────────────────────────
function vfCircuitHtml(w, snap) {
  if (!snap || !snap.block_hash || !snap.total_sold) {
    return '<div class="vf-verdict vf-na"><b>Cannot be replayed</b>' +
      '<span>No board snapshot was written for this round.</span></div>' +
      vfInputsHtml(w, null);
  }

  const sold  = Number(snap.total_sold);
  const zone  = Number(BigInt('0x' + snap.block_hash) % BigInt(sold));
  const owner = (snap.blocks || []).find(b => zone >= b[1] && zone <= b[2]);
  const addr  = owner ? owner[0] : null;

  const zoneOk = snap.winner_zone !== undefined ? zone === Number(snap.winner_zone) : null;
  const addrOk = snap.winner ? addr === snap.winner : null;
  const allOk  = zoneOk !== false && addrOk !== false;

  const verdict = allOk
    ? '<div class="vf-verdict vf-ok"><b>Verified</b><span>Recomputing the zone in your ' +
      'browser gives exactly the zone and wallet recorded for this round.</span></div>'
    : '<div class="vf-verdict vf-bad"><b>Mismatch</b><span>The recomputed zone does not ' +
      'match the recorded result. Something is wrong - please report this round.</span></div>';

  const rows = [
    ['Pool',          'Circuit'],
    ['Round',         w.roundId || ('#' + w.round)],
    ['Block height',  snap.block_height
        ? '<a href="https://finder.terraport.finance/mainnet/blocks/' + snap.block_height +
          '" target="_blank" rel="noopener">' + snap.block_height + '</a>'
        : '-'],
    ['Block time',    snap.block_time || '-'],
    ['Zones claimed', sold],
    ['Winning zone',  zone + (zoneOk === false ? ' (recorded ' + snap.winner_zone + ')' : '')],
    ['Winner',        addr ? fmtAddr(addr) : '-']
  ];

  return verdict +
    '<div class="vf-card"><div class="vf-h">Input data</div><div class="vf-kv">' +
    rows.map(r => '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('') +
    '</div><div class="vf-hash"><span>Block hash</span><code>' + snap.block_hash + '</code></div>' +
    '<a class="vf-src" href="./rounds/' + w.roundId + '.json" target="_blank" rel="noopener">' +
    'board snapshot &rarr;</a></div>' +
    '<div class="vf-card vf-repro"><div class="vf-h">Reproduce it yourself</div>' +
    '<p class="vf-intro">Take the block hash from the explorer above and the zone count ' +
    'from the snapshot, then run:</p><pre>Number(BigInt("0x" + "' +
    snap.block_hash.slice(0, 24) + '...") % ' + sold + 'n)</pre></div>';
}

window.vfCircuitHtml = vfCircuitHtml;

window.renderDrawVerify = renderDrawVerify;


// ── Выбор раунда ─────────────────────────────────────────────────────────
// Родной <select> рисуется средствами ОС и в тёмную тему сайта не ложится
// никак: ни фон, ни шрифт, ни стрелка не поддаются CSS. Поэтому кнопка
// плюс собственная панель - и заодно в строку помещается больше: чип пула,
// дата и пометка, воспроизводим ли раунд.
var vfPickerOpen = false;

// ЕДИНСТВЕННЫЙ источник списка проверяемых раундов. Индексы из него идут и
// в выпадающий список, и в openVerifyForRound, и в renderDrawVerify - разойдись
// эти выборки, панель открыла бы чужой раунд. Circuit подмешивается сюда,
// потому что живёт не в winners.json, а в отдельном списке из воркера.
function vfRounds() {
  return (winnersData || []).concat(circuitWinners || [])
    .filter(function (w) { return w.places && w.places.length; })
    .sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
}

function vfRowHtml(w, i, active) {
  return '<button class="vf-opt' + (active ? ' active' : '') + '" role="option" data-i="' + i + '" ' +
    'onclick="vfPick(' + i + ')">' +
    '<span class="vf-opt-chip ' + (w.type === 'daily' ? 'd' : w.type === 'circuit' ? 'c' : 'w') + '">' +
      (w.type === 'daily' ? 'Daily' : w.type === 'circuit' ? 'Circuit' : 'Weekly') + '</span>' +
    '<span class="vf-opt-id">' + (w.roundId || ('#' + w.round)) + '</span>' +
    '<span class="vf-opt-date">' + fmtDate(w.time) + '</span>' +
    '<span class="vf-opt-tag" data-tag="' + i + '">&middot;&middot;&middot;</span>' +
  '</button>';
}

// Наличие снимка НЕ угадывается по данным раунда. Первая попытка помечала
// строки по наличию block_height - и врала для пяти раундов из восьми:
// высота есть, а снимка нет, потому что снимки пишутся только с 3 авг 2026.
// Раз весь раздел про честность, статус берётся запросом, а не догадкой.
//
// Разметка ленивая: раньше она шла из populateDrawVerifySelect, то есть при
// загрузке страницы, когда выпадашка закрыта и её никто не видит. На каждый
// раунд уходил свой HEAD, а loadWinners зовётся дважды (из init и по событию
// движка), поэтому запросы ещё и дублировались - в кэш клался результат, и
// второй заход стартовал раньше, чем возвращался первый. Теперь размечаем
// при первом открытии списка, а в кэше держим ОБЕЩАНИЕ, а не результат, -
// параллельные вызовы подхватывают уже летящий запрос.
var vfSnapCache = {};   // roundId -> Promise<bool>
var vfMarked    = false; // размечен ли текущий список

function vfSnapExists(roundId) {
  if (!vfSnapCache[roundId]) {
    vfSnapCache[roundId] = fetch('./rounds/' + roundId + '.json', { method: 'HEAD' })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; });
  }
  return vfSnapCache[roundId];
}

function vfMarkSnapshots(list) {
  if (vfMarked) return;
  vfMarked = true;
  list.forEach(function (w, i) {
    if (!w.roundId) return vfSetTag(i, false);
    vfSnapExists(w.roundId).then(function (ok) { vfSetTag(i, ok); });
  });
}

function vfSetTag(i, ok) {
  var el = document.querySelector('[data-tag="' + i + '"]');
  if (!el) return;
  el.textContent = ok ? 'replayable' : 'result only';
  el.className = 'vf-opt-tag' + (ok ? ' ok' : '');
}

function populateDrawVerifySelect() {
  var menu = document.getElementById('vf-menu');
  if (!menu) return;
  var list = vfRounds();
  menu.innerHTML = list.length
    ? list.map(function (w, i) { return vfRowHtml(w, i, false); }).join('')
    : '<div class="vf-opt-empty">No completed rounds yet.</div>';
  // Список перестроен - метки в разметке снова '...', значит размечать заново.
  // Пока выпадашка закрыта, запросы не шлём вовсе.
  vfMarked = false;
  if (vfPickerOpen) vfMarkSnapshots(list);
}

function vfToggle(force) {
  var menu = document.getElementById('vf-menu');
  var btn  = document.getElementById('vf-trigger');
  if (!menu || !btn) return;
  vfPickerOpen = (force === undefined) ? !vfPickerOpen : !!force;
  menu.style.display = vfPickerOpen ? 'block' : 'none';
  btn.classList.toggle('open', vfPickerOpen);
  btn.setAttribute('aria-expanded', vfPickerOpen ? 'true' : 'false');
  if (vfPickerOpen) vfMarkSnapshots(vfRounds());
}

function vfPick(i) {
  var w = vfRounds()[i];
  var lbl = document.getElementById('vf-trigger-label');
  if (w && lbl) {
    lbl.innerHTML =
      '<span class="vf-opt-chip ' + (w.type === 'daily' ? 'd' : w.type === 'circuit' ? 'c' : 'w') + '">' +
        (w.type === 'daily' ? 'Daily' : w.type === 'circuit' ? 'Circuit' : 'Weekly') + '</span>' +
      '<span class="vf-opt-id">' + (w.roundId || ('#' + w.round)) + '</span>' +
      '<span class="vf-opt-date">' + fmtDate(w.time) + '</span>';
  }
  var menu = document.getElementById('vf-menu');
  if (menu) {
    Array.prototype.forEach.call(menu.children, function (el) {
      if (el.classList) el.classList.toggle('active', el.dataset && String(el.dataset.i) === String(i));
    });
  }
  vfToggle(false);
  renderDrawVerify(i);
}

// Закрытие по клику мимо и по Escape - как ведёт себя родной select
document.addEventListener('click', function (e) {
  if (!vfPickerOpen) return;
  var box = document.getElementById('vf-picker');
  if (box && !box.contains(e.target)) vfToggle(false);
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && vfPickerOpen) vfToggle(false);
});

window.populateDrawVerifySelect = populateDrawVerifySelect;
window.vfToggle = vfToggle;
window.vfPick   = vfPick;
