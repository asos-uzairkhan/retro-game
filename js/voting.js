// Reflection review, voting + timer, reveal animation, end summary & export.
import {
  state, now, isAdmin, ROOM_TYPES, COLORS,
} from './state.js';
import {
  db, ref, get, set, update, runTransaction, serverTimestamp,
} from './firebase.js';
import {
  escapeHtml, confirmDialog, toast, crewChipHTML,
} from './ui.js';
import { sfx } from './sound.js';

/* ===== Secrets (fetched only at the phase where they're needed) ===== */

let secretsLoading = null;

export async function loadSecrets({ withImposter = false } = {}) {
  if (!state.hints) {
    if (!secretsLoading) {
      secretsLoading = get(ref(db, `games/${state.code}/secrets/hints`)).then((h) => {
        state.hints = h.val() || [];
        secretsLoading = null;
      });
    }
    await secretsLoading;
  }
  if (withImposter && state.imposterUid === null) {
    const snap = await get(ref(db, `games/${state.code}/secrets/imposterUid`));
    state.imposterUid = snap.val();
  }
}

/* ===== Shared helpers ===== */

function solvedRoomsGrouped() {
  const groups = [];
  const order = ['recreation', 'medical', 'engine', 'navigation', 'security', 'conference', 'cafeteria', 'storage'];
  for (const type of order) {
    const rooms = Object.entries(state.rooms || {})
      .filter(([, r]) => r.type === type && r.solved && r.answer)
      .map(([id, r]) => ({ id, ...r }));
    if (rooms.length) groups.push({ type, ...ROOM_TYPES[type], rooms });
  }
  return groups;
}

function solverChip(uid) {
  const p = state.players?.[uid];
  return p ? crewChipHTML(p) : '<span class="muted">unknown</span>';
}

export function computeResult() {
  const votes = Object.values(state.votes || {});
  const counts = {};
  votes.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  let max = 0;
  for (const c of Object.values(counts)) max = Math.max(max, c);
  const top = Object.keys(counts).filter((k) => counts[k] === max);
  const crewWins = votes.length > 0 && top.length === 1 && top[0] === state.imposterUid;
  return { counts, crewWins };
}

/* ===== Reflection ===== */

let lastHighlight = null;

export function renderReflection() {
  const container = document.getElementById('reflection-list');
  const admin = isAdmin();
  document.getElementById('reflection-hint').textContent = admin
    ? 'Click an item to highlight it on every screen.'
    : 'The host controls the shared highlight.';

  const groups = solvedRoomsGrouped();
  container.innerHTML = groups.length ? groups.map((g) => `
    <div class="reflect-group">
      <h3>${g.icon} ${g.name} <span class="reflect-cat">${escapeHtml(g.category)}</span></h3>
      ${g.rooms.map((r) => `
        <div class="reflect-item ${admin ? 'admin-clickable' : ''} ${state.meta.highlightedRoom === r.id ? 'highlighted' : ''}" data-room="${r.id}">
          <p class="reflect-q">${escapeHtml(r.question)}</p>
          <p class="reflect-a">${escapeHtml(r.answer)}</p>
          <p class="reflect-by">${solverChip(r.solvedBy)}</p>
        </div>`).join('')}
    </div>`).join('') : '<p class="muted">No rooms were solved. A quiet sprint indeed…</p>';

  if (admin) {
    container.querySelectorAll('.reflect-item').forEach((el) => {
      el.onclick = () => {
        sfx.click();
        update(ref(db, `games/${state.code}/meta`), { highlightedRoom: el.dataset.room });
      };
    });
  }
  document.getElementById('reflection-admin').classList.toggle('hidden', !admin);

  const hl = state.meta.highlightedRoom;
  if (hl && hl !== lastHighlight) {
    lastHighlight = hl;
    container.querySelector('.highlighted')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!admin) sfx.click();
  }
}

/* ===== Voting ===== */

let voteInterval = null;
let allVotedAt = null;
let advancing = false;
let lastTickSec = null;

export function startVoteTicker() {
  if (!voteInterval) voteInterval = setInterval(voteTick, 250);
}

export function stopVoteTicker() {
  clearInterval(voteInterval);
  voteInterval = null;
  allVotedAt = null;
  advancing = false;
  lastTickSec = null;
}

function voteDeadline() {
  return (state.meta.phaseStartedAt || 0) + state.meta.voteTimerSec * 1000;
}

function voteTick() {
  if (!state.meta || state.meta.phase !== 'voting') return;
  const remain = Math.max(0, voteDeadline() - now());
  const fill = document.getElementById('vote-timer-fill');
  const text = document.getElementById('vote-timer-text');
  if (fill) fill.style.width = `${(remain / (state.meta.voteTimerSec * 1000)) * 100}%`;
  if (text) {
    const secs = Math.ceil(remain / 1000);
    text.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (secs <= 10 && secs > 0 && secs !== lastTickSec) {
      lastTickSec = secs;
      sfx.tick();
    }
  }

  // No one (not even the host) is told who the imposter is ahead of time now,
  // so every player — including the host — casts a vote.
  const eligible = Object.keys(state.players || {});
  const allVoted = eligible.length > 0
    && eligible.every((u) => state.votes && state.votes[u] !== undefined);
  if (allVoted && !allVotedAt) allVotedAt = now();
  if (!allVoted) allVotedAt = null;

  // Admin advances immediately; other clients act as fallback after a 3 s grace.
  let should;
  if (isAdmin()) should = allVoted || remain <= 0;
  else should = (remain <= 0 && now() - voteDeadline() > 3000) || (allVotedAt && now() - allVotedAt > 3000);

  if (should && !advancing) {
    advancing = true;
    advanceToReveal();
  }
}

async function advanceToReveal() {
  try {
    const res = await runTransaction(
      ref(db, `games/${state.code}/meta/phase`),
      (cur) => (cur === 'voting' ? 'reveal' : undefined),
    );
    if (res.committed) {
      await update(ref(db, `games/${state.code}/meta`), { phaseStartedAt: serverTimestamp() });
    }
  } catch { /* someone else advanced it */ } finally {
    advancing = false;
  }
}

export async function renderVoting() {
  await loadSecrets();
  if (state.meta.phase !== 'voting') return; // phase moved on while loading

  const cluesList = document.getElementById('voting-clues-list');
  const found = state.cluesFound || {};
  const items = (state.hints || []).map((h, i) => (found[i]
    ? `<li class="clue-item">🔍 ${escapeHtml(h)}</li>`
    : '<li class="clue-item undiscovered">❔ Undiscovered clue</li>'));
  cluesList.innerHTML = items.join('') || '<li class="muted">No clues in this game.</li>';

  const main = document.getElementById('voting-main');
  const myVote = state.votes?.[state.uid];
  if (myVote !== undefined) {
    const votedPlayer = state.players?.[myVote];
    main.innerHTML = `
      <div class="vote-waiting">
        <p>🗳️ Your vote for <b>${votedPlayer ? escapeHtml(votedPlayer.name) : '?'}</b> is locked in.</p>
        <p class="muted">Waiting for the rest of the crew…</p>
      </div>`;
    return;
  }

  const players = Object.entries(state.players || {});
  main.innerHTML = `
    <h3>Cast your vote</h3>
    <div class="suspect-list">
      ${players.map(([uid, p]) => `<button class="suspect-btn" data-uid="${uid}">🕵️ ${crewChipHTML(p)}</button>`).join('')}
    </div>`;
  main.querySelectorAll('.suspect-btn').forEach((b) => {
    b.onclick = () => castVote(b.dataset.uid, state.players[b.dataset.uid]?.name || '?');
  });
}

async function castVote(uid, name) {
  sfx.click();
  const ok = await confirmDialog('Confirm your vote', `Vote for ${name}? This cannot be changed.`, 'Vote');
  if (!ok) return;
  try {
    await set(ref(db, `games/${state.code}/votes/${state.uid}`), uid);
    sfx.vote();
    toast('Vote submitted! 🗳️', 'success');
  } catch (e) {
    sfx.error();
    toast(`Could not vote: ${escapeHtml(e.message)}`, 'error');
  }
}

/* ===== Reveal ===== */

let countdownInterval = null;
let resultSoundPlayed = false;
let revealSoundPlayed = false;

function tallyHTML({ markImposter = false } = {}) {
  const votes = state.votes || {};
  const { counts } = computeResult();
  const rows = Object.entries(state.players || {}).map(([uid, p]) => {
    const voters = Object.entries(votes).filter(([, v]) => v === uid)
      .map(([u]) => (state.players?.[u] ? crewChipHTML(state.players[u]) : ''));
    const imp = markImposter && uid === state.imposterUid;
    return {
      uid, p, count: counts[uid] || 0, voters, imp,
    };
  }).sort((a, b) => b.count - a.count);

  const noVote = Object.keys(state.players || {})
    .filter((u) => votes[u] === undefined)
    .map((u) => crewChipHTML(state.players[u]));

  return rows.map((r, idx) => `
    <div class="tally-row ${r.imp ? 'is-imposter' : ''}" style="animation-delay:${idx * 0.1}s">
      <span class="suspect-name">${r.imp ? '👹' : '🕵️'} ${crewChipHTML(r.p)}</span>
      <span class="tally-count">${r.count}</span>
      <span class="tally-voters">${r.voters.join('')}</span>
    </div>`).join('')
    + (noVote.length ? `<p class="muted">No vote: ${noVote.join(' ')}</p>` : '');
}

export async function renderReveal() {
  await loadSecrets({ withImposter: true });
  if (!['reveal', 'end'].includes(state.meta.phase)) return;

  const revealedAt = state.meta.imposterRevealedAt;
  document.getElementById('reveal-tally').innerHTML = tallyHTML({
    markImposter: !!revealedAt && (now() - revealedAt) / 1000 >= 3,
  });

  const panel = document.getElementById('reveal-imposter-panel');
  const adminBar = document.getElementById('reveal-admin');
  adminBar.classList.add('hidden');

  if (!revealedAt) {
    if (isAdmin()) {
      panel.innerHTML = '<button id="btn-reveal-imposter" class="btn btn-danger btn-big">Reveal the Imposter 👹</button>';
      panel.querySelector('#btn-reveal-imposter').onclick = () => {
        sfx.reveal();
        update(ref(db, `games/${state.code}/meta`), { imposterRevealedAt: serverTimestamp() });
      };
    } else {
      panel.innerHTML = '<p class="muted">Waiting for the host to reveal the imposter…</p>';
    }
    return;
  }

  const elapsed = (now() - revealedAt) / 1000;
  if (elapsed < 3) {
    if (!revealSoundPlayed) { revealSoundPlayed = true; sfx.reveal(); }
    startRevealCountdown(panel);
  } else {
    showImposter(panel);
    adminBar.classList.toggle('hidden', !isAdmin());
  }
}

function startRevealCountdown(panel) {
  if (countdownInterval) return;
  let lastShown = null;
  const step = () => {
    const remain = 3 - (now() - state.meta.imposterRevealedAt) / 1000;
    if (remain <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      renderReveal();
      return;
    }
    const n = Math.ceil(remain);
    if (n !== lastShown) {
      lastShown = n;
      sfx.countdown();
      panel.innerHTML = `<div class="reveal-countdown">${n}</div>`;
    }
  };
  step();
  countdownInterval = setInterval(step, 100);
}

function showImposter(panel) {
  const { crewWins } = computeResult();
  const imposter = state.players?.[state.imposterUid];
  panel.innerHTML = `
    <p class="muted">The imposter was…</p>
    <div class="imposter-name">👹 ${imposter ? crewChipHTML(imposter) : '???'}</div>
    <div class="result-banner ${crewWins ? 'result-win' : 'result-lose'}">
      ${crewWins ? '🎉 The crew was right!' : '😈 The imposter got away!'}
    </div>`;
  if (!resultSoundPlayed) {
    resultSoundPlayed = true;
    setTimeout(() => (crewWins ? sfx.win() : sfx.lose()), 400);
  }
}

/* ===== Summary ===== */

export async function renderSummary() {
  await loadSecrets({ withImposter: true });
  const { crewWins } = computeResult();
  const found = state.cluesFound || {};
  const groups = solvedRoomsGrouped();
  const imposter = state.players?.[state.imposterUid];

  const stats = Object.entries(state.players || {}).map(([uid, p]) => {
    const solvedRooms = Object.values(state.rooms || {}).filter((r) => r.solvedBy === uid);
    const clues = solvedRooms.filter((r) => r.hintIndex !== undefined && r.hintIndex !== null).length;
    return { p, solved: solvedRooms.length, clues };
  }).sort((a, b) => b.solved - a.solved);

  document.getElementById('summary-content').innerHTML = `
    <div class="result-banner ${crewWins ? 'result-win' : 'result-lose'}" style="text-align:center">
      ${crewWins ? '🎉 The crew found the imposter!' : '😈 The imposter got away!'}
    </div>
    <h3>👹 The imposter</h3>
    <p>${imposter ? crewChipHTML(imposter) : '???'}</p>
    <h3>🗳️ Vote breakdown</h3>
    <div class="reveal-tally">${tallyHTML({ markImposter: true })}</div>
    <h3>🔍 Clues</h3>
    <ul style="list-style:none;padding:0;display:flex;flex-direction:column;gap:8px">
      ${(state.hints || []).map((h, i) => (found[i]
        ? `<li class="clue-item">🔍 ${escapeHtml(h)}</li>`
        : `<li class="clue-item undiscovered">🚫 ${escapeHtml(h)} <small>(never discovered)</small></li>`)).join('')}
    </ul>
    <h3>📋 Retro output</h3>
    ${groups.map((g) => `
      <h4>${g.icon} ${g.name} — ${escapeHtml(g.category)}</h4>
      ${g.rooms.map((r) => `
        <div class="reflect-item">
          <p class="reflect-q">${escapeHtml(r.question)}</p>
          <p class="reflect-a">${escapeHtml(r.answer)}</p>
          <p class="reflect-by">${solverChip(r.solvedBy)}</p>
        </div>`).join('')}
    `).join('') || '<p class="muted">No rooms were solved.</p>'}
    <h3>🏆 Crew stats</h3>
    <div class="stats-grid">
      ${stats.map(({ p, solved, clues }) => `
        <div class="stat-card">
          <span class="crewmate" style="--c:${COLORS[p.color] || '#888'}"></span>
          ${escapeHtml(p.name)}
          <span class="nums">🚪 ${solved}<br>🔍 ${clues}</span>
        </div>`).join('')}
    </div>`;
}

export function buildMarkdownSummary() {
  const { crewWins } = computeResult();
  const found = state.cluesFound || {};
  const votes = state.votes || {};
  const imposter = state.players?.[state.imposterUid];
  const lines = [];
  lines.push(`# Retro Summary — Data-Tech Among Us Retro (${state.code})`, '');
  lines.push(`**Result:** ${crewWins ? 'The crew found the imposter! 🎉' : 'The imposter got away… 😈'}`);
  lines.push(`**Imposter:** ${imposter?.name ?? '???'}`, '');

  lines.push('## Votes', '');
  Object.entries(state.players || {}).forEach(([uid, p]) => {
    const voters = Object.entries(votes).filter(([, v]) => v === uid)
      .map(([u]) => state.players?.[u]?.name || '?');
    lines.push(`- **${p.name}**: ${voters.length} vote(s)${voters.length ? ` — ${voters.join(', ')}` : ''}`);
  });
  lines.push('');

  lines.push('## Clues', '');
  (state.hints || []).forEach((h, i) => {
    lines.push(`- ${found[i] ? '🔍' : '🚫 *(undiscovered)*'} ${h}`);
  });
  lines.push('');

  lines.push('## Retro output', '');
  for (const g of solvedRoomsGrouped()) {
    lines.push(`### ${g.name} — ${g.category}`, '');
    for (const r of g.rooms) {
      const solver = state.players?.[r.solvedBy]?.name || '?';
      lines.push(`**Q:** ${r.question}`, '');
      lines.push(`**A:** ${r.answer} *(— ${solver})*`, '');
    }
  }
  return lines.join('\n');
}

export function resetPhaseLocals() {
  stopVoteTicker();
  clearInterval(countdownInterval);
  countdownInterval = null;
  resultSoundPlayed = false;
  revealSoundPlayed = false;
  lastHighlight = null;
}
