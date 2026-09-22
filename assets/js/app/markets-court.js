/**
 * markets-court.js - спор и суд на экране рынка.
 *
 * Два блока, которые markets.js вставляет в экран рынка:
 *
 *   proposed  - "Оспорить исход": залог, своё показание, одна кнопка.
 *   disputed  - дело в суде: счёт голосов, время до конца, показания
 *               обеих сторон, голосование для допущенных и закрытие дела,
 *               которое может выполнить кто угодно.
 *
 * Суд - отдельный контракт oracle-court, арбитр рынка. Кто может голосовать
 * и почему нет, решает сам суд: интерфейс спрашивает can_vote и показывает
 * его ответ, а не повторяет проверки у себя. Иначе страница и контракт
 * рано или поздно разойдутся.
 *
 * Загружать ПОСЛЕ markets.js: оттуда адреса, сеть, prophecyQuery и хелперы.
 */

(function () {
  'use strict';

  // ── чтение ────────────────────────────────────────────────────────────────

  async function courtQuery(msg) {
    const q = btoa(JSON.stringify(msg));
    for (const base of PROPHECY_LCD) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10000);
      try {
        const r = await fetch(`${base}/cosmwasm/wasm/v1/contract/${COURT_CONTRACT}/smart/${q}`, {
          headers: { Accept: 'application/json' },
          signal: ctl.signal,
        });
        if (!r.ok) continue;
        return (await r.json()).data;
      } catch (e) {
        /* следующий узел */
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error('court unavailable');
  }

  let courtCfg = null;
  async function loadCourtConfig() {
    if (courtCfg || !COURT_CONTRACT) return courtCfg;
    try { courtCfg = await courtQuery({ config: {} }); } catch (e) { /* не критично */ }
    return courtCfg;
  }

  function nowSecs() { return Math.floor(Date.now() / 1000); }

  function leftText(until) {
    const s = until - nowSecs();
    if (s <= 0) return '';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${Math.max(m, 1)}m`;
  }

  /** Контракт отвечает техническим языком. Человеку - обычным. */
  function humanReason(r) {
    const s = String(r || '');
    if (s.includes('challenger')) return 'You opened this dispute, so you cannot judge it.';
    if (s.includes('resolver')) return 'You posted the reading under dispute, so you cannot judge it.';
    if (s.includes('stake in this market')) return 'You have a stake in this market, so you cannot judge it.';
    if (s.includes('Not eligible')) return 'Only the council votes for now. Oracle Vault holders will join later.';
    if (s.includes('Already voted')) return 'You have already voted in this case.';
    if (s.includes('Voting has ended')) return 'Voting has ended.';
    if (s.includes('not under dispute')) return 'This market is no longer under dispute.';
    return s || 'You cannot vote in this case.';
  }

  // ── оспаривание ───────────────────────────────────────────────────────────

  function challengeBlock(m) {
    const cfg = typeof prophecyCfg !== 'undefined' ? prophecyCfg : null;
    // Старый контракт без залога оспаривания - блок не показываем, а не
    // отправляем сообщение, которое он не поймёт.
    if (!cfg || !cfg.challenge_bond || !COURT_CONTRACT) return '';
    const ends = Number(m.proposed_at) + Number(cfg.challenge_secs);
    const left = leftText(ends);
    if (!left) return '';
    const bond = fmtLunc(cfg.challenge_bond);
    const me = window.globalWalletAddress;
    const blocked = me && me === cfg.resolver
      ? 'You posted this outcome, so you cannot dispute it.'
      : '';

    return `
    <section class="card mk-court">
      <h3>Think the outcome is wrong?</h3>
      <p class="mk-lead-sm">Anyone can dispute it for the next <b>${left}</b>. Attach a bond of
        <b>${bond} LUNC</b> and say what the chain actually shows. The court decides.</p>
      <div class="mk-court-rules">
        <div><span class="y">You were right</span>bond back, plus the market's protocol fee</div>
        <div><span class="n">You were wrong</span>the bond goes to the boost fund</div>
        <div><span>No decision</span>the market is voided and everyone, you included, is refunded</div>
      </div>
      ${blocked
        ? `<div class="mk-plain">${blocked}</div>`
        : `<label class="mk-court-field">
             <span>What does the chain show?</span>
             <textarea id="ch-reading" rows="3" maxlength="500"
               placeholder="e.g. supply at block 30240807 is 6,450,430,502 LUNC, above the threshold"></textarea>
           </label>
           <button class="ask-go mk-place" id="ch-go" onclick="submitChallenge()">
             Dispute · ${bond} LUNC &rarr;</button>`}
    </section>`;
  }

  window.submitChallenge = async function () {
    const m = window._prophecyMarket;
    const cfg = prophecyCfg;
    const btn = document.getElementById('ch-go');
    const reading = ((document.getElementById('ch-reading') || {}).value || '').trim();
    if (!m || !btn) return;
    if (!window.globalWalletAddress) { alert('Connect a wallet first.'); return; }
    if (!reading) { alert('Say what the chain actually shows - the court reads it.'); return; }

    btn.disabled = true;
    btn.textContent = 'Confirm in your wallet…';
    try {
      const hash = await window.sendExecuteContract(
        window.globalWalletAddress, PROPHECY_CONTRACT,
        { challenge: { market_id: m.id, reading } },
        [{ denom: 'uluna', amount: String(cfg.challenge_bond) }],
        'oracle-prophecy: challenge ' + m.id, PROPHECY_CHAIN, 600000
      );
      console.log('[prophecy] challenge tx', hash);
      btn.textContent = 'Sent, waiting for the block…';
      setTimeout(() => openProphecyMarket(m.id), 7000);
    } catch (e) {
      alert(e.message || 'Transaction failed');
      btn.disabled = false;
      btn.textContent = 'Dispute →';
    }
  };

  // ── дело в суде ───────────────────────────────────────────────────────────

  async function caseBlock(m) {
    if (!COURT_CONTRACT) {
      return `<section class="card mk-court"><h3>Under dispute</h3>
        <p class="mk-lead-sm">Payouts are closed until the arbiter decides.</p></section>`;
    }
    const [cc, kase] = await Promise.all([
      loadCourtConfig(),
      courtQuery({ case: { market_id: m.id } }).catch(() => null),
    ]);
    const endsAt = kase ? Number(kase.ends_at)
      : Number(m.disputed_at) + Number((cc && cc.voting_secs) || 0);
    const left = leftText(endsAt);
    const closed = kase && kase.closed;
    const y = kase ? kase.yes : 0;
    const n = kase ? kase.no : 0;
    const v = kase ? kase.void : 0;
    const quorum = kase ? kase.quorum : (cc ? cc.quorum : '?');
    const total = y + n + v;

    let action = '';
    const me = window.globalWalletAddress;
    if (!closed && left && me) {
      const [can, mine] = await Promise.all([
        courtQuery({ can_vote: { market_id: m.id, address: me } }).catch(() => null),
        courtQuery({ vote: { market_id: m.id, address: me } }).catch(() => null),
      ]);
      if (mine && mine.choice) {
        action = `<div class="mk-plain">You voted <b>${String(mine.choice).toUpperCase()}</b>.</div>`;
      } else if (can && can.can) {
        action = `
          <div class="mk-vote-row">
            <button class="mk-vote y" onclick="courtVote('yes')">YES</button>
            <button class="mk-vote n" onclick="courtVote('no')">NO</button>
            <button class="mk-vote v" onclick="courtVote('void')">VOID</button>
          </div>
          <div class="mk-plain">Judge by the chain, not by who is asking. VOID means the
            reading cannot be settled either way; everyone is refunded.</div>`;
      } else if (can) {
        action = `<div class="mk-plain">${humanReason(can.reason)}</div>`;
      }
    } else if (!closed && left && !me) {
      action = '<div class="mk-plain">Connect a wallet to see whether you can vote.</div>';
    } else if (!closed && !left) {
      // Закрыть может кто угодно: дело не должно зависнуть из-за того,
      // что все ушли.
      action = `
        <button class="ask-go mk-place" id="court-close" onclick="courtClose()">
          Close the case and send the decision &rarr;</button>
        <div class="mk-plain">Voting has ended. Anyone can close the case; it costs gas only.</div>`;
    }

    return `
    <section class="card mk-court">
      <h3>In court${left && !closed ? ` · <span class="mk-left">${left} left</span>` : ''}</h3>
      <div class="mk-claims">
        <div><span>Resolver says</span><b class="${m.outcome ? 'y' : 'n'}">${m.outcome ? 'YES' : 'NO'}</b>
          ${m.reading ? `<p>${mktEsc(m.reading)}</p>` : ''}</div>
        <div><span>Challenger says</span><b class="${m.outcome ? 'n' : 'y'}">${m.outcome ? 'NO' : 'YES'}</b>
          ${m.challenge_reading ? `<p>${mktEsc(m.challenge_reading)}</p>` : ''}</div>
      </div>
      <div class="mk-tally">
        <div class="t y"><b>${y}</b><span>YES</span></div>
        <div class="t n"><b>${n}</b><span>NO</span></div>
        <div class="t v"><b>${v}</b><span>VOID</span></div>
      </div>
      <div class="mk-plain">${total} of ${quorum} votes needed. A tie at the top, or fewer votes
        than that, voids the market and refunds everyone.</div>
      ${action}
    </section>`;
  }

  window.courtVote = async function (choice) {
    const m = window._prophecyMarket;
    if (!m || !window.globalWalletAddress) return;
    const label = choice.toUpperCase();
    if (!confirm(`Vote ${label} on this dispute? A vote cannot be changed.`)) return;
    try {
      const hash = await window.sendExecuteContract(
        window.globalWalletAddress, COURT_CONTRACT,
        { vote: { market_id: m.id, choice } }, [],
        'oracle-court: vote ' + m.id, PROPHECY_CHAIN, 1100000
      );
      console.log('[court] vote tx', hash);
      setTimeout(() => openProphecyMarket(m.id), 7000);
    } catch (e) {
      alert(e.message || 'Transaction failed');
    }
  };

  window.courtClose = async function () {
    const m = window._prophecyMarket;
    const btn = document.getElementById('court-close');
    if (!m || !window.globalWalletAddress) { alert('Connect a wallet first.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Confirm in your wallet…'; }
    try {
      // Закрытие запускает весь расчёт рынка с выплатами: замер на rebel-2
      // показал около 860 тысяч газа, поэтому лимит с запасом.
      const hash = await window.sendExecuteContract(
        window.globalWalletAddress, COURT_CONTRACT,
        { close: { market_id: m.id } }, [],
        'oracle-court: close ' + m.id, PROPHECY_CHAIN, 1800000
      );
      console.log('[court] close tx', hash);
      setTimeout(() => openProphecyMarket(m.id), 7000);
    } catch (e) {
      alert(e.message || 'Transaction failed');
      if (btn) { btn.disabled = false; btn.textContent = 'Close the case →'; }
    }
  };

  // ── точка входа ───────────────────────────────────────────────────────────

  /** markets.js вызывает это после отрисовки экрана рынка. */
  window.renderDispute = async function (m) {
    const host = document.getElementById('mk-dispute');
    if (!host) return;
    try {
      if (m.status === 'proposed') host.innerHTML = challengeBlock(m);
      else if (m.status === 'disputed') {
        host.innerHTML = '<div class="mk-loading">Loading the case…</div>';
        host.innerHTML = await caseBlock(m);
      } else host.innerHTML = '';
    } catch (e) {
      host.innerHTML = '<div class="mk-plain">Could not load the dispute.</div>';
    }
  };
})();
