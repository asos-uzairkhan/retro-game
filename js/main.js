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

function initSetupForm() {
  getSetupColor = buildColorPicker($('setup-colors'), {});

  const typeGrid = $('setup-types');
  typeGrid.innerHTML = PLAYABLE_TYPES.map((t) => `
    <label class="type-check">
      <input type="checkbox" value="${t}" checked>
      ${ROOM_TYPES[t].icon} ${ROOM_TYPES[t].name}
      <small>${escapeHtml(ROOM_TYPES[t].category)}</small>
    </label>`).join('');

  $('setup-suspects').addEventListener('input', () => {
    const suspects = parseLines($('setup-suspects').value);
    const sel = $('setup-imposter');
    const prev = sel.value;
    sel.innerHTML = suspects.length
      ? suspects.map((s, i) => `<option value="${i}">${escapeHtml(s)}</option>`).join('')
      : '<option value="">— add suspects first —</option>';
    if (prev && suspects[prev] !== undefined) sel.value = prev;
  });

  $('setup-form').addEventListener('submit', onSetupSubmit);
  $('setup-back').onclick = () => { sfx.click(); showScreen('landing'); };
}

function parseLines(text) {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
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
  const types = [...$('setup-types').querySelectorAll('input:checked')].map((i) => i.value);
  const suspects = parseLines($('setup-suspects').value);
  const imposterIndex = Number($('setup-imposter').value);
  const hints = parseLines($('setup-hints').value);

  if (!name || name.length > 20) return setupError('Please enter a name (1–20 characters).');
  if (!color) return setupError('Please pick a colour.');
  if (!types.length) return setupError('Select at least one room type.');
  if (suspects.length < 3 || suspects.length > 12) return setupError('Enter 3–12 suspects (one per line).');
  if (new Set(suspects.map((s) => s.toLowerCase())).size !== suspects.length) return setupError('Suspect names must be unique.');
  if ($('setup-imposter').value === '' || Number.isNaN(imposterIndex) || !suspects[imposterIndex]) return setupError('Pick which suspect is the imposter.');
  if (hints.length < 1 || hints.length > 20) return setupError('Enter 1–20 clues (one per line).');
  if (hints.length > gridSize * gridSize - 1) return setupError('More clues than rooms — reduce clues or enlarge the grid.');

  const btn = e.submitter;
  if (btn) btn.disabled = true;
  try {
    const code = await game.createGame({
      name, color, gridSize, voteTimerSec, types, suspects, imposterIndex, hints,
    });
    sfx.phase();
    attachGame(code);
  } catch (err) {
    setupError(`Could not create game: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
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
    if (g.meta.phase !== 'joining') return joinError(1, 'Game already in progress — no late joins.');

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

  const g = await game.lookupGame(joinCode);
  if (!g || g.meta.phase !== 'joining') return joinError(2, 'Game already in progress.');
  const dupName = Object.values(g.players || {}).some(
    (p) => p.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (dupName) return joinError(2, 'That name is already taken.');

  const btn = $('btn-join-go');
  btn.disabled = true;
  try {
    await game.joinGame(joinCode, name, color);
    sfx.join();
    attachGame(joinCode);
  } catch (err) {
    // transaction lost a race → refresh taken colours and let the player re-pick
    const fresh = await game.lookupGame(joinCode);
    const taken = Object.values(fresh?.players || {}).map((p) => p.color);
    getJoinColor = buildColorPicker($('join-colors'), { taken });
    joinError(2, err.message);
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
  showScreen('landing');
  if (msg) toast(msg, 'warn');
}

function onData(key, val) {
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
  switch (state.meta.phase) {
    case 'joining':
      showScreen('lobby');
      game.renderLobby();
      break;
    case 'gameplay':
      showScreen('game');
      map.renderBoard();
      renderSidebar();
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
  $('hud-clues').textContent = `🔍 ${Object.keys(state.cluesFound || {}).length}/${state.meta.hintCount || 0}`;
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
    if (Object.keys(state.players || {}).length < 2) return;
    await game.setPhase('gameplay');
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
  wireButtons();
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
