// ── POLL OPTIONS ──────────────────────────────────────────────
let pollOptions = [];

// The inputs are the source of truth, not the array. The array only survives
// between renders, and anything that fails to write back to it - as the old
// inline oninput did - left the typed text visible on screen but absent from
// the data, so questions posted with no poll at all.
function syncPollFromDOM() {
  const list = document.getElementById('poll-options-list');
  if (!list) return;
  const vals = Array.from(list.querySelectorAll('input[type="text"]')).map(el => el.value);
  if (vals.length) pollOptions = vals;
  updatePollHidden();
}

function addPollOption() {
  syncPollFromDOM();
  if (pollOptions.length >= 5) return;
  const idx = pollOptions.length;
  pollOptions.push('');
  renderPollOptions();
  // Focus new input
  setTimeout(() => {
    const inp = document.getElementById('poll-opt-' + idx);
    if (inp) inp.focus();
  }, 50);
}

function removePollOption(idx) {
  syncPollFromDOM();
  pollOptions.splice(idx, 1);
  renderPollOptions();
}

function renderPollOptions() {
  const list = document.getElementById('poll-options-list');
  const btn  = document.getElementById('add-poll-btn');
  if (!list) return;
  list.innerHTML = pollOptions.map((opt, i) => `
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="text" id="poll-opt-${i}" value="${opt.replace(/"/g,'&quot;')}"
        placeholder="Option ${i+1}"
        maxlength="100"
        style="flex:1;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);font-size:12px;font-family:'Exo 2',sans-serif;">
      <button type="button" onclick="removePollOption(${i})"
        style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(255,60,60,0.3);background:rgba(255,60,60,0.06);color:#ff6464;cursor:pointer;font-size:14px;flex-shrink:0;">×</button>
    </div>
  `).join('');
  if (btn) btn.style.display = pollOptions.length >= 5 ? 'none' : 'inline-block';

  // Bound in JS rather than as an inline attribute: an inline handler that
  // cannot resolve its identifiers fails silently, which is exactly how the
  // typed options went missing.
  list.querySelectorAll('input[type="text"]').forEach((el, i) => {
    el.addEventListener('input', () => {
      pollOptions[i] = el.value;
      updatePollHidden();
    });
  });

  updatePollHidden();
}

function updatePollHidden() {
  const hidden = document.getElementById('poll-options-hidden');
  if (hidden) hidden.value = JSON.stringify(pollOptions.map(o => String(o).trim()).filter(Boolean));
}

// Reset poll when form resets
function resetPollOptions() {
  pollOptions = [];
  renderPollOptions();
}
