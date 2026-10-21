// Reflection review, voting + timer, reveal animation, end summary & export.
import {
  state, now, isAdmin, ROOM_TYPES, COLORS, REACTIONS,
} from './state.js';
import {
  db, ref, get, set, update, runTransaction, serverTimestamp,
} from './firebase.js';
import {
  escapeHtml, confirmDialog, toast, crewChipHTML, openModal, closeModal,
} from './ui.js';
import { groupByTopic } from './topics.js';
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
let lastReflectSig = null;
// Only the host can record actions; { roomId, draft } while an inline editor is open.
let editingAction = null;

const OTHER_TOPIC_KEY = 'unsorted';

function reactionList(room) {
  const byKey = {};
  for (const [uid, mine] of Object.entries(room.reactions || {})) {
    if (!state.players?.[uid]) continue;
    for (const [key, on] of Object.entries(mine || {})) {
      if (on && REACTIONS[key]) (byKey[key] ||= []).push(uid);
    }
  }
  return Object.entries(REACTIONS).map(([key, meta]) => ({
    key, ...meta, uids: byKey[key] || [],
  }));
}

// Room whose "add reaction" picker is open (local to this client).
let openPicker = null;

// Only reactions with at least one vote are shown; a "+" button opens a picker
// containing the rest so players can start a new reaction.
function reactionButtonsHTML(roomId) {
  const all = reactionList(state.rooms?.[roomId] || {});
  const chips = all.filter((r) => r.uids.length).map((r) => {
    const names = r.uids.map((u) => state.players[u].name).join(', ');
    return `<button type="button" class="reaction-btn ${r.uids.includes(state.uid) ? 'mine' : ''}" data-react="${r.key}" title="${escapeHtml(`${r.label}: ${names}`)}">${r.emoji} <span>${r.uids.length}</span></button>`;
  }).join('');
  const unused = all.filter((r) => !r.uids.length);
  if (!unused.length) return chips;
  const picking = openPicker === roomId;
  const picker = picking
    ? unused.map((r) => `<button type="button" class="reaction-btn reaction-pick" data-react="${r.key}" title="${escapeHtml(r.label)}">${r.emoji}</button>`).join('')
    : '';
  return `${chips}<button type="button" class="reaction-btn reaction-add ${picking ? 'open' : ''}" title="Add a reaction">${picking ? '✕' : '➕'}</button>${picker}`;
}

function refreshReactions(roomId) {
  const el = document.querySelector(`#reflection-list .reflect-item[data-room="${roomId}"] .reflect-reactions`);
  if (el) el.innerHTML = reactionButtonsHTML(roomId);
}

function reactionSummary(room) {
  return reactionList(room).filter((r) => r.uids.length);
}

async function toggleReaction(roomId, key) {
  const mine = !!state.rooms?.[roomId]?.reactions?.[state.uid]?.[key];
  sfx.click();
  openPicker = null;
  try {
    await set(ref(db, `games/${state.code}/rooms/${roomId}/reactions/${state.uid}/${key}`), mine ? null : true);
  } catch (e) {
    sfx.error();
    toast(`Could not react: ${escapeHtml(e.message)}`, 'error');
  }
}

function actionBlockHTML(r, admin) {
  if (editingAction?.roomId === r.id) {
    return `
      <div class="reflect-action reflect-action-editing">
        <textarea class="reflect-action-input" maxlength="500" placeholder="What will the team do about this?">${escapeHtml(editingAction.draft)}</textarea>
        <div class="reflect-action-btns">
          <button type="button" class="btn btn-secondary btn-xs reflect-action-save">Save</button>
          <button type="button" class="btn btn-ghost btn-xs reflect-action-cancel">Cancel</button>
        </div>
      </div>`;
  }
  if (admin) {
    return `
      <div class="reflect-action">
        ${r.action ? `<p class="reflect-action-text">🎯 <b>Action:</b> ${escapeHtml(r.action)}</p>` : ''}
        <button type="button" class="btn btn-ghost btn-xs reflect-action-edit">${r.action ? '✏️ Edit action' : '+ Add action'}</button>
      </div>`;
  }
  return r.action ? `<div class="reflect-action"><p class="reflect-action-text">🎯 <b>Action:</b> ${escapeHtml(r.action)}</p></div>` : '';
}

/* --- Layout: room-type view vs. topic view --- */

function solvedRoomsFlat() {
  return solvedRoomsGrouped().flatMap((g) => g.rooms);
}

// Stored topics (host-synced) merged with the live solved rooms; anything not in a
// stored topic lands in a render-only "Unsorted" group so no answer is ever hidden.
function topicLayout() {
  const solved = solvedRoomsFlat();
  const byId = new Map(solved.map((r) => [r.id, r]));
  const placed = new Set();
  const groups = Object.entries(state.meta.topicGroups || {})
    .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0))
    .map(([key, g]) => {
      const rooms = Object.keys(g.rooms || {}).filter((id) => byId.has(id) && !placed.has(id)).map((id) => byId.get(id));
      rooms.forEach((r) => placed.add(r.id));
      return { key, title: `🧩 ${g.label}`, label: g.label, rooms };
    })
    .filter((g) => g.rooms.length);
  const loose = solved.filter((r) => !placed.has(r.id));
  if (loose.length) groups.push({ key: OTHER_TOPIC_KEY, title: '🧩 Unsorted', label: 'Unsorted', rooms: loose });
  return groups;
}

function reflectionLayout() {
  if (state.meta.reflectionView === 'topic') return { view: 'topic', groups: topicLayout() };
  return {
    view: 'type',
    groups: solvedRoomsGrouped().map((g) => ({
      key: g.type, title: `${g.icon} ${g.name}`, sub: g.category, rooms: g.rooms,
    })),
  };
}

function reflectItemHTML(r, { admin, view, groups, groupKey }) {
  const room = ROOM_TYPES[r.type];
  const moveOptions = groups
    .filter((g) => g.key !== groupKey)
    .map((g) => `<option value="${escapeHtml(g.key)}">${escapeHtml(g.label)}</option>`).join('');
  return `
    <div class="reflect-item ${admin ? 'admin-clickable' : ''} ${state.meta.highlightedRoom === r.id ? 'highlighted' : ''}" data-room="${r.id}">
      ${view === 'topic' ? `<span class="reflect-chip">${room.icon} ${escapeHtml(room.category)}</span>` : ''}
      <p class="reflect-q">${escapeHtml(r.question)}</p>
      <p class="reflect-a">${escapeHtml(r.answer)}</p>
      <p class="reflect-by">${solverChip(r.solvedBy)}</p>
      <div class="reflect-reactions">${reactionButtonsHTML(r.id)}</div>
      ${admin && view === 'topic' ? `
        <select class="reflect-move" title="Move to another topic">
          <option value="">Move to…</option>${moveOptions}<option value="__new">➕ New topic…</option>
        </select>` : ''}
      ${actionBlockHTML(r, admin)}
    </div>`;
}

function reflectGroupHTML(g, ctx) {
  const count = `${g.rooms.length} item${g.rooms.length === 1 ? '' : 's'}`;
  const renameBtn = ctx.admin && ctx.view === 'topic' && g.key !== OTHER_TOPIC_KEY
    ? ` <button type="button" class="btn btn-ghost btn-xs reflect-rename" data-group="${escapeHtml(g.key)}" title="Rename topic">✏️</button>` : '';
  return `
    <div class="reflect-group">
      <h3>${escapeHtml(g.title)} <span class="reflect-cat">${g.sub ? `${escapeHtml(g.sub)} · ` : ''}${count}</span>${renameBtn}</h3>
      ${g.rooms.map((r) => reflectItemHTML(r, { ...ctx, groupKey: g.key })).join('')}
    </div>`;
}

/* --- Host actions for topic grouping --- */

function nameTopicModal(title, initial) {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <h3>${escapeHtml(title)}</h3>
      <form id="topic-name-form">
        <input id="topic-name-input" type="text" maxlength="40" value="${escapeHtml(initial)}" autocomplete="off">
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>`, { dismissable: false });
    const input = overlay.querySelector('#topic-name-input');
    input.focus();
    input.select();
    overlay.querySelector('[data-act=cancel]').onclick = () => { sfx.click(); closeModal(); resolve(null); };
    overlay.querySelector('#topic-name-form').onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      closeModal();
      resolve(v);
    };
  });
}

async function runTopicGrouping({ andSwitch }) {
  const items = solvedRoomsFlat().map((r) => ({ id: r.id, text: r.answer }));
  const topicGroups = {};
  groupByTopic(items).forEach((t, i) => {
    topicGroups[`t${i}`] = {
      label: t.label,
      order: i,
      rooms: Object.fromEntries(t.ids.map((id) => [id, true])),
    };
  });
  const updates = { topicGroups };
  if (andSwitch) updates.reflectionView = 'topic';
  await update(ref(db, `games/${state.code}/meta`), updates);
}

async function setReflectionView(view) {
  sfx.click();
  try {
    if (view === 'topic' && !state.meta.topicGroups) await runTopicGrouping({ andSwitch: true });
    else await update(ref(db, `games/${state.code}/meta`), { reflectionView: view });
  } catch (e) {
    sfx.error();
    toast(`Could not change view: ${escapeHtml(e.message)}`, 'error');
  }
}

async function regroupTopics() {
  sfx.click();
  const ok = await confirmDialog(
    'Regroup by topic?',
    'Answers will be re-clustered automatically. Any topics you renamed or answers you moved will be reset.',
    'Regroup',
  );
  if (!ok) return;
  try {
    await runTopicGrouping({ andSwitch: true });
  } catch (e) {
    sfx.error();
    toast(`Could not regroup: ${escapeHtml(e.message)}`, 'error');
  }
}

async function renameTopic(key) {
  const current = state.meta.topicGroups?.[key]?.label || '';
  const label = await nameTopicModal('Rename topic', current);
  if (!label) return;
  await update(ref(db, `games/${state.code}/meta/topicGroups/${key}`), { label });
}

async function moveToTopic(roomId, targetKey) {
  const layout = topicLayout();
  const from = layout.find((g) => g.rooms.some((r) => r.id === roomId));
  const updates = {};
  if (from && from.key !== OTHER_TOPIC_KEY) updates[`topicGroups/${from.key}/rooms/${roomId}`] = null;

  let target = targetKey;
  if (targetKey === '__new') {
    const label = await nameTopicModal('New topic name', '');
    if (!label) { lastReflectSig = null; renderReflection(); return; }
    const stored = state.meta.topicGroups || {};
    const nextOrder = Math.max(-1, ...Object.values(stored).map((g) => g.order ?? 0)) + 1;
    target = `t${Date.now().toString(36)}`;
    updates[`topicGroups/${target}/label`] = label;
    updates[`topicGroups/${target}/order`] = nextOrder;
  }
  if (target !== OTHER_TOPIC_KEY) updates[`topicGroups/${target}/rooms/${roomId}`] = true;
  await update(ref(db, `games/${state.code}/meta`), updates);
}

/* --- Rendering --- */

function renderReflectionToolbar(admin, view) {
  const bar = document.getElementById('reflection-toolbar');
  bar.classList.toggle('hidden', !admin);
  if (!admin) return;
  document.getElementById('btn-view-type').classList.toggle('active', view === 'type');
  document.getElementById('btn-view-topic').classList.toggle('active', view === 'topic');
  document.getElementById('btn-regroup').classList.toggle('hidden', view !== 'topic');
}

export function initReflection() {
  document.getElementById('btn-view-type').onclick = () => setReflectionView('type');
  document.getElementById('btn-view-topic').onclick = () => setReflectionView('topic');
  document.getElementById('btn-regroup').onclick = regroupTopics;

  const container = document.getElementById('reflection-list');
  container.addEventListener('click', (e) => {
    const add = e.target.closest('.reaction-add');
    if (add) {
      e.stopPropagation();
      const roomId = add.closest('.reflect-item').dataset.room;
      const prev = openPicker;
      openPicker = prev === roomId ? null : roomId;
      sfx.click();
      if (prev && prev !== roomId) refreshReactions(prev);
      refreshReactions(roomId);
      return;
    }
    const react = e.target.closest('.reaction-btn');
    if (react) {
      const roomId = react.closest('.reflect-item').dataset.room;
      toggleReaction(roomId, react.dataset.react);
      refreshReactions(roomId);
      return;
    }
    const rename = e.target.closest('.reflect-rename');
    if (rename) {
      e.stopPropagation();
      renameTopic(rename.dataset.group).catch((err) => toast(escapeHtml(err.message), 'error'));
    }
  });
  container.addEventListener('change', (e) => {
    const sel = e.target.closest('.reflect-move');
    if (!sel || !sel.value) return;
    moveToTopic(sel.closest('.reflect-item').dataset.room, sel.value)
      .catch((err) => toast(`Could not move: ${escapeHtml(err.message)}`, 'error'));
  });
}

export function renderReflection() {
  const container = document.getElementById('reflection-list');
  const admin = isAdmin();
  const { view, groups } = reflectionLayout();

  document.getElementById('reflection-hint').textContent = admin
    ? 'Click an item to highlight it on every screen. React to answers below; record an action against anything that needs follow-up.'
    : 'The host controls the shared highlight. React to any answer with the buttons below it.';
  renderReflectionToolbar(admin, view);
  document.getElementById('reflection-admin').classList.toggle('hidden', !admin);

  // Reactions and presence change often. Only rebuild the list when its structure
  // changes (so the host's open editor/dropdown isn't clobbered); otherwise just
  // refresh the reaction bars in place.
  const sig = JSON.stringify([
    admin, view, state.meta.highlightedRoom, editingAction?.roomId ?? null,
    groups.map((g) => [g.key, g.title, g.rooms.map((r) => [r.id, r.answer, r.solvedBy, r.action || ''])]),
  ]);
  if (sig === lastReflectSig) {
    container.querySelectorAll('.reflect-item').forEach((el) => {
      el.querySelector('.reflect-reactions').innerHTML = reactionButtonsHTML(el.dataset.room);
    });
    return;
  }
  lastReflectSig = sig;

  const ctx = { admin, view, groups };
  container.innerHTML = groups.length
    ? groups.map((g) => reflectGroupHTML(g, ctx)).join('')
    : '<p class="muted">No rooms were solved. A quiet sprint indeed…</p>';

  if (admin) {
    container.querySelectorAll('.reflect-item').forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest('.reflect-action, .reflect-reactions, .reflect-move')) return;
        sfx.click();
        update(ref(db, `games/${state.code}/meta`), { highlightedRoom: el.dataset.room });
      };
    });
    container.querySelectorAll('.reflect-action-edit').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const roomId = btn.closest('.reflect-item').dataset.room;
        editingAction = { roomId, draft: state.rooms?.[roomId]?.action || '' };
        renderReflection();
        const ta = container.querySelector('.reflect-action-input');
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      };
    });
    container.querySelectorAll('.reflect-action-input').forEach((ta) => {
      ta.onclick = (e) => e.stopPropagation();
      ta.oninput = (e) => { if (editingAction) editingAction.draft = e.target.value; };
    });
    container.querySelectorAll('.reflect-action-save').forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); saveAction(); };
    });
    container.querySelectorAll('.reflect-action-cancel').forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); editingAction = null; renderReflection(); };
    });
  }

  const hl = state.meta.highlightedRoom;
  if (hl && hl !== lastHighlight) {
    lastHighlight = hl;
    container.querySelector('.highlighted')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!admin) sfx.click();
  }
}

async function saveAction() {
  if (!editingAction) return;
  const { roomId, draft } = editingAction;
  const text = draft.trim();
  try {
    if (text) await update(ref(db, `games/${state.code}/rooms/${roomId}`), { action: text });
    else await set(ref(db, `games/${state.code}/rooms/${roomId}/action`), null);
  } catch (e) {
    sfx.error();
    toast(`Could not save action: ${escapeHtml(e.message)}`, 'error');
  } finally {
    editingAction = null;
    renderReflection();
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
  // Only list clues actually found — the total count would hint at who the imposter is.
  const items = (state.hints || [])
    .filter((h, i) => found[i])
    .map((h) => `<li class="clue-item">🔍 ${escapeHtml(h)}</li>`);
  cluesList.innerHTML = items.join('') || '<li class="muted">No clues found yet.</li>';

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
          ${reactionSummary(r).length ? `<p class="reflect-reactions-static">${reactionSummary(r).map((x) => `<span class="reaction-tally" title="${escapeHtml(x.label)}">${x.emoji} ${x.uids.length}</span>`).join(' ')}</p>` : ''}
          ${r.action ? `<p class="reflect-action-text">🎯 <b>Action:</b> ${escapeHtml(r.action)}</p>` : ''}
        </div>`).join('')}
    `).join('') || '<p class="muted">No rooms were solved.</p>'}
    <h3>🎯 Actions</h3>
    ${(() => {
      const actionItems = groups.flatMap((g) => g.rooms.filter((r) => r.action));
      return actionItems.length ? `
        <ul style="list-style:none;padding:0;display:flex;flex-direction:column;gap:8px">
          ${actionItems.map((r) => `<li class="clue-item">🎯 ${escapeHtml(r.action)} <small class="muted">— re: "${escapeHtml(r.question)}"</small></li>`).join('')}
        </ul>` : '<p class="muted">No actions were recorded.</p>';
    })()}
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
  const groups = solvedRoomsGrouped();
  for (const g of groups) {
    lines.push(`### ${g.name} — ${g.category}`, '');
    for (const r of g.rooms) {
      const solver = state.players?.[r.solvedBy]?.name || '?';
      lines.push(`**Q:** ${r.question}`, '');
      lines.push(`**A:** ${r.answer} *(— ${solver})*`, '');
      const reacts = reactionSummary(r);
      if (reacts.length) lines.push(`**Reactions:** ${reacts.map((x) => `${x.emoji} ${x.uids.length}`).join('  ')}`, '');
    }
  }
  lines.push('');

  lines.push('## Actions', '');
  const actionItems = groups.flatMap((g) => g.rooms.filter((r) => r.action));
  if (actionItems.length) {
    for (const r of actionItems) lines.push(`- ${r.action} *(re: "${r.question}")*`);
  } else {
    lines.push('_No actions recorded._');
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
  lastReflectSig = null;
  openPicker = null;
  editingAction = null;
}
