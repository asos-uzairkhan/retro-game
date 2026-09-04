// Map generation, board rendering, accessibility, occupancy and the Q&A flow.
import { state, me, ROOM_TYPES, COLORS } from './state.js';
import {
  db, ref, set, update, runTransaction, onDisconnect,
} from './firebase.js';
import { QUESTIONS, STORAGE_PROMPT } from './questions.js';
import {
  toast, openModal, closeModal, escapeHtml, showTooltip, moveTooltip, hideTooltip,
} from './ui.js';
import { sfx } from './sound.js';

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ===== Generation (runs once, on the admin's client, at setup) ===== */

// Turns { medical: 20, engine: 10, ... } into per-type room counts that sum to
// at most `total`, using the largest-remainder method so counts closely track
// the requested percentages. Any cells left unallocated become Storage.
function allocateTypeCounts(typePercents, total) {
  const types = Object.keys(typePercents).filter((t) => typePercents[t] > 0);
  const raw = types.map((t) => (typePercents[t] / 100) * total);
  const counts = {};
  let allocated = 0;
  types.forEach((t, i) => {
    counts[t] = Math.floor(raw[i]);
    allocated += counts[t];
  });
  const byRemainder = types
    .map((t, i) => ({ t, frac: raw[i] - Math.floor(raw[i]) }))
    .sort((a, b) => b.frac - a.frac);
  let leftover = Math.min(total - allocated, total);
  for (const { t } of byRemainder) {
    if (leftover <= 0) break;
    counts[t] += 1;
    leftover -= 1;
  }
  return counts;
}

export function generateRooms(gridSize, typePercents, hintCount) {
  const rooms = {};
  const centre = Math.floor(gridSize / 2);
  const cells = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const id = `r${r}_${c}`;
      if (r === centre && c === centre) rooms[id] = { type: 'start', solved: true };
      else cells.push(id);
    }
  }
  shuffle(cells);

  const counts = allocateTypeCounts(typePercents, cells.length);
  const pools = {};
  for (const t of Object.keys(counts)) pools[t] = shuffle([...QUESTIONS[t]]);

  let idx = 0;
  for (const t of Object.keys(counts)) {
    for (let i = 0; i < counts[t]; i++) {
      if (!pools[t].length) pools[t] = shuffle([...QUESTIONS[t]]); // pool exhausted on big grids
      rooms[cells[idx++]] = { type: t, question: pools[t].pop(), solved: false };
    }
  }
  // Remaining, unallocated cells default to Storage.
  for (; idx < cells.length; idx++) {
    rooms[cells[idx]] = { type: 'storage', question: STORAGE_PROMPT, solved: false };
  }

  shuffle([...cells]).slice(0, hintCount).forEach((id, i) => {
    rooms[id].hintIndex = i;
  });
  return rooms;
}

/* ===== Accessibility ===== */

export function isAccessible(roomId) {
  const room = state.rooms?.[roomId];
  if (!room || room.solved) return false;
  const [r, c] = roomId.slice(1).split('_').map(Number);
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([rr, cc]) => {
    const n = state.rooms[`r${rr}_${cc}`];
    return n && n.solved;
  });
}

/* ===== Rendering ===== */

export function renderBoard() {
  const gridEl = document.getElementById('board-grid');
  const n = state.meta.gridSize;
  gridEl.style.setProperty('--n', n);

  const byLoc = {};
  for (const [uid, p] of Object.entries(state.players || {})) {
    (byLoc[p.location] ||= []).push({ uid, ...p });
  }
  const miniCrew = (players) => players.map((p) => `<span class="mini-crew" style="--c:${COLORS[p.color] || '#888'}" title="${escapeHtml(p.name)}"><i></i><span>${escapeHtml(p.name)}</span></span>`).join('');
  const pingFlags = (room) => Object.keys(room.pings || {}).map((uid) => {
    const p = state.players?.[uid];
    return `<span class="tile-ping" style="--c:${COLORS[p?.color] || '#888'}" title="Pinged: ${escapeHtml(p?.name || '?')}"></span>`;
  }).join('');

  let html = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const id = `r${r}_${c}`;
      const room = state.rooms?.[id];
      if (!room) continue;
      const T = ROOM_TYPES[room.type];
      const tags = miniCrew(byLoc[id] || []);
      let cls = 'tile';
      let style = '';
      let inner = '';
      if (room.type === 'start') {
        cls += ' tile-start';
        inner = `<span class="tile-icon">🚀</span><div class="tile-crew">${tags}</div>`;
      } else if (room.solved) {
        cls += ' tile-solved';
        const solver = state.players?.[room.solvedBy];
        const col = solver ? COLORS[solver.color] : 'var(--ok)';
        style = `border-color:${col}`;
        inner = `<span class="tile-icon">${T.icon}</span>`
          + `<span class="tile-check" style="color:${col}">✔</span><div class="tile-crew">${tags}</div>`;
      } else if (isAccessible(id)) {
        cls += ' tile-open';
        if (room.occupantId) cls += ' tile-occupied';
        inner = `<span class="tile-icon">${T.icon}</span>`
          + `<div class="tile-pings">${pingFlags(room)}</div><div class="tile-crew">${tags}</div>`;
      } else {
        cls += ' tile-locked';
        inner = '<span class="tile-icon">❓</span>';
      }
      html += `<div class="${cls}" data-room="${id}" style="${style}">${inner}</div>`;
    }
  }
  gridEl.innerHTML = html;
  gridEl.querySelectorAll('.tile').forEach((t) => {
    t.addEventListener('click', () => { hideTooltip(); onTileClick(t.dataset.room); });
    t.addEventListener('pointerenter', (e) => {
      const tip = tileQuestionTooltipHTML(t.dataset.room);
      if (tip) showTooltip(tip, e.clientX, e.clientY);
    });
    t.addEventListener('pointermove', (e) => moveTooltip(e.clientX, e.clientY));
    t.addEventListener('pointerleave', hideTooltip);
  });
}

// A room's question previews on hover (even once solved) without revealing its
// answer or claiming occupancy; locked rooms stay hidden per the accessibility rules.
function tileQuestionTooltipHTML(id) {
  const room = state.rooms?.[id];
  if (!room || room.type === 'start') return null;
  if (!room.solved && !isAccessible(id)) return null;
  const T = ROOM_TYPES[room.type];
  return `<div class="tt-head"><span>${T.icon}</span><strong>${T.name}</strong></div><p>${escapeHtml(room.question)}</p>`;
}

/* ===== Interaction ===== */

async function onTileClick(id) {
  if (!state.meta || state.meta.phase !== 'gameplay') return;
  const room = state.rooms[id];
  if (room.type === 'start') { sfx.click(); return; }
  if (room.solved) {
    sfx.click();
    const solver = state.players?.[room.solvedBy];
    toast(`${ROOM_TYPES[room.type].icon} ${ROOM_TYPES[room.type].name} — solved by <b>${escapeHtml(solver?.name || '?')}</b>`);
    return;
  }
  if (!isAccessible(id)) {
    sfx.error();
    toast('That room is locked. Solve an adjacent room first!', 'warn');
    return;
  }
  if (state.answeringRoom) {
    sfx.error();
    toast('Finish your current room first!', 'warn');
    return;
  }
  if (room.occupantId && room.occupantId !== state.uid) {
    sfx.error();
    toast('Room occupied!', 'warn');
    return;
  }

  const occRef = ref(db, `games/${state.code}/rooms/${id}/occupantId`);
  let res;
  try {
    res = await runTransaction(occRef, (cur) => {
      if (cur === null || cur === state.uid) return state.uid;
      return undefined; // abort: someone else holds it
    });
  } catch (e) {
    sfx.error();
    toast(`Could not enter room: ${escapeHtml(e.message)}`, 'error');
    return;
  }
  if (!res.committed) {
    sfx.error();
    toast('Room occupied! Someone got there first.', 'warn');
    return;
  }

  sfx.whoosh();
  state.prevLocation = me()?.location || 'start';
  update(ref(db, `games/${state.code}/players/${state.uid}`), { location: id });
  onDisconnect(occRef).remove(); // free the room if this tab dies
  openQuestionModal(id);
}

function questionHeadHTML(room) {
  const T = ROOM_TYPES[room.type];
  return `<div class="q-head"><span class="q-icon">${T.icon}</span>`
    + `<div><h3>${T.name}</h3><p class="q-cat">${T.category}</p></div></div>`
    + `<p class="q-text">${escapeHtml(room.question)}</p>`;
}

function pingPickerHTML(room) {
  const players = Object.entries(state.players || {});
  if (!players.length) return '';
  const current = room.pings || {};
  const rows = players.map(([uid, p]) => `
    <label class="ping-check">
      <input type="checkbox" value="${uid}" ${current[uid] ? 'checked' : ''}>
      <span class="crewmate" style="--c:${COLORS[p.color] || '#888'}"></span>
      ${uid === state.uid ? 'You' : escapeHtml(p.name)}
    </label>`).join('');
  return `
    <div class="ping-picker">
      <p class="ping-picker-label">📡 Flag this tile for up to 3 people — ping yourself to say you've got it, or teammates to hand it off.</p>
      <div class="ping-list">${rows}</div>
      <button type="button" class="btn btn-secondary btn-sm" data-act="ping">Send Ping</button>
    </div>`;
}

function wirePingPicker(overlay, id) {
  const boxes = [...overlay.querySelectorAll('.ping-list input[type=checkbox]')];
  const sendBtn = overlay.querySelector('[data-act=ping]');
  if (!sendBtn) return;
  boxes.forEach((b) => {
    b.addEventListener('change', () => {
      if (boxes.filter((x) => x.checked).length > 3) {
        b.checked = false;
        sfx.error();
        toast('You can only ping up to 3 teammates.', 'warn');
      }
    });
  });
  sendBtn.onclick = () => sendPing(id, boxes.filter((b) => b.checked).map((b) => b.value));
}

async function sendPing(id, uids) {
  const pings = {};
  uids.forEach((u) => { pings[u] = true; });
  try {
    await set(ref(db, `games/${state.code}/rooms/${id}/pings`), uids.length ? pings : null);
    sfx.pop();
    toast(uids.length ? '📡 Ping sent!' : 'Ping cleared.', 'success');
  } catch (e) {
    sfx.error();
    const hint = /permission/i.test(e.message) ? ' (the game\'s Firebase rules may be out of date — see SETUP.md step 5)' : '';
    toast(`Could not send ping: ${escapeHtml(e.message)}${hint}`, 'error', 6000);
  }
}

function openQuestionModal(id) {
  const room = state.rooms[id];
  sfx.pop();
  const overlay = openModal(`
    ${questionHeadHTML(room)}
    ${pingPickerHTML(room)}
    <div class="modal-actions">
      <button class="btn btn-ghost" data-act="back">↩ Go Back</button>
      <button class="btn btn-primary" data-act="accept">Accept ✅</button>
    </div>`, { dismissable: false });
  overlay.querySelector('[data-act=back]').onclick = () => releaseRoom(id);
  overlay.querySelector('[data-act=accept]').onclick = () => showAnswerForm(id);
  wirePingPicker(overlay, id);
}

async function releaseRoom(id) {
  sfx.click();
  closeModal();
  const occRef = ref(db, `games/${state.code}/rooms/${id}/occupantId`);
  try {
    await onDisconnect(occRef).cancel();
    await set(occRef, null);
    await update(ref(db, `games/${state.code}/players/${state.uid}`), { location: state.prevLocation });
  } catch (e) {
    toast(`Error leaving room: ${escapeHtml(e.message)}`, 'error');
  }
}

function showAnswerForm(id) {
  state.answeringRoom = id;
  const room = state.rooms[id];
  sfx.pop();
  const overlay = openModal(`
    ${questionHeadHTML(room)}
    <textarea id="answer-text" maxlength="500" rows="5" placeholder="Your answer (1–500 characters)…"></textarea>
    <div class="answer-count"><span id="answer-count">0</span>/500</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-act="back">↩ Go Back</button>
      <button class="btn btn-primary" data-act="submit">Submit Answer ✔</button>
    </div>`, { dismissable: false });
  const ta = overlay.querySelector('#answer-text');
  ta.focus();
  ta.addEventListener('input', () => {
    overlay.querySelector('#answer-count').textContent = ta.value.length;
  });
  overlay.querySelector('[data-act=back]').onclick = () => {
    state.answeringRoom = null;
    releaseRoom(id);
  };
  overlay.querySelector('[data-act=submit]').onclick = () => submitAnswer(id, ta.value.trim());
}

async function submitAnswer(id, text) {
  if (!text) {
    sfx.error();
    toast('Please write an answer first.', 'warn');
    return;
  }
  if (state.meta.phase !== 'gameplay') {
    state.answeringRoom = null;
    closeModal();
    toast('Gameplay has ended — your answer was discarded.', 'warn');
    return;
  }
  const room = state.rooms[id];
  const updates = {
    [`rooms/${id}/solved`]: true,
    [`rooms/${id}/solvedBy`]: state.uid,
    [`rooms/${id}/answer`]: text,
    [`rooms/${id}/occupantId`]: null,
    [`rooms/${id}/pings`]: null,
  };
  const hasHint = room.hintIndex !== undefined && room.hintIndex !== null;
  if (hasHint) updates[`cluesFound/${room.hintIndex}`] = true;
  try {
    await update(ref(db, `games/${state.code}`), updates);
  } catch (e) {
    sfx.error();
    toast(`Could not submit answer: ${escapeHtml(e.message)}`, 'error');
    return;
  }
  onDisconnect(ref(db, `games/${state.code}/rooms/${id}/occupantId`)).cancel();
  state.answeringRoom = null;
  closeModal();
  sfx.solve();
  toast('Room solved! ✔', 'success');
  if (hasHint) {
    setTimeout(() => {
      sfx.clue();
      toast('🔍 You found a clue! It will be revealed when voting starts.', 'clue', 5000);
    }, 600);
  }
}
