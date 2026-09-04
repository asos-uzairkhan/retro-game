// Synthesized sound effects via the Web Audio API — no audio assets needed.

let ctx = null;
let muted = localStorage.getItem('retro_muted') === '1';

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Browsers require a user gesture before audio can play.
document.addEventListener('pointerdown', () => { try { ac(); } catch { /* unsupported */ } }, { once: true });

function tone(freq, dur, { type = 'sine', gain = 0.14, when = 0, slideTo = null } = {}) {
  if (muted) return;
  let c;
  try { c = ac(); } catch { return; }
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, { gain = 0.08, when = 0 } = {}) {
  if (muted) return;
  let c;
  try { c = ac(); } catch { return; }
  const t = c.currentTime + when;
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(600, t);
  filter.frequency.exponentialRampToValueAtTime(2400, t + dur);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t);
}

export const sfx = {
  click() { tone(600, 0.06, { type: 'square', gain: 0.06 }); },
  pop() { tone(320, 0.14, { slideTo: 640, gain: 0.14 }); },
  whoosh() { noise(0.22, { gain: 0.09 }); },
  error() {
    tone(170, 0.2, { type: 'sawtooth', gain: 0.1 });
    tone(120, 0.28, { type: 'sawtooth', gain: 0.09, when: 0.06 });
  },
  solve() { [523, 659, 784].forEach((f, i) => tone(f, 0.16, { when: i * 0.09, gain: 0.13 })); },
  clue() { [880, 1175, 1568, 2093].forEach((f, i) => tone(f, 0.22, { type: 'triangle', when: i * 0.07, gain: 0.1 })); },
  join() { tone(440, 0.14, { slideTo: 700, gain: 0.12 }); },
  leave() { tone(660, 0.18, { slideTo: 320, gain: 0.1 }); },
  ping() { [700, 900, 700, 900].forEach((f, i) => tone(f, 0.1, { type: 'square', when: i * 0.1, gain: 0.09 })); },
  phase() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.22, { type: 'triangle', when: i * 0.11, gain: 0.13 })); },
  tick() { tone(1050, 0.05, { type: 'square', gain: 0.05 }); },
  vote() { tone(520, 0.1, { slideTo: 780, gain: 0.11 }); tone(780, 0.12, { when: 0.1, gain: 0.1 }); },
  countdown() { tone(880, 0.12, { type: 'square', gain: 0.09 }); },
  reveal() {
    [110, 110, 110, 220].forEach((f, i) => tone(f, 0.22, { type: 'sawtooth', when: i * 0.24, gain: 0.11 }));
    noise(0.4, { gain: 0.05, when: 0.9 });
  },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.28, { type: 'triangle', when: i * 0.12, gain: 0.14 })); },
  lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.34, { type: 'sawtooth', when: i * 0.2, gain: 0.09 })); },
};

export function toggleMute() {
  muted = !muted;
  localStorage.setItem('retro_muted', muted ? '1' : '0');
  return muted;
}

export function isMuted() {
  return muted;
}
