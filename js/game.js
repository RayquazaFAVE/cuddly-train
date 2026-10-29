/* =============================================================================
   Cuddly Express
   A cozy night-train arcade game.

   You steer a little train with your cursor through a moonlit meadow, scooping
   up small animals who are out too late, and dodging boulders and prickly
   bushes. Every passenger you collect makes the train longer, and a longer
   train is a bigger thing to keep out of trouble.

   No dependencies, no build step — just this file.
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------ util */

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  };

  /* ------------------------------------------------------------- elements */

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const stage = document.getElementById('stage');

  const el = {
    hud: document.getElementById('hud'),
    score: document.getElementById('score'),
    combo: document.getElementById('combo'),
    best: document.getElementById('best'),
    hearts: document.getElementById('hearts'),
    menuBest: document.getElementById('menu-best'),
    mute: document.getElementById('mute'),
    menu: document.getElementById('menu'),
    pause: document.getElementById('pause'),
    over: document.getElementById('over'),
    play: document.getElementById('play'),
    resume: document.getElementById('resume'),
    again: document.getElementById('again'),
    finalScore: document.getElementById('final-score'),
    finalBest: document.getElementById('final-best'),
    overTitle: document.getElementById('over-title'),
    overLine: document.getElementById('over-line'),
  };

  /* ---------------------------------------------------------------- audio */
  /* Tiny WebAudio synth: no asset files, all bleeps generated on the fly. */

  const Sound = {
    ctx: null,
    muted: false,
    master: null,

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    },

    setMuted(muted) {
      this.muted = muted;
      if (this.master) {
        this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
      }
    },

    blip(freq, dur, { type = 'sine', gain = 0.14, to = null, delay = 0 } = {}) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(env);
      env.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    },

    pickup(combo) {
      const f = 480 * Math.pow(1.0595, Math.min(combo, 14));
      this.blip(f, 0.1, { type: 'triangle', gain: 0.12 });
      this.blip(f * 2, 0.07, { type: 'sine', gain: 0.05, delay: 0.015 });
    },
    hit() {
      this.blip(190, 0.32, { type: 'sawtooth', gain: 0.16, to: 62 });
      this.blip(96, 0.2, { type: 'square', gain: 0.07, to: 48 });
    },
    bonus() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        this.blip(f, 0.16, { type: 'triangle', gain: 0.11, delay: i * 0.065 })
      );
    },
    over() {
      [392, 329.63, 261.63, 196].forEach((f, i) =>
        this.blip(f, 0.34, { type: 'triangle', gain: 0.12, delay: i * 0.13 })
      );
    },
  };

  /* ---------------------------------------------------------------- world */

  const TRAIN_COLORS = ['#c9705a', '#b6604e', '#d08265'];

  const CRITTERS = [
    { key: 'bear', body: '#c08d5f', shade: '#a2714a', ear: 'round', inner: '#e8c9a6' },
    { key: 'bunny', body: '#f0e2dd', shade: '#d9c6c0', ear: 'long', inner: '#f7b7c4' },
    { key: 'cat', body: '#f2b568', shade: '#d9974a', ear: 'pointy', inner: '#fbd9b6' },
    { key: 'frog', body: '#8ecf9e', shade: '#6cb47e', ear: 'frog', inner: '#d5f2dd' },
    { key: 'fox', body: '#ef8b57', shade: '#cf6f3f', ear: 'pointy', inner: '#ffd9c2' },
    { key: 'panda', body: '#f4efe7', shade: '#d8cfc3', ear: 'round', inner: '#3b3a3f', dark: true },
  ];

  const OBSTACLE_KINDS = ['boulder', 'bush'];

  let W = 0;
  let H = 0;
  let scale = 1;

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const train = {
    segs: [],
    trail: [],
    spacing: 34,
    radius: 20,
  };

  const state = {
    mode: 'menu', // menu | playing | paused | over
    time: 0,
    score: 0,
    best: 0,
    shownScore: 0,
    hearts: 3,
    combo: 0,
    comboTimer: 0,
    passengers: 0, // total collected this run
    riders: [], // critter keys riding along
    shake: 0,
    flash: 0,
    invuln: 0,
    obstacleTimer: 0,
    passengerTimer: 0,
    steamTimer: 0,
    milestone: 6,
  };

  const pointer = { x: 0, y: 0, active: false, seen: false };

  const obstacles = [];
  const passengers = [];
  const particles = [];
  const fireflies = [];
  const scenery = [];

  /* --------------------------------------------------------------- resize */

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    scale = clamp(Math.min(W, H) / 635, 0.6, 1.7);
    train.radius = 21 * scale;
    train.spacing = 41 * scale;

    // Keep things on screen after a rotation / window resize.
    for (const s of train.segs) {
      s.x = clamp(s.x, 0, W);
      s.y = clamp(s.y, 0, H);
    }
    buildScenery();
    buildFireflies();
  }

  function buildScenery() {
    scenery.length = 0;
    const count = Math.round(((W * H) / 26000) * 1.15);
    const kinds = ['tuft', 'tuft', 'tuft', 'flower', 'flower', 'pebble'];
    for (let i = 0; i < count; i++) {
      scenery.push({
        x: rand(0, W),
        y: rand(0, H),
        kind: pick(kinds),
        z: rand(0.35, 1),
        s: rand(0.7, 1.25),
        hue: rand(-18, 18),
        rot: rand(0, TAU),
      });
    }
  }

  function buildFireflies() {
    fireflies.length = 0;
    const count = Math.round(clamp((W * H) / 42000, 8, 26));
    for (let i = 0; i < count; i++) {
      fireflies.push({
        x: rand(0, W),
        y: rand(0, H),
        r: rand(1.1, 2.4) * scale,
        phase: rand(0, TAU),
        speed: rand(0.35, 1.1),
        drift: rand(6, 22),
        hue: rand(45, 70),
      });
    }
  }

  /* ------------------------------------------------------------ game flow */

  function resetRun() {
    state.time = 0;
    state.score = 0;
    state.shownScore = 0;
    state.hearts = 3;
    state.combo = 0;
    state.comboTimer = 0;
    state.passengers = 0;
    state.riders.length = 0;
    state.shake = 0;
    state.flash = 0;
    state.invuln = 0;
    state.obstacleTimer = 0.55;
    state.passengerTimer = 0.35;
    state.steamTimer = 0;
    state.milestone = 6;

    obstacles.length = 0;
    passengers.length = 0;
    particles.length = 0;

    const cx = clamp(W * 0.5, 90, W - 90);
    const cy = clamp(H * 0.68, 140, H - 100);
    train.segs.length = 0;
    train.segs.push({ x: cx, y: cy, angle: -Math.PI / 2 });
    for (let i = 0; i < 2; i++) {
      train.segs.push({ x: cx, y: cy + train.spacing * (i + 1), angle: -Math.PI / 2 });
    }
    train.trail.length = 0;
    pointer.x = cx;
    pointer.y = cy;
    pointer.active = true;

    renderHearts();
    syncHud(true);
  }

  function startGame() {
    Sound.init();
    resetRun();
    state.mode = 'playing';
    stage.classList.add('is-playing');
    el.menu.classList.add('is-hidden');
    el.over.classList.add('is-hidden');
    el.pause.classList.add('is-hidden');
    el.hud.classList.remove('is-hidden');
  }

  function pauseGame() {
    if (state.mode !== 'playing') return;
    state.mode = 'paused';
    stage.classList.remove('is-playing');
    el.pause.classList.remove('is-hidden');
  }

  function resumeGame() {
    if (state.mode !== 'paused') return;
    state.mode = 'playing';
    stage.classList.add('is-playing');
    el.pause.classList.add('is-hidden');
    Sound.init();
  }

  function gameOver() {
    state.mode = 'over';
    state.flash = 0;
    state.shake = 0;
    stage.classList.remove('is-playing');
    Sound.over();

    const beatRecord = Math.round(state.score) > state.best;
    if (beatRecord) {
      state.best = Math.round(state.score);
      try {
        localStorage.setItem('cuddly-express-best', String(state.best));
      } catch (_) {
        /* storage might be unavailable — best score just won't persist */
      }
    }

    el.finalScore.textContent = String(Math.round(state.score));
    el.finalBest.textContent = String(state.best);
    el.overTitle.textContent = beatRecord ? 'A record ride' : 'End of the line';
    el.overLine.textContent =
      state.passengers === 0
        ? 'No passengers this time. The animals are still waiting.'
        : `You carried ${state.passengers} passenger${state.passengers === 1 ? '' : 's'} through the night.`;

    el.best.textContent = String(state.best);
    if (el.menuBest) el.menuBest.textContent = String(state.best);
    el.over.classList.remove('is-hidden');
    el.hud.classList.add('is-hidden');
  }

  /* ------------------------------------------------------------------ HUD */

  let lastHud = { score: -1, combo: -1, best: -1 };

  function multiplier() {
    return clamp(1 + Math.floor(state.combo / 4), 1, 8);
  }

  function renderHearts() {
    if (el.hearts.childElementCount !== 3) {
      el.hearts.innerHTML = '';
      for (let i = 0; i < 3; i++) {
        const span = document.createElement('span');
        span.className = 'heart';
        span.textContent = '♥';
        el.hearts.appendChild(span);
      }
    }
    Array.from(el.hearts.children).forEach((node, i) => {
      node.classList.toggle('lost', i >= state.hearts);
    });
  }

  function syncHud(force) {
    const score = Math.round(state.shownScore);
    if (force || score !== lastHud.score) {
      el.score.textContent = String(score);
      lastHud.score = score;
    }
    const mult = multiplier();
    if (force || mult !== lastHud.combo) {
      el.combo.textContent = 'x' + mult;
      el.combo.classList.toggle('is-on', state.combo > 0);
      el.combo.classList.toggle('is-hot', mult >= 4);
      lastHud.combo = mult;
    }
  }

  /* -------------------------------------------------------------- spawners */

  function difficulty() {
    return clamp(state.time / 80, 0, 1.3);
  }

  // Pick a spawn column that gives the player a fair chance to react. When the
  // train is high on the screen, things falling in from the top leave very
  // little warning, so prefer columns far away from it.
  function safeSpawnX(margin) {
    const head = train.segs[0];
    if (W <= margin * 2) return W / 2;

    const needsRoom = !!head && head.y < H * 0.55;
    let bestX = W / 2;
    let bestGap = -Infinity;

    for (let i = 0; i < 10; i++) {
      const x = rand(margin, W - margin);
      const gap = head ? Math.abs(x - head.x) : Infinity;
      // Weight by how far away it is, plus a little randomness so it never
      // feels mechanical.
      const score = gap * (needsRoom ? 1 : 0.25) + rand(0, 70) * scale;
      if (score > bestGap) {
        bestGap = score;
        bestX = x;
      }
    }

    if (head && needsRoom && Math.abs(bestX - head.x) < 120 * scale) {
      bestX = head.x < W / 2 ? rand(W * 0.6, W - margin) : rand(margin, W * 0.4);
    }
    return clamp(bestX, margin, W - margin);
  }

  function spawnObstacle() {
    const d = difficulty();
    const kind = pick(OBSTACLE_KINDS);
    const r = rand(19, 28) * scale * (1 + d * 0.12);
    const margin = r + 14;
    obstacles.push({
      kind,
      x: safeSpawnX(margin),
      y: -r - 20,
      r,
      // Brief grace period: nothing can hit the train until it is properly on
      // screen, so a spawn can never feel like a cheap shot.
      grace: 0.85,
      vy: (88 + d * 152) * rand(0.85, 1.2) * scale,
      vx: rand(-16, 16) * scale,
      rot: rand(0, TAU),
      spin: rand(-0.5, 0.5),
      seed: Math.random() * 1000,
      hit: false,
    });
  }

  function spawnPassenger() {
    const d = difficulty();
    const kind = pick(CRITTERS);
    const r = 15 * scale;
    passengers.push({
      kind,
      x: safeSpawnX(r + 46),
      y: -r - 14,
      r,
      vy: (78 + d * 46) * rand(0.85, 1.15) * scale,
      sway: rand(0, TAU),
      swaySpeed: rand(0.7, 1.5),
      swayAmp: rand(10, 30) * scale,
      bob: rand(0, TAU),
      magnet: false,
      collected: false,
    });
  }

  /* --------------------------------------------------------------- update */

  function update(dt) {
    state.time += dt;

    const d = difficulty();
    const worldScroll = (66 + d * 46) * scale;

    updateTrain(dt);
    updateTrail(dt);
    updateObstacles(dt);
    if (state.mode !== 'playing') return; // last heart just went
    updatePassengers(dt);
    updateParticles(dt);
    updateFireflies(dt, worldScroll);
    updateScenery(dt, worldScroll);
    updateSpawns(dt);

    // Combo cools off if you go too long without a pickup.
    if (state.combo > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.combo = 0;
    }

    if (state.invuln > 0) state.invuln = Math.max(0, state.invuln - dt);
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 1.9);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 2.6);

    state.shownScore = lerp(state.shownScore, state.score, 1 - Math.pow(0.001, dt));
    if (Math.abs(state.shownScore - state.score) < 0.6) state.shownScore = state.score;

    // Engine steam.
    state.steamTimer -= dt;
    if (state.steamTimer <= 0) {
      state.steamTimer = 0.085;
      puffSteam();
    }

    syncHud(false);
  }

  function updateTrain(dt) {
    const head = train.segs[0];
    if (!head) return;

    const targetX = pointer.active ? pointer.x : head.x;
    const targetY = pointer.active ? pointer.y : head.y;
    const maxSpeed = 990 * scale;

    let dx = targetX - head.x;
    let dy = targetY - head.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 0.5) {
      const step = Math.min(dist, maxSpeed * dt);
      head.x += (dx / dist) * step;
      head.y += (dy / dist) * step;
      if (dist > 6) head.angle = Math.atan2(dy, dx);
    }

    head.x = clamp(head.x, train.radius, W - train.radius);
    head.y = clamp(head.y, train.radius, H - train.radius);

    // The rest of the train is dragged along behind, one car at a time.
    for (let i = 1; i < train.segs.length; i++) {
      const prev = train.segs[i - 1];
      const seg = train.segs[i];
      let sx = seg.x - prev.x;
      let sy = seg.y - prev.y;
      let sd = Math.hypot(sx, sy);
      if (sd < 0.0001) {
        sx = 0;
        sy = 1;
        sd = 1;
      }
      // Pull the car to exactly one carriage-length behind its leader.
      if (sd > train.spacing) {
        seg.x = prev.x + (sx / sd) * train.spacing;
        seg.y = prev.y + (sy / sd) * train.spacing;
      } else if (sd < train.spacing * 0.75) {
        // Softly spread out again when the chain bunches up.
        const want = train.spacing * 0.75;
        seg.x = prev.x + (sx / sd) * lerp(sd, want, 0.35);
        seg.y = prev.y + (sy / sd) * lerp(sd, want, 0.35);
      }
      seg.angle = Math.atan2(prev.y - seg.y, prev.x - seg.x);
    }
  }

  function updateTrail(dt) {
    const head = train.segs[0];
    if (!head) return;
    const pts = train.trail;
    const last = pts[pts.length - 1];
    const minStep = 13 * scale;

    for (let i = 0; i < pts.length; i++) pts[i].age += dt;
    while (pts.length && pts[0].age > 3.4) pts.shift();

    if (!last || Math.hypot(head.x - last.x, head.y - last.y) > minStep) {
      pts.push({ x: head.x, y: head.y, age: 0 });
      if (pts.length > 340) pts.shift();
    }
  }

  function updateSpawns(dt) {
    const d = difficulty();

    state.obstacleTimer -= dt;
    if (state.obstacleTimer <= 0) {
      spawnObstacle();
      if (d > 0.85 && Math.random() < 0.28) spawnObstacle(); // occasional pair
      state.obstacleTimer = Math.max(0.5, 1.15 - d * 0.58) * rand(0.82, 1.2);
    }

    state.passengerTimer -= dt;
    if (state.passengerTimer <= 0) {
      spawnPassenger();
      state.passengerTimer = Math.max(0.55, 1.5 - d * 0.8) * rand(0.85, 1.15);
    }
  }

  function updateObstacles(dt) {
    const head = train.segs[0];
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.y += o.vy * dt;
      o.x += o.vx * dt;
      o.rot += o.spin * dt;
      if (o.grace > 0) o.grace -= dt;

      if (o.x < o.r) {
        o.x = o.r;
        o.vx = Math.abs(o.vx);
      } else if (o.x > W - o.r) {
        o.x = W - o.r;
        o.vx = -Math.abs(o.vx);
      }

      if (o.y - o.r > H + 40) {
        obstacles.splice(i, 1);
        continue;
      }

      // Nothing may hit the train while it is still sliding in from the top
      // edge — otherwise a spawn you could not see yet feels like a cheap shot.
      if (state.invuln > 0 || o.grace > 0 || o.y < o.r * 1.1 || !head) continue;

      // Any part of the train can hit an obstacle.
      for (let s = 0; s < train.segs.length; s++) {
        const seg = train.segs[s];
        const rad = (s === 0 ? train.radius * 0.8 : train.radius * 0.72) + o.r * 0.86;
        if (dist2(seg.x, seg.y, o.x, o.y) < rad * rad) {
          hitObstacle(o, i);
          break;
        }
      }
    }
  }

  function updatePassengers(dt) {
    const head = train.segs[0];
    for (let i = passengers.length - 1; i >= 0; i--) {
      const p = passengers[i];
      p.sway += dt * p.swaySpeed;
      p.bob += dt * 2.6;

      // Little animals get curious and drift toward the train when it's close.
      let ax = 0;
      let ay = 0;
      // Only once they are actually on screen — nobody likes chasing a target
      // that is still hidden above the top edge.
      if (head && p.y > p.r * 0.6) {
        const dx = head.x - p.x;
        const dy = head.y - p.y;
        const dd = Math.hypot(dx, dy);
        if (dd < 190 * scale && dd > 1) {
          const pull = (1 - dd / (190 * scale)) * 92 * scale;
          ax = (dx / dd) * pull;
          ay = (dy / dd) * pull;
        }
      }

      p.x += (Math.cos(p.sway) * p.swayAmp + ax) * dt;
      p.y += p.vy * dt + ay * dt;

      if (p.y - p.r > H + 40) {
        // Wandered off into the night.
        passengers.splice(i, 1);
        continue;
      }

      if (!head) continue;

      for (let s = 0; s < train.segs.length; s++) {
        const seg = train.segs[s];
        const rad = (s === 0 ? train.radius : train.radius * 0.85) + p.r * 0.9;
        if (dist2(seg.x, seg.y, p.x, p.y) < rad * rad) {
          collectPassenger(p);
          passengers.splice(i, 1);
          break;
        }
      }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      p.rot += p.spin * dt;
      if (p.grow) p.size += p.grow * dt;
    }
  }

  function updateFireflies(dt, worldScroll) {
    for (const f of fireflies) {
      f.phase += dt * f.speed;
      f.x += Math.cos(f.phase * 1.3) * f.drift * dt;
      f.y += (Math.sin(f.phase) * f.drift * 0.5 + worldScroll * 0.12) * dt;
      if (f.y > H + 20) {
        f.y = -20;
        f.x = rand(0, W);
      }
      if (f.x < -20) f.x = W + 20;
      if (f.x > W + 20) f.x = -20;
    }
  }

  function updateScenery(dt, worldScroll) {
    for (const s of scenery) {
      s.y += worldScroll * s.z * dt;
      if (s.y > H + 24) {
        s.y = -24;
        s.x = rand(0, W);
        s.kind = pick(['tuft', 'tuft', 'tuft', 'flower', 'flower', 'pebble']);
      }
    }
  }

  /* -------------------------------------------------------------- actions */

  function addSegment() {
    const tail = train.segs[train.segs.length - 1];
    train.segs.push({
      x: tail.x + Math.cos(tail.angle + Math.PI) * train.spacing,
      y: tail.y + Math.sin(tail.angle + Math.PI) * train.spacing,
      angle: tail.angle,
    });
  }

  function collectPassenger(p) {
    state.combo += 1;
    state.comboTimer = 3.6;
    state.passengers += 1;

    const mult = multiplier();
    const points = 10 * mult;
    state.score += points;

    state.riders.push(p.kind.key);
    if (state.riders.length > 18) state.riders.shift(); // carriages hold 18
    addSegmentIfNeeded();

    Sound.pickup(state.combo);
    burst(p.x, p.y, 12, ['#ffe6a8', '#ffd166', '#fff6e0'], 150 * scale, 0.55, 0.16);

    // Milestone: a full carriage of happy passengers.
    if (state.passengers >= state.milestone) {
      state.milestone += 6;
      state.score += 250;
      Sound.bonus();
      floatingText(p.x, p.y - 20 * scale, '+250', '#ffd166');
      for (let i = 0; i < 3; i++) {
        burst(
          p.x + rand(-26, 26) * scale,
          p.y + rand(-20, 20) * scale,
          7,
          ['#ff9ff3', '#9fe3c4', '#ffd166'],
          170 * scale,
          0.7,
          0.17
        );
      }
    }
  }

  function addSegmentIfNeeded() {
    if (train.segs.length >= 10) return;
    if (state.passengers % 4 !== 0) return;
    addSegment();
    const tail = train.segs[train.segs.length - 1];
    burst(tail.x, tail.y, 10, ['#ffe6a8', '#c9705a'], 110 * scale, 0.6, 0.14);
  }

  function hitObstacle(o, index) {
    obstacles.splice(index, 1);
    state.hearts -= 1;
    state.invuln = 2.1;
    state.shake = 1;
    state.flash = 0.85;
    state.combo = 0;

    Sound.hit();
    burst(o.x, o.y, 18, ['#8d9a92', '#c2cec4', '#5d6b64'], 260 * scale, 0.75, 0.22);
    burst(o.x, o.y, 6, ['#ffd166'], 180 * scale, 0.5, 0.13);

    // Some passengers tumble out of the carriages.
    const lost = Math.min(3, state.riders.length);
    for (let i = 0; i < lost; i++) {
      const rider = state.riders.pop();
      if (!rider) break;
      const seg = train.segs[Math.min(train.segs.length - 1, 1 + i)];
      burst(seg.x, seg.y, 5, ['#f7b7c4', '#ffe6a8'], 120 * scale, 0.5, 0.1);
    }

    renderHearts();
    if (state.hearts <= 0) {
      state.hearts = 0;
      renderHearts();
      gameOver();
    }
  }

  function burst(x, y, count, colors, speed, life, size) {
    for (let i = 0; i < count; i++) {
      if (particles.length > 460) break;
      const a = rand(0, TAU);
      const v = rand(0.25, 1) * speed;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: rand(0.6, 1) * life,
        maxLife: life,
        size: rand(0.6, 1.4) * size * scale,
        color: pick(colors),
        gravity: 0,
        drag: 2.2,
        grow: -0.1 * scale,
        spin: rand(-3, 3),
        rot: rand(0, TAU),
        shape: 'dot',
      });
    }
  }

  function floatingText(x, y, text, color) {
    particles.push({
      x,
      y,
      vx: 0,
      vy: -42 * scale,
      life: 1.1,
      maxLife: 1.1,
      size: 18 * scale,
      color,
      gravity: -6,
      drag: 1.2,
      grow: 0,
      spin: 0,
      rot: 0,
      shape: 'text',
      text,
    });
  }

  function puffSteam() {
    const head = train.segs[0];
    if (!head) return;
    if (particles.length > 460) return;
    const chim = train.spacing * 0.9 * 1.16 * 0.12;
    const px = head.x + Math.cos(head.angle) * chim + rand(-2, 2) * scale;
    const py = head.y + Math.sin(head.angle) * chim + rand(-2, 2) * scale;
    particles.push({
      x: px,
      y: py,
      vx: rand(-14, 14) * scale,
      vy: -rand(16, 40) * scale,
      life: rand(0.45, 0.85),
      maxLife: 0.85,
      size: rand(3.4, 6.2) * scale,
      color: 'rgba(214, 232, 226, 0.5)',
      gravity: 0,
      drag: 1.4,
      grow: 9 * scale,
      spin: 0,
      rot: 0,
      shape: 'puff',
    });
  }

  /* ---------------------------------------------------------------- draw */

  function draw() {
    ctx.save();

    if (state.shake > 0 && !reduceMotion) {
      const s = state.shake * state.shake * 9 * scale;
      ctx.translate(rand(-s, s), rand(-s, s));
    }

    drawBackground();
    drawTrack();
    for (const o of obstacles) drawObstacle(o);
    for (const p of passengers) drawPassenger(p);
    drawTrain();
    drawParticles();
    drawFireflies();
    drawVignette();

    ctx.restore();

    if (state.flash > 0) {
      ctx.save();
      ctx.globalAlpha = state.flash * 0.35;
      ctx.fillStyle = '#ff7a7a';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  function drawBackground() {
    // Night meadow.
    const g = ctx.createLinearGradient(0, 0, W * 0.15, H);
    g.addColorStop(0, '#0d2320');
    g.addColorStop(0.45, '#123029');
    g.addColorStop(1, '#0b1d1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Moonlight wash from above.
    const moon = ctx.createRadialGradient(W * 0.62, -H * 0.18, 0, W * 0.62, -H * 0.18, H * 0.95);
    moon.addColorStop(0, 'rgba(190, 226, 205, 0.17)');
    moon.addColorStop(0.45, 'rgba(140, 190, 175, 0.07)');
    moon.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = moon;
    ctx.fillRect(0, 0, W, H);

    // Soft patches of light so the ground isn't flat.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const cx = W * (0.2 + i * 0.3) + Math.sin(state.time * 0.12 + i) * 40;
      const cy = H * (0.3 + i * 0.22);
      const r = Math.max(W, H) * 0.42;
      const patch = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      patch.addColorStop(0, 'rgba(120, 200, 175, 0.035)');
      patch.addColorStop(1, 'rgba(120, 200, 175, 0)');
      ctx.fillStyle = patch;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    drawScenery();
  }

  function drawScenery() {
    for (const s of scenery) {
      const a = 0.12 + s.z * 0.3;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.globalAlpha = a;

      if (s.kind === 'tuft') {
        ctx.strokeStyle = '#7fbc9b';
        ctx.lineWidth = 1.5 * scale * s.s;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-3 * scale, 2 * scale);
        ctx.lineTo(-5 * scale, -5 * scale * s.s);
        ctx.moveTo(0, 2 * scale);
        ctx.lineTo(0.5 * scale, -7 * scale * s.s);
        ctx.moveTo(3 * scale, 2 * scale);
        ctx.lineTo(5 * scale, -5 * scale * s.s);
        ctx.stroke();
      } else if (s.kind === 'flower') {
        ctx.fillStyle = `hsl(${340 + s.hue}, 60%, 74%)`;
        for (let i = 0; i < 4; i++) {
          const ang = s.rot + (i * TAU) / 4;
          ctx.beginPath();
          ctx.arc(Math.cos(ang) * 2.2 * scale, Math.sin(ang) * 2.2 * scale, 1.7 * scale, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#ffe6a8';
        ctx.beginPath();
        ctx.arc(0, 0, 1.3 * scale, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = '#6f8279';
        ctx.beginPath();
        ctx.ellipse(0, 0, 2.6 * scale * s.s, 1.9 * scale * s.s, s.rot, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawTrack() {
    const pts = train.trail;
    if (pts.length < 2) return;

    const railHalf = 10 * scale;
    const life = 3.4;

    ctx.save();
    ctx.lineCap = 'round';

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const fade = 1 - clamp(b.age / life, 0, 1);
      if (fade <= 0.02) continue;
      const alpha = fade * fade * 0.5;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = (-dy / d) * railHalf;
      const ny = (dx / d) * railHalf;

      ctx.strokeStyle = `rgba(196, 216, 206, ${alpha})`;
      ctx.lineWidth = 2.1 * scale;
      ctx.beginPath();
      ctx.moveTo(a.x + nx, a.y + ny);
      ctx.lineTo(b.x + nx, b.y + ny);
      ctx.moveTo(a.x - nx, a.y - ny);
      ctx.lineTo(b.x - nx, b.y - ny);
      ctx.stroke();

      if (i % 3 === 0) {
        ctx.strokeStyle = `rgba(120, 96, 78, ${alpha * 0.85})`;
        ctx.lineWidth = 3 * scale;
        ctx.beginPath();
        ctx.moveTo(a.x + nx * 1.55, a.y + ny * 1.55);
        ctx.lineTo(a.x - nx * 1.55, a.y - ny * 1.55);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawObstacle(o) {
    ctx.save();
    ctx.translate(o.x, o.y);

    // ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(3 * scale, 5 * scale, o.r * 1.02, o.r * 0.82, 0, 0, TAU);
    ctx.fill();

    ctx.rotate(o.rot);

    if (o.kind === 'boulder') {
      const grd = ctx.createRadialGradient(-o.r * 0.3, -o.r * 0.4, o.r * 0.1, 0, 0, o.r * 1.25);
      grd.addColorStop(0, '#8d9a92');
      grd.addColorStop(1, '#4a5952');
      ctx.fillStyle = grd;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const ang = (i / 9) * TAU;
        const wob = 0.84 + 0.2 * Math.sin(o.seed + i * 2.3);
        const px = Math.cos(ang) * o.r * wob;
        const py = Math.sin(ang) * o.r * wob;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      for (let i = 0; i < 4; i++) {
        const ang = o.seed + i * 1.9;
        const rr = o.r * (0.28 + 0.28 * ((i * 37) % 10) / 10);
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, o.r * 0.11, 0, TAU);
        ctx.fill();
      }
    } else {
      // Prickly bush.
      ctx.fillStyle = '#2c6b4e';
      ctx.beginPath();
      ctx.arc(0, 0, o.r * 0.92, 0, TAU);
      ctx.fill();

      // Spikes.
      ctx.fillStyle = '#3f8a63';
      for (let i = 0; i < 9; i++) {
        const ang = (i / 9) * TAU + o.seed * 0.3;
        const len = o.r * (1.05 + 0.18 * Math.sin(o.seed + i));
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang - 0.2) * o.r * 0.8, Math.sin(ang - 0.2) * o.r * 0.8);
        ctx.lineTo(Math.cos(ang) * len, Math.sin(ang) * len);
        ctx.lineTo(Math.cos(ang + 0.2) * o.r * 0.8, Math.sin(ang + 0.2) * o.r * 0.8);
        ctx.closePath();
        ctx.fill();
      }

      // Berries.
      ctx.fillStyle = '#e0607e';
      for (let i = 0; i < 3; i++) {
        const ang = o.seed * 1.7 + i * 2.1;
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * o.r * 0.42, Math.sin(ang) * o.r * 0.42, o.r * 0.13, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawCritter(x, y, r, kind, options = {}) {
    const { facing = 0, alpha = 1, bob = 0, glow = false } = options;
    const c = kind;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.globalAlpha = alpha;

    if (glow) {
      const gl = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2.9);
      gl.addColorStop(0, 'rgba(255, 233, 180, 0.32)');
      gl.addColorStop(1, 'rgba(255, 233, 180, 0)');
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.9, 0, TAU);
      ctx.fill();
    }

    ctx.rotate(facing);

    // Ears behind the head.
    ctx.fillStyle = c.body;
    if (c.ear === 'long') {
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(s * r * 0.42, -r * 0.72);
        ctx.rotate(s * 0.22);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.34, r * 0.26, r * 0.62, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = c.inner;
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.32, r * 0.13, r * 0.42, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = c.body;
        ctx.restore();
      }
    } else if (c.ear === 'pointy') {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * r * 0.28, -r * 0.72);
        ctx.lineTo(s * r * 0.86, -r * 1.02);
        ctx.lineTo(s * r * 0.82, -r * 0.36);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * r * 0.62, -r * 0.6, r * 0.33, 0, TAU);
        ctx.fill();
        if (c.inner) {
          ctx.fillStyle = c.inner;
          ctx.beginPath();
          ctx.arc(s * r * 0.62, -r * 0.6, r * 0.17, 0, TAU);
          ctx.fill();
          ctx.fillStyle = c.body;
        }
      }
    }

    // Head.
    const bg = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.15, 0, 0, r * 1.15);
    bg.addColorStop(0, c.body);
    bg.addColorStop(1, c.shade);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    // Panda eye patches.
    if (c.dark) {
      ctx.fillStyle = '#3b3a3f';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * r * 0.36, -r * 0.08, r * 0.24, r * 0.3, s * 0.3, 0, TAU);
        ctx.fill();
      }
    }

    // Eyes (they look up — toward where the train is heading).
    const eyeY = -r * 0.18;
    ctx.fillStyle = '#2a2126';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * r * 0.33, eyeY, r * 0.13, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * r * 0.33 + r * 0.05, eyeY - r * 0.05, r * 0.045, 0, TAU);
      ctx.fill();
    }

    // Cheeks + mouth.
    ctx.fillStyle = 'rgba(255, 140, 150, 0.32)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * r * 0.62, r * 0.2, r * 0.16, 0, TAU);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(42, 33, 38, 0.65)';
    ctx.lineWidth = Math.max(1, r * 0.075);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, r * 0.16, r * 0.2, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();

    ctx.restore();
  }

  function drawPassenger(p) {
    const bob = Math.sin(p.bob) * 2.4 * scale;
    // Shadow on the ground beneath them.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(p.x + 2 * scale, p.y + p.r * 0.95, p.r * 0.8, p.r * 0.34, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    drawCritter(p.x, p.y, p.r, p.kind, { bob, facing: Math.PI / 2, glow: true });
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function drawTrain() {
    const segs = train.segs;
    if (!segs.length) return;

    const r = train.radius;
    const len = train.spacing * 0.9;
    const blink = state.invuln > 0 && Math.floor(state.invuln * 14) % 2 === 0;
    const alpha = blink ? 0.4 : 1;

    // Couplings first, so the carriage bodies sit on top of their ends.
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(30, 25, 22, 0.85)';
    ctx.lineWidth = Math.max(2, 3.2 * scale);
    ctx.lineCap = 'round';
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1];
      const b = segs[i];
      ctx.beginPath();
      ctx.moveTo(a.x - Math.cos(a.angle) * len * 0.4, a.y - Math.sin(a.angle) * len * 0.4);
      ctx.lineTo(b.x + Math.cos(b.angle) * len * 0.4, b.y + Math.sin(b.angle) * len * 0.4);
      ctx.stroke();
    }
    ctx.restore();

    // Furthest carriage first so the engine always reads on top.
    for (let i = segs.length - 1; i >= 1; i--) {
      drawCarriage(segs[i], i, r, len, alpha);
    }

    drawEngine(segs[0], r, len * 1.16, alpha);

    // Riders, two per carriage, filled from the front.
    let idx = 0;
    for (let i = 1; i < segs.length && idx < state.riders.length; i++) {
      const seg = segs[i];
      for (let slot = 0; slot < 2 && idx < state.riders.length; slot++, idx++) {
        const kindKey = state.riders[idx];
        const critter = CRITTERS.find((c) => c.key === kindKey) || CRITTERS[0];
        const off = (slot === 0 ? -1 : 1) * len * 0.2;
        const px = seg.x + Math.cos(seg.angle) * off;
        const py = seg.y + Math.sin(seg.angle) * off;
        drawCritter(px, py, r * 0.42, critter, {
          facing: seg.angle + Math.PI / 2,
          bob: Math.sin(state.time * 3 + idx * 1.3) * 0.8,
        });
      }
    }
  }

  function drawCarriage(seg, index, r, len, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(seg.x, seg.y);
    ctx.rotate(seg.angle);

    // ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    roundRect(-len / 2 + 2.5, -r * 0.94 + 6, len, r * 1.88, r * 0.58);
    ctx.fill();

    // wheels
    ctx.fillStyle = '#241f1c';
    for (const side of [-1, 1]) {
      for (const along of [-len * 0.29, len * 0.29]) {
        ctx.beginPath();
        ctx.ellipse(along, side * (r * 0.9), r * 0.23, r * 0.115, 0, 0, TAU);
        ctx.fill();
      }
    }

    // body
    const base = TRAIN_COLORS[index % TRAIN_COLORS.length];
    const body = ctx.createLinearGradient(0, -r, 0, r);
    body.addColorStop(0, '#f0a98b');
    body.addColorStop(0.42, base);
    body.addColorStop(1, '#7e4133');
    ctx.fillStyle = body;
    roundRect(-len / 2, -r, len, r * 2, r * 0.5);
    ctx.fill();

    // rim light along the roof
    ctx.strokeStyle = 'rgba(255, 236, 214, 0.22)';
    ctx.lineWidth = Math.max(1, 1.6 * scale);
    roundRect(-len / 2 + 1.5, -r + 1.5, len - 3, r * 2 - 3, r * 0.46);
    ctx.stroke();

    // roof panel
    ctx.fillStyle = 'rgba(255, 241, 222, 0.16)';
    roundRect(-len / 2 + r * 0.22, -r * 0.62, len - r * 0.44, r * 1.24, r * 0.38);
    ctx.fill();

    // warm side windows
    ctx.fillStyle = 'rgba(255, 214, 140, 0.92)';
    for (const side of [-1, 1]) {
      for (const along of [-len * 0.16, len * 0.16]) {
        ctx.beginPath();
        ctx.ellipse(along, side * r * 0.63, r * 0.14, r * 0.085, 0, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawEngine(head, r, el, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(head.x, head.y);
    ctx.rotate(head.angle);

    // Headlight beam, cast ahead of the train.
    const beam = ctx.createRadialGradient(el * 0.44, 0, r * 0.2, el * 0.44, 0, r * 5.4);
    beam.addColorStop(0, 'rgba(255, 226, 150, 0.26)');
    beam.addColorStop(0.32, 'rgba(255, 210, 120, 0.09)');
    beam.addColorStop(1, 'rgba(255, 210, 120, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.arc(el * 0.44, 0, r * 5.4, 0, TAU);
    ctx.fill();

    // ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
    roundRect(-el / 2 + 2.5, -r * 1.02 + 6, el, r * 2.04, r * 0.6);
    ctx.fill();

    // wheels — three axles for the engine
    ctx.fillStyle = '#241f1c';
    for (const side of [-1, 1]) {
      for (const along of [-el * 0.34, -el * 0.02, el * 0.3]) {
        ctx.beginPath();
        ctx.ellipse(along, side * (r * 0.94), r * 0.25, r * 0.13, 0, 0, TAU);
        ctx.fill();
      }
    }

    // boiler
    const boiler = ctx.createLinearGradient(0, -r, 0, r);
    boiler.addColorStop(0, '#ffd8a6');
    boiler.addColorStop(0.4, '#e79a5b');
    boiler.addColorStop(1, '#8f4d2c');
    ctx.fillStyle = boiler;
    roundRect(-el * 0.46, -r * 0.94, el * 0.88, r * 1.88, r * 0.52);
    ctx.fill();

    // cab at the back, slightly wider
    const cab = ctx.createLinearGradient(0, -r * 1.1, 0, r * 1.1);
    cab.addColorStop(0, '#e9a878');
    cab.addColorStop(0.45, '#c4703f');
    cab.addColorStop(1, '#7a3c24');
    ctx.fillStyle = cab;
    roundRect(-el * 0.52, -r * 1.06, el * 0.34, r * 2.12, r * 0.5);
    ctx.fill();

    // cab roof
    ctx.fillStyle = 'rgba(255, 241, 222, 0.2)';
    roundRect(-el * 0.48, -r * 0.66, el * 0.26, r * 1.32, r * 0.36);
    ctx.fill();

    // boiler highlight
    ctx.fillStyle = 'rgba(255, 245, 225, 0.26)';
    roundRect(-el * 0.3, -r * 0.62, el * 0.66, r * 1.24, r * 0.4);
    ctx.fill();

    // dark band around the boiler
    ctx.fillStyle = 'rgba(74, 38, 22, 0.5)';
    roundRect(el * 0.02, -r * 0.94, r * 0.26, r * 1.88, r * 0.1);
    ctx.fill();

    // chimney
    const chim = el * 0.12;
    ctx.fillStyle = '#5a463a';
    ctx.beginPath();
    ctx.arc(chim, 0, r * 0.35, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffb163';
    ctx.beginPath();
    ctx.arc(chim, 0, r * 0.24, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2c211b';
    ctx.beginPath();
    ctx.arc(chim, 0, r * 0.15, 0, TAU);
    ctx.fill();

    // headlight lamp at the nose
    ctx.fillStyle = '#3c2d24';
    ctx.beginPath();
    ctx.arc(el * 0.42, 0, r * 0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff0c2';
    ctx.beginPath();
    ctx.arc(el * 0.42, 0, r * 0.19, 0, TAU);
    ctx.fill();

    // a little face, because it is a cuddly train
    ctx.fillStyle = '#2a2126';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(el * 0.29, side * r * 0.44, r * 0.105, r * 0.13, 0, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(el * 0.315, side * r * 0.44 - r * 0.045, r * 0.042, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(42, 33, 38, 0.62)';
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(el * 0.3, 0, r * 0.17, -0.64 * Math.PI, -0.36 * Math.PI);
    ctx.stroke();

    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    for (const p of particles) {
      const lifeT = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = lifeT;

      if (p.shape === 'puff') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.4, p.size), 0, TAU);
        ctx.fill();
      } else if (p.shape === 'text') {
        ctx.save();
        ctx.globalAlpha = lifeT * lifeT;
        ctx.fillStyle = p.color;
        ctx.font = `800 ${Math.round(p.size)}px ui-rounded, "Segoe UI Rounded", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 8;
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.4, p.size), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawFireflies() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fireflies) {
      const twinkle = 0.35 + 0.65 * Math.pow(Math.abs(Math.sin(f.phase * 0.8)), 2);
      const r = f.r * (2.6 + twinkle * 1.8);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, `hsla(${f.hue}, 100%, 78%, ${0.75 * twinkle})`);
      g.addColorStop(0.35, `hsla(${f.hue}, 100%, 62%, ${0.22 * twinkle})`);
      g.addColorStop(1, `hsla(${f.hue}, 100%, 60%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawVignette() {
    const v = ctx.createRadialGradient(
      W * 0.5,
      H * 0.55,
      Math.min(W, H) * 0.32,
      W * 0.5,
      H * 0.55,
      Math.max(W, H) * 0.78
    );
    v.addColorStop(0, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, 'rgba(2, 8, 8, 0.62)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  // After the run ends the leftovers drift quietly off the bottom of the
  // screen, so the game-over panel sits over a calm field.
  function fadeField(dt) {
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.y += 90 * scale * dt;
      o.rot += 0.25 * dt;
      if (o.y - o.r > H + 40) obstacles.splice(i, 1);
    }
    for (let i = passengers.length - 1; i >= 0; i--) {
      const p = passengers[i];
      p.y += 90 * scale * dt;
      p.bob += dt * 2;
      if (p.y - p.r > H + 40) passengers.splice(i, 1);
    }
  }

  function drawIdleScene() {
    // Gentle drifting scenery behind the title screen.
    for (let i = 0; i < 2; i++) {
      if (particles.length < 120 && Math.random() < 0.4) {
        particles.push({
          x: rand(0, W),
          y: -10,
          vx: rand(-8, 8),
          vy: rand(10, 26),
          life: rand(3, 6),
          maxLife: 6,
          size: rand(1, 2.4) * scale,
          color: `hsla(${rand(45, 70)}, 100%, 78%, 0.5)`,
          gravity: 0,
          drag: 0,
          grow: 0,
          spin: 0,
          rot: 0,
          shape: 'dot',
        });
      }
    }
    updateParticles(1 / 60);
    drawParticles();
  }

  /* ---------------------------------------------------------------- input */

  function setPointer(clientX, clientY) {
    pointer.x = clientX;
    pointer.y = clientY;
    pointer.active = true;
    pointer.seen = true;
  }

  window.addEventListener(
    'pointermove',
    (e) => {
      setPointer(e.clientX, e.clientY);
    },
    { passive: true }
  );

  window.addEventListener(
    'pointerdown',
    (e) => {
      setPointer(e.clientX, e.clientY);
      if (state.mode === 'menu' && e.target === canvas) startGame();
    },
    { passive: true }
  );

  window.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length) setPointer(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: true }
  );

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (state.mode === 'playing') pauseGame();
      else if (state.mode === 'paused') resumeGame();
    }
    if (e.key === ' ' || e.key === 'Enter') {
      if (state.mode === 'menu') {
        e.preventDefault();
        startGame();
      } else if (state.mode === 'over') {
        e.preventDefault();
        startGame();
      }
    }
    if (e.key === 'm' || e.key === 'M') toggleMute();
  });

  el.play.addEventListener('click', startGame);
  el.again.addEventListener('click', startGame);
  el.resume.addEventListener('click', resumeGame);

  function toggleMute() {
    Sound.init();
    Sound.setMuted(!Sound.muted);
    el.mute.classList.toggle('is-off', Sound.muted);
    el.mute.setAttribute('aria-pressed', Sound.muted ? 'true' : 'false');
    try {
      localStorage.setItem('cuddly-express-muted', Sound.muted ? '1' : '0');
    } catch (_) {
      /* ignore */
    }
  }
  el.mute.addEventListener('click', toggleMute);

  window.addEventListener('blur', pauseGame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
  });

  window.addEventListener('resize', () => {
    resize();
  });

  /* ----------------------------------------------------------------- loop */

  let last = performance.now();

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (state.mode === 'playing') {
      update(dt);
      draw();
    } else if (state.mode === 'paused') {
      draw();
    } else {
      // menu / game over: keep the world alive but still.
      state.time += dt * 0.35;
      updateScenery(dt, 42 * scale);
      updateFireflies(dt, 42 * scale);
      if (state.mode === 'over') {
        updateParticles(dt);
        fadeField(dt);
      }
      draw();
      drawTrain();
      drawParticles();
      drawIdleScene();
    }

    requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------------------- boot */

  function boot() {
    try {
      state.best = parseInt(localStorage.getItem('cuddly-express-best') || '0', 10) || 0;
      if (localStorage.getItem('cuddly-express-muted') === '1') {
        Sound.muted = true;
        el.mute.classList.add('is-off');
      }
    } catch (_) {
      state.best = 0;
    }

    resize();
    el.best.textContent = String(state.best);
    if (el.menuBest) el.menuBest.textContent = String(state.best);

    // A static train behind the title screen so the game looks alive.
    const cx = W * 0.5;
    const cy = H * 0.62;
    train.segs.push({ x: cx, y: cy, angle: -Math.PI / 2 });
    for (let i = 0; i < 2; i++) {
      train.segs.push({ x: cx, y: cy + train.spacing * (i + 1), angle: -Math.PI / 2 });
    }
    state.riders.push('bunny', 'cat', 'bear');

    renderHearts();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------- dev hook */
  /* Handy for poking at the game from the console, and for automated tests. */
  window.CuddlyExpress = {
    state,
    train,
    get obstacles() { return obstacles; },
    get passengers() { return passengers; },
    start: startGame,
    pause: pauseGame,
    resume: resumeGame,
    multiplier,
  };

  boot();
})();
