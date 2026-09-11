import fs from 'fs';
import { selectZone, ownerOfZone } from './circuit-rule.js';

const files = fs.readdirSync('rounds').filter(f => f.startsWith('circuit_'));
let ok = 0, bad = 0, skip = 0;

for (const f of files) {
  const s = JSON.parse(fs.readFileSync('rounds/' + f, 'utf8'));
  const hash = s.block_hash, sold = s.sold ?? s.total_sold;
  const declared = s.winner_zone ?? s.winnerZone;
  if (!hash || !sold || declared === undefined) { skip++; console.log('пропуск ' + f); continue; }

  const got = selectZone(hash, sold);
  const owner = ownerOfZone(s.blocks || [], got);
  const wOk = !s.winner || !owner || owner.wallet === s.winner;

  if (got === declared && wOk) { ok++; }
  else { bad++; console.log('РАСХОЖДЕНИЕ ' + f + ': объявлено ' + declared + ', посчитано ' + got); }
}
console.log('совпало: ' + ok + ', разошлось: ' + bad + ', пропущено: ' + skip);
