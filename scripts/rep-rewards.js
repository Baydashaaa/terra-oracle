// scripts/rep-rewards.js
// Runs every Tuesday 20:00 UTC via GitHub Actions
// Pure HTTP — no cosmjs, no feather.js

import fetch from 'node-fetch';
import { createHash } from 'crypto';

const WORKER_URL     = process.env.WORKER_URL;
const ACTIONS_SECRET = process.env.ACTIONS_SECRET;
const MNEMONIC       = process.env.REWARDS_MNEMONIC;
const LCD_URL        = 'https://terra-classic-lcd.publicnode.com';
const CHAIN_ID       = 'columbus-5';
const GAS_LIMIT      = 300000;
const GAS_PRICE      = 28.325;

// Rank multipliers (based on all-time REP)
const RANKS = [
  { name: 'INITIATE',  minScore: 0,     multiplier: 1.0 },
  { name: 'SEEKER',    minScore: 500,   multiplier: 1.0 },
  { name: 'ADEPT',     minScore: 1500,  multiplier: 1.2 },
  { name: 'ANALYST',   minScore: 4000,  multiplier: 1.5 },
  { name: 'ORACLE',    minScore: 8000,  multiplier: 2.0 },
  { name: 'ARCHON',    minScore: 15000, multiplier: 2.5 },
  { name: 'ASCENDED',  minScore: 30000, multiplier: 3.0 },
];
function getRankMultiplier(allTimeRep) {
  let mult = 1.0;
  for (const r of RANKS) { if (allTimeRep >= r.minScore) mult = r.multiplier; }
  return mult;
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
  const taxFee   = Math.ceil(amountUluna*0.005);
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
  const res    = await safeFetch(`${LCD_URL}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txRawP.toString('base64'), mode: 'BROADCAST_MODE_SYNC' }),
  });
  const data   = await res.json();
  const txHash = data?.tx_response?.txhash||data?.txhash;
  const code   = data?.tx_response?.code??data?.code??0;
  if(code!==0) throw new Error('TX failed: '+(data?.tx_response?.raw_log||JSON.stringify(data)));
  return txHash;
}

async function main() {
  console.log('🏆 REP Rewards payout starting...');
  console.log(`📅 Date: ${new Date().toISOString()}`);

  if (!WORKER_URL||!ACTIONS_SECRET||!MNEMONIC) { console.error('❌ Missing env vars'); process.exit(1); }

  const res = await safeFetch(`${WORKER_URL}/rep/weekly-leaderboard?secret=${ACTIONS_SECRET}`);
  if (!res.ok) { console.error('❌ Failed to fetch leaderboard:', await res.text()); process.exit(1); }
  const data = await res.json();

  console.log(`📊 Participants: ${data.totalParticipants} / min ${data.minParticipants}`);
  if (!data.eligible) { console.log(`⏳ ROLLOVER — not enough participants.`); return; }
  console.log(`✅ Eligible! Top ${data.topWallets.length} wallets.`);

  const { privateKey, publicKey } = await deriveKeypair(MNEMONIC);
  const sender = pubkeyToAddress(publicKey);
  // Safety: same address check the treasury script does — refuse to pay out
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
  // Rank must be computed on the SAME number the site shows: full all-time
  // REP (Q&A + chat + draw) × streak multiplier ("effective REP", see the
  // canonical rules in profile.js). Previously only draw-REP was used here,
  // which under-ranked active Q&A/chat users and under-paid them.
  console.log('\n📊 Building all-time REP map (Q&A + chat + draw, × streak)...');

  // One /questions fetch covers Q&A REP for everyone (40/answer 15/upvote 10)
  const qaRep = {};
  try {
    const qRes = await safeFetch(`${WORKER_URL}/questions`);
    if (qRes.ok) {
      const qData = await qRes.json();
      for (const q of qData.questions || []) {
        if (q.wallet) qaRep[q.wallet] = (qaRep[q.wallet] || 0) + 40;
        for (const a of q.answers || []) {
          if (a.wallet) qaRep[a.wallet] = (qaRep[a.wallet] || 0) + 15 + (a.votes || 0) * 10;
        }
      }
    }
  } catch(e) { console.warn('⚠️ Q&A fetch failed (Q&A REP counted as 0):', e.message); }

  const allTimeRepMap = {};
  await Promise.all(data.topWallets.map(async w => {
    let draw = 0, chat = 0, streakMult = 1.0;
    try {
      const r = await safeFetch(`${WORKER_URL}/rep/draw?wallet=${w.wallet}`);
      if (r.ok) draw = (await r.json()).total || 0;
    } catch(e) {}
    try {
      const r = await safeFetch(`${WORKER_URL}/chat/count?wallet=${w.wallet}`);
      if (r.ok) { const d = await r.json(); chat = (d.msgCount || d.total || 0) * 5; }
    } catch(e) {}
    try {
      const r = await safeFetch(`${WORKER_URL}/streak?wallet=${w.wallet}`);
      if (r.ok) streakMult = (await r.json()).multiplier || 1.0;
    } catch(e) {}
    const base = (qaRep[w.wallet] || 0) + chat + draw;
    allTimeRepMap[w.wallet] = Math.round(base * streakMult); // effective REP — same as site rank
  }));

  // Weighted REP = weekly REP × rank multiplier (rank based on all-time REP)
  const weighted = data.topWallets.map(w => {
    const allTimeRep = allTimeRepMap[w.wallet] || 0;
    const mult = getRankMultiplier(allTimeRep);
    return { ...w, multiplier: mult, weightedRep: w.rep * mult };
  });

  const totalWeighted = weighted.reduce((s, w) => s + w.weightedRep, 0);
  const payouts = weighted.map(w => ({
    wallet: w.wallet,
    rep: w.rep,
    multiplier: w.multiplier,
    weightedRep: w.weightedRep,
    share: w.weightedRep / totalWeighted,
    uluna: Math.floor((w.weightedRep / totalWeighted) * poolUluna),
  })).filter(p => p.uluna >= 1_000_000);

  console.log(`\n📤 Sending to ${payouts.length} wallets:`);
  payouts.forEach(p => console.log(
    `  ${p.wallet.slice(0,20)}... | ${p.rep} REP x${p.multiplier} = ${p.weightedRep} weighted (${(p.share*100).toFixed(1)}%) → ${(p.uluna/1e6).toFixed(3)} LUNC`
  ));

  let successCount=0, failCount=0;
  const week = new Date().toISOString().slice(0,10);

  // Read account ONCE; increment sequence manually per tx (SYNC broadcast
  // returns before the node updates sequence, so re-reading between fast
  // sends gives a stale value → "account sequence mismatch").
  const accRes = await safeFetch(`${LCD_URL}/cosmos/auth/v1beta1/accounts/${sender}`);
  const acct   = (await accRes.json())?.account || {};
  const accountNumber = parseInt(acct.account_number || '0');
  let   sequence      = parseInt(acct.sequence || '0');

  for (const payout of payouts) {
    try {
      const txHash = await sendTokens(privateKey, publicKey, sender, payout.wallet, payout.uluna, `rep-rewards:${week}`, accountNumber, sequence);
      console.log(`✅ ${(payout.uluna/1e6).toFixed(3)} LUNC → ${payout.wallet.slice(0,20)}... | tx: ${txHash}`);
      successCount++;
      sequence++;   // advance only on success
      await new Promise(r=>setTimeout(r,3000));
    } catch(err) {
      console.error(`❌ Error for ${payout.wallet}: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n🎉 Done! ✅ ${successCount} paid, ❌ ${failCount} failed.`);
}

main().catch(e=>{ console.error('💥 Fatal:', e); process.exit(1); });
