// Entry point: form wiring, RTDB listeners, phase routing.
import {
  state, isAdmin, resetGameState,
  COLORS, ROOM_TYPES, PLAYABLE_TYPES, PHASE_LABELS,
} from './state.js';
import { db, ref, onValue, signIn } from './firebase.js';
import * as game from './game.js';
import * as map from './map.js';
import * as voting from './voting.js';
import {
  showScreen, toast, initStars, escapeHtml, closeModal, confirmDialog,
} from './ui.js';
import { sfx, toggleMute, isMuted } from './sound.js';
import { initMusicPlayer, showMusicPlayer, hideMusicPlayer } from './music.js';

const $ = (id) => document.getElementById(id);

/* ================= Colour pickers ================= */

function buildColorPicker(container, { taken = [], onPick }) {
  container.innerHTML = '';
  let selected = null;
  for (const [name, hex] of Object.entries(COLORS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'color-swatch';
    b.style.background = hex;
    b.title = name;
    b.disabled = taken.includes(name);
    b.onclick = () => {
      sfx.click();
      container.querySelectorAll('.color-swatch').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      selected = name;
      if (onPick) onPick(name);
    };
    container.appendChild(b);
  }
  // preselect first free colour
  const firstFree = container.querySelector('.color-swatch:not(:disabled)');
  if (firstFree) firstFree.click();
  return () => selected;
}

/* ================= Setup form ================= */

let getSetupColor = () => null;

const DEFAULT_TYPE_PCT = 10; // 7 types × 10% ≈ 70%, remaining 30% defaults to Storage

function updateTypeTotal() {
  const inputs = [...$('setup-types').querySelectorAll('.type-pct-input')];
  const total = inputs.reduce((sum, i) => sum + (Number(i.value) || 0), 0);
  const el = $('setup-types-total');
  el.textContent = `Total: ${total}% • Storage (default): ${Math.max(0, 100 - total)}%`;
  el.classList.toggle('type-total-warn', total > 100);
  return total;
}

function initSetupForm() {
  getSetupColor = buildColorPicker($('setup-colors'), {});

  const typeGrid = $('setup-types');
  typeGrid.innerHTML = PLAYABLE_TYPES.map((t) => `
    <label class="type-pct">
      <span class="type-pct-label">${ROOM_TYPES[t].icon} ${ROOM_TYPES[t].name}</span>
      <span class="type-pct-input-wrap">
        <input type="number" class="type-pct-input" data-type="${t}" min="0" max="100" step="1" value="${DEFAULT_TYPE_PCT}">%
      </span>
      <small>${escapeHtml(ROOM_TYPES[t].category)}</small>
    </label>`).join('');
  typeGrid.querySelectorAll('.type-pct-input').forEach((input) => {
    input.addEventListener('input', () => {
      input.value = Math.min(100, Math.max(0, Math.round(Number(input.value) || 0)));
      updateTypeTotal();
    });
  });
  updateTypeTotal();

  $('setup-form').addEventListener('submit', onSetupSubmit);
  $('setup-back').onclick = () => { sfx.click(); showScreen('landing'); };
}

function setupError(msg) {
  const el = $('setup-error');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
  if (msg) sfx.error();
}

async function onSetupSubmit(e) {
  e.preventDefault();
  setupError(null);

  const name = $('setup-name').value.trim();
  const color = getSetupColor();
  const gridSize = Number($('setup-grid').value);
  const voteTimerSec = Number($('setup-timer').value);
  const typePercents = {};
  [...$('setup-types').querySelectorAll('.type-pct-input')].forEach((i) => {
    const pct = Number(i.value) || 0;
    if (pct > 0) typePercents[i.dataset.type] = pct;
  });
  const typeTotal = updateTypeTotal();
  const minHints = Number($('setup-min-hints').value);

  if (!name || name.length > 20) return setupError('Please enter a name (1–20 characters).');
  if (!color) return setupError('Please pick a colour.');
  if (typeTotal > 100) return setupError('Room type percentages add up to more than 100%.');
  if (!Number.isInteger(minHints) || minHints < 1 || minHints > 20) return setupError('Minimum hints must be between 1 and 20.');

  pendingSetupCfg = {
    name, color, gridSize, voteTimerSec, typePercents, minHints,
  };
  sfx.pop();
  enterHintFlow({ mode: 'create', min: minHints });
}

/* ================= Join flow ================= */

let joinCode = null;
let getJoinColor = () => null;

function joinError(step, msg) {
  const el = $(`join-error${step}`);
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
  if (msg) sfx.error();
}

function initJoinForm() {
  $('join-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  $('btn-join-lookup').onclick = onJoinLookup;
  $('join-back1').onclick = () => { sfx.click(); showScreen('landing'); };
  $('join-back2').onclick = () => {
    sfx.click();
    $('join-step2').classList.add('hidden');
    $('join-step1').classList.remove('hidden');
  };
  $('btn-join-go').onclick = onJoinGo;
}

async function onJoinLookup() {
  joinError(1, null);
  const code = $('join-code').value.trim();
  if (code.length !== 6) return joinError(1, 'Enter the 6-character game code.');

  const btn = $('btn-join-lookup');
  btn.disabled = true;
  try {
    const user = await signIn();
    state.uid = user.uid;
    const g = await game.lookupGame(code);
    if (!g) return joinError(1, 'Game not found. Check the code.');
    if (g.players?.[state.uid]) { // rejoining an existing identity
      joinCode = code;
      attachGame(code);
      return;
    }
    if (g.meta.phase === 'end') return joinError(1, 'This game has already ended.');

    joinCode = code;
    const taken = Object.values(g.players || {}).map((p) => p.color);
    getJoinColor = buildColorPicker($('join-colors'), { taken });
    $('join-step1').classList.add('hidden');
    $('join-step2').classList.remove('hidden');
    sfx.pop();
  } catch (err) {
    joinError(1, `Error: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function onJoinGo() {
  joinError(2, null);
  const name = $('join-name').value.trim();
  const color = getJoinColor();
  if (!name || name.length > 20) return joinError(2, 'Enter a name (1–20 characters).');
  if (!color) return joinError(2, 'Pick a colour.');

  const btn = $('btn-join-go');
  btn.disabled = true;
  try {
    const g = await game.lookupGame(joinCode);
    if (!g || g.meta.phase === 'end') return joinError(2, 'This game has already ended.');
    const dupName = Object.values(g.players || {}).some(
      (p) => p.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (dupName) return joinError(2, 'That name is already taken.');

    pendingJoin = { code: joinCode, name, color };
    sfx.pop();
    enterHintFlow({ mode: 'join', min: g.meta.minHints || 1 });
    return undefined;
  } finally {
    btn.disabled = false;
  }
}

/* ================= Hint collection (before joining the lobby) ================= */

const MAX_HINTS = 20;

let pendingSetupCfg = null;
let pendingJoin = null;
let hintFlowMode = null; // 'create' | 'join'
let hintFlowMin = 1;
let draftHints = [];
let hintFlowOptedOut = false;

function initHintsForm() {
  $('hints-back').onclick = () => {
    sfx.click();
    if (hintFlowMode === 'create') {
      showScreen('setup');
    } else {
      showScreen('join');
      $('join-step2').classList.remove('hidden');
      $('join-step1').classList.add('hidden');
    }
  };
  $('hints-optout').onclick = onHintsOptOut;
  $('hints-continue').onclick = onHintsContinue;
  $('hints-review-back').onclick = () => {
    sfx.click();
    hintFlowOptedOut = false;
    $('hints-review').classList.add('hidden');
    $('hints-entry').classList.remove('hidden');
  };
  $('hints-review-accept').onclick = onHintsAccept;
}

function enterHintFlow({ mode, min }) {
  hintFlowMode = mode;
  hintFlowMin = Math.min(Math.max(Number(min) || 1, 1), MAX_HINTS);
  draftHints = [];
  hintFlowOptedOut = false;
  $('hints-min-label').textContent = hintFlowMin;
  $('hints-textarea').value = '';
  hintsError(null);
  $('hints-entry').classList.remove('hidden');
  $('hints-review').classList.add('hidden');
  showScreen('hints');
}

function hintsError(msg) {
  const el = $('hints-error');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
  if (msg) sfx.error();
}

function onHintsContinue() {
  hintsError(null);
  const hints = $('hints-textarea').value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((h, i, arr) => arr.indexOf(h) === i);
  if (hints.length < hintFlowMin) return setHintsCountError(hints.length);
  if (hints.length > MAX_HINTS) return hintsError(`That's ${hints.length} hints — please keep it to ${MAX_HINTS} or fewer.`);
  const tooLong = hints.find((h) => h.length > 140);
  if (tooLong) return hintsError(`One of your hints is over 140 characters: "${tooLong.slice(0, 40)}…"`);

  draftHints = hints;
  hintFlowOptedOut = false;
  sfx.click();
  $('hints-review-list').innerHTML = draftHints
    .map((h) => `<li class="hint-review-item">${escapeHtml(h)}</li>`).join('');
  $('hints-review-normal').classList.remove('hidden');
  $('hints-review-optout').classList.add('hidden');
  $('hints-entry').classList.add('hidden');
  $('hints-review').classList.remove('hidden');
  return undefined;
}

function onHintsOptOut() {
  hintsError(null);
  draftHints = [];
  hintFlowOptedOut = true;
  sfx.click();
  $('hints-review-normal').classList.add('hidden');
  $('hints-review-optout').classList.remove('hidden');
  $('hints-entry').classList.add('hidden');
  $('hints-review').classList.remove('hidden');
}

function setHintsCountError(count) {
  return hintsError(`You need at least ${hintFlowMin} distinct hint${hintFlowMin === 1 ? '' : 's'} (found ${count}). Write one hint per line.`);
}

async function onHintsAccept() {
  const btn = $('hints-review-accept');
  btn.disabled = true;
  try {
    if (hintFlowMode === 'create') {
      const code = await game.createGame({ ...pendingSetupCfg, hints: draftHints, optedOut: hintFlowOptedOut });
      sfx.phase();
      attachGame(code);
    } else {
      await game.joinGame(pendingJoin.code, pendingJoin.name, pendingJoin.color, draftHints, hintFlowOptedOut);
      sfx.join();
      attachGame(pendingJoin.code);
    }
  } catch (err) {
    if (hintFlowMode === 'create') {
      toast(`Could not create game: ${err.message}`, 'error');
    } else {
      // transaction lost a race → refresh taken colours and let the player re-pick
      const fresh = await game.lookupGame(pendingJoin.code).catch(() => null);
      const taken = Object.values(fresh?.players || {}).map((p) => p.color);
      getJoinColor = buildColorPicker($('join-colors'), { taken });
      showScreen('join');
      $('join-step1').classList.add('hidden');
      $('join-step2').classList.remove('hidden');
      joinError(2, err.message);
    }
  } finally {
    btn.disabled = false;
  }
}

/* ================= Game attachment & routing ================= */

let lastPhase = null;
let prevPlayerCount = null;

function attachGame(code) {
  detachGame();
  state.code = code;
  lastPhase = null;
  prevPlayerCount = null;
  localStorage.setItem('retro_code', code);

  for (const key of ['meta', 'players', 'rooms', 'cluesFound', 'votes']) {
    const unsub = onValue(ref(db, `games/${code}/${key}`), (snap) => onData(key, snap.val()));
    state.unsubscribers.push(unsub);
  }
  game.setupPresence();
}

function detachGame() {
  voting.resetPhaseLocals();
  resetGameState();
}

function leaveToLanding(msg) {
  detachGame();
  localStorage.removeItem('retro_code');
  closeModal();
  hideMusicPlayer();
  showScreen('landing');
  if (msg) toast(msg, 'warn');
}

function onData(key, val) {
  if (key === 'rooms') checkNewPings(state.rooms, val);
  state[key] = val;

  if (key === 'meta') {
    if (!val) { leaveToLanding('This game no longer exists.'); return; }
    if (val.phase !== lastPhase) {
      onPhaseChange(lastPhase, val.phase);
      lastPhase = val.phase;
    }
  }

  if (key === 'players' && val) {
    if (val[state.uid]) state.joined = true;
    else if (state.joined) { leaveToLanding('You were removed from the game.'); sfx.leave(); return; }
    const count = Object.keys(val).length;
    if (prevPlayerCount !== null && state.meta?.phase === 'joining') {
      if (count > prevPlayerCount) sfx.join();
      if (count < prevPlayerCount) sfx.leave();
    }
    prevPlayerCount = count;
  }

  render();
}

// Notifies this player when they're newly pinged to a room by a teammate.
function checkNewPings(oldRooms, newRooms) {
  if (!oldRooms || !newRooms || !state.uid) return;
  for (const [id, room] of Object.entries(newRooms)) {
    const wasPinged = !!oldRooms[id]?.pings?.[state.uid];
    const isPinged = !!room.pings?.[state.uid];
    if (isPinged && !wasPinged) {
      sfx.ping();
      toast(`📡 You were pinged to ${ROOM_TYPES[room.type]?.name || 'a room'}!`, 'info', 5000);
    }
  }
}

function onPhaseChange(oldPhase, newPhase) {
  if (oldPhase) sfx.phase();

  if (state.answeringRoom && newPhase !== 'gameplay') {
    state.answeringRoom = null;
    closeModal();
    toast('The host ended gameplay — your in-progress answer was discarded.', 'warn', 5000);
  } else if (oldPhase) {
    closeModal();
  }

  if (newPhase === 'voting') voting.startVoteTicker();
  else voting.stopVoteTicker();
}

function render() {
  if (!state.meta || !state.code) return;
  renderHUD();
  if (state.meta.phase !== 'gameplay') hideMusicPlayer();
  switch (state.meta.phase) {
    case 'joining':
      showScreen('lobby');
      game.renderLobby();
      break;
    case 'gameplay':
      showScreen('game');
      map.renderBoard();
      renderSidebar();
      showMusicPlayer();
      break;
    case 'reflection':
      showScreen('reflection');
      voting.renderReflection();
      break;
    case 'voting':
      showScreen('voting');
      voting.renderVoting();
      break;
    case 'reveal':
      showScreen('reveal');
      voting.renderReveal();
      break;
    case 'end':
      showScreen('summary');
      voting.renderSummary();
      break;
    default:
      break;
  }
}

/* ================= HUD & sidebar ================= */

function renderHUD() {
  $('hud-code').textContent = state.code;
  $('hud-phase').textContent = PHASE_LABELS[state.meta.phase] || state.meta.phase;
  const rooms = Object.values(state.rooms || {}).filter((r) => r.type !== 'start');
  const solved = rooms.filter((r) => r.solved).length;
  $('hud-rooms').textContent = `🚪 ${solved}/${rooms.length}`;
  // No total shown here — the hint count would hint at who the imposter is.
  $('hud-clues').textContent = `🔍 ${Object.keys(state.cluesFound || {}).length}`;
  // The lobby has its own dedicated leave/disband button, so hide this one there.
  $('btn-leave-game').classList.toggle('hidden', state.meta.phase === 'joining');
}

function renderSidebar() {
  const solvedBy = {};
  for (const r of Object.values(state.rooms || {})) {
    if (r.solved && r.solvedBy) solvedBy[r.solvedBy] = (solvedBy[r.solvedBy] || 0) + 1;
  }
  $('game-players').innerHTML = Object.entries(state.players || {}).map(([uid, p]) => `
    <li class="side-player ${p.online ? '' : 'offline'}">
      <span class="crewmate" style="--c:${COLORS[p.color] || '#888'}"></span>
      ${escapeHtml(p.name)}${p.isAdmin ? ' <span class="badge">HOST</span>' : ''}
      <span class="count">✔ ${solvedBy[uid] || 0}</span>
    </li>`).join('');

  $('game-admin').classList.toggle('hidden', !isAdmin());

  const rooms = Object.values(state.rooms || {}).filter((r) => r.type !== 'start');
  const allSolved = rooms.length > 0 && rooms.every((r) => r.solved);
  $('all-solved-banner').classList.toggle('hidden', !allSolved);
}

/* ================= Static button wiring ================= */

function wireButtons() {
  $('btn-create').onclick = () => { sfx.pop(); showScreen('setup'); };
  $('btn-goto-join').onclick = () => {
    sfx.pop();
    $('join-step1').classList.remove('hidden');
    $('join-step2').classList.add('hidden');
    joinError(1, null);
    showScreen('join');
  };

  $('btn-copy-code').onclick = async () => {
    sfx.click();
    try {
      await navigator.clipboard.writeText(state.code);
      toast('Code copied! 📋', 'success');
    } catch {
      toast('Could not copy — copy it manually.', 'warn');
    }
  };

  $('btn-start-game').onclick = async () => {
    sfx.click();
    if (Object.keys(state.players || {}).length < 1) return;
    try {
      await game.startGameplay();
    } catch (err) {
      toast(`Could not start the game: ${escapeHtml(err.message)}`, 'error');
    }
  };

  $('btn-end-gameplay').onclick = async () => {
    sfx.click();
    if (await confirmDialog('End gameplay?', 'The map will be frozen and the crew moves to reflection.', 'End Gameplay')) {
      await game.setPhase('reflection');
    }
  };

  $('btn-start-voting').onclick = async () => {
    sfx.click();
    if (await confirmDialog('Start voting?', 'All discovered clues will be revealed and the vote timer starts.', 'Start Voting')) {
      await game.setPhase('voting');
    }
  };

  $('btn-end-game').onclick = async () => {
    sfx.click();
    if (await confirmDialog('End game?', 'Everyone moves to the final summary.', 'End Game')) {
      await game.setPhase('end');
    }
  };

  $('btn-copy-md').onclick = async () => {
    sfx.click();
    try {
      await navigator.clipboard.writeText(voting.buildMarkdownSummary());
      toast('Summary copied as Markdown! 📋', 'success');
    } catch {
      toast('Could not access the clipboard.', 'error');
    }
  };

  $('btn-leave').onclick = () => { sfx.click(); leaveToLanding(null); };

  $('btn-leave-lobby').onclick = async () => {
    sfx.click();
    const admin = isAdmin();
    const ok = await confirmDialog(
      admin ? 'Disband lobby?' : 'Leave lobby?',
      admin
        ? 'Everyone will be removed and the game code will stop working.'
        : "You can rejoin later with the code if the lobby is still open.",
      admin ? 'Disband' : 'Leave',
    );
    if (!ok) return;
    const code = state.code;
    const { uid } = state;
    leaveToLanding(admin ? 'Lobby disbanded.' : 'You left the lobby.');
    try {
      await game.leaveLobby(code, uid, admin);
    } catch (err) {
      toast(`Leave may not have fully completed: ${escapeHtml(err.message)}`, 'warn');
    }
  };

  $('btn-leave-game').onclick = async () => {
    sfx.click();
    const admin = isAdmin();
    const ok = await confirmDialog(
      'Leave game?',
      admin
        ? "Host duties will pass to another crew member (or the game will end if you're the last one). You can rejoin anytime with the code."
        : 'You can rejoin anytime with the game code.',
      'Leave',
    );
    if (!ok) return;
    try {
      await game.leaveGame();
    } catch (err) {
      toast(`Could not leave: ${escapeHtml(err.message)}`, 'error');
      return;
    }
    leaveToLanding('You left the game.');
  };

  const muteBtn = $('btn-mute');
  muteBtn.textContent = isMuted() ? '🔇' : '🔊';
  muteBtn.onclick = () => {
    const m = toggleMute();
    muteBtn.textContent = m ? '🔇' : '🔊';
    if (!m) sfx.pop();
  };
}

function renderLandingCrew() {
  const row = $('landing-crew');
  const picks = ['red', 'cyan', 'lime', 'yellow', 'purple', 'orange'];
  row.innerHTML = picks.map((c) => `<span class="crewmate" style="--c:${COLORS[c]}"></span>`).join('');
}

/* ================= Boot ================= */

async function init() {
  initStars();
  renderLandingCrew();
  initSetupForm();
  initJoinForm();
  initHintsForm();
  wireButtons();
  initMusicPlayer();
  showScreen('landing');

  try {
    const user = await signIn();
    state.uid = user.uid;
  } catch (err) {
    toast(`Firebase connection failed: ${escapeHtml(err.message)}. Check js/firebase-config.js (see SETUP.md).`, 'error', 10000);
    return;
  }

  // Resume a game from a previous session in this browser.
  const saved = localStorage.getItem('retro_code');
  if (saved) {
    try {
      const g = await game.lookupGame(saved);
      if (g && g.players?.[state.uid] && g.meta.phase !== 'end') {
        attachGame(saved);
        toast('Welcome back, crewmate! 🚀', 'success');
        return;
      }
    } catch { /* fall through to landing */ }
    localStorage.removeItem('retro_code');
  }
}

init();
