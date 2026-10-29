/* =============================================================================
   Mining Simulator
   A top-down dungeon mining game.

   Controls
     W A S D / arrows   move
     Q                  equip the pickaxe
     E                  equip the sword
     Left click / Space swing the equipped tool

   You begin in Home Base. The stairs lead down to Stage 1, a preset cave whose
   rock is seeded randomly on every run: Stone and Coal break in one pickaxe hit,
   Copper takes two. Slimes live down there — three sword hits kill one, and it
   splits into two Tiny Slimes with half the health and half the bite.

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

  function hash2(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /* ------------------------------------------------------------------ tiles */

  const TS = 32;

  const FLOOR = 0;
  const WALL = 1;
  const STONE = 2;
  const COAL = 3;
  const COPPER = 4;
  const STAIRS_DOWN = 5;
  const STAIRS_UP = 6;

  // hits = pickaxe hits needed with the T1 pickaxe; null means indestructible
  const TILES = {
    [FLOOR]: { solid: false },
    [WALL]: { solid: true, hits: null, base: '#171b23' },
    [STONE]: { solid: true, hits: 1, drop: 'stone', base: '#4a525e' },
    [COAL]: { solid: true, hits: 1, drop: 'coal', base: '#3c434e' },
    [COPPER]: { solid: true, hits: 2, drop: 'copper', base: '#4d4a4a' },
    [STAIRS_DOWN]: { solid: false },
    [STAIRS_UP]: { solid: false },
  };

  const ITEMS = {
    stone: { name: 'Stone', color: '#98a4b2', value: 1 },
    coal: { name: 'Coal', color: '#5d6675', value: 4 },
    copper: { name: 'Copper', color: '#d58a4d', value: 12 },
  };

  /* -------------------------------------------------------------- balance */

  const BALANCE = {
    playerMaxHp: 100,
    // A normal slime hits for 20, so five of them finish the player off.
    swordDamage: 10, // 3 hits to kill a 30 HP slime
    pickaxeReach: 2.2 * TS,
    pickaxeCooldown: 0.3,
    swordCooldown: 0.36,
    swordRange: 72,
    swordArc: 1.15, // radians either side of the aim direction
    playerSpeed: 170,
    playerRadius: 10,
    invulnerableTime: 0.9,
    slimeHp: 30,
    slimeDamage: 20,
    slimeSpeed: 54,
    slimeRadius: 14,
    tinyHp: 15,
    tinyDamage: 10,
    tinySpeed: 82,
    tinyRadius: 9,
    maxSlimes: 7,
    slimeSpawnEvery: 3.4,
  };

  /* ------------------------------------------------------------- elements */

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');

  const el = {
    hud: document.getElementById('hud'),
    hpFill: document.getElementById('hp-fill'),
    hpText: document.getElementById('hp-text'),
    stageName: document.getElementById('stage-name'),
    dock: document.getElementById('dock'),
    toolbelt: document.getElementById('toolbelt'),
    bag: document.getElementById('bag'),
    toast: document.getElementById('toast'),
    mute: document.getElementById('mute'),
    menu: document.getElementById('menu'),
    pause: document.getElementById('pause'),
    over: document.getElementById('over'),
    overLine: document.getElementById('over-line'),
    overOre: document.getElementById('over-ore'),
    overSlimes: document.getElementById('over-slimes'),
    play: document.getElementById('play'),
    resume: document.getElementById('resume'),
    again: document.getElementById('again'),
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
      this.master.gain.value = this.muted ? 0 : 0.4;
      this.master.connect(this.ctx.destination);
    },

    setMuted(muted) {
      this.muted = muted;
      if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.4, this.ctx.currentTime, 0.02);
    },

    blip(freq, dur, { type = 'sine', gain = 0.1, to = null, delay = 0 } = {}) {
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

    pickHit() { this.blip(rand(170, 230), 0.06, { type: 'square', gain: 0.05, to: 100 }); },
    rockBreak() { this.blip(115, 0.14, { type: 'sawtooth', gain: 0.07, to: 50 }); },
    oreBreak() {
      this.blip(520, 0.09, { type: 'triangle', gain: 0.07 });
      this.blip(780, 0.1, { type: 'sine', gain: 0.04, delay: 0.04 });
    },
    swing() { this.blip(320, 0.07, { type: 'triangle', gain: 0.045, to: 180 }); },
    swordHit() { this.blip(240, 0.09, { type: 'square', gain: 0.06, to: 120 }); },
    slimeDie() {
      this.blip(300, 0.16, { type: 'sine', gain: 0.07, to: 90 });
      this.blip(180, 0.2, { type: 'triangle', gain: 0.05, to: 70, delay: 0.03 });
    },
    hurt() {
      this.blip(200, 0.22, { type: 'sawtooth', gain: 0.1, to: 70 });
      this.blip(95, 0.18, { type: 'square', gain: 0.05, to: 50 });
    },
    stairs() { this.blip(400, 0.12, { type: 'triangle', gain: 0.06, to: 600 }); },
  };

  /* ---------------------------------------------------------------- state */

  const state = {
    mode: 'menu', // menu | playing | paused | dead
    time: 0,
    tool: 'pickaxe', // pickaxe | sword
    hp: BALANCE.playerMaxHp,
    invuln: 0,
    cooldown: 0,
    shack: 0,
    oreHauled: 0,
    slimesSlain: 0,
    transitionLock: 0,
    swingDir: 0,
  };

  const player = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    faceX: 0,
    faceY: 1,
    aim: Math.PI / 2,
    walk: 0,
    hurtFlash: 0,
  };

  const camera = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0, down: false, inside: false };
  const keys = new Set();

  const inventory = new Array(10).fill(null); // { item, count }
  const slimes = [];
  const particles = [];
  const floaters = [];

  const levels = {};
  let level = null;

  let W = 0;
  let H = 0;

  /* ---------------------------------------------------------------- levels */

  function makeLevel(id, name, w, h, isBase) {
    return {
      id,
      name,
      w,
      h,
      isBase,
      tiles: new Uint8Array(w * h).fill(WALL),
      damage: new Map(), // "x,y" -> hits already taken
      decor: [],
      spawn: { x: 0, y: 0 },
      stairsDown: null,
      stairsUp: null,
      slimeTimer: 0,
    };
  }

  const idx = (lv, tx, ty) => ty * lv.w + tx;
  const inBounds = (lv, tx, ty) => tx >= 0 && ty >= 0 && tx < lv.w && ty < lv.h;

  function getTile(tx, ty) {
    if (!inBounds(level, tx, ty)) return WALL;
    return level.tiles[idx(level, tx, ty)];
  }

  function setTile(tx, ty, id) {
    if (!inBounds(level, tx, ty)) return;
    level.tiles[idx(level, tx, ty)] = id;
  }

  function isSolid(tx, ty) {
    const t = getTile(tx, ty);
    return !!TILES[t].solid;
  }

  function carveRect(lv, x, y, w, h, id = FLOOR) {
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        if (tx > 0 && ty > 0 && tx < lv.w - 1 && ty < lv.h - 1) {
          lv.tiles[idx(lv, tx, ty)] = id;
        }
      }
    }
  }

  function carveCorridor(lv, x1, y1, x2, y2) {
    const loX = Math.min(x1, x2);
    const hiX = Math.max(x1, x2);
    const loY = Math.min(y1, y2);
    const hiY = Math.max(y1, y2);
    carveRect(lv, loX, loY, hiX - loX + 1, 2, FLOOR);
    carveRect(lv, loX, loY, 2, hiY - loY + 2, FLOOR);
  }

  // ---- Home Base -----------------------------------------------------------

  function buildHome() {
    const lv = makeLevel('home', 'Home Base', 19, 13, true);
    carveRect(lv, 2, 2, 15, 9, FLOOR);

    lv.stairsDown = { tx: 9, ty: 9 };
    lv.tiles[idx(lv, 9, 9)] = STAIRS_DOWN;
    lv.spawn = { x: 9.5 * TS, y: 6.5 * TS };

    lv.decor.push({ kind: 'lantern', x: 3.2 * TS, y: 3.1 * TS, phase: 0 });
    lv.decor.push({ kind: 'lantern', x: 15.8 * TS, y: 3.1 * TS, phase: 1.6 });
    lv.decor.push({ kind: 'crate', x: 4.3 * TS, y: 8.6 * TS });
    lv.decor.push({ kind: 'crate', x: 5.4 * TS, y: 9.1 * TS });
    lv.decor.push({ kind: 'bedroll', x: 13.6 * TS, y: 8.6 * TS });
    lv.decor.push({ kind: 'lantern', x: 16 * TS, y: 8 * TS, phase: 3.1 });
    return lv;
  }

  // ---- Stage 1 -------------------------------------------------------------

  // The cave shape is fixed; only the rock seeded into its walls changes.
  const STAGE1_ROOMS = [
    { name: 'entry', x: 3, y: 4, w: 10, h: 7 },
    { name: 'b', x: 18, y: 2, w: 11, h: 8 },
    { name: 'c', x: 35, y: 5, w: 8, h: 8 },
    { name: 'd', x: 4, y: 16, w: 12, h: 8 },
    { name: 'e', x: 21, y: 14, w: 12, h: 10 },
    { name: 'f', x: 36, y: 23, w: 9, h: 8 },
    { name: 'g', x: 7, y: 27, w: 11, h: 6 },
  ];

  function buildStage1() {
    const lv = makeLevel('stage1', 'Stage 1 · Weeping Hollow', 48, 36, false);

    for (const r of STAGE1_ROOMS) carveRect(lv, r.x, r.y, r.w, r.h, FLOOR);

    // connect each room to the next, so the cave is always one connected space
    for (let i = 1; i < STAGE1_ROOMS.length; i++) {
      const a = STAGE1_ROOMS[i - 1];
      const b = STAGE1_ROOMS[i];
      const ax = Math.floor(a.x + a.w / 2);
      const ay = Math.floor(a.y + a.h / 2);
      const bx = Math.floor(b.x + b.w / 2);
      const by = Math.floor(b.y + b.h / 2);
      carveCorridor(lv, ax, ay, bx, by);
    }

    const entry = STAGE1_ROOMS[0];
    const sax = Math.floor(entry.x + entry.w / 2);
    const say = Math.floor(entry.y + entry.h / 2);
    lv.stairsUp = { tx: sax, ty: say };
    lv.tiles[idx(lv, sax, say)] = STAIRS_UP;
    lv.spawn = { x: (sax + 0.5) * TS, y: (say + 1.6) * TS };

    seedOre(lv, sax, say);

    lv.decor.push({ kind: 'lantern', x: (sax - 3) * TS, y: (say - 2) * TS, phase: 0.4 });
    lv.decor.push({ kind: 'lantern', x: (sax + 3) * TS, y: (say - 2) * TS, phase: 2.2 });
    lv.decor.push({ kind: 'bones', x: (sax + 5) * TS, y: (say + 1) * TS, phase: 1.1 });

    return lv;
  }

  // Fill the cave walls with rock: everything within two tiles of open floor
  // becomes Stone, Coal or Copper, weighted so the better ore sits further in.
  function seedOre(lv, spawnTx, spawnTy) {
    const dist = new Int16Array(lv.w * lv.h).fill(-1);
    const queue = [];

    for (let ty = 0; ty < lv.h; ty++) {
      for (let tx = 0; tx < lv.w; tx++) {
        if (!TILES[lv.tiles[idx(lv, tx, ty)]].solid) {
          dist[idx(lv, tx, ty)] = 0;
          queue.push([tx, ty]);
        }
      }
    }

    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let qi = 0; qi < queue.length; qi++) {
      const [tx, ty] = queue[qi];
      const d = dist[idx(lv, tx, ty)];
      if (d >= 2) continue;
      for (const [dx, dy] of dirs) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (!inBounds(lv, nx, ny)) continue;
        const ni = idx(lv, nx, ny);
        if (dist[ni] !== -1) continue;
        dist[ni] = d + 1;
        queue.push([nx, ny]);
      }
    }

    for (let ty = 1; ty < lv.h - 1; ty++) {
      for (let tx = 1; tx < lv.w - 1; tx++) {
        const i = idx(lv, tx, ty);
        if (lv.tiles[i] !== WALL) continue;
        if (dist[i] < 1 || dist[i] > 2) continue;

        const away = Math.hypot(tx - spawnTx, ty - spawnTy);
        const copperChance = clamp(0.08 + away / 220, 0.08, 0.26);
        const r = Math.random();

        if (r < copperChance) lv.tiles[i] = COPPER;
        else if (r < copperChance + 0.3) lv.tiles[i] = COAL;
        else lv.tiles[i] = STONE;
      }
    }
  }

  /* ------------------------------------------------------------- inventory */

  const STACK_MAX = 99;

  function addItem(itemKey, count) {
    let left = count;
    for (let i = 0; i < inventory.length && left > 0; i++) {
      const cell = inventory[i];
      if (cell && cell.item === itemKey && cell.count < STACK_MAX) {
        const move = Math.min(STACK_MAX - cell.count, left);
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
    if (left !== count) syncBag();
    return left;
  }

  const bagSlots = [];

  function buildBag() {
    el.bag.innerHTML = '';
    bagSlots.length = 0;
    for (let i = 0; i < 10; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const gem = document.createElement('span');
      gem.className = 'gem';
      const count = document.createElement('span');
      count.className = 'slot-count';
      slot.appendChild(gem);
      slot.appendChild(count);
      el.bag.appendChild(slot);
      bagSlots.push({ slot, gem, count });
    }
    syncBag();
  }

  function syncBag() {
    for (let i = 0; i < bagSlots.length; i++) {
      const cell = bagSlots[i];
      const item = inventory[i];
      if (item && ITEMS[item.item]) {
        cell.slot.classList.add('has-item');
        cell.gem.style.setProperty('--gem', ITEMS[item.item].color);
        cell.count.textContent = item.count > 1 ? String(item.count) : '';
        cell.slot.title = ITEMS[item.item].name;
      } else {
        cell.slot.classList.remove('has-item');
        cell.count.textContent = '';
        cell.slot.removeAttribute('title');
      }
    }
  }

  /* ------------------------------------------------------------- tool belt */

  const toolButtons = {};

  function buildToolbelt() {
    for (const btn of el.toolbelt.querySelectorAll('.tool')) {
      const tool = btn.dataset.tool;
      toolButtons[tool] = btn;
      btn.addEventListener('click', () => selectTool(tool));
    }
    selectTool('pickaxe');
  }

  function selectTool(tool) {
    if (tool !== 'pickaxe' && tool !== 'sword') return;
    state.tool = tool;
    for (const [name, btn] of Object.entries(toolButtons)) {
      btn.classList.toggle('is-active', name === tool);
      btn.setAttribute('aria-pressed', name === tool ? 'true' : 'false');
    }
  }

  /* ---------------------------------------------------------------- input */

  const MOVE_KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
  };

  window.addEventListener('keydown', (e) => {
    if (MOVE_KEYS[e.code] || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);

    switch (e.code) {
      case 'KeyQ': selectTool('pickaxe'); break;
      case 'KeyE': selectTool('sword'); break;
      case 'Space':
        if (state.mode === 'playing') swing();
        else if (state.mode === 'menu') startGame();
        else if (state.mode === 'paused') resumeGame();
        break;
      case 'Escape':
        if (state.mode === 'playing') pauseGame();
        else if (state.mode === 'paused') resumeGame();
        break;
      case 'KeyM':
        toggleMute();
        break;
      default:
        break;
    }
  });

  window.addEventListener('keyup', (e) => keys.delete(e.code));
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
    if (state.mode === 'playing' && e.button === 0) swing();
  });
  window.addEventListener('pointerup', () => { pointer.down = false; });
  canvas.addEventListener('pointerleave', () => { pointer.inside = false; });

  /* ------------------------------------------------------------ world <-> screen */

  const worldToScreen = (wx, wy) => ({ x: wx - camera.x + W / 2, y: wy - camera.y + H / 2 });
  const screenToWorld = (sx, sy) => ({ x: sx + camera.x - W / 2, y: sy + camera.y - H / 2 });

  function aimAngle() {
    if (pointer.inside) {
      const w = screenToWorld(pointer.x, pointer.y);
      const dx = w.x - player.x;
      const dy = w.y - player.y;
      if (Math.hypot(dx, dy) > 6) return Math.atan2(dy, dx);
    }
    return Math.atan2(player.faceY, player.faceX);
  }

  /* ---------------------------------------------------------------- mining */

  function pickaxeTarget() {
    const w = pointer.inside ? screenToWorld(pointer.x, pointer.y) : null;
    let tx;
    let ty;
    if (w) {
      tx = Math.floor(w.x / TS);
      ty = Math.floor(w.y / TS);
    } else {
      const p = playerTile();
      tx = p.tx + Math.round(player.faceX);
      ty = p.ty + Math.round(player.faceY);
    }
    if (!inBounds(level, tx, ty)) return null;
    const t = getTile(tx, ty);
    if (!TILES[t].solid || TILES[t].hits === null) return null;

    const cx = (tx + 0.5) * TS;
    const cy = (ty + 0.5) * TS;
    if (Math.hypot(cx - player.x, cy - player.y) > BALANCE.pickaxeReach) return null;
    return { tx, ty };
  }

  function swing() {
    if (state.cooldown > 0 || state.mode !== 'playing') return;
    Sound.init();

    if (state.tool === 'pickaxe') {
      state.cooldown = BALANCE.pickaxeCooldown;
      state.swingDir = aimAngle();
      hitTile();
    } else {
      state.cooldown = BALANCE.swordCooldown;
      state.swingDir = aimAngle();
      Sound.swing();
      swordSweep();
    }
  }

  function playerTile() {
    return { tx: Math.floor(player.x / TS), ty: Math.floor(player.y / TS) };
  }

  function hitTile() {
    const target = pickaxeTarget();
    if (!target) return;

    const { tx, ty } = target;
    const t = getTile(tx, ty);
    const def = TILES[t];
    const key = tx + ',' + ty;
    const taken = (level.damage.get(key) || 0) + 1;

    shake(0.45);
    hitParticles((tx + 0.5) * TS, (ty + 0.5) * TS, def.base);

    if (taken < def.hits) {
      level.damage.set(key, taken);
      Sound.pickHit();
      return;
    }

    level.damage.delete(key);
    setTile(tx, ty, FLOOR);

    if (def.drop) {
      const amount = def.drop === 'stone' ? randInt(1, 2) : 1;
      addItem(def.drop, amount);
      state.oreHauled += amount;
      Sound.oreBreak();
      floaters.push({
        x: (tx + 0.5) * TS,
        y: (ty + 0.5) * TS,
        text: '+' + amount + ' ' + ITEMS[def.drop].name,
        color: ITEMS[def.drop].color,
        life: 1,
        maxLife: 1,
        vy: -34,
      });
    } else {
      Sound.rockBreak();
    }
  }

  /* ---------------------------------------------------------------- combat */

  function swordSweep() {
    const aim = state.swingDir;
    let hitAny = false;

    // Snapshot the list: killing a slime spawns two more, and those must not be
    // hit by the very swing that created them.
    for (const s of slimes.slice()) {
      if (s.dead) continue;
      const dx = s.x - player.x;
      const dy = s.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > BALANCE.swordRange + s.r) continue;

      const ang = Math.atan2(dy, dx);
      let diff = Math.abs(ang - aim);
      if (diff > Math.PI) diff = TAU - diff;
      if (diff > BALANCE.swordArc) continue;

      hitAny = true;
      damageSlime(s, BALANCE.swordDamage, ang);
    }

    if (hitAny) Sound.swordHit();
  }

  function damageSlime(s, amount, angle) {
    s.hp -= amount;
    s.flash = 0.16;
    s.knockX += Math.cos(angle) * 150;
    s.knockY += Math.sin(angle) * 150;
    shake(0.3);

    floaters.push({
      x: s.x,
      y: s.y - s.r - 4,
      text: String(amount),
      color: '#fff0c0',
      life: 0.7,
      maxLife: 0.7,
      vy: -52,
    });

    if (s.hp <= 0) killSlime(s);
  }

  function killSlime(s) {
    s.dead = true;
    state.slimesSlain += 1;
    Sound.slimeDie();
    burst(s.x, s.y, 14, [s.color, shade(s.color, 1.25), '#ffffff'], 170, 0.55, 0.14);

    if (!s.tiny) {
      // A slain slime splits into two half-size copies of itself.
      for (let i = 0; i < 2; i++) {
        const a = rand(0, TAU);
        slimes.push(makeSlime(s.x + Math.cos(a) * 10, s.y + Math.sin(a) * 10, true));
      }
      floaters.push({
        x: s.x,
        y: s.y - 24,
        text: 'Split!',
        color: '#b8f5a0',
        life: 1,
        maxLife: 1,
        vy: -30,
      });
    }
  }

  function hurtPlayer(amount, fromAngle) {
    if (state.invuln > 0 || state.mode !== 'playing') return;
    state.hp = Math.max(0, state.hp - amount);
    state.invuln = BALANCE.invulnerableTime;
    player.hurtFlash = 0.35;
    shake(0.8);
    Sound.hurt();

    player.x += Math.cos(fromAngle) * 10;
    player.y += Math.sin(fromAngle) * 10;
    if (collides(player.x, player.y)) {
      player.x -= Math.cos(fromAngle) * 10;
      player.y -= Math.sin(fromAngle) * 10;
    }

    floaters.push({
      x: player.x,
      y: player.y - 20,
      text: '-' + amount,
      color: '#ff8b8b',
      life: 0.9,
      maxLife: 0.9,
      vy: -46,
    });

    syncVitals();
    if (state.hp <= 0) die();
  }

  /* ---------------------------------------------------------------- slimes */

  function makeSlime(x, y, tiny) {
    return {
      x,
      y,
      r: tiny ? BALANCE.tinyRadius : BALANCE.slimeRadius,
      hp: tiny ? BALANCE.tinyHp : BALANCE.slimeHp,
      maxHp: tiny ? BALANCE.tinyHp : BALANCE.slimeHp,
      dmg: tiny ? BALANCE.tinyDamage : BALANCE.slimeDamage,
      speed: tiny ? BALANCE.tinySpeed : BALANCE.slimeSpeed,
      tiny: !!tiny,
      color: tiny ? '#a8e88b' : '#5fbf6e',
      dead: false,
      flash: 0,
      attackCd: 0,
      knockX: 0,
      knockY: 0,
      hop: rand(0, TAU),
      face: 1,
    };
  }

  function spawnSlimeAwayFromPlayer() {
    const p = playerTile();
    for (let attempt = 0; attempt < 60; attempt++) {
      const tx = randInt(1, level.w - 2);
      const ty = randInt(1, level.h - 2);
      if (isSolid(tx, ty)) continue;
      if (getTile(tx, ty) === STAIRS_UP) continue;
      if (Math.hypot(tx - p.tx, ty - p.ty) < 7) continue;

      const s = makeSlime((tx + 0.5) * TS, (ty + 0.5) * TS, false);
      slimes.push(s);
      burst(s.x, s.y, 8, ['#8ce09a', '#4f9e5c'], 90, 0.45, 0.1);
      return s;
    }
    return null;
  }

  function updateSlimes(dt) {
    if (level.id !== 'stage1') return;

    const alive = slimes.filter((s) => !s.dead).length;
    if (alive < BALANCE.maxSlimes) {
      level.slimeTimer -= dt;
      if (level.slimeTimer <= 0) {
        level.slimeTimer = BALANCE.slimeSpawnEvery;
        spawnSlimeAwayFromPlayer();
      }
    }

    for (let i = slimes.length - 1; i >= 0; i--) {
      const s = slimes[i];
      if (s.dead) {
        slimes.splice(i, 1);
        continue;
      }

      if (s.flash > 0) s.flash -= dt;
      if (s.attackCd > 0) s.attackCd -= dt;
      s.hop += dt * (s.tiny ? 7 : 4.5);

      const dx = player.x - s.x;
      const dy = player.y - s.y;
      const dist = Math.hypot(dx, dy) || 1;
      s.face = dx >= 0 ? 1 : -1;

      // chase the player, with a little squishy hesitation
      let moveX = 0;
      let moveY = 0;
      if (dist > 1) {
        moveX = (dx / dist) * s.speed;
        moveY = (dy / dist) * s.speed;
      }

      const kx = s.knockX;
      const ky = s.knockY;
      s.knockX *= 1 - 8 * dt;
      s.knockY *= 1 - 8 * dt;

      const nx = s.x + (moveX + kx) * dt;
      const ny = s.y + (moveY + ky) * dt;

      if (!collidesAt(nx, s.y, s.r)) s.x = nx;
      if (!collidesAt(s.x, ny, s.r)) s.y = ny;

      // contact damage
      if (dist < s.r + BALANCE.playerRadius + 1 && s.attackCd <= 0) {
        s.attackCd = 1;
        hurtPlayer(s.dmg, Math.atan2(s.y - player.y, s.x - player.x));
      }
    }
  }

  /* --------------------------------------------------------------- physics */

  function collidesAt(x, y, r) {
    const x0 = Math.floor((x - r) / TS);
    const x1 = Math.floor((x + r - 0.001) / TS);
    const y0 = Math.floor((y - r) / TS);
    const y1 = Math.floor((y + r - 0.001) / TS);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (isSolid(tx, ty)) return true;
      }
    }
    return false;
  }

  const collides = (x, y) => collidesAt(x, y, BALANCE.playerRadius);

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
      player.walk += dt * 11;
    } else {
      player.walk = lerp(player.walk, player.walk % TAU, 1 - Math.pow(0.002, dt));
    }

    const stepX = ix * BALANCE.playerSpeed * dt;
    const stepY = iy * BALANCE.playerSpeed * dt;
    if (stepX !== 0 && !collides(player.x + stepX, player.y)) player.x += stepX;
    if (stepY !== 0 && !collides(player.x, player.y + stepY)) player.y += stepY;

    player.x = clamp(player.x, TS, (level.w - 1) * TS);
    player.y = clamp(player.y, TS, (level.h - 1) * TS);

    if (len > 0 && Math.random() < 0.16) {
      particles.push({
        x: player.x + rand(-5, 5),
        y: player.y + 9,
        vx: rand(-8, 8),
        vy: rand(-6, 3),
        life: rand(0.25, 0.5),
        maxLife: 0.5,
        size: rand(1, 2.2),
        color: 'rgba(160, 170, 185, 0.35)',
        drag: 2,
        grav: 0,
        grow: 0,
      });
    }
  }

  /* ---------------------------------------------------------- transitions */

  function stairsUnderPlayer() {
    const p = playerTile();
    const t = getTile(p.tx, p.ty);
    if (t === STAIRS_DOWN) return 'stage1';
    if (t === STAIRS_UP) return 'home';
    return null;
  }

  function updateTransition(dt) {
    if (state.transitionLock > 0) {
      state.transitionLock -= dt;
      return;
    }
    const target = stairsUnderPlayer();
    if (!target) return;

    if (target === 'stage1') {
      enterLevel('stage1', 'You descend into Stage 1…');
    } else {
      enterLevel('home', 'Back at Home Base.');
    }
  }

  function enterLevel(id, message) {
    const prev = level;
    if (id === 'stage1' && !levels.stage1) levels.stage1 = buildStage1();
    level = levels[id];

    if (id !== prev.id) {
      slimes.length = 0;
      level.slimeTimer = 2.5;
    }

    let spawnX = level.spawn.x;
    let spawnY = level.spawn.y;

    // arriving in the base: stand beside the stairs you came up from
    if (id === 'home') {
      spawnX = (level.stairsDown.tx + 0.5) * TS;
      spawnY = (level.stairsDown.ty - 0.6) * TS;
    }

    player.x = spawnX;
    player.y = spawnY;
    camera.x = player.x;
    camera.y = player.y;
    state.transitionLock = 0.6;

    el.stageName.textContent = level.name;
    showToast(message);
    Sound.stairs();
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
        drag: 3,
        grav: 0,
        grow: -0.05 * TS,
      });
    }
  }

  function hitParticles(x, y, baseColor) {
    burst(x, y, 7, [shade(baseColor, 1.4), shade(baseColor, 0.8), '#ffffff'], 130, 0.4, 0.1);
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

    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      if (f.life <= 0) {
        floaters.splice(i, 1);
        continue;
      }
      f.y += f.vy * dt;
      f.vy *= 1 - 1.5 * dt;
    }
  }

  /* --------------------------------------------------------------- update */

  function shake(amount) {
    state.shack = Math.max(state.shack, amount);
  }

  function update(dt) {
    state.time += dt;
    if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dt);
    if (state.invuln > 0) state.invuln = Math.max(0, state.invuln - dt);
    if (player.hurtFlash > 0) player.hurtFlash = Math.max(0, player.hurtFlash - dt);
    if (state.shack > 0) state.shack = Math.max(0, state.shack - dt * 3);

    updatePlayer(dt);
    updateSlimes(dt);
    updateParticles(dt);
    updateTransition(dt);
    updateToast(dt);

    if (pointer.inside) player.aim = aimAngle();
    else player.aim = Math.atan2(player.faceY, player.faceX);

    const k = 1 - Math.pow(0.0006, dt);
    camera.x = lerp(camera.x, player.x, k);
    camera.y = lerp(camera.y, player.y, k);

    // hold the camera inside the level so you never see the void
    const halfW = W / 2;
    const halfH = H / 2;
    const maxX = level.w * TS;
    const maxY = level.h * TS;
    if (maxX > W) camera.x = clamp(camera.x, halfW, maxX - halfW);
    else camera.x = maxX / 2;
    if (maxY > H) camera.y = clamp(camera.y, halfH, maxY - halfH);
    else camera.y = maxY / 2;
  }

  /* --------------------------------------------------------------- HUD */

  function syncVitals() {
    const pct = clamp(state.hp / BALANCE.playerMaxHp, 0, 1);
    el.hpFill.style.width = (pct * 100).toFixed(1) + '%';
    el.hpFill.classList.toggle('is-low', pct <= 0.3);
    el.hpText.textContent = String(Math.ceil(state.hp));
  }

  let toastTimer = 0;
  function showToast(text) {
    toastTimer = 2;
    el.toast.textContent = text;
    el.toast.classList.add('is-on');
  }
  function updateToast(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) el.toast.classList.remove('is-on');
    }
  }

  /* -------------------------------------------------------------- drawing */

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(Math.round(((n >> 16) & 255) * amt), 0, 255);
    const g = clamp(Math.round(((n >> 8) & 255) * amt), 0, 255);
    const b = clamp(Math.round((n & 255) * amt), 0, 255);
    return `rgb(${r}, ${g}, ${b})`;
  }

  let lightCanvas = null;
  let lctx = null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    lightCanvas = document.createElement('canvas');
    lightCanvas.width = Math.max(1, W);
    lightCanvas.height = Math.max(1, H);
    lctx = lightCanvas.getContext('2d');
  }

  function draw() {
    const sh = state.shack > 0 ? state.shack * 6 : 0;
    const ox = W / 2 - camera.x + (sh ? rand(-sh, sh) : 0);
    const oy = H / 2 - camera.y + (sh ? rand(-sh, sh) : 0);

    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, W, H);

    const tx0 = Math.max(0, Math.floor((camera.x - W / 2) / TS) - 1);
    const ty0 = Math.max(0, Math.floor((camera.y - H / 2) / TS) - 1);
    const tx1 = Math.min(level.w - 1, Math.ceil((camera.x + W / 2) / TS) + 1);
    const ty1 = Math.min(level.h - 1, Math.ceil((camera.y + H / 2) / TS) + 1);

    drawTiles(tx0, ty0, tx1, ty1, ox, oy);
    drawDecor(ox, oy);
    drawSlimes(ox, oy);
    drawPlayer(ox, oy);
    drawParticles(ox, oy);
    drawFloaters(ox, oy);
    drawSwing(ox, oy);
    drawDarkness(ox, oy);
    drawGlow(ox, oy);
    drawReticle();
    drawVignette();
  }

  function drawTiles(tx0, ty0, tx1, ty1, ox, oy) {
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = getTile(tx, ty);
        const x = Math.round(tx * TS + ox);
        const y = Math.round(ty * TS + oy);
        const h = hash2(tx, ty, 21);

        if (t === FLOOR) {
          drawFloor(x, y, tx, ty, h);
        } else if (t === STAIRS_DOWN || t === STAIRS_UP) {
          drawFloor(x, y, tx, ty, h);
          drawStairs(x, y, t === STAIRS_DOWN);
        } else if (t === WALL) {
          drawWall(x, y, h);
        } else {
          drawRock(x, y, tx, ty, t, h);
        }
      }
    }
  }

  function drawFloor(x, y, tx, ty, h) {
    if (level.isBase) {
      // warm wooden boards at home
      ctx.fillStyle = h > 0.5 ? '#3b2e24' : '#372a21';
      ctx.fillRect(x, y, TS + 1, TS + 1);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fillRect(x, y + TS - 2, TS + 1, 2);
      ctx.fillRect(x + ((h * 29) % TS), y, 1.5, TS);
      ctx.fillStyle = 'rgba(255, 210, 150, 0.045)';
      ctx.fillRect(x + 3, y + 4 + (h * 12) % 14, 6, 2);
    } else {
      ctx.fillStyle = h > 0.5 ? '#1b2029' : '#191d25';
      ctx.fillRect(x, y, TS + 1, TS + 1);
      // subtle flagstones
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(x, y + TS - 2, TS + 1, 2);
      ctx.fillRect(x + TS - 2, y, 2, TS + 1);
      if (h > 0.72) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
        ctx.fillRect(x + (h * 21) % (TS - 5), y + ((h * 47) % (TS - 5)), 4, 3);
      }
      if (h < 0.2) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 8);
        ctx.lineTo(x + 14, y + 15);
        ctx.lineTo(x + 11, y + 24);
        ctx.stroke();
      }
    }
  }

  function drawWall(x, y, h) {
    // indestructible cave wall: very dark with a lit upper lip
    ctx.fillStyle = h > 0.5 ? '#141821' : '#11151d';
    ctx.fillRect(x, y, TS + 1, TS + 1);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.055)';
    ctx.fillRect(x, y, TS + 1, 3);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(x, y + TS - 3, TS + 1, 3);
    if (h > 0.6) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.fillRect(x + (h * 19) % (TS - 6), y + ((h * 33) % (TS - 6)), 5, 4);
    }
  }

  function drawRock(x, y, tx, ty, t, h) {
    const def = TILES[t];
    const base = def.base;

    // body
    const v = h > 0.66 ? 1.06 : h > 0.33 ? 1 : 0.92;
    ctx.fillStyle = shade(base, v);
    ctx.fillRect(x, y, TS + 1, TS + 1);

    // bevel + seam, so the tile grid is legible
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(x, y, TS + 1, 2.5);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.fillRect(x, y + TS - 3, TS + 1, 3);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(x + TS - 1.5, y, 1.5, TS + 1);

    // grain
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(x + (h * TS) % (TS - 6), y + ((h * 53) % (TS - 6)), 5, 4);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fillRect(x + ((h * 87) % (TS - 5)), y + ((h * 17) % (TS - 5)), 4, 3);

    if (t === COAL) {
      for (let i = 0; i < 3; i++) {
        const a = hash2(tx * 3 + i, ty * 5 + i, 61);
        const b = hash2(tx * 7 + i, ty * 3 + i, 71);
        const nx = x + 6 + a * (TS - 12);
        const ny = y + 6 + b * (TS - 12);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.beginPath();
        ctx.arc(nx, ny, 3.4, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(150, 165, 185, 0.5)';
        ctx.beginPath();
        ctx.arc(nx - 1, ny - 1.2, 1.1, 0, TAU);
        ctx.fill();
      }
    } else if (t === COPPER) {
      for (let i = 0; i < 3; i++) {
        const a = hash2(tx * 5 + i, ty * 7 + i, 83);
        const b = hash2(tx * 11 + i, ty * 2 + i, 97);
        const nx = x + 6 + a * (TS - 12);
        const ny = y + 6 + b * (TS - 12);
        const r = 3.2 + a * 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.arc(nx + 0.8, ny + 1, r * 1.1, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#a9622f';
        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#e79a54';
        ctx.beginPath();
        ctx.arc(nx - r * 0.15, ny - r * 0.18, r * 0.75, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 240, 210, 0.9)';
        ctx.beginPath();
        ctx.arc(nx - r * 0.35, ny - r * 0.38, r * 0.28, 0, TAU);
        ctx.fill();
      }
    } else {
      // plain stone: a couple of pebbles
      for (let i = 0; i < 2; i++) {
        const a = hash2(tx * 2 + i, ty * 9 + i, 53);
        const b = hash2(tx * 6 + i, ty * 4 + i, 59);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
        ctx.beginPath();
        ctx.arc(x + 7 + a * (TS - 14), y + 7 + b * (TS - 14), 2.6, 0, TAU);
        ctx.fill();
      }
    }

    // cracks from a pickaxe hit that did not finish the job
    const taken = level.damage.get(tx + ',' + ty) || 0;
    if (taken > 0 && def.hits > 1) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 6);
      ctx.lineTo(x + 15, y + 15);
      ctx.lineTo(x + 12, y + 25);
      ctx.moveTo(x + 15, y + 15);
      ctx.lineTo(x + 24, y + 19);
      ctx.stroke();
    }
  }

  function drawStairs(x, y, down) {
    ctx.save();
    for (let i = 0; i < 4; i++) {
      const inset = 3 + i * 3.2;
      const shadeAmt = down ? 1 - i * 0.14 : 0.55 + i * 0.12;
      ctx.fillStyle = shade(down ? '#3a4250' : '#4b5464', shadeAmt);
      ctx.fillRect(x + inset, y + 5 + i * 5.6, TS - inset * 2, 4.6);
    }
    // chevron showing which way the stairs go
    ctx.strokeStyle = down ? 'rgba(255, 200, 97, 0.85)' : 'rgba(150, 220, 255, 0.85)';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (down) {
      ctx.moveTo(x + 10, y + 11);
      ctx.lineTo(x + 16, y + 17);
      ctx.lineTo(x + 22, y + 11);
    } else {
      ctx.moveTo(x + 10, y + 17);
      ctx.lineTo(x + 16, y + 11);
      ctx.lineTo(x + 22, y + 17);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawDecor(ox, oy) {
    for (const d of level.decor) {
      const x = d.x + ox;
      const y = d.y + oy;

      if (d.kind === 'lantern') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.ellipse(x + 3, y + 13, 9, 4, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#4a4038';
        ctx.fillRect(x - 1.5, y - 3, 3, 16);
        const flicker = 0.85 + Math.sin(state.time * 5.5 + (d.phase || 0)) * 0.15;
        ctx.fillStyle = '#2a2620';
        ctx.beginPath();
        ctx.arc(x, y - 7, 6.5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 196, 92, ${flicker})`;
        ctx.beginPath();
        ctx.arc(x, y - 7, 4.3, 0, TAU);
        ctx.fill();
      } else if (d.kind === 'crate') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.ellipse(x + 2, y + 13, 12, 5, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#5a4330';
        ctx.fillRect(x - 11, y - 8, 22, 21);
        ctx.fillStyle = '#6e5238';
        ctx.fillRect(x - 9, y - 6, 18, 17);
        ctx.strokeStyle = 'rgba(40, 28, 18, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 9, y + 1);
        ctx.lineTo(x + 9, y + 1);
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x, y + 11);
        ctx.stroke();
      } else if (d.kind === 'bedroll') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
        ctx.beginPath();
        ctx.ellipse(x, y + 8, 16, 6, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#5b6b7d';
        ctx.beginPath();
        ctx.ellipse(x, y, 14, 8, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#7d8fa3';
        ctx.beginPath();
        ctx.ellipse(x - 4, y - 2, 8, 5, 0, 0, TAU);
        ctx.fill();
      } else if (d.kind === 'bones') {
        ctx.strokeStyle = 'rgba(214, 208, 190, 0.55)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - 10, y + 4);
        ctx.lineTo(x + 2, y - 3);
        ctx.moveTo(x + 1, y + 6);
        ctx.lineTo(x + 11, y - 1);
        ctx.stroke();
        ctx.fillStyle = 'rgba(224, 218, 200, 0.6)';
        ctx.beginPath();
        ctx.arc(x - 2, y + 9, 4, 0, TAU);
        ctx.fill();
      }
    }
  }

  function drawSlimes(ox, oy) {
    // Snapshot the list: killing a slime spawns two more, and those must not be
    // hit by the very swing that created them.
    for (const s of slimes.slice()) {
      if (s.dead) continue;
      const x = s.x + ox;
      const y = s.y + oy;
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;

      const squish = Math.sin(s.hop) * 0.14;
      const rx = s.r * (1 + squish);
      const ry = s.r * (1 - squish * 0.85);

      // shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(x + 1, y + s.r * 0.75, rx * 0.85, s.r * 0.3, 0, 0, TAU);
      ctx.fill();

      // body
      const g = ctx.createRadialGradient(x - rx * 0.3, y - ry * 0.4, rx * 0.15, x, y, rx * 1.2);
      g.addColorStop(0, shade(s.color, 1.45));
      g.addColorStop(0.6, s.color);
      g.addColorStop(1, shade(s.color, 0.6));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
      ctx.fill();

      // gel highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.beginPath();
      ctx.ellipse(x - rx * 0.3, y - ry * 0.45, rx * 0.22, ry * 0.16, -0.5, 0, TAU);
      ctx.fill();

      // eyes
      const ex = rx * 0.3;
      ctx.fillStyle = '#1a2418';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(x + side * ex, y - ry * 0.12, rx * 0.12, ry * 0.17, 0, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + side * ex + rx * 0.04, y - ry * 0.2, rx * 0.045, 0, TAU);
        ctx.fill();
      }

      // hit flash
      if (s.flash > 0) {
        ctx.globalAlpha = clamp(s.flash / 0.16, 0, 1) * 0.75;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // damage taken
      if (s.hp < s.maxHp) {
        const w = s.r * 1.8;
        const pct = clamp(s.hp / s.maxHp, 0, 1);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(x - w / 2, y - s.r - 11, w, 3.4);
        ctx.fillStyle = pct > 0.5 ? '#8ce09a' : pct > 0.25 ? '#ffd166' : '#ff7a7a';
        ctx.fillRect(x - w / 2, y - s.r - 11, w * pct, 3.4);
      }
    }
  }

  function drawPlayer(ox, oy) {
    const x = player.x + ox;
    const y = player.y + oy;
    const blink = state.invuln > 0 && Math.floor(state.invuln * 16) % 2 === 0;

    ctx.save();
    if (blink) ctx.globalAlpha = 0.45;

    // shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 11, 11, 4.6, 0, 0, TAU);
    ctx.fill();

    const bob = Math.sin(player.walk) * 1.5;

    ctx.save();
    ctx.translate(x, y + bob);

    // legs
    const legSwing = Math.sin(player.walk) * 3;
    ctx.fillStyle = '#2c3a52';
    ctx.fillRect(-6.5, 4, 4.5, 8 + legSwing * 0.3);
    ctx.fillRect(2, 4, 4.5, 8 - legSwing * 0.3);

    // body
    const body = ctx.createLinearGradient(0, -6, 0, 10);
    body.addColorStop(0, '#6b95d2');
    body.addColorStop(1, '#34507c');
    ctx.fillStyle = body;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-9, -7, 18, 15, 5);
    else ctx.rect(-9, -7, 18, 15);
    ctx.fill();

    // head
    ctx.fillStyle = player.hurtFlash > 0 ? '#ffb3b3' : '#e9b58d';
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
    ctx.fillStyle = '#fff6d5';
    ctx.beginPath();
    ctx.arc(player.faceX * 5.5, -10 + player.faceY * 2, 2.6, 0, TAU);
    ctx.fill();

    // the equipped tool, held out toward the aim
    ctx.save();
    ctx.rotate(player.aim + Math.PI / 2);
    if (state.tool === 'sword') {
      ctx.strokeStyle = '#dfe7ef';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(0, -17);
      ctx.stroke();
      ctx.strokeStyle = '#a5763f';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-3.4, -4);
      ctx.lineTo(3.4, -4);
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#8a6a44';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(0, -15);
      ctx.stroke();
      ctx.strokeStyle = '#c3cdd8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-5.5, -16);
      ctx.lineTo(5.5, -16);
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
    ctx.restore();
  }

  // The swing arc, thrown out in the aim direction.
  function drawSwing(ox, oy) {
    if (state.cooldown <= 0) return;
    const total = state.tool === 'pickaxe' ? BALANCE.pickaxeCooldown : BALANCE.swordCooldown;
    const t = 1 - state.cooldown / total;

    const x = player.x + ox;
    const y = player.y + oy;
    const isSword = state.tool === 'sword';
    const reach = isSword ? BALANCE.swordRange : BALANCE.pickaxeReach;
    const arc = isSword ? BALANCE.swordArc : 0.7;
    const sweep = lerp(-arc, arc, Math.min(1, t * 1.6));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(state.swingDir + sweep);

    // a bright wedge that fades as the swing lands
    const fade = (1 - t) * 0.8;
    ctx.globalAlpha = fade;
    const grad = ctx.createRadialGradient(0, 0, reach * 0.25, 0, 0, reach);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(0.75, isSword ? 'rgba(214, 236, 255, 0.45)' : 'rgba(255, 205, 120, 0.45)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, reach, -arc * 0.85, arc * 0.85);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = isSword ? 'rgba(235, 246, 255, 0.95)' : 'rgba(255, 215, 140, 0.95)';
    ctx.lineWidth = isSword ? 3.6 : 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, reach * 0.86, -arc * 0.7, arc * 0.7);
    ctx.stroke();
    ctx.restore();
  }

  function drawParticles(ox, oy) {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x + ox - p.size / 2, p.y + oy - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters(ox, oy) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      const a = clamp(f.life / f.maxLife, 0, 1);
      ctx.globalAlpha = a * a;
      ctx.fillStyle = f.color;
      ctx.font = '800 13px ui-rounded, "Segoe UI Rounded", system-ui, sans-serif';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 5;
      ctx.fillText(f.text, f.x + ox, f.y + oy);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawDarkness(ox, oy) {
    if (!lctx) return;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, W, H);

    // Home Base is cosy and lit; the cave is not.
    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = level.isBase ? 'rgba(4, 7, 12, 0.5)' : 'rgba(3, 5, 10, 0.88)';
    lctx.fillRect(0, 0, W, H);

    lctx.globalCompositeOperation = 'destination-out';
    punch(player.x + ox, player.y + oy, 320, 0.95);
    for (const d of level.decor) {
      if (d.kind === 'lantern') punch(d.x + ox, d.y - 7 + oy, 165, 0.72);
    }
    if (level.stairsDown) punch((level.stairsDown.tx + 0.5) * TS + ox, (level.stairsDown.ty + 0.5) * TS + oy, 130, 0.6);

    ctx.drawImage(lightCanvas, 0, 0);
  }

  function punch(cx, cy, radius, strength) {
    const g = lctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, `rgba(0, 0, 0, ${strength})`);
    g.addColorStop(0.35, `rgba(0, 0, 0, ${strength * 0.9})`);
    g.addColorStop(0.62, `rgba(0, 0, 0, ${strength * 0.5})`);
    g.addColorStop(0.85, `rgba(0, 0, 0, ${strength * 0.15})`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    lctx.fillStyle = g;
    lctx.beginPath();
    lctx.arc(cx, cy, radius, 0, TAU);
    lctx.fill();
  }

  function drawGlow(ox, oy) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const px = player.x + ox;
    const py = player.y + oy;
    const g = ctx.createRadialGradient(px, py, 8, px, py, 250);
    g.addColorStop(0, 'rgba(255, 200, 115, 0.16)');
    g.addColorStop(0.5, 'rgba(255, 175, 85, 0.055)');
    g.addColorStop(1, 'rgba(255, 175, 85, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, 250, 0, TAU);
    ctx.fill();

    for (const d of level.decor) {
      if (d.kind !== 'lantern') continue;
      const x = d.x + ox;
      const y = d.y - 7 + oy;
      const flicker = 0.85 + Math.sin(state.time * 5.5 + (d.phase || 0)) * 0.15;
      const pg = ctx.createRadialGradient(x, y, 2, x, y, 110);
      pg.addColorStop(0, `rgba(255, 190, 100, ${0.2 * flicker})`);
      pg.addColorStop(1, 'rgba(255, 190, 100, 0)');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(x, y, 110, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawReticle() {
    if (!pointer.inside || state.mode !== 'playing') return;
    const x = pointer.x;
    const y = pointer.y;
    const ok = state.tool === 'pickaxe' ? !!pickaxeTarget() : false;
    ctx.save();
    ctx.strokeStyle = ok ? 'rgba(255, 205, 110, 0.9)' : 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 12, y); ctx.lineTo(x - 8, y);
    ctx.moveTo(x + 8, y); ctx.lineTo(x + 12, y);
    ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 8);
    ctx.moveTo(x, y + 8); ctx.lineTo(x, y + 12);
    ctx.stroke();
    ctx.restore();
  }

  function drawVignette() {
    const v = ctx.createRadialGradient(
      W / 2, H / 2, Math.min(W, H) * 0.34,
      W / 2, H / 2, Math.max(W, H) * 0.78
    );
    v.addColorStop(0, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  /* ------------------------------------------------------------ game flow */

  function startGame() {
    Sound.init();

    levels.home = buildHome();
    levels.stage1 = null; // regenerated with fresh ore on every run

    for (let i = 0; i < inventory.length; i++) inventory[i] = null;
    syncBag();

    slimes.length = 0;
    particles.length = 0;
    floaters.length = 0;

    state.hp = BALANCE.playerMaxHp;
    state.invuln = 0;
    state.cooldown = 0;
    state.shack = 0;
    state.oreHauled = 0;
    state.slimesSlain = 0;
    state.time = 0;
    state.transitionLock = 0.3;

    level = levels.home;
    player.x = level.spawn.x;
    player.y = level.spawn.y;
    camera.x = player.x;
    camera.y = player.y;
    el.stageName.textContent = level.name;
    selectTool('pickaxe');
    syncVitals();

    state.mode = 'playing';
    stage.classList.add('is-playing');
    el.menu.classList.add('is-hidden');
    el.pause.classList.add('is-hidden');
    el.over.classList.add('is-hidden');
    el.hud.classList.remove('is-hidden');
    el.dock.classList.remove('is-hidden');
    keys.clear();
  }

  function pauseGame() {
    if (state.mode !== 'playing') return;
    state.mode = 'paused';
    keys.clear();
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

  function die() {
    state.mode = 'dead';
    stage.classList.remove('is-playing');
    el.overOre.textContent = String(state.oreHauled);
    el.overSlimes.textContent = String(state.slimesSlain);
    el.overLine.textContent =
      state.slimesSlain === 0
        ? 'The slimes got you before you could fight back.'
        : `You cleared ${state.slimesSlain} slime${state.slimesSlain === 1 ? '' : 's'} before they got you.`;
    el.over.classList.remove('is-hidden');
  }

  function toggleMute() {
    Sound.init();
    Sound.setMuted(!Sound.muted);
    el.mute.classList.toggle('is-off', Sound.muted);
    el.mute.setAttribute('aria-pressed', Sound.muted ? 'true' : 'false');
  }

  el.play.addEventListener('click', startGame);
  el.again.addEventListener('click', startGame);
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
    let dt = Math.min((now - last) / 1000, 0.05);
    // Never let a bad timestamp poison the simulation.
    if (!isFinite(dt) || dt < 0) dt = 0;
    last = now;

    if (state.mode === 'playing') update(dt);
    if (level) draw();
    requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------------------- boot */

  function boot() {
    resize();
    buildBag();
    buildToolbelt();
    levels.home = buildHome();
    level = levels.home;
    player.x = level.spawn.x;
    player.y = level.spawn.y;
    camera.x = player.x;
    camera.y = player.y;
    el.stageName.textContent = level.name;
    syncVitals();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------- dev hook */

  window.MiningSim = {
    state,
    player,
    camera,
    inventory,
    slimes,
    BALANCE,
    TILES,
    ITEMS,
    FLOOR, WALL, STONE, COAL, COPPER, STAIRS_DOWN, STAIRS_UP,
    get level() { return level; },
    levels,
    getTile,
    setTile,
    swing,
    selectTool,
    addItem,
    enterLevel,
    spawnSlimeAwayFromPlayer,
    buildStage1,
    makeSlime,
    start: startGame,
  };

  boot();
})();
