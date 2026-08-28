// ─── CHAT PAGE ────────────────────────────────────────────────
document.getElementById('chat-page-input').addEventListener('input', function() {
  const max = 256, len = this.value.length, remaining = max - len;
  const pct = len / max;
  const ring = document.getElementById('chat-ring');
  const counter = document.getElementById('chat-page-count');
  ring.style.strokeDashoffset = 87.96 - (pct * 87.96);
  if (remaining <= 20) { ring.style.stroke = '#ff4444'; counter.style.color = '#ff4444'; }
  else if (remaining <= 50) { ring.style.stroke = '#f5c518'; counter.style.color = '#f5c518'; }
  else { ring.style.stroke = 'var(--accent)'; counter.style.color = 'var(--muted)'; }
  counter.textContent = remaining;
});

// ─── FIX 2: Chat - исправлена fee (5,000 LUNC payment) ───────
window._chatReplyTo = null;
window.setChatReply = function(txHash, author, text) {
  window._chatReplyTo = { txHash, author, text };
  const block = document.getElementById('chat-reply-block');
  if (block) block.style.display = 'flex';
  const nameEl = document.getElementById('chat-reply-author');
  if (nameEl) nameEl.textContent = author;
  const textEl = document.getElementById('chat-reply-text');
  if (textEl) textEl.textContent = text.slice(0,80) + (text.length > 80 ? '...' : '');
  const input = document.getElementById('chat-page-input');
  if (input) input.focus();
};
window.clearChatReply = function() {
  window._chatReplyTo = null;
  const block = document.getElementById('chat-reply-block');
  if (block) block.style.display = 'none';
};
document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-reply-txhash]');
  if (!btn) return;
  window.setChatReply(btn.getAttribute('data-reply-txhash'), btn.getAttribute('data-reply-author'), btn.getAttribute('data-reply-text'));
});

window.sendChatMessage = async function() {
  const text = document.getElementById('chat-page-input').value.trim();
  const statusEl = document.getElementById('chat-tx-status');
  const btn = document.getElementById('chat-page-send-btn');
  if (!text) { alert('Write a message first!'); return; }
  if (!globalWalletAddress) { alert('Connect your wallet first!'); return; }
  if (!getActiveKeplr()) { alert(getActiveProvider() === 'luncdash' ? VIEW_ONLY_MSG : 'Wallet not found. Please connect a wallet.'); return; }
  btn.textContent = '⏳ Waiting for wallet...'; btn.disabled = true;
  statusEl.style.display = 'none';
  try {
    await enableActive('columbus-5');
    const accounts = await getActiveKeplr().getOfflineSigner('columbus-5').getAccounts();
    const sender = accounts[0].address;
    const replyPrefix = window._chatReplyTo ? `>${window._chatReplyTo.txHash.slice(0,16)}|` : '';
    const fullMemo = (replyPrefix + text).slice(0, 256);
    const txHash = await sendLuncDirect(sender, TREASURY_WALLET, 5000000000, fullMemo, 'columbus-5');
    const result = { transactionHash: txHash };
    const short = sender.slice(0,8)+'...'+sender.slice(-4);

    // ✅ Streak: Chat - платное действие (5,000 LUNC)
    fetch(`${WORKER_URL}/streak/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: sender, action: 'chat' }),
    }).catch(() => {});
    const stored = JSON.parse(localStorage.getItem('dao_chat_pending') || '[]');
    stored.push({ text, author: short, fullAddr: sender, txHash: result.transactionHash, isVerified: true, timestamp: Date.now() });
    localStorage.setItem('dao_chat_pending', JSON.stringify(stored));

    // ── Track message count via Worker (server-side, tamper-proof) ──
    fetch(`${WORKER_URL}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: sender, txHash: result.transactionHash }),
    }).then(r => r.json()).then(data => {
      if (data && typeof data.newCount === 'number') updateChatEntryProgress(data.newCount);
      if (data.milestoneEntry && data.newCount) {
        setTimeout(() => {
          statusEl.style.cssText = 'display:block;border-radius:8px;padding:10px 14px;font-size:12px;background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.3);color:#a78bfa;margin-top:10px;';
          statusEl.innerHTML = '🎉 Milestone reached! <strong>' + data.newCount + ' messages</strong> - you earned a free Weekly Draw entry! Total entries earned: <strong>' + data.entriesEarned + '</strong>';
          setTimeout(() => { statusEl.style.display = 'none'; }, 8000);
        }, 3000);
      }
    }).catch(() => {});
    // ─────────────────────────────────────────────────────────────

    document.getElementById('chat-page-input').value = '';
    document.getElementById('chat-page-count').textContent = '256';
    document.getElementById('chat-ring').style.strokeDashoffset = '87.96';
    document.getElementById('chat-ring').style.stroke = 'var(--accent)';
    window.clearChatReply();
    btn.textContent = 'Send Message →'; btn.disabled = false;
    statusEl.style.cssText = 'display:block;border-radius:8px;padding:10px 14px;font-size:12px;background:rgba(102,255,170,0.06);border:1px solid rgba(102,255,170,0.25);color:var(--green);margin-top:10px;';
    statusEl.innerHTML = '✅ Sent! <a href="https://finder.terraport.finance/mainnet/tx/' + result.transactionHash + '" target="_blank" style="color:var(--green);text-decoration:underline;">' + result.transactionHash.slice(0,16) + '...</a><br><span style="font-size:10px;opacity:0.7;">Message will appear after blockchain confirmation (~6s)</span>';
    setTimeout(() => { loadChatFromChain(); }, 8000);
    setTimeout(() => { statusEl.style.display = 'none'; }, 10000);
  } catch(e) {
    btn.textContent = 'Send Message →'; btn.disabled = false;
    statusEl.style.cssText = 'display:block;border-radius:8px;padding:10px 14px;font-size:12px;background:rgba(255,60,60,0.06);border:1px solid rgba(255,60,60,0.25);color:#ff6060;margin-top:10px;';
    statusEl.textContent = '❌ ' + (e.message || 'Transaction cancelled or failed.');
  }
}

// ─── BLOCKCHAIN CHAT ──────────────────────────────────────────
const CHAT_WALLET = TREASURY_WALLET;
const CHAT_HISTORY_WALLET = TREASURY_WALLET;
const CHAT_MIN_ULUNA = 5000000000;
// FIX 4: два разных FCD узла для настоящего fallback
const FCD_NODES = [
  'https://terra-classic-lcd.publicnode.com',
  'https://terra-classic-lcd.publicnode.com',
];

// Ключ реакции - по-прежнему сам эмодзи: под ним реакции лежат в KV воркера
// и приходят из /chat/reactions. Меняется только отрисовка, поэтому все уже
// поставленные реакции сохраняются. Добавлены Dislike и Angry.
const CHAT_REACTIONS = [
  { key: '🔥', label: 'Fire', sm: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FFA53D" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #FFA53D99);"><path d="M12 20.6c3.2 0 5.7-2.2 5.7-5.3 0-3.6-2.9-5.6-4.2-9.6-2 1.6-3 3.3-3 5 0 1.2.5 2 .5 2.9 0 .9-.7 1.6-1.6 1.6-.85 0-1.45-.55-1.65-1.45-1 1.2-1.55 2.6-1.55 4.05 0 3 2.5 4.8 5.75 4.8z"/></svg>`, lg: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#FFA53D" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #FFA53D99);"><path d="M12 20.6c3.2 0 5.7-2.2 5.7-5.3 0-3.6-2.9-5.6-4.2-9.6-2 1.6-3 3.3-3 5 0 1.2.5 2 .5 2.9 0 .9-.7 1.6-1.6 1.6-.85 0-1.45-.55-1.65-1.45-1 1.2-1.55 2.6-1.55 4.05 0 3 2.5 4.8 5.75 4.8z"/></svg>` },
  { key: '👍', label: 'Like', sm: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#00FFB0" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #00FFB099);"><path d="M7 11.6v8.8H4.4A1.4 1.4 0 0 1 3 19v-6a1.4 1.4 0 0 1 1.4-1.4z"/><path d="M7 11.6 10.5 4.1a2.05 2.05 0 0 1 2.9 2.55l-.85 3.05h4.45a1.8 1.8 0 0 1 1.77 2.12l-.98 5.45a1.95 1.95 0 0 1-1.92 1.6H9.6a2.8 2.8 0 0 1-.9-.15L7 20.4z"/></svg>`, lg: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#00FFB0" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #00FFB099);"><path d="M7 11.6v8.8H4.4A1.4 1.4 0 0 1 3 19v-6a1.4 1.4 0 0 1 1.4-1.4z"/><path d="M7 11.6 10.5 4.1a2.05 2.05 0 0 1 2.9 2.55l-.85 3.05h4.45a1.8 1.8 0 0 1 1.77 2.12l-.98 5.45a1.95 1.95 0 0 1-1.92 1.6H9.6a2.8 2.8 0 0 1-.9-.15L7 20.4z"/></svg>` },
  { key: '👎', label: 'Dislike', sm: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#7d8aa0" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #7d8aa099);"><g transform="rotate(180 12 12)"><path d="M7 11.6v8.8H4.4A1.4 1.4 0 0 1 3 19v-6a1.4 1.4 0 0 1 1.4-1.4z"/><path d="M7 11.6 10.5 4.1a2.05 2.05 0 0 1 2.9 2.55l-.85 3.05h4.45a1.8 1.8 0 0 1 1.77 2.12l-.98 5.45a1.95 1.95 0 0 1-1.92 1.6H9.6a2.8 2.8 0 0 1-.9-.15L7 20.4z"/></g></svg>`, lg: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#7d8aa0" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #7d8aa099);"><g transform="rotate(180 12 12)"><path d="M7 11.6v8.8H4.4A1.4 1.4 0 0 1 3 19v-6a1.4 1.4 0 0 1 1.4-1.4z"/><path d="M7 11.6 10.5 4.1a2.05 2.05 0 0 1 2.9 2.55l-.85 3.05h4.45a1.8 1.8 0 0 1 1.77 2.12l-.98 5.45a1.95 1.95 0 0 1-1.92 1.6H9.6a2.8 2.8 0 0 1-.9-.15L7 20.4z"/></g></svg>` },
  { key: '🚀', label: 'Rocket', sm: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#00D4FF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #00D4FF99);"><path d="M12 3.3c2.6 1.9 4.2 5 4.2 8.4 0 1.35-.24 2.6-.68 3.8H8.48a11.2 11.2 0 0 1-.68-3.8c0-3.4 1.6-6.5 4.2-8.4z"/><circle cx="12" cy="10.1" r="1.85"/><path d="M8.5 15.5 6.1 17.8V13.2a6.4 6.4 0 0 1 1.8-2.3M15.5 15.5l2.4 2.3v-4.6a6.4 6.4 0 0 0-1.8-2.3"/><path d="M10.5 18.5c.45 1.25 1.5 2.2 1.5 2.2s1.05-.95 1.5-2.2"/></svg>`, lg: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#00D4FF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #00D4FF99);"><path d="M12 3.3c2.6 1.9 4.2 5 4.2 8.4 0 1.35-.24 2.6-.68 3.8H8.48a11.2 11.2 0 0 1-.68-3.8c0-3.4 1.6-6.5 4.2-8.4z"/><circle cx="12" cy="10.1" r="1.85"/><path d="M8.5 15.5 6.1 17.8V13.2a6.4 6.4 0 0 1 1.8-2.3M15.5 15.5l2.4 2.3v-4.6a6.4 6.4 0 0 0-1.8-2.3"/><path d="M10.5 18.5c.45 1.25 1.5 2.2 1.5 2.2s1.05-.95 1.5-2.2"/></svg>` },
  { key: '💎', label: 'Gem', sm: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #a78bfa99);"><path d="M6.5 4.4h11l3.3 5-8.8 10.2-8.8-10.2z"/><path d="M3.2 9.4h17.6M9.3 9.4 12 19.6l2.7-10.2M6.5 4.4l2.8 5M17.5 4.4l-2.8 5"/></svg>`, lg: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #a78bfa99);"><path d="M6.5 4.4h11l3.3 5-8.8 10.2-8.8-10.2z"/><path d="M3.2 9.4h17.6M9.3 9.4 12 19.6l2.7-10.2M6.5 4.4l2.8 5M17.5 4.4l-2.8 5"/></svg>` },
  { key: '❤️', label: 'Heart', sm: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ff6b8a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #ff6b8a99);"><path d="M12 20.3s-7.4-4.6-7.4-9.5a4.2 4.2 0 0 1 7.4-2.7 4.2 4.2 0 0 1 7.4 2.7c0 4.9-7.4 9.5-7.4 9.5z"/></svg>`, lg: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#ff6b8a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #ff6b8a99);"><path d="M12 20.3s-7.4-4.6-7.4-9.5a4.2 4.2 0 0 1 7.4-2.7 4.2 4.2 0 0 1 7.4 2.7c0 4.9-7.4 9.5-7.4 9.5z"/></svg>` },
  { key: '😠', label: 'Angry', sm: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ff5c6c" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #ff5c6c99);"><circle cx="12" cy="12" r="8.8"/><path d="M8.1 8.5 10.8 10M15.9 8.5 13.2 10"/><path d="M9.5 12.4h.01M14.5 12.4h.01"/><path d="M9 16.9c1.7-1.4 4.3-1.4 6 0"/></svg>`, lg: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#ff5c6c" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;filter:drop-shadow(0 0 4px #ff5c6c99);"><circle cx="12" cy="12" r="8.8"/><path d="M8.1 8.5 10.8 10M15.9 8.5 13.2 10"/><path d="M9.5 12.4h.01M14.5 12.4h.01"/><path d="M9 16.9c1.7-1.4 4.3-1.4 6 0"/></svg>` },
];

// ── Chat reactions (server-backed via Worker) ────────────────────────────────
// Reactions live in the Worker KV (chat-react:<txHash>) so they're shared by
// everyone and survive cache clears / device changes. We keep an in-memory
// cache for the current render: { txHash: { emoji: { count, voters:[...] } } }
window._chatReactions = {};

function getMyWallet() { return globalWalletAddress || connectedAddress || null; }

// Fetch reactions for the currently shown messages, then re-render the rows.
async function loadChatReactions(txHashes) {
  const hashes = (txHashes || []).filter(Boolean);
  if (!hashes.length) return;
  try {
    const res = await fetch(`${WORKER_URL}/chat/reactions?txHashes=${encodeURIComponent(hashes.join(','))}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const data = await res.json();
    window._chatReactions = data || {};
    // Re-render each reaction row in place
    for (const h of hashes) {
      const row = document.getElementById('reactions-' + h);
      if (row) row.outerHTML = buildReactionsRow(h);
    }
  } catch(e) { /* network issue - keep whatever we had */ }
}

async function toggleReaction(txHash, emoji) {
  const wallet = getMyWallet();
  if (!wallet) { alert('Connect wallet to react'); return; }

  // Optimistic update on the in-memory cache
  const r = window._chatReactions[txHash] || (window._chatReactions[txHash] = {});
  const cell = r[emoji] || { count: 0, voters: [] };
  const had = cell.voters.includes(wallet);
  if (had) { cell.voters = cell.voters.filter(w => w !== wallet); cell.count = cell.voters.length; }
  else { cell.voters = [...cell.voters, wallet]; cell.count = cell.voters.length; }
  if (cell.count === 0) delete r[emoji]; else r[emoji] = cell;

  const row = document.getElementById('reactions-' + txHash);
  if (row) row.outerHTML = buildReactionsRow(txHash);

  // Persist to Worker; roll back on failure
  try {
    const res = await fetch(`${WORKER_URL}/chat/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash, emoji, wallet }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('react failed: ' + res.status);
    const d = await res.json();
    // Adopt the server's authoritative count for this emoji
    const rr = window._chatReactions[txHash] || (window._chatReactions[txHash] = {});
    if (d.count > 0) {
      const existing = rr[emoji] || { voters: [] };
      // keep voters list roughly in sync (server is source of truth on count)
      if (d.reacted && !existing.voters.includes(wallet)) existing.voters.push(wallet);
      if (!d.reacted) existing.voters = existing.voters.filter(w => w !== wallet);
      existing.count = d.count;
      rr[emoji] = existing;
    } else {
      delete rr[emoji];
    }
    const row2 = document.getElementById('reactions-' + txHash);
    if (row2) row2.outerHTML = buildReactionsRow(txHash);
  } catch(e) {
    // Roll back the optimistic change
    const rb = window._chatReactions[txHash] || {};
    const c = rb[emoji] || { count: 0, voters: [] };
    if (had) { if (!c.voters.includes(wallet)) c.voters.push(wallet); }
    else { c.voters = c.voters.filter(w => w !== wallet); }
    c.count = c.voters.length;
    if (c.count === 0) delete rb[emoji]; else rb[emoji] = c;
    window._chatReactions[txHash] = rb;
    const row3 = document.getElementById('reactions-' + txHash);
    if (row3) row3.outerHTML = buildReactionsRow(txHash);
  }
}

function buildReactionsRow(txHash) {
  const wallet = getMyWallet();
  const r = window._chatReactions[txHash] || {};
  const active = CHAT_REACTIONS
    .map(x => { const cell = r[x.key]; return cell && cell.count > 0 ? { ...x, count: cell.count, mine: wallet && cell.voters.includes(wallet) } : null; })
    .filter(Boolean);
  return `<div id="reactions-${txHash}" class="chat-reactions-row">
    ${active.map(x => `<button class="chat-reaction ${x.mine?'my-reaction':''}" title="${x.label}" onclick="toggleReaction('${txHash}','${x.key}')">${x.sm} <span>${x.count}</span></button>`).join('')}
    <div class="reaction-picker-wrap">
      <button class="chat-reaction add-reaction-btn" title="Add reaction" onclick="toggleReactionPicker(this,event)">＋</button>
      <div class="reaction-picker">${CHAT_REACTIONS.map(x => `<button title="${x.label}" onclick="toggleReaction('${txHash}','${x.key}')">${x.lg}</button>`).join('')}</div>
    </div>
  </div>`;
}

// ── Reaction picker: single tap-to-open path (mobile + desktop) ──────────────
// style.css revealed the picker via :hover AND :focus-within. On mobile, tapping
// "＋" focuses it → :focus-within showed the picker at its (broken, absolute)
// position, clipped by .chat-page-messages' overflow → an empty box appeared,
// fighting the JS. Fix: neutralize hover/focus-within entirely (injected CSS
// below) and drive the picker from JS only, positioned fixed so the scroll
// container can't clip it. One code path, one tap, works everywhere.
function _closeAllReactionPickers(exceptPicker) {
  document.querySelectorAll('.reaction-picker.rp-show').forEach(p => {
    if (p === exceptPicker) return;
    p.classList.remove('rp-show');
    p.removeAttribute('style');
  });
}

function toggleReactionPicker(btn, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  const wrap = btn.closest('.reaction-picker-wrap');
  const picker = wrap && wrap.querySelector('.reaction-picker');
  if (!picker) return;
  const isOpen = picker.classList.contains('rp-show');

  _closeAllReactionPickers(picker);

  if (isOpen) { // second tap on the same button → close
    picker.classList.remove('rp-show');
    picker.removeAttribute('style');
    return;
  }

  picker.classList.add('rp-show');
  // Measure off-screen (display comes from .rp-show CSS), then place with fixed
  // coords from the button so overflow:auto on the message list can't clip it.
  picker.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;z-index:100000;';
  const br = btn.getBoundingClientRect();
  const pr = picker.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight, M = 8;

  let left = br.left;
  if (left + pr.width > vw - M) left = vw - pr.width - M;
  if (left < M) left = M;

  let top = br.top - pr.height - 6;   // prefer above the button
  if (top < M) top = br.bottom + 6;   // no room above → drop below
  if (top + pr.height > vh - M) top = Math.max(M, vh - pr.height - M);

  picker.style.cssText =
    `position:fixed;left:${Math.round(left)}px;top:${Math.round(top)}px;visibility:visible;z-index:100000;`;
}
window.toggleReactionPicker = toggleReactionPicker;

// Tap/scroll outside → close.
document.addEventListener('click', function(e) {
  if (e.target.closest('.reaction-picker-wrap')) return;
  _closeAllReactionPickers(null);
});
window.addEventListener('scroll', function() { _closeAllReactionPickers(null); }, true);

// Neutralize the hover/focus-within reveal from style.css and give .rp-show the
// only reveal path. Both use !important; .rp-show wins on higher specificity.
(function ensureReactionPickerCss() {
  if (document.getElementById('rp-open-css')) return;
  const s = document.createElement('style');
  s.id = 'rp-open-css';
  s.textContent =
    '.reaction-picker{display:none !important;}' +
    '.reaction-picker.rp-show{display:flex !important;visibility:visible !important;opacity:1 !important;pointer-events:auto !important;}';
  (document.head || document.documentElement).appendChild(s);
})();

let cachedMsgs = [];

function renderChatMessages(msgs) {
  cachedMsgs = msgs;
  const container = document.getElementById('chat-page-messages');
  if (!msgs || msgs.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:60px 20px;"><div style="font-size:32px;margin-bottom:12px;">💬</div>No messages yet - be the first to speak!</div>';
    return;
  }

  container.innerHTML = msgs.map(m => {
    const displayName = _getDisplayName(m.fullAddr, m.author);
    const avatar = _getProfileAvatar(m.fullAddr);
    const initials = displayName.slice(0,2).toUpperCase();

    // System message - protocol announcement
    if (m.isSystem) {
      const isPool = m.text.includes('Weekly Pool') || m.text.includes('Daily');
      const icon = isPool ? '🎰' : '🏛';
      const label = m.text.includes('Q&A') ? 'New Question Asked' : 'Oracle Draw Entry';
      const color = isPool ? 'rgba(123,92,255,0.18)' : 'rgba(245,197,24,0.08)';
      const borderColor = isPool ? 'rgba(123,92,255,0.25)' : 'rgba(245,197,24,0.2)';
      const labelColor = isPool ? 'var(--accent)' : 'var(--gold)';
      return `<div id="msg-${m.txHash}" style="padding:8px 0;border-bottom:1px solid rgba(30,51,88,0.3);">
        <div style="display:flex;align-items:center;gap:10px;background:${color};border:1px solid ${borderColor};border-radius:10px;padding:11px 14px;">
          <div style="font-size:20px;flex-shrink:0;">${icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:9px;color:${labelColor};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:2px;">${label}</div>
            <div style="font-size:12px;color:var(--muted);">${m.amount} LUNC → Protocol Treasury</div>
          </div>
          <a href="https://finder.terraport.finance/mainnet/tx/${m.txHash}" target="_blank" style="font-size:9px;color:var(--muted);text-decoration:none;flex-shrink:0;">🔗 ${m.time}</a>
        </div>
      </div>`;
    }

    // Avatar: profile image or colored initials
    const avatarHtml = avatar
      ? `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : `<span style="font-size:12px;font-weight:700;color:var(--accent);">${initials}</span>`;

    const rankBadge = m.fullAddr && window._walletScores && typeof getRankBadgeHTML === 'function'
      ? getRankBadgeHTML(window._walletScores[m.fullAddr] || 0) : '';

    // Avatar ring in the rank colour - the same signal as the badge, readable
    // at a glance while scrolling.
    const ring = (m.fullAddr && window._walletScores && typeof getRankRingCSS === 'function')
      ? getRankRingCSS(window._walletScores[m.fullAddr] || 0)
      : { border: 'rgba(84,147,247,0.2)', shadow: 'none' };

    return `
    <div class="chat-page-msg" id="msg-${m.txHash}" style="padding:14px 0;border-bottom:1px solid rgba(30,51,88,0.35);">
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <!-- Avatar (click → profile) -->
        <div onclick="openUserProfile('${m.fullAddr || ''}')" title="View profile" style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,rgba(84,147,247,0.2),rgba(123,92,255,0.25));border:2px solid ${ring.border};box-shadow:${ring.shadow};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;cursor:pointer;transition:transform 0.12s,border-color 0.12s;"
          onmouseover="this.style.transform='scale(1.08)'"
          onmouseout="this.style.transform='scale(1)'">
          ${avatarHtml}
        </div>
        <!-- Content -->
        <div style="flex:1;min-width:0;">
          <!-- Header row -->
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;flex-wrap:wrap;">
            <span onclick="openUserProfile('${m.fullAddr || ''}')" style="font-size:13px;font-weight:700;color:var(--text);cursor:pointer;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text)'">${displayName}</span>
            ${rankBadge}
            <a href="https://finder.terraport.finance/mainnet/tx/${m.txHash}" target="_blank"
              style="font-size:9px;color:var(--muted);text-decoration:none;margin-left:auto;white-space:nowrap;flex-shrink:0;"
              onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--muted)'">
              🔗 ${m.time}
            </a>
          </div>
          <!-- Message text -->
          <!-- Reply quote -->
          ${m.replyTo ? (() => {
            const orig = cachedMsgs.find(x => x.txHash && x.txHash.startsWith(m.replyTo));
            if (!orig) return '';
            const origName = _getDisplayName(orig.fullAddr, orig.author);
            return `<div style="margin-bottom:8px;padding:6px 10px;background:rgba(84,147,247,0.07);border-left:2px solid var(--accent);border-radius:0 6px 6px 0;cursor:pointer;" onclick="document.getElementById('msg-${orig.txHash}')?.scrollIntoView({behavior:'smooth'})">
              <div style="font-size:10px;color:var(--accent);font-weight:700;margin-bottom:2px;display:flex;align-items:center;gap:4px;"><span style="font-style:normal;">&#x21A9;&#xFE0E;</span>${origName}</div>
              <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${orig.text.slice(0,80)}</div>
            </div>`;
          })() : ''}
          <!-- Message text -->
          <div style="font-size:14px;line-height:1.65;color:rgba(232,240,255,0.92);word-break:break-word;">${m.text}</div>
          <!-- Reactions -->
          ${buildReactionsRow(m.txHash)}
          <!-- Reply button -->
          <button
            data-reply-txhash="${m.txHash}"
            data-reply-author="${(_getDisplayName(m.fullAddr, m.author)).replace(/"/g,'&quot;')}"
            data-reply-text="${m.text.replace(/"/g,'&quot;').replace(/\n/g,' ').slice(0,80)}"
            style="margin-top:6px;background:none;border:none;color:var(--muted);font-size:11px;font-family:'Exo 2',sans-serif;cursor:pointer;padding:2px 0;letter-spacing:0.03em;display:inline-flex;align-items:center;gap:4px;"
            onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--muted)'">
            <span style="font-style:normal;font-size:12px;line-height:1;">&#x21A9;&#xFE0E;</span>
            Reply
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  // Pull shared reactions from the Worker and refresh the rows
  loadChatReactions(msgs.map(m => m.txHash).filter(Boolean));
  // Build the participants panel from everyone who has posted
  renderChatParticipants(msgs);
}

// ── Chat participants panel (desktop side + mobile drawer) ───────────────────
function renderChatParticipants(msgs) {
  // "Recently active" - wallets that posted in the last 24 hours.
  // Fully on-chain: derived from message timestamps, no tracking server.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - DAY_MS;
  const seen = new Set();
  const wallets = [];
  // Newest first so the most recently active appear on top
  for (const m of [...msgs].sort((a, b) => (b.ts || 0) - (a.ts || 0))) {
    const w = m.fullAddr;
    if (!w || !w.startsWith('terra1')) continue;
    if ((m.ts || 0) < cutoff) continue;       // older than 24h - skip
    if (seen.has(w)) continue;
    seen.add(w); wallets.push(w);
  }
  const count = wallets.length;

  const rowHtml = (w) => {
    const short = w.slice(0, 8) + '...' + w.slice(-4);
    const init = w.slice(0, 2).toUpperCase();
    const rankHtml = (window._walletScores && typeof getRankBadgeHTML === 'function')
      ? getRankBadgeHTML(window._walletScores[w] || 0) : '';
    return `<div class="chat-participant" onclick="openUserProfile('${w}')">
      <div class="cp-av">${init}</div>
      <div style="min-width:0;">
        <div class="cp-addr">${short}</div>
        ${rankHtml ? `<div class="cp-rank">${rankHtml}</div>` : ''}
      </div>
    </div>`;
  };

  const listHtml = wallets.length
    ? wallets.map(rowHtml).join('')
    : '<div style="font-size:11px;color:var(--muted);text-align:center;padding:16px 0;">No one active in the last 24h</div>';


  // Desktop side panel
  const sideList = document.getElementById('chat-participants-list');
  if (sideList) sideList.innerHTML = listHtml;
  const sideCount = document.getElementById('chat-participants-count');
  if (sideCount) sideCount.textContent = count;

  // Mobile drawer + button count
  const drawerList = document.getElementById('chat-drawer-list');
  if (drawerList) drawerList.innerHTML = listHtml;
  const drawerCount = document.getElementById('chat-drawer-count');
  if (drawerCount) drawerCount.textContent = count;
  const mobileCount = document.getElementById('chat-mobile-pcount');
  if (mobileCount) mobileCount.textContent = count;
}

window.openChatParticipants = function() {
  document.getElementById('chat-drawer-overlay')?.classList.add('open');
  document.getElementById('chat-drawer')?.classList.add('open');
};
window.closeChatParticipants = function() {
  document.getElementById('chat-drawer-overlay')?.classList.remove('open');
  document.getElementById('chat-drawer')?.classList.remove('open');
};

// ── User profile modal (opened from chat avatar/name click) ──────────────────
window.openUserProfile = async function(wallet) {
  if (!wallet || !wallet.startsWith('terra1')) return;

  // Remove any existing modal
  const existing = document.getElementById('user-profile-modal');
  if (existing) existing.remove();

  const shortAddr = wallet.slice(0, 10) + '...' + wallet.slice(-6);
  const rankBadge = (window._walletScores && typeof getRankBadgeHTML === 'function')
    ? getRankBadgeHTML(window._walletScores[wallet] || 0) : '';

  // Build modal shell with loading placeholders
  const modal = document.createElement('div');
  modal.id = 'user-profile-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);padding:20px;';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:linear-gradient(160deg,#0e1830,#0a1120);border:1px solid rgba(84,147,247,0.25);border-radius:16px;max-width:420px;width:100%;padding:0;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="padding:22px 22px 18px;border-bottom:1px solid rgba(30,51,88,0.5);position:relative;">
        <button onclick="document.getElementById('user-profile-modal').remove()" style="position:absolute;top:14px;right:14px;background:rgba(255,255,255,0.06);border:none;color:var(--muted);width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:15px;line-height:1;">✕</button>
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,rgba(84,147,247,0.25),rgba(123,92,255,0.3));border:1px solid rgba(84,147,247,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="font-size:17px;font-weight:700;color:var(--accent);">${wallet.slice(0,2).toUpperCase()}</span>
          </div>
          <div style="min-width:0;">
            <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px;">${shortAddr}</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${rankBadge}<span style="font-size:9px;background:rgba(102,255,170,0.12);color:var(--green);padding:1px 7px;border-radius:4px;">✓ ON-CHAIN</span></div>
          </div>
        </div>
      </div>
      <div style="padding:20px 22px;">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
          <div style="text-align:center;background:rgba(84,147,247,0.06);border:1px solid rgba(84,147,247,0.15);border-radius:12px;padding:14px 8px;">
            <div id="up-rep" style="font-size:22px;font-weight:800;color:var(--accent);font-family:Rajdhani,sans-serif;">…</div>
            <div style="font-size:10px;color:var(--muted);letter-spacing:0.08em;margin-top:3px;">REP</div>
          </div>
          <div style="text-align:center;background:rgba(245,197,24,0.06);border:1px solid rgba(245,197,24,0.15);border-radius:12px;padding:14px 8px;">
            <div id="up-draw" style="font-size:22px;font-weight:800;color:var(--gold);font-family:Rajdhani,sans-serif;">…</div>
            <div style="font-size:10px;color:var(--muted);letter-spacing:0.08em;margin-top:3px;">DRAW REP</div>
          </div>
          <div style="text-align:center;background:rgba(123,92,255,0.06);border:1px solid rgba(123,92,255,0.15);border-radius:12px;padding:14px 8px;">
            <div id="up-nfts" style="font-size:22px;font-weight:800;color:#9d7bff;font-family:Rajdhani,sans-serif;">…</div>
            <div style="font-size:10px;color:var(--muted);letter-spacing:0.08em;margin-top:3px;">NFTs</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:12px;">
          <div style="text-align:center;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:12px 8px;">
            <div id="up-chat" style="font-size:18px;font-weight:700;color:var(--text);font-family:Rajdhani,sans-serif;">…</div>
            <div style="font-size:10px;color:var(--muted);letter-spacing:0.08em;margin-top:3px;">CHAT MESSAGES</div>
          </div>
          <div style="text-align:center;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:12px 8px;">
            <div id="up-streak" style="font-size:18px;font-weight:700;color:var(--text);font-family:Rajdhani,sans-serif;">…</div>
            <div style="font-size:10px;color:var(--muted);letter-spacing:0.08em;margin-top:3px;">STREAK 🔥</div>
          </div>
        </div>
        <a href="https://finder.terraport.finance/mainnet/address/${wallet}" target="_blank" style="display:block;text-align:center;margin-top:16px;font-size:11px;color:var(--accent);text-decoration:none;">🔗 View wallet on Finder</a>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // Fetch stats in parallel; fill in as they resolve (each independently)
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  // Draw REP
  fetch(`${WORKER_URL}/rep/draw?wallet=${wallet}`).then(r => r.json()).then(d => {
    setText('up-draw', (d && d.total ? d.total : 0).toLocaleString());
  }).catch(() => setText('up-draw', '0'));

  // Total REP (from weekly score map if present, else draw rep)
  const totalRep = (window._walletScores && window._walletScores[wallet]) || 0;
  setText('up-rep', totalRep.toLocaleString());

  // Chat messages + streak
  fetch(`${WORKER_URL}/chat/count?wallet=${wallet}`).then(r => r.json()).then(d => {
    setText('up-chat', (d && d.total ? d.total : 0).toLocaleString());
  }).catch(() => setText('up-chat', '0'));

  fetch(`${WORKER_URL}/streak?wallet=${wallet}`).then(r => r.json()).then(d => {
    setText('up-streak', (d && d.currentStreak ? d.currentStreak : 0) + 'd');
  }).catch(() => setText('up-streak', '0d'));

  // NFT count - query the CW721 contracts directly via LCD (fast, no Paco/CORS).
  // Sums Daily + Weekly Oracle Mask collections owned by this wallet.
  (async () => {
    const LCD = 'https://terra-classic-lcd.publicnode.com';
    const CONTRACTS = [
      'terra1py527m8kv3473gs8kfjez0qjm0yxgm7jjpv6v5ct3scvrvdvx8pqswyea0', // Daily
      'terra1jkl6r2d9sycvm3zg8l9y6lwcqsr8mfy24mxxe7utqgn0sv7ljnhq9ka49p', // Weekly
    ];
    try {
      const counts = await Promise.all(CONTRACTS.map(async (c) => {
        try {
          const q = btoa(JSON.stringify({ tokens: { owner: wallet, limit: 100 } }));
          const r = await fetch(`${LCD}/cosmwasm/wasm/v1/contract/${c}/smart/${q}`, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) return 0;
          const d = await r.json();
          return Array.isArray(d.data?.tokens) ? d.data.tokens.length : 0;
        } catch(e) { return 0; }
      }));
      const total = counts.reduce((s, n) => s + n, 0);
      setText('up-nfts', total.toLocaleString());
    } catch(e) {
      setText('up-nfts', '-');
    }
  })();
};

async function loadChatFromChain() {
  updateChatEntryProgress();  // прогресс к бесплатной entry над полем ввода
  const container = document.getElementById('chat-page-messages');
  if (!cachedMsgs.length) {
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;"><div style="font-size:22px;margin-bottom:10px;">⏳</div><div style="color:var(--muted);font-size:12px;">Loading messages from blockchain...</div></div>`;
  }
  // Use Oracle Draw Worker proxy - bypasses CORS/DNS issues and falls back across multiple nodes server-side
  let txList = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(
      `https://oracle-draw.vladislav-baydan.workers.dev/proxy-txs?wallet=${CHAT_HISTORY_WALLET}&limit=50`,
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const body = await res.json();
      // Worker returns FCD-shape: { txs: [{ txhash, timestamp, tx: { value: { memo, msg } } }] }
      // Convert to LCD-shape that the parser below expects (txs[] + tx_responses[])
      const rawTxs = body.txs || [];
      txList = {
        txs: rawTxs.map(t => ({
          body: {
            memo: t.tx?.value?.memo || '',
            messages: (t.tx?.value?.msg || []).map(m => ({
              '@type': '/cosmos.bank.v1beta1.MsgSend',
              from_address: m.value?.from_address || '',
              to_address:   m.value?.to_address   || '',
              amount:       m.value?.amount        || [],
            })),
          },
        })),
        tx_responses: rawTxs.map(t => ({
          txhash:    t.txhash || '',
          timestamp: t.timestamp || '',
          code:      t.code || 0,
        })),
      };
    }
  } catch(e) {
    console.warn('Chat: Worker proxy failed:', e.message);
  }
  if (!txList) {
    if (!cachedMsgs.length) {
      container.innerHTML = `<div style="text-align:center;padding:40px 20px;"><div style="font-size:22px;margin-bottom:10px;">⚠️</div><div style="color:var(--muted);font-size:12px;">Could not reach blockchain nodes</div><button onclick="loadChatFromChain()" style="margin-top:14px;background:rgba(84,147,247,0.1);border:1px solid rgba(84,147,247,0.25);color:var(--accent);border-radius:8px;padding:7px 16px;font-family:'Exo 2',sans-serif;font-size:11px;cursor:pointer;">↻ Retry now</button></div>`;
    }
    return;
  }
  // LCD v1beta1: txs[] = tx bodies, tx_responses[] = metadata (hash, timestamp)
  // They are parallel arrays - same index = same transaction
  const txBodies    = txList.txs || [];
  const txResponses = txList.tx_responses || [];
  if (!txBodies.length && !txResponses.length) {
    if (!cachedMsgs.length) container.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:40px;">No messages yet - be the first!</div>';
    return;
  }
  const msgs = [];
  const count = Math.max(txBodies.length, txResponses.length);
  for (let i = 0; i < count; i++) {
    try {
      const txBody = txBodies[i];        // has body.messages, body.memo
      const txMeta = txResponses[i];     // has txhash, timestamp
      const rawMemo = txBody?.body?.memo || '';
      if (!rawMemo || rawMemo.trim() === '') continue;
      // Fix emoji: LCD may return UTF-8 bytes misread as Latin-1 - re-decode
      let memo = rawMemo;
      try {
        const bytes = Uint8Array.from(rawMemo, c => c.charCodeAt(0) & 0xFF);
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (decoded !== rawMemo) memo = decoded;
      } catch(e) { /* keep original if not valid UTF-8 sequence */ }
      // Try base64 decode - system memos are sometimes base64-encoded
      try {
        const b64decoded = decodeURIComponent(escape(atob(memo.trim())));
        if (b64decoded && b64decoded.length > 0) memo = b64decoded;
      } catch(e) { /* not base64 - keep as-is */ }
      const txMsgs = txBody?.body?.messages || [];
      let sender = null, luncAmount = 0;
      for (const msg of txMsgs) {
        const type = msg['@type'] || msg.type || '';
        const val  = msg.value || msg;
        if (type.includes('MsgSend')) {
          const to = val.to_address || '';
          if (to === CHAT_WALLET) {
            sender = val.from_address || null;
            const coins = val.amount || [];
            const lunc = Array.isArray(coins) ? coins.find(c => c.denom === 'uluna') : null;
            luncAmount = lunc ? parseInt(lunc.amount) : 0;
          }
        }
      }
      if (!sender || luncAmount < CHAT_MIN_ULUNA) continue;
      // Filter out system/admin wallets - their transfers are not chat messages
      const SYSTEM_WALLETS = [
        'terra15jt5a9ycsey4hd6nlqgqxccl9aprkmg2mxmfc6', // ADMIN
        'terra1549z8zd9hkggzlwf0rcuszhc9rs9fxqfy2kagt', // TREASURY
        'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px',  // DAILY
        'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz',  // WEEKLY
        'terra16m05j95p9qvq93cdtchjcpwgvny8f57vzdj06p',  // COLLECTION
      ];
      if (SYSTEM_WALLETS.includes(sender)) continue;
      // Block amounts far above 5,000 LUNC (±2% tolerance for tax) - not chat payments
      if (luncAmount > 5200000000) continue;
      const short = sender.slice(0, 10) + '...' + sender.slice(-4);
      const luncFormatted = (luncAmount / 1000000).toLocaleString(undefined, {maximumFractionDigits: 0});
      const ts = txMeta?.timestamp ? new Date(txMeta.timestamp) : null;
      const timeStr = ts ? ts.toLocaleDateString([], {month:'short',day:'numeric'}) + ' ' + ts.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
      let replyTo = null, displayText = memo.slice(0, 256);
      const replyMatch = memo.match(/^>([A-Fa-f0-9]{16})\|(.*)$/s);
      if (replyMatch) { replyTo = replyMatch[1]; displayText = replyMatch[2]; }
      msgs.push({ author: short, fullAddr: sender, text: displayText, replyTo, amount: luncFormatted, txHash: txMeta?.txhash || '', time: timeStr, ts: ts ? ts.getTime() : 0,
        isSystem: ['Terra Oracle Q&A - Weekly Pool','Terra Oracle Q&A - Treasury','Oracle Draw - Daily','Oracle Draw - Weekly'].includes(memo.trim())
      });
    } catch(e) { continue; }
  }
  msgs.sort((a, b) => a.ts - b.ts);
  // Badges and avatar rings read window._walletScores, which a questions reload
  // may have reset in the meantime.
  if (typeof applyWalletScores === 'function') applyWalletScores();
  if (typeof upgradeWalletScores === 'function') upgradeWalletScores();
  renderChatMessages(msgs);
  // Prefetch profiles for chat authors (background, no re-render)
  if (typeof prefetchProfiles === 'function') {
    const addrs = [...new Set(msgs.map(m => m.fullAddr).filter(Boolean))];
    prefetchProfiles(addrs); // fire-and-forget
  }
}


// ── POOL MILESTONE BANNER ─────────────────────────────────────────────────
const DAILY_POOL_WALLET  = 'terra1amp68zg7vph3nq84ummnfma4dz753ezxfqa9px';
const WEEKLY_POOL_WALLET = 'terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz';

const POOL_MILESTONES = [
  { min: 5000000,    label: '💎 JACKPOT TERRITORY', color: '#00ffff', glow: 'rgba(0,255,255,0.3)',   bg: 'rgba(0,255,255,0.06)',   border: 'rgba(0,255,255,0.25)'  },
  { min: 1000000,    label: '⚡ ON FIRE',           color: '#ffd700', glow: 'rgba(255,215,0,0.3)',   bg: 'rgba(255,215,0,0.06)',   border: 'rgba(255,215,0,0.25)'  },
  { min: 500000,     label: '🔥 HEATING UP',        color: '#ff8844', glow: 'rgba(255,136,68,0.3)',  bg: 'rgba(255,136,68,0.06)',  border: 'rgba(255,136,68,0.25)' },
  { min: 100000,     label: '🌱 GROWING',           color: '#66ffaa', glow: 'rgba(102,255,170,0.3)', bg: 'rgba(102,255,170,0.05)', border: 'rgba(102,255,170,0.2)' },
  { min: 0,          label: '🌑 JUST STARTED',      color: '#6b82a8', glow: 'rgba(107,130,168,0.2)', bg: 'rgba(107,130,168,0.04)', border: 'rgba(107,130,168,0.15)' },
];

function getPoolMilestone(lunc) {
  return POOL_MILESTONES.find(m => lunc >= m.min) || POOL_MILESTONES[POOL_MILESTONES.length - 1];
}

async function fetchPoolBalance(walletAddr) {
  try {
    const res = await fetch(`https://terra-classic-lcd.publicnode.com/cosmos/bank/v1beta1/balances/${walletAddr}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return 0;
    const data = await res.json();
    const uluna = data.balances?.find(b => b.denom === 'uluna');
    return uluna ? parseInt(uluna.amount) / 1000000 : 0;
  } catch(e) { return 0; }
}

async function renderPoolMilestoneBanner() {
  const container = document.getElementById('chat-pool-milestone');
  if (!container) return;

  const [daily, weekly] = await Promise.all([
    fetchPoolBalance(DAILY_POOL_WALLET),
    fetchPoolBalance(WEEKLY_POOL_WALLET),
  ]);

  const pools = [
    { name: 'DAILY POOL',  amount: daily,  icon: '☀️' },
    { name: 'WEEKLY POOL', amount: weekly, icon: '📅' },
  ];

  container.innerHTML = pools.map(pool => {
    const ms = getPoolMilestone(pool.amount);
    const formatted = pool.amount >= 1000000
      ? (pool.amount / 1000000).toFixed(2) + 'M'
      : pool.amount >= 1000
      ? Math.round(pool.amount / 1000) + 'K'
      : Math.round(pool.amount).toString();

    // Progress to next milestone
    const nextMs = POOL_MILESTONES.find(m => m.min > pool.amount);
    const pct = nextMs
      ? Math.min(100, (pool.amount / nextMs.min) * 100)
      : 100;

    return `
    <div style="flex:1;min-width:200px;background:${ms.bg};border:1px solid ${ms.border};border-radius:12px;padding:14px 16px;position:relative;overflow:hidden;">
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% -20%,${ms.glow},transparent 70%);pointer-events:none;"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:16px;">${pool.icon}</span>
        <div>
          <div style="font-size:9px;letter-spacing:0.15em;color:var(--muted);text-transform:uppercase;">${pool.name}</div>
          <div style="font-size:9px;color:${ms.color};font-weight:700;letter-spacing:0.1em;">${ms.label}</div>
        </div>
      </div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:26px;font-weight:800;color:${ms.color};line-height:1;margin-bottom:8px;text-shadow:0 0 20px ${ms.glow};">
        ${formatted} <span style="font-size:13px;opacity:0.7;">LUNC</span>
      </div>
      ${nextMs ? `
      <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:3px;margin-bottom:4px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${ms.color};border-radius:4px;transition:width 1s ease;opacity:0.8;"></div>
      </div>
      <div style="font-size:9px;color:var(--muted);">
        ${(nextMs.min - pool.amount).toLocaleString(undefined,{maximumFractionDigits:0})} LUNC to next level
      </div>` : `<div style="font-size:9px;color:${ms.color};">🏆 Maximum level reached!</div>`}
    </div>`;
  }).join('');
}

function renderChatPage() {
  if (cachedMsgs.length) renderChatMessages(cachedMsgs);
  loadChatFromChain();
  renderPoolMilestoneBanner();
}
// Wait for all scripts to load before initializing
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { renderChatPage(); });
} else {
  renderChatPage();
}
setInterval(loadChatFromChain, 60000); // 60s poll - reduced from 30s for performance

// ── Auto-refresh: pool balance + questions every 30s ──────────────────────────
(function startAutoRefresh() {
  setInterval(() => {
    // Refresh pool balance silently
    if (typeof fetchPoolBalance === 'function') {
      fetchPoolBalance('terra1p5l6q95kfl3hes7edy76tywav9f79n6xlkz6qz').catch(() => {});
    }
    // Refresh questions if on home/ask page
    if (typeof loadQuestionsFromWorker === 'function') {
      loadQuestionsFromWorker().catch(() => {});
    }
    // Refresh vote counts if on vote page
    if (typeof loadVotesFromWorker === 'function') {
      const votePage = document.getElementById('vote-page');
      if (votePage && votePage.style.display !== 'none') {
        loadVotesFromWorker().catch(() => {});
      }
    }
  }, 30000);
})();

const _origSetWallet = window.setWalletConnected;
window.setWalletConnected = function(address) {
  _origSetWallet(address);
  document.getElementById('chat-page-connect-prompt').style.display = 'none';
  document.getElementById('chat-page-form').style.display = 'block';
  document.getElementById('chat-page-addr').textContent = address.slice(0,10)+'...'+address.slice(-4);
  document.getElementById('vote-wallet-status').innerHTML = '<span style="font-size:11px;color:var(--green);">✓ ' + address.slice(0,8)+'...'+address.slice(-4) + '</span>';
  const adminPanel = document.getElementById('admin-panel');
  if (adminPanel) {
    adminPanel.style.display = address === ADMIN_WALLET ? 'block' : 'none';
    if (address === ADMIN_WALLET) { applyVoteStates(); updateAdminPanel(); setTimeout(_adminInitOptions, 100); }
  }
  applyStoredVotes(); applyVoteStates(); renderVotes();
}

