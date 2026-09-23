/**
 * Client half of the ADR-36 check. Add to assets/js/ and load before app.js.
 *
 * The wallet shows a plain-text prompt and returns a signature - no gas, no
 * transaction, nothing written to the chain. What it proves is the one thing
 * the Worker could not check before: that the request really comes from the
 * key that owns the address it claims.
 *
 * View-only mode (luncdash) cannot sign, and that is correct rather than a
 * limitation: an address typed into a box proves nothing about who owns it.
 */
async function signAction(action, refId, content) {
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
  const lines = [
    'Terra Oracle',
    `action: ${action}`,
    `wallet: ${wallet}`,
    `ref: ${refId}`,
    `ts: ${ts}`,
  ];
  // Версия 2: в подпись входит хеш содержимого (SEC-07). Без него подпись
  // покрывала только действие и номер, и перехваченную можно было отправить
  // с другим текстом.
  if (content) lines.push(`content: ${content}`);
  const message = lines.join('\n');

  const sig = await k.signArbitrary('columbus-5', wallet, message);
  return content ? { wallet, ts, sig, v: 2 } : { wallet, ts, sig };
}

window.signAction = signAction;

// sha256 строки в hex. Та же операция в воркере (contentHash в auth.js):
// обе стороны хешируют одни и те же байты.
async function contentHash(str) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Каноническое содержимое - обязано совпадать байт в байт с
// questionContent/answerContent в воркере. Порядок полей и null вместо
// отсутствующих - часть формата.
function questionContent(b) {
  return JSON.stringify([b.category ?? null, b.text ?? null, b.tags ?? null,
    b.poll ?? null, b.evidence ?? null, b.title ?? null]);
}
function answerContent(b) {
  return JSON.stringify([b.text ?? null, b.replyTo ?? null]);
}
window.contentHash = contentHash;
window.questionContent = questionContent;
window.answerContent = answerContent;

// ── Vote session ────────────────────────────────────────────────────────────
// Votes are frequent, capped and low-value, so asking the wallet to sign each
// one would cost more in friction than it buys in safety. One prompt covers a
// bounded window instead. Answers, deletes and accepts stay signed per action -
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

// Убрать разрешение с диска. Живёт рядом с самой сессией намеренно: имя
// ключа знает только этот файл, и чистка не отстанет от переименования.
//
// И отзыв на сервере (SEC-08): одного удаления мало, снятая раньше копия
// осталась бы действительной до конца срока. Сессия сама доказывает право
// себя отозвать, поэтому окно кошелька не нужно. keepalive - чтобы запрос
// ушёл, даже если страницу тут же закрывают.
function clearVoteSession() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(VOTE_SESSION_KEY) || 'null'); } catch (e) {}
  try { localStorage.removeItem(VOTE_SESSION_KEY); } catch (e) {}
  if (!cached || !cached.sig || !(cached.exp > Date.now())) return;
  const base = (typeof WORKER_URL !== 'undefined' && WORKER_URL)
    || 'https://terra-oracle-questions.vladislav-baydan.workers.dev';
  try {
    fetch(base + '/session/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cached),
      keepalive: true,
    }).catch(() => {});
  } catch (e) {}
}
window.clearVoteSession = clearVoteSession;

