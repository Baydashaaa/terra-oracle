// scripts/streak-payout.js
// Runs via GitHub Actions (streak-payout.yml)
// Pays streak milestone rewards from RESERVE wallet

import fetch from 'node-fetch';
import { LCDClient, MnemonicKey, MsgSend, Coins } from '@terra-money/feather.js';

const WORKER_URL     = process.env.WORKER_URL;
const ACTIONS_SECRET = process.env.ACTIONS_SECRET;
const MNEMONIC       = process.env.RESERVE_MNEMONIC;
const LCD_URL        = 'https://terra-classic-lcd.publicnode.com';
const CHAIN_ID       = 'columbus-5';

async function safeFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch(e) { clearTimeout(t); throw e; }
}

async function main() {
  console.log('🔥 Streak payout starting...');
  console.log(`📅 Date: ${new Date().toISOString()}`);

  if (!WORKER_URL || !ACTIONS_SECRET || !MNEMONIC) {
    console.error('❌ Missing env vars: WORKER_URL, ACTIONS_SECRET, or RESERVE_MNEMONIC');
    process.exit(1);
  }

  // 1. Fetch pending payouts
  const res = await safeFetch(`${WORKER_URL}/streak/pending-payouts?secret=${ACTIONS_SECRET}`);
  if (!res.ok) {
    console.error('❌ Failed to fetch payouts:', await res.text());
    process.exit(1);
  }
  const { payouts } = await res.json();

  if (!payouts || payouts.length === 0) {
    console.log('✅ No pending streak payouts.');
    return;
  }
  console.log(`📋 Found ${payouts.length} pending payout(s).`);

  // 2. Setup LCD + wallet
  const lcd = new LCDClient({
    [CHAIN_ID]: {
      lcd:           LCD_URL,
      chainID:       CHAIN_ID,
      gasAdjustment: 1.4,
      gasPrices:     { uluna: '28.325' },
      prefix:        'terra',
    },
  });

  const mk     = new MnemonicKey({ mnemonic: MNEMONIC });
  const wallet = lcd.wallet(mk);
  const sender = mk.accAddress(CHAIN_ID);
  console.log(`👛 Reserve wallet: ${sender}`);

  // 3. Check balance
  const balRes  = await safeFetch(`${LCD_URL}/cosmos/bank/v1beta1/balances/${sender}`);
  if (!balRes.ok) { console.error('❌ Failed to fetch balance'); process.exit(1); }
  const balData = await balRes.json();
  const balAmt  = parseInt(balData.balances?.find(b => b.denom === 'uluna')?.amount || '0');
  console.log(`💰 Reserve balance: ${(balAmt / 1e6).toFixed(3)} LUNC`);

  const totalNeeded = payouts.reduce((s, p) => s + (p.amount || 0), 0);
  console.log(`💸 Total needed: ${(totalNeeded / 1e6).toFixed(3)} LUNC`);

  if (balAmt < totalNeeded + 2_000_000) {
    console.error(`❌ Insufficient balance. Need ${(totalNeeded/1e6).toFixed(3)} LUNC + gas, have ${(balAmt/1e6).toFixed(3)} LUNC`);
    process.exit(1);
  }

  // 4. Process each payout
  let successCount = 0, failCount = 0;

  for (const payout of payouts) {
    try {
      console.log(`\n⏳ Processing: ${payout.wallet.slice(0,20)}... milestone=${payout.milestone} amount=${payout.amount/1e6} LUNC → ${payout.to}`);

      // FIX: amount must be a string for feather.js Coins
      const msg = new MsgSend(
        sender,
        payout.to,
        new Coins({ uluna: String(payout.amount) })
      );

      const tx = await wallet.createAndSignTx({
        msgs:    [msg],
        memo:    `streak:milestone:${payout.milestone}:${payout.wallet.slice(0, 16)}`,
        chainID: CHAIN_ID,
      });

      const result = await lcd.tx.broadcast(tx, CHAIN_ID);

      if (result.code && result.code !== 0) {
        console.error(`❌ Tx failed: code=${result.code} | ${result.raw_log}`);
        failCount++;
        continue;
      }

      console.log(`✅ Paid ${(payout.amount/1e6).toFixed(3)} LUNC → ${payout.to} | tx: ${result.txhash}`);

      // Mark as paid in Worker KV
      const markRes = await safeFetch(`${WORKER_URL}/streak/mark-paid`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key: payout.key, txHash: result.txhash, secret: ACTIONS_SECRET }),
      });
      if (!markRes.ok) {
        console.error(`⚠️ mark-paid failed for ${payout.key}:`, await markRes.text());
      } else {
        console.log(`📝 Marked as paid in KV.`);
      }

      successCount++;
      // Delay between txs to avoid sequence errors
      await new Promise(r => setTimeout(r, 3000));

    } catch(err) {
      console.error(`❌ Error for ${payout.wallet}: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n🎉 Streak payout complete! ✅ ${successCount} paid, ❌ ${failCount} failed.`);
}

main().catch(e => { console.error('💥 Fatal:', e); process.exit(1); });
