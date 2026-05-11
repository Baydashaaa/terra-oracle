// scripts/streak-payout.js
// Runs every hour via GitHub Actions
// Pays streak milestone rewards from RESERVE wallet

import fetch from 'node-fetch';

const WORKER_URL     = process.env.WORKER_URL;
const ACTIONS_SECRET = process.env.ACTIONS_SECRET;
const MNEMONIC       = process.env.RESERVE_MNEMONIC;
const LCD_URL        = 'https://terra-classic-lcd.publicnode.com';
const CHAIN_ID       = 'columbus-5';
const GAS_PRICE      = '28.325';
const GAS_ADJUSTMENT = 1.4;

async function safeFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch(e) { clearTimeout(t); throw e; }
}

// Derive wallet from mnemonic using @cosmjs/crypto
async function getWallet() {
  const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, {
    prefix: 'terra',
    hdPaths: ["m/44'/330'/0'/0/0"],
  });
  const [account] = await wallet.getAccounts();
  return { wallet, address: account.address };
}

async function broadcastTx(wallet, senderAddress, toAddress, amount) {
  const { SigningStargateClient } = await import('@cosmjs/stargate');
  const client = await SigningStargateClient.connectWithSigner(
    LCD_URL.replace('https://', 'wss://').replace('/cosmos', '') + ':443',
    wallet,
    { gasPrice: { amount: GAS_PRICE, denom: 'uluna' } }
  );

  // Use REST broadcast instead of RPC for reliability
  const { encodeTx } = await import('@cosmjs/proto-signing');

  const result = await client.sendTokens(
    senderAddress,
    toAddress,
    [{ denom: 'uluna', amount: String(amount) }],
    { amount: [{ denom: 'uluna', amount: '500000' }], gas: '200000' },
    `streak:milestone`
  );
  return result;
}

async function main() {
  console.log('🔥 Streak payout starting...');
  console.log(`📅 Date: ${new Date().toISOString()}`);

  if (!WORKER_URL || !ACTIONS_SECRET || !MNEMONIC) {
    console.error('❌ Missing env vars');
    process.exit(1);
  }

  // 1. Fetch pending payouts
  const res = await safeFetch(`${WORKER_URL}/streak/pending-payouts?secret=${ACTIONS_SECRET}`);
  if (!res.ok) { console.error('❌ Failed to fetch payouts:', await res.text()); process.exit(1); }
  const { payouts } = await res.json();

  if (!payouts || payouts.length === 0) {
    console.log('✅ No pending streak payouts.');
    return;
  }
  console.log(`📋 Found ${payouts.length} pending payout(s).`);

  // 2. Setup wallet
  const { wallet, address: sender } = await getWallet();
  console.log(`👛 Reserve wallet: ${sender}`);

  // 3. Check balance
  const balRes  = await safeFetch(`${LCD_URL}/cosmos/bank/v1beta1/balances/${sender}`);
  const balData = await balRes.json();
  const balAmt  = parseInt(balData.balances?.find(b => b.denom === 'uluna')?.amount || '0');
  console.log(`💰 Balance: ${(balAmt / 1e6).toFixed(3)} LUNC`);

  const totalNeeded = payouts.reduce((s, p) => s + (p.amount || 0), 0);
  if (balAmt < totalNeeded + 2_000_000) {
    console.error(`❌ Insufficient balance`);
    process.exit(1);
  }

  // 4. Process payouts
  const { SigningStargateClient } = await import('@cosmjs/stargate');
  const client = await SigningStargateClient.connectWithSigner(
    'wss://terra-classic-rpc.publicnode.com:443',
    wallet,
    { gasPrice: `${GAS_PRICE}uluna` }
  );

  let successCount = 0, failCount = 0;

  for (const payout of payouts) {
    try {
      console.log(`\n⏳ ${payout.wallet.slice(0,20)}... milestone=${payout.milestone} amount=${payout.amount/1e6} LUNC`);

      const result = await client.sendTokens(
        sender,
        payout.to,
        [{ denom: 'uluna', amount: String(payout.amount) }],
        { amount: [{ denom: 'uluna', amount: '500000' }], gas: '200000' },
        `streak:milestone:${payout.milestone}`
      );

      if (result.code !== 0) {
        console.error(`❌ Tx failed: code=${result.code}`);
        failCount++;
        continue;
      }

      console.log(`✅ Paid ${(payout.amount/1e6).toFixed(3)} LUNC → ${payout.to} | tx: ${result.transactionHash}`);

      const markRes = await safeFetch(`${WORKER_URL}/streak/mark-paid`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key: payout.key, txHash: result.transactionHash, secret: ACTIONS_SECRET }),
      });
      if (!markRes.ok) console.error(`⚠️ mark-paid failed`);
      else console.log(`📝 Marked as paid.`);

      successCount++;
      await new Promise(r => setTimeout(r, 3000));

    } catch(err) {
      console.error(`❌ Error: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n🎉 Done! ✅ ${successCount} paid, ❌ ${failCount} failed.`);
}

main().catch(e => { console.error('💥 Fatal:', e); process.exit(1); });
