// scripts/rep-rewards.js
// Runs every Tuesday 20:00 UTC via GitHub Actions
// Pays REP rewards to top 20% contributors from REP Rewards wallet

import fetch from 'node-fetch';
import { LCDClient, MnemonicKey, MsgSend, Coins } from '@terra-money/feather.js';

const WORKER_URL     = process.env.WORKER_URL;
const ACTIONS_SECRET = process.env.ACTIONS_SECRET;
const MNEMONIC       = process.env.REWARDS_MNEMONIC;
const REWARDS_WALLET = 'terra1ty6fxd9u0jzae5lpzcs56rfclxg4q32hw5x4ce';
const LCD_URL        = 'https://terra-classic-lcd.publicnode.com';
const CHAIN_ID       = 'columbus-5';

async function safeFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch(e) {
    clearTimeout(t);
    throw e;
  }
}

async function main() {
  console.log('🏆 REP Rewards payout starting...');
  console.log(`📅 Date: ${new Date().toISOString()}`);

  if (!WORKER_URL || !ACTIONS_SECRET || !MNEMONIC) {
    console.error('❌ Missing env vars: WORKER_URL, ACTIONS_SECRET, or REWARDS_MNEMONIC');
    process.exit(1);
  }

  // 1. Fetch weekly leaderboard
  const res = await safeFetch(`${WORKER_URL}/rep/weekly-leaderboard?secret=${ACTIONS_SECRET}`);
  if (!res.ok) {
    console.error('❌ Failed to fetch leaderboard:', await res.text());
    process.exit(1);
  }
  const data = await res.json();

  console.log(`📊 Participants this week: ${data.totalParticipants}`);
  console.log(`📊 Min required:           ${data.minParticipants}`);
  console.log(`📊 Top 20% count:          ${data.topCount}`);
  console.log(`📊 Cut-off date:           ${data.cutoffDate}`);

  if (!data.eligible) {
    console.log(`⏳ ROLLOVER — not enough participants (${data.totalParticipants}/${data.minParticipants}). Pool carries over to next week.`);
    return;
  }

  if (!data.topWallets || data.topWallets.length === 0) {
    console.log('⚠️ No top wallets returned. Skipping.');
    return;
  }

  console.log(`✅ Eligible! Paying top ${data.topWallets.length} wallets.`);

  // 2. Setup LCD + wallet
  const lcd = new LCDClient({
    [CHAIN_ID]: {
      lcd:          LCD_URL,
      chainID:      CHAIN_ID,
      gasAdjustment: 1.4,
      gasPrices:    { uluna: '28.325' },
      prefix:       'terra',
    },
  });

  const mk     = new MnemonicKey({ mnemonic: MNEMONIC });
  const wallet = lcd.wallet(mk);
  const sender = mk.accAddress(CHAIN_ID);

  console.log(`👛 Rewards wallet: ${sender}`);
  if (sender !== REWARDS_WALLET) {
    console.warn(`⚠️ Derived address ${sender} !== expected ${REWARDS_WALLET}`);
  }

  // 3. Get rewards wallet balance
  const balRes  = await safeFetch(`${LCD_URL}/cosmos/bank/v1beta1/balances/${sender}`);
  if (!balRes.ok) { console.error('❌ Failed to fetch balance'); process.exit(1); }
  const balData = await balRes.json();
  const balAmt  = parseInt(balData.balances?.find(b => b.denom === 'uluna')?.amount || '0');

  // Reserve gas: 500_000 uluna per tx + flat buffer
  const GAS_RESERVE = Math.max(2_000_000, data.topWallets.length * 500_000);
  const poolUluna   = Math.floor(balAmt - GAS_RESERVE);

  console.log(`💰 Balance:       ${(balAmt / 1e6).toFixed(3)} LUNC`);
  console.log(`⛽ Gas reserve:   ${(GAS_RESERVE / 1e6).toFixed(3)} LUNC`);
  console.log(`💰 Payout pool:   ${(poolUluna / 1e6).toFixed(3)} LUNC`);

  if (poolUluna < 1_000_000) {
    console.log('⚠️ Pool too small (< 1 LUNC). Skipping payout.');
    return;
  }

  // 4. Calculate proportional payouts based on REP share
  const totalRep = data.topWallets.reduce((s, w) => s + w.rep, 0);

  if (totalRep === 0) {
    console.log('⚠️ Total REP is 0. Skipping.');
    return;
  }

  const payouts = data.topWallets.map(w => ({
    wallet: w.wallet,
    rep:    w.rep,
    share:  w.rep / totalRep,
    uluna:  Math.floor((w.rep / totalRep) * poolUluna),
  })).filter(p => p.uluna >= 1_000_000); // min 1 LUNC

  const totalPaying = payouts.reduce((s, p) => s + p.uluna, 0);
  console.log(`\n📤 Sending to ${payouts.length} wallets (total: ${(totalPaying/1e6).toFixed(3)} LUNC):`);
  payouts.forEach(p =>
    console.log(`  ${p.wallet.slice(0,20)}... | ${p.rep} REP (${(p.share*100).toFixed(1)}%) → ${(p.uluna/1e6).toFixed(3)} LUNC`)
  );

  // 5. Send payouts one by one
  const week = new Date().toISOString().slice(0, 10);
  let successCount = 0, failCount = 0;

  for (const payout of payouts) {
    try {
      const msg = new MsgSend(
        sender,
        payout.wallet,
        new Coins({ uluna: String(payout.uluna) })
      );
      const tx = await wallet.createAndSignTx({
        msgs: [msg],
        memo: `rep-rewards:${week}`,
        chainID: CHAIN_ID,
      });
      const result = await lcd.tx.broadcast(tx, CHAIN_ID);

      if (result.code && result.code !== 0) {
        console.error(`❌ Tx failed for ${payout.wallet}: code=${result.code} | ${result.raw_log}`);
        failCount++;
        continue;
      }
      console.log(`✅ ${(payout.uluna/1e6).toFixed(3)} LUNC → ${payout.wallet.slice(0,20)}... | tx: ${result.txhash}`);
      successCount++;

      // Small delay between txs to avoid sequence errors
      await new Promise(r => setTimeout(r, 3000));

    } catch(err) {
      console.error(`❌ Error for ${payout.wallet}: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n🎉 REP Rewards complete! ✅ ${successCount} paid, ❌ ${failCount} failed.`);
}

main().catch(e => { console.error('💥 Fatal:', e); process.exit(1); });
