// End-of-game cinematic: the losing side is flung out of the airlock into space.
// Crew win -> the imposter is ejected. Imposter wins -> the whole crew is ejected.
import { COLORS } from './state.js';
import { escapeHtml } from './ui.js';
import { sfx } from './sound.js';

const ABORT = Symbol('eject-abort');
let active = false;

export function isEjectionPlaying() {
  return active;
}

const rand = (min, max) => min + Math.random() * (max - min);

export function playEjection({ crewWins, imposter, crew }) {
  const ejected = crewWins ? [imposter] : crew;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (active) return Promise.resolve();
  if (!imposter || !ejected.length || reduced) {
    if (imposter) (crewWins ? sfx.win : sfx.lose)();
    return Promise.resolve();
  }
  active = true;

  return new Promise((resolve) => {
    const ctl = { done: false };
    const sleep = (ms) => new Promise((res, rej) => {
      setTimeout(() => (ctl.done ? rej(ABORT) : res()), ms);
    });

    const root = document.createElement('div');
    root.className = 'eject-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Ejection cinematic');
    root.innerHTML = `
      <canvas class="eject-canvas"></canvas>
      <div class="eject-world">
        <div class="eject-bay">
          <div class="eject-sign">AIRLOCK</div>
          <div class="eject-beacon eject-beacon-l"></div>
          <div class="eject-beacon eject-beacon-r"></div>
          <div class="eject-door eject-door-l"></div>
          <div class="eject-door eject-door-r"></div>
        </div>
        <div class="eject-vignette"></div>
        <div class="eject-redalert"></div>
        <div class="eject-actors"></div>
        <div class="eject-caption">
          <p class="eject-line1"></p>
          <p class="eject-line2"></p>
        </div>
      </div>
      <div class="eject-end hidden"></div>
      <button type="button" class="eject-skip">Skip ⏭</button>`;
    document.body.appendChild(root);

    const $q = (sel) => root.querySelector(sel);
    const world = $q('.eject-world');
    const bay = $q('.eject-bay');
    const actorsEl = $q('.eject-actors');
    const line1 = $q('.eject-line1');
    const line2 = $q('.eject-line2');
    const canvas = $q('.eject-canvas');
    const g = canvas.getContext('2d');

    /* ----- Canvas: parallax stars, planet, trails, bursts, confetti ----- */

    let bayRect = null;
    const stars = Array.from({ length: 150 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      z: rand(0.2, 1),
    }));
    const particles = [];
    const confetti = [];
    const flyers = new Set();
    let confettiUntil = 0;
    let raf = 0;
    let t0 = null;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      bayRect = bay.getBoundingClientRect();
    }
    window.addEventListener('resize', resize);

    function burst(x, y, { count = 90, speed = 7, colors = ['#fff', '#f5f557', '#ff9f43', '#ff5c5c'] } = {}) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rand(1, speed);
        particles.push({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, decay: rand(0.012, 0.03), size: rand(1.5, 4),
          color: colors[(Math.random() * colors.length) | 0],
        });
      }
      const ring = document.createElement('div');
      ring.className = 'eject-ring';
      ring.style.left = `${x}px`;
      ring.style.top = `${y}px`;
      world.appendChild(ring);
      setTimeout(() => ring.remove(), 1400);
    }

    function frame(t) {
      if (ctl.done) return;
      if (t0 === null) t0 = t;
      g.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // A distant planet glimpsed through the airlock.
      if (bayRect) {
        const px = bayRect.left + bayRect.width * (0.72 - Math.min(0.2, (t - t0) / 80000));
        const py = bayRect.top + bayRect.height * 0.3;
        const pr = bayRect.width * 0.3;
        const grad = g.createRadialGradient(px - pr * 0.35, py - pr * 0.35, pr * 0.1, px, py, pr);
        grad.addColorStop(0, '#9be7ff');
        grad.addColorStop(0.55, '#3b6fd8');
        grad.addColorStop(1, '#0b1030');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(px, py, pr, 0, Math.PI * 2);
        g.fill();
      }

      for (const s of stars) {
        s.x -= s.z * 0.7;
        if (s.x < -2) { s.x = window.innerWidth + 2; s.y = Math.random() * window.innerHeight; }
        g.globalAlpha = 0.35 + s.z * 0.65;
        g.fillStyle = '#fff';
        g.fillRect(s.x, s.y, s.z * 2, s.z * 2);
      }

      for (const el of flyers) {
        const r = el.getBoundingClientRect();
        const size = Math.max(1.2, r.width * 0.12);
        for (let i = 0; i < 2; i++) {
          particles.push({
            x: r.left + r.width / 2 + rand(-3, 3),
            y: r.top + r.height / 2 + rand(-3, 3),
            vx: rand(-0.7, 0.7),
            vy: rand(-0.7, 0.7),
            life: 1,
            decay: 0.03,
            size,
            color: i ? '#ffffff' : el.dataset.color,
          });
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        g.globalAlpha = p.life;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size * p.life + 0.4, 0, Math.PI * 2);
        g.fill();
      }

      if (t < confettiUntil) {
        for (let i = 0; i < 3; i++) {
          confetti.push({
            x: Math.random() * window.innerWidth,
            y: -10,
            vx: rand(-1, 1),
            vy: rand(2, 5),
            rot: Math.random() * 6,
            vr: rand(-0.2, 0.2),
            w: rand(6, 12),
            h: rand(3, 7),
            color: ['#38fedc', '#f5f557', '#ed54ba', '#50ef39', '#ef7d0d', '#fff'][(Math.random() * 6) | 0],
          });
        }
      }
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.x += c.vx;
        c.y += c.vy;
        c.rot += c.vr;
        if (c.y > window.innerHeight + 20) { confetti.splice(i, 1); continue; }
        g.save();
        g.globalAlpha = 1;
        g.translate(c.x, c.y);
        g.rotate(c.rot);
        g.fillStyle = c.color;
        g.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        g.restore();
      }
      g.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }

    /* ----- Actors ----- */

    const n = ejected.length;
    const baseW = n > 8 ? 36 : n > 4 ? 50 : 78;
    const cw = Math.min(baseW, window.innerWidth * 0.1);
    const ch = cw * 1.22;

    function makeActor(player, x, y, emote) {
      const el = document.createElement('div');
      el.className = 'eject-actor';
      const color = COLORS[player.color] || '#888';
      el.dataset.color = color;
      el.style.cssText = `left:${x - cw / 2}px;top:${y - ch}px;width:${cw}px;height:${ch}px`;
      el.innerHTML = `<span class="crewmate eject-body" style="--c:${color}"></span>
        <span class="eject-tag">${escapeHtml(player.name)}</span>
        <span class="eject-emote">${emote || ''}</span>`;
      actorsEl.appendChild(el);
      return el;
    }

    function layout() {
      resize();
      const feet = Math.min(bayRect.bottom - 6, window.innerHeight - 70);
      const gap = cw * 0.35;
      const rowW = Math.min(window.innerWidth - 40, n * (cw + gap));
      const step = n > 1 ? (rowW - cw) / (n - 1) : 0;
      const startX = window.innerWidth / 2 - (n > 1 ? rowW / 2 - cw / 2 : 0);
      const lineup = ejected.map((p, i) => makeActor(p, startX + i * step, feet, crewWins ? '😰' : '😱'));
      let watcher = null;
      if (!crewWins) {
        const wx = Math.min(bayRect.right + cw * 1.8, window.innerWidth - cw);
        watcher = makeActor(imposter, wx, feet, '😈');
        watcher.classList.add('eject-watcher');
      }
      return { lineup, watcher };
    }

    function launch(actor) {
      const r = actor.getBoundingClientRect();
      const b = bay.getBoundingClientRect();
      const ax = r.left + r.width / 2;
      const ay = r.top + r.height / 2;
      const fx = b.left + b.width / 2 - ax + rand(-0.35, 0.35) * b.width;
      const fy = b.top + b.height / 2 - ay - b.height * 0.12 + rand(-0.25, 0.2) * b.height;
      const spin = (Math.random() < 0.5 ? -1 : 1) * rand(540, 1080);
      actor.classList.add('flying');
      flyers.add(actor);
      const anim = actor.animate([
        { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, offset: 0 },
        {
          transform: `translate(${fx * 0.22}px,${fy * 0.22 - 36}px) scale(1.1) rotate(${spin * 0.1}deg)`, opacity: 1, offset: 0.2,
        },
        { transform: `translate(${fx}px,${fy}px) scale(0.03) rotate(${spin}deg)`, opacity: 0.85, offset: 1 },
      ], { duration: rand(3000, 3700), easing: 'cubic-bezier(.45,.05,.85,.5)', fill: 'forwards' });
      return anim.finished.then(() => {
        flyers.delete(actor);
        const e = actor.getBoundingClientRect();
        burst(e.left + e.width / 2, e.top + e.height / 2, { count: crewWins ? 30 : 12, speed: 3, colors: ['#fff', actor.dataset.color] });
        actor.style.visibility = 'hidden';
      });
    }

    async function typeInto(el, text) {
      el.textContent = '';
      for (const ch2 of text) {
        el.textContent += ch2;
        if (ch2 !== ' ') sfx.typeTick();
        await sleep(36);
      }
    }

    /* ----- Finish / end card ----- */

    let endTimer = null;
    function finish() {
      if (ctl.done) return;
      ctl.done = true;
      active = false;
      cancelAnimationFrame(raf);
      clearTimeout(endTimer);
      window.removeEventListener('resize', resize);
      root.classList.add('closing');
      setTimeout(() => root.remove(), 350);
      resolve();
    }
    $q('.eject-skip').onclick = () => { sfx.click(); finish(); };

    function showEndCard() {
      const card = $q('.eject-end');
      $q('.eject-skip').classList.add('hidden');
      card.innerHTML = `
        <div class="eject-end-title ${crewWins ? 'win' : 'lose'}">${crewWins ? 'CREW VICTORY' : 'IMPOSTER WINS'}</div>
        <p>${crewWins
    ? `${escapeHtml(imposter.name)} was ejected into the void. The ship is safe… for now.`
    : `${escapeHtml(imposter.name)} fooled the whole crew. Better luck next sprint.`}</p>
        <button type="button" class="btn btn-primary btn-big">Continue ▶</button>`;
      card.classList.remove('hidden');
      card.querySelector('button').onclick = () => { sfx.click(); finish(); };
      endTimer = setTimeout(finish, 12000);
    }

    /* ----- Timeline ----- */

    async function run() {
      const { lineup, watcher } = layout();
      raf = requestAnimationFrame(frame);

      await sleep(500);
      sfx.siren();
      root.classList.add('alert');
      await typeInto(line1, `${imposter.name} was The Imposter.`);
      await sleep(1500);

      sfx.airlock();
      bay.classList.add('open');
      world.classList.add('shake');
      lineup.forEach((a) => a.classList.add('wobble'));
      await sleep(1100);
      world.classList.remove('shake');

      sfx.suck();
      const flights = lineup.map((a, i) => sleep(Math.min(i * 230, 2300)).then(() => launch(a)));
      await Promise.all(flights);
      root.classList.remove('alert');
      await sleep(300);

      const b = bay.getBoundingClientRect();
      if (crewWins) {
        sfx.boom();
        burst(b.left + b.width / 2, b.top + b.height * 0.3, { count: 160, speed: 9 });
        confettiUntil = performance.now() + 3500;
        world.classList.add('shake');
        setTimeout(() => world.classList.remove('shake'), 500);
        setTimeout(() => sfx.win(), 500);
        await typeInto(line2, '0 Imposters remain.');
      } else {
        sfx.evil();
        root.classList.add('alert', 'flicker');
        watcher.classList.add('gloating');
        watcher.querySelector('.eject-emote').textContent = '😈 MWAHAHA!';
        setTimeout(() => sfx.lose(), 700);
        await typeInto(line2, 'The crew has been ejected.');
      }
      await sleep(2200);
      showEndCard();
    }

    run().catch((e) => {
      if (e !== ABORT && e?.name !== 'AbortError') console.error(e);
      finish();
    });
  });
}
