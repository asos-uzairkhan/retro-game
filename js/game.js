// Game lifecycle: create, join, lobby, phase transitions, presence.
import { state, isAdmin, COLORS } from './state.js';
import {
  db, ref, get, set, update, remove, onValue,
  runTransaction, onDisconnect, serverTimestamp, signIn,
} from './firebase.js';
import { generateRooms } from './map.js';
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

  const rooms = generateRooms(cfg.gridSize, cfg.types, cfg.hints.length);
  const game = {
    meta: {
      createdAt: serverTimestamp(),
      adminUid: state.uid,
      phase: 'joining',
      phaseStartedAt: serverTimestamp(),
      gridSize: cfg.gridSize,
      voteTimerSec: cfg.voteTimerSec,
      hintCount: cfg.hints.length,
    },
    players: {
      [state.uid]: {
        name: cfg.name, color: cfg.color, isAdmin: true, online: true, location: 'start',
      },
    },
    rooms,
    secrets: {
      suspects: cfg.suspects,
      imposterIndex: cfg.imposterIndex,
      hints: cfg.hints,
    },
  };
  await set(ref(db, `games/${code}`), game);
  return code;
}

export async function lookupGame(code) {
  const snap = await get(ref(db, `games/${code}`));
  return snap.exists() ? snap.val() : null;
}

export async function joinGame(code, name, color) {
  const user = await signIn();
  state.uid = user.uid;

  // Security rules only grant write access at games/{code}/players/{uid} (each
  // player owns their own node), not at the players collection as a whole — so
  // uniqueness checks are done via a read here, then the transaction below only
  // ever touches this player's own path.
  const existingSnap = await get(ref(db, `games/${code}/players`));
  const players = existingSnap.val() || {};
  if (!players[state.uid]) {
    if (Object.keys(players).length >= 15) {
      throw new Error('Name or colour already taken (or the game is full) — try another.');
    }
    for (const p of Object.values(players)) {
      if (p.name.trim().toLowerCase() === name.trim().toLowerCase() || p.color === color) {
        throw new Error('Name or colour already taken (or the game is full) — try another.');
      }
    }
  }

  const res = await runTransaction(ref(db, `games/${code}/players/${state.uid}`), (existing) => {
    if (existing) return existing; // already joined — no-op commit
    return {
      name, color, isAdmin: false, online: true, location: 'start',
    };
  });
  if (!res.committed) {
    throw new Error('Name or colour already taken (or the game is full) — try another.');
  }
}

export async function kickPlayer(uid) {
  await remove(ref(db, `games/${state.code}/players/${uid}`));
}

/* ===== Phase transitions (admin) ===== */

export async function setPhase(phase) {
  await update(ref(db, `games/${state.code}/meta`), {
    phase,
    phaseStartedAt: serverTimestamp(),
    highlightedRoom: null,
  });
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

export function renderLobby() {
  document.getElementById('lobby-code').textContent = state.code;
  const players = Object.entries(state.players || {});
  document.getElementById('lobby-count').textContent = `${players.length} / 15 crew aboard`;

  const list = document.getElementById('lobby-players');
  list.innerHTML = players.map(([uid, p]) => `
    <li class="lobby-player ${p.online ? '' : 'offline'}">
      <span class="crewmate" style="--c:${COLORS[p.color] || '#888'}"></span>
      <span class="lp-name">${escapeHtml(p.name)}${p.isAdmin ? ' <span class="badge">HOST</span>' : ''}</span>
      ${p.online ? '' : '<span class="offline-dot">offline</span>'}
      ${isAdmin() && uid !== state.uid ? `<button class="btn-kick" data-uid="${uid}" title="Kick player">✕</button>` : ''}
    </li>`).join('');

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
  document.getElementById('btn-start-game').disabled = players.length < 2;
}
