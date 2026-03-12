#!/usr/bin/env node
/**
 * Terra Oracle — Q&A Reward Payout Script
 * Runs via GitHub Actions daily at 20:00 UTC
 *
 * Logic (Variant 3 — Hybrid):
 *   - Questions expire 7 days after creation (expiresAt)
 *   - If asker chose a winner (chosenAnswerId set) → pay that answer
 *   - If not chosen → auto-pick answer with highest votes
 *   - Minimum 1 answer required, minimum 1 vote on winning answer
 *   - Winner gets 100% of rewardAmount (50% of 200K LUNC = 100K LUNC)
 *   - Burn and Dev splits handled separately by protocol wallet admin
 *
 * ENV vars (GitHub Secrets):
 *   ORACLE_MNEMONIC  — mnemonic of ORACLE_WALLET operator
 *
 * questions.json status flow:
 *   open → chosen (asker picked) → paid
 *   open → auto_resolved (7d expired, auto-picked) → paid
 *   open → expired_no_answers (no answers or 0 votes → no payout)
 */

const fs   = require('fs');
const path = require('path');

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const ORACLE_WALLET = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt';
const BURN_WALLET   = 'terra16m05j95p9qvq93cdtchjcpwgvny8f57vzdj06p';
const CHAIN_ID      = 'columbus-5';
const LCD           = 'https://terra-classic-lcd.publicnode.com';
const LCD_FALLBACK  = 'https://api-terra-ia.cosmosia.notional.ventures';
const RPC           = 'https://terra-classic-rpc.publicnode.com';
const RPC_FALLBACK  = 'https://terra-classic-rpc.publicnode.com';

// Reward split from 200K LUNC payment:
//   50% = 100,000 LUNC → winner (handled by this script)
//   30% =  60,000 LUNC → burn  (handled by this script)
//   10% =  20,000 LUNC → marketing (manual / protocol)
//   10% =  20,000 LUNC → dev       (manual / protocol)
const REWARD_PCT = 0.50;  // of payment → winner
const BURN_PCT   = 0.30;  // of payment → burn wallet

const QUESTIONS_FILE = path.join(__dirname, 'questions.json');
const EXPIRY_DAYS    = 7;
const MIN_VOTES      = 1; // winning answer must have at least this many votes

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

async function lcdGet(endpoint) {
  for (const base of [LCD, LCD_FALLBACK]) {
    try {
      const res = await fetch(base + endpoint, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return res.json();
    } catch (e) {
      log(`LCD ${base} failed: ${e.message}`);
    }
  }
  throw new Error(`All LCD nodes failed for: ${endpoint}`);
}

// ─── LOAD / SAVE questions.json ───────────────────────────────────────────────
function loadQuestions() {
  if (!fs.existsSync(QUESTIONS_FILE)) {
    log('questions.json not found — nothing to process');
    return { questions: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
  } catch (e) {
    log('ERROR: Failed to parse questions.json:', e.message);
    process.exit(1);
  }
}

function saveQuestions(data) {
  data._updated = new Date().toISOString();
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(data, null, 2));
  log('Saved questions.json');
}

// ─── RESOLVE WINNER ANSWER ────────────────────────────────────────────────────
/**
 * Returns the winning answer for a question, or null if no valid winner.
 *
 * Priority:
 *   1. chosenAnswerId set by asker → use that answer
 *   2. Auto-pick: answer with highest votes (must be >= MIN_VOTES)
 *
 * @param {object} q — question object from questions.json
 * @returns {object|null} — winning answer object or null
 */
function resolveWinner(q) {
  if (!q.answers || q.answers.length === 0) {
    log(`  Q ${q.id}: no answers → skip`);
    return null;
  }

  // Asker explicitly chose a winner
  if (q.chosenAnswerId) {
    const chosen = q.answers.find(a => a.id === q.chosenAnswerId);
    if (chosen) {
      log(`  Q ${q.id}: asker chose ANS ${chosen.id} (${chosen.votes} votes)`);
      return chosen;
    }
    log(`  Q ${q.id}: chosenAnswerId set but answer not found — falling back to auto`);
  }

  // Auto-pick: highest votes
  const sorted = [...q.answers].sort((a, b) => b.votes - a.votes);
  const best   = sorted[0];

  if (best.votes < MIN_VOTES) {
    log(`  Q ${q.id}: best answer has ${best.votes} votes < MIN_VOTES (${MIN_VOTES}) → skip`);
    return null;
  }

  log(`  Q ${q.id}: auto-picked ANS ${best.id} (${best.votes} votes)`);
  return best;
}

// ─── LOOKUP WINNER WALLET FROM TX ────────────────────────────────────────────
/**
 * The answer's walletHash is a one-way hash — we can't reverse it.
 * Instead we look up the answer's wallet via FCD using the answer's
 * submission txHash (stored when answer was submitted).
 *
 * If no txHash on answer (e.g. legacy data), we cannot pay → skip.
 *
 * @param {object} answer
 * @returns {string|null} — terra1... address or null
 */
async function getAnswerWallet(answer) {
  if (!answer.txHash) {
    log(`  ANS ${answer.id}: no txHash stored → cannot resolve wallet`);
    return null;
  }

  try {
    // Fetch the answer submission TX from FCD to get sender address
    const fcdNodes = [
      'https://fcd.terra-classic.io',
      'https://fcd.terraclassic.community',
    ];

    for (const fcd of fcdNodes) {
      try {
        const res = await fetch(`${fcd}/v1/tx/${answer.txHash}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const data = await res.json();

        // Extract sender from first MsgSend
        const msgs = data.tx?.value?.msg || data.tx?.body?.messages || [];
        for (const msg of msgs) {
          const type = msg.type || msg['@type'] || '';
          if (type.includes('MsgSend') || type.includes('bank')) {
            const sender = msg.value?.from_address || msg.from_address;
            if (sender && sender.startsWith('terra1')) {
              log(`  ANS ${answer.id}: resolved wallet ${sender}`);
              return sender;
            }
          }
        }
      } catch (e) {
        log(`  FCD ${fcd} failed: ${e.message}`);
      }
    }
  } catch (e) {
    log(`  ANS ${answer.id}: wallet lookup failed: ${e.message}`);
  }

  return null;
}

// ─── GET WALLET BALANCE ───────────────────────────────────────────────────────
async function getBalance(wallet) {
  const data = await lcdGet(`/cosmos/bank/v1beta1/balances/${wallet}`);
  const coin = (data.balances || []).find(b => b.denom === 'uluna');
  return coin ? Number(coin.amount) : 0;
}

// ─── SEND TRANSACTION ─────────────────────────────────────────────────────────
async function sendTx(mnemonic, toWallet, amountUluna, memo) {
  const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');
  const { SigningStargateClient }   = await import('@cosmjs/stargate');

  const signer = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'terra',
    hdPath: "m/44'/330'/0'/0/0",
  });

  let client = null;
  for (const rpc of [RPC, RPC_FALLBACK]) {
    try {
      client = await SigningStargateClient.connectWithSigner(rpc, signer);
      break;
    } catch (e) {
      log(`RPC ${rpc} failed: ${e.message}`);
    }
  }
  if (!client) throw new Error('All RPC nodes failed');

  const result = await client.sendTokens(
    ORACLE_WALLET, toWallet,
    [{ denom: 'uluna', amount: String(amountUluna) }],
    { amount: [{ denom: 'uluna', amount: '150000' }], gas: '200000' },
    memo
  );

  if (result.code !== 0) throw new Error(`TX failed (code ${result.code}): ${result.rawLog}`);
  log(`TX OK → ${toWallet} | ${amountUluna / 1e6} LUNC | ${result.transactionHash}`);
  return result.transactionHash;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  log('=== TERRA ORACLE — REWARD PAYOUT ===');

  const mnemonic = process.env.ORACLE_MNEMONIC;
  if (!mnemonic) {
    log('ERROR: ORACLE_MNEMONIC not set in secrets');
    process.exit(1);
  }

  // Load questions
  const db        = loadQuestions();
  const questions = db.questions || [];
  const now       = Math.floor(Date.now() / 1000);

  log(`Loaded ${questions.length} questions`);

  // Check oracle wallet balance
  const balanceUluna = await getBalance(ORACLE_WALLET);
  log(`Oracle wallet balance: ${balanceUluna / 1e6} LUNC`);

  let processed = 0;
  let paid      = 0;
  let skipped   = 0;

  for (const q of questions) {

    // Only process open questions that have expired
    if (q.status !== 'open') continue;
    if (q.expiresAt > now && !q.chosenAnswerId) continue; // not expired + asker hasn't chosen

    processed++;
    log(`\nProcessing Q ${q.id} | expires ${new Date(q.expiresAt * 1000).toISOString()} | status: ${q.status}`);

    // Resolve winner answer
    const winnerAnswer = resolveWinner(q);
    if (!winnerAnswer) {
      q.status = 'expired_no_answers';
      log(`  Q ${q.id}: no valid winner → marked expired_no_answers`);
      skipped++;
      continue;
    }

    // Determine how this was resolved
    const isChosen = q.chosenAnswerId === winnerAnswer.id;
    q.status = isChosen ? 'chosen' : 'auto_resolved';

    // Resolve winner wallet address
    const winnerWallet = await getAnswerWallet(winnerAnswer);
    if (!winnerWallet) {
      log(`  Q ${q.id}: could not resolve winner wallet → skip payout`);
      q.status = 'payout_failed_no_wallet';
      skipped++;
      continue;
    }

    // Calculate amounts (in uLUNC = LUNC × 1,000,000)
    const paymentUluna = (q.paymentAmount || 200000) * 1_000_000;
    const rewardUluna  = Math.floor(paymentUluna * REWARD_PCT); // 50% → winner
    const burnUluna    = Math.floor(paymentUluna * BURN_PCT);   // 30% → burn

    log(`  Payment: ${q.paymentAmount} LUNC`);
    log(`  Reward:  ${rewardUluna / 1e6} LUNC → ${winnerWallet}`);
    log(`  Burn:    ${burnUluna / 1e6} LUNC → ${BURN_WALLET}`);

    // Check sufficient balance (reward + burn + 2× gas)
    const needed = rewardUluna + burnUluna + 600000; // 2 TXs × 300K gas
    if (balanceUluna < needed) {
      log(`  ERROR: Insufficient balance (${balanceUluna / 1e6} LUNC < ${needed / 1e6} LUNC needed)`);
      skipped++;
      continue;
    }

    // Send reward to winner
    try {
      const rewardMemo = `Terra Oracle reward | Q:${q.id} | ANS:${winnerAnswer.id}`;
      const rewardTx   = await sendTx(mnemonic, winnerWallet, rewardUluna, rewardMemo);
      winnerAnswer.rewardPaidTx = rewardTx;
      q.rewardPaidTx            = rewardTx;
      q.rewardPaidAt            = now;
      q.rewardWinner            = winnerWallet;
      q.rewardAmount            = rewardUluna / 1e6;
      await sleep(3000);
    } catch (e) {
      log(`  ERROR sending reward: ${e.message}`);
      q.status = 'payout_failed_tx_error';
      skipped++;
      continue;
    }

    // Send burn
    try {
      const burnMemo = `Terra Oracle burn | Q:${q.id}`;
      const burnTx   = await sendTx(mnemonic, BURN_WALLET, burnUluna, burnMemo);
      q.burnTx       = burnTx;
      await sleep(3000);
    } catch (e) {
      log(`  WARN: Burn TX failed (reward already sent): ${e.message}`);
      // Don't fail the whole question — reward was already paid
    }

    // Mark as paid
    q.status = 'paid';
    paid++;
    log(`  Q ${q.id}: PAID ✓`);
  }

  // Save updated questions.json
  saveQuestions(db);

  log(`\n=== DONE ===`);
  log(`Processed: ${processed} | Paid: ${paid} | Skipped: ${skipped}`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
