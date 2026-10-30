// Game lifecycle: create, join, lobby, phase transitions, presence.
import { state, now, isAdmin, COLORS } from './state.js';
import {
  db, ref, get, set, update, remove, onValue,
  runTransaction, onDisconnect, serverTimestamp, signIn,
} from './firebase.js';
import { generateRooms, shuffle } from './map.js';
import { escapeHtml, confirmDialog, toast } from './ui.js';
import { sfx } from './sound.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

function genCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/* ===== Create / join ===== */

export async function createGame(cfg) {
  const user = await signIn();
  state.uid = user.uid;

  let code = null;
  for (let i = 0; i < 10 && !code; i++) {
    const candidate = genCode();
    const snap = await get(ref(db, `games/${candidate}/meta`));
    if (!snap.exists()) code = candidate;
  }
  if (!code) throw new Error('Could not generate a unique game code. Try again.');

  const rooms = generateRooms(cfg.gridSize, cfg.typePercents);
  const game = {
    meta: {
      createdAt: serverTimestamp(),
      adminUid: state.uid,
      phase: 'joining',
      phaseStartedAt: serverTimestamp(),
      gridSize: cfg.gridSize,
      voteTimerSec: cfg.voteTimerSec,
      gameplayTimerMin: cfg.gameplayTimerMin,
      minHints: cfg.minHints,
    },
    players: {
      [state.uid]: {
        name: cfg.name,
        color: cfg.color,
        isAdmin: true,
        online: true,
        location: 'start',
        // Host writes hints after the game exists so the crew can join meanwhile.
        hintsPending: true,
      },
    },
    rooms,
  };
  await set(ref(db, `games/${code}`), game);
  return code;
}

export async function finishHostHints(hints, optedOut) {
  await update(ref(db, `games/${state.code}/players/${state.uid}`), {
    hints: optedOut ? [] : hints,
    optedOut: !!optedOut,
    hintsPending: null,
  });
}

export async function lookupGame(code) {
  const snap = await get(ref(db, `games/${code}`));
  return snap.exists() ? snap.val() : null;
}

// Returns the colour the player actually ended up with. If their chosen colour was
// taken while they were writing hints, they're given the first free one instead of
// being bounced back (which used to force them to re-enter their hints).
export async function joinGame(code, name, color, hints, optedOut) {
  const user = await signIn();
  state.uid = user.uid;

  // Security rules only grant write access at games/{code}/players/{uid} (each
  // player owns their own node), not at the players collection as a whole — so
  // uniqueness checks are done via a read here, then the transaction below only
  // ever touches this player's own path.
  const existingSnap = await get(ref(db, `games/${code}/players`));
  const players = existingSnap.val() || {};
  let finalColor = color;
  if (!players[state.uid]) {
    if (Object.keys(players).length >= 15) throw new Error('This game is full.');
    const takenNames = Object.values(players).map((p) => p.name.trim().toLowerCase());
    if (takenNames.includes(name.trim().toLowerCase())) throw new Error('That name is already taken.');

    const takenColors = new Set(Object.values(players).map((p) => p.color));
    if (takenColors.has(finalColor)) {
      finalColor = Object.keys(COLORS).find((c) => !takenColors.has(c));
      if (!finalColor) throw new Error('This game is full — no colours left.');
    }
  }

  const res = await runTransaction(ref(db, `games/${code}/players/${state.uid}`), (existing) => {
    if (existing) return existing; // already joined — no-op commit
    return {
      name,
      color: finalColor,
      isAdmin: false,
      online: true,
      location: 'start',
      hints: optedOut ? [] : hints,
      optedOut: !!optedOut,
    };
  });
  if (!res.committed) throw new Error('Could not join the game — please try again.');
  return finalColor;
}

export async function kickPlayer(uid) {
  await remove(ref(db, `games/${state.code}/players/${uid}`));
}

// Admin disbands the whole lobby; a regular player just removes themselves.
export async function leaveLobby(code, uid, admin) {
  if (admin) {
    await remove(ref(db, `games/${code}`));
  } else {
    await remove(ref(db, `games/${code}/players/${uid}`));
  }
}

// Lets a player leave mid-game (e.g. after a disconnect) and rejoin later with the code.
export async function leaveGame() {
  const { code, uid } = state;
  const admin = isAdmin();

  // Free up any room this player currently occupies so it doesn't stay stuck.
  const occupied = Object.entries(state.rooms || {}).find(([, r]) => r.occupantId === uid);
  if (occupied) await set(ref(db, `games/${code}/rooms/${occupied[0]}/occupantId`), null);

  if (!admin) {
    await remove(ref(db, `games/${code}/players/${uid}`));
    return;
  }

  // Admin leaving mid-game: hand off host duties, or disband if no one's left.
  const others = Object.keys(state.players || {}).filter((u) => u !== uid);
  const next = others.find((u) => state.players[u].online) || others[0];
  if (!next) {
    await remove(ref(db, `games/${code}`));
    return;
  }
  await update(ref(db, `games/${code}`), {
    'meta/adminUid': next,
    [`players/${next}/isAdmin`]: true,
    [`players/${uid}`]: null,
  });
}

/* ===== Phase transitions (admin) ===== */

export async function setPhase(phase) {
  await update(ref(db, `games/${state.code}/meta`), {
    phase,
    phaseStartedAt: serverTimestamp(),
    highlightedRoom: null,
  });
}

// Randomly picks a real player as the imposter and scatters their self-authored
// hints into random non-start rooms, then advances to the gameplay phase.
export async function startGameplay() {
  const players = state.players || {};
  // Players who opted out of sharing hints are never eligible to be the imposter.
  const uids = Object.keys(players).filter((u) => !players[u].optedOut);
  if (!uids.length) throw new Error('Everyone opted out of sharing hints — at least one player needs to share hints to start.');

  const imposterUid = uids[Math.floor(Math.random() * uids.length)];
  const hints = players[imposterUid]?.hints || [];

  const eligibleRooms = Object.entries(state.rooms || {})
    .filter(([, r]) => r.type !== 'start')
    .map(([id]) => id);
  const scattered = shuffle([...eligibleRooms]).slice(0, hints.length);

  const updates = {
    'meta/phase': 'gameplay',
    'meta/phaseStartedAt': serverTimestamp(),
    'meta/hintCount': scattered.length,
    'meta/gameplayExtraSec': 0,
    'secrets/imposterUid': imposterUid,
    'secrets/hints': hints,
  };
  // Clear stale hintIndex values (e.g. if this ever ran before) then place the fresh ones.
  eligibleRooms.forEach((id) => { updates[`rooms/${id}/hintIndex`] = null; });
  scattered.forEach((id, i) => { updates[`rooms/${id}/hintIndex`] = i; });

  await update(ref(db, `games/${state.code}`), updates);
}

/* ===== Gameplay timer (optional; meta.gameplayTimerMin = -1 means none) ===== */

const ADD_TIME_OPTIONS = [1, 2, 5, 10];
let gameTickInterval = null;
let lastGameTickSec = null;
let timeUpShownFor = null; // null = banner hidden, otherwise 'host' | 'player'

export function gameplayDeadline() {
  const m = state.meta;
  if (!m || !(m.gameplayTimerMin > 0) || !m.phaseStartedAt) return null;
  return m.phaseStartedAt + (m.gameplayTimerMin * 60 + (m.gameplayExtraSec || 0)) * 1000;
}

async function addGameplayTime(minutes) {
  const m = state.meta;
  const base = m.gameplayTimerMin * 60;
  const elapsed = Math.ceil((now() - m.phaseStartedAt) / 1000);
  // Measured from the later of the old deadline and now, so late clicks still grant the full amount.
  const extra = Math.max((m.gameplayExtraSec || 0), elapsed - base) + minutes * 60;
  await update(ref(db, `games/${state.code}/meta`), { gameplayExtraSec: extra });
  sfx.pop();
  toast(`⏱ Added ${minutes} minute${minutes === 1 ? '' : 's'}!`, 'success');
}

function renderTimeUp(up) {
  const banner = document.getElementById('timer-up-banner');
  const kind = up ? (isAdmin() ? 'host' : 'player') : null;
  if (kind === timeUpShownFor) return;
  timeUpShownFor = kind;
  banner.classList.toggle('hidden', !kind);
  if (!kind) return;
  sfx.timeUp();
  banner.innerHTML = kind === 'host'
    ? `<div>⏰ Time's up! Add more time or move on.</div>
       <div class="timer-up-actions">
         ${ADD_TIME_OPTIONS.map((m) => `<button type="button" class="btn btn-secondary btn-xs" data-add="${m}">+${m} min</button>`).join('')}
         <button type="button" class="btn btn-primary btn-xs" data-act="next">Move to Reflection ▶</button>
       </div>`
    : "<div>⏰ Time's up! Waiting for the host to add time or move on…</div>";
}

function gameTick() {
  const hud = document.getElementById('hud-timer');
  const deadline = state.meta?.phase === 'gameplay' ? gameplayDeadline() : null;
  if (deadline === null) {
    hud.classList.add('hidden');
    renderTimeUp(false);
    return;
  }
  const remain = Math.max(0, deadline - now());
  const secs = Math.ceil(remain / 1000);
  hud.classList.remove('hidden');
  hud.textContent = `⏱ ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  hud.classList.toggle('hud-timer-low', secs <= 60);
  if (secs <= 10 && secs > 0 && secs !== lastGameTickSec) {
    lastGameTickSec = secs;
    sfx.tick();
  }
  renderTimeUp(remain <= 0);
}

export function startGameTicker() {
  if (gameTickInterval) return;
  document.getElementById('timer-up-banner').onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn || !isAdmin()) return;
    try {
      if (btn.dataset.add) await addGameplayTime(Number(btn.dataset.add));
      else if (btn.dataset.act === 'next') { sfx.click(); await setPhase('reflection'); }
    } catch (err) {
      sfx.error();
      toast(`Could not update the timer: ${escapeHtml(err.message)}`, 'error');
    }
  };
  gameTickInterval = setInterval(gameTick, 250);
  gameTick();
}

export function stopGameTicker() {
  clearInterval(gameTickInterval);
  gameTickInterval = null;
  lastGameTickSec = null;
  timeUpShownFor = null;
  document.getElementById('hud-timer').classList.add('hidden');
  document.getElementById('timer-up-banner').classList.add('hidden');
}

/* ===== Presence ===== */

export function setupPresence() {
  const offsetUnsub = onValue(ref(db, '.info/serverTimeOffset'), (s) => {
    state.serverOffset = s.val() || 0;
  });
  const connUnsub = onValue(ref(db, '.info/connected'), (s) => {
    if (s.val() === true && state.code && state.uid) {
      const onlineRef = ref(db, `games/${state.code}/players/${state.uid}/online`);
      onDisconnect(onlineRef).set(false);
      set(onlineRef, true);
    }
  });
  state.unsubscribers.push(offsetUnsub, connUnsub);
}

/* ===== Lobby rendering ===== */

function crewListHTML(players, { kick }) {
  return players.map(([uid, p]) => `
    <li class="lobby-player ${p.online ? '' : 'offline'}">
      <span class="crewmate" style="--c:${COLORS[p.color] || '#888'}"></span>
      <span class="lp-name">${escapeHtml(p.name)}${p.isAdmin ? ' <span class="badge">HOST</span>' : ''}</span>
      ${p.hintsPending ? '<span class="offline-dot">✍️ writing hints…</span>' : ''}
      ${p.online ? '' : '<span class="offline-dot">offline</span>'}
      ${kick && uid !== state.uid ? `<button class="btn-kick" data-uid="${uid}" title="Kick player">✕</button>` : ''}
    </li>`).join('');
}

// Live crew roster shown to the host while they're still writing their hints.
export function renderHintsCrew() {
  const players = Object.entries(state.players || {});
  document.getElementById('hints-code').textContent = state.code;
  document.getElementById('hints-crew-count').textContent = `${players.length} / 15 crew aboard`;
  document.getElementById('hints-crew').innerHTML = crewListHTML(players, { kick: false });
}

export function renderLobby() {
  document.getElementById('lobby-code').textContent = state.code;
  const players = Object.entries(state.players || {});
  document.getElementById('lobby-count').textContent = `${players.length} / 15 crew aboard`;

  const list = document.getElementById('lobby-players');
  list.innerHTML = crewListHTML(players, { kick: isAdmin() });

  list.querySelectorAll('.btn-kick').forEach((b) => {
    b.onclick = async () => {
      const p = state.players?.[b.dataset.uid];
      if (await confirmDialog('Kick player', `Remove ${p?.name || 'this player'} from the game?`, 'Kick')) {
        await kickPlayer(b.dataset.uid);
        sfx.leave();
        toast('Player removed.', 'warn');
      }
    };
  });

  const admin = isAdmin();
  document.getElementById('lobby-admin').classList.toggle('hidden', !admin);
  document.getElementById('lobby-wait').classList.toggle('hidden', admin);
  document.getElementById('btn-start-game').disabled = players.length < 1;
  document.getElementById('btn-leave-lobby').textContent = admin ? '🗑 Disband Lobby' : '↩ Leave Lobby';
}
