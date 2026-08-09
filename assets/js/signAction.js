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
