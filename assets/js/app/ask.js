// ─── PAID-BUT-UNSENT QUESTION ────────────────────────────────
// The verified txHash used to live only in a hidden input, so closing the tab
// between paying and submitting lost the payment: the money was gone on-chain
// and the form came back locked. Recovery meant digging the hash out of a
// wallet and pasting it, which nobody would guess to do.
//
// Re-using a stored hash cannot double-post: the Worker registers every
// question txHash for 180 days and rejects a repeat.
const PAID_Q_KEY = 'oracle_paid_question';
const PAID_Q_TTL = 7 * 24 * 60 * 60 * 1000;   // matches the Worker's dedup window comfortably

function savePaidQuestion(txHash, wallet) {
  if (!txHash || txHash === 'ADMIN_BYPASS') return;
  try {
    localStorage.setItem(PAID_Q_KEY, JSON.stringify({ txHash, wallet, ts: Date.now() }));
  } catch (e) {}
}

function clearPaidQuestion() {
  try { localStorage.removeItem(PAID_Q_KEY); } catch (e) {}
}

function readPaidQuestion() {
  try {
    const raw = localStorage.getItem(PAID_Q_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !d.txHash) return null;
    if (Date.now() - (d.ts || 0) > PAID_Q_TTL) { clearPaidQuestion(); return null; }
    return d;
  } catch (e) { return null; }
}

// localStorage is per-device, so a payment made in another browser - or in a
// private window - is invisible to it. This asks the Worker, which looks at the
// chain instead: the payment belongs to the wallet, not to the tab it was made
// in. Runs on connect, and only when nothing is stored locally.
async function checkUnusedPayment(wallet) {
  if (!wallet || readPaidQuestion()) return;
  if (wallet === ADMIN_WALLET) return;
  try {
    const res = await fetch(`${WORKER_URL}/questions/unused-payment?wallet=${wallet}`);
    if (!res.ok) return;
    const d = await res.json();
    if (!d || !d.found || !d.txHash) return;
    savePaidQuestion(d.txHash, wallet);
    restorePaidQuestion();
  } catch (e) {}
}

// Unlocks the form again on load if a paid question was never sent.
function restorePaidQuestion() {
  const d = readPaidQuestion();
  if (!d) return;
  const txEl = document.getElementById('verified-tx-hidden');
  const wEl  = document.getElementById('verified-wallet-hidden');
  const form = document.getElementById('ask-form');
  if (!txEl || !form) return;

  txEl.value = d.txHash;
  if (wEl && d.wallet) wEl.value = d.wallet;

  const txSec = document.getElementById('tx-section');
  const kConn = document.getElementById('keplr-connected');
  if (txSec) txSec.style.display = 'none';
  if (kConn) kConn.style.display = 'none';
  form.style.display = 'block';

  if (typeof showTxStatus === 'function') {
    showTxStatus('success', '✅ You have a paid question that was never sent. The form is unlocked - no need to pay again.');
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', restorePaidQuestion);
}

// ─── ASK FORM ────────────────────────────────────────────────
document.getElementById('ask-message').addEventListener('input', function() {
  const max = 2000, len = this.value.length, remaining = max - len;
  const pct = len / max;
  const ring = document.getElementById('ask-ring');
  document.getElementById('ask-count').textContent = remaining;
  ring.style.strokeDashoffset = 87.96 - pct * 87.96;
  ring.style.stroke = remaining <= 100 ? '#ff4444' : remaining <= 300 ? '#f5c518' : 'var(--accent)';
  document.getElementById('ask-count').style.color = remaining <= 100 ? '#ff4444' : remaining <= 300 ? '#f5c518' : 'var(--muted)';
});

document.getElementById('ask-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = document.getElementById('ask-btn');
  btn.disabled = true;
  btn.innerHTML = 'Transmitting<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>';
  const formData = new FormData(this);
  const category = formData.get('category') || 'Other';
  const text = formData.get('message') || '';
  const txHash = document.getElementById('verified-tx-hidden').value;
  const wallet = document.getElementById('verified-wallet-hidden').value;
  const ref = 'LUNC-' + Date.now().toString(36).toUpperCase().slice(-7);
  // Tags only reach `currentTags` on Enter or comma, so anything typed and left
  // in the box is dropped on submit - the hashtag is visible on screen and
  // absent from the question. Take the pending text too.
  const tagsRaw = document.getElementById('tags-hidden').value;
  const tags = tagsRaw ? tagsRaw.split(',').filter(Boolean) : [];
  const _pendingTag = (document.getElementById('tag-raw-input')?.value || '')
    .replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 20);
  if (_pendingTag && tags.length < 5 && !tags.includes(_pendingTag)) tags.push(_pendingTag);

  // Evidence link. The field has always been in the form and has never been
  // read: whatever anyone pasted there was discarded on submit.
  const evidence = (formData.get('evidence') || '').toString().trim().slice(0, 300);
  const _userTitle = (typeof getUserTitle === 'function' && wallet) ? getUserTitle(wallet) : null;
  const _titleLabel = _userTitle ? _userTitle.name : 'Seeker';
  // ── Poll options ──────────────────────────────────────────────────────────
  // Read straight from the inputs. The hidden field is only ever as good as the
  // last oninput that fired, so anything that sets a value without firing it -
  // autofill, a paste handled oddly, a script - leaves the poll silently empty
  // and the question posts without it. The inputs themselves are what the user
  // actually sees, so they are the honest source at submit time.
  let pollOptions = Array.from(
    document.querySelectorAll('#poll-options-list input[type="text"]')
  ).map(el => (el.value || '').trim()).filter(Boolean);

  // Fall back to the hidden field if the list is not in the DOM for some reason.
  if (!pollOptions.length) {
    try {
      const raw = document.getElementById('poll-options-hidden')?.value || '';
      pollOptions = JSON.parse(raw).map(o => String(o).trim()).filter(Boolean);
    } catch {}
  }
  const poll = pollOptions.length >= 2
    ? pollOptions.slice(0, 5).map(o => ({ text: o, votes: 0, voters: [] }))
    : null;

  try {
    const res = await fetch(`${WORKER_URL}/questions`, {
      method: 'POST',
      headers: txHash === 'ADMIN_BYPASS' ? adminHeaders() : { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ref, category, text, wallet, txHash, tags, poll, evidence }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to submit');
    }
    // Add optimistically to local cache
    const newQ = { id: ref, alias: 'Anonymous#' + wallet.slice(-4).toUpperCase(), title: _titleLabel,
      category, text, tags, wallet, txHash, createdAt: Date.now() / 1000,
      pinnedUntil: (txHash !== 'ADMIN_BYPASS' && getSelectedTier().pin) ? Math.floor(Date.now() / 1000) + 24 * 3600 : null,
      poll, votes: 0, answers: [], voted: false, open: false, formOpen: false };
    questions.unshift(newQ);
    renderBoard();
    document.getElementById('ask-form-section').style.display = 'none';
    const success = document.getElementById('ask-success');
    success.classList.add('visible');
    document.getElementById('ask-ref').textContent = 'REF: ' + ref;
    clearPaidQuestion();
    if (typeof resetPollOptions === 'function') resetPollOptions();
  } catch(e) {
    alert('Failed to submit question: ' + e.message);
  }
  btn.disabled = false;
  btn.innerHTML = 'Transmit Question →';
});

// ─── PROTOCOL WALLETS ─────────────────────────────────────────
const ADMIN_WALLET    = 'terra15jt5a9ycsey4hd6nlqgqxccl9aprkmg2mxmfc6';
const TREASURY_WALLET = 'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt'; // Protocol Treasury wallet
const WEEKLY_DRAW_WALLET = 'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz'; // Weekly Draw Pool
const BURN_WALLET     = 'terra16m05j95p9qvq93cdtchjcpwgvny8f57vzdj06p';
const PROTOCOL_WALLET = ADMIN_WALLET;

// ── Admin secret (pairs with worker env ADMIN_SECRET) ────────────────────────
// The admin wallet address is public (it's in this file), so the worker also
// requires a shared secret in the X-Admin-Secret header for admin endpoints.
// Asked once via prompt, then kept in localStorage on the admin's browser.
function getAdminSecret(forceAsk) {
  let s = null;
  try { s = localStorage.getItem('admin_secret'); } catch(e) {}
  if ((!s || forceAsk) && connectedAddress === ADMIN_WALLET) {
    s = (prompt('Enter admin secret (must match the worker ADMIN_SECRET variable):') || '').trim();
    if (s) { try { localStorage.setItem('admin_secret', s); } catch(e) {} }
  }
  return s || '';
}
function adminHeaders() {
  return { 'Content-Type': 'application/json', 'X-Admin-Wallet': ADMIN_WALLET, 'X-Admin-Secret': getAdminSecret() };
}
// ── Question tariffs ─────────────────────────────────────────────────────────
// MUST match QUESTION_TIERS in the Worker. The Worker derives entries from the
// VERIFIED on-chain pool leg, so these numbers are the source of truth for what
// the wallet is asked to sign - never send the amount to the Worker as a claim.
//
//   Basic     50,000 = 25,000 pool  + 25,000 treasury  → +1 entry
//   Priority 200,000 = 100,000 pool + 100,000 treasury → +4 entries + 24h pin
//
// Rank/streak discounts reduce ONLY the treasury leg; the pool leg is fixed.
const QUESTION_TIERS = {
  basic:    { key:'basic',    total: 50000,  poolLeg: 25000,  entries: 1, pin: false, label: 'Basic'    },
  priority: { key:'priority', total: 200000, poolLeg: 100000, entries: 4, pin: true,  label: 'Priority' },
};
// Reads the tier picker if present. Falls back to Priority so that a page whose
// HTML has not been updated yet keeps behaving exactly as before.
// Largest discount any rank or streak grants. The contract stores the price
// AFTER it - that figure is the floor it will accept - so the full tariff is
// the floor divided by what is left. Keep this in step with the rank table.
const MAX_QUESTION_DISCOUNT = 0.25;

const SCORE_CONTRACT_ADDR = 'terra1pj6t6v4czktz7znzq8xk2ny2yh7pdwen4jw8z4zz86zrac6ur9vqqkwcls';
const SCORE_LCD_URL = 'https://terra-classic-lcd.publicnode.com';

/**
 * Pull the tariffs from the contract and overwrite the local table.
 *
 * The numbers below are a fallback, not the truth: the contract is what
 * refuses an underpayment, so if the two ever disagree it is this file that is
 * wrong. Logging the disagreement makes it findable instead of leaving someone
 * to discover it by being charged.
 */
async function refreshTiersFromChain() {
  try {
    const q = btoa(JSON.stringify({ actions: {} }));
    const res = await fetch(`${SCORE_LCD_URL}/cosmwasm/wasm/v1/contract/${SCORE_CONTRACT_ADDR}/smart/${q}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return;
    const body = await res.json();
    const list = body?.data?.actions || [];

    const map = { question_basic: 'basic', question_priority: 'priority' };
    for (const a of list) {
      const key = map[a.key];
      if (!key || !a.params) continue;

      const poolLeg = Math.round(Number(a.params.pool_amount) / 1e6);
      const floor   = Number(a.params.price) / 1e6;
      const total   = Math.round(floor / (1 - MAX_QUESTION_DISCOUNT));
      if (!poolLeg || !total) continue;

      const t = QUESTION_TIERS[key];
      if (t.total !== total || t.poolLeg !== poolLeg) {
        console.warn(`[tiers] ${key}: page says ${t.total}/${t.poolLeg}, chain says ${total}/${poolLeg} - using the chain`);
      }
      t.total = total;
      t.poolLeg = poolLeg;
    }

    // The button shows a price, so it has to be redrawn if one changed.
    // The real name, with the address it needs for the discount. Only when a
    // wallet is connected - without one there is no price to personalise.
    const _addr = (typeof connectedAddress !== 'undefined' && connectedAddress) || null;
    if (_addr && typeof updateVerifyBtnPrice === 'function') {
      try { updateVerifyBtnPrice(_addr); } catch (e) {}
    }
  } catch (e) {
    // A node that will not answer must not stop anyone asking a question.
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', refreshTiersFromChain, { once: true });
} else {
  refreshTiersFromChain();
}

function getSelectedTier() {
  const el = document.querySelector('input[name="question-tier"]:checked')
          || document.getElementById('question-tier');
  const key = el ? (el.value || '').toLowerCase() : '';
  return QUESTION_TIERS[key] || QUESTION_TIERS.priority;
}
const REQUIRED_LUNC   = 200000000000; // 200,000 LUNC in uLUNC
let connectedAddress  = null;

async function connectKeplr() {
  const btn = document.getElementById('keplr-connect-btn');
  if (!window.keplr) {
    if (confirm('Keplr wallet not found. Install Keplr?')) window.open('https://www.keplr.app/', '_blank');
    return;
  }
  try {
    btn.textContent = 'Connecting...'; btn.disabled = true;
    await window.keplr.enable('columbus-5');
    const offlineSigner = window.keplr.getOfflineSigner('columbus-5');
    const accounts = await offlineSigner.getAccounts();
    connectedAddress = accounts[0].address;
    setActiveProvider('keplr');
    // Update Pay button - async fetch real title from worker
    const _addr = accounts[0].address;
    if (typeof updateVerifyBtnPrice === 'function') updateVerifyBtnPrice(_addr);
    document.getElementById('connected-addr').textContent = connectedAddress.slice(0,10)+'...'+connectedAddress.slice(-4);
    document.getElementById('verified-wallet-hidden').value = connectedAddress;
    // Fire-and-forget: unlocks the form if this wallet already paid elsewhere.
    if (typeof checkUnusedPayment === 'function') checkUnusedPayment(connectedAddress);
    // Refresh My Bag if open
    if (document.getElementById('page-bag') &&
        document.getElementById('page-bag').classList.contains('active')) {
      renderOracleBag();
    }
    document.getElementById('keplr-disconnected').style.display = 'none';
    document.getElementById('keplr-connected').style.display = 'block';
    if (connectedAddress === ADMIN_WALLET) {
      document.getElementById('verified-tx-hidden').value = 'ADMIN_BYPASS';
      document.getElementById('keplr-connected').style.display = 'none';
      document.getElementById('ask-form').style.display = 'block';
      const notice = document.getElementById('tx-section');
      notice.style.display = 'block';
      notice.innerHTML = '<div style="background:rgba(245,197,24,0.08);border:1px solid rgba(245,197,24,0.25);border-radius:8px;padding:12px 16px;font-size:12px;color:var(--gold);">🛡️ Admin wallet detected - payment bypassed</div>';
    } else {
      document.getElementById('tx-section').style.display = 'block';
    }
  } catch(e) {
    btn.textContent = '🔑 Connect Keplr Wallet'; btn.disabled = false;
    alert('Connection failed: ' + (e.message || e));
  }
}

function disconnectKeplr() {
  connectedAddress = null;
  document.getElementById('keplr-disconnected').style.display = 'block';
  document.getElementById('keplr-connected').style.display = 'none';
  document.getElementById('tx-section').style.display = 'none';
  document.getElementById('ask-form').style.display = 'none';
  document.getElementById('tx-status').style.display = 'none';
  document.getElementById('keplr-connect-btn').textContent = '🔑 Connect Keplr Wallet';
  document.getElementById('keplr-connect-btn').disabled = false;
}

