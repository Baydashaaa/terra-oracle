// collection-distributor.js
// Runs via GitHub Actions cron every 10 minutes
//
// Flow:
//   1. GET /pending-distributions → list of activations needing transfer from COLLECTION
//   2. For each: send MsgSend from COLLECTION_WALLET → DAILY_WALLET or WEEKLY_WALLET
//      Amount: tier LUNC - 500 LUNC (gas reserve per user spec)
//   3. POST /distribution-complete with tx hash to mark as distributed

import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { stringToPath } from '@cosmjs/crypto';
import { SigningStargateClient }    from '@cosmjs/stargate';

// ── Constants ────────────────────────────────────────────────────────────────
const CHAIN_ID           = 'columbus-5';
const DENOM              = 'uluna';

const COLLECTION_WALLET  = 'terra16m05j95p9qvq93cdtchjcpwgvny8f57vzdj06p';
// Цель перевода - КОНТРАКТЫ пулов (переезд 1 сентября 2026). Обычный перевод
// ложится на баланс контракта и при ближайшем расчёте уходит в carry, а оттуда
// в пот следующего раунда: приз пополняется со сдвигом на раунд, зато без
// ручных переливов и без правки контракта.
const DAILY_WALLET       = 'terra1d9ga3dzhg63v6rmm8ahts55ekjpwlm6dusw5cwhpt60s6t0actqqsul6tm';
const WEEKLY_WALLET      = 'terra19w39c3qz6kc756hap92x374reptah9kp5825f5c67hmquy383r5qd7dmd8';

const MNEMONIC           = process.env.OPERATOR_MNEMONIC_COLLECTION;
const DRAW_WORKER_URL    = process.env.DRAW_WORKER_URL     || 'https://oracle-draw.vladislav-baydan.workers.dev';
const DISTRIBUTION_SECRET = process.env.DISTRIBUTION_SECRET || '';

// Amount per tier (LUNC) BEFORE distribution:
//   common    = 25,000 LUNC paid by user
//     Paco takes 2.5% = 625 LUNC
//     → 24,375 LUNC actually on COLLECTION
//   rare      = 125,000 → Paco takes 3,125 → 121,875 on COLLECTION
//   legendary = 250,000 → Paco takes 6,250 → 243,750 on COLLECTION
//
// We deduct an additional 500 LUNC reserve (per user's spec) for Actions gas fees
// and small cushion. The remainder is transferred to DAILY/WEEKLY pool.
const TIER_TRANSFER_LUNC = {
  common:    23875,   // 24,375 - 500
  rare:     121375,   // 121,875 - 500
  legendary: 243250,  // 243,750 - 500
};

const RPC_NODES = [
  'https://terra-classic-rpc.publicnode.com',
  'https://rpc.terra-classic.hexxagon.io',
];

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(n) { return Math.floor(n).toLocaleString(); }

function tierFromEntries(entries) {
  // entries = 1 → common, 5 → rare, 10 → legendary
  // bonusEntry may add +1, so we take the base paid value
  if (entries >= 10) return 'legendary';
  if (entries >= 5)  return 'rare';
  return 'common';
}

async function fetchPending() {
  const res = await fetch(DRAW_WORKER_URL + '/pending-distributions');
  if (!res.ok) {
    throw new Error('Worker /pending-distributions HTTP ' + res.status);
  }
  return (await res.json()).pending || [];
}

async function markComplete(tokenId, txHash, amountUluna) {
  const res = await fetch(DRAW_WORKER_URL + '/distribution-complete', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + DISTRIBUTION_SECRET,
    },
    body: JSON.stringify({
      tokenId,
      distributionTxHash: txHash,
      amount: amountUluna,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error('Mark complete failed HTTP ' + res.status + ': ' + (body.error || ''));
  }
}

async function markSkipped(tokenId, reason) {
  try {
    await fetch(DRAW_WORKER_URL + '/distribution-complete', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + DISTRIBUTION_SECRET,
      },
      body: JSON.stringify({
        tokenId,
        skipped: true,
        skipReason: reason,
      }),
    });
  } catch(e) {
    console.warn('markSkipped failed:', e.message);
  }
}

async function sendLunc(client, from, to, amountUluna, memo) {
  console.log('  Sending ' + fmt(amountUluna / 1e6) + ' LUNC → ' + to);
  // Gas: 300k is safe (200k was occasionally hitting out-of-gas).
  // Fee on Terra Classic: gas × ~28.3 uluna (rate at columbus-5) - use 8.5M uluna for headroom.
  const result = await client.sendTokens(
    from, to,
    [{ denom: DENOM, amount: String(amountUluna) }],
    { amount: [{ denom: DENOM, amount: '8500000' }], gas: '300000' },
    memo
  );
  if (result.code !== 0) throw new Error('TX failed: ' + result.rawLog);
  console.log('  TX hash: ' + result.transactionHash);
  return result.transactionHash;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!MNEMONIC) throw new Error('OPERATOR_MNEMONIC_COLLECTION not set');
  if (!DISTRIBUTION_SECRET) throw new Error('DISTRIBUTION_SECRET not set');

  // Fetch pending first - if empty, don't even connect to RPC
  console.log('Fetching pending distributions...');
  const pending = await fetchPending();
  if (!pending.length) {
    console.log('No pending distributions. Exiting.');
    return;
  }
  console.log('Found ' + pending.length + ' pending distribution(s).');

  // Connect wallet
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, {
    prefix: 'terra',
    hdPaths: [stringToPath("m/44'/330'/0'/0/0")],
  });
  const [account] = await wallet.getAccounts();
  console.log('Collection wallet: ' + account.address);

  if (account.address !== COLLECTION_WALLET) {
    throw new Error('Mnemonic address ' + account.address + ' does not match expected COLLECTION_WALLET ' + COLLECTION_WALLET);
  }

  // Connect to RPC
  let client = null;
  for (const rpc of RPC_NODES) {
    try {
      client = await SigningStargateClient.connectWithSigner(rpc, wallet);
      console.log('Connected to RPC: ' + rpc);
      break;
    } catch (e) {
      console.warn('RPC ' + rpc + ' failed: ' + e.message);
    }
  }
  if (!client) throw new Error('Could not connect to any RPC node');

  // Process each pending distribution sequentially
  let successCount = 0;
  let failCount    = 0;
  let skipCount    = 0;

  for (const p of pending) {
    console.log('\n--- Distributing ' + p.tokenId + ' (pool=' + p.pool + ', tier=' + p.tier + ') ---');

    // Determine tier and amount
    const tier       = p.tier || tierFromEntries(p.entries || 1);
    const luncAmount = TIER_TRANSFER_LUNC[tier];
    if (!luncAmount) {
      console.warn('Unknown tier "' + tier + '" for ' + p.tokenId + ' - skipping');
      await markSkipped(p.tokenId, 'unknown tier: ' + tier);
      skipCount++;
      continue;
    }

    const amountUluna = luncAmount * 1e6;
    const targetWallet = p.pool === 'daily' ? DAILY_WALLET : WEEKLY_WALLET;

    try {
      const memo = 'Distribute ' + p.pool + ' pool for NFT:' + p.tokenId;
      const txHash = await sendLunc(client, account.address, targetWallet, amountUluna, memo);
      await markComplete(p.tokenId, txHash, amountUluna);
      successCount++;
    } catch(e) {
      console.error('  FAILED: ' + e.message);
      failCount++;
      // Don't mark as skipped - leave as pending for next run. If error is persistent
      // (e.g. insufficient balance), it will keep retrying. Manual intervention may
      // be needed to skip permanently failed items.
    }
  }

  console.log('\n=== Summary ===');
  console.log('Success: ' + successCount);
  console.log('Failed (will retry): ' + failCount);
  console.log('Skipped (unknown tier): ' + skipCount);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(function(e) {
  console.error('FATAL:', e.message);
  process.exit(1);
});
