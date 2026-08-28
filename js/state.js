// Shared mutable client state + static game constants.

export const state = {
  uid: null,
  code: null,
  // live RTDB mirrors
  meta: null,
  players: null,
  rooms: null,
  cluesFound: null,
  votes: null,
  // secrets, fetched lazily at the appropriate phase
  suspects: null,
  hints: null,
  imposterIndex: null,
  // local-only
  serverOffset: 0,
  prevLocation: 'start',
  answeringRoom: null,
  joined: false,
  unsubscribers: [],
};

export function now() {
  return Date.now() + state.serverOffset;
}

export function me() {
  return state.players ? state.players[state.uid] : null;
}

export function isAdmin() {
  return !!(state.meta && state.meta.adminUid === state.uid);
}

export function resetGameState() {
  state.unsubscribers.forEach((u) => { try { u(); } catch { /* noop */ } });
  state.unsubscribers = [];
  Object.assign(state, {
    code: null, meta: null, players: null, rooms: null, cluesFound: null,
    votes: null, suspects: null, hints: null, imposterIndex: null,
    prevLocation: 'start', answeringRoom: null, joined: false,
  });
}

export const COLORS = {
  red: '#c51111',
  blue: '#132ed1',
  green: '#117f2d',
  pink: '#ed54ba',
  orange: '#ef7d0d',
  yellow: '#f5f557',
  black: '#3f474e',
  white: '#d6e0f0',
  purple: '#6b2fbb',
  brown: '#71491e',
  cyan: '#38fedc',
  lime: '#50ef39',
};

export const ROOM_TYPES = {
  start: { name: 'Start', icon: '🚀', category: 'Hub' },
  storage: { name: 'Storage', icon: '📦', category: 'Open floor' },
  medical: { name: 'Medical Bay', icon: '🩺', category: "What didn't go well" },
  recreation: { name: 'Recreation Room', icon: '🎮', category: 'What went well' },
  cafeteria: { name: 'Cafeteria', icon: '☕', category: 'Serenity' },
  engine: { name: 'Engine Room', icon: '⚙️', category: 'Improvements' },
  navigation: { name: 'Navigation', icon: '🧭', category: 'Learning' },
  security: { name: 'Security', icon: '🛡️', category: 'Risks & blockers' },
  conference: { name: 'Conference Room', icon: '🗣️', category: 'Teamwork' },
};

export const PLAYABLE_TYPES = [
  'medical', 'recreation', 'cafeteria', 'engine', 'navigation', 'security', 'conference',
];

export const PHASE_LABELS = {
  joining: 'Lobby',
  gameplay: 'Gameplay',
  reflection: 'Reflection',
  voting: 'Voting',
  reveal: 'Reveal',
  end: 'Summary',
};
