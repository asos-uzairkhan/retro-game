// Optional background music for the exploration/answering phase. Tracks are
// plain mp3 files dropped in music/, listed by filename in music/manifest.json
// (no server-side directory listing is available on static hosting).

const VOLUME_KEY = 'retro_music_volume';

let audio = null;
let els = null;
let tracks = [];
let trackIndex = 0;

function trackTitle(filename) {
  return filename.replace(/\.mp3$/i, '');
}

async function loadManifest() {
  try {
    const res = await fetch('music/manifest.json');
    const list = res.ok ? await res.json() : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function renderTrack() {
  const hasTracks = tracks.length > 0;
  els.select.innerHTML = hasTracks
    ? tracks.map((t, i) => `<option value="${i}">${trackTitle(t)}</option>`).join('')
    : '<option>No music found</option>';
  els.select.value = String(trackIndex);
  els.play.disabled = !hasTracks;
  els.select.disabled = !hasTracks;
}

function playCurrent() {
  if (!tracks.length) return;
  audio.src = `music/${encodeURIComponent(tracks[trackIndex])}`;
  audio.play().catch(() => { /* blocked until a user gesture; the Play button is one */ });
}

function updatePlayIcon() {
  els.play.textContent = audio && !audio.paused ? '⏸' : '▶';
}

export async function initMusicPlayer() {
  els = {
    root: document.getElementById('music-player'),
    select: document.getElementById('music-select'),
    play: document.getElementById('music-play'),
    volume: document.getElementById('music-volume'),
  };

  audio = new Audio();
  audio.loop = true;
  const savedVolume = parseFloat(localStorage.getItem(VOLUME_KEY));
  audio.volume = Number.isFinite(savedVolume) ? Math.min(1, Math.max(0, savedVolume)) : 0.5;
  els.volume.value = String(Math.round(audio.volume * 100));

  audio.addEventListener('play', updatePlayIcon);
  audio.addEventListener('pause', updatePlayIcon);

  els.play.onclick = () => {
    if (!tracks.length) return;
    if (!audio.src) playCurrent();
    else if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };
  els.select.onchange = () => {
    trackIndex = Number(els.select.value) || 0;
    playCurrent();
  };
  els.volume.oninput = () => {
    const v = Number(els.volume.value) / 100;
    audio.volume = v;
    localStorage.setItem(VOLUME_KEY, String(v));
  };

  tracks = await loadManifest();
  renderTrack();
}


export function showMusicPlayer() {
  els?.root.classList.remove('hidden');
}

export function hideMusicPlayer() {
  els?.root.classList.add('hidden');
  if (audio && !audio.paused) audio.pause();
}
