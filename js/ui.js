// Shared UI helpers: screens, toasts, modals, crewmate chips, starfield.
import { COLORS } from './state.js';
import { sfx } from './sound.js';

const SCREENS = [
  'landing', 'setup', 'join', 'lobby', 'game',
  'reflection', 'voting', 'reveal', 'summary',
];

export function showScreen(name) {
  for (const s of SCREENS) {
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name);
  }
  const hudHidden = ['landing', 'setup', 'join'].includes(name);
  document.getElementById('hud').classList.toggle('hidden', hudHidden);
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function toast(msg, type = 'info', duration = 3500) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = msg;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, duration);
}

let currentModal = null;

export function openModal(html, { dismissable = true } = {}) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  if (dismissable) {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  }
  document.getElementById('modal-root').appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  currentModal = overlay;
  return overlay;
}

export function closeModal() {
  if (currentModal) {
    currentModal.remove();
    currentModal = null;
  }
}

export function confirmDialog(title, text, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button class="btn btn-danger" data-act="ok">${escapeHtml(okLabel)}</button>
      </div>`, { dismissable: false });
    overlay.querySelector('[data-act=cancel]').onclick = () => { sfx.click(); closeModal(); resolve(false); };
    overlay.querySelector('[data-act=ok]').onclick = () => { sfx.click(); closeModal(); resolve(true); };
  });
}

export function crewChipHTML(player, extra = '') {
  const c = COLORS[player.color] || '#888';
  return `<span class="crew-chip ${extra}">`
    + `<span class="crewmate" style="--c:${c}"></span>`
    + `<span class="crew-name">${escapeHtml(player.name)}</span></span>`;
}

export function initStars() {
  const wrap = document.getElementById('stars');
  for (let i = 0; i < 90; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    s.style.left = `${Math.random() * 100}%`;
    s.style.top = `${Math.random() * 100}%`;
    const size = Math.random() * 2 + 1;
    s.style.width = `${size}px`;
    s.style.height = `${size}px`;
    s.style.animationDelay = `${Math.random() * 4}s`;
    s.style.animationDuration = `${2 + Math.random() * 4}s`;
    wrap.appendChild(s);
  }
}
