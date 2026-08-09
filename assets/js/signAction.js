/**
 * Client half of the ADR-36 check. Add to assets/js/ and load before app.js.
 *
 * The wallet shows a plain-text prompt and returns a signature — no gas, no
 * transaction, nothing written to the chain. What it proves is the one thing
 * the Worker could not check before: that the request really comes from the
 * key that owns the address it claims.
 *
 * View-only mode (luncdash) cannot sign, and that is correct rather than a
 * limitation: an address typed into a box proves nothing about who owns it.
 */
async function signAction(action, refId) {
  const provider = (typeof getActiveProvider === 'function') ? getActiveProvider() : 'keplr';
  const k = (typeof getActiveKeplr === 'function') ? getActiveKeplr() : window.keplr;

  if (!k || typeof k.signArbitrary !== 'function') {
    throw new Error(provider === 'luncdash'
      ? 'View-only mode cannot sign. Connect Keplr or Galaxy Station to take part.'
      : 'This wallet cannot sign messages. Try Keplr or Galaxy Station.');
  }

  const [account] = await k.getOfflineSigner('columbus-5').getAccounts();
  const wallet = account.address;
  const ts = Date.now();

  // Must match actionMessage() in the Worker byte for byte.
  const message = [
    'Terra Oracle',
    `action: ${action}`,
    `wallet: ${wallet}`,
    `ref: ${refId}`,
    `ts: ${ts}`,
  ].join('\n');

  const sig = await k.signArbitrary('columbus-5', wallet, message);
  return { wallet, ts, sig };
}

window.signAction = signAction;

// ── Vote session ────────────────────────────────────────────────────────────
// Votes are frequent, capped and low-value, so asking the wallet to sign each
// one would cost more in friction than it buys in safety. One prompt covers a
// bounded window instead. Answers, deletes and accepts stay signed per action —
// they are rare and cannot be undone.
const VOTE_SESSION_KEY = 'oracle.voteSession';
const VOTE_SESSION_MS = 12 * 60 * 60 * 1000;

async function voteSession() {
  const k = (typeof getActiveKeplr === 'function') ? getActiveKeplr() : window.keplr;
  if (!k || typeof k.signArbitrary !== 'function') {
    throw new Error('This wallet cannot sign messages. Try Keplr or Galaxy Station.');
  }
  const [account] = await k.getOfflineSigner('columbus-5').getAccounts();
  const wallet = account.address;

  // Re-use while it has real time left; renewing a minute before expiry avoids
  // a request failing between the check and the server reading it.
  try {
    const cached = JSON.parse(localStorage.getItem(VOTE_SESSION_KEY) || 'null');
    if (cached && cached.wallet === wallet && cached.exp - Date.now() > 60000) return cached;
  } catch (e) {}

  const exp = Date.now() + VOTE_SESSION_MS;
  const message = [
    'Terra Oracle',
    'action: session',
    `wallet: ${wallet}`,
    'scope: votes',
    `expires: ${exp}`,
  ].join('\n');

  const sig = await k.signArbitrary('columbus-5', wallet, message);
  const session = { wallet, exp, sig };
  try { localStorage.setItem(VOTE_SESSION_KEY, JSON.stringify(session)); } catch (e) {}
  return session;
}

window.voteSession = voteSession;

