/* =============================================================================
   Deep Dig
   A top-down mining game.

   Controls:
     W A S D   walk
     mouse     hold left button to mine the tile you are pointing at
     Space     mine the tile you are facing (keyboard-only mining)
     1 .. 0    select inventory slot (1 = first slot, 0 = tenth)

   The world is a grid of tiles generated on demand from value noise, so it is
   effectively endless sideways and downward (until the bedrock floor). Rock and
   ore are solid: you walk through tunnels you have carved yourself.

   No dependencies, no build step.
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

  /* ---------------------------------------------------------------- world */

  const TS = 32; // tile size in pixels

  // Tile ids. Rock-like tiles are solid; AIR is walkable floor.
  const AIR = 0;
  const DIRT = 1;
  const ROCK = 2;
  const COAL = 3;
  const IRON = 4;
  const GOLD = 5;
  const DIAMOND = 6;
  const BEDROCK = 7;

  // How long each tile takes to break, in seconds.
  const TILES = {
    [AIR]: { solid: false },
    [DIRT]: { solid: true, hardness: 0.26, base: '#453428', edge: '#573f2e' },
    [ROCK]: { solid: true, hardness: 0.52, base: '#333a47', edge: '#424b5a' },
    [COAL]: { solid: true, hardness: 0.62, base: '#2e343f', edge: '#3b4350', ore: 'coal' },
    [IRON]: { solid: true, hardness: 0.86, base: '#3a3540', edge: '#474050', ore: 'iron' },
    [GOLD]: { solid: true, hardness: 1.05, base: '#3d392f', edge: '#4b4636', ore: 'gold' },
    [DIAMOND]: { solid: true, hardness: 1.5, base: '#2f3d45', edge: '#3a4a54', ore: 'diamond' },
    [BEDROCK]: { solid: true, hardness: Infinity, base: '#151922', edge: '#1d222c' },
  };

  const ITEMS = {
    coal: { name: 'Coal', color: '#7f8b9c', value: 6 },
    iron: { name: 'Iron', color: '#c98d6e', value: 18 },
    gold: { name: 'Gold', color: '#ffc94a', value: 55 },
    diamond: { name: 'Diamond', color: '#77e6ff', value: 180 },
  };

  // Rarest first: the first ore whose vein noise is high enough wins the tile.
  const ORE_DEFS = [
    { tile: DIAMOND, minDepth: 46, scale: 3.2, threshold: 0.945, seed: 101, drop: [1, 1] },
    { tile: GOLD, minDepth: 26, scale: 3.0, threshold: 0.908, seed: 202, drop: [1, 2] },
    { tile: IRON, minDepth: 11, scale: 3.4, threshold: 0.872, seed: 303, drop: [1, 2] },
    { tile: COAL, minDepth: 3, scale: 2.8, threshold: 0.851, seed: 404, drop: [2, 3] },
  ];

  const WORLD_BOTTOM = 260; // bedrock starts here — the bottom of the world
  const START_ROW = 3; // the row the player starts on (depth 0)
  const REACH = 3.0 * TS; // how far you can mine from your centre
  const SPEED = 172; // pixels per second
  const PLAYER_R = 11;

  // Deterministic hash → [0, 1)
  function hash2(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Smoothly interpolated value noise on the tile grid.
  function noise2(x, y, scale, seed) {
    const fx = x / scale;
    const fy = y / scale;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = hash2(x0, y0, seed);
    const b = hash2(x0 + 1, y0, seed);
    const c = hash2(x0, y0 + 1, seed);
    const d = hash2(x0 + 1, y0 + 1, seed);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  }

  /* ------------------------------------------------------------- elements */

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');

  const el = {
    hud: document.getElementById('hud'),
    depth: document.getElementById('depth'),
    value: document.getElementById('value'),
    hotbar: document.getElementById('hotbar'),
    toast: document.getElementById('toast'),
    mute: document.getElementById('mute'),
    menu: document.getElementById('menu'),
    pause: document.getElementById('pause'),
    play: document.getElementById('play'),
    resume: document.getElementById('resume'),
  };

  /* ---------------------------------------------------------------- audio */

  const Sound = {
    ctx: null,
    master: null,
    muted: false,

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.45;
      this.master.connect(this.ctx.destination);
    },

    setMuted(muted) {
      this.muted = muted;
      if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.45, this.ctx.currentTime, 0.02);
    },

    blip(freq, dur, { type = 'sine', gain = 0.12, to = null, delay = 0 } = {}) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(env);
      env.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    hit() {
      // a short chip off the rock
      this.blip(rand(150, 200), 0.055, { type: 'square', gain: 0.05, to: 90 });
    },
    breakRock() {
      this.blip(120, 0.13, { type: 'sawtooth', gain: 0.08, to: 55 });
    },
    pickup() {
      this.blip(720, 0.09, { type: 'triangle', gain: 0.09 });
      this.blip(1080, 0.08, { type: 'sine', gain: 0.045, delay: 0.035 });
    },
    full() {
      this.blip(200, 0.16, { type: 'square', gain: 0.07, to: 150 });
    },
  };

  /* ---------------------------------------------------------------- state */

  const state = {
    mode: 'menu', // menu | playing | paused
    time: 0,
    value: 0,
    depth: 0,
    shake: 0,
    slot: 0, // selected inventory slot, 0-9
    collected: { coal: 0, iron: 0, gold: 0, diamond: 0 },
  };

  const player = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    faceX: 0,
    faceY: 1,
    walking: 0,
  };

  const camera = { x: 0, y: 0 };

  const pointer = { x: 0, y: 0, down: false, inside: false };
  const keys = new Set();

  const inventory = new Array(10).fill(null); // { item, count }
  const dropped = []; // ore lying on the floor
  const particles = [];
  const props = []; // lanterns etc.

  // tiles that differ from generated terrain (everything the player has dug)
  const overrides = new Map();
  const tileKey = (tx, ty) => tx + ',' + ty;

  let W = 0;
  let H = 0;

  /* ------------------------------------------------------------ tile data */

  function generatedTile(tx, ty) {
    if (ty >= WORLD_BOTTOM) return BEDROCK;

    const depth = ty;

    // Natural caverns, so the rock is not one solid mass.
    if (depth > 5 && noise2(tx, ty, 8, 77) > 0.8) return AIR;

    for (const o of ORE_DEFS) {
      if (depth >= o.minDepth && noise2(tx, ty, o.scale, o.seed) > o.threshold) return o.tile;
    }

    if (depth <= START_ROW) return DIRT;
    if (depth <= 6 && hash2(tx, ty, 11) < 0.5) return DIRT;
    return ROCK;
  }

  function tileAt(tx, ty) {
    const o = overrides.get(tileKey(tx, ty));
    return o === undefined ? generatedTile(tx, ty) : o;
  }

  function setTile(tx, ty, id) {
    if (id === generatedTile(tx, ty)) overrides.delete(tileKey(tx, ty));
    else overrides.set(tileKey(tx, ty), id);
  }

  const isSolid = (tx, ty) => !!TILES[tileAt(tx, ty)].solid;

  /* ---------------------------------------------------------------- input */

  const MOVE_KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) {
      if (MOVE_KEYS[e.code] || e.code === 'Space') e.preventDefault();
      return;
    }
    if (MOVE_KEYS[e.code] || e.code === 'Space') e.preventDefault();
    keys.add(e.code);

    // 1 .. 9 then 0 → slots 0 .. 9
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) selectSlot(n - 1);
      else if (n === 0) selectSlot(9);
    } else if (e.code === 'Numpad1') {
      selectSlot(0);
    } else if (e.code === 'Escape') {
      if (state.mode === 'playing') pauseGame();
      else if (state.mode === 'paused') resumeGame();
    } else if (e.code === 'KeyM') {
      toggleMute();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      if (state.mode === 'menu') startGame();
      else if (state.mode === 'paused') resumeGame();
    }
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });

  window.addEventListener('blur', () => {
    keys.clear();
    pointer.down = false;
    if (state.mode === 'playing') pauseGame();
  });

  function setPointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    pointer.x = clientX - (rect.left || 0);
    pointer.y = clientY - (rect.top || 0);
    pointer.inside = true;
  }

  canvas.addEventListener('pointermove', (e) => setPointer(e.clientX, e.clientY));
  canvas.addEventListener('pointerdown', (e) => {
    setPointer(e.clientX, e.clientY);
    pointer.down = true;
    Sound.init();
    if (e.button === 0) e.preventDefault();
  });
  window.addEventListener('pointerup', () => {
    pointer.down = false;
  });
  canvas.addEventListener('pointerleave', () => {
    pointer.inside = false;
    pointer.down = false;
  });

  /* ------------------------------------------------------------- hotbar UI */

  const slotEls = [];

  function buildHotbar() {
    el.hotbar.innerHTML = '';
    slotEls.length = 0;
    for (let i = 0; i < 10; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot';
      btn.dataset.slot = String(i);
      btn.setAttribute('aria-label', `Inventory slot ${i + 1}`);

      const key = document.createElement('span');
      key.className = 'slot-key';
      key.textContent = i === 9 ? '0' : String(i + 1);

      const gem = document.createElement('span');
      gem.className = 'gem';

      const count = document.createElement('span');
      count.className = 'slot-count';

      btn.appendChild(key);
      btn.appendChild(gem);
      btn.appendChild(count);
      btn.addEventListener('click', () => selectSlot(i));

      el.hotbar.appendChild(btn);
      slotEls.push({ btn, gem, count });
    }
    syncHotbar();
  }

  function selectSlot(i) {
    state.slot = clamp(i, 0, 9);
    for (let s = 0; s < slotEls.length; s++) {
      slotEls[s].btn.classList.toggle('is-selected', s === state.slot);
    }
  }

  function syncHotbar() {
    for (let i = 0; i < slotEls.length; i++) {
      const cell = slotEls[i];
      const item = inventory[i];
      cell.btn.classList.toggle('is-selected', i === state.slot);
      if (item && ITEMS[item.item]) {
        cell.btn.classList.add('has-item');
        cell.gem.style.setProperty('--gem', ITEMS[item.item].color);
        cell.count.textContent = item.count > 1 ? String(item.count) : '';
        cell.btn.title = ITEMS[item.item].name;
      } else {
        cell.btn.classList.remove('has-item');
        cell.count.textContent = '';
        cell.btn.removeAttribute('title');
      }
    }
  }

  /* ----------------------------------------------------------- inventory */

  const STACK_MAX = 99;

  // Returns how many could not fit.
  function addItem(itemKey, count) {
    let left = count;

    for (let i = 0; i < inventory.length && left > 0; i++) {
      const cell = inventory[i];
      if (cell && cell.item === itemKey && cell.count < STACK_MAX) {
        const room = STACK_MAX - cell.count;
        const move = Math.min(room, left);
        cell.count += move;
        left -= move;
      }
    }
    for (let i = 0; i < inventory.length && left > 0; i++) {
      if (!inventory[i]) {
        const move = Math.min(STACK_MAX, left);
        inventory[i] = { item: itemKey, count: move };
        left -= move;
      }
    }

    if (left !== count) syncHotbar();
    return left;
  }

  function countItem(itemKey) {
    let n = 0;
    for (const cell of inventory) if (cell && cell.item === itemKey) n += cell.count;
    return n;
  }

  /* -------------------------------------------------------------- mining */

  const mining = { tx: null, ty: null, progress: 0, swing: 0 };

  function playerTile() {
    return { tx: Math.floor(player.x / TS), ty: Math.floor(player.y / TS) };
  }

  function tileCenter(tx, ty) {
    return { x: (tx + 0.5) * TS, y: (ty + 0.5) * TS };
  }

  // Which tile would the player like to mine this frame?
  function miningTarget() {
    if (pointer.down && pointer.inside) {
      const wx = pointer.x + camera.x - W / 2;
      const wy = pointer.y + camera.y - H / 2;
      const tx = Math.floor(wx / TS);
      const ty = Math.floor(wy / TS);
      const c = tileCenter(tx, ty);
      if (Math.hypot(c.x - player.x, c.y - player.y) <= REACH && isSolid(tx, ty)) {
        return { tx, ty };
      }
      return null;
    }

    if (keys.has('Space')) {
      const p = playerTile();
      const tx = p.tx + player.faceX;
      const ty = p.ty + player.faceY;
      if (isSolid(tx, ty)) return { tx, ty };
    }

    return null;
  }

  function updateMining(dt) {
    const target = miningTarget();
    const wantMine = (pointer.down && pointer.inside) || keys.has('Space');

    if (!target) {
      mining.tx = null;
      mining.ty = null;
      mining.progress = 0;
      mining.swing = lerp(mining.swing, 0, 1 - Math.pow(0.001, dt));
      return;
    }

    if (mining.tx !== target.tx || mining.ty !== target.ty) {
      mining.tx = target.tx;
      mining.ty = target.ty;
      mining.progress = 0;
    }

    if (!wantMine) return;

    const id = tileAt(target.tx, target.ty);
    const def = TILES[id];
    mining.progress += dt / def.hardness;
    mining.swing += dt * 15;

    if (mining.progress >= 1) {
      breakTile(target.tx, target.ty, id);
      mining.progress = 0;
      mining.tx = null;
      mining.ty = null;
    }
  }

  function breakTile(tx, ty, id) {
    const def = TILES[id];
    if (!isFinite(def.hardness)) {
      showToast('That is bedrock — nothing gets through it.');
      Sound.full();
      return;
    }

    const c = tileCenter(tx, ty);
    setTile(tx, ty, AIR);
    state.shake = 0.5;

    burst(c.x, c.y, 12, [shade(def.base, 1.35), shade(def.base, 0.75), shade(def.base, 1.1)], 150, 0.5, 0.16);

    if (def.ore) {
      const oreDef = ORE_DEFS.find((o) => o.tile === id);
      const amount = randInt(oreDef.drop[0], oreDef.drop[1]);
      spawnDrop(c.x, c.y, def.ore, amount);
      Sound.pickup();
      burst(c.x, c.y, 8, [ITEMS[def.ore].color, '#ffffff'], 120, 0.45, 0.12);
    } else {
      Sound.breakRock();
    }
  }

  function spawnDrop(x, y, itemKey, count) {
    dropped.push({
      x,
      y,
      item: itemKey,
      count,
      vx: rand(-40, 40),
      vy: rand(-40, 40),
      age: 0,
      bob: rand(0, TAU),
    });
  }

  function updateDrops(dt) {
    for (let i = dropped.length - 1; i >= 0; i--) {
      const d = dropped[i];
      d.age += dt;
      d.bob += dt * 3;

      const dx = player.x - d.x;
      const dy = player.y - d.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 130 && d.age > 0.12) {
        const pull = (1 - dist / 130) * 900;
        d.vx += (dx / (dist || 1)) * pull * dt;
        d.vy += (dy / (dist || 1)) * pull * dt;
      }

      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= 1 - 5.5 * dt;
      d.vy *= 1 - 5.5 * dt;

      if (dist < 20) {
        const left = addItem(d.item, d.count);
        if (left === 0) {
          state.value += ITEMS[d.item].value * d.count;
          state.collected[d.item] = (state.collected[d.item] || 0) + d.count;
          dropped.splice(i, 1);
          Sound.pickup();
          continue;
        } else if (left < d.count) {
          state.value += ITEMS[d.item].value * (d.count - left);
          state.collected[d.item] = (state.collected[d.item] || 0) + (d.count - left);
          d.count = left;
          showToast('Bag is full!');
          Sound.full();
        } else if (d.age > 0.4) {
          showToast('Bag is full!');
          Sound.full();
          d.age = -0.8; // throttle the reminder
        }
      }
    }
  }

  /* ------------------------------------------------------------- movement */

  function collides(x, y) {
    const x0 = Math.floor((x - PLAYER_R) / TS);
    const x1 = Math.floor((x + PLAYER_R - 0.001) / TS);
    const y0 = Math.floor((y - PLAYER_R) / TS);
    const y1 = Math.floor((y + PLAYER_R - 0.001) / TS);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (isSolid(tx, ty)) return true;
      }
    }
    return false;
  }

  function updatePlayer(dt) {
    let ix = 0;
    let iy = 0;
    for (const code of keys) {
      const dir = MOVE_KEYS[code];
      if (dir) {
        ix += dir[0];
        iy += dir[1];
      }
    }

    const len = Math.hypot(ix, iy);
    if (len > 0) {
      ix /= len;
      iy /= len;
      player.faceX = ix;
      player.faceY = iy;
      player.walking += dt * 11;
    } else {
      player.walking = lerp(player.walking, 0, 1 - Math.pow(0.001, dt));
    }

    const stepX = ix * SPEED * dt;
    const stepY = iy * SPEED * dt;

    if (stepX !== 0 && !collides(player.x + stepX, player.y)) player.x += stepX;
    if (stepY !== 0 && !collides(player.x, player.y + stepY)) player.y += stepY;

    // keep the player above the bedrock floor
    const maxY = WORLD_BOTTOM * TS - PLAYER_R;
    player.y = clamp(player.y, PLAYER_R, maxY);
    player.x = clamp(player.x, -1e6, 1e6);

    if (len > 0 && Math.random() < 0.18) {
      particles.push({
        x: player.x + rand(-5, 5),
        y: player.y + PLAYER_R * 0.8,
        vx: rand(-10, 10),
        vy: rand(-6, 4),
        life: rand(0.25, 0.5),
        maxLife: 0.5,
        size: rand(1, 2.2),
        color: 'rgba(150, 160, 175, 0.4)',
        drag: 2,
        grow: 0,
      });
    }
  }

  function updateCamera(dt) {
    const k = 1 - Math.pow(0.0005, dt);
    camera.x = lerp(camera.x, player.x, k);
    camera.y = lerp(camera.y, player.y, k);
  }

  /* ------------------------------------------------------------ particles */

  function burst(x, y, count, colors, speed, life, size) {
    for (let i = 0; i < count; i++) {
      if (particles.length > 420) break;
      const a = rand(0, TAU);
      const v = rand(0.3, 1) * speed;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: rand(0.6, 1) * life,
        maxLife: life,
        size: rand(0.6, 1.4) * size * TS,
        color: pick(colors),
        drag: 3.2,
        grow: -0.06 * TS,
      });
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
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      if (p.grow) p.size = Math.max(0.3, p.size + p.grow * dt);
    }
  }

  /* ------------------------------------------------------------------ HUD */

  let lastHud = { depth: -1, value: -1 };

  function syncHud(force) {
    const depth = Math.max(0, Math.floor(player.y / TS) - START_ROW);
    if (force || depth !== lastHud.depth) {
      el.depth.textContent = String(depth);
      lastHud.depth = depth;
    }
    const value = Math.round(state.value);
    if (force || value !== lastHud.value) {
      el.value.textContent = String(value);
      lastHud.value = value;
    }
    state.depth = depth;
  }

  let toastTimer = 0;
  let toastText = '';

  function showToast(text) {
    if (text === toastText && toastTimer > 0) return;
    toastText = text;
    toastTimer = 1.8;
    el.toast.textContent = text;
    el.toast.classList.add('is-on');
  }

  function updateToast(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) el.toast.classList.remove('is-on');
    }
  }

  /* --------------------------------------------------------------- update */

  function update(dt) {
    state.time += dt;

    updatePlayer(dt);
    updateMining(dt);
    updateDrops(dt);
    updateParticles(dt);
    updateCamera(dt);
    updateToast(dt);

    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 3);

    syncHud(false);
  }

  /* --------------------------------------------------------------- drawing */

  const shades = new Map(); // tile id -> array of 4 base shades

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(Math.round(((n >> 16) & 255) * amt), 0, 255);
    const g = clamp(Math.round(((n >> 8) & 255) * amt), 0, 255);
    const b = clamp(Math.round((n & 255) * amt), 0, 255);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function tileShades(id) {
    let arr = shades.get(id);
    if (!arr) {
      const base = TILES[id].base;
      arr = [shade(base, 1), shade(base, 0.92), shade(base, 1.08), shade(base, 0.85)];
      shades.set(id, arr);
    }
    return arr;
  }

  let lightCanvas = null;
  let lctx = null;

  function makeLightCanvas() {
    lightCanvas = document.createElement('canvas');
    lightCanvas.width = Math.max(1, W);
    lightCanvas.height = Math.max(1, H);
    lctx = lightCanvas.getContext('2d');
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    makeLightCanvas();
  }

  function draw() {
    const shakeX = state.shake > 0 ? rand(-1, 1) * state.shake * 6 : 0;
    const shakeY = state.shake > 0 ? rand(-1, 1) * state.shake * 6 : 0;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    ctx.fillStyle = '#05070c';
    ctx.fillRect(-20, -20, W + 40, H + 40);

    const camX = Math.round(camera.x);
    const camY = Math.round(camera.y);
    const originX = W / 2 - camX;
    const originY = H / 2 - camY;

    const tx0 = Math.floor((camX - W / 2) / TS) - 1;
    const tx1 = Math.ceil((camX + W / 2) / TS) + 1;
    const ty0 = Math.floor((camY - H / 2) / TS) - 1;
    const ty1 = Math.ceil((camY + H / 2) / TS) + 1;

    drawTiles(tx0, ty0, tx1, ty1, originX, originY);
    drawProps(originX, originY);
    drawDrops(originX, originY);
    drawParticles(originX, originY);
    drawPlayer(originX, originY);
    drawMiningOverlay(originX, originY);
    drawReticle();

    drawDarkness(originX, originY);
    drawGlow(originX, originY);
    drawVignette();

    ctx.restore();
  }

  function drawTiles(tx0, ty0, tx1, ty1, ox, oy) {
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = tileAt(tx, ty);
        const x = tx * TS + ox;
        const y = ty * TS + oy;

        if (id === AIR) {
          // tunnel floor: warm dust, with grit
          ctx.fillStyle = '#191d24';
          ctx.fillRect(x, y, TS + 1, TS + 1);
          const h = hash2(tx, ty, 5);
          ctx.fillStyle = 'rgba(255, 220, 170, 0.035)';
          ctx.fillRect(x + (h * TS) % (TS - 4), y + ((h * 37) % (TS - 4)), 3.5, 3);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
          ctx.fillRect(x + ((h * 61) % (TS - 4)), y + ((h * 13) % (TS - 4)), 3, 2.5);

          // shadow cast from each neighbouring wall, so tunnels read as carved
          const g = 'rgba(0, 0, 0, 0.42)';
          if (isSolid(tx, ty - 1)) { ctx.fillStyle = g; ctx.fillRect(x, y, TS + 1, 5); }
          if (isSolid(tx, ty + 1)) { ctx.fillStyle = g; ctx.fillRect(x, y + TS - 5, TS + 1, 5); }
          if (isSolid(tx - 1, ty)) { ctx.fillStyle = g; ctx.fillRect(x, y, 5, TS + 1); }
          if (isSolid(tx + 1, ty)) { ctx.fillStyle = g; ctx.fillRect(x + TS - 5, y, 5, TS + 1); }
          continue;
        }

        const def = TILES[id];
        const arr = tileShades(id);
        const v = Math.floor(hash2(tx, ty, 7) * 4);
        ctx.fillStyle = arr[v];
        ctx.fillRect(x, y, TS + 1, TS + 1);

        // bevel: lighter top edge, darker bottom edge
        ctx.fillStyle = 'rgba(255, 255, 255, 0.085)';
        ctx.fillRect(x, y, TS + 1, 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(x, y + TS - 2.5, TS + 1, 2.5);

        // a dark seam between tiles, so the grid reads clearly
        ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
        ctx.fillRect(x + TS - 1, y, 1.5, TS + 1);
        ctx.fillRect(x, y + TS - 1, TS + 1, 1.5);

        // speckled texture: a few dark pebbles and light chips per tile
        const h = hash2(tx, ty, 9);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.fillRect(x + (h * TS) % (TS - 5), y + ((h * 53) % (TS - 5)), 4.5, 3.5);
        ctx.fillRect(x + ((h * 29) % (TS - 5)), y + ((h * 71) % (TS - 5)), 3, 2.5);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.fillRect(x + ((h * 91) % (TS - 4)), y + ((h * 17) % (TS - 4)), 3.5, 2.5);

        // hairline cracks give the rock some age
        if (h > 0.45) {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          const cx = x + 6 + h * (TS - 16);
          const cy = y + 6 + ((h * 37) % (TS - 16));
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + 5, cy + 5);
          ctx.lineTo(cx + 3, cy + 11);
          ctx.stroke();
        }

        if (def.ore) drawOreNuggets(x, y, tx, ty, def.ore);
      }
    }
  }

  function drawOreNuggets(x, y, tx, ty, oreKey) {
    const color = ITEMS[oreKey].color;
    const dark = shade(color, 0.55);
    const blobs = 3;
    for (let i = 0; i < blobs; i++) {
      const h1 = hash2(tx * 3 + i, ty * 7 + i * 13, 31);
      const h2 = hash2(tx * 5 + i * 7, ty * 3 + i, 41);
      const nx = x + 5 + h1 * (TS - 10);
      const ny = y + 5 + h2 * (TS - 10);
      const r = 3.1 + h1 * 2.6;

      // dark backing so the metal pops off the rock
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.arc(nx + 0.8, ny + 1, r * 1.12, 0, TAU);
      ctx.fill();

      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, TAU);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(nx - r * 0.14, ny - r * 0.16, r * 0.78, 0, TAU);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(nx - r * 0.32, ny - r * 0.36, r * 0.3, 0, TAU);
      ctx.fill();
    }
  }

  function drawProps(ox, oy) {
    for (const p of props) {
      const x = p.x + ox;
      const y = p.y + oy;
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;

      // post
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(x + 3, y + 12, 9, 4, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = '#4a4038';
      ctx.fillRect(x - 2, y - 4, 4, 16);

      // lantern
      const flicker = 0.85 + Math.sin(state.time * 6 + p.phase) * 0.15;
      ctx.fillStyle = '#2a2620';
      ctx.beginPath();
      ctx.arc(x, y - 8, 7, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 196, 92, ${flicker})`;
      ctx.beginPath();
      ctx.arc(x, y - 8, 4.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 240, 200, ${flicker})`;
      ctx.beginPath();
      ctx.arc(x, y - 9, 2, 0, TAU);
      ctx.fill();
    }
  }

  function drawDrops(ox, oy) {
    for (const d of dropped) {
      const bob = Math.sin(d.bob) * 2.5;
      const x = d.x + ox;
      const y = d.y + oy + bob;
      if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;

      const color = ITEMS[d.item].color;

      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, y + 9, 7, 3, 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      // gem shape
      ctx.save();
      ctx.translate(x, y);
      const g = ctx.createRadialGradient(-2, -3, 1, 0, 0, 9);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, color);
      g.addColorStop(1, shade(color, 0.55));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(7, -2);
      ctx.lineTo(4.5, 8);
      ctx.lineTo(-4.5, 8);
      ctx.lineTo(-7, -2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawParticles(ox, oy) {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x + ox - p.size / 2, p.y + oy - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer(ox, oy) {
    const x = player.x + ox;
    const y = player.y + oy;

    // shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 10, 11, 5, 0, 0, TAU);
    ctx.fill();

    const bob = Math.sin(player.walking) * 1.6;

    ctx.save();
    ctx.translate(x, y + bob);

    // legs
    ctx.fillStyle = '#2c3a52';
    const legSwing = Math.sin(player.walking) * 3;
    ctx.fillRect(-6, 4, 4, 8 + legSwing * 0.3);
    ctx.fillRect(2, 4, 4, 8 - legSwing * 0.3);

    // body
    const body = ctx.createLinearGradient(0, -6, 0, 10);
    body.addColorStop(0, '#5c86c4');
    body.addColorStop(1, '#33507e');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-9, -7, 18, 15, 5) : ctx.rect(-9, -7, 18, 15);
    ctx.fill();

    // head
    ctx.fillStyle = '#e9b58d';
    ctx.beginPath();
    ctx.arc(0, -11, 7.5, 0, TAU);
    ctx.fill();

    // helmet
    ctx.fillStyle = '#ffc247';
    ctx.beginPath();
    ctx.arc(0, -12, 8.2, Math.PI, TAU);
    ctx.fill();
    ctx.fillRect(-8.2, -12, 16.4, 3);

    // helmet lamp
    const lx = player.faceX * 6;
    const ly = player.faceY * 6;
    ctx.fillStyle = '#fff6d5';
    ctx.beginPath();
    ctx.arc(lx, -10 + ly * 0.4, 2.6, 0, TAU);
    ctx.fill();

    // pickaxe, held out to the side and swung while mining
    const isMining = mining.tx !== null;
    const swing = isMining ? Math.sin(mining.swing) * 0.75 : 0.12;
    const aim = Math.atan2(player.faceY, player.faceX);
    ctx.save();
    ctx.translate(0, -2);
    ctx.rotate(aim + 0.55 + swing); // offsets it to the hand, not across the chest
    ctx.translate(11, 0);
    ctx.rotate(-0.75);

    // shaft
    ctx.strokeStyle = '#8a6a44';
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-7, 7);
    ctx.lineTo(6, -6);
    ctx.stroke();
    // head
    ctx.strokeStyle = '#c3cdd8';
    ctx.lineWidth = 3.8;
    ctx.beginPath();
    ctx.moveTo(1, -5);
    ctx.lineTo(8, -12);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(1.5, -6);
    ctx.lineTo(7, -11.5);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  function drawMiningOverlay(ox, oy) {
    if (mining.tx === null || mining.ty === null) return;

    const x = mining.tx * TS + ox;
    const y = mining.ty * TS + oy;
    const p = clamp(mining.progress, 0, 1);

    // darkening + crack lines as the tile weakens
    ctx.save();
    ctx.globalAlpha = p * 0.45;
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, TS, TS);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.2;
    const cracks = Math.floor(p * 4);
    for (let i = 0; i < cracks; i++) {
      const h = hash2(mining.tx + i, mining.ty - i, 3);
      ctx.beginPath();
      ctx.moveTo(x + h * TS, y + TS * 0.2);
      ctx.lineTo(x + TS * (0.3 + h * 0.4), y + TS * (0.55 + h * 0.25));
      ctx.lineTo(x + TS * (0.5 + h * 0.3), y + TS * 0.95);
      ctx.stroke();
    }
    ctx.restore();

    // outline + progress arc
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 205, 110, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, TS - 2, TS - 2);

    ctx.strokeStyle = 'rgba(255, 205, 110, 0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + TS - 3);
    ctx.lineTo(x + 3 + (TS - 6) * p, y + TS - 3);
    ctx.stroke();
    ctx.restore();
  }

  function drawReticle() {
    if (!pointer.inside || state.mode !== 'playing') return;
    const x = pointer.x;
    const y = pointer.y;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 12, y);
    ctx.lineTo(x - 8, y);
    ctx.moveTo(x + 8, y);
    ctx.lineTo(x + 12, y);
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x, y - 8);
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x, y + 12);
    ctx.stroke();
    ctx.restore();
  }

  function drawDarkness(ox, oy) {
    if (!lctx) return;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, W, H);
    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = 'rgba(3, 5, 10, 0.88)';
    lctx.fillRect(0, 0, W, H);

    lctx.globalCompositeOperation = 'destination-out';

    // the helmet lantern
    punchLight(player.x + ox, player.y + oy, 335, 0.95);
    punchLight(player.x + ox, player.y + oy, 120, 0.5);
    // lantern props
    for (const p of props) punchLight(p.x + ox, p.y - 8 + oy, 190, 0.8);

    ctx.drawImage(lightCanvas, 0, 0);
  }

  function punchLight(cx, cy, radius, strength) {
    const g = lctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, `rgba(0, 0, 0, ${strength})`);
    g.addColorStop(0.35, `rgba(0, 0, 0, ${strength * 0.9})`);
    g.addColorStop(0.62, `rgba(0, 0, 0, ${strength * 0.52})`);
    g.addColorStop(0.85, `rgba(0, 0, 0, ${strength * 0.16})`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    lctx.fillStyle = g;
    lctx.beginPath();
    lctx.arc(cx, cy, radius, 0, TAU);
    lctx.fill();
  }

  function drawGlow(ox, oy) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // warm halo from the helmet lamp
    const px = player.x + ox;
    const py = player.y + oy;
    const g = ctx.createRadialGradient(px, py, 8, px, py, 260);
    g.addColorStop(0, 'rgba(255, 198, 110, 0.18)');
    g.addColorStop(0.5, 'rgba(255, 170, 80, 0.06)');
    g.addColorStop(1, 'rgba(255, 170, 80, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, 260, 0, TAU);
    ctx.fill();

    for (const p of props) {
      const x = p.x + ox;
      const y = p.y - 8 + oy;
      const flicker = 0.85 + Math.sin(state.time * 6 + p.phase) * 0.15;
      const pg = ctx.createRadialGradient(x, y, 2, x, y, 120);
      pg.addColorStop(0, `rgba(255, 190, 100, ${0.22 * flicker})`);
      pg.addColorStop(1, 'rgba(255, 190, 100, 0)');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(x, y, 120, 0, TAU);
      ctx.fill();
    }

    // ore on the floor sparkles faintly
    for (const d of dropped) {
      const x = d.x + ox;
      const y = d.y + oy;
      const sg = ctx.createRadialGradient(x, y, 1, x, y, 26);
      sg.addColorStop(0, `rgba(${hexRgb(ITEMS[d.item].color)}, 0.3)`);
      sg.addColorStop(1, `rgba(${hexRgb(ITEMS[d.item].color)}, 0)`);
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(x, y, 26, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }

  function drawVignette() {
    const v = ctx.createRadialGradient(
      W / 2, H / 2, Math.min(W, H) * 0.36,
      W / 2, H / 2, Math.max(W, H) * 0.8
    );
    v.addColorStop(0, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  /* ------------------------------------------------------------- game flow */

  function buildWorld() {
    overrides.clear();
    props.length = 0;
    dropped.length = 0;
    particles.length = 0;

    // carve the starting chamber
    for (let ty = 0; ty <= START_ROW; ty++) {
      for (let tx = -3; tx <= 3; tx++) {
        setTile(tx, ty, AIR);
      }
    }

    player.x = 0.5 * TS;
    player.y = (START_ROW + 0.5) * TS;
    player.faceX = 0;
    player.faceY = 1;
    camera.x = player.x;
    camera.y = player.y;

    props.push({ x: -2.5 * TS, y: 1.5 * TS, phase: 0 });
    props.push({ x: 2.5 * TS, y: 1.5 * TS, phase: 1.7 });
  }

  function startGame() {
    Sound.init();
    buildWorld();
    for (let i = 0; i < inventory.length; i++) inventory[i] = null;
    state.value = 0;
    state.depth = 0;
    state.time = 0;
    state.collected = { coal: 0, iron: 0, gold: 0, diamond: 0 };
    selectSlot(0);
    syncHotbar();
    syncHud(true);

    state.mode = 'playing';
    stage.classList.add('is-playing');
    el.menu.classList.add('is-hidden');
    el.pause.classList.add('is-hidden');
    el.hud.classList.remove('is-hidden');
    el.hotbar.classList.remove('is-hidden');
    pointer.down = false;
    keys.clear();
  }

  function pauseGame() {
    if (state.mode !== 'playing') return;
    state.mode = 'paused';
    keys.clear();
    pointer.down = false;
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

  function toggleMute() {
    Sound.init();
    Sound.setMuted(!Sound.muted);
    el.mute.classList.toggle('is-off', Sound.muted);
    el.mute.setAttribute('aria-pressed', Sound.muted ? 'true' : 'false');
  }

  el.play.addEventListener('click', startGame);
  el.resume.addEventListener('click', resumeGame);
  el.mute.addEventListener('click', toggleMute);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
  });

  window.addEventListener('resize', resize);

  /* ------------------------------------------------------------------ loop */

  let last = 0;

  function frame(now) {
    if (!last) last = now;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (state.mode === 'playing') update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    resize();
    buildHotbar();
    buildWorld();
    syncHud(true);
    selectSlot(0);
    requestAnimationFrame(frame);
  }

  /* -------------------------------------------------------------- dev hook */

  window.DeepDig = {
    state,
    player,
    camera,
    inventory,
    ITEMS,
    TILES,
    tileAt,
    setTile,
    breakTile,
    selectSlot,
    addItem,
    countItem,
    start: startGame,
    pause: pauseGame,
    resume: resumeGame,
    get dropped() { return dropped; },
    get mining() { return mining; },
    get overrides() { return overrides; },
    get hotbarSlots() { return slotEls; },
  };

  boot();
})();
