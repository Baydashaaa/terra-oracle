// scripts/rep-rewards.js
// Runs every Tuesday 20:00 UTC via GitHub Actions
// Pure HTTP - no cosmjs, no feather.js

import fetch from 'node-fetch';
import { createHash } from 'crypto';

const WORKER_URL     = process.env.WORKER_URL;
const ACTIONS_SECRET = process.env.ACTIONS_SECRET;
const MNEMONIC       = process.env.REWARDS_MNEMONIC;
const LCD_URL        = 'https://terra-classic-lcd.publicnode.com';
// Oracle Score - the source of truth for rank. Values are micro-units.
const ORACLE_SCORE_CONTRACT = 'terra1pj6t6v4czktz7znzq8xk2ny2yh7pdwen4jw8z4zz86zrac6ur9vqqkwcls';
const CHAIN_ID       = 'columbus-5';
const GAS_LIMIT      = 300000;
const GAS_PRICE      = 28.325;

// Rank multipliers (based on all-time REP).
// Capped at x1.5 on purpose: the payout share is ALREADY proportional to weekly
// REP, so a multiplier on top rewards the same seniority a second time. A low
// ceiling keeps veterans ahead without making the top unreachable for newcomers.
const RANKS = [
  { name: 'INITIATE',  minScore: 0,     multiplier: 1.0 },
  { name: 'SEEKER',    minScore: 100,   multiplier: 1.0 },
  { name: 'ADEPT',     minScore: 300,  multiplier: 1.1 },
  { name: 'ANALYST',   minScore: 800,  multiplier: 1.2 },
  { name: 'ORACLE',    minScore: 2000,  multiplier: 1.3 },
  { name: 'ARCHON',    minScore: 5000, multiplier: 1.4 },
  { name: 'ASCENDED',  minScore: 12000, multiplier: 1.5 },
];
function getRankMultiplier(allTimeRep) {
  let mult = 1.0;
  for (const r of RANKS) { if (allTimeRep >= r.minScore) mult = r.multiplier; }
  return mult;
}

// ── Налог на перевод ────────────────────────────────────────────────────────
// Ставка живёт в конфигурации цепочки и уже менялась: документация обещала
// 0,5%, а фактически удерживается 1,5%. Поэтому спрашиваем её, а не зашиваем.
// Ноль в ответе считаем неответом - налог по факту есть в каждой транзакции,
// значит ноль означает "не тот параметр", а не "налога нет".
const TAX_FALLBACK = 0.015;
let _taxRate = null;

async function taxRate() {
  if (_taxRate !== null) return _taxRate;
  try {
    const r = await safeFetch(`${LCD_URL}/terra/treasury/v1beta1/tax_rate`);
    if (r.ok) {
      const v = Number((await r.json())?.tax_rate);
      if (Number.isFinite(v) && v > 0 && v < 0.2) {
        _taxRate = v;
        console.log(`ставка налога с цепочки: ${(v * 100).toFixed(2)}%`);
        return v;
      }
    }
  } catch (e) {
    console.warn('не удалось прочитать ставку налога:', e.message);
  }
  console.warn(`ставка налога недоступна, беру запасную ${(TAX_FALLBACK * 100).toFixed(2)}%`);
  _taxRate = TAX_FALLBACK;
  return _taxRate;
}

async function safeFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch(e) { clearTimeout(t); throw e; }
}

async function deriveKeypair(mnemonic) {
  const { mnemonicToSeedSync } = await import('bip39');
  const { BIP32Factory } = await import('bip32');
  const ecc = await import('tiny-secp256k1');
  const bip32 = BIP32Factory(ecc.default || ecc);
  const seed  = mnemonicToSeedSync(mnemonic);
  const root  = bip32.fromSeed(seed);
  const child = root.derivePath("m/44'/330'/0'/0/0");
  return { privateKey: child.privateKey, publicKey: child.publicKey };
}

function bech32encode(prefix, words) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  function polymod(values) { let chk=1; for(const v of values){const top=chk>>25;chk=((chk&0x1ffffff)<<5)^v;for(let i=0;i<5;i++)if((top>>i)&1)chk^=gen[i];}return chk; }
  function hrpExpand(hrp) { const ret=[]; for(const c of hrp)ret.push(c.charCodeAt(0)>>5); ret.push(0); for(const c of hrp)ret.push(c.charCodeAt(0)&31); return ret; }
  const checksum = polymod([...hrpExpand(prefix),...words,0,0,0,0,0,0])^1;
  const cs=[]; for(let i=0;i<6;i++)cs.push((checksum>>(5*(5-i)))&31);
  return prefix+'1'+[...words,...cs].map(x=>CHARSET[x]).join('');
}
function convertbits(data, frombits, tobits, pad=true) {
  let acc=0,bits=0; const ret=[],maxv=(1<<tobits)-1;
  for(const v of data){acc=((acc<<frombits)|v)&0xffffffff;bits+=frombits;while(bits>=tobits){bits-=tobits;ret.push((acc>>bits)&maxv);}}
  if(pad&&bits>0)ret.push((acc<<(tobits-bits))&maxv);
  return ret;
}
function pubkeyToAddress(pubkey) {
  const sha256=createHash('sha256').update(pubkey).digest();
  const ripemd160=createHash('ripemd160').update(sha256).digest();
  return bech32encode('terra',convertbits(ripemd160,8,5));
}

function encodeVarint(n) { n=Number(n);const b=[];while(n>127){b.push((n&0x7f)|0x80);n=Math.floor(n/128);}b.push(n&0x7f);return Buffer.from(b); }
function encodeField(f,w,d) { const t=encodeVarint((f<<3)|w);if(w===2){const l=encodeVarint(d.length);return Buffer.concat([t,l,d]);}return t; }

async function sendTokens(privateKey, publicKey, fromAddr, toAddr, amountUluna, memo, accountNumber, sequence) {
  const enc = s => Buffer.from(s);
  const gasFee   = Math.ceil(GAS_LIMIT*GAS_PRICE);
  const taxFee   = Math.ceil(amountUluna * await taxRate());
  const totalFee = gasFee+taxFee;

  const coinP   = Buffer.concat([encodeField(1,2,enc('uluna')),encodeField(2,2,enc(String(amountUluna)))]);
  const msgSP   = Buffer.concat([encodeField(1,2,enc(fromAddr)),encodeField(2,2,enc(toAddr)),encodeField(3,2,coinP)]);
  const anyMsg  = Buffer.concat([encodeField(1,2,enc('/cosmos.bank.v1beta1.MsgSend')),encodeField(2,2,msgSP)]);
  const txBodyP = Buffer.concat([encodeField(1,2,anyMsg),encodeField(2,2,enc(memo||''))]);

  const pubkeyAny = Buffer.concat([encodeField(1,2,enc('/cosmos.crypto.secp256k1.PubKey')),encodeField(2,2,encodeField(1,2,publicKey))]);
  const modeInfoP = encodeField(1,2,Buffer.concat([encodeVarint((1<<3)|0),encodeVarint(1)]));
  const signerP   = Buffer.concat([encodeField(1,2,pubkeyAny),encodeField(2,2,modeInfoP),encodeVarint((3<<3)|0),encodeVarint(sequence)]);
  const feeCoinP  = Buffer.concat([encodeField(1,2,enc('uluna')),encodeField(2,2,enc(String(totalFee)))]);
  const feeP      = Buffer.concat([encodeField(1,2,feeCoinP),encodeVarint((2<<3)|0),encodeVarint(GAS_LIMIT)]);
  const authInfoP = Buffer.concat([encodeField(1,2,signerP),encodeField(2,2,feeP)]);

  const signDocP = Buffer.concat([
    encodeField(1,2,txBodyP), encodeField(2,2,authInfoP),
    encodeField(3,2,enc(CHAIN_ID)),
    encodeVarint((4<<3)|0), encodeVarint(accountNumber),
  ]);

  const eccMod = await import('tiny-secp256k1');
  const secp256k1 = eccMod.default || eccMod;
  const msgHash = createHash('sha256').update(signDocP).digest();
  const sig     = Buffer.from(secp256k1.sign(msgHash, privateKey));

  const txRawP = Buffer.concat([encodeField(1,2,txBodyP),encodeField(2,2,authInfoP),encodeField(3,2,sig)]);
  // Хеш - это sha256 от тех же байт, что уходят в сеть, поэтому он известен
  // ДО отправки. На этом и держится вся идемпотентность: записав хеш в
  // манифест заранее, после любого сбоя можно спросить у цепочки, что стало
  // с выплатой, вместо того чтобы платить вслепую второй раз.
  return { txBytes: txRawP.toString('base64'), txHash: createHash('sha256').update(txRawP).digest('hex').toUpperCase() };
}

// Секрет уходит заголовком, а не в адресе: URL целиком попадает в логи
// прокси и в историю команд, заголовок - нет.
function authHeaders() {
  return { 'Content-Type': 'application/json', 'X-Actions-Secret': ACTIONS_SECRET };
}

async function broadcastTx(txBytes) {
  const res  = await safeFetch(`${LCD_URL}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBytes, mode: 'BROADCAST_MODE_SYNC' }),
  });
  const data = await res.json();
  const code = data?.tx_response?.code ?? data?.code ?? 0;
  // Ненулевой код - отказ на приёме, в мемпул не попало. Включение в блок это
  // не подтверждает: за этим waitForTx.
  if (code !== 0) throw new Error('broadcast rejected: ' + (data?.tx_response?.raw_log || JSON.stringify(data)));
}

async function lookupTx(txHash) {
  try {
    const r = await safeFetch(`${LCD_URL}/cosmos/tx/v1beta1/txs/${txHash}`);
    if (r.status === 404) return 'missing';
    const resp = (await r.json())?.tx_response;
    if (!resp || !resp.height || resp.height === '0') return 'missing';
    return (resp.code ?? 0) === 0 ? 'ok' : 'failed';
  } catch { return 'missing'; }
}

async function waitForTx(txHash, tries = 20, delayMs = 4000) {
  for (let i = 0; i < tries; i++) {
    const st = await lookupTx(txHash);
    if (st !== 'missing') return st;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return 'missing';
}

// Идентификатор недели - дата последнего вторника по UTC, то есть дня запуска
// по расписанию. Ручной перезапуск в пределах той же недели попадёт в тот же
// манифест, а не создаст второй.
function payoutWeekId(d = new Date()) {
  const t = new Date(d.getTime() - 20 * 3600 * 1000);   // граница 20:00 UTC вторника
  const back = (t.getUTCDay() - 2 + 7) % 7;
  t.setUTCDate(t.getUTCDate() - back);
  return t.toISOString().slice(0, 10);
}

async function getManifest(week) {
  const r = await safeFetch(`${WORKER_URL}/rep/payout-manifest?week=${week}`, { headers: authHeaders() });
  if (!r.ok) throw new Error('manifest read failed: ' + (await r.text()).slice(0, 200));
  return (await r.json()).manifest;
}

async function createManifest(week, items) {
  const r = await safeFetch(`${WORKER_URL}/rep/payout-manifest`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ week, items }),
  });
  if (!r.ok) throw new Error('manifest create failed: ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  console.log(j.created ? '🧾 Манифест создан' : '🧾 Манифест уже существовал - работаю по нему');
  return j.manifest;
}

async function setItemStatus(week, wallet, status, txHash, note) {
  const r = await safeFetch(`${WORKER_URL}/rep/payout-status`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ week, wallet, status, txHash, note }),
  });
  if (!r.ok) throw new Error('payout-status failed: ' + (await r.text()).slice(0, 200));
}

async function main() {
  console.log('🏆 REP Rewards payout starting...');
  console.log(`📅 Date: ${new Date().toISOString()}`);

  if (!WORKER_URL||!ACTIONS_SECRET||!MNEMONIC) { console.error('❌ Missing env vars'); process.exit(1); }

  const res = await safeFetch(`${WORKER_URL}/rep/weekly-leaderboard`, { headers: authHeaders() });
  if (!res.ok) { console.error('❌ Failed to fetch leaderboard:', await res.text()); process.exit(1); }
  const data = await res.json();

  console.log(`📊 Participants: ${data.totalParticipants} / min ${data.minParticipants}`);
  if (!data.eligible) { console.log(`⏳ ROLLOVER - not enough participants.`); return; }
  console.log(`✅ Eligible! Top ${data.topWallets.length} wallets.`);

  const { privateKey, publicKey } = await deriveKeypair(MNEMONIC);
  const sender = pubkeyToAddress(publicKey);
  // Safety: same address check the treasury script does - refuse to pay out
  // from an unexpected wallet if the wrong mnemonic is configured.
  const EXPECTED_REWARDS_WALLET = 'terra1ty6fxd9u0jzae5lpzcs56rfclxg4q32hw5x4ce';
  if (sender !== EXPECTED_REWARDS_WALLET) throw new Error(`Address mismatch: mnemonic derives ${sender}, expected ${EXPECTED_REWARDS_WALLET}`);
  console.log(`👛 Rewards wallet: ${sender}`);

  const balRes  = await safeFetch(`${LCD_URL}/cosmos/bank/v1beta1/balances/${sender}`);
  const balData = await balRes.json();
  const balAmt  = parseInt(balData.balances?.find(b=>b.denom==='uluna')?.amount||'0');
  const GAS_RESERVE = Math.max(2_000_000, data.topWallets.length*500_000);
  const poolUluna   = Math.floor(balAmt-GAS_RESERVE);

  console.log(`💰 Balance:     ${(balAmt/1e6).toFixed(3)} LUNC`);
  console.log(`💰 Payout pool: ${(poolUluna/1e6).toFixed(3)} LUNC`);
  if (poolUluna<1_000_000) { console.log('⚠️ Pool too small.'); return; }

  // ── All-time REP for rank multipliers ──────────────────────────────────
  // Rank has to be the same number the site shows, and the site reads it from
  // the Oracle Score contract. Recomputing it here from the raw sources is how
  // this script would end up paying by one ranking while people see another -
  // the exact drift that put six copies of this formula out of step.
  //
  // The contract stores the base; the streak multiplier is a display rule the
  // frontend applies, so it is applied here too and nowhere else.
  console.log('\n📊 Reading all-time REP from the Oracle Score contract...');

  const allTimeRepMap = {};
  // Множитель стрика держим отдельно. Раньше он умножался на пожизненный REP
  // и уходил в выбор ранга - из-за чего не влиял ни на что, кроме редкого
  // случая у самой границы ранга, где перекидывал человека на ступень выше.
  // Ранг - это накопленная репутация, стрик к ней отношения не имеет.
  const streakMultMap = {};
  const missing = [];
  await Promise.all(data.topWallets.map(async w => {
    let base = null, streakMult = 1.0;
    try {
      const q = Buffer.from(JSON.stringify({ score: { address: w.wallet } })).toString('base64');
      const r = await safeFetch(`${LCD_URL}/cosmwasm/wasm/v1/contract/${ORACLE_SCORE_CONTRACT}/smart/${q}`);
      if (r.ok) {
        const d = (await r.json()).data;
        if (d && d.lifetime_earned) base = Math.round(Number(d.lifetime_earned) / 1e6);
      }
    } catch(e) {}
    try {
      const r = await safeFetch(`${WORKER_URL}/streak?wallet=${w.wallet}`);
      if (r.ok) streakMult = (await r.json()).multiplier || 1.0;
    } catch(e) {}

    if (base === null) { missing.push(w.wallet); base = 0; }
    allTimeRepMap[w.wallet] = base;
    streakMultMap[w.wallet] = streakMult;
  }));

  // A wallet the chain could not answer for falls to rank multiplier ×1.0,
  // which underpays rather than overpays. Say so loudly: a node hiccup quietly
  // costing someone their multiplier is worse than a failed run.
  if (missing.length) {
    console.error(`❌ No on-chain score for ${missing.length} wallet(s): ${missing.join(', ')}`);
    console.error('   Refusing to pay out on figures that may be wrong. Re-run when the node responds.');
    process.exit(1);
  }

  // Взвешенный REP = недельный REP × множитель ранга × множитель стрика.
  // Ранг берётся из чистого пожизненного счёта; стрик умножает долю, а не ранг.
  // Ровно эта формула описана в разделе Architecture и в reputation.js.
  const weighted = data.topWallets.map(w => {
    const rankMult   = getRankMultiplier(allTimeRepMap[w.wallet] || 0);
    const streakMult = streakMultMap[w.wallet] || 1.0;
    return {
      ...w,
      multiplier: rankMult,
      streakMultiplier: streakMult,
      weightedRep: w.rep * rankMult * streakMult,
    };
  });

  const totalWeighted = weighted.reduce((s, w) => s + w.weightedRep, 0);
  const payouts = weighted.map(w => ({
    wallet: w.wallet,
    rep: w.rep,
    multiplier: w.multiplier,
    streakMultiplier: w.streakMultiplier,
    weightedRep: w.weightedRep,
    share: w.weightedRep / totalWeighted,
    uluna: Math.floor((w.weightedRep / totalWeighted) * poolUluna),
  })).filter(p => p.uluna >= 1_000_000);

  console.log(`\n📤 Sending to ${payouts.length} wallets:`);
  payouts.forEach(p => console.log(
    `  ${p.wallet.slice(0,20)}... | ${p.rep} REP x${p.multiplier} rank x${p.streakMultiplier} streak ` +
    `= ${p.weightedRep.toFixed(1)} weighted (${(p.share*100).toFixed(1)}%) → ${(p.uluna/1e6).toFixed(3)} LUNC`
  ));

  const week = payoutWeekId();
  console.log(`\n🗓 Неделя выплат: ${week}`);

  // Манифест создаётся один раз. Если он уже есть - берём суммы оттуда и
  // НЕ пересчитываем: пересчёт от изменившегося баланса и есть тот самый
  // сценарий, в котором один лидерборд превращается в две разные раздачи.
  const manifest = await createManifest(week, payouts.map(p => ({
    wallet: p.wallet, uluna: p.uluna, rep: p.rep, multiplier: p.multiplier,
  })));

  // Сверка зависших с прошлого запуска - до отправки чего-либо нового.
  const inflight = manifest.items.filter(i => i.status === 'inflight' && i.txHash);
  if (inflight.length) {
    console.log(`🔍 Сверяю ${inflight.length} зависших...`);
    for (const it of inflight) {
      const st = await lookupTx(it.txHash);
      if (st === 'ok') {
        await setItemStatus(week, it.wallet, 'paid', it.txHash);
        it.status = 'paid';
        console.log(`  ✅ ${it.txHash.slice(0,12)} в блоке - помечена оплаченной`);
      } else if (st === 'failed') {
        await setItemStatus(week, it.wallet, 'pending', it.txHash, 'tx failed on chain');
        it.status = 'pending';
        console.log(`  ↩️ ${it.txHash.slice(0,12)} завершилась ошибкой - вернул в очередь`);
      } else {
        const age = Date.now() - new Date(it.statusAt || 0).getTime();
        if (age > 30 * 60 * 1000) {
          await setItemStatus(week, it.wallet, 'pending', it.txHash, 'tx never landed');
          it.status = 'pending';
          console.log(`  ↩️ ${it.txHash.slice(0,12)} не найдена - вернул в очередь`);
        } else {
          console.log(`  ⏳ ${it.txHash.slice(0,12)} ещё не видна, оставляю`);
        }
      }
    }
  }

  const todo = manifest.items.filter(i => i.status !== 'paid');
  if (!todo.length) { console.log('✅ Все выплаты этой недели уже прошли.'); return; }
  console.log(`📤 К отправке: ${todo.length} из ${manifest.items.length}`);

  let successCount=0, failCount=0;

  // Read account ONCE; increment sequence manually per tx (SYNC broadcast
  // returns before the node updates sequence, so re-reading between fast
  // sends gives a stale value → "account sequence mismatch").
  const accRes = await safeFetch(`${LCD_URL}/cosmos/auth/v1beta1/accounts/${sender}`);
  const acct   = (await accRes.json())?.account || {};
  const accountNumber = parseInt(acct.account_number || '0');
  let   sequence      = parseInt(acct.sequence || '0');

  for (const payout of todo) {
    try {
      const { txBytes, txHash } = await sendTokens(privateKey, publicKey, sender, payout.wallet, payout.uluna, `rep-rewards:${week}`, accountNumber, sequence);

      // Хеш в манифест ДО отправки. Умрём на любом следующем шаге - позиция
      // останется inflight, и сверка спросит цепочку вместо повторной выплаты.
      await setItemStatus(week, payout.wallet, 'inflight', txHash);

      await broadcastTx(txBytes);
      sequence++;   // номер израсходован даже при неудаче в блоке
      console.log(`📡 ${(payout.uluna/1e6).toFixed(3)} LUNC → ${payout.wallet.slice(0,20)}... | tx: ${txHash}`);

      const st = await waitForTx(txHash);
      if (st === 'ok') {
        await setItemStatus(week, payout.wallet, 'paid', txHash);
        console.log(`  ✅ в блоке`);
        successCount++;
      } else if (st === 'failed') {
        await setItemStatus(week, payout.wallet, 'pending', txHash, 'tx failed on chain');
        console.error(`  ❌ завершилась ошибкой - вернул в очередь`);
        failCount++;
      } else {
        console.error(`  ⚠️ не появилась в блоке за отведённое время - оставил inflight`);
        failCount++;
      }
      await new Promise(r=>setTimeout(r,3000));
    } catch(err) {
      console.error(`❌ Error for ${payout.wallet}: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n🎉 Done! ✅ ${successCount} paid, ❌ ${failCount} failed.`);
}

main().catch(e=>{ console.error('💥 Fatal:', e); process.exit(1); });
