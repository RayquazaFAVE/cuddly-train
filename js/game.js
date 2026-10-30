/* =============================================================================
   Mining Simulator
   A top-down dungeon mining game.

   Controls
     W A S D / arrows   move
     Q                  equip the pickaxe
     E                  equip the sword
     Left click / Space swing the equipped tool

   Begin in Home Base, then descend through the caves to Alumina Cave.
   Smelt ore, forge tools, press coins and trade with the Coin Trader;
   beware slimes, moles, spiders, Prospectors and bulky Golems.

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
  const IRON = 7;
  const GOLD = 8;
  const SILVER = 9;
  // Stalagmites are separate, mineable objects on FLOOR tiles, not wall tiles.
  const STALAGMITE = 10;
  const BAUXITE = 11;
  const WET = 12;
  const COBALT = 13;
  const QUARTZ = 14;
  const IRIDIUM = 15;
  const TITANIUM = 16;
  const MERCURY = 17;

  // hits = pickaxe hits needed with the T1 pickaxe; null means indestructible
  const TILES = {
    [FLOOR]: { solid: false },
    [WALL]: { solid: true, hits: null, base: '#171b23' },
    [STONE]: { solid: true, hits: 1, drop: 'stone', base: '#4a525e' },
    [COAL]: { solid: true, hits: 1, drop: 'coal', base: '#3c434e' },
    [COPPER]: { solid: true, hits: 2, drop: 'copper', base: '#4d4a4a' },
    [IRON]: { solid: true, hits: 5, hitsByTier: [5, 3, 2], drop: 'iron', base: '#4a5660' },
    [GOLD]: { solid: true, hits: 5, hitsByTier: [5, 3, 2], drop: 'gold', base: '#5b5344' },
    [SILVER]: { solid: true, hits: 5, hitsByTier: [5, 3, 2], drop: 'silver', base: '#4d535a' },
    [STALAGMITE]: { solid: true, hits: 2, drop: 'calcite', base: '#b5c3b7' },
    [BAUXITE]: { solid: true, hits: 5, hitsByTier: [5, 3, 2], drop: 'bauxite', base: '#69564e' },
    [WET]: { solid: false },
    [COBALT]: { solid: true, hits: 7, hitsByTier: [7, 5, 4], drop: 'cobalt', base: '#38485f' },
    [QUARTZ]: { solid: true, hits: 5, hitsByTier: [5, 4, 3], drop: 'quartz', base: '#56505e' },
    [IRIDIUM]: { solid: true, hits: 8, hitsByTier: [8, 6, 4], drop: 'iridium', base: '#504563' },
    [TITANIUM]: { solid: true, hits: 9, hitsByTier: [9, 7, 5], drop: 'titanium', base: '#485a60' },
    [MERCURY]: { solid: true, hits: 8, hitsByTier: [8, 6, 4], drop: 'mercury', base: '#46585b' },
    [STAIRS_DOWN]: { solid: false },
    [STAIRS_UP]: { solid: false },
  };

  const ITEMS = {
    stone: { name: 'Stone', color: '#98a4b2' },
    coal: { name: 'Coal', color: '#5d6675' },
    copper: { name: 'Copper', color: '#d58a4d' },
    iron: { name: 'Iron', color: '#a9c4d1' },
    gold: { name: 'Gold', color: '#f5c650' },
    silver: { name: 'Silver', color: '#e1e8ee' },
    ingot: { name: 'Copper Ingot', color: '#e8a86a', isIngot: true },
    ironIngot: { name: 'Iron Ingot', color: '#d4e7ef', isIngot: true },
    calcite: { name: 'Calcite', color: '#d9e4c9' },
    bauxite: { name: 'Bauxite', color: '#d78f75' },
    aluminum: { name: 'Aluminum', color: '#e0e6ea', isIngot: true },
    cobalt: { name: 'Cobalt', color: '#5f92f2' },
    quartz: { name: 'Quartz', color: '#edddf3' },
    iridium: { name: 'Iridium', color: '#b798ef' },
    titanium: { name: 'Titanium', color: '#b8dde2' },
    mercury: { name: 'Mercury', color: '#c6eceb' },
    axolotl: { name: 'Axolotl', color: '#f4a8bd', isCreature: true },
    copperCoin: { name: 'Copper Coin', color: '#d99558', isCoin: true },
    silverCoin: { name: 'Silver Coin', color: '#d8e2eb', isCoin: true },
    goldCoin: { name: 'Gold Coin', color: '#f5c650', isCoin: true },
    aluminumCoin: { name: 'Aluminum Coin', color: '#edf4f6', isCoin: true },
  };

  const MELT_COAL = 1; // coal burned per melt
  const MELT_ORE = 1;
  const INGOT_FOR_ORE = { copper: 'ingot', iron: 'ironIngot', bauxite: 'aluminum' };
  const COINS = {
    copper: { input: 'copper', coin: 'copperCoin', cost: 2, coal: 1 },
    silver: { input: 'silver', coin: 'silverCoin', cost: 1, coal: 1 },
    gold: { input: 'gold', coin: 'goldCoin', cost: 1, coal: 2 },
    aluminum: { input: 'aluminum', coin: 'aluminumCoin', cost: 1, coal: 4 },
  };
  const UPGRADE_COST = 3; // ingots for T2/T3, raw Titanium for T4
  const MAX_TIER = 4;
  // The hidden cave deliberately has no lift or destination button.
  const ELEVATOR_FLOORS = [
    { id: 'home', number: '00', name: 'Home Base' },
    { id: 'stage1', number: '01', name: 'Cave Entrance' },
    { id: 'stage2', number: '02', name: 'Dreadful Tunnels' },
    { id: 'stage3', number: '03', name: 'Auag Cavern' },
    { id: 'stage4', number: '04', name: 'Stalag Cavern' },
    { id: 'stage5', number: '05', name: 'Alumina Cave' },
    { id: 'stage6', number: '06', name: 'Luscious Cave' },
    { id: 'stage7', number: '07', name: 'Spiral Cavern' },
  ];

  /* -------------------------------------------------------------- balance */

  const BALANCE = {
    playerMaxHp: 100,
    // A normal slime hits for 20, so five of them finish the player off.
    swordDamage: 10, // T1: 10 damage, so 3 hits to kill a 30 HP slime
    swordDamageT2: 15, // T2: 2 hits
    swordDamageT3: 30, // T3: 1 hit against a normal slime or mole
    swordDamageT4: 35, // Golems now carry one extra hit's worth of armour
    mercurySwordMultiplier: 1.15,
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
    slimeDetect: 4 * TS, // slimes notice you from 4 tiles away
    tinyDetect: 2 * TS, // tiny slimes are much shorter sighted
    slimeRadius: 14,
    tinyHp: 15,
    tinyDamage: 10,
    tinySpeed: 82,
    tinyRadius: 9,
    largeSlimeHp: 60,
    largeSlimeDamage: 40,
    largeSlimeSpeed: 27,
    largeSlimeDetect: 6 * TS,
    largeSlimeRadius: 20,
    maxSlimes: 7,
    slimeSpawnEvery: 3.4,
    maxLargeSlimes: 3,
    largeSlimeSpawnEvery: 6,
    spiderHp: 15,
    spiderDamage: 5,
    spiderSpeed: 120,
    spiderDetect: 5 * TS,
    spiderRadius: 10,
    spiderAttackEvery: 0.4,
    spiderHitInvulnerability: 0.3,
    maxSpiders: 5,
    spiderSpawnEvery: 4,
    golemHp: 100, // base HP; each Golem also gets one sword hit of armour
    golemDamage: 45,
    golemSpeed: 42,
    mercuryGolemHp: 80,
    mercuryGolemDamage: 55,
    mercuryGolemSpeed: 60,
    golemDetect: 6 * TS,
    golemRadius: 21,
    golemMoveLimit: 10 * TS,
    golemDisabledTime: 3,
    maxGolems: 3,
    golemSpawnEvery: 7,
    moleHp: 30,
    moleDamage: 20,
    moleSpeed: 63,
    moleDetect: 5 * TS,
    moleRadius: 13,
    maxMoles: 3,
    moleSpawnEvery: 6,
    moleBreakChance: 0.1,
    prospectorHp: 45,
    prospectorRadius: 11,
    prospectorDetect: 4 * TS,
    prospectorMineTime: 1.1,
    prospectorMeleeRange: 32,
    maxProspectors: 4,
    prospectorSpawnEvery: 6,
    dynamiteFuse: 2, // seconds on the ground before detonation
    dynamiteFlight: 0.38,
    dynamiteThrowCooldown: 8,
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
    areaBanner: document.getElementById('area-banner'),
    areaKicker: document.getElementById('area-kicker'),
    areaSubtitle: document.getElementById('area-subtitle'),
    dock: document.getElementById('dock'),
    toolbelt: document.getElementById('toolbelt'),
    bag: document.getElementById('bag'),
    toast: document.getElementById('toast'),
    pauseBtn: document.getElementById('pause-btn'),
    mute: document.getElementById('mute'),
    menu: document.getElementById('menu'),
    pause: document.getElementById('pause'),
    station: document.getElementById('station'),
    stationPanel: document.getElementById('station-panel'),
    viewMelter: document.getElementById('view-melter'),
    viewForge: document.getElementById('view-forge'),
    viewStorage: document.getElementById('view-storage'),
    viewPress: document.getElementById('view-press'),
    viewTrader: document.getElementById('view-trader'),
    viewElevator: document.getElementById('view-elevator'),
    elevatorStatus: document.getElementById('elevator-status'),
    elevatorActivate: document.getElementById('elevator-activate'),
    elevatorFloors: document.getElementById('elevator-floors'),
    pressHint: document.getElementById('press-hint'),
    traderHint: document.getElementById('trader-hint'),
    tradeAxolotl: document.getElementById('trade-axolotl'),
    tradeAxolotlStatus: document.getElementById('trade-axolotl-status'),
    storageRows: document.getElementById('storage-rows'),
    storageHint: document.getElementById('storage-hint'),
    depositAll: document.getElementById('deposit-all'),
    withdrawAll: document.getElementById('withdraw-all'),
    slotFuel: document.getElementById('slot-fuel'),
    slotInput: document.getElementById('slot-input'),
    inputLabel: document.getElementById('input-label'),
    oreCopper: document.getElementById('ore-copper'),
    oreIron: document.getElementById('ore-iron'),
    oreBauxite: document.getElementById('ore-bauxite'),
    fuelGem: document.getElementById('fuel-gem'),
    fuelCount: document.getElementById('fuel-count'),
    inputGem: document.getElementById('input-gem'),
    inputCount: document.getElementById('input-count'),
    meltBtn: document.getElementById('melt-btn'),
    melterHint: document.getElementById('melter-hint'),
    forgeIngots: document.getElementById('forge-ingots'),
    forgeIronIngots: document.getElementById('forge-iron-ingots'),
    forgeTitanium: document.getElementById('forge-titanium'),
    forgeMercuryCount: document.getElementById('forge-mercury-count'),
    upgradeMercury: document.getElementById('upgrade-mercury'),
    forgePickTier: document.getElementById('forge-pick-tier'),
    forgeSwordTier: document.getElementById('forge-sword-tier'),
    forgeHint: document.getElementById('forge-hint'),
    upgradePickaxe: document.getElementById('upgrade-pickaxe'),
    upgradeSword: document.getElementById('upgrade-sword'),
    pickTier: document.getElementById('pickaxe-tier'),
    swordTier: document.getElementById('sword-tier'),
    over: document.getElementById('over'),
    overLine: document.getElementById('over-line'),
    overOre: document.getElementById('over-ore'),
    overSlimes: document.getElementById('over-slimes'),
    overMoles: document.getElementById('over-moles'),
    overProspectors: document.getElementById('over-prospectors'),
    overSpiders: document.getElementById('over-spiders'),
    overGolems: document.getElementById('over-golems'),
    play: document.getElementById('play'),
    continueSave: document.getElementById('continue-save'),
    importSaveMenu: document.getElementById('import-save-menu'),
    importSavePause: document.getElementById('import-save-pause'),
    saveBrowser: document.getElementById('save-browser'),
    exportSave: document.getElementById('export-save'),
    saveFile: document.getElementById('save-file'),
    menuSaveStatus: document.getElementById('menu-save-status'),
    pauseSaveStatus: document.getElementById('pause-save-status'),
    saveConfirm: document.getElementById('save-confirm'),
    saveConfirmTitle: document.getElementById('save-confirm-title'),
    saveConfirmMessage: document.getElementById('save-confirm-message'),
    saveConfirmCancel: document.getElementById('save-confirm-cancel'),
    saveConfirmAccept: document.getElementById('save-confirm-accept'),
    resume: document.getElementById('resume'),
    again: document.getElementById('again'),
  };

  const coinUi = Object.fromEntries(Object.keys(COINS).map((kind) => [kind, {
    press: document.getElementById(`press-${kind}`),
    count: document.getElementById(`press-${kind}-count`),
    trade: document.getElementById(`trade-${kind}`),
    status: document.getElementById(`trade-${kind}-status`),
  }]));

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
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.4;
        this.master.connect(this.ctx.destination);
      } catch (err) {
        // No audio available (blocked, sandboxed, or out of contexts). The game
        // carries on silently rather than refusing to start.
        this.ctx = null;
        this.master = null;
      }
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
    moleDie() { this.blip(180, 0.18, { type: 'triangle', gain: 0.07, to: 65 }); },
    throwDynamite() { this.blip(430, 0.12, { type: 'triangle', gain: 0.045, to: 230 }); },
    explosion() {
      this.blip(110, 0.35, { type: 'sawtooth', gain: 0.13, to: 40 });
      this.blip(70, 0.3, { type: 'square', gain: 0.07, to: 35 });
    },
    hurt() {
      this.blip(200, 0.22, { type: 'sawtooth', gain: 0.1, to: 70 });
      this.blip(95, 0.18, { type: 'square', gain: 0.05, to: 50 });
    },
    stairs() { this.blip(400, 0.12, { type: 'triangle', gain: 0.06, to: 600 }); },
    pickup() { this.blip(680, 0.1, { type: 'sine', gain: 0.035, to: 920 }); },
    melt() {
      this.blip(220, 0.3, { type: 'sawtooth', gain: 0.06, to: 120 });
      this.blip(620, 0.18, { type: 'triangle', gain: 0.07, delay: 0.16, to: 880 });
    },
    forge() {
      [392, 523.25, 659.25, 880].forEach((f, i) =>
        this.blip(f, 0.2, { type: 'triangle', gain: 0.085, delay: i * 0.07 })
      );
      this.blip(140, 0.24, { type: 'square', gain: 0.05, to: 90 });
    },
  };

  /* ---------------------------------------------------------------- state */

  const state = {
    mode: 'menu', // menu | playing | paused | station | dead
    time: 0,
    areaIntro: 0,
    tool: 'pickaxe', // pickaxe | sword
    tools: { pickaxe: 1, sword: 1 }, // tool tiers
    mercurySword: false, // one permanent +15% sword upgrade for this run
    elevatorUnlocked: false, // reactivated at the Stage 7 entrance
    hp: BALANCE.playerMaxHp,
    invuln: 0,
    cooldown: 0,
    shack: 0,
    oreHauled: 0,
    slimesSlain: 0,
    molesSlain: 0,
    prospectorsSlain: 0,
    spidersSlain: 0,
    golemsSlain: 0,
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
  // The chest belongs to Home Base, not the bag, so death never halves it.
  const storage = Object.fromEntries(Object.keys(ITEMS).map((item) => [item, 0]));
  const slimes = [];
  const moles = [];
  const spiders = [];
  const golems = [];
  const particles = [];
  const floaters = [];
  const melterBursts = [];

  const levels = {};
  let level = null;

  // The top slot holds one ore type at a time; the bottom slot holds coal.
  const melter = { coal: 0, copper: 0, iron: 0, bauxite: 0, selectedOre: 'copper' };
  // Copper is always accepted; other denominations unlock only when pressed.
  const traderUnlocked = { copper: true, silver: false, gold: false, aluminum: false };

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
      stalagmites: new Set(), // "x,y" -> a mineable formation on a FLOOR tile
      damage: new Map(), // "x,y" -> hits already taken
      decor: [],
      elevators: [], // floor-level lift entrances beside the stairs
      pickups: [], // uncollected drops stay in their own level
      prospectors: [], // their collected ore remains with them between visits
      dynamites: [],
      explosions: [],
      spawn: { x: 0, y: 0 },
      stairsDown: null,
      stairsUp: null,
      downTarget: null,
      upTarget: null,
      slimeTimer: 0,
      moleTimer: 0,
      spiderTimer: 0,
      golemTimer: 0,
      prospectorTimer: 0,
    };
  }

  // Install lift entrances alongside both ordinary staircases where present.
  // This remains decorative walkable floor, so neither saves nor terrain
  // resets need a new tile type. The secret cave is intentionally excluded.
  function placeElevators(lv) {
    lv.elevators = [];
    if (lv.id === 'special') return;
    for (const stairs of [lv.stairsUp, lv.stairsDown]) {
      if (!stairs) continue;
      const sides = [[1, 0], [-1, 0], [0, -1], [0, 1]];
      const spot = sides.map(([dx, dy]) => ({ tx: stairs.tx + dx, ty: stairs.ty + dy }))
        .find(({ tx, ty }) => inBounds(lv, tx, ty) && !isSolidInLevel(lv, tx, ty) &&
          ![STAIRS_UP, STAIRS_DOWN].includes(lv.tiles[idx(lv, tx, ty)]) &&
          (!lv.originalTiles || (!TILES[lv.originalTiles[idx(lv, tx, ty)]].solid &&
            !(lv.originalStalagmites && lv.originalStalagmites.has(tileKey(tx, ty))))) &&
          !lv.elevators.some((lift) => lift.tx === tx && lift.ty === ty));
      if (spot) lv.elevators.push({ ...spot, x: (spot.tx + 0.5) * TS, y: (spot.ty + 0.5) * TS });
    }
  }

  // Keep the layout and this run's random ore distribution as the area's
  // baseline. Re-entry restores these tiles without resetting inventory or loot.
  function captureOriginalTiles(lv) {
    placeElevators(lv);
    lv.originalTiles = lv.tiles.slice();
    lv.originalStalagmites = new Set(lv.stalagmites);
    return lv;
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

  const tileKey = (tx, ty) => `${tx},${ty}`;

  function isSolidInLevel(lv, tx, ty) {
    if (!inBounds(lv, tx, ty)) return true;
    return !!TILES[lv.tiles[idx(lv, tx, ty)]].solid || lv.stalagmites.has(tileKey(tx, ty));
  }

  function isSolid(tx, ty) {
    return isSolidInLevel(level, tx, ty);
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
    lv.downTarget = 'stage1';
    lv.tiles[idx(lv, 9, 9)] = STAIRS_DOWN;
    lv.spawn = { x: 9.5 * TS, y: 6.5 * TS };

    lv.stations = [
      { kind: 'melter', x: 4.2 * TS, y: 4.4 * TS },
      { kind: 'storage', x: 9.5 * TS, y: 4.4 * TS },
      { kind: 'forge', x: 14.8 * TS, y: 4.4 * TS },
      { kind: 'press', x: 4.8 * TS, y: 7 * TS },
      { kind: 'trader', x: 14.2 * TS, y: 7 * TS },
    ];

    lv.decor.push({ kind: 'lantern', x: 3.2 * TS, y: 3.1 * TS, phase: 0 });
    lv.decor.push({ kind: 'lantern', x: 15.8 * TS, y: 3.1 * TS, phase: 1.6 });
    lv.decor.push({ kind: 'crate', x: 4.3 * TS, y: 8.6 * TS });
    lv.decor.push({ kind: 'crate', x: 5.4 * TS, y: 9.1 * TS });
    lv.decor.push({ kind: 'bedroll', x: 13.6 * TS, y: 8.6 * TS });
    lv.decor.push({ kind: 'lantern', x: 16 * TS, y: 8 * TS, phase: 3.1 });
    return captureOriginalTiles(lv);
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
    const lv = makeLevel('stage1', 'Cave Entrance', 48, 36, false);

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
    lv.upTarget = 'home';
    lv.tiles[idx(lv, sax, say)] = STAIRS_UP;
    lv.spawn = { x: (sax + 0.5) * TS, y: (say + 1.6) * TS };

    // The far chamber contains the way down to the next stage.
    const exit = STAGE1_ROOMS[STAGE1_ROOMS.length - 1];
    const exitX = Math.floor(exit.x + exit.w / 2);
    const exitY = Math.floor(exit.y + exit.h / 2);
    lv.stairsDown = { tx: exitX, ty: exitY };
    lv.downTarget = 'stage2';
    lv.tiles[idx(lv, exitX, exitY)] = STAIRS_DOWN;

    seedOre(lv, sax, say);

    lv.decor.push({ kind: 'lantern', x: (sax - 3) * TS, y: (say - 2) * TS, phase: 0.4 });
    lv.decor.push({ kind: 'lantern', x: (sax + 3) * TS, y: (say - 2) * TS, phase: 2.2 });
    lv.decor.push({ kind: 'bones', x: (sax + 5) * TS, y: (say + 1) * TS, phase: 1.1 });

    return captureOriginalTiles(lv);
  }

  // ---- Stage 2 -------------------------------------------------------------

  // Long, straight galleries intersect at a few wider chambers. The outline is
  // fixed, while the ore around it is freshly seeded for each run.
  const STAGE2_HALLS = [
    { x: 4, y: 6, w: 48, h: 3 },
    { x: 12, y: 6, w: 3, h: 28 },
    { x: 28, y: 6, w: 3, h: 33 },
    { x: 47, y: 6, w: 3, h: 28 },
    { x: 10, y: 19, w: 40, h: 3 },
    { x: 5, y: 31, w: 47, h: 3 },
    { x: 28, y: 36, w: 13, h: 3 },
  ];
  const STAGE2_OPENINGS = [
    { x: 3, y: 3, w: 8, h: 9 },
    { x: 24, y: 16, w: 9, h: 9 },
    { x: 43, y: 27, w: 10, h: 9 },
    { x: 7, y: 28, w: 8, h: 9 },
  ];

  function buildStage2() {
    const lv = makeLevel('stage2', 'Dreadful Tunnels', 58, 42, false);
    for (const area of [...STAGE2_HALLS, ...STAGE2_OPENINGS]) {
      carveRect(lv, area.x, area.y, area.w, area.h, FLOOR);
    }
    const sax = 6;
    const say = 6;
    lv.stairsUp = { tx: sax, ty: say };
    lv.upTarget = 'stage1';
    lv.tiles[idx(lv, sax, say)] = STAIRS_UP;
    lv.spawn = { x: (sax + 0.5) * TS, y: (say + 1.6) * TS };
    lv.stairsDown = { tx: 38, ty: 37 };
    lv.downTarget = 'stage3';
    lv.tiles[idx(lv, 38, 37)] = STAIRS_DOWN;
    seedOre(lv, sax, say);

    lv.decor.push({ kind: 'lantern', x: 4.3 * TS, y: 4.5 * TS, phase: 0.8 });
    lv.decor.push({ kind: 'lantern', x: 9.4 * TS, y: 5 * TS, phase: 2.3 });
    lv.decor.push({ kind: 'lantern', x: 25.5 * TS, y: 18 * TS, phase: 1.3 });
    lv.decor.push({ kind: 'lantern', x: 48 * TS, y: 30 * TS, phase: 3.2 });
    lv.decor.push({ kind: 'bones', x: 14.5 * TS, y: 31.7 * TS, phase: 0 });
    return captureOriginalTiles(lv);
  }

  // ---- Stage 3 -------------------------------------------------------------

  // Broad, rounded chambers and connecting galleries make the mineral-rich
  // cavern feel distinct from Stage 2's long, straight tunnels.
  const STAGE3_CAVERNS = [
    { x: 8, y: 8, rx: 6, ry: 5 },
    { x: 23, y: 8, rx: 7, ry: 5 },
    { x: 42, y: 9, rx: 8, ry: 6 },
    { x: 50, y: 24, rx: 6, ry: 6 },
    { x: 31, y: 23, rx: 9, ry: 7 },
    { x: 12, y: 23, rx: 7, ry: 6 },
    { x: 19, y: 36, rx: 7, ry: 5 },
    { x: 39, y: 36, rx: 8, ry: 5 },
  ];

  function buildStage3() {
    const lv = makeLevel('stage3', 'Auag Cavern', 60, 44, false);
    for (const room of STAGE3_CAVERNS) {
      for (let ty = Math.floor(room.y - room.ry); ty <= room.y + room.ry; ty++) {
        for (let tx = Math.floor(room.x - room.rx); tx <= room.x + room.rx; tx++) {
          const dx = (tx + 0.5 - room.x) / room.rx;
          const dy = (ty + 0.5 - room.y) / room.ry;
          if (dx * dx + dy * dy <= 1) carveRect(lv, tx, ty, 1, 1);
        }
      }
    }
    const links = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 3]];
    for (const [from, to] of links) {
      const a = STAGE3_CAVERNS[from];
      const b = STAGE3_CAVERNS[to];
      carveRect(lv, Math.min(a.x, b.x), a.y - 1, Math.abs(b.x - a.x) + 1, 3);
      carveRect(lv, b.x - 1, Math.min(a.y, b.y), 3, Math.abs(b.y - a.y) + 1);
    }

    const sx = 6;
    const sy = 8;
    lv.stairsUp = { tx: sx, ty: sy };
    lv.upTarget = 'stage2';
    lv.tiles[idx(lv, sx, sy)] = STAIRS_UP;
    lv.spawn = { x: (sx + 0.5) * TS, y: (sy + 1.6) * TS };
    // The far cavern leads down to Stalag Cavern.
    lv.stairsDown = { tx: 39, ty: 36 };
    lv.downTarget = 'stage4';
    lv.tiles[idx(lv, lv.stairsDown.tx, lv.stairsDown.ty)] = STAIRS_DOWN;
    seedOre(lv, sx, sy);
    lv.decor.push({ kind: 'lantern', x: 4.7 * TS, y: 6.1 * TS, phase: 0.5 });
    lv.decor.push({ kind: 'lantern', x: 11 * TS, y: 6.8 * TS, phase: 2.1 });
    lv.decor.push({ kind: 'lantern', x: 22 * TS, y: 6 * TS, phase: 1.4 });
    lv.decor.push({ kind: 'lantern', x: 42 * TS, y: 8 * TS, phase: 2.8 });
    lv.decor.push({ kind: 'lantern', x: 30 * TS, y: 20 * TS, phase: 0.8 });
    lv.decor.push({ kind: 'lantern', x: 19 * TS, y: 34 * TS, phase: 1.9 });
    lv.decor.push({ kind: 'bones', x: 45.5 * TS, y: 35.5 * TS, phase: 0 });
    return captureOriginalTiles(lv);
  }

  // ---- Stage 4 -------------------------------------------------------------

  const STAGE4_CHAMBERS = [
    { x: 8, y: 8, rx: 6, ry: 5 },
    { x: 24, y: 8, rx: 7, ry: 6 },
    { x: 44, y: 10, rx: 8, ry: 6 },
    { x: 51, y: 23, rx: 7, ry: 7 },
    { x: 32, y: 22, rx: 9, ry: 7 },
    { x: 13, y: 23, rx: 8, ry: 7 },
    { x: 18, y: 37, rx: 8, ry: 6 },
    { x: 40, y: 36, rx: 9, ry: 6 },
  ];

  function buildStage4() {
    const lv = makeLevel('stage4', 'Stalag Cavern', 64, 46, false);
    for (const room of STAGE4_CHAMBERS) {
      for (let ty = Math.floor(room.y - room.ry); ty <= room.y + room.ry; ty++) {
        for (let tx = Math.floor(room.x - room.rx); tx <= room.x + room.rx; tx++) {
          const dx = (tx + 0.5 - room.x) / room.rx;
          const dy = (ty + 0.5 - room.y) / room.ry;
          if (dx * dx + dy * dy <= 1) carveRect(lv, tx, ty, 1, 1);
        }
      }
    }
    // Broad galleries leave room to dodge even the larger slimes.
    const links = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 3], [1, 4]];
    for (const [from, to] of links) {
      const a = STAGE4_CHAMBERS[from];
      const b = STAGE4_CHAMBERS[to];
      carveRect(lv, Math.min(a.x, b.x) - 1, a.y - 2, Math.abs(b.x - a.x) + 3, 5);
      carveRect(lv, b.x - 2, Math.min(a.y, b.y) - 1, 5, Math.abs(b.y - a.y) + 3);
    }
    const sx = 6, sy = 8;
    lv.stairsUp = { tx: sx, ty: sy };
    lv.upTarget = 'stage3';
    lv.tiles[idx(lv, sx, sy)] = STAIRS_UP;
    lv.spawn = { x: (sx + 0.5) * TS, y: (sy + 1.6) * TS };
    lv.stairsDown = { tx: 42, ty: 36 };
    lv.downTarget = 'stage5';
    lv.tiles[idx(lv, 42, 36)] = STAIRS_DOWN;
    seedOre(lv, sx, sy);
    lv.decor.push({ kind: 'lantern', x: 4.8 * TS, y: 6.2 * TS, phase: 0.6 });
    lv.decor.push({ kind: 'lantern', x: 11 * TS, y: 6.6 * TS, phase: 2.1 });
    lv.decor.push({ kind: 'lantern', x: 24 * TS, y: 8 * TS, phase: 1.1 });
    lv.decor.push({ kind: 'lantern', x: 42 * TS, y: 10 * TS, phase: 2.6 });
    lv.decor.push({ kind: 'lantern', x: 31 * TS, y: 22 * TS, phase: 0.9 });
    lv.decor.push({ kind: 'lantern', x: 19 * TS, y: 37 * TS, phase: 1.8 });
    lv.decor.push({ kind: 'lantern', x: 40 * TS, y: 36 * TS, phase: 3.2 });
    lv.decor.push({ kind: 'bones', x: 48.5 * TS, y: 24.5 * TS, phase: 0 });
    placeStalagmites(lv);
    return captureOriginalTiles(lv);
  }

  // ---- Stage 5 -------------------------------------------------------------

  // Spacious caverns and wide galleries give bulky Golems room to roam.
  const STAGE5_CHAMBERS = [
    { x: 8, y: 8, rx: 6, ry: 5 },
    { x: 24, y: 9, rx: 8, ry: 6 },
    { x: 45, y: 9, rx: 8, ry: 6 },
    { x: 51, y: 23, rx: 8, ry: 7 },
    { x: 31, y: 22, rx: 9, ry: 7 },
    { x: 12, y: 23, rx: 8, ry: 7 },
    { x: 19, y: 37, rx: 8, ry: 6 },
    { x: 40, y: 36, rx: 9, ry: 6 },
  ];

  function buildStage5() {
    const lv = makeLevel('stage5', 'Alumina Cave', 64, 46, false);
    for (const room of STAGE5_CHAMBERS) {
      for (let ty = Math.floor(room.y - room.ry); ty <= room.y + room.ry; ty++) {
        for (let tx = Math.floor(room.x - room.rx); tx <= room.x + room.rx; tx++) {
          const dx = (tx + 0.5 - room.x) / room.rx;
          const dy = (ty + 0.5 - room.y) / room.ry;
          if (dx * dx + dy * dy <= 1) carveRect(lv, tx, ty, 1, 1);
        }
      }
    }
    const links = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 3], [1, 4]];
    for (const [from, to] of links) {
      const a = STAGE5_CHAMBERS[from], b = STAGE5_CHAMBERS[to];
      carveRect(lv, Math.min(a.x, b.x) - 1, a.y - 2, Math.abs(b.x - a.x) + 3, 5);
      carveRect(lv, b.x - 2, Math.min(a.y, b.y) - 1, 5, Math.abs(b.y - a.y) + 3);
    }
    const sx = 6, sy = 8;
    lv.stairsUp = { tx: sx, ty: sy };
    lv.upTarget = 'stage4';
    lv.tiles[idx(lv, sx, sy)] = STAIRS_UP;
    lv.spawn = { x: (sx + 0.5) * TS, y: (sy + 1.6) * TS };
    lv.stairsDown = { tx: 42, ty: 36 };
    lv.downTarget = 'stage6';
    lv.tiles[idx(lv, lv.stairsDown.tx, lv.stairsDown.ty)] = STAIRS_DOWN;
    seedOre(lv, sx, sy);
    for (const [x, y, phase] of [[4.8, 6.2, 0.5], [11, 6.7, 2], [24, 9, 1.2],
      [45, 9, 2.8], [31, 22, 0.9], [19, 37, 1.9], [40, 36, 3]]) {
      lv.decor.push({ kind: 'lantern', x: x * TS, y: y * TS, phase });
    }
    lv.decor.push({ kind: 'bones', x: 48.5 * TS, y: 24.5 * TS, phase: 0 });
    return captureOriginalTiles(lv);
  }

  // Stage 6 is an open oasis. The pool centers stay stable for migrated saves,
  // so old uncollected Axolotls remain in their familiar wet spots.
  const LUSCIOUS_POOLS = [
    [11, 8], [24, 10], [43, 9], [50, 23], [31, 21], [13, 24], [19, 36], [39, 35],
  ];

  function carveCaverns(lv, chambers, links) {
    for (const room of chambers) {
      for (let ty = Math.floor(room.y - room.ry); ty <= room.y + room.ry; ty++) {
        for (let tx = Math.floor(room.x - room.rx); tx <= room.x + room.rx; tx++) {
          const dx = (tx + 0.5 - room.x) / room.rx;
          const dy = (ty + 0.5 - room.y) / room.ry;
          if (dx * dx + dy * dy <= 1) carveRect(lv, tx, ty, 1, 1);
        }
      }
    }
    for (const [from, to] of links) {
      const a = chambers[from], b = chambers[to];
      carveRect(lv, Math.min(a.x, b.x) - 1, a.y - 2, Math.abs(b.x - a.x) + 3, 5);
      carveRect(lv, b.x - 2, Math.min(a.y, b.y) - 1, 5, Math.abs(b.y - a.y) + 3);
    }
  }

  function buildStage6() {
    const lv = makeLevel('stage6', 'Luscious Cave', 64, 46, false);
    // A single broad cavern, dotted with small, separate islands of mineable
    // rock instead of walls that divide the area into rooms.
    carveRect(lv, 1, 1, lv.w - 2, lv.h - 2, FLOOR);
    lv.stairsUp = { tx: 6, ty: 8 };
    lv.upTarget = 'stage5';
    lv.tiles[idx(lv, 6, 8)] = STAIRS_UP;
    lv.spawn = { x: 6.5 * TS, y: 9.6 * TS };
    lv.stairsDown = { tx: 42, ty: 36 };
    lv.downTarget = 'stage7';
    lv.tiles[idx(lv, 42, 36)] = STAIRS_DOWN;
    lv.wetSpots = LUSCIOUS_POOLS.map(([tx, ty]) => ({ tx, ty }));

    const lanterns = [[5, 6, 0.5], [12, 7, 2], [24, 8, 1], [44, 9, 2.8],
      [31, 22, 0.9], [19, 37, 1.8], [40, 36, 3], [54, 34, 1.4], [17, 16, 0.8]];
    const ferns = [[4, 9], [14, 10], [22, 12], [27, 6], [47, 12], [34, 25],
      [10, 21], [17, 35], [54, 19], [29, 39], [48, 30], [9, 39]];
    const protectedPoints = [
      ...LUSCIOUS_POOLS.map(([x, y]) => ({ x, y, radius: 3.1 })),
      { x: 6, y: 8, radius: 3 }, { x: 6, y: 10, radius: 2 },
      { x: 42, y: 36, radius: 3 },
      ...lanterns.map(([x, y]) => ({ x, y, radius: 1.5 })),
      ...ferns.map(([x, y]) => ({ x, y, radius: 1.5 })),
    ];
    const clumps = [
      [17, 5, 2.6, 1.8], [32, 5, 3.2, 1.9], [54, 5, 2.8, 2.1],
      [8, 15, 2.4, 1.8], [22, 16, 2.8, 2], [39, 15, 3, 1.8], [57, 15, 2.6, 2],
      [23, 26, 2.8, 2], [40, 26, 3.1, 2], [58, 29, 2.8, 2],
      [7, 33, 2.8, 1.8], [29, 32, 2.7, 2], [52, 37, 3, 2],
      [33, 40, 2.6, 1.7], [21, 41, 2.5, 1.6], [47, 31, 2.8, 1.8],
    ];
    for (const [cx, cy, rx, ry] of clumps) {
      for (let ty = Math.floor(cy - ry); ty <= Math.ceil(cy + ry); ty++) {
        for (let tx = Math.floor(cx - rx); tx <= Math.ceil(cx + rx); tx++) {
          if (!inBounds(lv, tx, ty) || lv.tiles[idx(lv, tx, ty)] !== FLOOR) continue;
          const shape = ((tx - cx) / rx) ** 2 + ((ty - cy) / ry) ** 2;
          if (shape > 0.9 + hash2(tx, ty, 533) * 0.18) continue;
          if (protectedPoints.some((p) => Math.hypot(tx - p.x, ty - p.y) < p.radius)) continue;
          lv.tiles[idx(lv, tx, ty)] = WALL;
        }
      }
    }
    seedOre(lv, 6, 8);
    // Even the center of a large clump is mineable, not an indestructible wall.
    for (let ty = 1; ty < lv.h - 1; ty++) for (let tx = 1; tx < lv.w - 1; tx++) {
      if (lv.tiles[idx(lv, tx, ty)] === WALL) lv.tiles[idx(lv, tx, ty)] = STONE;
    }

    for (const [cx, cy] of LUSCIOUS_POOLS) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
        const tx = cx + dx, ty = cy + dy;
        if (dx * dx / 4 + dy * dy > 1.2 || !inBounds(lv, tx, ty)) continue;
        if (lv.tiles[idx(lv, tx, ty)] === FLOOR) lv.tiles[idx(lv, tx, ty)] = WET;
      }
      const x = (cx + 0.5) * TS, y = (cy + 0.5) * TS;
      lv.pickups.push({ item: 'axolotl', count: 1, x, y, originX: x, originY: y,
        phase: 'ground', age: 0, delay: 0, rise: 20, source: 'other', alreadyCollected: false });
    }
    for (const [x, y, phase] of lanterns) lv.decor.push({ kind: 'lantern', x: x * TS, y: y * TS, phase });
    for (const [x, y] of ferns) lv.decor.push({ kind: 'fern', x: x * TS, y: y * TS });
    return captureOriginalTiles(lv);
  }

  function buildStage7() {
    const lv = makeLevel('stage7', 'Spiral Cavern', 72, 72, false);
    const center = 36, turns = TAU * 3;
    // An Archimedean spiral with a five-tile-wide corridor: the separated
    // coils remain visibly circular and roomy enough for a Golem to navigate.
    for (let n = 0; n <= 1000; n++) {
      const angle = turns * n / 1000;
      const radius = 3 + 27 * n / 1000;
      const px = center + radius * Math.cos(angle), py = center + radius * Math.sin(angle);
      for (let ty = Math.floor(py - 3); ty <= Math.ceil(py + 3); ty++) {
        for (let tx = Math.floor(px - 3); tx <= Math.ceil(px + 3); tx++) {
          if (Math.hypot(tx + 0.5 - px, ty + 0.5 - py) <= 2.6) carveRect(lv, tx, ty, 1, 1);
        }
      }
    }
    lv.stairsUp = { tx: 66, ty: 36 };
    lv.upTarget = 'stage6';
    lv.tiles[idx(lv, 66, 36)] = STAIRS_UP;
    lv.spawn = { x: 65.5 * TS, y: 34.5 * TS };
    lv.downTarget = 'special';
    seedOre(lv, 66, 36);
    // A glimmering Titanium seam at the end of the spiral hides the entrance.
    lv.secretTile = { tx: 37, ty: 36 };
    lv.tiles[idx(lv, lv.secretTile.tx, lv.secretTile.ty)] = TITANIUM;
    for (const [x, y, phase] of [[65, 34, 0.5], [56, 15, 1.2], [21, 11, 2],
      [12, 41, 2.6], [39, 57, 0.7], [55, 32, 2.1], [36, 18, 1.6], [28, 39, 3], [39, 37, 0.4]]) {
      lv.decor.push({ kind: 'lantern', x: x * TS, y: y * TS, phase });
    }
    return captureOriginalTiles(lv);
  }

  function buildSpecialCave() {
    const lv = makeLevel('special', 'Special Cave', 50, 40, false);
    const chambers = [
      { x: 8, y: 9, rx: 6, ry: 6 }, { x: 23, y: 8, rx: 8, ry: 6 },
      { x: 39, y: 12, rx: 7, ry: 6 }, { x: 34, y: 28, rx: 8, ry: 7 },
      { x: 13, y: 29, rx: 8, ry: 7 }, { x: 24, y: 20, rx: 8, ry: 6 },
    ];
    carveCaverns(lv, chambers, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [1, 5], [5, 3]]);
    lv.stairsUp = { tx: 6, ty: 8 };
    lv.upTarget = 'stage7';
    lv.tiles[idx(lv, 6, 8)] = STAIRS_UP;
    lv.spawn = { x: 6.5 * TS, y: 9.6 * TS };
    seedOre(lv, 6, 8);
    for (const [x, y, phase] of [[5, 6, 0.5], [12, 7, 2], [23, 8, 1.1], [38, 12, 2.6],
      [24, 20, 0.9], [14, 29, 1.8], [34, 28, 3]]) {
      lv.decor.push({ kind: 'lantern', x: x * TS, y: y * TS, phase });
    }
    return captureOriginalTiles(lv);
  }

  function placeStalagmites(lv) {
    const byWall = [], inOpen = [];
    for (let ty = 1; ty < lv.h - 1; ty++) {
      for (let tx = 1; tx < lv.w - 1; tx++) {
        // Only put formations on existing floor, never replace a rock or wall.
        if (lv.tiles[idx(lv, tx, ty)] !== FLOOR) continue;
        if (Math.hypot(tx - lv.stairsUp.tx, ty - lv.stairsUp.ty) < 4) continue;
        // Keep the exit and the space used when returning upstairs clear.
        if (lv.stairsDown && Math.hypot(tx - lv.stairsDown.tx, ty - lv.stairsDown.ty) < 4) continue;
        if (lv.decor.some((d) => Math.hypot(tx + 0.5 - d.x / TS, ty + 0.5 - d.y / TS) < 0.9)) continue;
        const openSides = FOUR_WAYS.filter(([dx, dy]) => !TILES[lv.tiles[idx(lv, tx + dx, ty + dy)]].solid).length;
        if (openSides < 3) continue; // leave narrow passages clear
        if (openSides === 4 && FOUR_WAYS.some(([dx, dy]) => {
          const nx = tx + dx * 3, ny = ty + dy * 3;
          return !inBounds(lv, nx, ny) || TILES[lv.tiles[idx(lv, nx, ny)]].solid;
        })) continue; // a free-standing spike needs room on every side
        (openSides < 4 ? byWall : inOpen).push({ tx, ty });
      }
    }

    // Seed a mix of wall-side and free-standing spikes without closing off
    // any floor. Formations are spaced apart so the passages stay navigable.
    for (const candidates of [byWall, inOpen]) {
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = randInt(0, i);
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      let placed = 0;
      for (const { tx, ty } of candidates) {
        let tooClose = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (lv.stalagmites.has(tileKey(tx + dx, ty + dy))) tooClose = true;
        }
        if (tooClose) continue;
        const key = tileKey(tx, ty);
        lv.stalagmites.add(key);
        const reachable = reachableOnEntry(lv);
        let connected = true;
        for (let y = 0; y < lv.h && connected; y++) {
          for (let x = 0; x < lv.w; x++) {
            if (!isSolidInLevel(lv, x, y) && !reachable[idx(lv, x, y)]) { connected = false; break; }
          }
        }
        if (!connected || !largeSlimeRoutesOpen(lv)) lv.stalagmites.delete(key);
        else if (++placed >= 24) break;
      }
    }
  }

  // A large slime's collision box is wider than a single tile. Keep a route
  // between chambers that accommodates its full body, not just its centre.
  function largeSlimeRoutesOpen(lv) {
    const radius = BALANCE.largeSlimeRadius;
    const fits = (tx, ty) => {
      const x = (tx + 0.5) * TS, y = (ty + 0.5) * TS;
      const x0 = Math.floor((x - radius) / TS), x1 = Math.floor((x + radius - 0.001) / TS);
      const y0 = Math.floor((y - radius) / TS), y1 = Math.floor((y + radius - 0.001) / TS);
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
        if (isSolidInLevel(lv, xx, yy)) return false;
      }
      return true;
    };
    const sx = Math.floor(lv.spawn.x / TS), sy = Math.floor(lv.spawn.y / TS);
    if (!fits(sx, sy)) return false;
    const seen = new Uint8Array(lv.w * lv.h);
    const start = idx(lv, sx, sy), queue = [start];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head], tx = current % lv.w, ty = Math.floor(current / lv.w);
      for (const [dx, dy] of FOUR_WAYS) {
        const nx = tx + dx, ny = ty + dy;
        if (!inBounds(lv, nx, ny)) continue;
        const next = idx(lv, nx, ny);
        if (seen[next] || !fits(nx, ny)) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    return STAGE4_CHAMBERS.every((room) => {
      for (let y = room.y - 3; y <= room.y + 3; y++) {
        for (let x = room.x - 4; x <= room.x + 4; x++) {
          if (inBounds(lv, x, y) && seen[idx(lv, x, y)]) return true;
        }
      }
      return false;
    });
  }

  // Seed walls within two tiles of open floor. Each stage has its own ores.
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
        const r = Math.random();
        if (lv.id === 'special') {
          if (r < 0.24) lv.tiles[i] = MERCURY;
          else if (r < 0.47) lv.tiles[i] = TITANIUM;
          else if (r < 0.69) lv.tiles[i] = IRIDIUM;
          else if (r < 0.86) lv.tiles[i] = QUARTZ;
          else lv.tiles[i] = STONE;
        } else if (lv.id === 'stage7') {
          if (r < 0.23) lv.tiles[i] = TITANIUM;
          else if (r < 0.46) lv.tiles[i] = IRIDIUM;
          else if (r < 0.66) lv.tiles[i] = COBALT;
          else if (r < 0.84) lv.tiles[i] = GOLD;
          else lv.tiles[i] = STONE;
        } else if (lv.id === 'stage6') {
          if (r < 0.27) lv.tiles[i] = GOLD;
          else if (r < 0.53) lv.tiles[i] = COBALT;
          else if (r < 0.79) lv.tiles[i] = QUARTZ;
          else lv.tiles[i] = STONE;
        } else if (lv.id === 'stage5') {
          if (r < 0.3) lv.tiles[i] = BAUXITE;
          else if (r < 0.58) lv.tiles[i] = IRON;
          else lv.tiles[i] = STONE;
        } else if (lv.id === 'stage4') {
          if (r < 0.22) lv.tiles[i] = GOLD;
          else if (r < 0.53) lv.tiles[i] = IRON;
          else lv.tiles[i] = STONE;
        } else if (lv.id === 'stage3') {
          if (r < 0.32) lv.tiles[i] = GOLD;
          else if (r < 0.68) lv.tiles[i] = SILVER;
          else lv.tiles[i] = STONE;
        } else if (lv.id === 'stage2') {
          const ironChance = clamp(0.13 + away / 400, 0.13, 0.24);
          const copperChance = clamp(0.12 + away / 300, 0.12, 0.26);
          if (r < ironChance) lv.tiles[i] = IRON;
          else if (r < ironChance + copperChance) lv.tiles[i] = COPPER;
          else if (r < ironChance + copperChance + 0.28) lv.tiles[i] = COAL;
          else lv.tiles[i] = STONE;
        } else {
          const copperChance = clamp(0.08 + away / 220, 0.08, 0.26);
          if (r < copperChance) lv.tiles[i] = COPPER;
          else if (r < copperChance + 0.3) lv.tiles[i] = COAL;
          else lv.tiles[i] = STONE;
        }
      }
    }

    const guaranteedOres = {
      stage4: [STONE, IRON, GOLD], stage5: [STONE, IRON, BAUXITE],
      stage6: [STONE, GOLD, COBALT, QUARTZ],
      stage7: [STONE, GOLD, COBALT, IRIDIUM, TITANIUM],
      special: [STONE, TITANIUM, IRIDIUM, QUARTZ, MERCURY],
    };
    if (guaranteedOres[lv.id]) {
      // Even an unlucky random seed leaves at least one accessible vein of
      // each requested rock. Only edge rock can be selected for the fallback.
      const ores = guaranteedOres[lv.id];
      for (const wanted of ores) {
        if (lv.tiles.includes(wanted)) continue;
        for (let i = 0; i < lv.tiles.length; i++) {
          const current = lv.tiles[i];
          if (dist[i] !== 1 || !ores.includes(current)) continue;
          if (lv.tiles.filter((tile) => tile === current).length <= 1) continue;
          lv.tiles[i] = wanted;
          break;
        }
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
    if (left !== count) {
      syncBag();
      refreshStation(); // the open Melter/Forge should see new stock immediately
    }
    return left;
  }

  function countItem(itemKey) {
    let n = 0;
    for (const cell of inventory) if (cell && cell.item === itemKey) n += cell.count;
    return n;
  }

  function inventorySpace(itemKey) {
    let space = 0;
    for (const cell of inventory) {
      if (!cell) space += STACK_MAX;
      else if (cell.item === itemKey) space += Math.max(0, STACK_MAX - cell.count);
    }
    return space;
  }

  // Remove up to `n` of an item; returns how many were actually taken.
  function removeItem(itemKey, n) {
    let left = n;
    for (let i = inventory.length - 1; i >= 0 && left > 0; i--) {
      const cell = inventory[i];
      if (!cell || cell.item !== itemKey) continue;
      const take = Math.min(cell.count, left);
      cell.count -= take;
      left -= take;
      if (cell.count <= 0) inventory[i] = null;
    }
    if (left !== n) {
      syncBag();
      refreshStation();
    }
    return n - left;
  }

  // Plan an exchange on a copy first. Taking the smallest input stacks first
  // can free a slot even in a full bag; no ingredient is lost if output will
  // not fit. The original bag is changed only after the whole plan succeeds.
  function planExchange(input, inputCount, output, outputCount) {
    if (countItem(input) < inputCount) return null;
    const bag = inventory.map((cell) => cell ? { ...cell } : null);
    const sources = bag.map((cell, index) => ({ cell, index }))
      .filter(({ cell }) => cell && cell.item === input)
      .sort((a, b) => a.cell.count - b.cell.count);
    let remaining = inputCount;
    for (const { index } of sources) {
      const take = Math.min(bag[index].count, remaining);
      bag[index].count -= take;
      remaining -= take;
      if (bag[index].count === 0) bag[index] = null;
      if (!remaining) break;
    }
    let left = outputCount;
    for (const cell of bag) {
      if (!cell || cell.item !== output || cell.count >= STACK_MAX) continue;
      const amount = Math.min(STACK_MAX - cell.count, left);
      cell.count += amount;
      left -= amount;
      if (!left) break;
    }
    for (let i = 0; i < bag.length && left > 0; i++) {
      if (bag[i]) continue;
      const amount = Math.min(STACK_MAX, left);
      bag[i] = { item: output, count: amount };
      left -= amount;
    }
    return left ? null : bag;
  }

  function commitExchange(plan) {
    for (let i = 0; i < inventory.length; i++) inventory[i] = plan[i];
    syncBag();
  }

  // Halve each resource's total, not each stack independently. The chest and
  // the Melter are separate from the bag and are never part of the penalty.
  function halveResources() {
    const totals = new Map();
    for (const cell of inventory) {
      if (cell) totals.set(cell.item, (totals.get(cell.item) || 0) + cell.count);
    }
    let lost = 0;
    for (const [item, total] of totals) {
      lost += removeItem(item, total - Math.round(total / 2));
    }
    syncBag();
    refreshStation();
    return lost;
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
        cell.slot.classList.toggle('is-ingot', !!ITEMS[item.item].isIngot);
        cell.slot.classList.toggle('is-coin', !!ITEMS[item.item].isCoin);
        cell.slot.classList.toggle('is-creature', !!ITEMS[item.item].isCreature);
        cell.gem.style.setProperty('--gem', ITEMS[item.item].color);
        cell.count.textContent = item.count > 1 ? String(item.count) : '';
        cell.slot.title = ITEMS[item.item].name;
      } else {
        cell.slot.classList.remove('has-item', 'is-ingot', 'is-coin', 'is-creature');
        cell.count.textContent = '';
        cell.slot.removeAttribute('title');
      }
    }
  }

  /* ------------------------------------------------------------ storage */

  const storageRows = {};

  function buildStorage() {
    if (!el.storageRows) return;
    el.storageRows.innerHTML = '';
    for (const [item, def] of Object.entries(ITEMS)) {
      const row = document.createElement('div');
      row.className = 'storage-row';
      const resource = document.createElement('span');
      resource.className = 'storage-resource';
      const gem = document.createElement('span');
      gem.className = def.isIngot ? 'gem is-ingot' : def.isCoin ? 'gem is-coin' : def.isCreature ? 'gem is-creature' : 'gem';
      gem.setAttribute('aria-hidden', 'true');
      gem.style.setProperty('--gem', def.color);
      const name = document.createElement('span');
      name.className = 'storage-resource-name';
      name.textContent = def.name;
      resource.appendChild(gem);
      resource.appendChild(name);

      const bag = document.createElement('span');
      bag.className = 'storage-amount';
      const stored = document.createElement('span');
      stored.className = 'storage-amount is-stored';
      const actions = document.createElement('span');
      actions.className = 'storage-actions';
      const deposit = document.createElement('button');
      deposit.type = 'button';
      deposit.className = 'storage-action';
      deposit.textContent = 'Store';
      deposit.setAttribute('aria-label', 'Store ' + def.name);
      deposit.title = 'Store one; Shift-click to store all';
      deposit.addEventListener('click', (e) => depositToStorage(item, e.shiftKey ? countItem(item) : 1));
      const withdraw = document.createElement('button');
      withdraw.type = 'button';
      withdraw.className = 'storage-action is-take';
      withdraw.textContent = 'Take';
      withdraw.setAttribute('aria-label', 'Take ' + def.name);
      withdraw.title = 'Take one; Shift-click to take all';
      withdraw.addEventListener('click', (e) => withdrawFromStorage(item, e.shiftKey ? storage[item] : 1));
      actions.appendChild(deposit);
      actions.appendChild(withdraw);
      row.appendChild(resource);
      row.appendChild(bag);
      row.appendChild(stored);
      row.appendChild(actions);
      el.storageRows.appendChild(row);
      storageRows[item] = { row, bag, stored, deposit, withdraw };
    }
  }

  function refreshStorage() {
    if (!el.storageRows) return;
    let canDeposit = false;
    let canWithdraw = false;
    let hasStored = false;
    for (const [item, row] of Object.entries(storageRows)) {
      const inBag = countItem(item);
      const inStorage = storage[item];
      const space = inventorySpace(item);
      row.bag.textContent = String(inBag);
      row.stored.textContent = String(inStorage);
      row.row.setAttribute('aria-label', `${ITEMS[item].name}: ${inBag} in bag, ${inStorage} stored`);
      row.deposit.disabled = inBag === 0;
      row.withdraw.disabled = inStorage === 0 || space === 0;
      canDeposit ||= inBag > 0;
      canWithdraw ||= inStorage > 0 && space > 0;
      hasStored ||= inStorage > 0;
    }
    el.depositAll.disabled = !canDeposit;
    el.withdrawAll.disabled = !canWithdraw;
    el.storageHint.textContent = hasStored && !canWithdraw
      ? 'Your bag is full. Stored resources will stay safe here.'
      : 'Store or take one at a time · Shift-click for all.';
  }

  // Every transfer only removes what the other side can actually hold.
  function depositToStorage(item, amount) {
    if (!Object.hasOwn(storage, item) || amount <= 0) return 0;
    const moved = removeItem(item, amount);
    storage[item] += moved;
    refreshStation();
    return moved;
  }

  function withdrawFromStorage(item, amount) {
    if (!Object.hasOwn(storage, item) || amount <= 0) return 0;
    const wanted = Math.min(storage[item], amount);
    const left = addItem(item, wanted);
    const moved = wanted - left;
    storage[item] -= moved;
    if (moved > 0) {
      const chest = level.stations && level.stations.find((st) => st.kind === 'storage');
      if (chest) spawnPickup(item, moved, chest.x, chest.y - 12, { alreadyCollected: true });
    }
    refreshStation();
    return moved;
  }

  function depositEverything() {
    for (const item of Object.keys(storage)) depositToStorage(item, countItem(item));
  }

  function withdrawEverything() {
    for (const item of Object.keys(storage)) withdrawFromStorage(item, storage[item]);
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

  /* ------------------------------------------------ Home Base stations */

  const STATION_LABELS = { melter: 'Melter', forge: 'Forge', storage: 'Storage',
    press: 'Coin Press', trader: 'Coin Trader', elevator: 'Elevator' };

  function swordDamageFor(tier, mercurySword) {
    const base = tier >= 4 ? BALANCE.swordDamageT4 : tier >= 3 ? BALANCE.swordDamageT3 :
      tier >= 2 ? BALANCE.swordDamageT2 : BALANCE.swordDamage;
    return mercurySword ? base * BALANCE.mercurySwordMultiplier : base;
  }

  function tierDamage() {
    return swordDamageFor(state.tools.sword, state.mercurySword);
  }

  // T4 removes exactly two hits from T3, but never reduces a block below one.
  function pickaxeHits(def) {
    if (!def.hits) return null;
    const tier = clamp(state.tools.pickaxe, 1, MAX_TIER);
    const t3 = def.hitsByTier ? def.hitsByTier[2] : 1;
    if (tier >= 4) return Math.max(1, t3 - 2);
    if (def.hitsByTier) return def.hitsByTier[tier - 1];
    return tier >= 2 ? 1 : def.hits;
  }

  function upgradeMaterial(tier) {
    if (tier === 1) return 'ingot';
    if (tier === 2) return 'ironIngot';
    if (tier === 3) return 'titanium';
    return null;
  }

  function refreshTierBadges() {
    for (const [tool, node] of [['pickaxe', el.pickTier], ['sword', el.swordTier]]) {
      if (!node) continue;
      const tier = state.tools[tool];
      node.textContent = 'T' + tier;
      node.classList.toggle('is-max', tier >= MAX_TIER);
    }
  }

  function stationAt(wx, wy) {
    if (!level || !level.stations) return null;
    for (const st of level.stations) {
      if (Math.hypot(wx - st.x, wy - st.y) <= 34) return st;
    }
    return null;
  }

  function elevatorAt(wx, wy) {
    return level && level.elevators.find((lift) => Math.hypot(wx - lift.x, wy - lift.y) <= 24);
  }

  function useElevator(lift) {
    if (!lift || !level || !level.elevators.includes(lift) || state.mode !== 'playing') return false;
    if (Math.hypot(player.x - lift.x, player.y - lift.y) > 2.5 * TS) {
      showToast('Walk closer to the elevator.');
      return false;
    }
    openStation('elevator');
    return true;
  }

  function openStation(kind) {
    if (!el.station || !Object.hasOwn(STATION_LABELS, kind)) return;
    if (kind === 'elevator' && (!level || !level.elevators.length)) return;
    state.mode = 'station';
    state.openStation = kind;
    keys.clear();
    clearTouchMove();
    pointer.down = false;
    stage.classList.remove('is-playing');

    el.viewMelter.classList.toggle('is-hidden', kind !== 'melter');
    el.viewForge.classList.toggle('is-hidden', kind !== 'forge');
    el.viewStorage.classList.toggle('is-hidden', kind !== 'storage');
    el.viewPress.classList.toggle('is-hidden', kind !== 'press');
    el.viewTrader.classList.toggle('is-hidden', kind !== 'trader');
    el.viewElevator.classList.toggle('is-hidden', kind !== 'elevator');
    el.stationPanel.classList.toggle('is-storage', kind === 'storage');
    el.station.setAttribute('aria-label', STATION_LABELS[kind]);
    el.station.classList.remove('is-hidden');
    if (kind === 'press') el.pressHint.textContent = 'Melt Bauxite first to make Aluminum.';
    if (kind === 'trader') el.traderHint.textContent = 'Press each new coin to unlock its coal exchange.';
    refreshStation();
  }

  function closeStation() {
    if (state.mode !== 'station') return;
    state.mode = 'playing';
    state.openStation = null;
    el.station.classList.add('is-hidden');
    stage.classList.add('is-playing');
    last = 0; // avoid a huge dt from the paused frames
  }

  const elevatorButtons = [];

  function buildElevatorUI() {
    el.elevatorFloors.innerHTML = '';
    elevatorButtons.length = 0;
    for (const floor of ELEVATOR_FLOORS) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'elevator-floor';
      const number = document.createElement('span');
      number.className = 'elevator-floor-number'; number.textContent = floor.number;
      const labels = document.createElement('span'); labels.className = 'elevator-floor-name';
      const name = document.createElement('strong'), status = document.createElement('small');
      labels.appendChild(name); labels.appendChild(status);
      button.appendChild(number); button.appendChild(labels);
      button.addEventListener('click', () => travelByElevator(floor.id));
      el.elevatorFloors.appendChild(button);
      elevatorButtons.push({ floor, button, name, status });
    }
  }

  function refreshElevator() {
    const readyToReactivate = !state.elevatorUnlocked && level && level.id === 'stage7';
    el.elevatorStatus.textContent = state.elevatorUnlocked
      ? 'Power restored. Choose a floor you have visited.'
      : readyToReactivate ? 'The Stage 7 controls can restore power to every elevator.'
        : 'Offline. Reach Stage 7 to reactivate the elevator.';
    el.elevatorActivate.classList.toggle('is-hidden', !readyToReactivate);
    el.elevatorActivate.disabled = !readyToReactivate;
    for (const { floor, button, name, status } of elevatorButtons) {
      const visited = !!levels[floor.id];
      const here = level && floor.id === level.id;
      name.textContent = visited ? floor.name : 'Undiscovered';
      status.textContent = !visited ? 'Not visited' : here ? 'You are here' : state.elevatorUnlocked ? 'Travel' : 'Offline';
      button.disabled = !state.elevatorUnlocked || !visited || here;
      button.classList.toggle('is-current', !!here);
      button.setAttribute('aria-label', `Floor ${floor.number}: ${name.textContent} · ${status.textContent}`);
    }
  }

  function activateElevator() {
    if (state.mode !== 'station' || state.openStation !== 'elevator' || !level ||
        level.id !== 'stage7' || state.elevatorUnlocked) return false;
    state.elevatorUnlocked = true;
    Sound.forge();
    showToast('Elevators reactivated on every visited floor!');
    refreshElevator();
    return true;
  }

  function travelByElevator(id) {
    if (state.mode !== 'station' || state.openStation !== 'elevator' || !state.elevatorUnlocked ||
        !ELEVATOR_FLOORS.some((floor) => floor.id === id) || !levels[id] || id === level.id ||
        !levels[id].elevators.length) return false;
    const destination = ELEVATOR_FLOORS.find((floor) => floor.id === id);
    closeStation();
    enterLevel(id, `Elevator: ${destination.name}`); // normal area resets and loot handling still apply
    const landing = level.elevators[0];
    player.x = camera.x = landing.x;
    player.y = camera.y = landing.y;
    state.transitionLock = 0.6;
    return true;
  }

  // Keep the open menu's numbers in step with the bag.
  function refreshStation() {
    if (!el.viewMelter) return;

    // --- melter ---
    const ore = melter.selectedOre;
    const result = INGOT_FOR_ORE[ore];
    const fuelReady = melter.coal > 0;
    const inputReady = melter[ore] > 0;
    el.slotFuel.classList.toggle('is-filled', fuelReady);
    el.slotInput.classList.toggle('is-filled', inputReady);
    el.inputLabel.textContent = `Top · ${ITEMS[ore].name} ore`;
    el.fuelGem.style.setProperty('--gem', ITEMS.coal.color);
    el.inputGem.style.setProperty('--gem', ITEMS[ore].color);
    el.fuelGem.style.display = fuelReady ? 'block' : 'none';
    el.inputGem.style.display = inputReady ? 'block' : 'none';
    el.fuelCount.textContent = fuelReady ? String(melter.coal) : '';
    el.inputCount.textContent = inputReady ? String(melter[ore]) : '';
    for (const [kind, button] of [['copper', el.oreCopper], ['iron', el.oreIron], ['bauxite', el.oreBauxite]]) {
      button.classList.toggle('is-active', kind === ore);
      button.setAttribute('aria-pressed', kind === ore ? 'true' : 'false');
    }

    const ingredientsReady = melter.coal >= MELT_COAL && melter[ore] >= MELT_ORE;
    const roomForIngot = inventorySpace(result) > 0;
    el.meltBtn.disabled = !ingredientsReady || !roomForIngot;
    if (ingredientsReady && !roomForIngot) {
      el.melterHint.textContent = 'Your bag is full. Make room for the ingot first.';
    } else if (ingredientsReady) {
      el.melterHint.textContent = `Ready! One coal and one ${ore} make one ${ITEMS[result].name}.`;
    } else if (!fuelReady && !inputReady) {
      el.melterHint.textContent = 'Choose an ore, then click a slot to load it · Shift-click to return items.';
    } else if (!fuelReady) {
      el.melterHint.textContent = 'Needs coal in the bottom fuel slot.';
    } else {
      el.melterHint.textContent = `Needs ${ore} ore in the top slot.`;
    }

    // --- forge ---
    el.forgeIngots.textContent = String(countItem('ingot'));
    el.forgeIronIngots.textContent = String(countItem('ironIngot'));
    el.forgeTitanium.textContent = String(countItem('titanium'));
    el.forgeMercuryCount.textContent = `${countItem('mercury')} Mercury in bag`;
    el.upgradeMercury.disabled = state.mercurySword || countItem('mercury') < 3;
    el.upgradeMercury.textContent = state.mercurySword ? 'Applied' : '3 Mercury';
    for (const [tool, tierNode, btn] of [
      ['pickaxe', el.forgePickTier, el.upgradePickaxe],
      ['sword', el.forgeSwordTier, el.upgradeSword],
    ]) {
      const tier = state.tools[tool];
      const material = upgradeMaterial(tier);
      tierNode.textContent = 'T' + tier;
      tierNode.classList.toggle('is-max', tier >= MAX_TIER);
      btn.disabled = !material || countItem(material) < UPGRADE_COST;
      const label = material === 'ingot' ? 'copper' : material === 'ironIngot' ? 'iron' : 'titanium';
      btn.textContent = material ? `Upgrade · 3 ${label}` : 'Maxed';
    }
    if (state.tools.pickaxe >= MAX_TIER && state.tools.sword >= MAX_TIER) {
      el.forgeHint.textContent = 'Both tools are as good as this forge can make them.';
    } else {
      el.forgeHint.textContent = 'T4 pickaxes need two fewer hits than T3, down to one.';
    }

    refreshTierBadges();
    refreshStorage();
    refreshCoins();
    refreshElevator();
  }

  function selectMelterOre(ore) {
    if (!Object.hasOwn(INGOT_FOR_ORE, ore)) return false;
    const other = Object.keys(INGOT_FOR_ORE).find((kind) => kind !== ore && melter[kind] > 0);
    if (other) {
      el.melterHint.textContent = `Shift-click the top slot to return its ${other} before switching.`;
      return false;
    }
    melter.selectedOre = ore;
    refreshStation();
    return true;
  }

  function loadSlot(kind) {
    // Clicking a slot loads one item from the bag; clicking again adds more.
    if (kind !== 'coal' && !Object.hasOwn(INGOT_FOR_ORE, kind)) return;
    if (kind !== 'coal' && kind !== melter.selectedOre && !selectMelterOre(kind)) return;
    const loaded = removeItem(kind, 1) === 1;
    if (loaded) melter[kind] += 1;
    refreshStation();
    if (!loaded) el.melterHint.textContent = `No ${kind} in your bag.`;
  }

  function emptySlot(kind) {
    // Shift-click returns what fits. Anything else stays safely in the slot.
    if ((kind !== 'coal' && !Object.hasOwn(INGOT_FOR_ORE, kind)) || melter[kind] <= 0) return;
    const loaded = melter[kind];
    const left = addItem(kind, loaded);
    const returned = loaded - left;
    melter[kind] = left;
    if (returned > 0) {
      const furnace = level.stations && level.stations.find((st) => st.kind === 'melter');
      if (furnace) spawnPickup(kind, returned, furnace.x, furnace.y - 20, { alreadyCollected: true });
    }
    refreshStation();
    if (left > 0) el.melterHint.textContent = 'Your bag is full. The rest stays in the Melter.';
  }

  function melt() {
    const ore = melter.selectedOre;
    const result = INGOT_FOR_ORE[ore];
    if (melter.coal < MELT_COAL || melter[ore] < MELT_ORE) return false;
    if (inventorySpace(result) < 1) {
      refreshStation();
      return false;
    }
    const furnace = level.stations && level.stations.find((st) => st.kind === 'melter');
    if (!furnace) return false;

    melter.coal -= MELT_COAL;
    melter[ore] -= MELT_ORE;
    refreshStation();
    closeStation();

    // The menu closes first, so the flame and the flying ingot are visible.
    const mouthX = furnace.x + 8.5;
    const mouthY = furnace.y - 32;
    melterBursts.push({ x: mouthX, y: mouthY, age: 0, duration: 1.25 });
    spawnPickup(result, 1, mouthX, mouthY, { delay: 0.16, rise: 46, source: 'melter' });
    Sound.melt();
    return true;
  }

  function refreshCoins() {
    for (const [kind, recipe] of Object.entries(COINS)) {
      const ui = coinUi[kind];
      const material = countItem(recipe.input);
      const coins = countItem(recipe.coin);
      const canPress = !!planExchange(recipe.input, 1, recipe.coin, 1);
      const canTrade = traderUnlocked[kind] && !!planExchange(recipe.coin, recipe.cost, 'coal', recipe.coal);
      ui.count.textContent = `${material} in bag${material && !canPress ? ' · bag full' : ''}`;
      ui.press.disabled = !canPress;
      ui.press.title = material ? (canPress ? 'Press one coin' : 'Make room in your bag first') : `Needs ${ITEMS[recipe.input].name} in your bag`;
      ui.trade.disabled = !canTrade;
      ui.trade.textContent = traderUnlocked[kind] ? 'Trade' : 'Locked';
      ui.status.textContent = traderUnlocked[kind]
        ? `Available · ${coins} in bag${coins >= recipe.cost && !canTrade ? ' · bag full' : ''}`
        : `Locked · press ${kind === 'aluminum' ? 'an' : 'a'} ${ITEMS[recipe.coin].name}`;
    }
    const axolotls = countItem('axolotl');
    const canSell = !!planExchange('axolotl', 1, 'goldCoin', 1);
    el.tradeAxolotl.disabled = !canSell;
    el.tradeAxolotlStatus.textContent = `${axolotls} in bag${axolotls && !canSell ? ' · bag full' : ''}`;
  }

  function pressCoin(kind) {
    if (!Object.hasOwn(COINS, kind) || !level || !level.isBase) return false;
    const recipe = COINS[kind];
    const plan = planExchange(recipe.input, 1, recipe.coin, 1);
    if (!plan) {
      refreshStation();
      el.pressHint.textContent = countItem(recipe.input) ? 'Your bag is full. Make room for the coin first.' : `Needs ${ITEMS[recipe.input].name} in your bag.`;
      return false;
    }
    commitExchange(plan);
    const unlockedNow = !traderUnlocked[kind];
    traderUnlocked[kind] = true;
    refreshStation();
    el.pressHint.textContent = unlockedNow
      ? `${ITEMS[recipe.coin].name} pressed! Its coal trade is now unlocked.`
      : `${ITEMS[recipe.coin].name} pressed.`;
    const station = level.stations.find((st) => st.kind === 'press');
    if (station) spawnPickup(recipe.coin, 1, station.x, station.y - 12, { alreadyCollected: true });
    Sound.pickup();
    return true;
  }

  function tradeCoin(kind) {
    if (!Object.hasOwn(COINS, kind) || !level || !level.isBase || !traderUnlocked[kind]) return false;
    const recipe = COINS[kind];
    const plan = planExchange(recipe.coin, recipe.cost, 'coal', recipe.coal);
    if (!plan) {
      refreshStation();
      el.traderHint.textContent = countItem(recipe.coin) < recipe.cost
        ? `Needs ${recipe.cost} ${ITEMS[recipe.coin].name}${recipe.cost === 1 ? '' : 's'} in your bag.`
        : 'Your bag is full. Make room for the coal first.';
      return false;
    }
    commitExchange(plan);
    refreshStation();
    el.traderHint.textContent = `Traded for ${recipe.coal} Coal.`;
    const station = level.stations.find((st) => st.kind === 'trader');
    if (station) spawnPickup('coal', recipe.coal, station.x, station.y - 12, { alreadyCollected: true });
    Sound.pickup();
    return true;
  }

  function sellAxolotl() {
    if (!level || !level.isBase) return false;
    const plan = planExchange('axolotl', 1, 'goldCoin', 1);
    if (!plan) {
      refreshStation();
      el.traderHint.textContent = countItem('axolotl') ? 'Your bag is full. Make room for the Gold Coin.' : 'No Axolotls in your bag.';
      return false;
    }
    commitExchange(plan);
    refreshStation();
    el.traderHint.textContent = 'Sold an Axolotl for 1 Gold Coin.';
    const station = level.stations.find((st) => st.kind === 'trader');
    if (station) spawnPickup('goldCoin', 1, station.x, station.y - 12, { alreadyCollected: true });
    Sound.pickup();
    return true;
  }

  function upgradeMercurySword() {
    if (state.mercurySword || countItem('mercury') < 3) return false;
    removeItem('mercury', 3);
    state.mercurySword = true;
    Sound.forge();
    showToast('Mercury edge: sword damage +15%!');
    refreshStation();
    return true;
  }

  function upgradeTool(tool) {
    if (!Object.hasOwn(state.tools, tool)) return false;
    const material = upgradeMaterial(state.tools[tool]);
    if (!material) return false;
    if (countItem(material) < UPGRADE_COST) {
      el.forgeHint.textContent = `Needs 3 ${ITEMS[material].name}${material === 'titanium' ? '' : 's'}.`;
      return false;
    }
    removeItem(material, UPGRADE_COST);
    state.tools[tool] += 1;
    Sound.forge();
    showToast(`${tool === 'pickaxe' ? 'Pickaxe' : 'Sword'} upgraded to T${state.tools[tool]}!`);
    refreshStation();
    return true;
  }

  /* ---------------------------------------------------------------- input */

  const MOVE_KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
  };

  // A captured pointer controls only movement. A second touch can still aim
  // and swing on the canvas without either finger stealing the other's input.
  const touchMove = { id: null, x: 0, y: 0 };
  const touchNode = document.getElementById('touch-move');
  const touchKnob = document.getElementById('touch-knob');
  function clearTouchMove() {
    touchMove.id = null; touchMove.x = touchMove.y = 0;
    if (touchKnob) touchKnob.style.transform = 'translate(-50%, -50%)';
  }
  function moveTouchStick(e) {
    if (e.pointerId !== touchMove.id || state.mode !== 'playing') return;
    const box = touchNode.getBoundingClientRect();
    const dx = e.clientX - (box.left + box.width / 2), dy = e.clientY - (box.top + box.height / 2);
    const distance = Math.hypot(dx, dy), radius = Math.max(1, Math.min(box.width, box.height) * 0.32);
    if (distance < 6) touchMove.x = touchMove.y = 0;
    else { touchMove.x = dx / distance; touchMove.y = dy / distance; }
    const visual = Math.min(distance, radius);
    if (touchKnob) touchKnob.style.transform = `translate(calc(-50% + ${touchMove.x * visual}px), calc(-50% + ${touchMove.y * visual}px))`;
    e.preventDefault();
  }
  if (touchNode) {
    touchNode.addEventListener('pointerdown', (e) => {
      if (state.mode !== 'playing' || touchMove.id !== null || e.button !== 0) return;
      touchMove.id = e.pointerId;
      if (touchNode.setPointerCapture) {
        try { touchNode.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
      }
      moveTouchStick(e);
    });
    touchNode.addEventListener('pointermove', moveTouchStick);
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      touchNode.addEventListener(event, (e) => { if (e.pointerId === touchMove.id) clearTouchMove(); });
    }
  }

  window.addEventListener('keydown', (e) => {
    if (pendingSaveConfirmation) {
      if (e.code === 'Tab') {
        e.preventDefault();
        const next = document.activeElement === el.saveConfirmAccept ? el.saveConfirmCancel : el.saveConfirmAccept;
        if (next.focus) next.focus();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        cancelSaveConfirmation();
      } else if (MOVE_KEYS[e.code] || (e.code === 'Space' && (!e.target || e.target.tagName !== 'BUTTON'))) {
        e.preventDefault();
      }
      return; // do not change the run underneath the confirmation
    }
    // Let focused menu buttons keep their normal keyboard activation; Space is
    // still the equipped-tool shortcut whenever the game is being played.
    if (e.code === 'Space' && state.mode !== 'playing' && e.target &&
        (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT')) return;
    if (MOVE_KEYS[e.code] || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);

    switch (e.code) {
      case 'KeyQ': selectTool('pickaxe'); break;
      case 'KeyE': selectTool('sword'); break;
      case 'KeyF':
        if (state.mode === 'playing' && level.elevators.length) {
          const lift = level.elevators.find((entry) => Math.hypot(player.x - entry.x, player.y - entry.y) <= 2.5 * TS);
          if (lift) useElevator(lift);
        }
        break;
      case 'Space':
        if (state.mode === 'playing') swing();
        else if (state.mode === 'menu') {
          if (!el.continueSave.classList.contains('is-hidden') && !el.continueSave.disabled) loadBrowserSave();
          else startGame();
        }
        else if (state.mode === 'paused') resumeGame();
        break;
      case 'Escape':
        if (state.mode === 'station') closeStation();
        else if (state.mode === 'playing') pauseGame(true);
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
    clearTouchMove();
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
    if (state.mode !== 'playing' || e.button !== 0) return;

    // Lift buttons work in every connected area; stations remain in Home Base.
    const w = screenToWorld(pointer.x, pointer.y);
    const lift = elevatorAt(w.x, w.y);
    if (lift && useElevator(lift)) return;
    const st = stationAt(w.x, w.y);
    if (st) {
      openStation(st.kind);
      return;
    }
    swing();
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
    const t = level.stalagmites.has(tileKey(tx, ty)) ? STALAGMITE : getTile(tx, ty);
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
    const key = tileKey(tx, ty);
    const stalagmite = level.stalagmites.has(key);
    const t = stalagmite ? STALAGMITE : getTile(tx, ty);
    const def = TILES[t];
    const needed = pickaxeHits(def);
    const taken = (level.damage.get(key) || 0) + 1;

    shake(0.45);
    hitParticles((tx + 0.5) * TS, (ty + 0.5) * TS, def.base);

    if (taken < needed) {
      level.damage.set(key, taken);
      Sound.pickHit();
      return;
    }

    level.damage.delete(key);
    const secretSeam = level.secretTile && tx === level.secretTile.tx && ty === level.secretTile.ty && t === TITANIUM;
    if (stalagmite) level.stalagmites.delete(key);
    else setTile(tx, ty, secretSeam ? STAIRS_DOWN : FLOOR);
    if (secretSeam) showToast('The seam reveals a hidden staircase!');

    if (def.drop) {
      const amount = def.drop === 'stone' ? randInt(1, 2) : 1;
      spawnPickup(def.drop, amount, (tx + 0.5) * TS, (ty + 0.5) * TS, { source: 'mining' });
      Sound.oreBreak();
    } else {
      Sound.rockBreak();
    }
  }

  /* ---------------------------------------------------------------- combat */

  function swordSweep() {
    const aim = state.swingDir;
    let hitAny = false;

    // Snapshot all enemies: a slime's newly split children cannot be hit by
    // the same swing, and a prospector's loot is dropped exactly once.
    for (const s of [...slimes, ...moles, ...spiders, ...golems, ...level.prospectors]) {
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
      if (s.kind === 'mole') damageMole(s, tierDamage(), ang);
      else if (s.kind === 'spider') damageSpider(s, tierDamage(), ang);
      else if (s.kind === 'golem') damageGolem(s, tierDamage(), ang);
      else if (s.kind === 'prospector') damageProspector(s, tierDamage(), ang);
      else damageSlime(s, tierDamage(), ang);
    }

    if (hitAny) Sound.swordHit();
  }

  function damageSlime(s, amount, angle) {
    if (s.tropical) s.provoked = true;
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

  function damageMole(mole, amount, angle) {
    mole.hp -= amount;
    mole.flash = 0.16;
    mole.knockX += Math.cos(angle) * 150;
    mole.knockY += Math.sin(angle) * 150;
    shake(0.3);
    floaters.push({
      x: mole.x, y: mole.y - mole.r - 4, text: String(amount),
      color: '#fff0c0', life: 0.7, maxLife: 0.7, vy: -52,
    });
    if (mole.hp <= 0) {
      mole.dead = true;
      state.molesSlain += 1;
      Sound.moleDie();
      burst(mole.x, mole.y, 14, ['#9b765d', '#d8bc96', '#d2e2e7'], 150, 0.5, 0.12);
    }
  }

  function damageSpider(spider, amount, angle) {
    if (spider.dead) return;
    spider.hp -= amount;
    spider.flash = 0.16;
    spider.knockX += Math.cos(angle) * 150;
    spider.knockY += Math.sin(angle) * 150;
    shake(0.3);
    floaters.push({
      x: spider.x, y: spider.y - spider.r - 8, text: String(amount),
      color: '#fff0c0', life: 0.7, maxLife: 0.7, vy: -52,
    });
    if (spider.hp > 0) return;
    spider.dead = true;
    state.spidersSlain += 1;
    Sound.slimeDie();
    burst(spider.x, spider.y, 12, ['#59465f', '#a88192', '#dfc9c0'], 140, 0.45, 0.1);
  }

  function damageGolem(golem, amount, angle) {
    if (golem.dead) return;
    golem.hp -= amount;
    golem.flash = 0.16;
    // A disabled Golem stays completely still, even when struck.
    if (golem.disabled <= 0) {
      golem.knockX += Math.cos(angle) * 70;
      golem.knockY += Math.sin(angle) * 70;
    }
    shake(0.3);
    floaters.push({
      x: golem.x, y: golem.y - golem.r - 12, text: String(amount),
      color: '#fff0c0', life: 0.7, maxLife: 0.7, vy: -52,
    });
    if (golem.hp > 0) return;
    golem.dead = true;
    state.golemsSlain += 1;
    Sound.moleDie();
    burst(golem.x, golem.y, 16, golem.mercury ? ['#79a9b0', '#bce9e9', '#f4ffff'] : ['#766e65', '#b6a99a', '#e4b285'], 150, 0.55, 0.14);
    // Ground loot belongs to the current area, survives a full bag, and is
    // never duplicated by another swing against the same defeated Golem.
    if (golem.mercury) {
      spawnPickup('mercury', randInt(2, 4), golem.x, golem.y, { startOnGround: true, source: 'golem' });
    } else {
      spawnPickup('stone', 2, golem.x - 6, golem.y, { startOnGround: true, source: 'golem' });
      spawnPickup('bauxite', 3, golem.x + 6, golem.y, { startOnGround: true, source: 'golem' });
      if (Math.random() < 0.01) spawnPickup('titanium', 1, golem.x, golem.y + 6, { startOnGround: true, source: 'golem' });
    }
  }

  function damageProspector(prospector, amount, angle) {
    if (prospector.dead) return;
    prospector.hp -= amount;
    prospector.flash = 0.16;
    prospector.knockX += Math.cos(angle) * 150;
    prospector.knockY += Math.sin(angle) * 150;
    shake(0.3);
    floaters.push({
      x: prospector.x, y: prospector.y - prospector.r - 12, text: String(amount),
      color: '#fff0c0', life: 0.7, maxLife: 0.7, vy: -52,
    });
    if (prospector.hp > 0) return;

    prospector.dead = true;
    state.prospectorsSlain += 1;
    Sound.moleDie();
    burst(prospector.x, prospector.y, 14, ['#d4a465', '#f5cf61', '#d9e2e7'], 150, 0.5, 0.12);
    // The haul is not credited directly: it becomes level-owned ground loot,
    // so full bags and level transitions cannot erase or duplicate it.
    for (const [item, offset] of [['gold', -6], ['silver', 6]]) {
      const amountHeld = prospector.haul[item];
      if (amountHeld > 0) spawnPickup(item, amountHeld, prospector.x + offset, prospector.y, { startOnGround: true, source: 'prospector' });
      prospector.haul[item] = 0;
    }
  }

  function killSlime(s) {
    s.dead = true;
    state.slimesSlain += 1;
    Sound.slimeDie();
    burst(s.x, s.y, 14, [s.color, shade(s.color, 1.25), '#ffffff'], 170, 0.55, 0.14);

    if (!s.tiny) {
      // Large slimes split into two regular slimes; regulars split into tinies.
      for (let i = 0; i < 2; i++) {
        const a = rand(0, TAU);
        const tiny = !s.large;
        const radius = tiny ? BALANCE.tinyRadius : BALANCE.slimeRadius;
        let x = s.x + Math.cos(a) * 10;
        let y = s.y + Math.sin(a) * 10;
        if (collidesAt(x, y, radius)) { x = s.x; y = s.y; }
        // Each tropical offspring is peaceful until that individual is hit.
        slimes.push(makeSlime(x, y, tiny, false, s.tropical));
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

  function hurtPlayer(amount, fromAngle, ignoreInvulnerability = false, invulnerabilityTime = BALANCE.invulnerableTime) {
    if (state.mode !== 'playing' || (state.invuln > 0 && !ignoreInvulnerability)) return;
    state.hp = Math.max(0, state.hp - amount);
    state.invuln = invulnerabilityTime;
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

  function makeSlime(x, y, tiny, large = false, tropical = false) {
    const hp = large ? BALANCE.largeSlimeHp : tiny ? BALANCE.tinyHp : BALANCE.slimeHp;
    return {
      x,
      y,
      r: large ? BALANCE.largeSlimeRadius : tiny ? BALANCE.tinyRadius : BALANCE.slimeRadius,
      hp,
      maxHp: hp,
      dmg: large ? BALANCE.largeSlimeDamage : tiny ? BALANCE.tinyDamage : BALANCE.slimeDamage,
      speed: large ? BALANCE.largeSlimeSpeed : tiny ? BALANCE.tinySpeed : BALANCE.slimeSpeed,
      detect: large ? BALANCE.largeSlimeDetect : tiny ? BALANCE.tinyDetect : BALANCE.slimeDetect,
      tiny: !!tiny && !large,
      large: !!large,
      tropical: !!tropical && !large,
      provoked: false,
      color: tropical && !large ? (tiny ? '#84d9ee' : '#3badd3') : large ? '#419b78' : tiny ? '#a8e88b' : '#5fbf6e',
      dead: false,
      flash: 0,
      attackCd: 0,
      knockX: 0,
      knockY: 0,
      hop: rand(0, TAU), // hop cycle for the bounce animation
      face: 1,
      chasing: false,
      wanderAngle: rand(0, TAU),
      wanderTimer: rand(0.4, 2),
      hopGround: 0, // 0..1, how far off the ground the hop is
    };
  }

  function spawnSlimeAwayFromPlayer() {
    if (!['stage1', 'stage2', 'stage4', 'stage5', 'stage6'].includes(level.id)) return null;
    const p = playerTile();
    const tropical = level.id === 'stage6';
    // Prefer different pools, not a crowd at a single one. Some slimes still
    // spawn throughout the cavern, and the existing global cap stays intact.
    const preferWater = tropical && Math.random() < 0.7;
    for (let attempt = 0; attempt < 60; attempt++) {
      let tx, ty;
      if (preferWater && attempt < 40 && level.wetSpots && level.wetSpots.length) {
        const available = level.wetSpots.filter((pool) => slimes.filter((s) => !s.dead && s.tropical &&
          Math.hypot(s.x - (pool.tx + 0.5) * TS, s.y - (pool.ty + 0.5) * TS) < 4 * TS).length < 2);
        if (!available.length) continue;
        const pool = pick(available);
        tx = pool.tx + randInt(-3, 3); ty = pool.ty + randInt(-3, 3);
        if (Math.hypot(tx - pool.tx, ty - pool.ty) > 3.5) continue;
      } else {
        tx = randInt(1, level.w - 2); ty = randInt(1, level.h - 2);
      }
      if (!inBounds(level, tx, ty) || isSolid(tx, ty)) continue;
      if (getTile(tx, ty) === STAIRS_UP || getTile(tx, ty) === STAIRS_DOWN) continue;
      if (Math.hypot(tx - p.tx, ty - p.ty) < 7) continue;

      const large = level.id === 'stage4' || level.id === 'stage5';
      const x = (tx + 0.5) * TS, y = (ty + 0.5) * TS;
      if (collidesAt(x, y, large ? BALANCE.largeSlimeRadius : BALANCE.slimeRadius)) continue;
      if (tropical && slimes.some((s) => !s.dead && Math.hypot(s.x - x, s.y - y) < 2 * TS)) continue;
      const s = makeSlime(x, y, false, large, tropical);
      slimes.push(s);
      burst(s.x, s.y, 8, s.tropical ? ['#9feefa', '#48add7'] : ['#8ce09a', '#4f9e5c'], 90, 0.45, 0.1);
      return s;
    }
    return null;
  }

  function slimeWanderAngle(s) {
    if (s.tropical && !s.provoked && level.wetSpots && Math.random() < 0.5) {
      let closest = null, distance = Infinity;
      for (const pool of level.wetSpots) {
        const dx = (pool.tx + 0.5) * TS - s.x, dy = (pool.ty + 0.5) * TS - s.y;
        const d = Math.hypot(dx, dy);
        if (d < distance) { closest = { dx, dy }; distance = d; }
      }
      // In the neighborhood, wander normally; outside it, gently drift back.
      if (closest && distance > 3 * TS) return Math.atan2(closest.dy, closest.dx) + rand(-1, 1);
    }
    return rand(0, TAU);
  }

  function updateSlimes(dt) {
    if (!['stage1', 'stage2', 'stage4', 'stage5', 'stage6'].includes(level.id)) return;

    const alive = slimes.filter((s) => !s.dead).length;
    const largeStage = level.id === 'stage4' || level.id === 'stage5';
    if (alive < (largeStage ? BALANCE.maxLargeSlimes : BALANCE.maxSlimes)) {
      level.slimeTimer -= dt;
      if (level.slimeTimer <= 0) {
        level.slimeTimer = largeStage ? BALANCE.largeSlimeSpawnEvery : BALANCE.slimeSpawnEvery;
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

      const dx = player.x - s.x;
      const dy = player.y - s.y;
      const dist = Math.hypot(dx, dy) || 1;
      s.face = dx >= 0 ? 1 : -1;

      // Large slimes see 6 tiles, regulars 4, and tiny slimes 2.
      s.chasing = (!s.tropical || s.provoked) && dist <= s.detect;

      let moveX = 0;
      let moveY = 0;

      if (s.chasing) {
        moveX = (dx / dist) * s.speed;
        moveY = (dy / dist) * s.speed;
        s.wanderTimer = 0;
      } else {
        // Out of sight they potter about at half speed in a random direction.
        s.wanderTimer -= dt;
        if (s.wanderTimer <= 0) {
          s.wanderTimer = rand(1.1, 2.8);
          s.wanderAngle = slimeWanderAngle(s);
        }
        const amble = s.speed * 0.5;
        moveX = Math.cos(s.wanderAngle) * amble;
        moveY = Math.sin(s.wanderAngle) * amble;
      }

      const kx = s.knockX;
      const ky = s.knockY;
      s.knockX *= 1 - 8 * dt;
      s.knockY *= 1 - 8 * dt;

      const nx = s.x + (moveX + kx) * dt;
      const ny = s.y + (moveY + ky) * dt;

      const beforeX = s.x;
      const beforeY = s.y;
      if (!collidesAt(nx, s.y, s.r)) s.x = nx;
      if (!collidesAt(s.x, ny, s.r)) s.y = ny;

      // If a wanderer walks into a wall, pick a fresh direction instead of
      // grinding along it forever.
      if (!s.chasing) {
        const blocked = Math.abs(s.x - beforeX) < 0.05 && Math.abs(s.y - beforeY) < 0.05;
        if (blocked) {
          s.wanderAngle = rand(0, TAU);
          s.wanderTimer = rand(0.6, 1.6);
        }
      }

      // Hopping: fast little hops when chasing, gentle ones when ambling.
      const moving = Math.abs(s.x - beforeX) + Math.abs(s.y - beforeY) > 0.01;
      const cadence = s.chasing ? (s.tiny ? 5.2 : 4.3) : 2.3;
      s.hop += dt * cadence * (moving ? 1 : 0.45);
      s.hopGround = Math.abs(Math.sin(s.hop));

      // contact damage
      if ((!s.tropical || s.provoked) && dist < s.r + BALANCE.playerRadius + 1 && s.attackCd <= 0) {
        s.attackCd = 1;
        hurtPlayer(s.dmg, Math.atan2(s.y - player.y, s.x - player.x));
      }
    }
  }

  /* ------------------------------------------------------------ Drill Moles */

  function makeMole(x, y) {
    return {
      kind: 'mole', x, y,
      r: BALANCE.moleRadius,
      hp: BALANCE.moleHp, maxHp: BALANCE.moleHp,
      dmg: BALANCE.moleDamage, speed: BALANCE.moleSpeed,
      dead: false, flash: 0, attackCd: 0, knockX: 0, knockY: 0,
      angle: 0, drillSpin: 0, chasing: false, inWall: false,
      wanderAngle: rand(0, TAU), wanderTimer: rand(0.5, 2),
      lastTile: `${Math.floor(x / TS)},${Math.floor(y / TS)}`,
    };
  }

  function spawnMoleAwayFromPlayer() {
    if (level.id !== 'stage2' && level.id !== 'stage7') return null;
    const p = playerTile();
    for (let attempt = 0; attempt < 90; attempt++) {
      const tx = randInt(1, level.w - 2);
      const ty = randInt(1, level.h - 2);
      if (isSolid(tx, ty) || getTile(tx, ty) === STAIRS_UP) continue;
      if (Math.hypot(tx - p.tx, ty - p.ty) < 7) continue;
      const mole = makeMole((tx + 0.5) * TS, (ty + 0.5) * TS);
      moles.push(mole);
      burst(mole.x, mole.y, 8, ['#a08269', '#d3b493', '#c9dbe1'], 85, 0.4, 0.08);
      return mole;
    }
    return null;
  }

  function moleEnteredTile(mole) {
    const tx = Math.floor(mole.x / TS);
    const ty = Math.floor(mole.y / TS);
    const key = `${tx},${ty}`;
    if (key === mole.lastTile) return;
    mole.lastTile = key;
    const tile = getTile(tx, ty);
    if (!TILES[tile].solid || tx <= 0 || ty <= 0 || tx >= level.w - 1 || ty >= level.h - 1) return;
    // Only the player's pickaxe can uncover the special cave's entrance.
    if (level.secretTile && tx === level.secretTile.tx && ty === level.secretTile.ty) return;

    // Roll once per entered block, not once per frame spent inside it. The
    // outer boundary is always protected, but interior rock and walls can break.
    if (Math.random() >= BALANCE.moleBreakChance) return;
    const def = TILES[tile];
    level.damage.delete(key);
    setTile(tx, ty, FLOOR);
    const x = (tx + 0.5) * TS;
    const y = (ty + 0.5) * TS;
    // A mole destroys the block outright; only player-mined blocks drop items.
    hitParticles(x, y, def.base);
    if (Math.hypot(player.x - x, player.y - y) < 8 * TS) Sound.rockBreak();
  }

  function updateMoles(dt) {
    if (level.id !== 'stage2' && level.id !== 'stage7') return;
    const alive = moles.filter((mole) => !mole.dead).length;
    if (alive < BALANCE.maxMoles) {
      level.moleTimer -= dt;
      if (level.moleTimer <= 0) {
        level.moleTimer = BALANCE.moleSpawnEvery;
        spawnMoleAwayFromPlayer();
      }
    }

    for (let i = moles.length - 1; i >= 0; i--) {
      const mole = moles[i];
      if (mole.dead) {
        moles.splice(i, 1);
        continue;
      }
      mole.flash = Math.max(0, mole.flash - dt);
      mole.attackCd = Math.max(0, mole.attackCd - dt);
      const dx = player.x - mole.x;
      const dy = player.y - mole.y;
      const dist = Math.hypot(dx, dy) || 1;
      mole.chasing = dist <= BALANCE.moleDetect;
      let moveX;
      let moveY;
      if (mole.chasing) {
        moveX = dx / dist * mole.speed;
        moveY = dy / dist * mole.speed;
        mole.wanderTimer = 0;
      } else {
        mole.wanderTimer -= dt;
        if (mole.wanderTimer <= 0) {
          mole.wanderTimer = rand(1.1, 2.8);
          mole.wanderAngle = rand(0, TAU);
        }
        moveX = Math.cos(mole.wanderAngle) * mole.speed * 0.5;
        moveY = Math.sin(mole.wanderAngle) * mole.speed * 0.5;
      }
      if (Math.hypot(moveX, moveY) > 0.01) mole.angle = Math.atan2(moveY, moveX);
      mole.drillSpin += dt * 18;

      // Unlike slimes and the player, moles ignore interior tile collisions.
      const nx = mole.x + (moveX + mole.knockX) * dt;
      const ny = mole.y + (moveY + mole.knockY) * dt;
      mole.knockX *= Math.max(0, 1 - 8 * dt);
      mole.knockY *= Math.max(0, 1 - 8 * dt);
      mole.x = clamp(nx, TS + mole.r, (level.w - 1) * TS - mole.r);
      mole.y = clamp(ny, TS + mole.r, (level.h - 1) * TS - mole.r);
      if (!mole.chasing && (mole.x !== nx || mole.y !== ny)) mole.wanderTimer = 0;
      moleEnteredTile(mole);
      mole.inWall = isSolid(Math.floor(mole.x / TS), Math.floor(mole.y / TS));

      if (Math.hypot(player.x - mole.x, player.y - mole.y) < mole.r + BALANCE.playerRadius + 1 && mole.attackCd <= 0) {
        mole.attackCd = 1;
        hurtPlayer(mole.dmg, Math.atan2(mole.y - player.y, mole.x - player.x));
      }
    }
  }

  /* ---------------------------------------------------------------- spiders */

  function makeSpider(x, y) {
    return {
      kind: 'spider', x, y, r: BALANCE.spiderRadius,
      hp: BALANCE.spiderHp, maxHp: BALANCE.spiderHp,
      dmg: BALANCE.spiderDamage, speed: BALANCE.spiderSpeed,
      detect: BALANCE.spiderDetect, dead: false, flash: 0,
      attackCd: 0, bite: 0, knockX: 0, knockY: 0,
      facing: 0, walk: 0, chasing: false,
      wanderAngle: rand(0, TAU), wanderTimer: rand(0.6, 1.8),
      chaseRoute: [], chaseRouteIndex: 0, chaseGoal: '', chasePathTimer: 0,
      stuckTime: 0,
    };
  }

  function spawnSpiderAwayFromPlayer() {
    if (!['stage4', 'stage5', 'stage7'].includes(level.id)) return null;
    const p = playerTile();
    for (let attempt = 0; attempt < 90; attempt++) {
      const tx = randInt(1, level.w - 2), ty = randInt(1, level.h - 2);
      const tile = getTile(tx, ty);
      if (isSolid(tx, ty) || tile === STAIRS_UP || tile === STAIRS_DOWN) continue;
      if (Math.hypot(tx - p.tx, ty - p.ty) < 7) continue;
      const x = (tx + 0.5) * TS, y = (ty + 0.5) * TS;
      if (collidesAt(x, y, BALANCE.spiderRadius)) continue;
      const spider = makeSpider(x, y);
      spiders.push(spider);
      burst(x, y, 7, ['#58465f', '#a78191', '#d6c6b6'], 65, 0.35, 0.07);
      return spider;
    }
    return null;
  }

  function updateSpiders(dt) {
    if (!['stage4', 'stage5', 'stage7'].includes(level.id)) return;
    if (spiders.filter((spider) => !spider.dead).length < BALANCE.maxSpiders) {
      level.spiderTimer -= dt;
      if (level.spiderTimer <= 0) {
        level.spiderTimer = BALANCE.spiderSpawnEvery;
        spawnSpiderAwayFromPlayer();
      }
    }

    for (let i = spiders.length - 1; i >= 0; i--) {
      const spider = spiders[i];
      if (spider.dead) { spiders.splice(i, 1); continue; }
      spider.flash = Math.max(0, spider.flash - dt);
      spider.attackCd = Math.max(0, spider.attackCd - dt);
      spider.bite = Math.max(0, spider.bite - dt);
      const dx = player.x - spider.x, dy = player.y - spider.y;
      const dist = Math.hypot(dx, dy);
      spider.chasing = dist <= spider.detect;
      let direction;
      let speed = spider.speed;
      if (spider.chasing) {
        direction = chaseDirection(spider, dt);
        spider.wanderTimer = 0;
      } else {
        spider.wanderTimer -= dt;
        if (spider.wanderTimer <= 0) {
          spider.wanderTimer = rand(0.8, 1.8);
          spider.wanderAngle = rand(0, TAU);
        }
        direction = { x: Math.cos(spider.wanderAngle), y: Math.sin(spider.wanderAngle) };
        speed *= 0.5;
      }
      if (direction) spider.facing = Math.atan2(direction.y, direction.x);
      const vx = (direction ? direction.x * speed : 0) + spider.knockX;
      const vy = (direction ? direction.y * speed : 0) + spider.knockY;
      spider.knockX *= Math.max(0, 1 - 8 * dt);
      spider.knockY *= Math.max(0, 1 - 8 * dt);
      const oldX = spider.x, oldY = spider.y;
      if (!collidesAt(spider.x + vx * dt, spider.y, spider.r)) spider.x += vx * dt;
      if (!collidesAt(spider.x, spider.y + vy * dt, spider.r)) spider.y += vy * dt;
      if (Math.hypot(spider.x - oldX, spider.y - oldY) > 0.01) {
        spider.walk += dt * 18;
        spider.stuckTime = 0;
      } else {
        spider.stuckTime += dt;
        if (spider.stuckTime > 0.5) {
          spider.stuckTime = 0;
          spider.wanderTimer = 0;
          spider.chasePathTimer = 0;
        }
      }
      if (Math.hypot(player.x - spider.x, player.y - spider.y) <= spider.r + BALANCE.playerRadius + 1 && spider.attackCd <= 1e-9) {
        spider.attackCd = BALANCE.spiderAttackEvery;
        spider.bite = 0.18;
        // A short recovery from a spider bite lets its rapid, low-damage
        // attacks land while retaining normal protection after other enemies.
        hurtPlayer(spider.dmg, Math.atan2(player.y - spider.y, player.x - spider.x), false, BALANCE.spiderHitInvulnerability);
        if (state.mode !== 'playing') return;
      }
    }
  }

  /* ---------------------------------------------------------------- Golems */

  function makeGolem(x, y, mercury = false, armour = tierDamage()) {
    // One extra swing at the player's current sword strength, for every tier
    // and with or without Mercury Edge. Store the resulting max HP in saves.
    const hp = (mercury ? BALANCE.mercuryGolemHp : BALANCE.golemHp) + armour;
    return {
      kind: 'golem', mercury: !!mercury, x, y, r: BALANCE.golemRadius,
      hp, maxHp: hp,
      dmg: mercury ? BALANCE.mercuryGolemDamage : BALANCE.golemDamage,
      speed: mercury ? BALANCE.mercuryGolemSpeed : BALANCE.golemSpeed,
      detect: BALANCE.golemDetect, dead: false, flash: 0,
      attackCd: 0, knockX: 0, knockY: 0,
      facing: 0, walk: 0, chasing: false, moved: 0, disabled: 0,
      wanderAngle: rand(0, TAU), wanderTimer: rand(0.8, 2.4),
      chaseRoute: [], chaseRouteIndex: 0, chaseGoal: '', chasePathTimer: 0,
      stuckTime: 0,
    };
  }

  function spawnGolemAwayFromPlayer() {
    if (!['stage5', 'stage7', 'special'].includes(level.id)) return null;
    const p = playerTile();
    for (let attempt = 0; attempt < 90; attempt++) {
      const tx = randInt(1, level.w - 2), ty = randInt(1, level.h - 2);
      const tile = getTile(tx, ty);
      if (isSolid(tx, ty) || tile === STAIRS_UP || tile === STAIRS_DOWN) continue;
      if (Math.hypot(tx - p.tx, ty - p.ty) < 7) continue;
      const x = (tx + 0.5) * TS, y = (ty + 0.5) * TS;
      if (collidesAt(x, y, BALANCE.golemRadius)) continue;
      const golem = makeGolem(x, y, level.id === 'special');
      golems.push(golem);
      burst(x, y, 9, golem.mercury ? ['#8cb7bb', '#daf6ed', '#73c8d1'] : ['#766d63', '#b5a696', '#d4b290'], 65, 0.4, 0.08);
      return golem;
    }
    return null;
  }

  function updateGolems(dt) {
    if (!['stage5', 'stage7', 'special'].includes(level.id)) return;
    if (golems.filter((golem) => !golem.dead).length < BALANCE.maxGolems) {
      level.golemTimer -= dt;
      if (level.golemTimer <= 0) {
        level.golemTimer = BALANCE.golemSpawnEvery;
        spawnGolemAwayFromPlayer();
      }
    }

    for (let i = golems.length - 1; i >= 0; i--) {
      const golem = golems[i];
      if (golem.dead) { golems.splice(i, 1); continue; }
      golem.flash = Math.max(0, golem.flash - dt);
      golem.attackCd = Math.max(0, golem.attackCd - dt);
      if (golem.disabled > 0) {
        golem.disabled = Math.max(0, golem.disabled - dt);
        if (golem.disabled < 1e-9) golem.disabled = 0;
        golem.knockX = golem.knockY = 0;
        continue; // no movement or contact damage, including while overlapping
      }

      const dx = player.x - golem.x, dy = player.y - golem.y;
      const distance = Math.hypot(dx, dy);
      golem.chasing = distance <= golem.detect;
      let direction, speed = golem.speed;
      if (golem.chasing) {
        direction = chaseDirection(golem, dt);
        golem.wanderTimer = 0;
      } else {
        golem.wanderTimer -= dt;
        if (golem.wanderTimer <= 0) {
          golem.wanderTimer = rand(1.1, 2.8);
          golem.wanderAngle = rand(0, TAU);
        }
        direction = { x: Math.cos(golem.wanderAngle), y: Math.sin(golem.wanderAngle) };
        speed *= 0.5;
      }
      if (direction) golem.facing = Math.atan2(direction.y, direction.x);
      let stepX = ((direction ? direction.x * speed : 0) + golem.knockX) * dt;
      let stepY = ((direction ? direction.y * speed : 0) + golem.knockY) * dt;
      golem.knockX *= Math.max(0, 1 - 8 * dt);
      golem.knockY *= Math.max(0, 1 - 8 * dt);

      // Stop at exactly ten tiles of actual travel, not time spent trying to
      // walk into a wall. Sword knockback also counts as physical movement.
      const remaining = Math.max(0, BALANCE.golemMoveLimit - golem.moved);
      const intended = Math.hypot(stepX, stepY);
      if (intended > remaining && intended > 0) {
        stepX *= remaining / intended;
        stepY *= remaining / intended;
      }
      const oldX = golem.x, oldY = golem.y;
      if (!collidesAt(golem.x + stepX, golem.y, golem.r)) golem.x += stepX;
      if (!collidesAt(golem.x, golem.y + stepY, golem.r)) golem.y += stepY;
      const moved = Math.hypot(golem.x - oldX, golem.y - oldY);
      golem.moved += moved;
      if (moved > 0.01) {
        golem.walk += moved / 8;
        golem.stuckTime = 0;
      } else {
        golem.stuckTime += dt;
        if (golem.stuckTime > 0.8) {
          golem.stuckTime = 0;
          golem.wanderTimer = 0;
          golem.chasePathTimer = 0;
        }
      }
      if (golem.moved >= BALANCE.golemMoveLimit - 1e-7) {
        golem.moved = 0;
        golem.disabled = BALANCE.golemDisabledTime;
        golem.knockX = golem.knockY = 0;
        floaters.push({ x: golem.x, y: golem.y - golem.r - 16, text: 'Disabled!',
          color: '#d9ecf2', life: 1, maxLife: 1, vy: -28 });
        continue;
      }
      if (Math.hypot(player.x - golem.x, player.y - golem.y) <= golem.r + BALANCE.playerRadius + 1 && golem.attackCd <= 1e-9) {
        golem.attackCd = 1;
        hurtPlayer(golem.dmg, Math.atan2(player.y - golem.y, player.x - golem.x));
        if (state.mode !== 'playing') return;
      }
    }
  }

  /* ------------------------------------------------------------ Prospectors */

  const FOUR_WAYS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function makeProspector(x, y) {
    return {
      kind: 'prospector', x, y, r: BALANCE.prospectorRadius,
      hp: BALANCE.prospectorHp, maxHp: BALANCE.prospectorHp,
      dmg: BALANCE.slimeDamage, speed: BALANCE.slimeSpeed,
      haul: { gold: 0, silver: 0 },
      dead: false, flash: 0, attackCd: 0, throwCd: 0,
      knockX: 0, knockY: 0, facing: 0, walk: 0, swingTime: 0,
      chasing: false, mining: false, mineProgress: 0, mineTick: 0,
      oreTarget: null, scanTimer: 0, stuckTime: 0,
      wanderAngle: rand(0, TAU), wanderTimer: rand(0.8, 2.8),
      chaseRoute: [], chaseRouteIndex: 0, chaseGoal: '', chasePathTimer: 0,
    };
  }

  function spawnProspectorAwayFromPlayer() {
    if (!['stage3', 'stage4', 'stage7'].includes(level.id)) return null;
    const p = playerTile();
    for (let attempt = 0; attempt < 90; attempt++) {
      const tx = randInt(1, level.w - 2);
      const ty = randInt(1, level.h - 2);
      if (isSolid(tx, ty) || getTile(tx, ty) === STAIRS_UP || getTile(tx, ty) === STAIRS_DOWN) continue;
      if (Math.hypot(tx - p.tx, ty - p.ty) < 7) continue;
      const x = (tx + 0.5) * TS;
      const y = (ty + 0.5) * TS;
      if (collidesAt(x, y, BALANCE.prospectorRadius)) continue;
      const prospector = makeProspector(x, y);
      level.prospectors.push(prospector);
      burst(x, y, 8, ['#9b876a', '#d4b980', '#f8dc85'], 75, 0.4, 0.08);
      return prospector;
    }
    return null;
  }

  // A breadth-first walk tree lets Prospectors reach a vein around corners
  // rather than trying to walk through stone. Ore itself remains solid until
  // the prospector reaches a walkable tile next to it.
  function walkTree(tx, ty, radius = 0) {
    if (!inBounds(level, tx, ty) || isSolid(tx, ty)) return null;
    const size = level.w * level.h;
    const previous = new Int32Array(size).fill(-1);
    const distance = new Int16Array(size).fill(-1);
    const queue = new Int32Array(size);
    const start = idx(level, tx, ty);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    previous[start] = start;
    distance[start] = 0;
    while (head < tail) {
      const current = queue[head++];
      const x = current % level.w;
      const y = Math.floor(current / level.w);
      for (const [dx, dy] of FOUR_WAYS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(level, nx, ny) || isSolid(nx, ny)) continue;
        if (radius && collidesAt((nx + 0.5) * TS, (ny + 0.5) * TS, radius)) continue;
        const next = idx(level, nx, ny);
        if (previous[next] !== -1) continue;
        previous[next] = current;
        distance[next] = distance[current] + 1;
        queue[tail++] = next;
      }
    }
    return { previous, distance, start };
  }

  function routeTo(tree, tx, ty) {
    if (!tree || !inBounds(level, tx, ty)) return null;
    let cursor = idx(level, tx, ty);
    if (tree.previous[cursor] < 0) return null;
    const route = [];
    while (cursor !== tree.start) {
      route.push({ tx: cursor % level.w, ty: Math.floor(cursor / level.w) });
      cursor = tree.previous[cursor];
    }
    route.reverse();
    return route;
  }

  function findProspectorOre(prospector) {
    const sx = Math.floor(prospector.x / TS);
    const sy = Math.floor(prospector.y / TS);
    const ores = [];
    for (let ty = sy - 4; ty <= sy + 4; ty++) {
      for (let tx = sx - 4; tx <= sx + 4; tx++) {
        const tile = getTile(tx, ty);
        if (tile !== GOLD && tile !== SILVER) continue;
        const distance = Math.hypot((tx + 0.5) * TS - prospector.x, (ty + 0.5) * TS - prospector.y);
        if (distance <= BALANCE.prospectorDetect) ores.push({ tx, ty, tile, distance });
      }
    }
    if (!ores.length) return null;
    ores.sort((a, b) => a.distance - b.distance);
    const tree = walkTree(sx, sy);
    if (!tree) return null;
    function accessibleSide(tx, ty) {
      let best = null;
      for (const [dx, dy] of FOUR_WAYS) {
        const sideX = tx + dx;
        const sideY = ty + dy;
        if (!inBounds(level, sideX, sideY) || isSolid(sideX, sideY)) continue;
        const distance = tree.distance[idx(level, sideX, sideY)];
        if (distance < 0) continue;
        if (!best || distance < best.distance) best = { tx: sideX, ty: sideY, distance };
      }
      return best;
    }
    const approach = (tile, best) => ({
      ...tile, goalTx: best.tx, goalTy: best.ty,
      route: routeTo(tree, best.tx, best.ty), routeIndex: 0,
    });
    for (const ore of ores) {
      const best = accessibleSide(ore.tx, ore.ty);
      if (best) return approach(ore, best);
    }
    // A vein can sit one layer behind the visible rock. Clear an accessible
    // obstruction first instead of giving up on nearby buried ore.
    let obstruction = null;
    for (const ore of ores) {
      for (const [dx, dy] of FOUR_WAYS) {
        const tx = ore.tx + dx;
        const ty = ore.ty + dy;
        const tile = getTile(tx, ty);
        if (tile !== STONE && tile !== GOLD && tile !== SILVER) continue;
        const best = accessibleSide(tx, ty);
        if (best && (!obstruction || best.distance < obstruction.best.distance)) {
          obstruction = { tile: { tx, ty, tile }, best };
        }
      }
    }
    return obstruction ? approach(obstruction.tile, obstruction.best) : null;
  }

  function followRoute(prospector, target, reach = 2) {
    while (target.routeIndex < target.route.length) {
      const next = target.route[target.routeIndex];
      const dx = (next.tx + 0.5) * TS - prospector.x;
      const dy = (next.ty + 0.5) * TS - prospector.y;
      const distance = Math.hypot(dx, dy);
      if (distance < reach) { target.routeIndex++; continue; }
      return { x: dx / distance, y: dy / distance };
    }
    return null;
  }

  function clearWalkTo(prospector, x, y) {
    const distance = Math.hypot(x - prospector.x, y - prospector.y);
    const steps = Math.max(1, Math.ceil(distance / 8));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (collidesAt(lerp(prospector.x, x, t), lerp(prospector.y, y, t), prospector.r)) return false;
    }
    return true;
  }

  function chaseDirection(prospector, dt) {
    const dx = player.x - prospector.x;
    const dy = player.y - prospector.y;
    const distance = Math.hypot(dx, dy) || 1;
    if (clearWalkTo(prospector, player.x, player.y)) {
      prospector.chaseRoute.length = 0;
      return { x: dx / distance, y: dy / distance };
    }
    const tx = Math.floor(player.x / TS);
    const ty = Math.floor(player.y / TS);
    const goal = `${tx},${ty}`;
    prospector.chasePathTimer -= dt;
    if (prospector.chasePathTimer <= 0 || prospector.chaseGoal !== goal) {
      // A Golem needs a route that fits its whole body, not just its centre.
      const radius = prospector.kind === 'golem' ? prospector.r : 0;
      const tree = walkTree(Math.floor(prospector.x / TS), Math.floor(prospector.y / TS), radius);
      let route = routeTo(tree, tx, ty);
      if (!route && radius && tree) {
        // The player may stand against a wall where a Golem cannot fit. Head
        // to the closest reachable wide tile instead of abandoning the chase.
        let best = -1, bestDistance = Infinity;
        for (let i = 0; i < tree.distance.length; i++) {
          if (tree.distance[i] < 0) continue;
          const x = (i % level.w + 0.5) * TS, y = (Math.floor(i / level.w) + 0.5) * TS;
          const d = Math.hypot(player.x - x, player.y - y);
          if (d < bestDistance) { bestDistance = d; best = i; }
        }
        if (best >= 0) route = routeTo(tree, best % level.w, Math.floor(best / level.w));
      }
      prospector.chaseRoute = route || [];
      prospector.chaseRouteIndex = 0;
      prospector.chaseGoal = goal;
      prospector.chasePathTimer = 0.6;
    }
    const route = { route: prospector.chaseRoute, routeIndex: prospector.chaseRouteIndex };
    const direction = followRoute(prospector, route, Math.max(2, prospector.speed * dt));
    prospector.chaseRouteIndex = route.routeIndex;
    return direction || { x: dx / distance, y: dy / distance };
  }

  function throwDynamite(prospector) {
    const tx = Math.floor(player.x / TS);
    const ty = Math.floor(player.y / TS);
    const dynamite = {
      fromX: prospector.x, fromY: prospector.y,
      x: prospector.x, y: prospector.y,
      targetX: (tx + 0.5) * TS, targetY: (ty + 0.5) * TS,
      age: 0,
    };
    level.dynamites.push(dynamite);
    prospector.throwCd = BALANCE.dynamiteThrowCooldown;
    prospector.swingTime = 0.3;
    Sound.throwDynamite();
    return dynamite;
  }

  function updateProspectors(dt) {
    if (!['stage3', 'stage4', 'stage7'].includes(level.id)) return;
    const alive = level.prospectors.filter((prospector) => !prospector.dead).length;
    if (alive < BALANCE.maxProspectors) {
      level.prospectorTimer -= dt;
      if (level.prospectorTimer <= 0) {
        level.prospectorTimer = BALANCE.prospectorSpawnEvery;
        spawnProspectorAwayFromPlayer();
      }
    }

    const carriesTreasure = countItem('gold') > 0 || countItem('silver') > 0;
    for (let i = level.prospectors.length - 1; i >= 0; i--) {
      const prospector = level.prospectors[i];
      if (prospector.dead) { level.prospectors.splice(i, 1); continue; }
      prospector.flash = Math.max(0, prospector.flash - dt);
      prospector.attackCd = Math.max(0, prospector.attackCd - dt);
      prospector.throwCd = Math.max(0, prospector.throwCd - dt);
      prospector.swingTime = Math.max(0, prospector.swingTime - dt);
      prospector.mineTick = Math.max(0, prospector.mineTick - dt);
      prospector.mining = false;

      const dx = player.x - prospector.x;
      const dy = player.y - prospector.y;
      const distance = Math.hypot(dx, dy);
      prospector.chasing = carriesTreasure && distance <= BALANCE.prospectorDetect;
      let direction = null;
      let speed = prospector.speed * 0.5; // the same amble as a wandering slime

      if (prospector.chasing) {
        // A visible player carrying treasure always interrupts ore mining.
        prospector.oreTarget = null;
        prospector.mineProgress = 0;
        prospector.scanTimer = 0;
        prospector.facing = Math.atan2(dy, dx);
        speed = prospector.speed;
        if (distance > BALANCE.prospectorMeleeRange) {
          if (prospector.throwCd <= 1e-9) throwDynamite(prospector);
          direction = chaseDirection(prospector, dt);
        } else if (distance > prospector.r + BALANCE.playerRadius - 2) {
          direction = { x: dx / (distance || 1), y: dy / (distance || 1) };
        }
      } else {
        const target = prospector.oreTarget;
        if (target && getTile(target.tx, target.ty) !== target.tile) {
          prospector.oreTarget = null;
          prospector.mineProgress = 0;
          prospector.scanTimer = 0;
        }
        prospector.scanTimer -= dt;
        if (!prospector.oreTarget && prospector.scanTimer <= 0) {
          prospector.oreTarget = findProspectorOre(prospector);
          prospector.scanTimer = 0.6;
        }
        if (prospector.oreTarget) {
          const ore = prospector.oreTarget;
          const px = Math.floor(prospector.x / TS);
          const py = Math.floor(prospector.y / TS);
          const oreX = (ore.tx + 0.5) * TS;
          const oreY = (ore.ty + 0.5) * TS;
          const adjacent = Math.abs(px - ore.tx) + Math.abs(py - ore.ty) === 1;
          if (adjacent && Math.hypot(oreX - prospector.x, oreY - prospector.y) <= TS * 1.6) {
            prospector.mining = true;
            prospector.facing = Math.atan2(oreY - prospector.y, oreX - prospector.x);
            prospector.mineProgress += dt;
            if (prospector.mineTick <= 0) {
              prospector.mineTick = 0.35;
              prospector.swingTime = 0.24;
              hitParticles(oreX, oreY, TILES[ore.tile].base);
              if (Math.hypot(player.x - prospector.x, player.y - prospector.y) < 8 * TS) Sound.pickHit();
            }
            if (prospector.mineProgress >= BALANCE.prospectorMineTime && getTile(ore.tx, ore.ty) === ore.tile) {
              const item = ore.tile === GOLD ? 'gold' : ore.tile === SILVER ? 'silver' : null;
              level.damage.delete(`${ore.tx},${ore.ty}`);
              setTile(ore.tx, ore.ty, FLOOR);
              hitParticles(oreX, oreY, TILES[ore.tile].base);
              if (item) {
                prospector.haul[item] += 1;
                if (Math.hypot(player.x - prospector.x, player.y - prospector.y) < 8 * TS) Sound.oreBreak();
                floaters.push({ x: prospector.x, y: prospector.y - 25, text: '+1 ' + ITEMS[item].name,
                  color: ITEMS[item].color, life: 0.8, maxLife: 0.8, vy: -35 });
              } else if (Math.hypot(player.x - prospector.x, player.y - prospector.y) < 8 * TS) {
                Sound.rockBreak();
              }
              prospector.oreTarget = null;
              prospector.mineProgress = 0;
              prospector.scanTimer = 0;
            }
          } else {
            direction = followRoute(prospector, ore);
            if (!direction) {
              const gx = (ore.goalTx + 0.5) * TS - prospector.x;
              const gy = (ore.goalTy + 0.5) * TS - prospector.y;
              const length = Math.hypot(gx, gy);
              if (length > 1) direction = { x: gx / length, y: gy / length };
            }
          }
        } else {
          prospector.wanderTimer -= dt;
          if (prospector.wanderTimer <= 0) {
            prospector.wanderTimer = rand(1.1, 2.8);
            prospector.wanderAngle = rand(0, TAU);
          }
          direction = { x: Math.cos(prospector.wanderAngle), y: Math.sin(prospector.wanderAngle) };
        }
      }

      if (direction && !prospector.mining) prospector.facing = Math.atan2(direction.y, direction.x);
      const vx = (direction ? direction.x * speed : 0) + prospector.knockX;
      const vy = (direction ? direction.y * speed : 0) + prospector.knockY;
      prospector.knockX *= Math.max(0, 1 - 8 * dt);
      prospector.knockY *= Math.max(0, 1 - 8 * dt);
      const oldX = prospector.x;
      const oldY = prospector.y;
      if (!collidesAt(prospector.x + vx * dt, prospector.y, prospector.r)) prospector.x += vx * dt;
      if (!collidesAt(prospector.x, prospector.y + vy * dt, prospector.r)) prospector.y += vy * dt;
      const moved = Math.hypot(prospector.x - oldX, prospector.y - oldY);
      if (moved > 0.01) {
        prospector.walk += dt * 9;
        prospector.stuckTime = 0;
      } else if (direction) {
        prospector.stuckTime += dt;
        if (prospector.stuckTime > 0.8) {
          prospector.stuckTime = 0;
          prospector.wanderTimer = 0;
          prospector.chasePathTimer = 0;
          if (!prospector.chasing) { prospector.oreTarget = null; prospector.scanTimer = 0; prospector.mineProgress = 0; }
        }
      }

      if (prospector.chasing && prospector.attackCd <= 0 &&
          Math.hypot(player.x - prospector.x, player.y - prospector.y) <= BALANCE.prospectorMeleeRange) {
        prospector.attackCd = 1;
        prospector.swingTime = 0.3;
        hurtPlayer(prospector.dmg, Math.atan2(player.y - prospector.y, player.x - prospector.x));
        if (state.mode !== 'playing') return;
      }
    }
  }

  function updateDynamites(dt) {
    for (let i = level.explosions.length - 1; i >= 0; i--) {
      level.explosions[i].age += dt;
      if (level.explosions[i].age >= level.explosions[i].duration) level.explosions.splice(i, 1);
    }
    for (let i = level.dynamites.length - 1; i >= 0; i--) {
      const dynamite = level.dynamites[i];
      dynamite.age += dt;
      const flight = clamp(dynamite.age / BALANCE.dynamiteFlight, 0, 1);
      dynamite.x = lerp(dynamite.fromX, dynamite.targetX, flight);
      dynamite.y = lerp(dynamite.fromY, dynamite.targetY, flight);
      // The two-second fuse starts when the projectile reaches the ground,
      // not when the prospector releases it.
      if (dynamite.age + 1e-9 < BALANCE.dynamiteFlight + BALANCE.dynamiteFuse) continue;
      level.dynamites.splice(i, 1);
      const x = dynamite.targetX;
      const y = dynamite.targetY;
      level.explosions.push({ x, y, age: 0, duration: 0.5 });
      burst(x, y, 32, ['#ffdd7d', '#ff873b', '#e74d32', '#75665a'], 210, 0.55, 0.18);
      if (Math.hypot(player.x - x, player.y - y) < 9 * TS) Sound.explosion();
      shake(1.1);

      // Distance is measured in tile rings: every adjacent tile is one block
      // away, including diagonals. Percentages are of maximum player HP.
      const px = Math.floor(player.x / TS);
      const py = Math.floor(player.y / TS);
      const tx = Math.floor(x / TS);
      const ty = Math.floor(y / TS);
      const ring = Math.max(Math.abs(px - tx), Math.abs(py - ty));
      const damageFraction = [1, 0.7, 0.6, 0.5, 0.25][ring] || 0;
      if (damageFraction > 0) {
        // Blasts bypass ordinary contact invulnerability; the same-tile hit
        // must always be fatal, even immediately after another attack.
        const amount = Math.round(BALANCE.playerMaxHp * damageFraction);
        hurtPlayer(amount, Math.atan2(player.y - y, player.x - x), true);
        if (state.mode !== 'playing') return;
      }
    }
  }

  /* --------------------------------------------------------------- physics */

  function collidesInLevel(lv, x, y, r) {
    const x0 = Math.floor((x - r) / TS);
    const x1 = Math.floor((x + r - 0.001) / TS);
    const y0 = Math.floor((y - r) / TS);
    const y1 = Math.floor((y + r - 0.001) / TS);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (isSolidInLevel(lv, tx, ty)) return true;
      }
    }
    return false;
  }

  const collidesAt = (x, y, r) => collidesInLevel(level, x, y, r);
  const collides = (x, y) => collidesAt(x, y, BALANCE.playerRadius);

  function updatePlayer(dt) {
    let ix = touchMove.x;
    let iy = touchMove.y;
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
    if (t === STAIRS_DOWN) return level.downTarget;
    if (t === STAIRS_UP) return level.upTarget;
    return null;
  }

  function updateTransition(dt) {
    if (state.transitionLock > 0) {
      state.transitionLock -= dt;
      return;
    }
    const target = stairsUnderPlayer();
    if (!target) return;

    enterLevel(target, target === 'home' ? 'Back at Home Base.' : undefined);
  }

  function showAreaName(lv) {
    const descriptions = {
      stage1: { kicker: 'Stage 01', subtitle: 'The start of an epic journey!' },
      stage2: { kicker: 'Stage 02', subtitle: 'Moles have carved these tunnels' },
      stage3: { kicker: 'Stage 03', subtitle: 'The abundant riches have attracted the greedy' },
      stage4: { kicker: 'Stage 04', subtitle: 'The calcium grows into spikes here' },
      stage5: { kicker: 'Stage 05', subtitle: 'Ancient stone guardians roam among the Bauxite' },
      stage6: { kicker: 'Stage 06', subtitle: 'A peaceful break from the monsters' },
      stage7: { kicker: 'Stage 07', subtitle: 'The pinnacle of circles' },
      special: { kicker: 'Secret Area', subtitle: 'A secluded mercury paradise' },
    };
    const area = descriptions[lv.id];
    el.stageName.textContent = lv.name;
    el.areaKicker.textContent = area ? area.kicker : '';
    el.areaSubtitle.textContent = area ? area.subtitle : '';
    state.areaIntro = area ? 3.5 : 0;
    el.areaBanner.classList.toggle('is-arriving', !!area);
  }

  function updateAreaName(dt) {
    if (state.areaIntro <= 0) return;
    state.areaIntro = Math.max(0, state.areaIntro - dt);
    if (state.areaIntro === 0) el.areaBanner.classList.remove('is-arriving');
  }

  // Tiles restored around a previously mined tunnel can otherwise bury a
  // ground pickup or trap a prospector carrying ore. Find safe, reachable
  // floor tiles without deleting either of them.
  function reachableOnEntry(lv) {
    const reachable = new Uint8Array(lv.w * lv.h);
    const sx = Math.floor(lv.spawn.x / TS);
    const sy = Math.floor(lv.spawn.y / TS);
    if (isSolidInLevel(lv, sx, sy)) return reachable;
    const queue = [idx(lv, sx, sy)];
    reachable[queue[0]] = 1;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      const x = current % lv.w;
      const y = Math.floor(current / lv.w);
      for (const [dx, dy] of FOUR_WAYS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(lv, nx, ny)) continue;
        const next = idx(lv, nx, ny);
        if (reachable[next] || isSolidInLevel(lv, nx, ny)) continue;
        reachable[next] = 1;
        queue.push(next);
      }
    }
    return reachable;
  }

  function nearestReachableFloor(lv, x, y, reachable) {
    const sx = clamp(Math.floor(x / TS), 0, lv.w - 1);
    const sy = clamp(Math.floor(y / TS), 0, lv.h - 1);
    const seen = new Uint8Array(lv.w * lv.h);
    const queue = [idx(lv, sx, sy)];
    seen[queue[0]] = 1;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      const tx = current % lv.w;
      const ty = Math.floor(current / lv.w);
      if (reachable[current] && lv.tiles[current] === FLOOR) {
        return { x: (tx + 0.5) * TS, y: (ty + 0.5) * TS };
      }
      for (const [dx, dy] of FOUR_WAYS) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (!inBounds(lv, nx, ny)) continue;
        const next = idx(lv, nx, ny);
        if (seen[next]) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    return { x: lv.spawn.x, y: lv.spawn.y };
  }

  function restoreTilesOnEntry(lv) {
    lv.tiles.set(lv.originalTiles);
    lv.stalagmites.clear();
    for (const key of lv.originalStalagmites) lv.stalagmites.add(key);
    lv.damage.clear();
    const reachable = reachableOnEntry(lv);
    const isReachable = (x, y) => {
      const tx = Math.floor(x / TS);
      const ty = Math.floor(y / TS);
      return inBounds(lv, tx, ty) && reachable[idx(lv, tx, ty)] === 1;
    };

    for (const pickup of lv.pickups) {
      if (pickup.phase !== 'ground' || isReachable(pickup.x, pickup.y)) continue;
      const safe = nearestReachableFloor(lv, pickup.x, pickup.y, reachable);
      pickup.x = pickup.originX = safe.x;
      pickup.y = pickup.originY = safe.y;
    }
    for (const prospector of lv.prospectors) {
      if (prospector.dead) continue;
      if (!isReachable(prospector.x, prospector.y) || collidesAt(prospector.x, prospector.y, prospector.r)) {
        const safe = nearestReachableFloor(lv, prospector.x, prospector.y, reachable);
        prospector.x = safe.x;
        prospector.y = safe.y;
        prospector.knockX = prospector.knockY = 0;
      }
      // Routes and partial NPC mining progress refer to the old terrain.
      prospector.oreTarget = null;
      prospector.mineProgress = 0;
      prospector.mineTick = 0;
      prospector.mining = false;
      prospector.scanTimer = 0;
      prospector.chasing = false;
      prospector.chaseRoute.length = 0;
      prospector.chaseRouteIndex = 0;
      prospector.chaseGoal = '';
      prospector.chasePathTimer = 0;
      prospector.stuckTime = 0;
    }
  }

  function enterLevel(id, message) {
    const prev = level;
    if (id === 'stage1' && !levels.stage1) levels.stage1 = buildStage1();
    if (id === 'stage2' && !levels.stage2) levels.stage2 = buildStage2();
    if (id === 'stage3' && !levels.stage3) levels.stage3 = buildStage3();
    if (id === 'stage4' && !levels.stage4) levels.stage4 = buildStage4();
    if (id === 'stage5' && !levels.stage5) levels.stage5 = buildStage5();
    if (id === 'stage6' && !levels.stage6) levels.stage6 = buildStage6();
    if (id === 'stage7' && !levels.stage7) levels.stage7 = buildStage7();
    if (id === 'special' && !levels.special) levels.special = buildSpecialCave();
    if (!levels[id]) return;
    if (prev && id !== prev.id) {
      // Finish items already flying toward the player before changing maps.
      // Anything that won't fit remains on its original floor, never deleted.
      settleFlyingPickups(prev);
      particles.length = 0;
      floaters.length = 0;
      melterBursts.length = 0;
      // Live projectiles cannot follow the player to another level.
      prev.dynamites.length = 0;
      prev.explosions.length = 0;
    }
    level = levels[id];

    if (!prev || id !== prev.id) {
      restoreTilesOnEntry(level);
      slimes.length = 0;
      moles.length = 0;
      spiders.length = 0;
      golems.length = 0;
      level.slimeTimer = 2.5;
      level.moleTimer = 1.8;
      level.spiderTimer = 1.8;
      level.golemTimer = 2;
      if (!level.prospectorTimer) level.prospectorTimer = 2.5;
    }

    let spawnX = level.spawn.x;
    let spawnY = level.spawn.y;

    // Coming upstairs places you beside the downward stairs you just used.
    // The secret seam closes again on re-entry, so return beside that seam.
    const exit = level.stairsDown || (prev && prev.id === 'special' ? level.secretTile : null);
    if (exit && (id === 'home' || (prev && prev.upTarget === id))) {
      spawnX = (exit.tx + 0.5) * TS;
      spawnY = (exit.ty - 0.6) * TS;
    }

    player.x = spawnX;
    player.y = spawnY;
    camera.x = player.x;
    camera.y = player.y;
    state.transitionLock = 0.6;

    showAreaName(level);
    if (message) showToast(message);
    else if (id === 'stage7' && prev && prev.id === 'stage6') showToast('A strange shimmer waits at the spiral\'s heart.');
    else clearToast();
    Sound.stairs();
  }

  /* ------------------------------------------------------- item collection */

  const PICKUP_RISE_TIME = 0.38;
  const PICKUP_FLIGHT_TIME = 0.55;

  // A pickup first pops upward, then arcs toward the moving player. Real drops
  // enter the bag on arrival; menu transfers have already been credited and
  // play the same visual once the menu is closed.
  function spawnPickup(item, count, x, y, options = {}) {
    if (!level || !ITEMS[item] || count <= 0) return null;
    if (options.alreadyCollected && state.mode === 'station') {
      const queued = level.pickups.find((p) => p.alreadyCollected && p.item === item &&
        p.phase === 'flying' && p.age === 0 && p.originX === x && p.originY === y);
      if (queued) {
        queued.count += count;
        return queued;
      }
    }
    const pickup = {
      item, count, x, y, originX: x, originY: y,
      phase: options.startOnGround ? 'ground' : 'flying', age: 0,
      delay: options.delay || 0,
      rise: options.rise || 30,
      source: options.source || 'other',
      alreadyCollected: !!options.alreadyCollected,
    };
    level.pickups.push(pickup);
    return pickup;
  }

  function finishPickup(pickup, quiet = false) {
    const left = pickup.alreadyCollected ? 0 : addItem(pickup.item, pickup.count);
    const received = pickup.count - left;
    if (pickup.source === 'mining') state.oreHauled += received;
    if (received > 0 && !quiet) {
      floaters.push({
        x: player.x,
        y: player.y - 30,
        text: '+' + received + ' ' + ITEMS[pickup.item].name,
        color: ITEMS[pickup.item].color,
        life: 0.95,
        maxLife: 0.95,
        vy: -34,
      });
      burst(player.x, player.y - 10, 6, [ITEMS[pickup.item].color, '#fff2ce'], 65, 0.38, 0.07);
      Sound.pickup();
    }
    if (left <= 0) return true;

    // If the bag fills before the animation ends, leave the remainder on the
    // ground. It will fly to the player again once there is room nearby.
    pickup.count = left;
    pickup.phase = 'ground';
    pickup.x = pickup.originX;
    pickup.y = pickup.originY;
    pickup.age = 0;
    pickup.delay = 0;
    if (!quiet) showToast('Bag full! Make room at the Storage Chest.');
    return false;
  }

  function settleFlyingPickups(lv) {
    if (!lv) return;
    for (let i = lv.pickups.length - 1; i >= 0; i--) {
      const pickup = lv.pickups[i];
      if (pickup.phase === 'flying' && finishPickup(pickup, true)) lv.pickups.splice(i, 1);
    }
  }

  function updatePickups(dt) {
    for (let i = level.pickups.length - 1; i >= 0; i--) {
      const p = level.pickups[i];
      if (p.phase === 'ground') {
        p.age += dt;
        if (inventorySpace(p.item) > 0 && Math.hypot(player.x - p.x, player.y - p.y) < 2.5 * TS) {
          p.phase = 'flying';
          p.originX = p.x;
          p.originY = p.y;
          p.rise = 20;
          p.age = 0;
        }
        continue;
      }

      p.age += dt;
      const elapsed = p.age - p.delay;
      if (elapsed < 0) continue;
      if (elapsed < PICKUP_RISE_TIME) {
        const t = elapsed / PICKUP_RISE_TIME;
        const easeOut = 1 - Math.pow(1 - t, 3);
        p.x = p.originX + Math.sin(t * Math.PI) * 3;
        p.y = p.originY - p.rise * easeOut;
      } else {
        const t = clamp((elapsed - PICKUP_RISE_TIME) / PICKUP_FLIGHT_TIME, 0, 1);
        const ease = t * t * (3 - 2 * t);
        p.x = lerp(p.originX, player.x, ease);
        p.y = lerp(p.originY - p.rise, player.y - 10, ease) - Math.sin(t * Math.PI) * 6;
        if (t >= 1 && finishPickup(p)) level.pickups.splice(i, 1);
      }
    }
  }

  function updateMelterBursts(dt) {
    for (let i = melterBursts.length - 1; i >= 0; i--) {
      melterBursts[i].age += dt;
      if (melterBursts[i].age >= melterBursts[i].duration) melterBursts.splice(i, 1);
    }
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
    if (state.mode !== 'playing') return;
    updateMoles(dt);
    if (state.mode !== 'playing') return;
    updateSpiders(dt);
    if (state.mode !== 'playing') return;
    updateGolems(dt);
    if (state.mode !== 'playing') return;
    updateProspectors(dt);
    if (state.mode !== 'playing') return;
    updateDynamites(dt);
    if (state.mode !== 'playing') return; // an enemy or explosion may end the run
    updatePickups(dt);
    updateMelterBursts(dt);
    updateParticles(dt);
    updateTransition(dt);
    updateAreaName(dt);
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
  function clearToast() {
    toastTimer = 0;
    el.toast.classList.remove('is-on');
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
    drawElevators(ox, oy);
    drawStations(ox, oy);
    drawDecor(ox, oy);
    drawSlimes(ox, oy);
    drawMoles(ox, oy);
    drawSpiders(ox, oy);
    drawGolems(ox, oy);
    drawProspectors(ox, oy);
    drawPlayer(ox, oy);
    drawParticles(ox, oy);
    drawFloaters(ox, oy);
    drawSwing(ox, oy);
    drawDarkness(ox, oy);
    drawGlow(ox, oy);
    drawDynamites(ox, oy);
    drawMelterBursts(ox, oy);
    drawPickups(ox, oy);
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

        if (t === FLOOR || t === WET) {
          drawFloor(x, y, tx, ty, h);
          if (t === WET) drawWetFloor(x, y, tx, ty, h);
          if (level.stalagmites.has(tileKey(tx, ty))) drawStalagmite(x, y, tx, ty);
        } else if (t === STAIRS_DOWN || t === STAIRS_UP) {
          drawFloor(x, y, tx, ty, h);
          drawStairs(x, y, t === STAIRS_DOWN);
          drawStairCaption(x, y, tx, ty, t === STAIRS_DOWN);
        } else if (t === WALL) {
          drawWall(x, y, h);
        } else {
          drawRock(x, y, tx, ty, t, h);
        }
      }
    }
  }

  function drawStairCaption(x, y, tx, ty, down) {
    if (Math.hypot(player.x - (tx + 0.5) * TS, player.y - (ty + 0.5) * TS) > 110) return;
    const target = down ? level.downTarget : level.upTarget;
    const name = { home: 'Home Base', stage1: 'Cave Entrance', stage2: 'Dreadful Tunnels',
      stage3: 'Auag Cavern', stage4: 'Stalag Cavern', stage5: 'Alumina Cave',
      stage6: 'Luscious Cave', stage7: 'Spiral Cavern', special: 'Special Cave' }[target];
    if (!name) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '800 10px ui-rounded, system-ui, sans-serif';
    ctx.fillStyle = down ? '#ffd28a' : '#bfe8f7';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 5;
    ctx.fillText(name, x + TS / 2, y + TS + 13);
    ctx.restore();
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
      ctx.fillStyle = level.id === 'stage6' ? (h > 0.5 ? '#294438' : '#21382f')
        : level.id === 'stage7' ? (h > 0.5 ? '#292737' : '#242333')
        : level.id === 'special' ? (h > 0.5 ? '#294149' : '#22363e')
        : level.id === 'stage5' ? (h > 0.5 ? '#302824' : '#292320')
        : level.id === 'stage4' ? (h > 0.5 ? '#202b2b' : '#1b2525')
        : (h > 0.5 ? '#1b2029' : '#191d25');
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

  function drawWetFloor(x, y, tx, ty, h) {
    ctx.fillStyle = h > 0.5 ? '#27696b' : '#225e62';
    ctx.fillRect(x + 1, y + 1, TS - 2, TS - 2);
    ctx.fillStyle = 'rgba(116, 210, 202, 0.19)';
    ctx.fillRect(x + 3, y + 3, TS - 6, 2);
    ctx.strokeStyle = 'rgba(171, 241, 221, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const ripple = Math.sin(state.time * 1.5 + hash2(tx, ty, 419) * TAU) * 2;
    ctx.ellipse(x + 16, y + 16, 6 + ripple, 2.5, 0, 0, Math.PI);
    ctx.stroke();
  }

  function drawStalagmite(x, y, tx, ty) {
    ctx.save();
    const variation = hash2(tx, ty, 231);
    const tip = y + 3 + variation * 3;
    // A shadow and three mineral spires, entirely on top of their floor tile.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.ellipse(x + 16, y + 26, 13, 4.5, 0, 0, TAU);
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = '#46554f';
    ctx.fillStyle = '#879c8f';
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 26); ctx.lineTo(x + 8, y + 12); ctx.lineTo(x + 13, y + 26);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 20, y + 27); ctx.lineTo(x + 25, y + 14); ctx.lineTo(x + 29, y + 26);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c4d3c4';
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 27); ctx.lineTo(x + 16, tip); ctx.lineTo(x + 24, y + 27);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#eaf0de';
    ctx.beginPath();
    ctx.moveTo(x + 16, tip); ctx.lineTo(x + 13, y + 24); ctx.lineTo(x + 16, y + 19);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(77, 105, 94, 0.48)';
    ctx.beginPath();
    ctx.moveTo(x + 16, tip); ctx.lineTo(x + 16, y + 25); ctx.lineTo(x + 23, y + 27);
    ctx.closePath(); ctx.fill();

    if (level.damage.get(tileKey(tx, ty))) {
      ctx.strokeStyle = '#4b6059';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x + 15, y + 15); ctx.lineTo(x + 18, y + 19); ctx.lineTo(x + 15, y + 23);
      ctx.stroke();
    }
    ctx.restore();
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
    } else if ([COBALT, QUARTZ, IRIDIUM, TITANIUM, MERCURY].includes(t)) {
      const palette = t === COBALT ? ['#244c9a', '#588de4', '#c7e5ff']
        : t === QUARTZ ? ['#a58eaf', '#dfcce9', '#fff8ff']
        : t === IRIDIUM ? ['#5c408d', '#a37cda', '#e1c9ff']
        : t === TITANIUM ? ['#526f79', '#a2c8d0', '#efffff']
        : ['#668e95', '#bedfe0', '#f7ffff'];
      for (let i = 0; i < 3; i++) {
        const a = hash2(tx * 7 + i, ty * 5 + i, 197);
        const b = hash2(tx * 5 + i, ty * 9 + i, 211);
        const nx = x + 7 + a * (TS - 14), ny = y + 7 + b * (TS - 14);
        const r = 3.7 + a * 1.7;
        ctx.fillStyle = palette[0];
        ctx.beginPath(); ctx.ellipse(nx + 0.5, ny + 1, r + 1, r * 0.8 + 1, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = palette[1];
        ctx.beginPath();
        if (t === MERCURY) ctx.ellipse(nx, ny, r, r * 0.72, 0, 0, TAU);
        else {
          ctx.moveTo(nx, ny - r - 1); ctx.lineTo(nx + r, ny - r * 0.1);
          ctx.lineTo(nx + r * 0.45, ny + r); ctx.lineTo(nx - r, ny + r * 0.45); ctx.closePath();
        }
        ctx.fill();
        ctx.fillStyle = palette[2];
        ctx.beginPath(); ctx.ellipse(nx - r * 0.3, ny - r * 0.35, r * 0.35, r * 0.22, -0.4, 0, TAU); ctx.fill();
      }
    } else if (t === BAUXITE) {
      // Reddish clay-like clusters are distinct from copper and iron.
      for (let i = 0; i < 3; i++) {
        const a = hash2(tx * 5 + i, ty * 7 + i, 173);
        const b = hash2(tx * 9 + i, ty * 3 + i, 179);
        const nx = x + 7 + a * (TS - 14), ny = y + 7 + b * (TS - 14);
        ctx.fillStyle = '#6d372f';
        ctx.beginPath(); ctx.ellipse(nx + 0.5, ny + 1, 5.5, 4.5, a, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c97559';
        ctx.beginPath(); ctx.ellipse(nx, ny, 4.4, 3.5, a, 0, TAU); ctx.fill();
        ctx.fillStyle = '#efb194';
        ctx.beginPath(); ctx.arc(nx - 1.2, ny - 1.2, 1.4, 0, TAU); ctx.fill();
      }
    } else if (t === GOLD || t === SILVER) {
      // Large bright metal facets: warm gold and almost-white silver are easy
      // to tell apart from copper's round nuggets and iron's blue diamonds.
      const dark = t === GOLD ? '#8a6322' : '#6e7983';
      const mid = t === GOLD ? '#e2a82e' : '#c5d1da';
      const light = t === GOLD ? '#ffed95' : '#f7fcff';
      for (let i = 0; i < 3; i++) {
        const a = hash2(tx * 7 + i, ty * 3 + i, 127);
        const b = hash2(tx * 5 + i, ty * 11 + i, 131);
        const nx = x + 7 + a * (TS - 14);
        const ny = y + 7 + b * (TS - 14);
        const r = 4 + b * 2;
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(nx - r, ny); ctx.lineTo(nx - r * 0.4, ny - r);
        ctx.lineTo(nx + r * 0.6, ny - r * 0.7); ctx.lineTo(nx + r, ny + r * 0.3);
        ctx.lineTo(nx, ny + r); ctx.closePath(); ctx.fill();
        ctx.fillStyle = mid;
        ctx.beginPath();
        ctx.moveTo(nx - r * 0.75, ny); ctx.lineTo(nx - r * 0.25, ny - r * 0.78);
        ctx.lineTo(nx + r * 0.55, ny - r * 0.5); ctx.lineTo(nx + r * 0.7, ny + r * 0.24);
        ctx.lineTo(nx, ny + r * 0.7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.moveTo(nx - r * 0.55, ny - r * 0.1); ctx.lineTo(nx - r * 0.18, ny - r * 0.65);
        ctx.lineTo(nx + r * 0.4, ny - r * 0.35); ctx.lineTo(nx - r * 0.05, ny);
        ctx.closePath(); ctx.fill();
      }
    } else if (t === IRON) {
      // Cool silver-blue, faceted deposits distinguish iron from grey stone.
      for (let i = 0; i < 3; i++) {
        const a = hash2(tx * 7 + i, ty * 5 + i, 103);
        const b = hash2(tx * 3 + i, ty * 11 + i, 109);
        const nx = x + 7 + a * (TS - 14);
        const ny = y + 7 + b * (TS - 14);
        const r = 3.6 + a * 1.8;
        ctx.fillStyle = '#202b34';
        ctx.beginPath();
        ctx.moveTo(nx, ny - r - 1); ctx.lineTo(nx + r + 1, ny);
        ctx.lineTo(nx + 1, ny + r + 1); ctx.lineTo(nx - r - 1, ny + 1);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#91b0be';
        ctx.beginPath();
        ctx.moveTo(nx, ny - r); ctx.lineTo(nx + r, ny);
        ctx.lineTo(nx, ny + r); ctx.lineTo(nx - r, ny);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e3f4f7';
        ctx.beginPath();
        ctx.moveTo(nx, ny - r); ctx.lineTo(nx + r * 0.7, ny - r * 0.05);
        ctx.lineTo(nx - r * 0.2, ny - r * 0.15);
        ctx.closePath(); ctx.fill();
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

    // The unusual Titanium seam is discoverable without revealing the cave.
    if (t === TITANIUM && level.secretTile && tx === level.secretTile.tx && ty === level.secretTile.ty) {
      ctx.save();
      const glow = 0.55 + Math.sin(state.time * 3) * 0.2;
      ctx.strokeStyle = `rgba(190, 250, 243, ${glow})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, TS - 4, TS - 4);
      ctx.fillStyle = '#e9fffb';
      ctx.beginPath(); ctx.moveTo(x + 25, y + 3); ctx.lineTo(x + 27, y + 8);
      ctx.lineTo(x + 31, y + 10); ctx.lineTo(x + 27, y + 12);
      ctx.lineTo(x + 25, y + 17); ctx.lineTo(x + 23, y + 12);
      ctx.lineTo(x + 19, y + 10); ctx.lineTo(x + 23, y + 8); ctx.closePath(); ctx.fill();
      if (Math.hypot(player.x - (tx + 0.5) * TS, player.y - (ty + 0.5) * TS) < 100) {
        ctx.textAlign = 'center'; ctx.font = '800 10px ui-rounded, system-ui, sans-serif';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 5; ctx.fillText('Shimmering Titanium', x + 16, y - 6);
      }
      ctx.restore();
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
      if (taken >= 2) {
        ctx.moveTo(x + 24, y + 4); ctx.lineTo(x + 19, y + 12); ctx.lineTo(x + 23, y + 24);
      }
      if (taken >= 4) {
        ctx.moveTo(x + 5, y + 24); ctx.lineTo(x + 12, y + 18); ctx.lineTo(x + 7, y + 14);
      }
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

  function drawElevators(ox, oy) {
    for (const lift of level.elevators) {
      const x = lift.x + ox, y = lift.y + oy;
      if (x < -70 || y < -90 || x > W + 70 || y > H + 70) continue;
      const powered = state.elevatorUnlocked;
      const ready = !powered && level.id === 'stage7';
      const near = Math.hypot(player.x - lift.x, player.y - lift.y) <= 2.5 * TS;
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath(); ctx.ellipse(x, y + 16, 21, 6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#29353b'; ctx.fillRect(x - 19, y - 25, 38, 42);
      ctx.fillStyle = '#647a7b'; ctx.fillRect(x - 17, y - 23, 34, 36);
      ctx.fillStyle = powered ? '#345e5b' : '#39494b'; ctx.fillRect(x - 14, y - 20, 28, 32);
      ctx.fillStyle = powered ? '#4d8179' : '#4b5a5b';
      ctx.fillRect(x - 12, y - 18, 11, 28); ctx.fillRect(x + 1, y - 18, 11, 28);
      ctx.fillStyle = 'rgba(231, 245, 224, 0.24)'; ctx.fillRect(x - 10, y - 16, 2, 24); ctx.fillRect(x + 3, y - 16, 2, 24);
      ctx.fillStyle = '#18272b'; ctx.fillRect(x - 18, y - 29, 36, 7);
      ctx.fillStyle = powered ? '#8cedbd' : ready ? '#ffc861' : '#a97956';
      ctx.fillRect(x - 5, y - 27, 10, 3);
      ctx.fillStyle = '#b8b5a1'; ctx.fillRect(x - 18, y + 11, 36, 4);
      ctx.strokeStyle = powered ? '#c8fff0' : '#d4bd90'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x, y - 6); ctx.lineTo(x + 3, y - 3);
      ctx.moveTo(x - 3, y + 2); ctx.lineTo(x, y + 5); ctx.lineTo(x + 3, y + 2); ctx.stroke();
      ctx.textAlign = 'center'; ctx.font = '800 10px ui-rounded, system-ui, sans-serif';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 5;
      ctx.fillStyle = powered ? '#b8f5dc' : ready ? '#ffda97' : '#cbb8a0';
      const label = near ? (ready ? 'Reactivate · click / F' : powered ? 'Elevator · click / F' : 'Elevator offline · click')
        : powered ? 'Elevator' : 'Elevator · offline';
      ctx.fillText(label, x, y - 35);
      ctx.restore();
    }
  }

  function drawStations(ox, oy) {
    if (!level.stations) return;

    for (const st of level.stations) {
      const x = st.x + ox;
      const y = st.y + oy;
      const near = Math.hypot(player.x - st.x, player.y - st.y) < 100;
      const pulse = 0.75 + Math.sin(state.time * 3) * 0.25;

      // shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(x + 2, y + 16, 20, 7, 0, 0, TAU);
      ctx.fill();

      if (st.kind === 'melter') {
        // squat furnace with a glowing mouth
        const body = ctx.createLinearGradient(0, y - 24, 0, y + 16);
        body.addColorStop(0, '#6b6259');
        body.addColorStop(1, '#3b3630');
        ctx.fillStyle = body;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x - 17, y - 22, 34, 38, 7);
          ctx.fill();
        } else {
          ctx.fillRect(x - 17, y - 22, 34, 38);
        }

        // brick lines
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.32)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(x - 17, y - 22 + i * 13);
          ctx.lineTo(x + 17, y - 22 + i * 13);
          ctx.stroke();
        }

        // chimney
        ctx.fillStyle = '#4a443d';
        ctx.fillRect(x + 4, y - 32, 9, 12);

        // molten mouth
        const mouth = ctx.createRadialGradient(x, y + 2, 1, x, y + 2, 13);
        mouth.addColorStop(0, `rgba(255, 224, 150, ${pulse})`);
        mouth.addColorStop(0.5, 'rgba(255, 150, 45, 0.85)');
        mouth.addColorStop(1, 'rgba(150, 50, 10, 0.25)');
        ctx.fillStyle = mouth;
        ctx.beginPath();
        ctx.ellipse(x, y + 2, 11, 8, 0, 0, TAU);
        ctx.fill();

        // copper spout
        ctx.fillStyle = '#c98a52';
        ctx.fillRect(x + 13, y - 4, 8, 4);
      } else if (st.kind === 'forge') {
        // forge: anvil over a fire
        ctx.fillStyle = '#3a3630';
        ctx.fillRect(x - 14, y + 8, 28, 8); // base
        ctx.fillRect(x - 8, y + 2, 16, 7); // waist
        ctx.fillStyle = '#565049';
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x - 18, y - 8, 36, 11, 4);
          ctx.fill();
        } else {
          ctx.fillRect(x - 18, y - 8, 36, 11);
        }

        // fire beneath
        for (let i = 0; i < 3; i++) {
          const fl = Math.sin(state.time * 7 + i * 1.7) * 0.3 + 0.7;
          ctx.fillStyle = i === 1 ? `rgba(255, 210, 110, ${0.85 * fl})` : `rgba(255, 130, 40, ${0.7 * fl})`;
          ctx.beginPath();
          ctx.moveTo(x - 9 + i * 9, y + 15);
          ctx.quadraticCurveTo(x - 5 + i * 9, y + 2 - fl * 5, x + 18 - i * 9 - 9, y + 15);
          ctx.fill();
        }

        // sparks
        for (let i = 0; i < 2; i++) {
          const t = (state.time * 0.9 + i * 0.5) % 1;
          ctx.fillStyle = `rgba(255, 200, 120, ${(1 - t) * 0.8})`;
          ctx.fillRect(x - 6 + i * 12 + Math.sin(t * 9) * 4, y - t * 22, 2, 2);
        }
      } else if (st.kind === 'storage') {
        // A banded wooden chest, distinct from the decorative crates.
        const wood = ctx.createLinearGradient(0, y - 15, 0, y + 15);
        wood.addColorStop(0, '#9b6737');
        wood.addColorStop(1, '#50331f');
        ctx.fillStyle = wood;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - 21, y - 13, 42, 28, 5);
        else ctx.rect(x - 21, y - 13, 42, 28);
        ctx.fill();
        ctx.fillStyle = '#b28048';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - 22, y - 18, 44, 15, 5);
        else ctx.rect(x - 22, y - 18, 44, 15);
        ctx.fill();
        ctx.fillStyle = 'rgba(45, 26, 15, 0.75)';
        ctx.fillRect(x - 21, y - 4, 42, 3);
        ctx.fillStyle = '#624b36';
        ctx.fillRect(x - 14, y - 17, 4, 31);
        ctx.fillRect(x + 10, y - 17, 4, 31);
        ctx.fillStyle = '#d9ae67';
        ctx.fillRect(x - 4, y - 5, 8, 8);
        ctx.fillStyle = '#634425';
        ctx.fillRect(x - 1, y - 2, 2, 3);
        ctx.fillStyle = 'rgba(255, 221, 163, 0.34)';
        ctx.fillRect(x - 18, y - 15, 7, 2);
      } else if (st.kind === 'press') {
        // A compact iron screw press, with a coin waiting on its bed.
        ctx.fillStyle = '#4c4540';
        ctx.fillRect(x - 20, y + 9, 40, 8);
        ctx.fillStyle = '#77746c';
        ctx.fillRect(x - 18, y - 19, 6, 28);
        ctx.fillRect(x + 12, y - 19, 6, 28);
        ctx.fillStyle = '#a19b8a';
        ctx.fillRect(x - 20, y - 23, 40, 6);
        ctx.fillStyle = '#c1b395';
        ctx.fillRect(x - 2, y - 30, 4, 18);
        ctx.fillRect(x - 11, y - 31, 22, 3);
        ctx.fillStyle = '#696e6b';
        ctx.fillRect(x - 10, y - 13, 20, 6);
        ctx.fillStyle = '#e5b357';
        ctx.beginPath(); ctx.ellipse(x, y + 5, 9, 4, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#ffe4a2'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(x, y + 4, 6, 2.5, 0, 0, TAU); ctx.stroke();
      } else if (st.kind === 'trader') {
        // The trader stands behind a little coin-covered market counter.
        ctx.fillStyle = '#554535';
        ctx.beginPath(); ctx.arc(x, y - 12, 14, Math.PI, 0); ctx.lineTo(x + 14, y + 6); ctx.lineTo(x - 14, y + 6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#d4ac83';
        ctx.beginPath(); ctx.arc(x, y - 11, 8, 0, TAU); ctx.fill();
        ctx.fillStyle = '#35302d';
        ctx.beginPath(); ctx.arc(x - 3, y - 12, 1, 0, TAU); ctx.arc(x + 3, y - 12, 1, 0, TAU); ctx.fill();
        ctx.fillStyle = '#825b38'; ctx.fillRect(x - 21, y + 2, 42, 14);
        ctx.fillStyle = '#bd8951'; ctx.fillRect(x - 22, y, 44, 5);
        ctx.fillStyle = '#ebbd5d';
        ctx.beginPath(); ctx.ellipse(x - 10, y + 1, 5, 2.6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#cfdbe0';
        ctx.beginPath(); ctx.ellipse(x + 10, y + 1, 5, 2.6, 0, 0, TAU); ctx.fill();
      }

      // label, brightening as you get close
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '800 10px ui-rounded, "Segoe UI Rounded", system-ui, sans-serif';
      ctx.fillStyle = near ? `rgba(255, 210, 130, ${0.75 + pulse * 0.25})` : 'rgba(180, 195, 210, 0.5)';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 6;
      ctx.fillText(near ? STATION_LABELS[st.kind] + ' — click' : STATION_LABELS[st.kind], x, y + 34);
      ctx.restore();
    }
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
      } else if (d.kind === 'fern') {
        ctx.strokeStyle = '#5e9b76'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y + 9); ctx.lineTo(x, y - 8); ctx.stroke();
        for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i === 1 ? '#79b68a' : '#4f916d';
          ctx.beginPath(); ctx.ellipse(x + side * (4 + i), y + 3 - i * 5, 5, 2.2, side * 0.5, 0, TAU); ctx.fill();
        }
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

      // Hop: lift off the ground, stretching up as it leaves and squashing
      // as it lands. The shadow stays put and shrinks, which sells the bounce.
      const lift = s.hopGround;
      const rx = s.r * (1 - 0.13 * lift);
      const ry = s.r * (1 + 0.16 * lift);
      const hopY = y - lift * s.r * 0.62;

      ctx.fillStyle = `rgba(0, 0, 0, ${0.42 - 0.2 * lift})`;
      ctx.beginPath();
      ctx.ellipse(x + 1, y + s.r * 0.78, s.r * (0.85 - 0.3 * lift), s.r * (0.3 - 0.08 * lift), 0, 0, TAU);
      ctx.fill();

      // body
      const g = ctx.createRadialGradient(x - rx * 0.3, hopY - ry * 0.4, rx * 0.15, x, hopY, rx * 1.2);
      g.addColorStop(0, shade(s.color, 1.45));
      g.addColorStop(0.6, s.color);
      g.addColorStop(1, shade(s.color, 0.6));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, hopY, rx, ry, 0, 0, TAU);
      ctx.fill();

      // a little pair of nubs for feet, tucked up while airborne
      ctx.fillStyle = shade(s.color, 0.75);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(
          x + side * rx * 0.4,
          y + s.r * 0.6 - lift * s.r * 0.25,
          s.r * 0.16,
          s.r * 0.1,
          0, 0, TAU
        );
        ctx.fill();
      }

      // gel highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.beginPath();
      ctx.ellipse(x - rx * 0.3, hopY - ry * 0.45, rx * 0.22, ry * 0.16, -0.5, 0, TAU);
      ctx.fill();

      // eyes
      const ex = rx * 0.3;
      ctx.fillStyle = '#1a2418';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(x + side * ex, hopY - ry * 0.12, rx * 0.12, ry * 0.17, 0, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + side * ex + rx * 0.04, hopY - ry * 0.2, rx * 0.045, 0, TAU);
        ctx.fill();
      }

      if (s.tropical) {
        // Dark sunglasses with a tiny glint make the peaceful blue slimes
        // recognizable even when they split into smaller offspring.
        ctx.fillStyle = '#132737';
        ctx.beginPath(); ctx.ellipse(x - rx * 0.32, hopY - ry * 0.12, rx * 0.27, ry * 0.2, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + rx * 0.32, hopY - ry * 0.12, rx * 0.27, ry * 0.2, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#223c49'; ctx.lineWidth = Math.max(1, s.r * 0.1);
        ctx.beginPath(); ctx.moveTo(x - rx * 0.07, hopY - ry * 0.13); ctx.lineTo(x + rx * 0.07, hopY - ry * 0.13); ctx.stroke();
        ctx.fillStyle = 'rgba(200, 244, 255, 0.75)';
        ctx.fillRect(x - rx * 0.43, hopY - ry * 0.22, rx * 0.12, ry * 0.05);
        ctx.fillRect(x + rx * 0.22, hopY - ry * 0.22, rx * 0.12, ry * 0.05);
      }

      // hit flash
      if (s.flash > 0) {
        ctx.globalAlpha = clamp(s.flash / 0.16, 0, 1) * 0.75;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(x, hopY, rx, ry, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // damage taken
      if (s.hp < s.maxHp) {
        const w = s.r * 1.8;
        const pct = clamp(s.hp / s.maxHp, 0, 1);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(x - w / 2, hopY - s.r - 11, w, 3.4);
        ctx.fillStyle = pct > 0.5 ? '#8ce09a' : pct > 0.25 ? '#ffd166' : '#ff7a7a';
        ctx.fillRect(x - w / 2, hopY - s.r - 11, w * pct, 3.4);
      }
    }
  }

  function drawGolems(ox, oy) {
    for (const golem of golems) {
      if (golem.dead) continue;
      const x = golem.x + ox, y = golem.y + oy;
      if (x < -80 || y < -80 || x > W + 80 || y > H + 80) continue;
      const disabled = golem.disabled > 0;
      ctx.fillStyle = 'rgba(0,0,0,0.48)';
      ctx.beginPath(); ctx.ellipse(x + 2, y + 18, 24, 9, 0, 0, TAU); ctx.fill();
      if (disabled) {
        ctx.strokeStyle = 'rgba(163, 214, 232, 0.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y + 15, 27, 12, 0, 0, TAU); ctx.stroke();
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(golem.facing + Math.PI / 2);
      const stride = disabled ? 0 : Math.sin(golem.walk) * 2;
      // Arms and feet are separate rounded boulders around a wide torso.
      ctx.fillStyle = golem.mercury ? '#405c63' : '#514c49';
      ctx.beginPath(); ctx.ellipse(-13, 16 + stride, 9, 8, -0.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(13, 16 - stride, 9, 8, 0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = golem.mercury ? (disabled ? '#78949a' : '#82afb5') : disabled ? '#777e7e' : '#86776a';
      ctx.beginPath(); ctx.ellipse(-20, 1 + stride, 9, 14, -0.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(20, 1 - stride, 9, 14, 0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = golem.flash > 0 ? (golem.mercury ? '#f2ffff' : '#e4d9ca') : golem.mercury ? (disabled ? '#a7bdc1' : '#b6d9db') : disabled ? '#929b9a' : '#aa9987';
      ctx.beginPath();
      ctx.moveTo(-17, -13); ctx.lineTo(-11, -20); ctx.lineTo(12, -20);
      ctx.lineTo(18, -11); ctx.lineTo(16, 13); ctx.lineTo(9, 19);
      ctx.lineTo(-12, 18); ctx.lineTo(-18, 10); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = golem.mercury ? '#6296a0' : '#554f4a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-13, -10); ctx.lineTo(-6, -4); ctx.lineTo(-9, 4);
      ctx.moveTo(11, -14); ctx.lineTo(6, -7); ctx.lineTo(10, 0); ctx.stroke();
      if (golem.mercury) {
        ctx.strokeStyle = 'rgba(247,255,255,0.65)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-13, 7); ctx.quadraticCurveTo(0, 3, 13, 7); ctx.stroke();
      }
      ctx.fillStyle = golem.mercury ? '#5e878e' : '#615b56';
      ctx.beginPath(); ctx.ellipse(0, -13, 12, 9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = disabled ? '#bac9c9' : golem.mercury ? '#a5f4fa' : '#ffbf79';
      ctx.fillRect(-8, -15, 5, 2.5); ctx.fillRect(3, -15, 5, 2.5);
      ctx.restore();
      if (golem.hp < golem.maxHp) {
        const width = 42, pct = clamp(golem.hp / golem.maxHp, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(x - width / 2, y - 36, width, 4);
        ctx.fillStyle = golem.mercury ? '#9bdfe4' : '#df9b6e'; ctx.fillRect(x - width / 2, y - 36, width * pct, 4);
      }
      if (Math.hypot(player.x - golem.x, player.y - golem.y) < 150 || disabled) {
        ctx.save(); ctx.textAlign = 'center';
        ctx.font = '800 10px ui-rounded, system-ui, sans-serif';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 5;
        ctx.fillStyle = disabled ? '#c9ecf6' : golem.mercury ? '#cbf6f4' : '#ead0b4';
        const name = golem.mercury ? 'Mercury Golem' : 'Golem';
        ctx.fillText(disabled ? `${name} · disabled` : name, x, y - (golem.hp < golem.maxHp ? 42 : 34));
        ctx.restore();
      }
    }
  }

  function drawSpiders(ox, oy) {
    for (const spider of spiders) {
      if (spider.dead) continue;
      const x = spider.x + ox, y = spider.y + oy;
      if (x < -50 || x > W + 50 || y < -50 || y > H + 50) continue;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.46)';
      ctx.beginPath();
      ctx.ellipse(x, y + 9, 14, 4.5, 0, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(spider.facing + Math.PI / 2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Four pairs of jointed legs scuttle alternately as the spider moves.
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const sy = -6 + i * 4;
          const twitch = Math.sin(spider.walk + i * 1.8 + (side < 0 ? Math.PI : 0)) * 2.5;
          ctx.strokeStyle = '#241b2a';
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.moveTo(side * 4, sy);
          ctx.lineTo(side * (11 + twitch * 0.4), sy - 3 + twitch);
          ctx.lineTo(side * 16, sy + 3 + twitch);
          ctx.stroke();
          ctx.strokeStyle = '#8d6b79';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#392b3d';
      ctx.beginPath(); ctx.ellipse(0, 3, 8.5, 10, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#6d5065';
      ctx.beginPath(); ctx.ellipse(-1.5, 1, 5.8, 7.2, -0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#312438';
      ctx.beginPath(); ctx.ellipse(0, -6, 6, 5.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = spider.bite > 0 ? '#ffedaa' : '#f49b86';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.arc(side * 2.8, -8, 1.35, 0, TAU); ctx.fill();
      }
      if (spider.flash > 0) {
        ctx.globalAlpha = clamp(spider.flash / 0.16, 0, 1) * 0.7;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(0, 1, 8.5, 11, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
      if (spider.hp < spider.maxHp) {
        const width = 25, pct = clamp(spider.hp / spider.maxHp, 0, 1);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'; ctx.fillRect(x - width / 2, y - 19, width, 3);
        ctx.fillStyle = pct > 0.5 ? '#8ce09a' : '#ff9a7d'; ctx.fillRect(x - width / 2, y - 19, width * pct, 3);
      }
    }
  }

  function drawMoles(ox, oy) {
    for (const mole of moles) {
      if (mole.dead) continue;
      const x = mole.x + ox;
      const y = mole.y + oy;
      if (x < -70 || x > W + 70 || y < -70 || y > H + 70) continue;

      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(x + 1, y + 11, 15, 5, 0, 0, TAU);
      ctx.fill();
      if (mole.inWall) {
        // A dusty ring makes it clear that the mole is burrowing through rock.
        ctx.strokeStyle = 'rgba(206, 187, 154, 0.45)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.ellipse(x, y, 19, 15, mole.drillSpin * 0.1, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.translate(x, y + Math.sin(mole.drillSpin * 0.4) * 1.2);
      ctx.rotate(mole.angle);

      // Little ears and digging paws around a rounded, brown body.
      ctx.fillStyle = '#70503f';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(-8, side * 8, 5, 4.5, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#c99b89';
        ctx.beginPath();
        ctx.ellipse(-8, side * 8, 2.4, 2.2, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#70503f';
      }
      ctx.fillStyle = '#c39b7d';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(2, side * 10, 5.5, 3.2, side * 0.35, 0, TAU);
        ctx.fill();
      }
      const fur = ctx.createRadialGradient(-5, -4, 1, -2, 0, 17);
      fur.addColorStop(0, '#c7a081');
      fur.addColorStop(0.58, '#916d55');
      fur.addColorStop(1, '#5a4034');
      ctx.fillStyle = fur;
      ctx.beginPath();
      ctx.ellipse(-2, 0, 15, 11, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#1c1716';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.arc(5, side * 5, 1.7, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.arc(5.4, side * 5 - 0.5, 0.55, 0, TAU); ctx.fill();
      }

      // A rotating silver drill for a snout, visible even inside a block.
      const metal = ctx.createLinearGradient(9, -7, 9, 7);
      metal.addColorStop(0, '#f1fafb');
      metal.addColorStop(0.45, '#a8c5cf');
      metal.addColorStop(1, '#506b79');
      ctx.fillStyle = metal;
      ctx.strokeStyle = '#31434a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(10, -7); ctx.lineTo(26, 0); ctx.lineTo(10, 7);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(64, 91, 102, 0.75)';
      ctx.lineWidth = 1.2;
      const shift = (mole.drillSpin * 1.4) % 4;
      for (let i = 0; i < 3; i++) {
        const sx = 11 + i * 4 + shift;
        const half = Math.max(0.5, 6 * (26 - sx) / 16);
        ctx.beginPath(); ctx.moveTo(sx, -half); ctx.lineTo(sx + 2, half * 0.8); ctx.stroke();
      }
      if (mole.flash > 0) {
        ctx.globalAlpha = clamp(mole.flash / 0.16, 0, 1) * 0.7;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(-2, 0, 15, 11, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();

      if (mole.hp < mole.maxHp) {
        const w = mole.r * 1.9;
        const pct = clamp(mole.hp / mole.maxHp, 0, 1);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(x - w / 2, y - mole.r - 11, w, 3.4);
        ctx.fillStyle = pct > 0.5 ? '#8ce09a' : pct > 0.25 ? '#ffd166' : '#ff7a7a';
        ctx.fillRect(x - w / 2, y - mole.r - 11, w * pct, 3.4);
      }
      if (Math.hypot(player.x - mole.x, player.y - mole.y) < 110) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '800 9px ui-rounded, system-ui, sans-serif';
        ctx.fillStyle = '#e4c6aa';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 5;
        ctx.fillText('Drill Mole', x, y - mole.r - (mole.hp < mole.maxHp ? 17 : 9));
        ctx.restore();
      }
    }
  }

  function drawProspectors(ox, oy) {
    for (const prospector of level.prospectors) {
      if (prospector.dead) continue;
      const x = prospector.x + ox;
      const y = prospector.y + oy;
      if (x < -70 || x > W + 70 || y < -70 || y > H + 70) continue;
      const stride = Math.sin(prospector.walk) * 1.7;

      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath(); ctx.ellipse(x + 1, y + 11, 13, 5, 0, 0, TAU); ctx.fill();
      ctx.translate(x, y);

      // Pack and boots give this miner a distinct silhouette from the player.
      ctx.fillStyle = '#59402b';
      ctx.fillRect(-13, -7, 10, 15);
      ctx.strokeStyle = '#a67b46'; ctx.lineWidth = 1.2;
      ctx.strokeRect(-12, -6, 8, 13);
      ctx.fillStyle = '#443329';
      ctx.fillRect(-7, 7 + stride, 5, 6);
      ctx.fillRect(2, 7 - stride, 5, 6);
      ctx.fillStyle = prospector.flash > 0 ? '#f7dfbc' : '#806447';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-8, -7, 16, 17, 5);
      else ctx.rect(-8, -7, 16, 17);
      ctx.fill();
      ctx.fillStyle = '#503d31'; ctx.fillRect(-7, 3, 14, 3);
      ctx.fillStyle = '#e7c16c'; ctx.fillRect(-1, 3, 3, 3);

      // Face, beard and a broad prospector's hat.
      ctx.fillStyle = '#dfb18c';
      ctx.beginPath(); ctx.arc(0, -10, 7.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#684a35';
      ctx.beginPath(); ctx.arc(0, -7.8, 5.1, 0.1, Math.PI - 0.1); ctx.fill();
      ctx.fillStyle = '#241c19';
      ctx.beginPath(); ctx.arc(-2.7, -10.3, 0.8, 0, TAU); ctx.arc(2.7, -10.3, 0.8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#563929'; ctx.fillRect(-9.5, -17, 19, 3.4);
      ctx.fillStyle = '#82603d';
      ctx.beginPath();
      ctx.moveTo(-6.5, -17); ctx.lineTo(-5, -22); ctx.lineTo(5, -22); ctx.lineTo(6.5, -17);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d9ab60'; ctx.fillRect(-5.8, -17.8, 11.6, 1.8);

      // The pickaxe follows the target and swings while mining or attacking.
      const swing = prospector.swingTime > 0 ? Math.sin((1 - prospector.swingTime / 0.3) * Math.PI) * 0.8 : 0;
      ctx.save();
      ctx.translate(3, 0);
      ctx.rotate(prospector.facing + 0.35 - swing);
      ctx.strokeStyle = '#9f7246'; ctx.lineWidth = 2.8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(17, 0); ctx.stroke();
      ctx.strokeStyle = '#d7e2e8'; ctx.lineWidth = 2.7;
      ctx.beginPath(); ctx.moveTo(16, -7); ctx.quadraticCurveTo(22, 0, 16, 7); ctx.stroke();
      ctx.restore();

      if (prospector.haul.gold + prospector.haul.silver > 0) {
        ctx.fillStyle = prospector.haul.gold ? '#ffdc6a' : '#e9f3f7';
        ctx.beginPath(); ctx.arc(-9, -3, 2, 0, TAU); ctx.fill();
      }
      ctx.restore();

      if (prospector.hp < prospector.maxHp) {
        const width = 25;
        const percent = clamp(prospector.hp / prospector.maxHp, 0, 1);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x - width / 2, y - 30, width, 3.5);
        ctx.fillStyle = percent > 0.5 ? '#8ce09a' : percent > 0.25 ? '#ffd166' : '#ff7a7a';
        ctx.fillRect(x - width / 2, y - 30, width * percent, 3.5);
      }
      if (Math.hypot(player.x - prospector.x, player.y - prospector.y) < 140) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '800 9px ui-rounded, system-ui, sans-serif';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 5;
        ctx.fillStyle = prospector.chasing ? '#ff9d85' : '#ead4a8';
        ctx.fillText(prospector.chasing ? 'Prospector !' : 'Prospector', x, y - (prospector.hp < prospector.maxHp ? 36 : 28));
        ctx.restore();
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

    // The lush oasis and mercury grotto have a little more ambient light,
    // while keeping the same dungeon atmosphere and player lantern.
    lctx.globalCompositeOperation = 'source-over';
    lctx.fillStyle = level.isBase ? 'rgba(4, 7, 12, 0.5)'
      : level.id === 'stage6' ? 'rgba(3, 12, 10, 0.7)'
      : level.id === 'special' ? 'rgba(3, 9, 13, 0.76)'
      : 'rgba(3, 5, 10, 0.88)';
    lctx.fillRect(0, 0, W, H);

    lctx.globalCompositeOperation = 'destination-out';
    punch(player.x + ox, player.y + oy, 320, 0.95);
    for (const d of level.decor) {
      if (d.kind === 'lantern') punch(d.x + ox, d.y - 7 + oy, 165, 0.72);
    }
    for (const lift of level.elevators) {
      punch(lift.x + ox, lift.y - 8 + oy, 110, state.elevatorUnlocked || level.id === 'stage7' ? 0.55 : 0.3);
    }
    if (level.stairsDown) punch((level.stairsDown.tx + 0.5) * TS + ox, (level.stairsDown.ty + 0.5) * TS + oy, 130, 0.6);

    ctx.drawImage(lightCanvas, 0, 0);
  }

  function punch(cx, cy, radius, strength) {
    if (cx + radius < 0 || cy + radius < 0 || cx - radius > W || cy - radius > H) return;
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
      if (x + 110 < 0 || y + 110 < 0 || x - 110 > W || y - 110 > H) continue;
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

  function drawDynamites(ox, oy) {
    for (const dynamite of level.dynamites) {
      const progress = clamp((dynamite.age - BALANCE.dynamiteFlight) / BALANCE.dynamiteFuse, 0, 1);
      const tx = Math.floor(dynamite.targetX / TS);
      const ty = Math.floor(dynamite.targetY / TS);
      const targetX = tx * TS + ox;
      const targetY = ty * TS + oy;
      const pulse = 0.16 + 0.12 * Math.abs(Math.sin(dynamite.age * 12));
      ctx.save();
      // A red landing tile and subtle four-tile outline telegraph the blast.
      ctx.fillStyle = `rgba(255, 55, 34, ${pulse})`;
      ctx.fillRect(targetX, targetY, TS, TS);
      ctx.strokeStyle = 'rgba(255, 111, 74, 0.9)'; ctx.lineWidth = 1.6;
      ctx.strokeRect(targetX + 1, targetY + 1, TS - 2, TS - 2);
      ctx.strokeStyle = 'rgba(255, 111, 74, 0.28)'; ctx.lineWidth = 1;
      ctx.setLineDash([5, 7]);
      ctx.strokeRect(targetX - 4 * TS, targetY - 4 * TS, 9 * TS, 9 * TS);
      ctx.setLineDash([]);

      const flight = clamp(dynamite.age / BALANCE.dynamiteFlight, 0, 1);
      const x = dynamite.x + ox;
      const y = dynamite.y + oy - Math.sin(flight * Math.PI) * 20;
      ctx.translate(x, y);
      ctx.rotate(-0.3 + flight * 0.8);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath(); ctx.ellipse(1, 6, 7, 3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#a62625';
      ctx.fillRect(-7, -5, 14, 9);
      ctx.fillStyle = '#e64b36'; ctx.fillRect(-6, -4, 12, 3);
      ctx.fillStyle = '#75201c'; ctx.fillRect(-2, -5, 3, 9);
      ctx.strokeStyle = '#c4a579'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(6, -4); ctx.quadraticCurveTo(9, -9, 11, -9); ctx.stroke();
      ctx.fillStyle = progress > 0.65 ? '#fff5b3' : '#ffd15f';
      ctx.beginPath(); ctx.arc(11, -9, 2 + progress, 0, TAU); ctx.fill();
      ctx.restore();
    }

    for (const explosion of level.explosions) {
      const t = clamp(explosion.age / explosion.duration, 0, 1);
      const x = explosion.x + ox;
      const y = explosion.y + oy;
      const radius = 18 + t * 100;
      ctx.save();
      ctx.globalAlpha = Math.pow(1 - t, 1.4);
      const glow = ctx.createRadialGradient(x, y, 1, x, y, radius);
      glow.addColorStop(0, '#fff8d0');
      glow.addColorStop(0.28, '#ffd06b');
      glow.addColorStop(0.62, '#fa6b35');
      glow.addColorStop(1, 'rgba(212, 60, 30, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffe8a1'; ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath(); ctx.arc(x, y, radius * 0.8, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  function drawMelterBursts(ox, oy) {
    for (const fire of melterBursts) {
      const t = clamp(fire.age / fire.duration, 0, 1);
      const envelope = t < 0.16 ? t / 0.16 : Math.pow((1 - t) / 0.84, 0.6);
      if (envelope <= 0) continue;
      const x = fire.x + ox;
      const y = fire.y + oy;
      const height = 96 * envelope * (0.94 + Math.sin(fire.age * 30) * 0.06);
      const width = 36 * (0.45 + envelope * 0.55);
      const lean = Math.sin(fire.age * 18) * width * 0.15;

      ctx.save();
      ctx.globalAlpha = envelope;
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(x, y - height * 0.4, 0, x, y - height * 0.4, Math.max(1, height * 1.15));
      glow.addColorStop(0, 'rgba(255, 167, 42, 0.38)');
      glow.addColorStop(1, 'rgba(255, 75, 12, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y - height * 0.4, Math.max(1, height * 1.15), 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // Three curved tongues make the burst feel like flame, not a flat flash.
      const tongue = (w, h, color, sway) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - w * 0.48, y + 2);
        ctx.bezierCurveTo(x - w * 0.72, y - h * 0.28, x - w * 0.44, y - h * 0.57, x + sway, y - h);
        ctx.bezierCurveTo(x + w * 0.16, y - h * 0.6, x + w * 0.72, y - h * 0.4, x + w * 0.47, y + 2);
        ctx.quadraticCurveTo(x, y + 7, x - w * 0.48, y + 2);
        ctx.fill();
      };
      tongue(width, height, '#e84b1b', lean);
      tongue(width * 0.74, height * 0.76, '#ff9a26', -lean * 0.6);
      tongue(width * 0.4, height * 0.48, '#fff0a0', lean * 0.3);

      for (let i = 0; i < 9; i++) {
        const s = (fire.age * 0.85 + i / 9) % 1;
        const sx = x + (i - 4) * 5 + Math.sin(s * 8 + i) * 5;
        const sy = y - s * (height + 20);
        ctx.globalAlpha = envelope * (1 - s);
        ctx.fillStyle = i % 2 ? '#ffd76d' : '#ff8c33';
        ctx.fillRect(sx, sy, 2.5, 2.5);
      }
      ctx.restore();
    }
  }

  function drawPickups(ox, oy) {
    for (const p of level.pickups) {
      if (p.phase === 'flying' && p.age < p.delay) continue;
      const x = p.x + ox;
      const y = p.y + oy + (p.phase === 'ground' ? Math.sin(state.time * 4) * 2 : 0);
      const end = p.phase === 'flying'
        ? clamp((p.age - p.delay - PICKUP_RISE_TIME) / PICKUP_FLIGHT_TIME, 0, 1) : 0;
      const scale = 1 - end * 0.2;
      const color = ITEMS[p.item].color;

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = 0.48;
      const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 19);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
      ctx.shadowBlur = 5;
      ctx.strokeStyle = 'rgba(26, 25, 27, 0.85)';
      ctx.lineWidth = 1.5;
      if (ITEMS[p.item].isCreature) {
        // A small pink axolotl with feathery gills, not an ore-shaped gem.
        ctx.strokeStyle = '#d77595'; ctx.lineWidth = 2;
        for (const side of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(side * 7, -1); ctx.lineTo(side * 13, -6);
          ctx.moveTo(side * 8, 1); ctx.lineTo(side * 14, 1);
          ctx.moveTo(side * 7, 3); ctx.lineTo(side * 12, 7); ctx.stroke();
        }
        ctx.fillStyle = '#f4a8bd';
        ctx.beginPath(); ctx.ellipse(0, 0, 9, 7, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#8c536b'; ctx.lineWidth = 1; ctx.stroke();
        ctx.shadowBlur = 0; ctx.fillStyle = '#4e3442';
        ctx.beginPath(); ctx.arc(-3.5, -1, 1, 0, TAU); ctx.arc(3.5, -1, 1, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#b96d88'; ctx.beginPath(); ctx.moveTo(-2, 3); ctx.quadraticCurveTo(0, 4.5, 2, 3); ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        if (ITEMS[p.item].isIngot) {
          ctx.moveTo(-9, 5); ctx.lineTo(-6, -4); ctx.lineTo(6, -4); ctx.lineTo(9, 5);
        } else if (ITEMS[p.item].isCoin) {
          ctx.arc(0, 0, 8, 0, TAU);
        } else {
          ctx.moveTo(0, -9); ctx.lineTo(8, -4); ctx.lineTo(7, 4);
          ctx.lineTo(1, 8); ctx.lineTo(-7, 5); ctx.lineTo(-8, -3);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        if (ITEMS[p.item].isIngot) ctx.fillRect(-5, -3, 10, 2);
        else {
          ctx.beginPath();
          ctx.moveTo(-4, -4); ctx.lineTo(0, -7); ctx.lineTo(3, -4); ctx.lineTo(-1, -2);
          ctx.closePath(); ctx.fill();
        }
      }
      if (p.count > 1) {
        ctx.font = '800 10px ui-rounded, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff5df';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.fillText('×' + p.count, 9, 8);
      }
      ctx.restore();
    }
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
    cancelSaveConfirmation(false);
    clearTouchMove();
    saveLoadRevision++;
    browserSaveForRun = null;
    Sound.init();

    levels.home = buildHome();
    levels.stage1 = null; // caves regenerate with fresh ore on a new run
    levels.stage2 = null;
    levels.stage3 = null;
    levels.stage4 = null;
    levels.stage5 = null;
    levels.stage6 = null;
    levels.stage7 = null;
    levels.special = null;

    for (let i = 0; i < inventory.length; i++) inventory[i] = null;
    syncBag();

    state.tools.pickaxe = 1;
    state.tools.sword = 1;
    state.mercurySword = false;
    state.elevatorUnlocked = false;
    melter.coal = 0;
    melter.copper = 0;
    melter.iron = 0;
    melter.bauxite = 0;
    melter.selectedOre = 'copper';
    for (const kind of Object.keys(traderUnlocked)) traderUnlocked[kind] = kind === 'copper';
    for (const item of Object.keys(storage)) storage[item] = 0;
    state.openStation = null;
    if (el.station) el.station.classList.add('is-hidden');
    refreshTierBadges();
    refreshStation();

    slimes.length = 0;
    moles.length = 0;
    spiders.length = 0;
    golems.length = 0;
    particles.length = 0;
    floaters.length = 0;
    melterBursts.length = 0;

    state.hp = BALANCE.playerMaxHp;
    state.invuln = 0;
    state.cooldown = 0;
    state.shack = 0;
    state.oreHauled = 0;
    state.slimesSlain = 0;
    state.molesSlain = 0;
    state.prospectorsSlain = 0;
    state.spidersSlain = 0;
    state.golemsSlain = 0;
    state.time = 0;
    state.transitionLock = 0.3;

    level = levels.home;
    player.x = level.spawn.x;
    player.y = level.spawn.y;
    camera.x = player.x;
    camera.y = player.y;
    showAreaName(level);
    selectTool('pickaxe');
    syncVitals();

    state.mode = 'playing';
    clearToast();
    stage.classList.add('is-playing');
    el.menu.classList.add('is-hidden');
    el.pause.classList.add('is-hidden');
    el.over.classList.add('is-hidden');
    el.hud.classList.remove('is-hidden');
    el.dock.classList.remove('is-hidden');
    keys.clear();
  }

  function pauseGame(force = false) {
    if (state.mode !== 'playing') return;
    // Ignore focus blips in the first moment of a run, but allow a deliberate
    // pause from the button or Escape immediately.
    if (!force && state.time < 1) return;
    state.mode = 'paused';
    keys.clear();
    clearTouchMove();
    stage.classList.remove('is-playing');
    el.pause.classList.remove('is-hidden');
    setSaveStatus(el.pauseSaveStatus, 'One browser save slot; saving replaces its previous contents. Download a backup file.');
    if (el.resume.focus) el.resume.focus({ preventScroll: true });
  }

  function resumeGame() {
    if (state.mode !== 'paused') return;
    cancelSaveConfirmation(false);
    saveLoadRevision++;
    state.mode = 'playing';
    stage.classList.add('is-playing');
    el.pause.classList.add('is-hidden');
    Sound.init();
  }

  function die() {
    // Credit items already on their way before the death penalty is applied.
    settleFlyingPickups(level);
    state.mode = 'dead';
    state.cooldown = 0;
    keys.clear();
    clearTouchMove();
    pointer.down = false;
    stage.classList.remove('is-playing');
    el.overOre.textContent = String(state.oreHauled);
    el.overSlimes.textContent = String(state.slimesSlain);
    el.overMoles.textContent = String(state.molesSlain);
    el.overProspectors.textContent = String(state.prospectorsSlain);
    if (el.overSpiders) el.overSpiders.textContent = String(state.spidersSlain);
    if (el.overGolems) el.overGolems.textContent = String(state.golemsSlain);
    const enemies = state.slimesSlain + state.molesSlain + state.prospectorsSlain + state.spidersSlain + state.golemsSlain;
    el.overLine.textContent = enemies === 0
      ? 'The cave creatures got you before you could fight back.'
      : `You defeated ${enemies} cave creature${enemies === 1 ? '' : 's'} before they got you.`;
    el.over.classList.remove('is-hidden');
  }

  // Wake up in Home Base: half of each resource in the bag is gone; stored
  // resources and the tools you earned are not.
  function respawnAtBase() {
    saveLoadRevision++;
    settleFlyingPickups(level);
    halveResources();
    slimes.length = 0;
    moles.length = 0;
    spiders.length = 0;
    golems.length = 0;
    particles.length = 0;
    floaters.length = 0;
    melterBursts.length = 0;
    state.hp = BALANCE.playerMaxHp;
    state.invuln = 0;
    state.cooldown = 0;
    state.shack = 0;
    syncVitals();

    el.over.classList.add('is-hidden');
    el.hud.classList.remove('is-hidden');
    el.dock.classList.remove('is-hidden');
    stage.classList.add('is-playing');
    state.mode = 'playing';
    state.transitionLock = 0.3;
    enterLevel('home', 'You wake up at Home Base. Half your haul is gone.');
    last = 0;
  }

  function toggleMute() {
    Sound.init();
    Sound.setMuted(!Sound.muted);
    el.mute.classList.toggle('is-off', Sound.muted);
    el.mute.setAttribute('aria-pressed', Sound.muted ? 'true' : 'false');
  }

  /* ------------------------------------------------------------- save files */

  // One deliberate browser save, plus portable JSON files. A new run never
  // overwrites the browser slot until the player explicitly saves again.
  const SAVE_FORMAT = 'mining-simulator-save';
  const SAVE_VERSION = 3;
  const SUPPORTED_SAVE_VERSIONS = [1, 2, SAVE_VERSION];
  // Keep the original browser key so existing manual slots remain visible.
  const SAVE_KEY = 'cuddly-train.mining-simulator.save.v1';
  const LEGACY_NEW_ITEMS = new Set(['cobalt', 'quartz', 'iridium', 'titanium', 'mercury', 'axolotl']);
  const MAX_SAVE_SIZE = 2 * 1024 * 1024;
  const MAX_SAVED_COUNT = 1000000000;
  let saveLoadRevision = 0; // invalidate file reads if the player resumes or starts another run
  let browserSaveForRun = null; // last slot loaded/saved by this run, for safe replacement
  let pendingSaveConfirmation = null;
  let pendingFileSelection = null;
  const AREA_BUILDERS = {
    home: buildHome, stage1: buildStage1, stage2: buildStage2,
    stage3: buildStage3, stage4: buildStage4, stage5: buildStage5,
    stage6: buildStage6, stage7: buildStage7, special: buildSpecialCave,
  };
  const AREA_NAMES = {
    home: 'Home Base', stage1: 'Cave Entrance', stage2: 'Dreadful Tunnels',
    stage3: 'Auag Cavern', stage4: 'Stalag Cavern', stage5: 'Alumina Cave',
    stage6: 'Luscious Cave', stage7: 'Spiral Cavern', special: 'Special Cave',
  };
  const AREA_TIMERS = ['slimeTimer', 'moleTimer', 'spiderTimer', 'golemTimer', 'prospectorTimer'];
  const SAVE_STATS = ['oreHauled', 'slimesSlain', 'molesSlain', 'prospectorsSlain', 'spidersSlain', 'golemsSlain'];
  const ENEMY_COMMON = ['x', 'y', 'hp', 'flash', 'attackCd', 'knockX', 'knockY', 'wanderAngle', 'wanderTimer'];
  const ENEMY_FIELDS = {
    slime: [...ENEMY_COMMON, 'hop', 'face', 'hopGround'],
    mole: [...ENEMY_COMMON, 'angle', 'drillSpin'],
    spider: [...ENEMY_COMMON, 'bite', 'facing', 'walk', 'stuckTime'],
    golem: [...ENEMY_COMMON, 'facing', 'walk', 'stuckTime', 'moved', 'disabled'],
    prospector: [...ENEMY_COMMON, 'throwCd', 'facing', 'walk', 'swingTime', 'mineProgress', 'mineTick', 'scanTimer', 'stuckTime'],
  };

  function setSaveStatus(node, message, isError = false) {
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', isError);
  }

  // An in-game confirmation also works in embedded previews where browser
  // modal dialogs may be blocked. Keep focus inside until it is dismissed.
  function requestSaveConfirmation(title, message, acceptLabel, onAccept, returnFocus, onCancel) {
    pendingSaveConfirmation = { onAccept, returnFocus, onCancel };
    el.saveConfirmTitle.textContent = title;
    el.saveConfirmMessage.textContent = message;
    el.saveConfirmAccept.textContent = acceptLabel;
    el.saveConfirm.classList.remove('is-hidden');
    if (el.saveConfirmCancel.focus) el.saveConfirmCancel.focus();
  }

  function cancelSaveConfirmation(restoreFocus = true) {
    const pending = pendingSaveConfirmation;
    pendingSaveConfirmation = null;
    el.saveConfirm.classList.add('is-hidden');
    if (pending && restoreFocus) {
      if (pending.onCancel) pending.onCancel();
      if (pending.returnFocus && pending.returnFocus.focus) pending.returnFocus.focus();
    }
  }

  function acceptSaveConfirmation() {
    const pending = pendingSaveConfirmation;
    if (!pending) return;
    cancelSaveConfirmation(false);
    pending.onAccept();
  }

  function snapshotEnemy(enemy, kind) {
    const saved = Object.fromEntries(ENEMY_FIELDS[kind].map((field) => [field, enemy[field]]));
    if (kind === 'slime') {
      saved.tiny = enemy.tiny; saved.large = enemy.large;
      saved.tropical = enemy.tropical; saved.provoked = enemy.provoked;
    }
    if (kind === 'golem') { saved.mercury = enemy.mercury; saved.maxHp = enemy.maxHp; }
    if (kind === 'mole') { saved.lastTile = enemy.lastTile; saved.inWall = enemy.inWall; }
    if (kind === 'prospector') {
      saved.haul = { gold: enemy.haul.gold, silver: enemy.haul.silver };
      const target = enemy.oreTarget;
      saved.oreTarget = target ? {
        tx: target.tx, ty: target.ty, tile: target.tile,
        goalTx: target.goalTx, goalTy: target.goalTy,
        route: target.route.map((point) => ({ tx: point.tx, ty: point.ty })),
        routeIndex: target.routeIndex,
      } : null;
    }
    return saved;
  }

  function snapshotArea(lv) {
    return {
      tiles: Array.from(lv.tiles),
      originalTiles: Array.from(lv.originalTiles),
      stalagmites: Array.from(lv.stalagmites),
      originalStalagmites: Array.from(lv.originalStalagmites),
      damage: Array.from(lv.damage),
      pickups: lv.pickups.map((p) => ({
        item: p.item, count: p.count, x: p.x, y: p.y, originX: p.originX, originY: p.originY,
        phase: p.phase, age: p.age, delay: p.delay, rise: p.rise,
        source: p.source, alreadyCollected: p.alreadyCollected,
      })),
      prospectors: lv.prospectors.filter((p) => !p.dead).map((p) => snapshotEnemy(p, 'prospector')),
      dynamites: lv.dynamites.map((d) => ({ fromX: d.fromX, fromY: d.fromY, x: d.x, y: d.y,
        targetX: d.targetX, targetY: d.targetY, age: d.age })),
      explosions: lv.explosions.map((e) => ({ x: e.x, y: e.y, age: e.age, duration: e.duration })),
      timers: Object.fromEntries(AREA_TIMERS.map((name) => [name, lv[name]])),
    };
  }

  function createSaveText() {
    if (!level || !['playing', 'paused', 'station'].includes(state.mode)) {
      throw new Error('Start or resume a run before saving.');
    }
    const areas = {};
    for (const id of Object.keys(AREA_BUILDERS)) {
      if (levels[id]) areas[id] = snapshotArea(levels[id]);
    }
    const save = {
      format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: new Date().toISOString(),
      currentLevel: level.id,
      state: {
        hp: state.hp, time: state.time, tool: state.tool,
        tools: { pickaxe: state.tools.pickaxe, sword: state.tools.sword },
        mercurySword: state.mercurySword, elevatorUnlocked: state.elevatorUnlocked,
        invuln: state.invuln, cooldown: state.cooldown, transitionLock: state.transitionLock,
        swingDir: state.swingDir,
        stats: Object.fromEntries(SAVE_STATS.map((name) => [name, state[name]])),
      },
      player: { x: player.x, y: player.y, faceX: player.faceX, faceY: player.faceY,
        aim: player.aim, walk: player.walk },
      inventory: inventory.map((cell) => cell ? { item: cell.item, count: cell.count } : null),
      storage: Object.fromEntries(Object.keys(ITEMS).map((item) => [item, storage[item]])),
      melter: { coal: melter.coal, copper: melter.copper, iron: melter.iron,
        bauxite: melter.bauxite, selectedOre: melter.selectedOre },
      traderUnlocked: { copper: traderUnlocked.copper, silver: traderUnlocked.silver,
        gold: traderUnlocked.gold, aluminum: traderUnlocked.aluminum },
      areas,
      enemies: {
        slimes: slimes.filter((e) => !e.dead).map((e) => snapshotEnemy(e, 'slime')),
        moles: moles.filter((e) => !e.dead).map((e) => snapshotEnemy(e, 'mole')),
        spiders: spiders.filter((e) => !e.dead).map((e) => snapshotEnemy(e, 'spider')),
        golems: golems.filter((e) => !e.dead).map((e) => snapshotEnemy(e, 'golem')),
      },
    };
    const text = JSON.stringify(save);
    if (text.length > MAX_SAVE_SIZE) throw new Error('This save is too large to store or export.');
    return text;
  }

  // Treat imported files as untrusted: validate and construct an independent
  // game first. No current progress is modified if any part of the file fails.
  function saveError(message = 'The save is incomplete or damaged.') { throw new Error(message); }
  function saveObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) saveError();
    return value;
  }
  function saveNumber(value, min = -1e9, max = 1e9) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) saveError();
    return value;
  }
  function saveInteger(value, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) saveError();
    return value;
  }
  function saveBoolean(value) {
    if (typeof value !== 'boolean') saveError();
    return value;
  }
  function saveArray(value, maxLength) {
    if (!Array.isArray(value) || value.length > maxLength) saveError();
    return value;
  }
  function saveTileKey(key, lv) {
    if (typeof key !== 'string' || !/^(0|[1-9]\d*),(0|[1-9]\d*)$/.test(key)) saveError();
    const [tx, ty] = key.split(',').map(Number);
    if (!Number.isSafeInteger(tx) || !Number.isSafeInteger(ty) || !inBounds(lv, tx, ty)) saveError();
    return { tx, ty };
  }
  function savePosition(value, size) { return saveNumber(value, -256, size + 256); }

  function restoreEnemy(raw, kind, lv, version, legacyArmour = BALANCE.swordDamage) {
    saveObject(raw);
    const x = saveNumber(raw.x, 0, lv.w * TS), y = saveNumber(raw.y, 0, lv.h * TS);
    let enemy;
    if (kind === 'slime') {
      const tiny = saveBoolean(raw.tiny), large = saveBoolean(raw.large);
      const tropical = version >= 2 ? saveBoolean(raw.tropical) : false;
      const provoked = version >= 2 ? saveBoolean(raw.provoked) : false;
      if ((tiny && large) || (tropical && large) || (!tropical && provoked)) saveError();
      enemy = makeSlime(x, y, tiny, large, tropical);
      enemy.provoked = provoked;
    } else if (kind === 'mole') enemy = makeMole(x, y);
    else if (kind === 'spider') enemy = makeSpider(x, y);
    else if (kind === 'golem') {
      const mercury = version >= 2 ? saveBoolean(raw.mercury) : false;
      const base = mercury ? BALANCE.mercuryGolemHp : BALANCE.golemHp;
      let armour = legacyArmour;
      if (version >= 3) {
        const maxHp = saveNumber(raw.maxHp, base, base + 100);
        const allowed = [1, 2, 3, 4].flatMap((tier) => [swordDamageFor(tier, false), swordDamageFor(tier, true)]);
        armour = maxHp - base;
        if (!allowed.some((amount) => Math.abs(amount - armour) < 1e-8)) saveError();
      } else if (saveNumber(raw.hp) > base) saveError();
      // Old live Golems keep their exact current HP, rather than healing on migration.
      enemy = makeGolem(x, y, mercury, armour);
    } else enemy = makeProspector(x, y);
    for (const field of ENEMY_FIELDS[kind]) enemy[field] = saveNumber(raw[field]);
    if (enemy.hp <= 0 || enemy.hp > enemy.maxHp) saveError();
    if (kind === 'golem' && (enemy.moved < 0 || enemy.moved > BALANCE.golemMoveLimit ||
        enemy.disabled < 0 || enemy.disabled > BALANCE.golemDisabledTime)) saveError();
    if (kind === 'mole') {
      saveTileKey(raw.lastTile, lv);
      enemy.lastTile = raw.lastTile;
      enemy.inWall = saveBoolean(raw.inWall);
    }
    if (kind === 'prospector') {
      saveObject(raw.haul);
      enemy.haul = { gold: saveInteger(raw.haul.gold, 0, MAX_SAVED_COUNT),
        silver: saveInteger(raw.haul.silver, 0, MAX_SAVED_COUNT) };
      if (raw.oreTarget !== null) {
        const target = saveObject(raw.oreTarget);
        const tx = saveInteger(target.tx, 0, lv.w - 1), ty = saveInteger(target.ty, 0, lv.h - 1);
        const goalTx = saveInteger(target.goalTx, 0, lv.w - 1), goalTy = saveInteger(target.goalTy, 0, lv.h - 1);
        if (![STONE, GOLD, SILVER].includes(target.tile)) saveError();
        const route = saveArray(target.route, lv.w * lv.h).map((point) => {
          saveObject(point);
          return { tx: saveInteger(point.tx, 0, lv.w - 1), ty: saveInteger(point.ty, 0, lv.h - 1) };
        });
        enemy.oreTarget = { tx, ty, tile: target.tile, goalTx, goalTy, route,
          routeIndex: saveInteger(target.routeIndex, 0, route.length) };
      }
    }
    // Chase routes are recomputed for the restored terrain on the next frame.
    return enemy;
  }

  function restorePickup(raw, lv) {
    saveObject(raw);
    if (typeof raw.item !== 'string' || !Object.hasOwn(ITEMS, raw.item)) saveError();
    if (!['ground', 'flying'].includes(raw.phase) || !['other', 'mining', 'melter', 'prospector', 'golem'].includes(raw.source)) saveError();
    const p = {
      item: raw.item, count: saveInteger(raw.count, 1, MAX_SAVED_COUNT),
      x: savePosition(raw.x, lv.w * TS), y: savePosition(raw.y, lv.h * TS),
      originX: savePosition(raw.originX, lv.w * TS), originY: savePosition(raw.originY, lv.h * TS),
      phase: raw.phase, age: saveNumber(raw.age, 0), delay: saveNumber(raw.delay, 0),
      rise: saveNumber(raw.rise, 0, 1000), source: raw.source,
      alreadyCollected: saveBoolean(raw.alreadyCollected),
    };
    if (p.phase === 'ground' && p.alreadyCollected) saveError();
    return p;
  }

  function restoreArea(raw, id, version) {
    saveObject(raw);
    const lv = AREA_BUILDERS[id]();
    const size = lv.w * lv.h;
    // Version 2's chamber layout remains playable until the player leaves.
    // The fresh open-cavern baseline will be applied on the next re-entry.
    const redesignedStage6 = version < 3 && id === 'stage6' ? lv.originalTiles.slice() : null;
    function tiles(values) {
      if (!Array.isArray(values) || values.length !== size) saveError();
      for (const t of values) {
        if (!Number.isInteger(t) || !Object.hasOwn(TILES, t) || t === STALAGMITE) saveError();
      }
      return Uint8Array.from(values);
    }
    lv.tiles = tiles(raw.tiles);
    lv.originalTiles = tiles(raw.originalTiles);
    // Version 1 predates the Stage 5 exit. Add it to both the current terrain
    // and its reset snapshot, preserving every other tile and all progress.
    if (version === 1 && id === 'stage5') {
      const exit = idx(lv, lv.stairsDown.tx, lv.stairsDown.ty);
      if (lv.tiles[exit] !== FLOOR || lv.originalTiles[exit] !== FLOOR) saveError();
      lv.tiles[exit] = lv.originalTiles[exit] = STAIRS_DOWN;
    }
    if (lv.secretTile) {
      const seam = idx(lv, lv.secretTile.tx, lv.secretTile.ty);
      if (lv.originalTiles[seam] !== TITANIUM || ![TITANIUM, STAIRS_DOWN].includes(lv.tiles[seam])) saveError();
    }
    for (const map of [lv.tiles, lv.originalTiles]) {
      for (let x = 0; x < lv.w; x++) {
        if (map[idx(lv, x, 0)] !== WALL || map[idx(lv, x, lv.h - 1)] !== WALL) saveError();
      }
      for (let y = 0; y < lv.h; y++) {
        if (map[idx(lv, 0, y)] !== WALL || map[idx(lv, lv.w - 1, y)] !== WALL) saveError();
      }
      if (lv.stairsUp && map[idx(lv, lv.stairsUp.tx, lv.stairsUp.ty)] !== STAIRS_UP) saveError();
      if (lv.stairsDown && map[idx(lv, lv.stairsDown.tx, lv.stairsDown.ty)] !== STAIRS_DOWN) saveError();
    }
    function formations(values, map) {
      const result = new Set();
      for (const key of saveArray(values, size)) {
        const { tx, ty } = saveTileKey(key, lv);
        if (result.has(key) || map[idx(lv, tx, ty)] !== FLOOR) saveError();
        result.add(key);
      }
      return result;
    }
    lv.stalagmites = formations(raw.stalagmites, lv.tiles);
    lv.originalStalagmites = formations(raw.originalStalagmites, lv.originalTiles);
    lv.damage = new Map();
    for (const entry of saveArray(raw.damage, size)) {
      if (!Array.isArray(entry) || entry.length !== 2) saveError();
      const { tx, ty } = saveTileKey(entry[0], lv);
      const def = lv.stalagmites.has(entry[0]) ? TILES[STALAGMITE] : TILES[lv.tiles[idx(lv, tx, ty)]];
      if (lv.damage.has(entry[0]) || !def.hits || def.hits <= 1) saveError();
      lv.damage.set(entry[0], saveInteger(entry[1], 1, 1000));
    }
    if (isSolidInLevel(lv, Math.floor(lv.spawn.x / TS), Math.floor(lv.spawn.y / TS))) saveError();
    lv.pickups = saveArray(raw.pickups, 10000).map((p) => restorePickup(p, lv));
    lv.prospectors = saveArray(raw.prospectors, 1024).map((p) => restoreEnemy(p, 'prospector', lv, version));
    lv.dynamites = saveArray(raw.dynamites, 1024).map((d) => {
      saveObject(d);
      return { fromX: savePosition(d.fromX, lv.w * TS), fromY: savePosition(d.fromY, lv.h * TS),
        x: savePosition(d.x, lv.w * TS), y: savePosition(d.y, lv.h * TS),
        targetX: savePosition(d.targetX, lv.w * TS), targetY: savePosition(d.targetY, lv.h * TS),
        age: saveNumber(d.age, 0) };
    });
    lv.explosions = saveArray(raw.explosions, 1024).map((e) => {
      saveObject(e);
      return { x: savePosition(e.x, lv.w * TS), y: savePosition(e.y, lv.h * TS),
        age: saveNumber(e.age, 0), duration: saveNumber(e.duration, 0.001, 1000) };
    });
    saveObject(raw.timers);
    for (const name of AREA_TIMERS) lv[name] = saveNumber(raw.timers[name]);
    if (redesignedStage6) {
      lv.originalTiles = redesignedStage6;
      lv.originalStalagmites = new Set();
    }
    placeElevators(lv);
    const expectedElevators = id === 'special' ? 0 : Number(!!lv.stairsUp) + Number(!!lv.stairsDown);
    if (lv.elevators.length !== expectedElevators) saveError('An elevator entrance is blocked in this save.');
    return lv;
  }

  function prepareSaveText(text) {
    if (typeof text !== 'string' || text.length > MAX_SAVE_SIZE) saveError('The save file is too large or unreadable.');
    let data;
    try { data = JSON.parse(text); } catch (err) { saveError('The save file is not valid JSON.'); }
    saveObject(data);
    if (data.format !== SAVE_FORMAT) saveError('This is not a Mining Simulator save file.');
    if (!SUPPORTED_SAVE_VERSIONS.includes(data.version)) saveError('This save was made for an unsupported version of the game.');
    if (typeof data.savedAt !== 'string' || data.savedAt.length > 40 || !Number.isFinite(Date.parse(data.savedAt))) saveError();
    if (typeof data.currentLevel !== 'string' || !Object.hasOwn(AREA_BUILDERS, data.currentLevel)) saveError();

    const savedState = saveObject(data.state), tools = saveObject(savedState.tools), stats = saveObject(savedState.stats);
    if (!['pickaxe', 'sword'].includes(savedState.tool)) saveError();
    const nextState = {
      hp: saveNumber(savedState.hp, 0.000001, BALANCE.playerMaxHp),
      time: saveNumber(savedState.time, 0), tool: savedState.tool,
      tools: { pickaxe: saveInteger(tools.pickaxe, 1, data.version === 1 ? 3 : MAX_TIER),
        sword: saveInteger(tools.sword, 1, data.version === 1 ? 3 : MAX_TIER) },
      mercurySword: data.version >= 2 ? saveBoolean(savedState.mercurySword) : false,
      elevatorUnlocked: data.version >= 3 ? saveBoolean(savedState.elevatorUnlocked) : false,
      invuln: saveNumber(savedState.invuln, 0), cooldown: saveNumber(savedState.cooldown, 0),
      transitionLock: saveNumber(savedState.transitionLock, -1, 1000), swingDir: saveNumber(savedState.swingDir),
      stats: Object.fromEntries(SAVE_STATS.map((name) => [name, saveInteger(stats[name], 0, MAX_SAVED_COUNT)])),
    };
    const rawPlayer = saveObject(data.player);
    const nextPlayer = { x: saveNumber(rawPlayer.x, 0), y: saveNumber(rawPlayer.y, 0),
      faceX: saveNumber(rawPlayer.faceX, -1, 1), faceY: saveNumber(rawPlayer.faceY, -1, 1),
      aim: saveNumber(rawPlayer.aim), walk: saveNumber(rawPlayer.walk) };
    if (!Array.isArray(data.inventory) || data.inventory.length !== inventory.length) saveError();
    const nextInventory = data.inventory.map((cell) => {
      if (cell === null) return null;
      saveObject(cell);
      if (typeof cell.item !== 'string' || !Object.hasOwn(ITEMS, cell.item)) saveError();
      return { item: cell.item, count: saveInteger(cell.count, 1, STACK_MAX) };
    });
    const rawStorage = saveObject(data.storage);
    const nextStorage = Object.fromEntries(Object.keys(ITEMS).map((item) =>
      [item, data.version === 1 && LEGACY_NEW_ITEMS.has(item) && !Object.hasOwn(rawStorage, item)
        ? 0 : saveInteger(rawStorage[item], 0, MAX_SAVED_COUNT)]));
    const rawMelter = saveObject(data.melter);
    if (typeof rawMelter.selectedOre !== 'string' || !Object.hasOwn(INGOT_FOR_ORE, rawMelter.selectedOre)) saveError();
    const nextMelter = { coal: saveInteger(rawMelter.coal, 0, MAX_SAVED_COUNT),
      copper: saveInteger(rawMelter.copper, 0, MAX_SAVED_COUNT),
      iron: saveInteger(rawMelter.iron, 0, MAX_SAVED_COUNT),
      bauxite: saveInteger(rawMelter.bauxite, 0, MAX_SAVED_COUNT), selectedOre: rawMelter.selectedOre };
    for (const ore of Object.keys(INGOT_FOR_ORE)) if (ore !== nextMelter.selectedOre && nextMelter[ore] > 0) saveError();
    const rawUnlocks = saveObject(data.traderUnlocked);
    const nextUnlocks = Object.fromEntries(Object.keys(COINS).map((kind) => [kind, saveBoolean(rawUnlocks[kind])]));
    if (!nextUnlocks.copper) saveError();

    const savedAreas = saveObject(data.areas), nextLevels = {};
    for (const id of Object.keys(AREA_BUILDERS)) {
      nextLevels[id] = Object.hasOwn(savedAreas, id) ? restoreArea(savedAreas[id], id, data.version) : null;
    }
    if (!nextLevels.home || !nextLevels[data.currentLevel] || (nextState.elevatorUnlocked && !nextLevels.stage7)) saveError();
    const lv = nextLevels[data.currentLevel];
    if (nextPlayer.x > lv.w * TS || nextPlayer.y > lv.h * TS ||
        collidesInLevel(lv, nextPlayer.x, nextPlayer.y, BALANCE.playerRadius)) saveError('The saved player position is invalid.');
    const rawEnemies = saveObject(data.enemies);
    const nextEnemies = {};
    const legacyArmour = swordDamageFor(nextState.tools.sword, nextState.mercurySword);
    for (const [list, kind] of [['slimes', 'slime'], ['moles', 'mole'], ['spiders', 'spider'], ['golems', 'golem']]) {
      nextEnemies[list] = saveArray(rawEnemies[list], 1024).map((enemy) => restoreEnemy(enemy, kind, lv, data.version, legacyArmour));
    }
    return { currentLevel: data.currentLevel, state: nextState, player: nextPlayer,
      inventory: nextInventory, storage: nextStorage, melter: nextMelter,
      traderUnlocked: nextUnlocks, levels: nextLevels, enemies: nextEnemies };
  }

  function applyPreparedSave(saved) {
    cancelSaveConfirmation(false);
    clearTouchMove();
    saveLoadRevision++;
    browserSaveForRun = null;
    for (const id of Object.keys(AREA_BUILDERS)) levels[id] = saved.levels[id];
    level = levels[saved.currentLevel];
    for (let i = 0; i < inventory.length; i++) inventory[i] = saved.inventory[i];
    for (const item of Object.keys(ITEMS)) storage[item] = saved.storage[item];
    for (const key of ['coal', 'copper', 'iron', 'bauxite', 'selectedOre']) melter[key] = saved.melter[key];
    for (const kind of Object.keys(COINS)) traderUnlocked[kind] = saved.traderUnlocked[kind];
    for (const [list, values] of [[slimes, saved.enemies.slimes], [moles, saved.enemies.moles],
      [spiders, saved.enemies.spiders], [golems, saved.enemies.golems]]) {
      list.length = 0;
      list.push(...values);
    }
    particles.length = floaters.length = melterBursts.length = 0;
    state.hp = saved.state.hp;
    state.time = saved.state.time;
    state.tools.pickaxe = saved.state.tools.pickaxe;
    state.tools.sword = saved.state.tools.sword;
    state.mercurySword = saved.state.mercurySword;
    state.elevatorUnlocked = saved.state.elevatorUnlocked;
    state.invuln = saved.state.invuln;
    state.cooldown = saved.state.cooldown;
    state.transitionLock = saved.state.transitionLock;
    state.swingDir = saved.state.swingDir;
    state.shack = 0;
    for (const name of SAVE_STATS) state[name] = saved.state.stats[name];
    for (const name of ['x', 'y', 'faceX', 'faceY', 'aim', 'walk']) player[name] = saved.player[name];
    player.vx = player.vy = player.hurtFlash = 0;
    const worldWidth = level.w * TS, worldHeight = level.h * TS;
    camera.x = worldWidth > W ? clamp(player.x, W / 2, worldWidth - W / 2) : worldWidth / 2;
    camera.y = worldHeight > H ? clamp(player.y, H / 2, worldHeight - H / 2) : worldHeight / 2;
    pointer.down = false; pointer.inside = false;
    keys.clear();
    state.mode = 'paused';
    state.openStation = null;
    el.menu.classList.add('is-hidden');
    el.over.classList.add('is-hidden');
    el.station.classList.add('is-hidden');
    el.pause.classList.remove('is-hidden');
    el.hud.classList.remove('is-hidden');
    el.dock.classList.remove('is-hidden');
    stage.classList.remove('is-playing');
    showAreaName(level);
    selectTool(saved.state.tool);
    syncBag(); syncVitals(); refreshStation(); clearToast();
    if (el.resume.focus) el.resume.focus({ preventScroll: true });
    last = 0;
  }

  function loadSaveText(text) {
    const prepared = prepareSaveText(text);
    applyPreparedSave(prepared);
    return true;
  }

  function browserSaveText() {
    if (!window.localStorage) throw new Error('Browser storage is unavailable. Download a save file instead.');
    return window.localStorage.getItem(SAVE_KEY);
  }

  function refreshSaveMenu() {
    let text = null, message = 'Pause your game to save your progress.', error = false;
    try {
      text = browserSaveText();
      if (text) {
        if (text.length > MAX_SAVE_SIZE) throw new Error('The browser save is too large.');
        const header = JSON.parse(text);
        if (!header || header.format !== SAVE_FORMAT || !SUPPORTED_SAVE_VERSIONS.includes(header.version) ||
            !Object.hasOwn(AREA_NAMES, header.currentLevel) || typeof header.savedAt !== 'string' ||
            !Number.isFinite(Date.parse(header.savedAt))) throw new Error('The browser save cannot be read.');
        message = `Saved in ${AREA_NAMES[header.currentLevel]} · ${new Date(header.savedAt).toLocaleString()}`;
      }
    } catch (err) {
      text = null;
      message = 'Browser save unavailable or damaged. Load a backup file or start a new game.';
      error = true;
    }
    const hasSave = !!text;
    el.continueSave.classList.toggle('is-hidden', !hasSave);
    el.continueSave.disabled = !hasSave;
    el.play.classList.toggle('btn-quiet', hasSave);
    el.play.textContent = hasSave ? 'New game' : 'Enter the base';
    setSaveStatus(el.menuSaveStatus, message, error);
  }

  function writeBrowserSave(text, revision, mode) {
    if (saveLoadRevision !== revision || state.mode !== mode) {
      setSaveStatus(el.pauseSaveStatus, 'The run changed; pause and save again.', true);
      return false;
    }
    try {
      if (!window.localStorage) throw new Error('Storage unavailable');
      window.localStorage.setItem(SAVE_KEY, text);
      browserSaveForRun = text;
      refreshSaveMenu();
      setSaveStatus(el.pauseSaveStatus, 'Saved in this browser. Choose Continue on the title screen.');
      return true;
    } catch (err) {
      setSaveStatus(el.pauseSaveStatus, 'Could not save in this browser. The previous save was kept; download a save file instead.', true);
      return false;
    }
  }

  function saveToBrowser() {
    let text, existing;
    try {
      text = createSaveText();
      prepareSaveText(text); // never replace a good save with an unreadable one
    } catch (err) {
      setSaveStatus(el.pauseSaveStatus, `Could not save: ${err.message} Your previous browser save was kept.`, true);
      return false;
    }
    try {
      existing = browserSaveText();
    } catch (err) {
      setSaveStatus(el.pauseSaveStatus, 'Could not save in this browser. The previous save was kept; download a save file instead.', true);
      return false;
    }
    const revision = saveLoadRevision, mode = state.mode;
    if (existing && existing !== browserSaveForRun) {
      requestSaveConfirmation('Replace browser save?',
        'This will replace the existing browser save with your current run.', 'Replace save',
        () => writeBrowserSave(text, revision, mode), el.saveBrowser,
        () => setSaveStatus(el.pauseSaveStatus, 'Browser save unchanged.'));
      return false;
    }
    return writeBrowserSave(text, revision, mode);
  }

  function loadBrowserSave() {
    try {
      const text = browserSaveText();
      if (!text) throw new Error('No browser save was found.');
      loadSaveText(text);
      browserSaveForRun = text;
      setSaveStatus(el.pauseSaveStatus, 'Browser save loaded. Press Keep going when ready.');
      return true;
    } catch (err) {
      setSaveStatus(el.menuSaveStatus, `Could not load the browser save. ${err.message}`, true);
      return false;
    }
  }

  function downloadSaveFile() {
    try {
      const text = createSaveText();
      prepareSaveText(text);
      const blob = new Blob([text], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mining-simulator-save.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
      setSaveStatus(el.pauseSaveStatus, 'Save file download started. Keep it as a backup.');
      return true;
    } catch (err) {
      setSaveStatus(el.pauseSaveStatus, `Could not download the save. ${err.message}`, true);
      return false;
    }
  }

  function openSaveFilePicker() {
    pendingFileSelection = { mode: state.mode, revision: saveLoadRevision };
    el.saveFile.value = '';
    el.saveFile.click();
  }

  function chooseSaveFile() {
    if (state.mode === 'menu') { openSaveFilePicker(); return; }
    if (state.mode !== 'paused') return;
    const revision = saveLoadRevision;
    requestSaveConfirmation('Load a save file?',
      'Loading a file replaces your current unsaved progress.', 'Choose file',
      () => { if (state.mode === 'paused' && saveLoadRevision === revision) openSaveFilePicker(); },
      el.importSavePause, () => setSaveStatus(el.pauseSaveStatus, 'Load canceled. Your current run is unchanged.'));
  }

  async function importSaveFile() {
    const file = el.saveFile.files && el.saveFile.files[0];
    const selection = pendingFileSelection;
    pendingFileSelection = null;
    el.saveFile.value = '';
    if (!file) return;
    const startMode = state.mode;
    const startRevision = saveLoadRevision;
    const status = startMode === 'menu' ? el.menuSaveStatus : el.pauseSaveStatus;
    try {
      if (selection && (selection.mode !== startMode || selection.revision !== startRevision)) {
        throw new Error('The run changed while choosing a file; try loading it again.');
      }
      if (file.size > MAX_SAVE_SIZE) throw new Error('The save file is too large.');
      const text = await file.text();
      if (state.mode !== startMode || saveLoadRevision !== startRevision || !['menu', 'paused'].includes(startMode)) {
        throw new Error('The run changed while the file was being read; try loading it again.');
      }
      loadSaveText(text);
      setSaveStatus(el.pauseSaveStatus, 'Save file loaded. Save to browser to keep it on this device.');
    } catch (err) {
      if (state.mode === 'playing') showToast('Save not loaded. Pause and try again.');
      else setSaveStatus(status, `Could not load the save file. ${err.message}`, true);
    }
  }

  // Wire the station menu. Null-guarded on purpose: a missing element should
  // never be able to stop the whole game from booting.
  const bind = (node, event, handler) => {
    if (node && node.addEventListener) node.addEventListener(event, handler);
  };
  bind(el.slotFuel, 'click', (e) => { (e.shiftKey ? emptySlot : loadSlot)('coal'); });
  bind(el.slotInput, 'click', (e) => { (e.shiftKey ? emptySlot : loadSlot)(melter.selectedOre); });
  bind(el.oreCopper, 'click', () => selectMelterOre('copper'));
  bind(el.oreIron, 'click', () => selectMelterOre('iron'));
  bind(el.oreBauxite, 'click', () => selectMelterOre('bauxite'));
  for (const kind of Object.keys(COINS)) {
    bind(coinUi[kind].press, 'click', () => pressCoin(kind));
    bind(coinUi[kind].trade, 'click', () => tradeCoin(kind));
  }
  bind(el.meltBtn, 'click', melt);
  bind(el.upgradePickaxe, 'click', () => upgradeTool('pickaxe'));
  bind(el.upgradeSword, 'click', () => upgradeTool('sword'));
  bind(el.upgradeMercury, 'click', upgradeMercurySword);
  bind(el.tradeAxolotl, 'click', sellAxolotl);
  bind(el.elevatorActivate, 'click', activateElevator);
  bind(el.depositAll, 'click', depositEverything);
  bind(el.withdrawAll, 'click', withdrawEverything);
  if (document.querySelectorAll) {
    for (const btn of document.querySelectorAll('[data-close-station]')) {
      bind(btn, 'click', closeStation);
    }
  }

  el.play.addEventListener('click', startGame);
  el.continueSave.addEventListener('click', loadBrowserSave);
  el.importSaveMenu.addEventListener('click', chooseSaveFile);
  el.importSavePause.addEventListener('click', chooseSaveFile);
  el.saveFile.addEventListener('change', importSaveFile);
  el.saveBrowser.addEventListener('click', saveToBrowser);
  el.exportSave.addEventListener('click', downloadSaveFile);
  el.saveConfirmCancel.addEventListener('click', () => cancelSaveConfirmation());
  el.saveConfirmAccept.addEventListener('click', acceptSaveConfirmation);
  el.pauseBtn.addEventListener('click', () => pauseGame(true));
  el.again.addEventListener('click', respawnAtBase);
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
    buildStorage();
    buildToolbelt();
    buildElevatorUI();
    levels.home = buildHome();
    level = levels.home;
    player.x = level.spawn.x;
    player.y = level.spawn.y;
    camera.x = player.x;
    camera.y = player.y;
    showAreaName(level);
    syncVitals();
    refreshTierBadges();
    refreshStation();
    refreshSaveMenu();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------- dev hook */

  window.MiningSim = {
    state,
    player,
    camera,
    inventory,
    storage,
    slimes,
    moles,
    spiders,
    golems,
    melterBursts,
    get prospectors() { return level.prospectors; },
    get dynamites() { return level.dynamites; },
    get pickups() { return level.pickups; },
    BALANCE,
    TILES,
    ITEMS,
    FLOOR, WALL, STONE, COAL, COPPER, IRON, GOLD, SILVER, STALAGMITE, BAUXITE,
    WET, COBALT, QUARTZ, IRIDIUM, TITANIUM, MERCURY, STAIRS_DOWN, STAIRS_UP,
    get level() { return level; },
    levels,
    getTile,
    setTile,
    isSolid,
    swing,
    selectTool,
    addItem,
    enterLevel,
    melter,
    traderUnlocked,
    openStation,
    closeStation,
    useElevator,
    activateElevator,
    travelByElevator,
    melt,
    pressCoin,
    tradeCoin,
    sellAxolotl,
    upgradeTool,
    upgradeMercurySword,
    selectMelterOre,
    loadSlot,
    emptySlot,
    depositToStorage,
    withdrawFromStorage,
    halveResources,
    countItem,
    inventorySpace,
    removeItem,
    tierDamage,
    pickaxeHits,
    respawnAtBase,
    get melterState() { return melter; },
    spawnSlimeAwayFromPlayer,
    spawnMoleAwayFromPlayer,
    spawnSpiderAwayFromPlayer,
    spawnGolemAwayFromPlayer,
    spawnProspectorAwayFromPlayer,
    buildStage1,
    buildStage2,
    buildStage3,
    buildStage4,
    buildStage5,
    buildStage6,
    buildStage7,
    buildSpecialCave,
    makeSlime,
    makeMole,
    makeSpider,
    makeGolem,
    makeProspector,
    pointer,
    pickaxeTarget,
    saveKey: SAVE_KEY,
    createSaveText,
    loadSaveText,
    saveToBrowser,
    loadBrowserSave,
    start: startGame,
  };

  boot();
})();
