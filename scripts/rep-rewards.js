// scripts/rep-rewards.js
// Runs every Tuesday 20:00 UTC via GitHub Actions

import fetch from 'node-fetch';

const WORKER_URL     = process.env.WORKER_URL;
const ACTIONS_SECRET = process.env.ACTIONS_SECRET;
const MNEMONIC       = process.env.REWARDS_MNEMONIC;
const REWARDS_WALLET = 'terra1ty6fxd9u0jzae5lpzcs56rfclxg4q32hw5x4ce';
const LCD_URL        = 'https://terra-classic-lcd.publicnode.com';
const RPC_URL        = 'wss://terra-classic-rpc.publicnode.com:443';

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
  console.log('🏆 REP Rewards payout starting...');
  console.log(`📅 Date: ${new Date().toISOString()}`);

  if (!WORKER_URL || !ACTIONS_SECRET || !MNEMONIC) {
    console.error('❌ Missing env vars');
    process.exit(1);
  }

  // 1. Fetch weekly leaderboard
  const res = await safeFetch(`${WORKER_URL}/rep/weekly-leaderboard?secret=${ACTIONS_SECRET}`);
  if (!res.ok) { console.error('❌ Failed to fetch leaderboard:', await res.text()); process.exit(1); }
  const data = await res.json();

  console.log(`📊 Participants: ${data.totalParticipants} / min ${data.minParticipants}`);

  if (!data.eligible) {
    console.log(`⏳ ROLLOVER — not enough participants. Pool carries over.`);
    return;
  }
  console.log(`✅ Eligible! Top ${data.topWallets.length} wallets.`);

  // 2. Setup wallet
  const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, {
    prefix: 'terra',
    hdPaths: ["m/44'/330'/0'/0/0"],
  });
  const [account] = await wallet.getAccounts();
  const sender = account.address;
  console.log(`👛 Rewards wallet: ${sender}`);

  // 3. Get balance
  const balRes  = await safeFetch(`${LCD_URL}/cosmos/bank/v1beta1/balances/${sender}`);
  const balData = await balRes.json();
  const balAmt  = parseInt(balData.balances?.find(b => b.denom === 'uluna')?.amount || '0');
  const GAS_RESERVE = Math.max(2_000_000, data.topWallets.length * 500_000);
  const poolUluna   = Math.floor(balAmt - GAS_RESERVE);

  console.log(`💰 Balance:     ${(balAmt / 1e6).toFixed(3)} LUNC`);
  console.log(`💰 Payout pool: ${(poolUluna / 1e6).toFixed(3)} LUNC`);

  if (poolUluna < 1_000_000) {
    console.log('⚠️ Pool too small. Skipping.');
    return;
  }

  // 4. Calculate payouts
  const totalRep = data.topWallets.reduce((s, w) => s + w.rep, 0);
  const payouts = data.topWallets.map(w => ({
    wallet: w.wallet,
    rep:    w.rep,
    share:  w.rep / totalRep,
    uluna:  Math.floor((w.rep / totalRep) * poolUluna),
  })).filter(p => p.uluna >= 1_000_000);

  console.log(`\n📤 Sending to ${payouts.length} wallets:`);
  payouts.forEach(p =>
    console.log(`  ${p.wallet.slice(0,20)}... | ${p.rep} REP (${(p.share*100).toFixed(1)}%) → ${(p.uluna/1e6).toFixed(3)} LUNC`)
  );

  // 5. Setup stargate client
  const { SigningStargateClient } = await import('@cosmjs/stargate');
  const client = await SigningStargateClient.connectWithSigner(RPC_URL, wallet, {
    gasPrice: '28.325uluna',
  });

  let successCount = 0, failCount = 0;
  const week = new Date().toISOString().slice(0, 10);

  for (const payout of payouts) {
    try {
      const result = await client.sendTokens(
        sender,
        payout.wallet,
        [{ denom: 'uluna', amount: String(payout.uluna) }],
        { amount: [{ denom: 'uluna', amount: '500000' }], gas: '200000' },
        `rep-rewards:${week}`
      );

      if (result.code !== 0) {
        console.error(`❌ Tx failed: code=${result.code}`);
        failCount++;
        continue;
      }
      console.log(`✅ ${(payout.uluna/1e6).toFixed(3)} LUNC → ${payout.wallet.slice(0,20)}... | tx: ${result.transactionHash}`);
      successCount++;
      await new Promise(r => setTimeout(r, 3000));

    } catch(err) {
      console.error(`❌ Error for ${payout.wallet}: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n🎉 Done! ✅ ${successCount} paid, ❌ ${failCount} failed.`);
}

main().catch(e => { console.error('💥 Fatal:', e); process.exit(1); });
