// ─── TREASURY DISTRIBUTION SCRIPT ───────────────────────────
// Pure HTTP + bip39/bip32/tiny-secp256k1 — no cosmjs, no feather.js
// Distributes Protocol Treasury balance to 4 wallets:
//   25% → REWARDS_WALLET   (REP weekly rewards)
//   15% → RESERVE_WALLET   (protocol stability buffer)
//   50% → LIQUIDITY_WALLET (manual liquidity provision)
//   10% → DEV_WALLET        (development & operations)

import fetch from 'node-fetch';
import { createHash } from 'crypto';

const WALLETS = {
  treasury:  'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt',
  rewards:   'terra1ty6fxd9u0jzae5lpzcs56rfclxg4q32hw5x4ce',
  reserve:   'terra10q6syec2e27x8g76a0mvm3frgvarl5dz27a2jz',
  liquidity: 'terra1gukarslv6c8n0s2259822l7059putpqxz405su',
  dev:       'terra17g55uzkm6cr5fcl3vzcrmu73v8as4yvf2kktzr',
};
const DISTRIBUTION = { rewards: 0.25, reserve: 0.15, liquidity: 0.50, dev: 0.10 };
const LCD_URL     = 'https://terra-classic-lcd.publicnode.com';
const CHAIN_ID    = 'columbus-5';
const GAS_LIMIT   = 300000;
const GAS_PRICE   = 28.325;
const GAS_RESERVE = 500_000_000n;
const MIN_BALANCE = 100_000_000_000n;
// Налог на перевод берётся СВЕРХ суммы и растёт вместе с ней. Раньше он не
// учитывался вовсе: раздавался весь остаток за вычетом фиксированных 500 LUNC,
// и на последний перевод денег не хватало. Пять выплат разработке подряд
// упали именно так.
const TAX_RATE = 0.005;

async function safeFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try { const res = await fetch(url, { ...opts, signal: ctrl.signal }); clearTimeout(t); return res; }
  catch(e) { clearTimeout(t); throw e; }
}

async function deriveKeypair(mnemonic) {
  const { mnemonicToSeedSync } = await import('bip39');
  const { BIP32Factory } = await import('bip32');
  const ecc = await import('tiny-secp256k1');
  const bip32 = BIP32Factory(ecc.default || ecc);
  const seed = mnemonicToSeedSync(mnemonic);
  const child = bip32.fromSeed(seed).derivePath("m/44'/330'/0'/0/0");
  return { privateKey: child.privateKey, publicKey: child.publicKey };
}

function bech32encode(prefix, words) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  function polymod(v) { let c=1; for(const x of v){const t=c>>25;c=((c&0x1ffffff)<<5)^x;for(let i=0;i<5;i++)if((t>>i)&1)c^=gen[i];}return c; }
  function expand(h) { const r=[]; for(const c of h)r.push(c.charCodeAt(0)>>5); r.push(0); for(const c of h)r.push(c.charCodeAt(0)&31); return r; }
  const cs=[]; const chk=polymod([...expand(prefix),...words,0,0,0,0,0,0])^1;
  for(let i=0;i<6;i++)cs.push((chk>>(5*(5-i)))&31);
  return prefix+'1'+[...words,...cs].map(x=>CHARSET[x]).join('');
}
function convertbits(data,fb,tb,pad=true){let a=0,b=0;const r=[],m=(1<<tb)-1;for(const v of data){a=((a<<fb)|v)&0xffffffff;b+=fb;while(b>=tb){b-=tb;r.push((a>>b)&m);}}if(pad&&b>0)r.push((a<<(tb-b))&m);return r;}
function pubkeyToAddress(pk) { const s=createHash('sha256').update(pk).digest(),r=createHash('ripemd160').update(s).digest(); return bech32encode('terra',convertbits(r,8,5)); }

function encodeVarint(n) { n=Number(n);const b=[];while(n>127){b.push((n&0x7f)|0x80);n=Math.floor(n/128);}b.push(n&0x7f);return Buffer.from(b); }
function encodeField(f,w,d) { const t=encodeVarint((f<<3)|w);if(w===2){return Buffer.concat([t,encodeVarint(d.length),d]);}return t; }

async function sendTokens(privateKey, publicKey, fromAddr, toAddr, amountUluna, memo, accountNumber, sequence) {
  const enc = s => Buffer.from(s);
  const totalFee = Math.ceil(GAS_LIMIT*GAS_PRICE) + Math.ceil(Number(amountUluna)*0.005);

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
  const signDocP  = Buffer.concat([encodeField(1,2,txBodyP),encodeField(2,2,authInfoP),encodeField(3,2,enc(CHAIN_ID)),encodeVarint((4<<3)|0),encodeVarint(accountNumber)]);

  const eccMod = await import('tiny-secp256k1');
  const secp256k1 = eccMod.default || eccMod;
  const sig = Buffer.from(secp256k1.sign(createHash('sha256').update(signDocP).digest(), privateKey));
  const txRawP = Buffer.concat([encodeField(1,2,txBodyP),encodeField(2,2,authInfoP),encodeField(3,2,sig)]);

  const res  = await safeFetch(`${LCD_URL}/cosmos/tx/v1beta1/txs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txRawP.toString('base64'), mode: 'BROADCAST_MODE_SYNC' }),
  });
  const data = await res.json();
  const code = data?.tx_response?.code ?? data?.code ?? 0;
  if (code !== 0) throw new Error('TX failed: ' + (data?.tx_response?.raw_log || JSON.stringify(data)));
  return data?.tx_response?.txhash || data?.txhash;
}

async function run() {
  // Холостой прогон: доходим до полного плана и останавливаемся перед
  // отправкой. Параметр в воркфлоу был объявлен, но не передавался и не
  // читался — кнопка была, поведения за ней не было.
  const DRY = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');

  const mnemonic = process.env.TREASURY_MNEMONIC;
  if (!mnemonic && !DRY) throw new Error('TREASURY_MNEMONIC not set');

  console.log('=== Treasury Distribution ===');
  console.log(`Date: ${new Date().toISOString()}`);

  const balRes  = await safeFetch(`${LCD_URL}/cosmos/bank/v1beta1/balances/${WALLETS.treasury}`);
  const balData = await balRes.json();
  const balance = BigInt(balData.balances?.find(b=>b.denom==='uluna')?.amount||'0');
  console.log(`Balance: ${(Number(balance)/1_000_000).toLocaleString()} LUNC`);

  if (balance < MIN_BALANCE) { console.log('Below minimum (100,000 LUNC). Skipping.'); process.exit(0); }

  // Сколько можно раздать, чтобы хватило на всё.
  //
  // Расход = сумма переводов + налог 0.5% с каждого + газ за четыре штуки.
  // Отсюда: distributable × 1.005 + 4×газ + запас ≤ balance.
  //
  // Раньше здесь стояло `balance - GAS_RESERVE`, то есть налог не учитывался
  // совсем, и последний перевод в очереди всегда оставался без покрытия.
  const gasFee = Math.ceil(GAS_LIMIT * GAS_PRICE);
  const budget = Number(balance) - 4 * gasFee - Number(GAS_RESERVE);
  const distributable = Math.floor(budget / (1 + TAX_RATE));
  if (distributable <= 0) throw new Error('Balance too small to cover fees');

  // Порядок — от мелкой доли к крупной. Если денег всё же не хватит, не
  // пройдёт наименьшая, а не десять процентов бюджета разработки.
  const ORDER = ['dev', 'reserve', 'rewards', 'liquidity'];

  const amounts = {};
  let assigned = 0;
  for (const key of ORDER.slice(0, -1)) {
    amounts[key] = Math.floor(distributable * DISTRIBUTION[key]);
    assigned += amounts[key];
  }
  // Крупнейшей доле — остаток: так округления никуда не пропадают
  amounts[ORDER[ORDER.length - 1]] = distributable - assigned;

  const planTax = Object.values(amounts).reduce((s, x) => s + Math.ceil(x * TAX_RATE), 0);
  const planSpend = Object.values(amounts).reduce((s, x) => s + x, 0) + planTax + 4 * gasFee;

  console.log(DRY ? '\n=== DRY RUN — nothing will be sent ===\nPlan:' : '\nPlan:');
  for (const [key, amt] of Object.entries(amounts)) {
    console.log(`  ${key.padEnd(12)} ${DISTRIBUTION[key]*100}%  →  ${(amt/1_000_000).toLocaleString()} LUNC  →  ${WALLETS[key]}`);
  }
  const L = n => (n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 });
  console.log(`\n  distributable ${L(distributable)} LUNC`);
  console.log(`  transfer tax  ${L(planTax)} LUNC  (0.5% of each transfer)`);
  console.log(`  gas           ${L(4 * gasFee)} LUNC  (4 × ${L(gasFee)})`);
  console.log(`  total spend   ${L(planSpend)} LUNC of ${L(Number(balance))} LUNC`);
  console.log(`  left on wallet ${L(Number(balance) - planSpend)} LUNC`);

  // Адрес подписанта сверяем и в холостом прогоне: несовпадение мнемоники —
  // ровно та ошибка, которую хочется поймать заранее, а не в среду.
  let privateKey = null, publicKey = null, sender = null;
  if (mnemonic) {
    ({ privateKey, publicKey } = await deriveKeypair(mnemonic));
    sender = pubkeyToAddress(publicKey);
    if (sender !== WALLETS.treasury) throw new Error(`Address mismatch: got ${sender}`);
    console.log(`\nSigner: ${sender}`);
  } else {
    console.log('\nSigner: (no mnemonic — signature check skipped)');
  }

  if (DRY) {
    console.log('\n=== DRY RUN — nothing sent ===');
    process.exit(0);
  }

  // Fetch account ONCE up front. sendTokens needs accountNumber + sequence;
  // we increment sequence manually per tx (BROADCAST_MODE_SYNC returns before
  // the node updates sequence, so re-reading it between sends is unreliable).
  const accRes = await safeFetch(`${LCD_URL}/cosmos/auth/v1beta1/accounts/${sender}`);
  const acct   = (await accRes.json())?.account || {};
  const accountNumber = parseInt(acct.account_number || '0');
  let   sequence      = parseInt(acct.sequence || '0');
  console.log(`Account #${accountNumber}, starting sequence ${sequence}`);

  let ok = 0;
  const failed = [];
  for (const key of ORDER) {
    const to = WALLETS[key];
    const amount = amounts[key];
    if (!amount || amount <= 0) continue;
    console.log(`\nSending ${(amount/1_000_000).toLocaleString()} LUNC → ${key} (seq ${sequence})...`);
    try {
      const txHash = await sendTokens(privateKey, publicKey, sender, to, amount, `Treasury: ${key} ${DISTRIBUTION[key]*100}%`, accountNumber, sequence);
      console.log(`  OK: ${txHash}`);
      ok++;
      sequence++;   // advance for next tx (only on success)
    } catch(e) {
      console.error(`  FAILED: ${e.message}`);
      failed.push(`${key}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 6000));
  }
  console.log(`\n=== Done: ${ok}/4 successful ===`);

  // Раньше здесь скрипт молча заканчивался успехом даже при провалах, и
  // Actions три месяца показывал зелёные галочки поверх непрошедших выплат
  // разработке. Теперь неудача видна сразу.
  if (failed.length) {
    console.error(`\n${failed.length} transfer(s) failed:`);
    for (const f of failed) console.error('  ' + f);
    process.exit(1);
  }
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
