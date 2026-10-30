// Headless integration tests for the dependency-free game. The tiny DOM/canvas
// doubles let the actual game script run under Node without a browser install.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : !!force;
    if (enabled) this.add(name); else this.remove(name);
    return enabled;
  }
}

const noop = () => {};
const gradient = { addColorStop: noop };
const context = new Proxy({
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
}, { get: (target, key) => key in target ? target[key] : noop });

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.classList = new ClassList();
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.textContent = '';
    this.disabled = false;
    this.width = 1;
    this.height = 1;
  }
  set className(value) { this.classList.values = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.values].join(' '); }
  set innerHTML(value) { if (!value) this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, options = {}) {
    const event = { type, target: this, button: 0, shiftKey: false, preventDefault: noop, ...options };
    for (const fn of this.listeners[type] || []) fn(event);
  }
  click(options) {
    if (!this.disabled) { this.clicks = (this.clicks || 0) + 1; this.dispatch('click', options); }
  }
  remove() { this.removed = true; }
  querySelectorAll(selector) {
    if (selector === '.tool') return this.children.filter((child) => child.classList.contains('tool'));
    return [];
  }
  getContext() { return context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 800 }; }
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
  };
}

function createGame(options = {}) {
  const elements = {};
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const [, tag, attrs, id] = match;
    const el = new Element(tag);
    const classMatch = attrs.match(/\bclass="([^"]*)"/);
    if (classMatch) el.className = classMatch[1];
    el.disabled = /\sdisabled(?:\s|>|$)/.test(attrs);
    elements[id] = el;
  }
  for (const tool of ['pickaxe', 'sword']) {
    const button = new Element('button');
    button.className = 'tool';
    button.dataset.tool = tool;
    elements.toolbelt.appendChild(button);
  }
  const closers = Array.from({ length: (html.match(/data-close-station/g) || []).length }, () => new Element('button'));
  const document = {
    hidden: false,
    body: new Element('body'),
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => new Element(tag),
    querySelectorAll: (selector) => selector === '[data-close-station]' ? closers : [],
    addEventListener: noop,
  };
  const listeners = {};
  const window = {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    localStorage: Object.hasOwn(options, 'storage') ? options.storage : createMemoryStorage(),
    setTimeout: noop,
    URL: { createObjectURL: (blob) => { window.downloadBlob = blob; return 'blob:test'; }, revokeObjectURL: noop },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
  };
  let callbacks = [];
  let now = 100;
  const requestAnimationFrame = (fn) => { callbacks.push(fn); return callbacks.length; };
  const math = Object.create(Math);
  math.random = Math.random;
  vm.runInNewContext(script, { window, document, requestAnimationFrame, console, Blob, Math: math }, { filename: 'game.js' });
  const step = (frames = 1, frameMs = 50) => {
    for (let i = 0; i < frames; i++) {
      now += frameMs;
      const pending = callbacks;
      callbacks = [];
      for (const fn of pending) fn(now);
    }
  };
  if (options.autoStart !== false) {
    elements.play.click();
    step(2);
  }
  return { game: window.MiningSim, elements, step, math, listeners, window, document };
}

function storageRow(elements, index) {
  const row = elements['storage-rows'].children[index];
  return { bag: row.children[1], stored: row.children[2], store: row.children[3].children[0], take: row.children[3].children[1] };
}

function mine(game, tile) {
  for (let y = 4; y <= 7; y++) for (let x = 4; x <= 8; x++) game.setTile(x, y, game.FLOOR);
  game.player.x = 5.5 * 32;
  game.player.y = 5.5 * 32;
  game.camera.x = game.player.x;
  game.camera.y = game.player.y;
  game.setTile(6, 5, tile);
  game.pointer.inside = true;
  game.pointer.x = 6.5 * 32 - game.camera.x + 1280 / 2;
  game.pointer.y = 5.5 * 32 - game.camera.y + 800 / 2;
  game.state.cooldown = 0;
  game.selectTool('pickaxe');
  game.swing();
}

test('Cave Entrance has an arrival title that becomes a small bubble', () => {
  const { game, elements, step } = createGame();
  assert.equal(game.state.mode, 'playing');
  assert.equal(elements['stage-name'].textContent, 'Home Base');
  game.enterLevel('stage1');
  assert.equal(game.level.name, 'Cave Entrance');
  assert.equal(elements['stage-name'].textContent, 'Cave Entrance');
  assert.equal(elements['area-subtitle'].textContent, 'The start of an epic journey!');
  assert.ok(elements['area-banner'].classList.contains('is-arriving'));
  step(72);
  assert.ok(!elements['area-banner'].classList.contains('is-arriving'));
  assert.equal(elements['area-subtitle'].textContent, 'The start of an epic journey!');
  game.enterLevel('home');
  assert.equal(elements['stage-name'].textContent, 'Home Base');
  assert.equal(elements['area-subtitle'].textContent, '');
});

test('storage buttons transfer one or all, and withdrawals animate without duplicating', () => {
  const { game, elements, step } = createGame();
  assert.ok(game.level.stations.some((station) => station.kind === 'storage'));
  game.addItem('copper', 7);
  game.openStation('storage');
  const row = storageRow(elements, 2);
  assert.equal(row.bag.textContent, '7');
  row.store.click();
  assert.equal(game.countItem('copper'), 6);
  assert.equal(game.storage.copper, 1);
  row.store.click({ shiftKey: true });
  assert.equal(game.countItem('copper'), 0);
  assert.equal(row.stored.textContent, '7');
  row.take.click();
  row.take.click({ shiftKey: true });
  assert.equal(game.countItem('copper'), 7);
  assert.equal(game.storage.copper, 0);
  assert.equal(game.pickups.length, 1); // menu withdrawals are coalesced visually
  assert.equal(game.pickups[0].count, 7);
  game.closeStation();
  step(25);
  assert.equal(game.pickups.length, 0);
  assert.equal(game.countItem('copper'), 7); // animation is cosmetic, not a second credit
});

test('stored resources survive death and resource totals are halved across stacks', () => {
  const { game } = createGame();
  game.addItem('stone', 120);
  assert.equal(game.depositToStorage('stone', 120), 120);
  game.addItem('copper', 100); // 99 + 1 in two inventory stacks
  game.addItem('coal', 7);
  game.state.tools.sword = 2;
  game.enterLevel('stage1');
  game.respawnAtBase();
  assert.equal(game.level.id, 'home');
  assert.equal(game.storage.stone, 120);
  assert.equal(game.countItem('copper'), 50);
  assert.equal(game.countItem('coal'), 4);
  assert.equal(game.state.tools.sword, 2);
  game.start();
  assert.equal(game.storage.stone, 0);
});

test('withdrawals only move what fits and preserve the rest in storage', () => {
  const { game } = createGame();
  game.addItem('stone', 989);
  game.storage.stone = 20;
  game.openStation('storage');
  assert.equal(game.withdrawFromStorage('stone', 20), 1);
  assert.equal(game.countItem('stone'), 990);
  assert.equal(game.storage.stone, 19);
  assert.equal(game.withdrawFromStorage('stone', 19), 0);
  assert.equal(game.storage.stone, 19);
});

test('melting closes the menu, erupts, then collects exactly one ingot', () => {
  const { game, elements, step } = createGame();
  assert.ok(html.indexOf('id="slot-input"') < html.indexOf('id="slot-fuel"'));
  game.addItem('copper', 1);
  game.addItem('coal', 1);
  game.openStation('melter');
  elements['slot-input'].click();
  elements['slot-fuel'].click();
  assert.equal(elements['melt-btn'].disabled, false);
  elements['melt-btn'].click();
  assert.equal(game.state.mode, 'playing');
  assert.ok(elements.station.classList.contains('is-hidden'));
  assert.equal(game.melter.coal, 0);
  assert.equal(game.melter.copper, 0);
  assert.equal(game.melterBursts.length, 1);
  assert.equal(game.pickups.length, 1);
  assert.equal(game.pickups[0].item, 'ingot');
  assert.equal(game.countItem('ingot'), 0); // only collected at the end of the flight
  step(9);
  assert.ok(game.pickups[0].y < game.pickups[0].originY);
  step(24);
  assert.equal(game.countItem('ingot'), 1);
  assert.equal(game.pickups.length, 0);
  assert.equal(game.melterBursts.length, 0);
});

test('full bags cannot consume a melt or discard loaded fuel', () => {
  const { game, elements } = createGame();
  game.addItem('stone', 990);
  game.melter.copper = 1;
  game.melter.coal = 1;
  game.openStation('melter');
  assert.equal(elements['melt-btn'].disabled, true);
  assert.equal(game.melt(), false);
  assert.equal(game.melter.copper, 1);
  assert.equal(game.melter.coal, 1);
  game.emptySlot('coal');
  assert.equal(game.melter.coal, 1);
  game.removeItem('stone', 99);
  game.emptySlot('coal');
  assert.equal(game.melter.coal, 0);
  assert.equal(game.countItem('coal'), 1);
});

test('mined ore pops upward and follows the player before reaching the bag', () => {
  const { game, step } = createGame();
  game.enterLevel('stage1');
  mine(game, game.COAL);
  assert.equal(game.getTile(6, 5), game.FLOOR);
  assert.equal(game.countItem('coal'), 0);
  const pickup = game.pickups[0];
  assert.equal(pickup.item, 'coal');
  step(4);
  assert.ok(pickup.y < pickup.originY);
  game.player.x -= 20;
  step(20);
  assert.equal(game.countItem('coal'), 1);
  assert.equal(game.state.oreHauled, 1);
  assert.equal(game.pickups.length, 0);
});

test('an overfull pickup remains in its cave until the player makes room', () => {
  const { game, step } = createGame();
  game.addItem('stone', 990);
  game.enterLevel('stage1');
  mine(game, game.COAL);
  step(24);
  assert.equal(game.countItem('coal'), 0);
  assert.equal(game.pickups[0].phase, 'ground');
  const cave = game.level;
  const drop = game.pickups[0];
  game.enterLevel('home');
  assert.equal(cave.pickups.length, 1);
  game.removeItem('stone', 99);
  game.enterLevel('stage1');
  game.player.x = drop.x - 32;
  game.player.y = drop.y;
  step(26);
  assert.equal(game.countItem('coal'), 1);
  assert.equal(cave.pickups.length, 0);
});

test('flight in progress is credited once before a transition or death penalty', () => {
  const first = createGame();
  first.game.enterLevel('stage1');
  mine(first.game, first.game.COAL);
  first.game.enterLevel('home');
  assert.equal(first.game.countItem('coal'), 1);
  first.game.enterLevel('stage1');
  first.step(25);
  assert.equal(first.game.countItem('coal'), 1);

  const { game, step } = createGame();
  game.addItem('coal', 4);
  game.storage.copper = 12;
  game.enterLevel('stage1');
  mine(game, game.COAL);
  game.state.hp = 10;
  game.state.invuln = 0;
  game.slimes.push(game.makeSlime(game.player.x + 5, game.player.y, false));
  step(1);
  assert.equal(game.state.mode, 'dead');
  assert.equal(game.countItem('coal'), 5);
  game.respawnAtBase();
  assert.equal(game.countItem('coal'), 3);
  assert.equal(game.storage.copper, 12);
  assert.equal(game.level.id, 'home');
});

test('forge upgrades and original tool balance still work', () => {
  const { game, elements } = createGame();
  assert.equal(game.pickaxeHits(game.TILES[game.STONE]), 1);
  assert.equal(game.pickaxeHits(game.TILES[game.COAL]), 1);
  assert.equal(game.pickaxeHits(game.TILES[game.COPPER]), 2);
  game.addItem('ingot', 3);
  game.openStation('forge');
  elements['upgrade-pickaxe'].click();
  assert.equal(game.state.tools.pickaxe, 2);
  assert.equal(game.countItem('ingot'), 0);
  assert.equal(game.pickaxeHits(game.TILES[game.COPPER]), 1);
  game.addItem('ingot', 3);
  elements['upgrade-sword'].click();
  assert.equal(game.tierDamage(), 15);
  assert.equal(game.countItem('ingot'), 0);
});

test('repeated melts produce three collectible ingots for a real forge upgrade', () => {
  const { game, elements, step } = createGame();
  game.addItem('copper', 3);
  game.addItem('coal', 3);
  for (let i = 0; i < 3; i++) {
    game.openStation('melter');
    elements['slot-input'].click();
    elements['slot-fuel'].click();
    elements['melt-btn'].click();
    assert.equal(game.state.mode, 'playing');
    step(2); // reopen before the previous item has finished its flight
  }
  step(30);
  assert.equal(game.countItem('ingot'), 3);
  assert.equal(game.countItem('coal'), 0);
  assert.equal(game.countItem('copper'), 0);
  game.openStation('forge');
  elements['upgrade-pickaxe'].click();
  assert.equal(game.state.tools.pickaxe, 2);
  assert.equal(game.countItem('ingot'), 0);
});

test('an ingot stays recoverable if the bag fills during its flight', () => {
  const { game, elements, step } = createGame();
  game.addItem('stone', 891); // nine full stacks; one empty slot for an ingot
  game.melter.coal = 1;
  game.melter.copper = 1;
  game.openStation('melter');
  elements['melt-btn'].click();
  game.addItem('coal', 99); // another acquisition fills that slot mid-flight
  step(28);
  assert.equal(game.countItem('ingot'), 0);
  assert.equal(game.pickups.length, 1);
  assert.equal(game.pickups[0].phase, 'ground');
  game.removeItem('coal', 99);
  const drop = game.pickups[0];
  game.player.x = drop.x + 20;
  game.player.y = drop.y + 20;
  step(26);
  assert.equal(game.countItem('ingot'), 1);
  assert.equal(game.pickups.length, 0);
});

function reachableWalkableTiles(game, level) {
  const start = level.stairsUp || level.stairsDown;
  const queue = [[start.tx, start.ty]];
  const seen = new Set([`${start.tx},${start.ty}`]);
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h || seen.has(key)) continue;
      if (game.TILES[level.tiles[ny * level.w + nx]].solid || level.stalagmites.has(key)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

test('the new stairs lead from Cave Entrance to Dreadful Tunnels and back', () => {
  const { game, elements, step } = createGame();
  game.enterLevel('stage1');
  const cave = game.level;
  const down = cave.stairsDown;
  assert.equal(cave.downTarget, 'stage2');
  assert.equal(cave.tiles[down.ty * cave.w + down.tx], game.STAIRS_DOWN);
  assert.ok(reachableWalkableTiles(game, cave).has(`${down.tx},${down.ty}`));

  game.player.x = (down.tx + 0.5) * 32;
  game.player.y = (down.ty + 0.5) * 32;
  game.state.transitionLock = 0;
  step(1);
  assert.equal(game.level.id, 'stage2');
  assert.equal(elements['stage-name'].textContent, 'Dreadful Tunnels');
  assert.equal(elements['area-kicker'].textContent, 'Stage 02');
  assert.equal(game.level.upTarget, 'stage1');

  const up = game.level.stairsUp;
  game.player.x = (up.tx + 0.5) * 32;
  game.player.y = (up.ty + 0.5) * 32;
  game.state.transitionLock = 0;
  step(1);
  assert.equal(game.level.id, 'stage1');
  assert.equal(Math.floor(game.player.x / 32), down.tx);
  assert.equal(Math.floor(game.player.y / 32), down.ty - 1);
  assert.ok(game.state.transitionLock > 0);
});

test('Stage 2 has connected long tunnels with all four resources and an intact boundary', () => {
  const { game } = createGame();
  game.enterLevel('stage1');
  assert.equal([...game.level.tiles].filter((tile) => tile === game.IRON).length, 0);
  game.enterLevel('stage2');
  const level = game.level;
  const reachable = reachableWalkableTiles(game, level);
  const allWalkable = [...level.tiles].filter((tile) => !game.TILES[tile].solid).length;
  assert.equal(reachable.size, allWalkable);
  for (let x = 4; x < 52; x++) assert.equal(game.TILES[level.tiles[7 * level.w + x]].solid, false);
  for (let y = 6; y < 34; y++) assert.equal(game.TILES[level.tiles[y * level.w + 13]].solid, false);
  for (const tile of [game.STONE, game.COAL, game.COPPER, game.IRON]) {
    assert.ok([...level.tiles].includes(tile), `Stage 2 should contain tile ${tile}`);
  }
  for (let x = 0; x < level.w; x++) {
    assert.equal(level.tiles[x], game.WALL);
    assert.equal(level.tiles[(level.h - 1) * level.w + x], game.WALL);
  }
});

test('all pickaxe tiers break iron and the existing ores in exactly the requested hits', () => {
  const { game } = createGame();
  game.enterLevel('stage2');
  const expected = {
    1: [[game.STONE, 1], [game.COAL, 1], [game.COPPER, 2], [game.IRON, 5]],
    2: [[game.STONE, 1], [game.COAL, 1], [game.COPPER, 1], [game.IRON, 3]],
    3: [[game.STONE, 1], [game.COAL, 1], [game.COPPER, 1], [game.IRON, 2]],
  };
  for (const [tier, rocks] of Object.entries(expected)) {
    game.state.tools.pickaxe = Number(tier);
    for (const [rock, hits] of rocks) {
      mine(game, rock);
      let swings = 1;
      while (game.getTile(6, 5) === rock && swings < 8) {
        game.state.cooldown = 0;
        game.swing();
        swings++;
      }
      assert.equal(swings, hits, `tier ${tier}, rock ${rock}`);
      assert.equal(game.getTile(6, 5), game.FLOOR);
    }
  }
});

test('the Melter selects iron safely and produces animated iron ingots', () => {
  const { game, elements, step } = createGame();
  game.addItem('copper', 2);
  game.addItem('iron', 3);
  game.addItem('coal', 3);
  game.openStation('melter');
  elements['slot-input'].click();
  elements['ore-iron'].click();
  assert.equal(game.melter.selectedOre, 'copper');
  assert.match(elements['melter-hint'].textContent, /Shift-click/);
  elements['slot-input'].click({ shiftKey: true });
  elements['ore-iron'].click();
  assert.equal(game.melter.selectedOre, 'iron');
  assert.equal(elements['input-label'].textContent, 'Top · Iron ore');
  assert.equal(game.countItem('copper'), 2);

  for (let i = 0; i < 3; i++) {
    if (game.state.mode !== 'station') game.openStation('melter');
    elements['slot-input'].click();
    elements['slot-fuel'].click();
    assert.equal(elements['melt-btn'].disabled, false);
    elements['melt-btn'].click();
    assert.equal(game.state.mode, 'playing');
    assert.ok(game.pickups.some((p) => p.item === 'ironIngot'));
    assert.ok(game.melterBursts.length > 0);
    step(26);
  }
  assert.equal(game.countItem('iron'), 0);
  assert.equal(game.countItem('coal'), 0);
  assert.equal(game.countItem('ironIngot'), 3);
  assert.equal(game.countItem('ingot'), 0);
});

test('T3 requires a T2 tool and three iron ingots, without spending copper', () => {
  const { game, elements } = createGame();
  game.addItem('ironIngot', 6);
  game.openStation('forge');
  assert.equal(elements['upgrade-pickaxe'].disabled, true);
  assert.equal(game.upgradeTool('pickaxe'), false);
  assert.equal(game.state.tools.pickaxe, 1);
  game.addItem('ingot', 3);
  elements['upgrade-pickaxe'].click();
  assert.equal(game.state.tools.pickaxe, 2);
  assert.equal(game.countItem('ironIngot'), 6);
  elements['upgrade-pickaxe'].click();
  assert.equal(game.state.tools.pickaxe, 3);
  assert.equal(game.countItem('ironIngot'), 3);
  assert.equal(elements['upgrade-pickaxe'].textContent, 'Upgrade · 3 titanium');
  assert.equal(game.pickaxeHits(game.TILES[game.IRON]), 2);

  game.addItem('ingot', 3);
  elements['upgrade-sword'].click();
  assert.equal(game.state.tools.sword, 2);
  elements['upgrade-sword'].click();
  assert.equal(game.state.tools.sword, 3);
  assert.equal(game.tierDamage(), 30);
  assert.equal(game.countItem('ironIngot'), 0);
  assert.equal(elements['forge-iron-ingots'].textContent, '0');
});

test('iron and iron ingots work with storage and remain safe after death', () => {
  const { game } = createGame();
  game.addItem('iron', 7);
  game.addItem('ironIngot', 5);
  assert.equal(game.depositToStorage('iron', 4), 4);
  assert.equal(game.depositToStorage('ironIngot', 3), 3);
  game.enterLevel('stage2');
  game.respawnAtBase();
  assert.equal(game.storage.iron, 4);
  assert.equal(game.storage.ironIngot, 3);
  assert.equal(game.countItem('iron'), 2);
  assert.equal(game.countItem('ironIngot'), 1);
  assert.equal(game.withdrawFromStorage('ironIngot', 3), 3);
  assert.equal(game.countItem('ironIngot'), 4);
});

function placeMoleInTunnel(game) {
  game.enterLevel('stage2');
  game.level.slimeTimer = 999;
  game.level.moleTimer = 999;
  for (let x = 9; x <= 16; x++) game.setTile(x, 10, game.FLOOR);
  game.player.x = 14.5 * 32;
  game.player.y = 10.5 * 32;
  const mole = game.makeMole(10.5 * 32, 10.5 * 32);
  game.moles.push(mole);
  return mole;
}

test('Drill Moles move through solid blocks and roll once per entered block', () => {
  const { game, step, math } = createGame();
  const mole = placeMoleInTunnel(game);
  game.setTile(11, 10, game.STONE);
  let rolls = 0;
  math.random = () => { rolls++; return 0.99; };
  step(8);
  assert.equal(mole.chasing, true);
  assert.ok(mole.x > 11 * 32);
  assert.equal(mole.inWall, true);
  assert.equal(game.getTile(11, 10), game.STONE);
  assert.equal(rolls, 1);
  step(4);
  assert.equal(rolls, 1, 'remaining in a block must not roll again');
  step(8);
  assert.ok(mole.x > 12 * 32, 'mole should exit the solid block');
  assert.equal(game.getTile(11, 10), game.STONE);
  assert.equal(rolls, 1);
});

test('a successful 10% mole roll destroys blocks without dropping resources', () => {
  for (const [tile, item] of [['STONE', 'stone'], ['COAL', 'coal'], ['COPPER', 'copper'], ['IRON', 'iron'], ['WALL', null]]) {
    const { game, step, math } = createGame();
    placeMoleInTunnel(game);
    game.setTile(11, 10, game[tile]);
    game.level.damage.set('11,10', 2);
    math.random = () => 0.09;
    step(8);
    assert.equal(game.getTile(11, 10), game.FLOOR, `${tile} should be destroyed`);
    assert.equal(game.level.damage.has('11,10'), false, `${tile} damage should be cleared`);
    assert.equal(game.pickups.length, 0, `${tile} must not drop a pickup`);
    game.player.x = 12.5 * 32;
    game.player.y = 10.5 * 32;
    step(26);
    assert.equal(game.pickups.length, 0, `${tile} must not drop a delayed pickup`);
    if (item) assert.equal(game.countItem(item), 0, `${tile} must not be added to the bag`);
    assert.equal(game.state.oreHauled, 0, `${tile} must not count as player-mined ore`);
  }
});

test('mole destruction leaves existing player-mined pickups intact', () => {
  const { game, step, math } = createGame();
  placeMoleInTunnel(game);
  mine(game, game.COAL);
  const existing = game.pickups[0];
  game.player.x = 14.5 * 32;
  game.player.y = 10.5 * 32;
  game.setTile(11, 10, game.IRON);
  math.random = () => 0.09;
  step(8);
  assert.equal(game.getTile(11, 10), game.FLOOR);
  assert.equal(game.pickups.length, 1);
  assert.equal(game.pickups[0], existing);
  step(26);
  assert.equal(game.countItem('coal'), 1);
  assert.equal(game.countItem('iron'), 0);
  assert.equal(game.state.oreHauled, 1);
});

test('Drill Moles match slime health and damage, take sword hits, and do not split', () => {
  const { game } = createGame();
  game.enterLevel('stage2');
  const mole = game.makeMole(game.player.x + 32, game.player.y);
  const slime = game.makeSlime(game.player.x, game.player.y, false);
  assert.equal(mole.hp, slime.hp);
  assert.equal(mole.dmg, slime.dmg);
  game.moles.push(mole);
  game.selectTool('sword');
  game.pointer.inside = true;
  game.pointer.x = mole.x - game.camera.x + 1280 / 2;
  game.pointer.y = mole.y - game.camera.y + 800 / 2;
  for (let i = 0; i < 3; i++) {
    game.state.cooldown = 0;
    game.swing();
  }
  assert.equal(mole.dead, true);
  assert.equal(game.state.molesSlain, 1);
  assert.equal(game.slimes.length, 0);

  const stronger = game.makeMole(game.player.x + 32, game.player.y);
  game.moles.push(stronger);
  game.state.tools.sword = 3;
  game.state.cooldown = 0;
  game.swing();
  assert.equal(stronger.dead, true);
});

test('Stage 2 spawns both slimes and moles, and five mole hits defeat the player', () => {
  const { game, step, math } = createGame();
  game.enterLevel('stage2');
  let seed = 123456;
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  game.level.slimeTimer = 0;
  game.level.moleTimer = 0;
  step(1);
  assert.ok(game.slimes.length > 0, 'slimes should spawn in Stage 2');
  assert.ok(game.moles.length > 0, 'moles should spawn in Stage 2');

  game.slimes.length = 0;
  game.moles.length = 0;
  game.level.slimeTimer = 999;
  game.level.moleTimer = 999;
  const mole = game.makeMole(game.player.x + 5, game.player.y);
  game.moles.push(mole);
  for (let i = 0; i < 5; i++) {
    mole.x = game.player.x + 5;
    mole.y = game.player.y;
    mole.attackCd = 0;
    game.state.invuln = 0;
    step(1);
    assert.equal(game.state.hp, 100 - 20 * (i + 1));
  }
  assert.equal(game.state.mode, 'dead');
});

test('a mole can roll again on re-entering a block, and exactly 0.1 does not break it', () => {
  const { game, step, math } = createGame();
  const mole = placeMoleInTunnel(game);
  game.setTile(11, 10, game.WALL);
  math.random = () => 0.1;
  step(8);
  assert.equal(game.getTile(11, 10), game.WALL);
  game.player.x = 9.5 * 32;
  step(4);
  assert.ok(mole.x < 11 * 32, 'mole should have left the block');
  game.player.x = 14.5 * 32;
  math.random = () => 0.09;
  step(6);
  assert.equal(game.getTile(11, 10), game.FLOOR, 'a new entry gets a new roll');
});

test('moles stay inside the unbreakable outer boundary', () => {
  const { game, step, math } = createGame();
  game.enterLevel('stage2');
  game.level.slimeTimer = 999;
  game.level.moleTimer = 999;
  game.player.x = 30.5 * 32;
  game.player.y = 20.5 * 32;
  const mole = game.makeMole(32 + game.BALANCE.moleRadius, 10.5 * 32);
  mole.wanderAngle = Math.PI;
  mole.wanderTimer = 999;
  game.moles.push(mole);
  math.random = () => 0;
  step(40);
  assert.ok(mole.x >= 32 + mole.r);
  for (let y = 0; y < game.level.h; y++) assert.equal(game.level.tiles[y * game.level.w], game.WALL);
});

test('a full bag leaves iron and fuel safely in the Melter', () => {
  const { game, elements } = createGame();
  game.addItem('stone', 990);
  game.melter.selectedOre = 'iron';
  game.melter.iron = 1;
  game.melter.coal = 1;
  game.openStation('melter');
  assert.equal(elements['melt-btn'].disabled, true);
  assert.equal(game.melt(), false);
  assert.equal(game.melter.iron, 1);
  assert.equal(game.melter.coal, 1);
  game.emptySlot('iron');
  assert.equal(game.melter.iron, 1);
  game.removeItem('stone', 99);
  game.emptySlot('iron');
  assert.equal(game.melter.iron, 0);
  assert.equal(game.countItem('iron'), 1);
});

test('Stage 2 restores its original tiles on return and regenerates for a new run', () => {
  const { game } = createGame();
  game.enterLevel('stage2');
  const first = game.level;
  const original = game.getTile(15, 15);
  const changed = original === game.FLOOR ? game.IRON : game.FLOOR;
  game.setTile(15, 15, changed);
  game.level.damage.set('15,15', 2);
  game.enterLevel('stage2'); // no area was left, so keep the current tiles
  assert.equal(game.getTile(15, 15), changed);
  game.enterLevel('stage1');
  game.enterLevel('stage2');
  assert.equal(game.level, first);
  assert.equal(game.getTile(15, 15), original);
  assert.equal(game.level.damage.has('15,15'), false);
  game.start();
  game.enterLevel('stage2');
  assert.notEqual(game.level, first);
});

test('Stage 2 remains stable as both enemy types spawn and move over time', () => {
  const { game, step } = createGame();
  game.enterLevel('stage2');
  game.state.invuln = 999;
  step(400);
  assert.equal(game.state.mode, 'playing');
  assert.ok(game.moles.length > 0 && game.moles.length <= 3);
  assert.ok(game.slimes.length > 0 && game.slimes.length <= 7);
  for (const enemy of [...game.moles, ...game.slimes]) {
    assert.ok(Number.isFinite(enemy.x) && Number.isFinite(enemy.y));
    assert.ok(enemy.x > 0 && enemy.x < game.level.w * 32);
    assert.ok(enemy.y > 0 && enemy.y < game.level.h * 32);
  }
});

test('mouse, touch and Space aim and swing the equipped tool at Stage 2 iron', () => {
  const { game, elements, listeners } = createGame();
  game.enterLevel('stage2');
  for (let y = 4; y <= 7; y++) for (let x = 4; x <= 8; x++) game.setTile(x, y, game.FLOOR);
  game.player.x = 5.5 * 32;
  game.player.y = 5.5 * 32;
  game.camera.x = game.player.x;
  game.camera.y = game.player.y;
  game.setTile(6, 5, game.IRON);
  game.selectTool('pickaxe');
  const clientX = 6.5 * 32 - game.camera.x + 1280 / 2;
  const clientY = 5.5 * 32 - game.camera.y + 800 / 2;
  const pointerHit = (pointerType) => {
    game.state.cooldown = 0;
    elements.game.dispatch('pointerdown', { clientX, clientY, pointerType });
  };
  pointerHit('mouse');
  assert.equal(game.level.damage.get('6,5'), 1);
  game.state.cooldown = 0;
  listeners.keydown[0]({ code: 'Space', repeat: false, preventDefault: noop });
  assert.equal(game.level.damage.get('6,5'), 2);
  pointerHit('touch');
  pointerHit('mouse');
  pointerHit('touch');
  assert.equal(game.getTile(6, 5), game.FLOOR);
  assert.equal(game.pickups[0].item, 'iron');
});

test('Stage 2 and Stage 3 have the requested titles and connected two-way stairs', () => {
  const { game, elements, step } = createGame();
  game.enterLevel('stage2');
  assert.equal(elements['stage-name'].textContent, 'Dreadful Tunnels');
  assert.equal(elements['area-subtitle'].textContent, 'Moles have carved these tunnels');
  const stage2 = game.level;
  const down = stage2.stairsDown;
  assert.equal(stage2.downTarget, 'stage3');
  assert.ok(reachableWalkableTiles(game, stage2).has(`${down.tx},${down.ty}`));
  game.player.x = (down.tx + 0.5) * 32;
  game.player.y = (down.ty + 0.5) * 32;
  game.state.transitionLock = 0;
  step(1);
  assert.equal(game.level.id, 'stage3');
  assert.equal(elements['stage-name'].textContent, 'Auag Cavern');
  assert.equal(elements['area-subtitle'].textContent, 'The abundant riches have attracted the greedy');
  const up = game.level.stairsUp;
  game.player.x = (up.tx + 0.5) * 32;
  game.player.y = (up.ty + 0.5) * 32;
  game.state.transitionLock = 0;
  step(1);
  assert.equal(game.level.id, 'stage2');
  assert.equal(Math.floor(game.player.x / 32), down.tx);
  assert.equal(Math.floor(game.player.y / 32), down.ty - 1);
});

test('Auag Cavern has a connected layout with only stone, gold and silver', () => {
  const { game } = createGame();
  game.enterLevel('stage3');
  const cave = game.level;
  const reachable = reachableWalkableTiles(game, cave);
  assert.equal(reachable.size, [...cave.tiles].filter((tile) => !game.TILES[tile].solid).length);
  for (const tile of [game.STONE, game.GOLD, game.SILVER]) {
    assert.ok([...cave.tiles].includes(tile), `missing resource tile ${tile}`);
  }
  for (const tile of [game.COAL, game.COPPER, game.IRON]) {
    assert.ok(![...cave.tiles].includes(tile), `unexpected resource tile ${tile}`);
  }
  for (let x = 0; x < cave.w; x++) {
    assert.equal(cave.tiles[x], game.WALL);
    assert.equal(cave.tiles[(cave.h - 1) * cave.w + x], game.WALL);
  }
});

function prospectingArena(game) {
  game.enterLevel('stage3');
  game.level.prospectorTimer = 999;
  for (let y = 3; y <= 28; y++) for (let x = 3; x <= 30; x++) game.setTile(x, y, game.FLOOR);
  game.player.x = 24.5 * 32;
  game.player.y = 23.5 * 32;
  const prospector = game.makeProspector(10.5 * 32, 10.5 * 32);
  game.prospectors.push(prospector);
  return prospector;
}

function aimSwordAt(game, enemy) {
  game.camera.x = game.player.x;
  game.camera.y = game.player.y;
  game.pointer.inside = true;
  game.pointer.x = enemy.x - game.camera.x + 1280 / 2;
  game.pointer.y = enemy.y - game.camera.y + 800 / 2;
  game.state.tools.sword = 3;
  game.selectTool('sword');
}

test('gold and silver can be mined, collected and stored safely', () => {
  for (const [tile, item] of [['GOLD', 'gold'], ['SILVER', 'silver']]) {
    const { game, step } = createGame();
    game.enterLevel('stage3');
    game.level.prospectorTimer = 999;
    game.state.tools.pickaxe = 3;
    mine(game, game[tile]);
    assert.equal(game.getTile(6, 5), game[tile]);
    game.state.cooldown = 0;
    game.swing();
    assert.equal(game.getTile(6, 5), game.FLOOR);
    assert.equal(game.pickups[0].item, item);
    step(25);
    assert.equal(game.countItem(item), 1);
    game.enterLevel('home');
    game.openStation('storage');
    assert.equal(game.depositToStorage(item, 1), 1);
    game.closeStation();
    game.respawnAtBase();
    assert.equal(game.storage[item], 1);
  }
});

test('prospectors find, mine and carry nearby gold and silver', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  game.setTile(12, 10, game.GOLD);
  game.setTile(14, 10, game.SILVER);
  game.level.damage.set('12,10', 2);
  step(160);
  assert.equal(game.getTile(12, 10), game.FLOOR);
  assert.equal(game.getTile(14, 10), game.FLOOR);
  assert.equal(game.level.damage.has('12,10'), false);
  assert.equal(prospector.haul.gold, 1);
  assert.equal(prospector.haul.silver, 1);
  assert.equal(game.pickups.length, 0);
  assert.equal(game.countItem('gold'), 0);
  assert.equal(game.countItem('silver'), 0);
});

test('prospectors path around obstacles to mine reachable ore', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  game.setTile(11, 10, game.WALL);
  game.setTile(12, 10, game.GOLD);
  step(160);
  assert.equal(game.getTile(11, 10), game.WALL);
  assert.equal(game.getTile(12, 10), game.FLOOR);
  assert.equal(prospector.haul.gold, 1);
});

test('two prospectors cannot both collect the same ore block', () => {
  const { game, step } = createGame();
  const first = prospectingArena(game);
  const second = game.makeProspector(10.5 * 32, 10.6 * 32);
  game.prospectors.push(second);
  game.setTile(11, 10, game.GOLD);
  step(35);
  assert.equal(game.getTile(11, 10), game.FLOOR);
  assert.equal(first.haul.gold + second.haul.gold, 1);
});

test('prospectors ignore players without treasure and pursue gold or silver within four tiles', () => {
  for (const item of ['gold', 'silver']) {
    const { game, step } = createGame();
    const prospector = prospectingArena(game);
    game.player.x = prospector.x + 3 * 32;
    game.player.y = prospector.y;
    prospector.wanderAngle = Math.PI / 2;
    prospector.wanderTimer = 999;
    prospector.scanTimer = 999;
    step(1);
    assert.equal(prospector.chasing, false);
    assert.equal(game.dynamites.length, 0);
    assert.equal(game.state.hp, 100);
    game.addItem(item, 1);
    step(1);
    assert.equal(prospector.chasing, true, item);
    assert.equal(game.dynamites.length, 1, 'ranged aggression throws dynamite');
    game.removeItem(item, 1);
    step(1);
    assert.equal(prospector.chasing, false, 'no treasure means no pursuit');
    game.addItem(item, 1);
    game.player.x = prospector.x + 4 * 32 + 5;
    game.player.y = prospector.y;
    step(1);
    assert.equal(prospector.chasing, false, 'outside four tiles is out of view');
  }
});

test('prospectors match slime wander and chase speeds and deal slime melee damage', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  assert.equal(prospector.speed, game.BALANCE.slimeSpeed);
  assert.equal(prospector.dmg, game.BALANCE.slimeDamage);
  prospector.wanderAngle = 0;
  prospector.wanderTimer = 999;
  prospector.scanTimer = 999;
  const startX = prospector.x;
  step(20);
  assert.ok(Math.abs(prospector.x - startX - game.BALANCE.slimeSpeed * 0.5) < 0.01);
  game.addItem('gold', 1);
  game.player.x = prospector.x + 2.5 * 32;
  game.player.y = prospector.y;
  const chaseX = prospector.x;
  step(10);
  assert.ok(Math.abs(prospector.x - chaseX - game.BALANCE.slimeSpeed * 0.5) < 0.01);
  game.dynamites.length = 0;
  game.player.x = prospector.x + 24;
  game.player.y = prospector.y;
  game.state.invuln = 0;
  step(1);
  assert.equal(game.state.hp, 80);
});

test('dynamite explodes two seconds after landing and keeps the requested tile damage', () => {
  for (const [ring, damage] of [[0, 100], [1, 70], [2, 60], [3, 50], [4, 25], [5, 0]]) {
    const { game, step } = createGame();
    const prospector = prospectingArena(game);
    game.player.x = prospector.x + 3 * 32;
    game.player.y = prospector.y;
    game.addItem('gold', 1);
    game.state.invuln = 999; // an explosion still applies its specified damage
    assert.equal(game.BALANCE.dynamiteFuse, 2);
    assert.equal(game.BALANCE.dynamiteFlight, 0.38);
    step(1);
    assert.equal(game.dynamites.length, 1);
    const dynamite = game.dynamites[0];
    prospector.dead = true;
    game.player.x = dynamite.targetX + ring * 32;
    game.player.y = dynamite.targetY;

    step(6); // 0.35 seconds since the throw: still airborne
    assert.ok(dynamite.age < game.BALANCE.dynamiteFlight);
    assert.notEqual(dynamite.x, dynamite.targetX);
    step(1, 30); // exactly 0.38 seconds: it has just landed
    assert.ok(Math.abs(dynamite.age - game.BALANCE.dynamiteFlight) < 1e-9);
    assert.ok(Math.abs(dynamite.x - dynamite.targetX) < 1e-9);
    step(39); // 1.95 seconds on the ground
    assert.equal(game.state.hp, 100, `ring ${ring} exploded early`);
    assert.equal(game.dynamites.length, 1);
    step(1); // two full seconds on the ground
    assert.equal(game.dynamites.length, 0);
    assert.equal(game.state.hp, 100 - damage, `ring ${ring}`);
    if (ring === 0) assert.equal(game.state.mode, 'dead');
  }
});

test('a defeated prospector drops all collected ore even with a full bag or a level change', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  prospector.haul.gold = 2;
  prospector.haul.silver = 3;
  game.addItem('stone', 990);
  game.player.x = prospector.x - 32;
  game.player.y = prospector.y;
  aimSwordAt(game, prospector);
  game.state.cooldown = 0;
  game.swing();
  game.state.cooldown = 0;
  game.swing();
  assert.equal(prospector.dead, true);
  assert.equal(game.state.prospectorsSlain, 1);
  assert.equal(game.pickups.length, 2);
  assert.equal(game.pickups.find((p) => p.item === 'gold').count, 2);
  assert.equal(game.pickups.find((p) => p.item === 'silver').count, 3);
  step(10);
  assert.ok(game.pickups.every((p) => p.phase === 'ground'));
  const cavern = game.level;
  game.enterLevel('stage2');
  assert.equal(cavern.pickups.length, 2);
  game.enterLevel('stage3');
  game.removeItem('stone', 198);
  game.player.x = prospector.x - 20;
  game.player.y = prospector.y;
  step(30);
  assert.equal(game.countItem('gold'), 2);
  assert.equal(game.countItem('silver'), 3);
  assert.equal(game.pickups.length, 0);
});

test('a prospector keeps its haul between visits, but a new run resets the cavern', () => {
  const { game } = createGame();
  const prospector = prospectingArena(game);
  prospector.haul.gold = 2;
  const cavern = game.level;
  game.enterLevel('stage2');
  game.enterLevel('stage3');
  assert.equal(game.level, cavern);
  assert.equal(game.prospectors[0], prospector);
  assert.equal(game.prospectors[0].haul.gold, 2);
  game.start();
  game.enterLevel('stage3');
  assert.notEqual(game.level, cavern);
  assert.equal(game.prospectors.length, 0);
});

test('prospectors can dig through stone to reach visible ore', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  game.setTile(12, 10, game.GOLD);
  for (const [x, y] of [[11, 10], [12, 9], [13, 10], [12, 11]]) game.setTile(x, y, game.STONE);
  step(180);
  assert.equal(game.getTile(12, 10), game.FLOOR);
  assert.equal(prospector.haul.gold, 1);
  assert.equal(game.pickups.length, 0);
});

test('a prospector detects ore exactly four tiles away, but not five', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  prospector.wanderAngle = Math.PI;
  prospector.wanderTimer = 999;
  game.setTile(15, 10, game.SILVER);
  step(1);
  assert.equal(prospector.oreTarget, null);
  game.setTile(14, 10, game.GOLD);
  prospector.x = 10.5 * 32;
  prospector.y = 10.5 * 32;
  prospector.scanTimer = 0;
  step(1);
  assert.equal(prospector.oreTarget.tx, 14);
  assert.equal(prospector.oreTarget.ty, 10);
});

test('ore mined by the player before a prospector finishes is not duplicated', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  game.setTile(11, 10, game.GOLD);
  step(10);
  assert.equal(prospector.mining, true);
  game.player.x = 11.5 * 32;
  game.player.y = 11.5 * 32;
  game.camera.x = game.player.x;
  game.camera.y = game.player.y;
  game.pointer.inside = true;
  game.pointer.x = 11.5 * 32 - game.camera.x + 1280 / 2;
  game.pointer.y = 10.5 * 32 - game.camera.y + 800 / 2;
  game.state.tools.pickaxe = 3;
  game.selectTool('pickaxe');
  for (let i = 0; i < 2; i++) { game.state.cooldown = 0; game.swing(); }
  assert.equal(game.getTile(11, 10), game.FLOOR);
  assert.equal(game.pickups.length, 1);
  step(30);
  assert.equal(prospector.haul.gold, 0);
  assert.equal(game.countItem('gold'), 1);
  assert.equal(game.pickups.length, 0);
});

test('prospector-mined ore is dropped on defeat and collected exactly once', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  game.setTile(11, 10, game.GOLD);
  game.setTile(10, 11, game.SILVER);
  step(100);
  assert.equal(prospector.haul.gold, 1);
  assert.equal(prospector.haul.silver, 1);
  game.player.x = prospector.x - 32;
  game.player.y = prospector.y;
  aimSwordAt(game, prospector);
  for (let i = 0; i < 2; i++) { game.state.cooldown = 0; game.swing(); }
  assert.equal(prospector.dead, true);
  assert.equal(game.pickups.length, 2);
  step(30);
  assert.equal(game.countItem('gold'), 1);
  assert.equal(game.countItem('silver'), 1);
  assert.equal(game.pickups.length, 0);
});

test('Auag Cavern naturally spawns neutral prospectors that can harvest its ore', () => {
  const { game, step, math } = createGame();
  let seed = 123456;
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  game.enterLevel('stage3');
  step(500);
  assert.equal(game.state.mode, 'playing');
  assert.equal(game.slimes.length, 0);
  assert.equal(game.moles.length, 0);
  assert.ok(game.prospectors.length > 0 && game.prospectors.length <= game.BALANCE.maxProspectors);
  assert.ok(game.prospectors.some((p) => p.haul.gold + p.haul.silver > 0), 'prospectors should be able to find and mine generated ore');
});

test('large prospector hauls stack and preserve overflow until there is room', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  prospector.haul.gold = 150;
  prospector.haul.silver = 100;
  game.addItem('stone', 792); // eight occupied slots; the haul needs four
  game.player.x = prospector.x - 32;
  game.player.y = prospector.y;
  aimSwordAt(game, prospector);
  for (let i = 0; i < 2; i++) { game.state.cooldown = 0; game.swing(); }
  step(30);
  const total = (item) => game.countItem(item) + game.pickups.filter((p) => p.item === item).reduce((n, p) => n + p.count, 0);
  assert.equal(total('gold'), 150);
  assert.equal(total('silver'), 100);
  assert.ok(game.pickups.length > 0, 'overflow should stay on the ground');
  game.removeItem('stone', 198);
  step(30);
  assert.equal(game.countItem('gold'), 150);
  assert.equal(game.countItem('silver'), 100);
  assert.equal(game.pickups.length, 0);
});

test('unexploded dynamite is cleared on a level transition', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  game.addItem('silver', 1);
  game.player.x = prospector.x + 3 * 32;
  game.player.y = prospector.y;
  step(1);
  assert.equal(game.dynamites.length, 1);
  const cavern = game.level;
  game.enterLevel('stage2');
  assert.equal(cavern.dynamites.length, 0);
  game.enterLevel('stage3');
  assert.equal(game.dynamites.length, 0);
});

test('gold and silver use the documented pickaxe tiers', () => {
  const { game } = createGame();
  game.enterLevel('stage3');
  for (const [tier, hits] of [[1, 5], [2, 3], [3, 2]]) {
    game.state.tools.pickaxe = tier;
    for (const tile of [game.GOLD, game.SILVER]) {
      mine(game, tile);
      let swings = 1;
      while (game.getTile(6, 5) === tile && swings < 6) {
        game.state.cooldown = 0;
        game.swing();
        swings++;
      }
      assert.equal(swings, hits, `tier ${tier} tile ${tile}`);
      assert.equal(game.getTile(6, 5), game.FLOOR);
    }
  }
});

test('treasure in storage does not anger a prospector, and remains safe through death', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  game.storage.gold = 3;
  game.storage.silver = 2;
  game.player.x = prospector.x + 20;
  game.player.y = prospector.y;
  prospector.scanTimer = 999;
  step(1);
  assert.equal(prospector.chasing, false);
  assert.equal(game.state.hp, 100);
  game.addItem('gold', 4);
  game.addItem('silver', 3);
  game.respawnAtBase();
  assert.equal(game.storage.gold, 3);
  assert.equal(game.storage.silver, 2);
  assert.equal(game.countItem('gold'), 2);
  assert.equal(game.countItem('silver'), 2);
});

test('diagonal neighboring tiles take the one-tile dynamite damage', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  game.player.x = prospector.x + 3 * 32;
  game.player.y = prospector.y;
  game.addItem('gold', 1);
  step(1);
  const dynamite = game.dynamites[0];
  prospector.dead = true;
  game.player.x = dynamite.targetX + 32;
  game.player.y = dynamite.targetY + 32;
  step(6);
  step(1, 30); // landing
  step(40); // two seconds on the ground
  assert.equal(game.state.hp, 30);
});

test('prospectors wait eight seconds between dynamite throws', () => {
  const { game, step } = createGame();
  const prospector = prospectingArena(game);
  prospector.speed = 0; // keep the enemy at throwing range for the whole test
  game.addItem('gold', 1);
  game.player.x = prospector.x + 4 * 32;
  game.player.y = prospector.y;
  assert.equal(game.BALANCE.dynamiteThrowCooldown, 8);
  step(1);
  assert.equal(game.dynamites.length, 1);
  assert.equal(prospector.throwCd, 8);

  // Stay in sight but well clear of the first blast.
  game.player.x = prospector.x - 3 * 32;
  step(60); // three seconds: the discarded three-second cooldown must not apply
  assert.equal(game.state.hp, 100);
  assert.equal(game.dynamites.length, 0);
  assert.ok(Math.abs(prospector.throwCd - 5) < 1e-9);
  step(99); // 7.95 seconds since the first throw
  assert.equal(game.dynamites.length, 0);
  assert.ok(prospector.chasing);
  step(1); // eight seconds since the first throw
  assert.equal(game.dynamites.length, 1);
  assert.equal(prospector.throwCd, 8);
});

test('every area restores all original tiles and clears mining damage when revisited', () => {
  for (const id of ['home', 'stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'stage6', 'stage7', 'special']) {
    const { game } = createGame();
    if (id !== 'home') game.enterLevel(id);
    const area = game.level;
    const original = Array.from(area.tiles);
    const originalStalagmites = [...area.stalagmites].sort();
    if (originalStalagmites.length) area.stalagmites.delete(originalStalagmites[0]);
    const floor = original.indexOf(game.FLOOR);
    const wall = original.indexOf(game.WALL);
    assert.ok(floor >= 0 && wall >= 0, `${id} needs floor and walls`);
    game.setTile(floor % area.w, Math.floor(floor / area.w), game.WALL);
    game.setTile(wall % area.w, Math.floor(wall / area.w), game.FLOOR);
    area.damage.set('2,2', 2);
    game.addItem('gold', 4);
    game.storage.copper = 5;
    game.melter.coal = 3;
    game.state.tools.pickaxe = 2;
    game.state.hp = 73;

    game.enterLevel(id === 'home' ? 'stage1' : 'home');
    assert.equal(area.tiles[floor], game.WALL, 'the area is only restored when entered');
    game.enterLevel(id);
    assert.equal(game.level, area, `${id} should keep its level state`);
    assert.deepEqual(Array.from(area.tiles), original, `${id} must restore every tile`);
    assert.deepEqual([...area.stalagmites].sort(), originalStalagmites, `${id} must restore its stalagmites`);
    assert.equal(area.damage.size, 0, `${id} must clear partial mining damage`);
    assert.equal(game.countItem('gold'), 4);
    assert.equal(game.storage.copper, 5);
    assert.equal(game.melter.coal, 3);
    assert.equal(game.state.tools.pickaxe, 2);
    assert.equal(game.state.hp, 73);
  }
});

function findReachableOre(game, ore) {
  const lv = game.level;
  const reachable = reachableWalkableTiles(game, lv);
  for (let ty = 1; ty < lv.h - 1; ty++) {
    for (let tx = 1; tx < lv.w - 1; tx++) {
      if (game.getTile(tx, ty) !== ore) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (game.getTile(tx + dx, ty + dy) === game.FLOOR && reachable.has(`${tx + dx},${ty + dy}`)) {
          return { tx, ty, adjacentX: tx + dx, adjacentY: ty + dy };
        }
      }
    }
  }
  throw new Error('no reachable ore found');
}

test('restored rock cannot bury a full-bag pickup or duplicate it', () => {
  const { game, step } = createGame();
  game.enterLevel('stage3');
  game.level.prospectorTimer = 999;
  const ore = findReachableOre(game, game.GOLD);
  game.addItem('stone', 990);
  game.player.x = (ore.adjacentX + 0.5) * 32;
  game.player.y = (ore.adjacentY + 0.5) * 32;
  game.camera.x = game.player.x;
  game.camera.y = game.player.y;
  game.pointer.inside = true;
  game.pointer.x = (ore.tx + 0.5) * 32 - game.camera.x + 1280 / 2;
  game.pointer.y = (ore.ty + 0.5) * 32 - game.camera.y + 800 / 2;
  game.state.tools.pickaxe = 3;
  game.selectTool('pickaxe');
  for (let i = 0; i < 2; i++) { game.state.cooldown = 0; game.swing(); }
  assert.equal(game.getTile(ore.tx, ore.ty), game.FLOOR);
  const drop = game.pickups[0];
  step(25);
  assert.equal(drop.phase, 'ground');
  assert.equal(game.pickups.length, 1);
  game.enterLevel('stage2');
  game.enterLevel('stage3');
  assert.equal(game.getTile(ore.tx, ore.ty), game.GOLD);
  assert.equal(game.pickups.length, 1);
  assert.equal(game.pickups[0], drop);
  const dropX = Math.floor(drop.x / 32), dropY = Math.floor(drop.y / 32);
  assert.equal(game.getTile(dropX, dropY), game.FLOOR);
  assert.ok(reachableWalkableTiles(game, game.level).has(`${dropX},${dropY}`));
  game.removeItem('stone', 99);
  game.player.x = drop.x;
  game.player.y = drop.y;
  step(30);
  assert.equal(game.countItem('gold'), 1);
  assert.equal(game.pickups.length, 0);
  assert.equal(game.state.oreHauled, 1);
});

test('resetting rock safely relocates trapped prospectors without losing their haul', () => {
  const { game, step } = createGame();
  game.enterLevel('stage3');
  game.level.prospectorTimer = 999;
  const ore = findReachableOre(game, game.GOLD);
  game.setTile(ore.tx, ore.ty, game.FLOOR);
  const prospector = game.makeProspector((ore.tx + 0.5) * 32, (ore.ty + 0.5) * 32);
  prospector.haul.gold = 3;
  prospector.hp = 20;
  prospector.oreTarget = { tx: ore.tx + 1, ty: ore.ty, route: [], routeIndex: 0 };
  prospector.mineProgress = 0.8;
  prospector.knockX = 40;
  game.prospectors.push(prospector);
  game.enterLevel('stage2');
  game.enterLevel('stage3');
  assert.equal(game.getTile(ore.tx, ore.ty), game.GOLD);
  assert.ok(game.prospectors.includes(prospector));
  assert.equal(prospector.haul.gold, 3);
  assert.equal(prospector.hp, 20);
  assert.equal(prospector.oreTarget, null);
  assert.equal(prospector.mineProgress, 0);
  assert.equal(prospector.knockX, 0);
  const tx = Math.floor(prospector.x / 32), ty = Math.floor(prospector.y / 32);
  assert.equal(game.getTile(tx, ty), game.FLOOR);
  assert.ok(reachableWalkableTiles(game, game.level).has(`${tx},${ty}`));
  for (const [dx, dy] of [[-prospector.r, -prospector.r], [prospector.r, -prospector.r], [-prospector.r, prospector.r], [prospector.r, prospector.r]]) {
    assert.equal(game.TILES[game.getTile(Math.floor((prospector.x + dx) / 32), Math.floor((prospector.y + dy) / 32))].solid, false);
  }

  // Its preserved haul can still be recovered exactly once after the reset.
  game.player.x = prospector.x - 32;
  game.player.y = prospector.y;
  aimSwordAt(game, prospector);
  game.state.cooldown = 0;
  game.swing();
  assert.equal(prospector.dead, true);
  assert.equal(game.pickups.find((pickup) => pickup.item === 'gold').count, 3);
  step(30);
  assert.equal(game.countItem('gold'), 3);
  assert.equal(game.pickups.length, 0);
});

test('mined ore and cracks reset after a real stair trip, without losing the pickup', () => {
  const { game, elements, step } = createGame();
  game.enterLevel('stage2');
  const stage2 = game.level;
  const original = Array.from(stage2.tiles);
  const hit = (ore) => {
    game.player.x = (ore.adjacentX + 0.5) * 32;
    game.player.y = (ore.adjacentY + 0.5) * 32;
    game.camera.x = game.player.x;
    game.camera.y = game.player.y;
    game.state.cooldown = 0;
    elements.game.dispatch('pointerdown', {
      pointerType: 'mouse',
      clientX: (ore.tx + 0.5) * 32 - game.camera.x + 1280 / 2,
      clientY: (ore.ty + 0.5) * 32 - game.camera.y + 800 / 2,
    });
  };
  game.selectTool('pickaxe');
  game.state.tools.pickaxe = 3;
  const mined = findReachableOre(game, game.IRON);
  hit(mined);
  hit(mined);
  assert.equal(game.getTile(mined.tx, mined.ty), game.FLOOR);
  const cracked = findReachableOre(game, game.IRON);
  game.state.tools.pickaxe = 1;
  hit(cracked);
  assert.equal(stage2.damage.get(`${cracked.tx},${cracked.ty}`), 1);

  // Trigger the actual down stairs, then the up stairs in Auag Cavern.
  const down = stage2.stairsDown;
  game.player.x = (down.tx + 0.5) * 32;
  game.player.y = (down.ty + 0.5) * 32;
  game.state.transitionLock = 0;
  step(1);
  assert.equal(game.level.id, 'stage3');
  assert.equal(game.countItem('iron'), 1, 'the interrupted pickup must be credited once');
  assert.equal(stage2.tiles[mined.ty * stage2.w + mined.tx], game.FLOOR);
  const up = game.level.stairsUp;
  game.player.x = (up.tx + 0.5) * 32;
  game.player.y = (up.ty + 0.5) * 32;
  game.state.transitionLock = 0;
  step(1);
  assert.equal(game.level, stage2);
  assert.deepEqual(Array.from(stage2.tiles), original);
  assert.equal(stage2.damage.size, 0);
  assert.equal(game.getTile(mined.tx, mined.ty), game.IRON);
  assert.equal(game.getTile(cracked.tx, cracked.ty), game.IRON);
  assert.equal(game.countItem('iron'), 1);
});

test('a new run gets a newly seeded terrain snapshot instead of the previous run', () => {
  const { game, math } = createGame();
  math.random = () => 0.99; // stone wherever ore can spawn
  game.enterLevel('stage2');
  const first = Array.from(game.level.tiles);
  game.start();
  math.random = () => 0.01; // iron wherever ore can spawn
  game.enterLevel('stage2');
  const second = Array.from(game.level.tiles);
  assert.notDeepEqual(second, first);
  assert.ok(second.includes(game.IRON));
  assert.ok(!first.includes(game.IRON));
  const iron = second.indexOf(game.IRON);
  game.setTile(iron % game.level.w, Math.floor(iron / game.level.w), game.FLOOR);
  game.enterLevel('home');
  game.enterLevel('stage2');
  assert.deepEqual(Array.from(game.level.tiles), second);
});

test('ore destroyed by a Drill Mole also returns after the area is revisited', () => {
  const { game, step, math } = createGame();
  game.enterLevel('stage2');
  game.level.slimeTimer = game.level.moleTimer = 999;
  const ore = findReachableOre(game, game.IRON);
  const mole = game.makeMole((ore.adjacentX + 0.5) * 32, (ore.adjacentY + 0.5) * 32);
  game.moles.push(mole);
  game.player.x = (ore.tx + 0.5) * 32;
  game.player.y = (ore.ty + 0.5) * 32;
  game.state.invuln = 999;
  math.random = () => 0.01;
  step(8);
  assert.equal(game.getTile(ore.tx, ore.ty), game.FLOOR);
  assert.equal(game.pickups.length, 0, 'mole-destroyed ore must still drop nothing');
  game.enterLevel('stage1');
  game.enterLevel('stage2');
  assert.equal(game.getTile(ore.tx, ore.ty), game.IRON);
  assert.equal(game.countItem('iron'), 0);
});

test('a Prospector keeps its mined haul while the original ore regenerates', () => {
  const { game, step } = createGame();
  game.enterLevel('stage3');
  game.level.prospectorTimer = 999;
  const ore = findReachableOre(game, game.GOLD);
  const prospector = game.makeProspector((ore.adjacentX + 0.5) * 32, (ore.adjacentY + 0.5) * 32);
  prospector.speed = 0;
  prospector.oreTarget = { tx: ore.tx, ty: ore.ty, tile: game.GOLD,
    goalTx: ore.adjacentX, goalTy: ore.adjacentY, route: [], routeIndex: 0 };
  game.prospectors.push(prospector);
  step(23);
  assert.equal(game.getTile(ore.tx, ore.ty), game.FLOOR);
  assert.equal(prospector.haul.gold, 1);
  game.enterLevel('stage2');
  game.enterLevel('stage3');
  assert.equal(game.getTile(ore.tx, ore.ty), game.GOLD);
  assert.ok(game.prospectors.includes(prospector));
  assert.equal(prospector.haul.gold, 1);
});

test('Auag Cavern leads both ways to Stalag Cavern with its requested title', () => {
  const { game, elements, step } = createGame();
  game.enterLevel('stage3');
  const stage3 = game.level;
  const down = stage3.stairsDown;
  assert.equal(stage3.downTarget, 'stage4');
  assert.equal(stage3.tiles[down.ty * stage3.w + down.tx], game.STAIRS_DOWN);
  assert.ok(reachableWalkableTiles(game, stage3).has(`${down.tx},${down.ty}`));
  game.player.x = (down.tx + 0.5) * 32;
  game.player.y = (down.ty + 0.5) * 32;
  game.state.transitionLock = 0;
  step(1);
  assert.equal(game.level.id, 'stage4');
  assert.equal(elements['stage-name'].textContent, 'Stalag Cavern');
  assert.equal(elements['area-kicker'].textContent, 'Stage 04');
  assert.equal(elements['area-subtitle'].textContent, 'The calcium grows into spikes here');
  assert.ok(elements['area-banner'].classList.contains('is-arriving'));
  assert.equal(game.level.upTarget, 'stage3');
  const up = game.level.stairsUp;
  game.player.x = (up.tx + 0.5) * 32;
  game.player.y = (up.ty + 0.5) * 32;
  game.state.transitionLock = 0;
  step(1);
  assert.equal(game.level, stage3);
  assert.equal(Math.floor(game.player.x / 32), down.tx);
  assert.equal(Math.floor(game.player.y / 32), down.ty - 1);
});

test('Stalag Cavern has its requested ores and connected, ground-only stalagmites', () => {
  const { game } = createGame();
  game.enterLevel('stage4');
  const area = game.level;
  for (const tile of [game.STONE, game.IRON, game.GOLD]) assert.ok([...area.tiles].includes(tile));
  for (const tile of [game.COAL, game.COPPER, game.SILVER, game.STALAGMITE]) {
    assert.ok(![...area.tiles].includes(tile), `unexpected rock or embedded stalagmite: ${tile}`);
  }
  assert.ok(area.stalagmites.size >= 30, 'there should be plenty of formations');
  const reachable = reachableWalkableTiles(game, area);
  let floorCount = 0, wallSide = 0, openSide = 0;
  for (let ty = 0; ty < area.h; ty++) for (let tx = 0; tx < area.w; tx++) {
    const tile = area.tiles[ty * area.w + tx];
    const key = `${tx},${ty}`;
    if (!game.TILES[tile].solid && !area.stalagmites.has(key)) floorCount++;
    if (!area.stalagmites.has(key)) continue;
    assert.equal(tile, game.FLOOR, `${key} must be on floor, never in any wall or ore`);
    assert.ok(game.isSolid(tx, ty), 'a formation should be a mineable obstacle');
    const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    assert.ok(sides.some(([dx, dy]) => reachable.has(`${tx + dx},${ty + dy}`)), 'formation must be mineable from reachable floor');
    if (sides.some(([dx, dy]) => game.TILES[area.tiles[(ty + dy) * area.w + tx + dx]].solid)) wallSide++;
    else openSide++;
  }
  assert.equal(reachable.size, floorCount, 'spikes must not disconnect the cave');
  assert.ok(wallSide > 0, 'some formations should sit next to walls');
  assert.ok(openSide > 0, 'some formations should stand in the open');
  assert.equal(area.stalagmites.has(`${area.stairsUp.tx},${area.stairsUp.ty}`), false);
  assert.equal(game.isSolid(Math.floor(area.spawn.x / 32), Math.floor(area.spawn.y / 32)), false);
  for (let x = 0; x < area.w; x++) {
    assert.equal(area.tiles[x], game.WALL);
    assert.equal(area.tiles[(area.h - 1) * area.w + x], game.WALL);
  }
});

function findReachableStalagmite(game) {
  const lv = game.level, reachable = reachableWalkableTiles(game, lv);
  for (const key of lv.stalagmites) {
    const [tx, ty] = key.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const adjacentX = tx + dx, adjacentY = ty + dy;
      if (game.getTile(adjacentX, adjacentY) === game.FLOOR && reachable.has(`${adjacentX},${adjacentY}`)) {
        return { tx, ty, adjacentX, adjacentY, key };
      }
    }
  }
  throw new Error('no reachable stalagmite');
}

function aimPickaxeAt(game, target) {
  game.player.x = (target.adjacentX + 0.5) * 32;
  game.player.y = (target.adjacentY + 0.5) * 32;
  game.camera.x = game.player.x;
  game.camera.y = game.player.y;
  game.pointer.inside = true;
  game.pointer.x = (target.tx + 0.5) * 32 - game.camera.x + 1280 / 2;
  game.pointer.y = (target.ty + 0.5) * 32 - game.camera.y + 800 / 2;
  game.selectTool('pickaxe');
}

test('mouse and Space mine floor stalagmites for collectable, storable Calcite', () => {
  const { game, elements, listeners, step } = createGame();
  game.enterLevel('stage4');
  game.level.prospectorTimer = game.level.slimeTimer = game.level.spiderTimer = 999;
  const target = findReachableStalagmite(game);
  aimPickaxeAt(game, target);
  game.state.cooldown = 0;
  elements.game.dispatch('pointerdown', { clientX: game.pointer.x, clientY: game.pointer.y, pointerType: 'mouse' });
  assert.ok(game.level.stalagmites.has(target.key));
  assert.equal(game.level.damage.get(target.key), 1);
  assert.equal(game.getTile(target.tx, target.ty), game.FLOOR);
  game.state.cooldown = 0;
  listeners.keydown[0]({ code: 'Space', repeat: false, preventDefault: noop });
  assert.equal(game.level.stalagmites.has(target.key), false);
  assert.equal(game.level.damage.has(target.key), false);
  assert.equal(game.getTile(target.tx, target.ty), game.FLOOR);
  assert.equal(game.pickups.length, 1);
  assert.equal(game.pickups[0].item, 'calcite');
  step(25);
  assert.equal(game.countItem('calcite'), 1);
  assert.equal(game.state.oreHauled, 1);
  game.enterLevel('home');
  game.openStation('storage');
  assert.equal(game.depositToStorage('calcite', 1), 1);
  assert.equal(game.storage.calcite, 1);
  game.closeStation();
  game.respawnAtBase();
  assert.equal(game.storage.calcite, 1);
});

test('T2 and T3 pickaxes mine a stalagmite in one hit without changing the floor', () => {
  for (const tier of [2, 3]) {
    const { game } = createGame();
    game.enterLevel('stage4');
    const target = findReachableStalagmite(game);
    aimPickaxeAt(game, target);
    game.state.tools.pickaxe = tier;
    game.state.cooldown = 0;
    game.swing();
    assert.equal(game.level.stalagmites.has(target.key), false);
    assert.equal(game.getTile(target.tx, target.ty), game.FLOOR);
    assert.equal(game.pickups[0].item, 'calcite');
  }
});

function stage4Arena(game) {
  game.enterLevel('stage4');
  game.level.slimeTimer = game.level.spiderTimer = game.level.prospectorTimer = 999;
  for (let y = 7; y <= 25; y++) for (let x = 7; x <= 33; x++) {
    game.setTile(x, y, game.FLOOR);
    game.level.stalagmites.delete(`${x},${y}`);
    game.level.damage.delete(`${x},${y}`);
  }
  game.player.x = 22.5 * 32;
  game.player.y = 10.5 * 32;
}

test('Large Slimes have double health and damage, six-tile sight and half speed', () => {
  const { game, step } = createGame();
  stage4Arena(game);
  const normal = game.makeSlime(10.5 * 32, 10.5 * 32, false);
  const large = game.makeSlime(10.5 * 32, 10.5 * 32, false, true);
  assert.equal(large.hp, normal.hp * 2);
  assert.equal(large.dmg, normal.dmg * 2);
  assert.equal(large.detect, normal.detect + 2 * 32);
  assert.equal(large.speed, normal.speed / 2);
  assert.ok(large.r > normal.r);
  assert.equal(large.large, true);
  game.slimes.push(large);
  game.player.x = large.x + 5.5 * 32;
  game.player.y = large.y;
  const before = large.x;
  step(1);
  assert.equal(large.chasing, true);
  assert.ok(Math.abs(large.x - before - normal.speed / 2 * 0.05) < 1e-8);
  game.player.x = large.x + 6.1 * 32;
  step(1);
  assert.equal(large.chasing, false);

  large.x = game.player.x - 15;
  large.y = game.player.y;
  large.speed = 0;
  large.attackCd = 0;
  game.state.invuln = 0;
  step(1);
  assert.equal(game.state.hp, 60, 'one Large Slime hit should deal 40 damage');
});

test('defeated Large Slimes split into two untouched regular slimes', () => {
  const { game } = createGame();
  stage4Arena(game);
  const large = game.makeSlime(game.player.x + 32, game.player.y, false, true);
  game.slimes.push(large);
  aimSwordAt(game, large);
  game.state.cooldown = 0;
  game.swing();
  assert.equal(large.hp, 30);
  assert.equal(game.slimes.length, 1);
  game.state.cooldown = 0;
  game.swing();
  assert.equal(large.dead, true);
  const children = game.slimes.filter((slime) => !slime.dead);
  assert.equal(children.length, 2);
  for (const child of children) {
    assert.equal(child.large, false);
    assert.equal(child.tiny, false);
    assert.equal(child.hp, game.BALANCE.slimeHp);
    assert.equal(child.dmg, game.BALANCE.slimeDamage);
    assert.equal(child.speed, game.BALANCE.slimeSpeed);
  }
  children[0].x = game.player.x + 32;
  children[0].y = game.player.y;
  children[1].x = game.player.x - 120;
  children[1].y = game.player.y;
  aimSwordAt(game, children[0]);
  game.state.cooldown = 0;
  game.swing();
  assert.equal(children[0].dead, true);
  assert.equal(game.slimes.filter((slime) => !slime.dead && slime.tiny).length, 2);
});

test('Spiders move quickly, have low health and attack for five damage at a fast cadence', () => {
  const { game, step } = createGame();
  stage4Arena(game);
  const spider = game.makeSpider(18.5 * 32, 10.5 * 32);
  assert.ok(spider.hp < game.BALANCE.slimeHp);
  assert.equal(spider.dmg, 5);
  assert.ok(spider.speed >= game.BALANCE.slimeSpeed * 2);
  assert.ok(game.BALANCE.spiderAttackEvery < 1);
  game.spiders.push(spider);
  const before = spider.x;
  step(1);
  assert.equal(spider.chasing, true);
  assert.ok(Math.abs(spider.x - before - spider.speed * 0.05) < 1e-8);

  spider.speed = 0;
  spider.x = game.player.x + 15;
  spider.y = game.player.y;
  spider.attackCd = 0;
  game.state.invuln = 0;
  const px = game.player.x, py = game.player.y;
  step(1);
  assert.equal(game.state.hp, 95);
  assert.equal(spider.attackCd, game.BALANCE.spiderAttackEvery);
  game.player.x = px;
  game.player.y = py;
  step(7);
  assert.equal(game.state.hp, 95);
  step(1);
  assert.equal(game.state.hp, 90, 'the spider attacks again after 0.4 seconds');
});

test('Spiders path around stalagmites and can be defeated without splitting', () => {
  const { game, elements, step } = createGame();
  stage4Arena(game);
  game.level.stalagmites.add('12,10');
  const spider = game.makeSpider(10.5 * 32, 10.5 * 32);
  game.spiders.push(spider);
  game.player.x = 14.5 * 32;
  game.player.y = 10.5 * 32;
  game.state.invuln = 999;
  step(70);
  assert.ok(Math.hypot(game.player.x - spider.x, game.player.y - spider.y) < 40, 'spider should navigate around the spike');
  assert.ok(game.level.stalagmites.has('12,10'));
  game.player.x = spider.x - 30;
  game.player.y = spider.y;
  aimSwordAt(game, spider);
  game.state.tools.sword = 1;
  game.state.cooldown = 0;
  game.swing();
  assert.equal(spider.hp, 5);
  game.state.cooldown = 0;
  game.swing();
  assert.equal(spider.dead, true);
  assert.equal(game.state.spidersSlain, 1);
  assert.equal(game.slimes.length, 0, 'spiders do not split');
  const killer = game.makeSpider(game.player.x + 10, game.player.y);
  killer.speed = 0;
  game.spiders.push(killer);
  game.state.hp = 5;
  game.state.invuln = 0;
  step(1);
  assert.equal(game.state.mode, 'dead');
  assert.equal(elements['over-spiders'].textContent, '1');
});

test('Stalag Cavern naturally spawns Prospectors, Large Slimes and Spiders only', () => {
  const { game, math, step } = createGame();
  game.enterLevel('stage4');
  let seed = 18139;
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  game.level.slimeTimer = game.level.spiderTimer = game.level.prospectorTimer = 0;
  step(1);
  assert.ok(game.slimes.length > 0 && game.slimes.every((slime) => slime.large));
  assert.ok(game.spiders.length > 0);
  assert.ok(game.prospectors.length > 0);
  assert.equal(game.moles.length, 0);
  game.enterLevel('stage3');
  assert.equal(game.slimes.length, 0);
  assert.equal(game.spiders.length, 0);
});

test('Stage 4 Prospectors navigate around stalagmites and mine Gold normally', () => {
  const { game, step } = createGame();
  stage4Arena(game);
  game.player.x = 25.5 * 32;
  game.player.y = 20.5 * 32;
  game.level.stalagmites.add('12,10');
  game.setTile(14, 10, game.GOLD);
  const prospector = game.makeProspector(10.5 * 32, 10.5 * 32);
  game.prospectors.push(prospector);
  step(240);
  assert.equal(game.getTile(14, 10), game.FLOOR);
  assert.ok(prospector.haul.gold >= 1);
  assert.ok(game.level.stalagmites.has('12,10'));
  assert.equal(game.countItem('calcite'), 0);
});

test('stalagmites reset on return without burying a full-bag Calcite drop', () => {
  const { game, step } = createGame();
  game.addItem('stone', 990);
  game.enterLevel('stage4');
  game.level.prospectorTimer = game.level.slimeTimer = game.level.spiderTimer = 999;
  const area = game.level;
  const formations = [...area.stalagmites].sort();
  const target = findReachableStalagmite(game);
  aimPickaxeAt(game, target);
  game.state.tools.pickaxe = 2;
  game.state.cooldown = 0;
  game.swing();
  const drop = game.pickups[0];
  step(25);
  assert.equal(drop.phase, 'ground');
  assert.equal(drop.item, 'calcite');
  game.enterLevel('stage4');
  assert.equal(area.stalagmites.has(target.key), false, 'staying in the same area should not reset it');
  game.enterLevel('stage3');
  game.enterLevel('stage4');
  assert.deepEqual([...area.stalagmites].sort(), formations);
  assert.ok(area.stalagmites.has(target.key));
  assert.equal(game.pickups.length, 1);
  assert.equal(game.pickups[0], drop);
  const dx = Math.floor(drop.x / 32), dy = Math.floor(drop.y / 32);
  assert.equal(game.isSolid(dx, dy), false);
  assert.ok(reachableWalkableTiles(game, area).has(`${dx},${dy}`));
  game.removeItem('stone', 99);
  game.player.x = drop.x;
  game.player.y = drop.y;
  step(30);
  assert.equal(game.countItem('calcite'), 1);
  assert.equal(game.pickups.length, 0);
  assert.equal(game.state.oreHauled, 1);
});

test('restored stalagmites safely relocate a Prospector and preserve its haul', () => {
  const { game } = createGame();
  game.enterLevel('stage4');
  const target = findReachableStalagmite(game);
  game.level.stalagmites.delete(target.key);
  const prospector = game.makeProspector((target.tx + 0.5) * 32, (target.ty + 0.5) * 32);
  prospector.haul.gold = 4;
  prospector.hp = 21;
  prospector.oreTarget = { tx: target.tx, ty: target.ty, route: [], routeIndex: 0 };
  game.prospectors.push(prospector);
  game.enterLevel('stage3');
  game.enterLevel('stage4');
  assert.ok(game.level.stalagmites.has(target.key));
  assert.ok(game.prospectors.includes(prospector));
  assert.equal(prospector.hp, 21);
  assert.equal(prospector.haul.gold, 4);
  assert.equal(prospector.oreTarget, null);
  const tx = Math.floor(prospector.x / 32), ty = Math.floor(prospector.y / 32);
  assert.equal(game.isSolid(tx, ty), false);
  assert.ok(reachableWalkableTiles(game, game.level).has(`${tx},${ty}`));
  for (const [dx, dy] of [[-prospector.r, -prospector.r], [prospector.r, -prospector.r], [-prospector.r, prospector.r], [prospector.r, prospector.r]]) {
    assert.equal(game.isSolid(Math.floor((prospector.x + dx) / 32), Math.floor((prospector.y + dy) / 32)), false);
  }
});

test('even extreme random seeds keep the Stage 4 minerals and all spikes on floor', () => {
  for (const randomValue of [0.01, 0.5, 0.99]) {
    const { game, math } = createGame();
    math.random = () => randomValue;
    game.enterLevel('stage4');
    const area = game.level;
    for (const tile of [game.STONE, game.IRON, game.GOLD]) assert.ok(area.tiles.includes(tile));
    assert.ok(area.stalagmites.size > 0);
    for (const key of area.stalagmites) {
      const [tx, ty] = key.split(',').map(Number);
      assert.equal(area.tiles[ty * area.w + tx], game.FLOOR, `${key} is not floor`);
    }
    const reachable = reachableWalkableTiles(game, area);
    let walkable = 0;
    for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) {
      if (!game.TILES[area.tiles[y * area.w + x]].solid && !area.stalagmites.has(`${x},${y}`)) walkable++;
    }
    assert.equal(reachable.size, walkable);
  }
});

test('Stalag Cavern leaves routes for Large Slimes through its chambers', () => {
  const { game } = createGame();
  game.enterLevel('stage4');
  const area = game.level, r = game.BALANCE.largeSlimeRadius;
  const fits = (x, y) => {
    const px = (x + 0.5) * 32, py = (y + 0.5) * 32;
    for (let ty = Math.floor((py - r) / 32); ty <= Math.floor((py + r - 0.001) / 32); ty++) {
      for (let tx = Math.floor((px - r) / 32); tx <= Math.floor((px + r - 0.001) / 32); tx++) {
        if (game.isSolid(tx, ty)) return false;
      }
    }
    return true;
  };
  const sx = Math.floor(area.spawn.x / 32), sy = Math.floor(area.spawn.y / 32);
  assert.ok(fits(sx, sy));
  const seen = new Set([`${sx},${sy}`]), queue = [[sx, sy]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (!seen.has(key) && fits(nx, ny)) { seen.add(key); queue.push([nx, ny]); }
    }
  }
  for (const [cx, cy] of [[8, 8], [24, 8], [44, 10], [51, 23], [32, 22], [13, 23], [18, 37], [40, 36]]) {
    assert.ok([...seen].some((key) => {
      const [x, y] = key.split(',').map(Number);
      return Math.abs(x - cx) <= 4 && Math.abs(y - cy) <= 3;
    }), `a Large Slime should be able to reach the chamber near ${cx},${cy}`);
  }
});

test('spider bites respect invulnerability from other attacks', () => {
  const { game, step } = createGame();
  stage4Arena(game);
  const spider = game.makeSpider(game.player.x + 15, game.player.y);
  spider.speed = 0;
  game.spiders.push(spider);
  game.state.invuln = game.BALANCE.invulnerableTime;
  step(1);
  assert.equal(game.state.hp, 100);
  assert.ok(game.state.invuln > game.BALANCE.spiderHitInvulnerability);
});

test('a partially mined stalagmite heals when you leave and return', () => {
  const { game } = createGame();
  game.enterLevel('stage4');
  const target = findReachableStalagmite(game);
  aimPickaxeAt(game, target);
  game.state.cooldown = 0;
  game.swing();
  assert.equal(game.level.damage.get(target.key), 1);
  game.enterLevel('stage3');
  game.enterLevel('stage4');
  assert.ok(game.level.stalagmites.has(target.key));
  assert.equal(game.level.damage.has(target.key), false);
  aimPickaxeAt(game, target);
  game.state.cooldown = 0;
  game.swing();
  assert.ok(game.level.stalagmites.has(target.key), 'it should require two fresh T1 hits');
  assert.equal(game.level.damage.get(target.key), 1);
});

test('a new run builds a fresh Stalag Cavern and clears spider and Calcite progress', () => {
  const { game } = createGame();
  game.enterLevel('stage4');
  const old = game.level;
  game.addItem('calcite', 2);
  game.storage.calcite = 3;
  game.state.spidersSlain = 1;
  game.spiders.push(game.makeSpider(game.player.x + 48, game.player.y));
  game.start();
  assert.equal(game.level.id, 'home');
  assert.equal(game.spiders.length, 0);
  assert.equal(game.state.spidersSlain, 0);
  assert.equal(game.countItem('calcite'), 0);
  assert.equal(game.storage.calcite, 0);
  game.enterLevel('stage4');
  assert.notEqual(game.level, old);
  assert.ok(game.level.stalagmites.size > 0);
});

// Stage 5 and the Home Base coin economy

test('Stalag Cavern has a clear two-way stair connection to Alumina Cave', () => {
  const { game, elements, step } = createGame();
  game.enterLevel('stage4');
  const stage4 = game.level, down = stage4.stairsDown;
  assert.equal(stage4.downTarget, 'stage5');
  assert.equal(stage4.tiles[down.ty * stage4.w + down.tx], game.STAIRS_DOWN);
  assert.ok(reachableWalkableTiles(game, stage4).has(`${down.tx},${down.ty}`));
  for (const key of stage4.stalagmites) {
    const [x, y] = key.split(',').map(Number);
    assert.ok(Math.hypot(x - down.tx, y - down.ty) >= 4, 'arrival and stairs must stay clear');
  }
  game.player.x = (down.tx + 0.5) * 32;
  game.player.y = (down.ty + 0.5) * 32;
  game.state.transitionLock = 0;
  step(1);
  assert.equal(game.level.id, 'stage5');
  assert.equal(game.level.name, 'Alumina Cave');
  assert.equal(elements['stage-name'].textContent, 'Alumina Cave');
  assert.equal(elements['area-kicker'].textContent, 'Stage 05');
  assert.equal(game.level.upTarget, 'stage4');
  const up = game.level.stairsUp;
  game.player.x = (up.tx + 0.5) * 32;
  game.player.y = (up.ty + 0.5) * 32;
  game.state.transitionLock = 0;
  step(1);
  assert.equal(game.level, stage4);
  assert.equal(Math.floor(game.player.x / 32), down.tx);
  assert.equal(Math.floor(game.player.y / 32), down.ty - 1);
  assert.equal(game.isSolid(Math.floor(game.player.x / 32), Math.floor(game.player.y / 32)), false);
});

test('Alumina Cave is connected and contains Stone, Iron, and Bauxite only', () => {
  for (const randomValue of [0.01, 0.5, 0.99]) {
    const { game, math } = createGame();
    math.random = () => randomValue;
    game.enterLevel('stage5');
    const area = game.level;
    for (const tile of [game.STONE, game.IRON, game.BAUXITE]) assert.ok(area.tiles.includes(tile));
    for (const tile of [game.COAL, game.COPPER, game.GOLD, game.SILVER, game.STALAGMITE]) {
      assert.ok(!area.tiles.includes(tile), `unexpected tile ${tile}`);
    }
    assert.equal(area.stalagmites.size, 0);
    const reachable = reachableWalkableTiles(game, area);
    let walkable = 0;
    for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) {
      if (!game.TILES[area.tiles[y * area.w + x]].solid) walkable++;
    }
    assert.equal(reachable.size, walkable);
    for (const ore of [game.STONE, game.IRON, game.BAUXITE]) assert.ok(findReachableOre(game, ore));
    for (let x = 0; x < area.w; x++) {
      assert.equal(area.tiles[x], game.WALL);
      assert.equal(area.tiles[(area.h - 1) * area.w + x], game.WALL);
    }
  }
});

test('Bauxite uses the pickaxe tiers and produces a collectible ore', () => {
  const { game, step } = createGame();
  game.enterLevel('stage5');
  game.level.slimeTimer = game.level.spiderTimer = game.level.golemTimer = 999;
  for (const [tier, hits] of [[1, 5], [2, 3], [3, 2]]) {
    game.state.tools.pickaxe = tier;
    mine(game, game.BAUXITE);
    let swings = 1;
    while (game.getTile(6, 5) === game.BAUXITE && swings < 6) {
      game.state.cooldown = 0;
      game.swing();
      swings++;
    }
    assert.equal(swings, hits);
    assert.equal(game.getTile(6, 5), game.FLOOR);
  }
  assert.equal(game.pickups.length, 3);
  assert.ok(game.pickups.every((p) => p.item === 'bauxite'));
  step(25);
  assert.equal(game.countItem('bauxite'), 3);
});

test('Bauxite safely selects in the Melter and becomes Aluminum with coal', () => {
  const { game, elements, step } = createGame();
  game.addItem('copper', 1);
  game.addItem('iron', 1);
  game.addItem('bauxite', 2);
  game.addItem('coal', 1);
  game.openStation('melter');
  elements['slot-input'].click();
  elements['ore-bauxite'].click();
  assert.equal(game.melter.selectedOre, 'copper', 'cannot replace loaded copper');
  assert.match(elements['melter-hint'].textContent, /return its copper/);
  elements['slot-input'].click({ shiftKey: true });
  elements['ore-iron'].click();
  elements['slot-input'].click();
  elements['ore-bauxite'].click();
  assert.equal(game.melter.selectedOre, 'iron', 'cannot replace loaded iron');
  elements['slot-input'].click({ shiftKey: true });
  elements['ore-bauxite'].click();
  assert.equal(game.melter.selectedOre, 'bauxite');
  assert.equal(elements['ore-bauxite'].attributes['aria-pressed'], 'true');
  elements['slot-input'].click();
  elements['slot-fuel'].click();
  assert.equal(elements['melt-btn'].disabled, false);
  elements['melt-btn'].click();
  assert.equal(game.melter.bauxite, 0);
  assert.equal(game.melter.coal, 0);
  assert.equal(game.pickups.filter((p) => p.item === 'aluminum').length, 1);
  step(30);
  assert.equal(game.countItem('aluminum'), 1);
  assert.equal(game.countItem('bauxite'), 1);
});

test('Alumina terrain resets without losing a Bauxite drop or player progress', () => {
  const { game, step } = createGame();
  game.addItem('stone', 990);
  game.enterLevel('stage5');
  game.level.slimeTimer = game.level.spiderTimer = game.level.golemTimer = 999;
  const area = game.level, ore = findReachableOre(game, game.BAUXITE);
  aimPickaxeAt(game, ore);
  game.state.tools.pickaxe = 3;
  game.state.cooldown = 0; game.swing();
  assert.equal(area.damage.get(`${ore.tx},${ore.ty}`), 1);
  game.state.cooldown = 0; game.swing();
  assert.equal(game.getTile(ore.tx, ore.ty), game.FLOOR);
  const drop = game.pickups[0];
  step(25);
  assert.equal(drop.phase, 'ground');
  game.storage.aluminum = 3;
  game.melter.bauxite = 2;
  game.state.tools.sword = 2;
  game.enterLevel('stage4');
  game.enterLevel('stage5');
  assert.equal(game.level, area);
  assert.equal(game.getTile(ore.tx, ore.ty), game.BAUXITE);
  assert.equal(area.damage.size, 0);
  assert.equal(game.storage.aluminum, 3);
  assert.equal(game.melter.bauxite, 2);
  assert.equal(game.state.tools.sword, 2);
  assert.equal(game.pickups[0], drop);
  const x = Math.floor(drop.x / 32), y = Math.floor(drop.y / 32);
  assert.equal(game.isSolid(x, y), false);
  assert.ok(reachableWalkableTiles(game, area).has(`${x},${y}`));
  game.removeItem('stone', 99);
  game.player.x = drop.x; game.player.y = drop.y;
  step(30);
  assert.equal(game.countItem('bauxite'), 1);
  assert.equal(game.pickups.length, 0);
});

function stage5Arena(game) {
  game.enterLevel('stage5');
  game.level.slimeTimer = game.level.spiderTimer = game.level.golemTimer = 999;
  for (let y = 6; y <= 25; y++) for (let x = 6; x <= 34; x++) game.setTile(x, y, game.FLOOR);
  game.player.x = 10.5 * 32;
  game.player.y = 22.5 * 32;
}

test('Alumina Cave naturally spawns Large Slimes, Spiders and Golems, not Moles or Prospectors', () => {
  const { game, math, step } = createGame();
  game.enterLevel('stage5');
  let seed = 29117;
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  game.level.slimeTimer = game.level.spiderTimer = game.level.golemTimer = 0;
  step(1);
  assert.ok(game.slimes.length > 0 && game.slimes.every((s) => s.large));
  assert.ok(game.spiders.length > 0);
  assert.ok(game.golems.length > 0);
  assert.equal(game.moles.length, 0);
  assert.equal(game.prospectors.length, 0);
  game.enterLevel('stage4');
  assert.equal(game.golems.length, 0);
  assert.equal(game.spawnGolemAwayFromPlayer(), null);
});

test('Golems disable after ten tiles of actual travel, cannot move or hurt for three seconds, then recover', () => {
  const { game, step } = createGame();
  stage5Arena(game);
  const golem = game.makeGolem(10.5 * 32, 10.5 * 32);
  assert.ok(golem.hp > game.BALANCE.largeSlimeHp);
  assert.ok(golem.r > game.BALANCE.slimeRadius);
  assert.ok(golem.speed < game.BALANCE.slimeSpeed);
  assert.ok(golem.dmg > game.BALANCE.slimeDamage);
  golem.wanderAngle = 0; golem.wanderTimer = 999;
  game.golems.push(golem);
  const startX = golem.x;
  const frameDistance = game.BALANCE.golemSpeed * 0.5 * 0.05;
  const beforeLimit = Math.floor((320 - 1e-8) / frameDistance);
  step(beforeLimit);
  assert.ok(Math.abs(golem.x - startX - frameDistance * beforeLimit) < 1e-6);
  assert.equal(golem.disabled, 0);
  step(1);
  assert.ok(Math.abs(golem.x - startX - 320) < 1e-6);
  assert.equal(golem.moved, 0);
  assert.equal(golem.disabled, 3);

  // Even touching and being struck cannot move a disabled Golem or deal damage.
  game.player.x = golem.x - 20; game.player.y = golem.y;
  aimSwordAt(game, golem);
  game.state.tools.sword = 1;
  game.state.cooldown = 0; game.swing();
  assert.equal(golem.hp, golem.maxHp - 10);
  assert.equal(golem.knockX, 0);
  const x = golem.x, y = golem.y;
  game.state.invuln = 0;
  step(59);
  assert.ok(golem.disabled > 0);
  assert.equal(golem.x, x); assert.equal(golem.y, y);
  assert.equal(game.state.hp, 100);
  step(1);
  assert.equal(golem.disabled, 0);
  assert.equal(golem.x, x); assert.equal(game.state.hp, 100);
  step(1);
  assert.ok(golem.x < x);
  assert.equal(game.state.hp, 100 - game.BALANCE.golemDamage);
});

test('a Golem does not count blocked movement toward its ten-tile limit', () => {
  const { game, step } = createGame();
  stage5Arena(game);
  game.setTile(10, 10, game.WALL);
  const golem = game.makeGolem(10 * 32 - game.BALANCE.golemRadius, 10.5 * 32);
  golem.wanderAngle = 0; golem.wanderTimer = 999; golem.moved = 319;
  game.golems.push(golem);
  const x = golem.x, y = golem.y;
  step(10); // before the stuck-wander reset chooses a different heading
  assert.equal(golem.x, x); assert.equal(golem.y, y);
  assert.equal(golem.moved, 319);
  assert.equal(golem.disabled, 0);
});

test('a Golem navigates around a wall and sword kills count in the death screen', () => {
  const { game, elements, step } = createGame();
  stage5Arena(game);
  game.setTile(12, 10, game.WALL);
  const golem = game.makeGolem(10.5 * 32, 10.5 * 32);
  game.golems.push(golem);
  game.player.x = 14.5 * 32; game.player.y = 10.5 * 32;
  game.state.invuln = 999;
  step(240);
  assert.ok(Math.hypot(game.player.x - golem.x, game.player.y - golem.y) < 45, 'bulky Golem should go around the wall');
  assert.equal(game.getTile(12, 10), game.WALL);
  game.player.x = golem.x - 35; game.player.y = golem.y;
  aimSwordAt(game, golem);
  for (let i = 0; i < 4; i++) { game.state.cooldown = 0; game.swing(); }
  assert.equal(golem.dead, true);
  assert.equal(game.state.golemsSlain, 1);
  assert.equal(game.slimes.length, 0);
  const killer = game.makeGolem(game.player.x + 10, game.player.y);
  killer.speed = 0;
  game.golems.push(killer);
  game.state.hp = 45; game.state.invuln = 0;
  step(1);
  assert.equal(game.state.mode, 'dead');
  assert.equal(elements['over-golems'].textContent, '1');
  assert.match(elements['over-line'].textContent, /1 cave creature/);
});

test('both coin stations open by mouse or touch without overlapping existing stations', () => {
  const { game, elements } = createGame();
  for (const [kind, pointerType, view] of [['press', 'mouse', 'view-press'], ['trader', 'touch', 'view-trader']]) {
    const station = game.level.stations.find((s) => s.kind === kind);
    assert.ok(station);
    const x = station.x - game.camera.x + 1280 / 2;
    const y = station.y - game.camera.y + 800 / 2;
    elements.game.dispatch('pointerdown', { clientX: x, clientY: y, pointerType });
    assert.equal(game.state.mode, 'station');
    assert.equal(game.state.openStation, kind);
    assert.equal(elements[view].classList.contains('is-hidden'), false);
    game.closeStation();
  }
  assert.equal((html.match(/data-close-station/g) || []).length, 6);
});

test('the Coin Press unlocks each higher denomination only after pressing its first coin', () => {
  const { game, elements, step } = createGame();
  game.addItem('copper', 2);
  game.addItem('silver', 1);
  game.addItem('gold', 1);
  game.addItem('bauxite', 1);
  game.addItem('aluminum', 1);
  game.addItem('silverCoin', 1); // possessing a coin alone does not unlock trading
  game.openStation('trader');
  assert.equal(game.traderUnlocked.copper, true);
  for (const kind of ['silver', 'gold', 'aluminum']) {
    assert.equal(game.traderUnlocked[kind], false);
    assert.equal(elements[`trade-${kind}`].disabled, true);
    assert.equal(game.tradeCoin(kind), false);
  }
  game.closeStation();
  game.openStation('press');
  for (const kind of ['copper', 'copper', 'silver', 'gold', 'aluminum']) {
    assert.equal(elements[`press-${kind}`].disabled, false);
    elements[`press-${kind}`].click();
  }
  assert.equal(game.countItem('copperCoin'), 2);
  assert.equal(game.countItem('silverCoin'), 2);
  assert.equal(game.countItem('goldCoin'), 1);
  assert.equal(game.countItem('aluminumCoin'), 1);
  assert.equal(game.countItem('bauxite'), 1, 'raw Bauxite is not Aluminum');
  for (const kind of ['silver', 'gold', 'aluminum']) assert.equal(game.traderUnlocked[kind], true);
  game.closeStation();
  step(30); // cosmetic press pickups cannot duplicate credited coins
  assert.equal(game.countItem('copperCoin'), 2);
  assert.equal(game.countItem('silverCoin'), 2);
  assert.equal(game.countItem('goldCoin'), 1);
  assert.equal(game.countItem('aluminumCoin'), 1);
});

test('the Coin Trader applies all four exact coal rates and updates visible rows', () => {
  const { game, elements } = createGame();
  for (const [item, count] of [['copper', 2], ['silver', 1], ['gold', 1], ['aluminum', 1]]) game.addItem(item, count);
  game.openStation('press');
  for (const kind of ['copper', 'copper', 'silver', 'gold', 'aluminum']) assert.equal(game.pressCoin(kind), true);
  game.closeStation();
  game.openStation('trader');
  for (const [kind, coal, coins] of [['copper', 1, 2], ['silver', 1, 1], ['gold', 2, 1], ['aluminum', 4, 1]]) {
    const before = game.countItem('coal');
    assert.equal(elements[`trade-${kind}`].disabled, false);
    assert.match(elements[`trade-${kind}-status`].textContent, /Available/);
    elements[`trade-${kind}`].click();
    assert.equal(game.countItem('coal') - before, coal, kind);
    assert.equal(game.countItem(`${kind}Coin`), 0, `${coins} ${kind} coin(s) spent`);
    assert.equal(elements[`trade-${kind}`].disabled, true);
  }
  assert.equal(game.countItem('coal'), 8);
});

test('coin conversions are atomic in a full bag and can reuse a freed slot or an existing stack', () => {
  {
    const { game, elements } = createGame();
    game.addItem('stone', 891); // nine full stacks
    game.addItem('copper', 2); // tenth slot, cannot free it by pressing just one
    game.openStation('press');
    assert.equal(elements['press-copper'].disabled, true);
    assert.match(elements['press-copper-count'].textContent, /bag full/);
    assert.equal(game.pressCoin('copper'), false);
    assert.equal(game.countItem('copper'), 2);
    assert.equal(game.countItem('copperCoin'), 0);
    game.removeItem('copper', 1);
    assert.equal(game.pressCoin('copper'), true);
    assert.equal(game.countItem('copper'), 0);
    assert.equal(game.countItem('copperCoin'), 1);
  }
  {
    const { game } = createGame();
    game.addItem('stone', 792); // eight stacks
    game.addItem('copperCoin', 1);
    game.addItem('copper', 2);
    game.openStation('press');
    assert.equal(game.pressCoin('copper'), true, 'output fits the existing coin stack');
    assert.equal(game.countItem('copper'), 1);
    assert.equal(game.countItem('copperCoin'), 2);
  }
  {
    const { game } = createGame();
    game.addItem('stone', 891);
    game.addItem('copperCoin', 3);
    game.openStation('trader');
    assert.equal(game.tradeCoin('copper'), false);
    assert.equal(game.countItem('copperCoin'), 3);
    assert.equal(game.countItem('coal'), 0);
    game.removeItem('copperCoin', 1);
    assert.equal(game.tradeCoin('copper'), true, 'spent stack frees space for coal');
    assert.equal(game.countItem('copperCoin'), 0);
    assert.equal(game.countItem('coal'), 1);
  }
  {
    const { game } = createGame();
    game.addItem('copperCoin', 100); // stacks of 99 and 1
    game.addItem('stone', 792); // fill the remaining eight slots
    game.openStation('trader');
    assert.equal(game.tradeCoin('copper'), true, 'consume the small stack first to make room');
    assert.equal(game.countItem('copperCoin'), 98);
    assert.equal(game.countItem('coal'), 1);
  }
});

test('coins and Aluminum work in storage and death, unlocks persist until a new run', () => {
  const { game } = createGame();
  game.addItem('silver', 4);
  game.addItem('gold', 4);
  game.addItem('aluminum', 5);
  game.addItem('bauxite', 3);
  game.openStation('press');
  for (const kind of ['silver', 'silver', 'gold', 'aluminum', 'aluminum']) assert.equal(game.pressCoin(kind), true);
  game.closeStation();
  game.openStation('storage');
  assert.equal(game.depositToStorage('silverCoin', 1), 1);
  assert.equal(game.depositToStorage('aluminum', 1), 1);
  assert.equal(game.depositToStorage('bauxite', 1), 1);
  game.closeStation();
  game.melter.bauxite = 2;
  game.enterLevel('stage5');
  game.respawnAtBase();
  assert.equal(game.storage.silverCoin, 1);
  assert.equal(game.storage.aluminum, 1);
  assert.equal(game.storage.bauxite, 1);
  assert.equal(game.countItem('silverCoin'), 1); // one kept, rounding up
  assert.equal(game.countItem('aluminumCoin'), 1); // two halved
  assert.equal(game.countItem('aluminum'), 1); // two halved after storing
  assert.equal(game.melter.bauxite, 2);
  for (const kind of ['silver', 'gold', 'aluminum']) assert.equal(game.traderUnlocked[kind], true);
  assert.equal(game.withdrawFromStorage('silverCoin', 1), 1);
  assert.equal(game.countItem('silverCoin'), 2);
  game.start();
  assert.equal(game.levels.stage5, null);
  assert.equal(game.melter.bauxite, 0);
  assert.equal(game.storage.aluminum, 0);
  assert.equal(game.storage.bauxite, 0);
  assert.equal(game.storage.silverCoin, 0);
  assert.equal(game.countItem('aluminumCoin'), 0);
  assert.equal(game.traderUnlocked.copper, true);
  for (const kind of ['silver', 'gold', 'aluminum']) assert.equal(game.traderUnlocked[kind], false);
});

test('Alumina Cave has wide, connected routes for a Golem body', () => {
  const { game } = createGame();
  game.enterLevel('stage5');
  const area = game.level, r = game.BALANCE.golemRadius;
  const fits = (x, y) => {
    const px = (x + 0.5) * 32, py = (y + 0.5) * 32;
    for (let ty = Math.floor((py - r) / 32); ty <= Math.floor((py + r - 0.001) / 32); ty++) {
      for (let tx = Math.floor((px - r) / 32); tx <= Math.floor((px + r - 0.001) / 32); tx++) {
        if (game.isSolid(tx, ty)) return false;
      }
    }
    return true;
  };
  const sx = Math.floor(area.spawn.x / 32), sy = Math.floor(area.spawn.y / 32);
  assert.ok(fits(sx, sy));
  const seen = new Set([`${sx},${sy}`]), queue = [[sx, sy]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (!seen.has(key) && fits(nx, ny)) { seen.add(key); queue.push([nx, ny]); }
    }
  }
  for (const [cx, cy] of [[8, 8], [24, 9], [45, 9], [51, 23], [31, 22], [12, 23], [19, 37], [40, 36]]) {
    assert.ok([...seen].some((key) => {
      const [x, y] = key.split(',').map(Number);
      return Math.abs(x - cx) <= 4 && Math.abs(y - cy) <= 3;
    }), `a Golem should fit through to ${cx},${cy}`);
  }
});

test('a Golem resets its movement counter and can disable again', () => {
  const { game, step } = createGame();
  stage5Arena(game);
  const golem = game.makeGolem(10.5 * 32, 10.5 * 32);
  golem.wanderAngle = 0; golem.wanderTimer = 999;
  game.golems.push(golem);
  golem.moved = 319.5;
  step(1);
  assert.equal(golem.disabled, 3);
  assert.equal(golem.moved, 0);
  step(60);
  assert.equal(golem.disabled, 0);
  const x = golem.x;
  step(1);
  assert.ok(golem.x > x);
  assert.ok(golem.moved > 0);
  golem.moved = 319.5;
  step(1);
  assert.equal(golem.disabled, 3);
  assert.equal(golem.moved, 0);
});

test('failed full-bag presses do not unlock trades; Aluminum exchanges need room for all four Coal', () => {
  const { game, elements } = createGame();
  game.addItem('stone', 891);
  game.addItem('silver', 2);
  game.openStation('press');
  assert.equal(game.pressCoin('silver'), false);
  assert.equal(game.traderUnlocked.silver, false);
  assert.equal(game.countItem('silver'), 2);
  assert.equal(game.countItem('silverCoin'), 0);
  game.removeItem('silver', 1);
  assert.equal(game.pressCoin('silver'), true);
  assert.equal(game.traderUnlocked.silver, true);

  game.start();
  game.addItem('aluminum', 1);
  game.openStation('press');
  assert.equal(game.pressCoin('aluminum'), true);
  game.closeStation();
  game.addItem('aluminumCoin', 1); // coin stack will survive trading one
  game.addItem('coal', 98); // room for only one of four Coal
  game.addItem('stone', 792); // eight more slots; bag is full
  game.openStation('trader');
  assert.equal(elements['trade-aluminum'].disabled, true);
  assert.equal(game.tradeCoin('aluminum'), false);
  assert.equal(game.countItem('aluminumCoin'), 2);
  assert.equal(game.countItem('coal'), 98);
  game.removeItem('aluminumCoin', 1); // spending the last one now frees a slot
  assert.equal(game.tradeCoin('aluminum'), true);
  assert.equal(game.countItem('aluminumCoin'), 0);
  assert.equal(game.countItem('coal'), 102);
});

/* ------------------------------------------------------------ save system */

test('the pause button saves a browser slot and Continue restores it after a reload', () => {
  const storage = createMemoryStorage();
  const first = createGame({ storage });
  first.game.addItem('iron', 23);
  first.game.state.hp = 65;
  first.game.state.tools.pickaxe = 2;
  first.elements['pause-btn'].click(); // also works in the first second of a run
  assert.equal(first.game.state.mode, 'paused');
  first.elements['save-browser'].click();
  assert.match(first.elements['pause-save-status'].textContent, /Saved in this browser/);
  assert.ok(storage.getItem(first.game.saveKey));

  const next = createGame({ storage, autoStart: false });
  assert.equal(next.game.state.mode, 'menu');
  assert.equal(next.elements['continue-save'].classList.contains('is-hidden'), false);
  assert.equal(next.elements.play.textContent, 'New game');
  next.elements['continue-save'].click();
  assert.equal(next.game.state.mode, 'paused', 'loaded games should not resume combat immediately');
  assert.equal(next.game.countItem('iron'), 23);
  assert.equal(next.game.state.hp, 65);
  assert.equal(next.game.state.tools.pickaxe, 2);
  assert.equal(next.elements['pickaxe-tier'].textContent, 'T2');
  next.elements.resume.click();
  assert.equal(next.game.state.mode, 'playing');
});

test('a new run does not overwrite the existing manual browser save', () => {
  const storage = createMemoryStorage();
  const first = createGame({ storage });
  first.game.addItem('gold', 14);
  first.elements['pause-btn'].click();
  assert.equal(first.game.saveToBrowser(), true);
  const saved = storage.getItem(first.game.saveKey);
  first.game.start();
  assert.equal(first.game.countItem('gold'), 0);
  assert.equal(storage.getItem(first.game.saveKey), saved);
  const reload = createGame({ storage, autoStart: false });
  reload.elements['continue-save'].click();
  assert.equal(reload.game.countItem('gold'), 14);
});

test('Space on the title screen continues a browser save rather than starting over', () => {
  const storage = createMemoryStorage();
  const first = createGame({ storage });
  first.game.addItem('coal', 7);
  first.elements['pause-btn'].click();
  assert.equal(first.game.saveToBrowser(), true);
  const reload = createGame({ storage, autoStart: false });
  reload.listeners.keydown[0]({ code: 'Space', target: { tagName: 'BODY' }, preventDefault: noop });
  assert.equal(reload.game.state.mode, 'paused');
  assert.equal(reload.game.countItem('coal'), 7);
});

function savedPickup(item, x, y, overrides = {}) {
  return { item, count: 1, x, y, originX: x, originY: y, phase: 'ground', age: 0,
    delay: 0, rise: 30, source: 'mining', alreadyCollected: false, ...overrides };
}
function comparableSave(game) {
  const save = JSON.parse(game.createSaveText());
  delete save.savedAt;
  return save;
}

test('portable saves round-trip every visited area, inventory, stations, enemies and projectiles', () => {
  const first = createGame();
  const { game } = first;
  game.addItem('iron', 28);
  game.addItem('goldCoin', 3);
  game.storage.calcite = 12;
  game.storage.aluminum = 4;
  game.melter.coal = 9;
  game.melter.bauxite = 5;
  game.melter.selectedOre = 'bauxite';
  game.traderUnlocked.gold = true;
  game.traderUnlocked.aluminum = true;
  game.state.tools.pickaxe = 3;
  game.state.tools.sword = 2;
  game.selectTool('sword');
  game.state.hp = 58;
  game.state.invuln = 0.25;
  game.state.cooldown = 0.13;
  game.state.time = 127.25;
  game.state.oreHauled = 48;
  game.state.golemsSlain = 2;

  game.enterLevel('stage1');
  game.enterLevel('stage2');
  game.enterLevel('stage3');
  const pro = game.makeProspector(game.player.x + 32, game.player.y);
  pro.hp = 29;
  pro.throwCd = 6.3;
  pro.haul.gold = 8;
  pro.haul.silver = 11;
  const oreIndex = game.level.tiles.findIndex((tile) => tile === game.GOLD);
  const oreTx = oreIndex % game.level.w, oreTy = Math.floor(oreIndex / game.level.w);
  pro.oreTarget = { tx: oreTx, ty: oreTy, tile: game.GOLD, goalTx: 6, goalTy: 8,
    route: [{ tx: 6, ty: 8 }], routeIndex: 0 };
  pro.mineProgress = 0.35;
  game.level.prospectors.push(pro);

  game.enterLevel('stage4');
  const stage4 = game.level;
  const [brokenSpike, crackedSpike] = [...stage4.stalagmites];
  assert.ok(brokenSpike && crackedSpike);
  stage4.stalagmites.delete(brokenSpike);
  stage4.damage.set(crackedSpike, 1);
  stage4.pickups.push(savedPickup('calcite', game.player.x + 32, game.player.y, { count: 3 }));

  game.enterLevel('stage5');
  const stage5 = game.level;
  const mineIndex = stage5.tiles.findIndex((tile) => tile === game.BAUXITE);
  const mineTx = mineIndex % stage5.w, mineTy = Math.floor(mineIndex / stage5.w);
  const originalRock = stage5.originalTiles[mineIndex];
  game.setTile(mineTx, mineTy, game.FLOOR);
  const crackIndex = stage5.tiles.findIndex((tile) => tile === game.IRON);
  const crackKey = `${crackIndex % stage5.w},${Math.floor(crackIndex / stage5.w)}`;
  stage5.damage.set(crackKey, 1);
  stage5.golemTimer = 4.4;
  stage5.pickups.push(savedPickup('bauxite', game.player.x + 16, game.player.y, { phase: 'flying', age: 0.2 }));
  stage5.pickups.push(savedPickup('aluminum', game.player.x, game.player.y,
    { phase: 'flying', source: 'melter', alreadyCollected: true }));
  stage5.dynamites.push({ fromX: game.player.x, fromY: game.player.y, x: game.player.x + 4,
    y: game.player.y, targetX: game.player.x + 64, targetY: game.player.y, age: 0.2 });
  stage5.explosions.push({ x: game.player.x + 100, y: game.player.y, age: 0.1, duration: 0.5 });
  const slime = game.makeSlime(game.player.x + 50, game.player.y, false, true);
  slime.hp = 33;
  game.slimes.push(slime);
  const mole = game.makeMole(game.player.x + 80, game.player.y);
  mole.hp = 21;
  mole.inWall = true;
  game.moles.push(mole);
  const spider = game.makeSpider(game.player.x + 90, game.player.y);
  spider.attackCd = 0.2;
  game.spiders.push(spider);
  const golem = game.makeGolem(game.player.x + 100, game.player.y);
  golem.hp = 70;
  golem.moved = 45;
  golem.disabled = 2.4;
  game.golems.push(golem);
  first.elements['pause-btn'].click();

  const before = comparableSave(game);
  const text = game.createSaveText();
  const second = createGame({ autoStart: false });
  assert.equal(second.game.loadSaveText(text), true);
  assert.equal(second.game.state.mode, 'paused');
  assert.deepEqual(comparableSave(second.game), before, 'all saved state must survive a round trip');
  assert.equal(second.game.getTile(mineTx, mineTy), second.game.FLOOR, 'load must not reset the active cave');
  assert.equal(second.game.level.damage.get(crackKey), 1);
  assert.equal(second.game.golems[0].disabled, 2.4);
  assert.equal(second.game.level.dynamites[0].age, 0.2);

  second.game.enterLevel('stage4');
  assert.equal(second.game.level.stalagmites.has(brokenSpike), true, 'later re-entry restores the original formation');
  assert.equal(second.game.level.damage.size, 0);
  assert.equal(second.game.level.pickups[0].count, 3, 'uncollected loot survives area reset');
  second.game.enterLevel('stage3');
  assert.equal(second.game.level.prospectors[0].haul.gold, 8, 'Prospector haul survives both load and re-entry');
  second.game.enterLevel('stage5');
  assert.equal(second.game.getTile(mineTx, mineTy), originalRock, 'later re-entry restores original generated ore');
});

test('in-flight drops and already-collected visual pickups are not lost or duplicated on load', () => {
  const first = createGame();
  first.game.addItem('iron', 1);
  const { x, y } = first.game.player;
  first.game.pickups.push(savedPickup('iron', x, y, { phase: 'flying', alreadyCollected: true, source: 'melter' }));
  first.game.pickups.push(savedPickup('coal', x, y, { phase: 'flying' }));
  first.elements['pause-btn'].click();
  const text = first.game.createSaveText();
  const loaded = createGame({ autoStart: false });
  loaded.game.loadSaveText(text);
  loaded.step(30);
  assert.equal(loaded.game.countItem('coal'), 0, 'the loaded game must remain paused');
  loaded.elements.resume.click();
  loaded.step(30);
  assert.equal(loaded.game.countItem('iron'), 1, 'cosmetic Melter pickup must not credit the bag twice');
  assert.equal(loaded.game.countItem('coal'), 1, 'a real in-flight drop is credited once');
  assert.equal(loaded.game.pickups.length, 0);
});

test('malformed or incompatible saves never mutate the active run or browser slot', () => {
  const storage = createMemoryStorage();
  const current = createGame({ storage });
  current.game.addItem('gold', 5);
  current.elements['pause-btn'].click();
  assert.equal(current.game.saveToBrowser(), true);
  const slot = storage.getItem(current.game.saveKey);
  current.game.addItem('silver', 9); // unsaved live changes must also be protected
  const before = comparableSave(current.game);
  const valid = JSON.parse(current.game.createSaveText());
  const variants = [
    '{broken json',
    JSON.stringify({ ...valid, format: 'another-game' }),
    JSON.stringify({ ...valid, version: 999 }),
    JSON.stringify({ ...valid, inventory: [{ item: 'made-up-item', count: 99 }] }),
    JSON.stringify({ ...valid, inventory: valid.inventory.map((cell, i) => i ? cell : { item: 'iron', count: 100 }) }),
    JSON.stringify({ ...valid, state: { ...valid.state, hp: null } }),
    JSON.stringify({ ...valid, player: { ...valid.player, x: 0, y: 0 } }),
    JSON.stringify({ ...valid, areas: { ...valid.areas, home: { ...valid.areas.home, tiles: [0] } } }),
    JSON.stringify({ ...valid, areas: { ...valid.areas, home: { ...valid.areas.home,
      originalTiles: valid.areas.home.originalTiles.map((v, i) => i === 0 ? 0 : v) } } }),
    ' '.repeat(2 * 1024 * 1024 + 1),
  ];
  for (const text of variants) {
    assert.throws(() => current.game.loadSaveText(text));
    assert.deepEqual(comparableSave(current.game), before);
    assert.equal(storage.getItem(current.game.saveKey), slot);
    assert.equal(current.game.state.mode, 'paused');
  }
});

test('a damaged browser slot fails safely without clearing it or starting a run', () => {
  const storage = createMemoryStorage();
  const original = createGame({ storage });
  original.elements['pause-btn'].click();
  assert.equal(original.game.saveToBrowser(), true);
  const bad = JSON.parse(storage.getItem(original.game.saveKey));
  bad.areas.home.tiles[0] = original.game.FLOOR; // header still looks valid
  const damaged = JSON.stringify(bad);
  storage.setItem(original.game.saveKey, damaged);
  const reload = createGame({ storage, autoStart: false });
  reload.elements['continue-save'].click();
  assert.equal(reload.game.state.mode, 'menu');
  assert.match(reload.elements['menu-save-status'].textContent, /Could not load/);
  assert.equal(storage.getItem(original.game.saveKey), damaged);
});

test('denied or full browser storage keeps the old slot and still allows a file download', async () => {
  const storage = createMemoryStorage();
  const original = createGame({ storage });
  original.game.addItem('coal', 4);
  original.elements['pause-btn'].click();
  assert.equal(original.game.saveToBrowser(), true);
  const slot = storage.getItem(original.game.saveKey);
  const denied = { getItem: (key) => storage.getItem(key), setItem: () => { throw new Error('quota exceeded'); } };
  const next = createGame({ storage: denied });
  next.game.addItem('gold', 7);
  next.elements['pause-btn'].click();
  assert.equal(next.game.saveToBrowser(), false);
  next.elements['save-confirm-accept'].click();
  assert.match(next.elements['pause-save-status'].textContent, /Could not save/);
  assert.equal(storage.getItem(original.game.saveKey), slot);
  next.elements['export-save'].click();
  assert.match(next.elements['pause-save-status'].textContent, /download started/i);
  const downloaded = JSON.parse(await next.window.downloadBlob.text());
  assert.equal(downloaded.format, 'mining-simulator-save');
  assert.equal(downloaded.inventory.find((cell) => cell && cell.item === 'gold').count, 7);
  assert.equal(next.document.body.children[0].download, 'mining-simulator-save.json');
  assert.equal(next.document.body.children[0].removed, true);

  const noStorage = createGame({ storage: null });
  noStorage.elements['pause-btn'].click();
  assert.equal(noStorage.game.saveToBrowser(), false);
  noStorage.elements['export-save'].click();
  assert.ok(noStorage.window.downloadBlob, 'portable backups do not depend on localStorage');
});

test('file import confirms replacement, preserves the browser slot, and rejects bad or oversized files', async () => {
  const storage = createMemoryStorage();
  const current = createGame({ storage });
  current.game.addItem('stone', 6);
  current.elements['pause-btn'].click();
  assert.equal(current.game.saveToBrowser(), true);
  const oldSlot = storage.getItem(current.game.saveKey);
  current.game.addItem('coal', 8);
  const before = comparableSave(current.game);

  current.elements['import-save-pause'].click();
  assert.equal(current.elements['save-confirm'].classList.contains('is-hidden'), false);
  current.elements['save-confirm-cancel'].click();
  assert.equal(current.elements['save-file'].clicks || 0, 0, 'declining confirmation must not open a file picker');
  assert.deepEqual(comparableSave(current.game), before);
  current.elements['import-save-pause'].click();
  current.elements['save-confirm-accept'].click();
  assert.equal(current.elements['save-file'].clicks, 1);

  const input = current.elements['save-file'];
  input.files = [{ size: 3, text: async () => 'bad' }];
  await input.listeners.change[0]();
  assert.match(current.elements['pause-save-status'].textContent, /Could not load/);
  assert.deepEqual(comparableSave(current.game), before);
  assert.equal(storage.getItem(current.game.saveKey), oldSlot);
  let readOversized = false;
  input.files = [{ size: 2 * 1024 * 1024 + 1, text: async () => { readOversized = true; return ''; } }];
  await input.listeners.change[0]();
  assert.equal(readOversized, false);
  assert.deepEqual(comparableSave(current.game), before);

  const source = createGame();
  source.game.addItem('bauxite', 15);
  source.elements['pause-btn'].click();
  const text = source.game.createSaveText();
  input.files = [{ size: text.length, text: async () => text }];
  await input.listeners.change[0]();
  assert.equal(current.game.state.mode, 'paused');
  assert.equal(current.game.countItem('bauxite'), 15);
  assert.equal(current.game.countItem('coal'), 0);
  assert.match(current.elements['pause-save-status'].textContent, /Save to browser/);
  assert.equal(storage.getItem(current.game.saveKey), oldSlot, 'importing alone must not overwrite the browser slot');
});

test('an asynchronous file read cannot replace a game after leaving the pause screen', async () => {
  const current = createGame();
  current.game.addItem('iron', 3);
  current.elements['pause-btn'].click();
  const source = createGame();
  source.game.addItem('gold', 25);
  source.elements['pause-btn'].click();
  const text = source.game.createSaveText();
  let finish;
  const input = current.elements['save-file'];
  input.files = [{ size: text.length, text: () => new Promise((resolve) => { finish = resolve; }) }];
  const pending = input.listeners.change[0]();
  current.elements.resume.click();
  current.elements['pause-btn'].click(); // the mode can return to paused before the read finishes
  finish(text);
  await pending;
  assert.equal(current.game.state.mode, 'paused');
  assert.equal(current.game.countItem('iron'), 3);
  assert.equal(current.game.countItem('gold'), 0);
  assert.match(current.elements['pause-save-status'].textContent, /run changed/);
});

test('replacing another run or imported file in the browser slot requires confirmation', () => {
  const storage = createMemoryStorage();
  const original = createGame({ storage });
  original.game.addItem('gold', 6);
  original.elements['pause-btn'].click();
  assert.equal(original.game.saveToBrowser(), true);
  const oldSlot = storage.getItem(original.game.saveKey);
  const next = createGame({ storage });
  next.game.addItem('iron', 12);
  next.elements['pause-btn'].click();
  assert.equal(next.game.saveToBrowser(), false);
  assert.equal(next.elements['save-confirm'].classList.contains('is-hidden'), false);
  assert.equal(storage.getItem(next.game.saveKey), oldSlot);
  next.elements['save-confirm-cancel'].click();
  assert.match(next.elements['pause-save-status'].textContent, /unchanged/);
  assert.equal(next.game.saveToBrowser(), false);
  next.elements['save-confirm-accept'].click();
  assert.notEqual(storage.getItem(next.game.saveKey), oldSlot);
  assert.equal(JSON.parse(storage.getItem(next.game.saveKey)).inventory.find((c) => c && c.item === 'iron').count, 12);
});

test('updating the same browser save needs no extra confirmation, but a changed slot does', () => {
  const storage = createMemoryStorage();
  const first = createGame({ storage });
  first.elements['pause-btn'].click();
  assert.equal(first.game.saveToBrowser(), true);
  const loaded = createGame({ storage, autoStart: false });
  loaded.elements['continue-save'].click();
  loaded.game.addItem('coal', 2);
  assert.equal(loaded.game.saveToBrowser(), true);
  assert.equal(loaded.elements['save-confirm'].classList.contains('is-hidden'), true);
  // Another tab changed the same browser slot since it was loaded.
  storage.setItem(loaded.game.saveKey, 'newer save from another tab');
  loaded.game.addItem('coal', 1);
  assert.equal(loaded.game.saveToBrowser(), false);
  assert.equal(loaded.elements['save-confirm'].classList.contains('is-hidden'), false);
  loaded.elements['save-confirm-cancel'].click();
  assert.equal(storage.getItem(loaded.game.saveKey), 'newer save from another tab');
});

test('naturally spawned enemies and timers in every cave remain saveable during real simulation', () => {
  const storage = createMemoryStorage();
  const live = createGame({ storage });
  live.game.state.invuln = 999; // avoid ending this serialization smoke test in combat
  for (const id of ['stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'stage6', 'stage7', 'special']) {
    live.game.enterLevel(id);
    live.step(100);
    assert.equal(live.game.level.id, id);
    live.elements['pause-btn'].click();
    assert.equal(live.game.saveToBrowser(), true, `a live ${id} state should validate`);
    const before = comparableSave(live.game);
    const restored = createGame({ storage, autoStart: false });
    assert.equal(restored.game.loadBrowserSave(), true);
    assert.deepEqual(comparableSave(restored.game), before, `a live ${id} state should round-trip`);
    live.elements.resume.click();
  }
});

test('Escape dismisses a save confirmation without resuming or changing progress', () => {
  const current = createGame();
  current.game.addItem('silver', 4);
  current.elements['pause-btn'].click();
  current.elements['import-save-pause'].click();
  assert.equal(current.elements['save-confirm'].classList.contains('is-hidden'), false);
  current.listeners.keydown[0]({ code: 'KeyE', target: { tagName: 'BUTTON' }, preventDefault: noop });
  assert.equal(current.game.state.tool, 'pickaxe', 'game shortcuts must not change the run behind a confirmation');
  current.listeners.keydown[0]({ code: 'Escape', target: { tagName: 'BUTTON' }, preventDefault: noop });
  assert.equal(current.elements['save-confirm'].classList.contains('is-hidden'), true);
  assert.equal(current.game.state.mode, 'paused');
  assert.equal(current.game.countItem('silver'), 4);
  assert.equal(current.elements['save-file'].clicks || 0, 0);
  current.listeners.keydown[0]({ code: 'Escape', target: { tagName: 'BODY' }, preventDefault: noop });
  assert.equal(current.game.state.mode, 'playing');
});

test('a file-picker confirmation expires if the player resumes before selecting a file', async () => {
  const current = createGame();
  current.game.addItem('iron', 3);
  current.elements['pause-btn'].click();
  current.elements['import-save-pause'].click();
  current.elements['save-confirm-accept'].click();
  assert.equal(current.elements['save-file'].clicks, 1);
  current.elements.resume.click();
  current.elements['pause-btn'].click();
  const source = createGame();
  source.game.addItem('gold', 25);
  source.elements['pause-btn'].click();
  const text = source.game.createSaveText();
  const input = current.elements['save-file'];
  input.files = [{ size: text.length, text: async () => text }];
  await input.listeners.change[0]();
  assert.equal(current.game.state.mode, 'paused');
  assert.equal(current.game.countItem('iron'), 3);
  assert.equal(current.game.countItem('gold'), 0);
  assert.match(current.elements['pause-save-status'].textContent, /run changed/);
});

// Stages 6–7 and the hidden Mercury cave: exercise actual gameplay functions,
// the real frame loop, and both old and new save formats.
function moveToStairs(game, step, stairs) {
  game.player.x = (stairs.tx + 0.5) * 32;
  game.player.y = (stairs.ty + 0.5) * 32;
  game.state.transitionLock = 0;
  step(1);
}

function suppressNewEnemySpawns(area) {
  area.slimeTimer = area.moleTimer = area.spiderTimer = area.golemTimer = area.prospectorTimer = 999;
}

function reachableForRadius(game, area, radius) {
  const start = [Math.floor(area.spawn.x / 32), Math.floor(area.spawn.y / 32)];
  const fits = (tx, ty) => {
    const x = (tx + 0.5) * 32, y = (ty + 0.5) * 32;
    for (let yy = Math.floor((y - radius) / 32); yy <= Math.floor((y + radius - 0.001) / 32); yy++) {
      for (let xx = Math.floor((x - radius) / 32); xx <= Math.floor((x + radius - 0.001) / 32); xx++) {
        if (xx < 0 || yy < 0 || xx >= area.w || yy >= area.h ||
            game.TILES[area.tiles[yy * area.w + xx]].solid || area.stalagmites.has(`${xx},${yy}`)) return false;
      }
    }
    return true;
  };
  const queue = [start], seen = new Set([start.join(',')]);
  assert.ok(fits(...start), 'spawn must fit');
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (seen.has(key) || !fits(nx, ny)) continue;
      seen.add(key); queue.push([nx, ny]);
    }
  }
  return seen;
}

test('new stairs connect Alumina Cave, Luscious Cave and Spiral Cavern in both directions', () => {
  const { game, elements, step } = createGame();
  game.enterLevel('stage5');
  const stage5 = game.level;
  assert.ok(reachableWalkableTiles(game, stage5).has(`${stage5.stairsDown.tx},${stage5.stairsDown.ty}`));
  moveToStairs(game, step, stage5.stairsDown);
  assert.equal(game.level.id, 'stage6');
  assert.equal(elements['stage-name'].textContent, 'Luscious Cave');
  assert.equal(elements['area-kicker'].textContent, 'Stage 06');
  assert.equal(elements['area-subtitle'].textContent, 'A peaceful break from the monsters');
  const stage6 = game.level;
  assert.ok(reachableWalkableTiles(game, stage6).has(`${stage6.stairsDown.tx},${stage6.stairsDown.ty}`));
  moveToStairs(game, step, stage6.stairsDown);
  assert.equal(game.level.id, 'stage7');
  assert.equal(elements['stage-name'].textContent, 'Spiral Cavern');
  assert.equal(elements['area-kicker'].textContent, 'Stage 07');
  assert.equal(elements['area-subtitle'].textContent, 'The pinnacle of circles');
  moveToStairs(game, step, game.level.stairsUp);
  assert.equal(game.level, stage6);
  assert.equal(Math.floor(game.player.x / 32), stage6.stairsDown.tx);
  assert.equal(Math.floor(game.player.y / 32), stage6.stairsDown.ty - 1);
  moveToStairs(game, step, stage6.stairsUp);
  assert.equal(game.level, stage5);
  assert.equal(Math.floor(game.player.x / 32), stage5.stairsDown.tx);
  assert.equal(Math.floor(game.player.y / 32), stage5.stairsDown.ty - 1);
});

test('Luscious Cave pools and Axolotls are reachable, walkable and area-owned', () => {
  const { game, step } = createGame();
  game.enterLevel('stage6');
  suppressNewEnemySpawns(game.level);
  const area = game.level, reachable = reachableWalkableTiles(game, area);
  const creatures = area.pickups.filter((p) => p.item === 'axolotl');
  assert.equal(creatures.length, 8);
  for (const pickup of creatures) {
    const tx = Math.floor(pickup.x / 32), ty = Math.floor(pickup.y / 32);
    assert.equal(game.getTile(tx, ty), game.WET);
    assert.equal(game.TILES[game.WET].solid, false);
    assert.ok(reachable.has(`${tx},${ty}`));
  }
  const first = creatures[0];
  game.player.x = first.x; game.player.y = first.y;
  step(28);
  assert.equal(game.countItem('axolotl'), 1, 'walking near a wet spot collects its Axolotl');
  assert.equal(area.pickups.filter((p) => p.item === 'axolotl').length, 7);
  game.enterLevel('stage5');
  game.enterLevel('stage6');
  assert.equal(area.pickups.filter((p) => p.item === 'axolotl').length, 7, 'uncollected creatures remain without duplicating');
});

test('the new caves contain their requested ores, and only the secret cave contains Mercury', () => {
  const { game } = createGame();
  const checks = [
    ['stage6', ['GOLD', 'COBALT', 'QUARTZ']],
    ['stage7', ['GOLD', 'COBALT', 'IRIDIUM', 'TITANIUM']],
    ['special', ['TITANIUM', 'IRIDIUM', 'QUARTZ', 'MERCURY']],
  ];
  for (const [areaName, ores] of checks) {
    game.enterLevel(areaName);
    for (const ore of ores) assert.ok(game.level.tiles.includes(game[ore]), `${areaName} should have ${ore}`);
    if (areaName !== 'special') assert.ok(!game.level.tiles.includes(game.MERCURY));
    for (const ore of ores) assert.doesNotThrow(() => findReachableOre(game, game[ore]), `${ore} must be reachable in ${areaName}`);
  }
});

test('Spiral Cavern has a connected winding route to the secret seam, including for a Golem', () => {
  const { game } = createGame();
  game.enterLevel('stage7');
  const area = game.level, seam = area.secretTile;
  const normal = reachableWalkableTiles(game, area);
  const adjacent = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  assert.ok(adjacent.some(([dx, dy]) => normal.has(`${seam.tx + dx},${seam.ty + dy}`)));
  assert.equal(area.tiles[seam.ty * area.w + seam.tx], game.TITANIUM);
  const big = reachableForRadius(game, area, game.BALANCE.golemRadius);
  assert.ok(big.has('39,36'), 'the Golem-sized route must reach the center of the coils');
  assert.ok(normal.size > 1000, 'the spiral should have substantial traversable space');
  assert.ok(normal.size < area.w * area.h / 2, 'the coils should remain separated by walls');
});

test('mining the shimmering Titanium opens the secret stairs and reseals them on re-entry', () => {
  const { game, elements, step } = createGame();
  game.enterLevel('stage7');
  suppressNewEnemySpawns(game.level);
  const area = game.level, seam = area.secretTile;
  aimPickaxeAt(game, { tx: seam.tx, ty: seam.ty, adjacentX: seam.tx + 1, adjacentY: seam.ty });
  game.state.tools.pickaxe = 4;
  for (let hit = 0; hit < game.pickaxeHits(game.TILES[game.TITANIUM]); hit++) {
    game.state.cooldown = 0;
    elements.game.dispatch('pointerdown', { pointerType: 'mouse', clientX: game.pointer.x, clientY: game.pointer.y });
  }
  assert.equal(game.getTile(seam.tx, seam.ty), game.STAIRS_DOWN);
  assert.equal(area.originalTiles[seam.ty * area.w + seam.tx], game.TITANIUM);
  assert.ok(area.pickups.some((p) => p.item === 'titanium'));
  moveToStairs(game, step, seam);
  assert.equal(game.level.id, 'special');
  assert.equal(elements['stage-name'].textContent, 'Special Cave');
  assert.equal(elements['area-subtitle'].textContent, 'A secluded mercury paradise');
  moveToStairs(game, step, game.level.stairsUp);
  assert.equal(game.level, area);
  assert.equal(game.getTile(seam.tx, seam.ty), game.TITANIUM, 'normal terrain-reset rule reseals the seam');
  assert.ok(!game.isSolid(Math.floor(game.player.x / 32), Math.floor(game.player.y / 32)), 'return must not spawn inside the resealed seam');
});

test('Drill Moles cannot destroy the hidden seam or reveal the cave accidentally', () => {
  const { game, step, math } = createGame();
  game.enterLevel('stage7');
  suppressNewEnemySpawns(game.level);
  const seam = game.level.secretTile;
  const mole = game.makeMole((seam.tx + 1.5) * 32, (seam.ty + 0.5) * 32);
  game.moles.push(mole);
  game.player.x = (seam.tx - 0.5) * 32; game.player.y = mole.y;
  game.state.invuln = 999;
  math.random = () => 0.01;
  step(18);
  assert.equal(game.getTile(seam.tx, seam.ty), game.TITANIUM);
  assert.equal(game.pickups.length, 0);
});

test('Stage 6 spawns only peaceful Tropical Slimes; Stage 7 and the secret cave have the requested enemy sets', () => {
  const { game, step, math } = createGame();
  let seed = 123456;
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const [area, expected] of [
    ['stage6', ['slime']], ['stage7', ['mole', 'spider', 'golem', 'prospector']], ['special', ['golem']],
  ]) {
    game.enterLevel(area);
    game.level.slimeTimer = game.level.moleTimer = game.level.spiderTimer = game.level.golemTimer = game.level.prospectorTimer = 0;
    step(1);
    const groups = { slime: game.slimes, mole: game.moles, spider: game.spiders, golem: game.golems, prospector: game.prospectors };
    for (const [kind, list] of Object.entries(groups)) {
      if (expected.includes(kind)) assert.ok(list.length > 0, `${kind} should spawn in ${area}`);
      else assert.equal(list.length, 0, `${kind} must not spawn in ${area}`);
    }
    const factories = { slime: 'spawnSlimeAwayFromPlayer', mole: 'spawnMoleAwayFromPlayer',
      spider: 'spawnSpiderAwayFromPlayer', golem: 'spawnGolemAwayFromPlayer', prospector: 'spawnProspectorAwayFromPlayer' };
    for (const [kind, factory] of Object.entries(factories)) {
      if (!expected.includes(kind)) assert.equal(game[factory](), null, `${kind} spawn is disallowed in ${area}`);
    }
    if (area === 'stage6') assert.ok(game.slimes.every((s) => s.tropical && !s.provoked && !s.large));
    if (area === 'stage7') assert.ok(game.golems.every((g) => !g.mercury));
    if (area === 'special') assert.ok(game.golems.every((g) => g.mercury));
  }
});

test('Tropical Slimes wander harmlessly until individually attacked; their offspring start peaceful', () => {
  const { game, step } = createGame();
  game.enterLevel('stage6');
  suppressNewEnemySpawns(game.level);
  const a = game.makeSlime(game.player.x + 18, game.player.y, false, false, true);
  const b = game.makeSlime(game.player.x - 18, game.player.y, false, false, true);
  a.speed = b.speed = 0;
  game.slimes.push(a, b);
  step(30);
  assert.equal(game.state.hp, 100);
  assert.equal(a.chasing, false);
  assert.equal(b.chasing, false);
  aimSwordAt(game, a);
  game.state.tools.sword = 1;
  game.state.cooldown = 0; game.swing();
  assert.equal(a.provoked, true);
  assert.equal(b.provoked, false);
  a.knockX = a.knockY = 0;
  a.x = game.player.x + 18; a.y = game.player.y;
  step(1);
  assert.equal(a.chasing, true);
  assert.equal(game.state.hp, 80);
  for (let i = 0; i < 2; i++) { game.state.cooldown = 0; game.swing(); }
  assert.equal(a.dead, true);
  const children = game.slimes.filter((s) => s !== a && s !== b);
  assert.equal(children.length, 2);
  assert.ok(children.every((s) => s.tiny && s.tropical && !s.provoked));
});

test('Mercury Golems are faster and harder-hitting, but less healthy and use the same deactivation', () => {
  const { game, step } = createGame();
  game.enterLevel('special');
  suppressNewEnemySpawns(game.level);
  const normal = game.makeGolem(game.player.x + 32, game.player.y);
  const mercury = game.makeGolem(game.player.x + 32, game.player.y, true);
  assert.ok(mercury.hp < normal.hp);
  assert.ok(mercury.speed > normal.speed);
  assert.ok(mercury.dmg > normal.dmg);
  assert.equal(mercury.hp, 90); assert.equal(mercury.speed, 60); assert.equal(mercury.dmg, 55);
  mercury.x = game.player.x + 5; mercury.y = game.player.y;
  mercury.disabled = 1;
  game.golems.push(mercury);
  const before = { x: mercury.x, y: mercury.y, hp: game.state.hp };
  step(10);
  assert.equal(mercury.x, before.x); assert.equal(mercury.y, before.y);
  assert.equal(game.state.hp, before.hp, 'disabled golem cannot deal contact damage');
  step(11);
  assert.equal(game.state.hp, 45, 'reactivated Mercury Golem deals 55 damage');
});

test('T4 costs raw Titanium, improves pickaxe thresholds and kills a reinforced Golem in four hits', () => {
  const { game, elements } = createGame();
  game.state.tools.pickaxe = 3; game.state.tools.sword = 3;
  const t3 = Object.fromEntries(Object.entries(game.TILES).filter(([, def]) => def.hits).map(([id, def]) => [id, game.pickaxeHits(def)]));
  game.openStation('forge');
  game.addItem('titanium', 5);
  elements['upgrade-pickaxe'].click();
  assert.equal(game.state.tools.pickaxe, 4);
  assert.equal(game.countItem('titanium'), 2);
  elements['upgrade-sword'].click();
  assert.equal(game.state.tools.sword, 3, 'upgrade cannot spend fewer than three Titanium');
  game.addItem('titanium', 1);
  elements['upgrade-sword'].click();
  assert.equal(game.state.tools.sword, 4);
  assert.equal(game.countItem('titanium'), 0);
  assert.equal(elements['upgrade-pickaxe'].textContent, 'Maxed');
  assert.equal(elements['upgrade-sword'].textContent, 'Maxed');
  for (const [id, hits] of Object.entries(t3)) assert.equal(game.pickaxeHits(game.TILES[id]), Math.max(1, hits - 2));
  assert.equal(game.tierDamage(), 35);
  game.closeStation(); game.enterLevel('stage5');
  const golem = game.makeGolem(game.player.x + 32, game.player.y);
  game.golems.push(golem);
  aimSwordAt(game, golem); game.state.tools.sword = 4;
  for (let i = 0; i < 3; i++) { game.state.cooldown = 0; game.swing(); }
  assert.equal(golem.hp, 30); assert.equal(golem.dead, false);
  game.state.cooldown = 0; game.swing();
  assert.equal(golem.dead, true);
  const large = game.makeSlime(game.player.x + 32, game.player.y, false, true);
  assert.equal(large.hp, 60, 'existing Large Slime health is preserved');
  game.slimes.push(large);
  for (let i = 0; i < 2; i++) { game.state.cooldown = 0; game.swing(); }
  assert.equal(large.dead, true, 'two T4 hits remain lethal to the existing 60-HP Large Slime');
});

test('Mercury enhancement costs three once, adds 15% at every tier, survives death, and resets on a new run', () => {
  const { game, elements } = createGame();
  game.state.tools.sword = 4;
  game.addItem('mercury', 2); game.openStation('forge');
  assert.equal(elements['upgrade-mercury'].disabled, true);
  assert.equal(game.upgradeMercurySword(), false);
  game.addItem('mercury', 4);
  elements['upgrade-mercury'].click();
  assert.equal(game.state.mercurySword, true);
  assert.equal(game.tierDamage(), 40.25);
  assert.equal(game.countItem('mercury'), 3);
  assert.equal(game.upgradeMercurySword(), false);
  assert.equal(game.countItem('mercury'), 3);
  game.state.tools.sword = 1;
  assert.equal(game.tierDamage(), 11.5);
  game.closeStation(); game.enterLevel('stage6'); game.respawnAtBase();
  assert.equal(game.state.mercurySword, true);
  game.start();
  assert.equal(game.state.mercurySword, false);
});

test('Axolotl sale is atomic with a full bag, and a freed slot receives exactly one Gold Coin', () => {
  const { game, elements } = createGame();
  game.addItem('stone', 891); // nine full stacks
  game.addItem('axolotl', 2);
  game.openStation('trader');
  assert.equal(game.sellAxolotl(), false);
  assert.equal(game.countItem('axolotl'), 2);
  assert.equal(game.countItem('goldCoin'), 0);
  game.removeItem('axolotl', 1);
  elements['trade-axolotl'].click();
  assert.equal(game.countItem('axolotl'), 0);
  assert.equal(game.countItem('goldCoin'), 1);
  assert.equal(game.traderUnlocked.gold, false, 'selling does not falsely claim that gold was pressed');
});

test('all new raw resources and creatures can be collected and stored without a Melter recipe', () => {
  const { game } = createGame();
  for (const item of ['cobalt', 'quartz', 'iridium', 'titanium', 'mercury', 'axolotl']) {
    game.addItem(item, 3);
    assert.equal(game.depositToStorage(item, 2), 2);
    assert.equal(game.storage[item], 2);
    assert.equal(game.withdrawFromStorage(item, 2), 2);
    assert.equal(game.countItem(item), 3);
  }
  assert.deepEqual(Object.keys(game.melter).sort(), ['bauxite', 'coal', 'copper', 'iron', 'selectedOre'].sort());
});

test('a real version-1 browser save is detected and migrated without losing any Stage 5 progress', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-stage6-v1.json'), 'utf8');
  const legacy = JSON.parse(text), slot = createMemoryStorage();
  slot.setItem('cuddly-train.mining-simulator.save.v1', text);
  const { game, elements, step } = createGame({ autoStart: false, storage: slot });
  assert.equal(elements['continue-save'].disabled, false);
  assert.ok(!elements['continue-save'].classList.contains('is-hidden'));
  elements['continue-save'].click();
  assert.equal(game.level.id, 'stage5');
  assert.equal(game.state.mode, 'paused');
  assert.equal(game.state.hp, 68);
  assert.equal(game.state.tools.pickaxe, 3); assert.equal(game.state.tools.sword, 2);
  assert.equal(game.state.mercurySword, false);
  assert.equal(game.countItem('gold'), 13); assert.equal(game.countItem('iron'), 8);
  assert.equal(game.storage.bauxite, 11);
  assert.equal(game.melter.coal, 3); assert.equal(game.melter.bauxite, 2);
  assert.equal(game.traderUnlocked.gold, true);
  assert.equal(game.golems[0].hp, 71); assert.equal(game.golems[0].disabled, 2);
  const exit = 36 * 64 + 42;
  const migrated = JSON.parse(game.createSaveText());
  assert.equal(migrated.version, 3);
  for (const field of ['tiles', 'originalTiles']) {
    const expected = legacy.areas.stage5[field].slice(); expected[exit] = game.STAIRS_DOWN;
    assert.deepEqual(migrated.areas.stage5[field], expected, `only the new staircase changes ${field}`);
  }
  elements.resume.click();
  moveToStairs(game, step, game.level.stairsDown);
  assert.equal(game.level.id, 'stage6', 'the migrated exit is playable');
  assert.equal(slot.getItem(game.saveKey), text, 'loading must not silently overwrite the old slot');
});

test('current saves preserve the secret entrance, Axolotls, Mercury upgrade and both new enemy variants', () => {
  const first = createGame();
  const { game } = first;
  game.state.tools.pickaxe = game.state.tools.sword = 4;
  game.addItem('mercury', 3); assert.equal(game.upgradeMercurySword(), true);
  game.addItem('axolotl', 2); game.storage.iridium = 7;
  game.enterLevel('stage6'); suppressNewEnemySpawns(game.level);
  const tropical = game.makeSlime(game.player.x + 24, game.player.y, false, false, true);
  tropical.provoked = true; tropical.hp = 22; game.slimes.push(tropical);
  const tropicalSave = game.createSaveText();
  const tropicalLoaded = createGame({ autoStart: false });
  tropicalLoaded.game.loadSaveText(tropicalSave);
  assert.equal(tropicalLoaded.game.slimes[0].tropical, true);
  assert.equal(tropicalLoaded.game.slimes[0].provoked, true);
  assert.equal(tropicalLoaded.game.slimes[0].hp, 22);
  assert.equal(tropicalLoaded.game.level.pickups.filter((p) => p.item === 'axolotl').length, 8);
  assert.equal(tropicalLoaded.game.state.mercurySword, true);
  assert.equal(tropicalLoaded.game.tierDamage(), 40.25);
  game.enterLevel('stage7'); suppressNewEnemySpawns(game.level);
  const seam = game.level.secretTile;
  aimPickaxeAt(game, { tx: seam.tx, ty: seam.ty, adjacentX: seam.tx + 1, adjacentY: seam.ty });
  for (let hit = 0; hit < game.pickaxeHits(game.TILES[game.TITANIUM]); hit++) { game.state.cooldown = 0; game.swing(); }
  assert.equal(game.getTile(seam.tx, seam.ty), game.STAIRS_DOWN);
  game.enterLevel('special'); suppressNewEnemySpawns(game.level);
  const mercury = game.makeGolem(game.player.x + 32, game.player.y, true);
  mercury.hp = 66; mercury.disabled = 1.7; mercury.moved = 0;
  game.golems.push(mercury);
  const before = comparableSave(game), text = game.createSaveText();
  const loaded = createGame({ autoStart: false }); loaded.game.loadSaveText(text);
  assert.deepEqual(comparableSave(loaded.game), before);
  assert.equal(loaded.game.golems[0].mercury, true);
  assert.equal(loaded.game.golems[0].dmg, 55);
  assert.equal(loaded.game.golems[0].disabled, 1.7);
  assert.equal(loaded.game.storage.iridium, 7);
  assert.equal(loaded.game.levels.stage7.tiles[seam.ty * loaded.game.levels.stage7.w + seam.tx], loaded.game.STAIRS_DOWN);
  loaded.game.enterLevel('stage7');
  assert.equal(loaded.game.getTile(seam.tx, seam.ty), loaded.game.TITANIUM);
});

test('damaged new-variant saves fail atomically without changing current progress', () => {
  const { game } = createGame();
  game.enterLevel('stage6');
  const slime = game.makeSlime(game.player.x + 32, game.player.y, false, false, true);
  game.slimes.push(slime);
  const before = comparableSave(game), cases = [];
  const missingFlag = structuredClone(before); delete missingFlag.enemies.slimes[0].provoked; cases.push(missingFlag);
  const impossible = structuredClone(before); impossible.enemies.slimes[0].large = true; cases.push(impossible);
  const noUpgradeFlag = structuredClone(before); delete noUpgradeFlag.state.mercurySword; cases.push(noUpgradeFlag);
  for (const invalid of cases) {
    invalid.savedAt = new Date().toISOString();
    assert.throws(() => game.loadSaveText(JSON.stringify(invalid)));
    assert.deepEqual(comparableSave(game), before);
  }
});

test('touch joystick moves, allows a second touch to swing, and releases safely on cancel or pause', () => {
  const { game, elements, step } = createGame();
  game.enterLevel('stage6'); suppressNewEnemySpawns(game.level);
  const pad = elements['touch-move'];
  const start = game.player.x;
  // The mock pad's bounding box is 1280 x 800, so this is right of its centre.
  pad.dispatch('pointerdown', { pointerId: 17, pointerType: 'touch', clientX: 720, clientY: 400 });
  step(5);
  assert.ok(game.player.x > start, 'dragging the pad moves the player');
  const beforeTap = game.player.x;
  game.state.cooldown = 0;
  elements.game.dispatch('pointerdown', { pointerId: 18, pointerType: 'touch', clientX: 690, clientY: 400 });
  assert.ok(game.state.cooldown > 0, 'a second finger swings on the game field');
  step(5);
  assert.ok(game.player.x > beforeTap, 'field touch does not steal the movement pointer');
  pad.dispatch('pointercancel', { pointerId: 17 });
  const stopped = game.player.x; step(4);
  assert.equal(game.player.x, stopped, 'cancel releases movement');
  pad.dispatch('pointerdown', { pointerId: 19, pointerType: 'touch', clientX: 720, clientY: 400 });
  elements['pause-btn'].click(); elements.resume.click();
  const resumed = game.player.x; step(4);
  assert.equal(game.player.x, resumed, 'pausing clears a held direction');
});

test('new ores are genuinely mineable and their drops fly into the bag', () => {
  const { game, step } = createGame();
  game.enterLevel('special'); suppressNewEnemySpawns(game.level);
  game.state.tools.pickaxe = 4;
  for (const [tile, item] of [['COBALT', 'cobalt'], ['QUARTZ', 'quartz'], ['IRIDIUM', 'iridium'], ['TITANIUM', 'titanium'], ['MERCURY', 'mercury']]) {
    mine(game, game[tile]);
    for (let i = 1; i < game.pickaxeHits(game.TILES[game[tile]]); i++) {
      game.state.cooldown = 0; game.swing();
    }
    assert.equal(game.getTile(6, 5), game.FLOOR, `${item} must be broken at the correct threshold`);
    assert.ok(game.pickups.some((p) => p.item === item));
    step(26);
    assert.equal(game.countItem(item), 1, `${item} drop must be collected once`);
  }
});

test('Mercury Golems deactivate after ten tiles of actual movement, then reactivate', () => {
  const { game, step } = createGame();
  game.enterLevel('special'); suppressNewEnemySpawns(game.level);
  for (let y = 10; y <= 14; y++) for (let x = 5; x <= 40; x++) game.setTile(x, y, game.FLOOR);
  game.player.x = 35.5 * 32; game.player.y = 12.5 * 32;
  const golem = game.makeGolem(8.5 * 32, 12.5 * 32, true);
  golem.detect = 50 * 32; game.golems.push(golem);
  step(Math.ceil(game.BALANCE.golemMoveLimit / (golem.speed * 0.05)));
  assert.ok(golem.disabled > 2.5 && golem.disabled <= 3, `must disable after travel: ${golem.disabled}`);
  assert.equal(golem.moved, 0);
  const x = golem.x; step(30);
  assert.equal(golem.x, x, 'disabled golem stays still');
  step(35);
  assert.equal(golem.disabled, 0);
  assert.ok(golem.x > x, 'the golem moves again when the timer expires');
});

test('new cave lanterns and ferns sit on open terrain rather than inside rocks', () => {
  const { game } = createGame();
  for (const id of ['stage6', 'stage7', 'special']) {
    game.enterLevel(id);
    for (const decor of game.level.decor) {
      const tx = Math.floor(decor.x / 32), ty = Math.floor(decor.y / 32);
      assert.equal(game.isSolid(tx, ty), false, `${id} ${decor.kind} at ${tx},${ty} belongs on open floor`);
    }
  }
});

// Elevator update, adaptive Golem armour and loot, and the redesigned oasis.
test('elevator entrances sit beside every ordinary staircase and never in the secret cave', () => {
  const { game } = createGame();
  for (const id of ['home', 'stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'stage6', 'stage7', 'special']) {
    if (id !== 'home') game.enterLevel(id);
    const area = game.level;
    const stairs = id === 'special' ? [] : [area.stairsUp, area.stairsDown].filter(Boolean);
    assert.equal(area.elevators.length, stairs.length, `${id} must have a lift at each staircase`);
    const reachable = reachableWalkableTiles(game, area);
    for (const stair of stairs) {
      const adjacent = area.elevators.filter((lift) => Math.abs(lift.tx - stair.tx) + Math.abs(lift.ty - stair.ty) === 1);
      assert.equal(adjacent.length, 1, `${id} needs one lift right next to the staircase`);
      const lift = adjacent[0];
      assert.equal(game.isSolid(lift.tx, lift.ty), false);
      assert.ok(reachable.has(`${lift.tx},${lift.ty}`), `${id} lift must be accessible`);
    }
    if (id === 'stage7') {
      assert.ok(area.elevators.every((lift) => Math.abs(lift.tx - area.secretTile.tx) +
        Math.abs(lift.ty - area.secretTile.ty) > 1), 'the hidden seam is not a lift stop');
    }
  }
});

test('elevator stays offline until reactivated on Stage 7, then travels only to visited normal floors', () => {
  const { game, elements, listeners } = createGame();
  let lift = game.level.elevators[0];
  game.player.x = lift.x; game.player.y = lift.y;
  assert.equal(game.useElevator(lift), true);
  assert.equal(game.state.mode, 'station');
  assert.match(elements['elevator-status'].textContent, /Stage 7/);
  assert.equal(elements['elevator-floors'].children.length, 8);
  assert.ok(elements['elevator-floors'].children.every((button) => button.disabled));
  assert.equal(game.activateElevator(), false);
  assert.equal(game.travelByElevator('stage7'), false);
  game.closeStation();

  game.enterLevel('stage7');
  lift = game.level.elevators[0];
  game.player.x = lift.x; game.player.y = lift.y;
  game.camera.x = lift.x; game.camera.y = lift.y;
  // The actual desktop/touch canvas target opens the lift, not a sword swing.
  elements.game.dispatch('pointerdown', { clientX: 640, clientY: 400, pointerType: 'mouse' });
  assert.equal(game.state.openStation, 'elevator');
  assert.equal(elements['elevator-activate'].classList.contains('is-hidden'), false);
  assert.equal(elements['elevator-activate'].disabled, false);
  elements['elevator-activate'].click();
  assert.equal(game.state.elevatorUnlocked, true);
  assert.equal(elements['elevator-floors'].children[0].disabled, false, 'Home was visited');
  assert.equal(elements['elevator-floors'].children[1].disabled, true, 'unvisited Stage 1 remains locked');
  assert.equal(elements['elevator-floors'].children[7].disabled, true, 'current floor is not a destination');
  assert.equal(game.travelByElevator('special'), false);
  elements['elevator-floors'].children[0].click();
  assert.equal(game.level.id, 'home');
  assert.equal(game.state.mode, 'playing');
  assert.equal(game.player.x, game.level.elevators[0].x);
  assert.equal(game.player.y, game.level.elevators[0].y);

  // The keyboard shortcut also opens a nearby lift; distant lifts do not.
  listeners.keydown[0]({ code: 'KeyF', target: { tagName: 'BODY' }, preventDefault: noop });
  assert.equal(game.state.openStation, 'elevator');
  assert.equal(elements['elevator-floors'].children[7].disabled, false);
  elements['elevator-floors'].children[7].click();
  assert.equal(game.level.id, 'stage7');
  assert.equal(game.player.x, game.level.elevators[0].x);
  game.player.x += 6 * 32;
  listeners.keydown[0]({ code: 'KeyF', target: { tagName: 'BODY' }, preventDefault: noop });
  assert.equal(game.state.mode, 'playing');
});

test('elevator trips use normal terrain resets and preserve inventory, unlock and save state', () => {
  const first = createGame();
  const { game, elements, step } = first;
  game.enterLevel('stage7');
  let lift = game.level.elevators[0];
  game.player.x = lift.x; game.player.y = lift.y;
  game.useElevator(lift); assert.equal(game.activateElevator(), true); game.closeStation();
  game.enterLevel('stage6');
  const area = game.level;
  const rock = area.tiles.findIndex((tile) => tile === game.QUARTZ);
  assert.ok(rock > 0); area.tiles[rock] = game.FLOOR;
  game.addItem('gold', 8); game.storage.iridium = 12;
  lift = area.elevators[1]; game.player.x = lift.x; game.player.y = lift.y;
  assert.equal(game.useElevator(lift), true);
  assert.equal(game.travelByElevator('home'), true);
  lift = game.level.elevators[0]; game.player.x = lift.x; game.player.y = lift.y;
  assert.equal(game.useElevator(lift), true);
  assert.equal(game.travelByElevator('stage6'), true);
  assert.equal(area.tiles[rock], game.QUARTZ, 'lift re-entry restores original terrain');
  assert.equal(game.countItem('gold'), 8); assert.equal(game.storage.iridium, 12);
  suppressNewEnemySpawns(area);
  step(25);
  assert.equal(game.level.id, 'stage6', 'landing beside the lift must not retrigger stairs');

  const saved = JSON.parse(game.createSaveText());
  assert.equal(saved.version, 3); assert.equal(saved.state.elevatorUnlocked, true);
  const restored = createGame({ autoStart: false });
  restored.game.loadSaveText(JSON.stringify(saved));
  assert.equal(restored.game.state.elevatorUnlocked, true);
  assert.equal(restored.game.level.id, 'stage6');
  restored.elements.resume.click();
  lift = restored.game.level.elevators[0];
  restored.game.player.x = lift.x; restored.game.player.y = lift.y;
  assert.equal(restored.game.useElevator(lift), true);
  assert.equal(restored.elements['elevator-floors'].children[0].disabled, false);
  assert.equal(restored.elements['elevator-floors'].children[1].disabled, true, 'never-visited floor remains locked after load');
  assert.equal(restored.elements['elevator-floors'].children[7].disabled, false);
  restored.game.closeStation(); restored.game.respawnAtBase();
  assert.equal(restored.game.state.elevatorUnlocked, true, 'death keeps power restored');
  restored.game.start();
  assert.equal(restored.game.state.elevatorUnlocked, false, 'a new run resets power and visits');
});

test('v2 oasis saves keep current tiles and loot, then adopt the open layout safely on re-entry', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-elevator-v2.json'), 'utf8');
  const legacy = JSON.parse(text), slot = createMemoryStorage();
  slot.setItem('cuddly-train.mining-simulator.save.v1', text);
  const { game, elements } = createGame({ autoStart: false, storage: slot });
  assert.equal(elements['continue-save'].disabled, false, 'v2 browser slot is recognized on the title screen');
  elements['continue-save'].click();
  assert.equal(game.level.id, 'stage6');
  assert.equal(game.state.elevatorUnlocked, false);
  assert.equal(game.state.tools.sword, 4); assert.equal(game.state.mercurySword, true);
  assert.equal(game.state.hp, 73); assert.equal(game.storage.iridium, 9);
  assert.equal(game.countItem('axolotl'), 2); assert.equal(game.countItem('mercury'), 4);
  assert.deepEqual(Array.from(game.level.tiles), legacy.areas.stage6.tiles, 'do not alter the occupied cave immediately');
  assert.deepEqual(Array.from(game.level.damage, ([key, value]) => [key, value]), legacy.areas.stage6.damage, 'partial mining survives load');
  assert.equal(game.player.x, legacy.player.x); assert.equal(game.player.y, legacy.player.y);
  assert.equal(game.slimes[0].hp, 17); assert.equal(game.slimes[0].provoked, true);
  assert.notDeepEqual(Array.from(game.level.originalTiles), legacy.areas.stage6.originalTiles);
  const newLayout = Array.from(game.level.originalTiles);
  const pickupsBefore = Array.from(game.level.pickups, (p) => `${p.item}:${p.count}`).sort();
  assert.equal(game.level.elevators.length, 2);

  // Saving before leaving must keep the old occupied map AND the new baseline.
  const intermediate = game.createSaveText(), next = createGame({ autoStart: false });
  next.game.loadSaveText(intermediate);
  assert.deepEqual(Array.from(next.game.level.tiles), legacy.areas.stage6.tiles);
  assert.deepEqual(Array.from(next.game.level.originalTiles), newLayout);
  next.game.enterLevel('stage5'); next.game.enterLevel('stage6');
  const area = next.game.level, reachable = reachableWalkableTiles(next.game, area);
  assert.deepEqual(Array.from(area.tiles), newLayout);
  assert.equal(area.damage.size, 0);
  assert.deepEqual(Array.from(area.pickups, (p) => `${p.item}:${p.count}`).sort(), pickupsBefore);
  for (const pickup of area.pickups) {
    const tx = Math.floor(pickup.x / 32), ty = Math.floor(pickup.y / 32);
    assert.equal(next.game.isSolid(tx, ty), false, 'migrated loot must not be buried');
    assert.ok(reachable.has(`${tx},${ty}`), 'migrated loot remains reachable');
  }
  assert.equal(next.game.countItem('axolotl'), 2); assert.equal(next.game.storage.iridium, 9);
  assert.ok(next.game.levels.stage7 && next.game.levels.special, 'old visited areas are preserved');
  assert.doesNotThrow(() => next.game.loadSaveText(next.game.createSaveText()));
});

test('newly spawned Golems take exactly one additional hit at every sword tier, with or without Mercury Edge', () => {
  const { game } = createGame();
  game.enterLevel('stage5'); suppressNewEnemySpawns(game.level);
  game.player.x = 10.5 * 32; game.player.y = 10.5 * 32;
  for (const mercurySword of [false, true]) for (const tier of [1, 2, 3, 4]) {
    game.state.tools.sword = tier; game.state.mercurySword = mercurySword;
    const damage = game.tierDamage();
    for (const mercuryGolem of [false, true]) {
      const base = mercuryGolem ? 80 : 100;
      const golem = game.makeGolem(game.player.x + 32, game.player.y, mercuryGolem);
      assert.equal(golem.maxHp, base + damage);
      assert.equal(golem.hp, golem.maxHp);
      assert.equal(golem.speed, mercuryGolem ? 60 : 42);
      game.golems.length = 0; game.golems.push(golem);
      aimSwordAt(game, golem);
      game.state.tools.sword = tier; // the shared aim helper defaults to T3
      const oldHits = Math.ceil(base / damage);
      for (let hit = 0; hit < oldHits; hit++) { game.state.cooldown = 0; game.swing(); }
      assert.equal(golem.dead, false, `tier ${tier}, Mercury Edge ${mercurySword}, Mercury Golem ${mercuryGolem}`);
      game.state.cooldown = 0; game.swing();
      assert.equal(golem.dead, true, 'the next swing kills it');
    }
  }
});

test('v3 persists Golem maximum HP and legacy live Golems keep their absolute health', () => {
  const current = createGame();
  current.game.enterLevel('special'); suppressNewEnemySpawns(current.game.level);
  current.game.state.tools.sword = 4; current.game.state.mercurySword = true;
  const enemy = current.game.makeGolem(current.game.player.x + 32, current.game.player.y, true);
  enemy.hp = 41; current.game.golems.push(enemy);
  const saved = JSON.parse(current.game.createSaveText());
  assert.equal(saved.enemies.golems[0].maxHp, 120.25);
  // Changing the current sword after spawning must not recalculate a live Golem.
  saved.state.tools.sword = 1; saved.state.mercurySword = false;
  const restored = createGame({ autoStart: false }); restored.game.loadSaveText(JSON.stringify(saved));
  assert.equal(restored.game.golems[0].hp, 41);
  assert.equal(restored.game.golems[0].maxHp, 120.25);
  assert.equal(restored.game.golems[0].speed, 60);

  const legacy = structuredClone(saved);
  legacy.version = 2; delete legacy.state.elevatorUnlocked; delete legacy.enemies.golems[0].maxHp;
  const migrated = createGame({ autoStart: false }); migrated.game.loadSaveText(JSON.stringify(legacy));
  assert.equal(migrated.game.golems[0].hp, 41, 'migration never heals an enemy');
  assert.equal(migrated.game.golems[0].maxHp, 90);
  assert.equal(migrated.game.golems[0].speed, 60);
  const genuineV1 = createGame({ autoStart: false });
  genuineV1.game.loadSaveText(fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-stage6-v1.json'), 'utf8'));
  assert.equal(genuineV1.game.golems[0].hp, 71);
  assert.equal(genuineV1.game.golems[0].maxHp, 115, 'saved T2 sword adds 15 armour without healing');
});

test('Golem loot is guaranteed, Titanium has a strict 1% threshold, and Mercury ranges from 2 to 4', () => {
  const { game, math } = createGame();
  game.enterLevel('stage5'); suppressNewEnemySpawns(game.level);
  game.player.x = 10.5 * 32; game.player.y = 10.5 * 32;
  const defeat = (mercury, random) => {
    game.level.pickups.length = 0; game.golems.length = 0;
    const golem = game.makeGolem(game.player.x + 32, game.player.y, mercury);
    golem.hp = 1; game.golems.push(golem); aimSwordAt(game, golem);
    math.random = () => random;
    game.state.cooldown = 0; game.swing();
    assert.equal(golem.dead, true);
    const drops = game.level.pickups.filter((pickup) => pickup.source === 'golem');
    assert.ok(drops.every((pickup) => pickup.phase === 'ground'));
    const before = drops.length;
    game.state.cooldown = 0; game.swing();
    assert.equal(game.level.pickups.filter((pickup) => pickup.source === 'golem').length, before, 'no duplicate loot');
    return Object.fromEntries(drops.map(({ item, count }) => [item, count]));
  };
  assert.deepEqual(defeat(false, 0), { stone: 2, bauxite: 3, titanium: 1 });
  assert.deepEqual(defeat(false, 0.009999), { stone: 2, bauxite: 3, titanium: 1 });
  assert.deepEqual(defeat(false, 0.01), { stone: 2, bauxite: 3 });
  assert.deepEqual(defeat(false, 0.99), { stone: 2, bauxite: 3 });
  assert.deepEqual(defeat(true, 0), { mercury: 2 });
  assert.deepEqual(defeat(true, 0.5), { mercury: 3 });
  assert.deepEqual(defeat(true, 0.99999), { mercury: 4 });
});

test('Golem drops survive a full bag, portable save and cave re-entry without duplication', () => {
  const { game, math, step } = createGame();
  game.addItem('stone', 990);
  game.enterLevel('stage5'); suppressNewEnemySpawns(game.level);
  game.player.x = 10.5 * 32; game.player.y = 10.5 * 32;
  const enemy = game.makeGolem(game.player.x + 32, game.player.y);
  enemy.hp = 1; game.golems.push(enemy); aimSwordAt(game, enemy);
  math.random = () => 0.5;
  game.state.cooldown = 0; game.swing(); step(30);
  assert.equal(game.pickups.filter((p) => p.source === 'golem').length, 2);
  assert.equal(game.countItem('stone'), 990); assert.equal(game.countItem('bauxite'), 0);
  const text = game.createSaveText(), loaded = createGame({ autoStart: false });
  loaded.game.loadSaveText(text);
  assert.equal(loaded.game.pickups.filter((p) => p.source === 'golem').length, 2);
  loaded.elements.resume.click(); loaded.game.enterLevel('stage4'); loaded.game.enterLevel('stage5');
  suppressNewEnemySpawns(loaded.game.level);
  loaded.game.removeItem('stone', 198); // free room for both resource types
  for (const pickup of [...loaded.game.pickups.filter((p) => p.source === 'golem')]) {
    loaded.game.player.x = pickup.x; loaded.game.player.y = pickup.y; loaded.step(30);
  }
  assert.equal(loaded.game.countItem('stone'), 794);
  assert.equal(loaded.game.countItem('bauxite'), 3);
  assert.equal(loaded.game.pickups.filter((p) => p.source === 'golem').length, 0);
});

test('open Luscious Cave contains separate small mineable clumps and connected pools', () => {
  const { game } = createGame(); game.enterLevel('stage6');
  const area = game.level, reachable = reachableWalkableTiles(game, area);
  const interior = (area.w - 2) * (area.h - 2);
  const floors = [...area.tiles].filter((tile) => !game.TILES[tile].solid).length;
  assert.ok(floors / interior > 0.8, 'the cavern should be mostly open');
  assert.equal(reachable.size, floors, 'all floor and pools connect');
  const solids = new Set();
  for (let y = 1; y < area.h - 1; y++) for (let x = 1; x < area.w - 1; x++) {
    const tile = area.tiles[y * area.w + x];
    if (game.TILES[tile].solid) {
      assert.ok([game.STONE, game.GOLD, game.COBALT, game.QUARTZ].includes(tile), 'every interior block can be mined');
      solids.add(`${x},${y}`);
    }
  }
  const sizes = [];
  while (solids.size) {
    const first = solids.values().next().value, queue = [first]; solids.delete(first);
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i].split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${x + dx},${y + dy}`;
        if (solids.delete(key)) queue.push(key);
      }
    }
    sizes.push(queue.length);
  }
  assert.ok(sizes.length >= 10, 'several scattered clumps instead of room walls');
  assert.ok(Math.max(...sizes) < 60, 'each clump stays small');
  assert.equal(area.wetSpots.length, 8);
  assert.equal(area.pickups.filter((p) => p.item === 'axolotl').length, 8);
});

test('Tropical Slimes favor wet spots without piling together and drift gently when peaceful', () => {
  const { game, math, step } = createGame(); game.enterLevel('stage6');
  suppressNewEnemySpawns(game.level);
  let seed = 318241;
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let near = 0;
  for (let i = 0; i < 300; i++) {
    game.slimes.length = 0;
    const slime = game.spawnSlimeAwayFromPlayer();
    assert.ok(slime && slime.tropical && !slime.provoked);
    const distance = Math.min(...game.level.wetSpots.map((pool) =>
      Math.hypot(slime.x / 32 - pool.tx - 0.5, slime.y / 32 - pool.ty - 0.5)));
    if (distance <= 4) near++;
  }
  assert.ok(near > 215, `wet spots should be favored, got ${near}/300`);
  game.slimes.length = 0;
  for (let i = 0; i < 7; i++) assert.ok(game.spawnSlimeAwayFromPlayer());
  for (let i = 0; i < game.slimes.length; i++) for (let j = i + 1; j < game.slimes.length; j++) {
    assert.ok(Math.hypot(game.slimes[i].x - game.slimes[j].x, game.slimes[i].y - game.slimes[j].y) >= 2 * 32,
      'new tropical slimes do not spawn in a pile');
  }

  game.slimes.length = 0;
  for (let y = 15; y <= 27; y++) for (let x = 27; x <= 43; x++) game.setTile(x, y, game.FLOOR);
  const pool = game.level.wetSpots.find((spot) => spot.tx === 31 && spot.ty === 21);
  const slime = game.makeSlime((pool.tx + 8.5) * 32, (pool.ty + 0.5) * 32, false, false, true);
  slime.wanderTimer = 0; game.slimes.push(slime);
  game.player.x = 6.5 * 32; game.player.y = 8.5 * 32;
  math.random = () => 0.1;
  const before = Math.hypot(slime.x - (pool.tx + 0.5) * 32, slime.y - (pool.ty + 0.5) * 32);
  step(80);
  const after = Math.hypot(slime.x - (pool.tx + 0.5) * 32, slime.y - (pool.ty + 0.5) * 32);
  assert.ok(after < before, 'peaceful slime gently drifts toward the nearest pool');
  assert.equal(slime.chasing, false); assert.equal(slime.provoked, false);
});

test('malformed v3 lift and armour data fails atomically', () => {
  const { game } = createGame();
  game.enterLevel('stage7');
  const enemy = game.makeGolem(game.player.x + 32, game.player.y);
  game.golems.push(enemy);
  const before = comparableSave(game), cases = [];
  const missingUnlock = structuredClone(before); delete missingUnlock.state.elevatorUnlocked; cases.push(missingUnlock);
  const wrongUnlock = structuredClone(before); wrongUnlock.state.elevatorUnlocked = 'yes'; cases.push(wrongUnlock);
  const missingMax = structuredClone(before); delete missingMax.enemies.golems[0].maxHp; cases.push(missingMax);
  const badMax = structuredClone(before); badMax.enemies.golems[0].maxHp = 10000; cases.push(badMax);
  const impossibleMax = structuredClone(before); impossibleMax.enemies.golems[0].maxHp = 112; cases.push(impossibleMax);
  const excessiveHp = structuredClone(before); excessiveHp.enemies.golems[0].hp = excessiveHp.enemies.golems[0].maxHp + 1; cases.push(excessiveHp);
  const noStage7 = structuredClone(before); noStage7.state.elevatorUnlocked = true;
  delete noStage7.areas.stage7; noStage7.currentLevel = 'home'; cases.push(noStage7);
  for (const invalid of cases) {
    invalid.savedAt = new Date().toISOString();
    assert.throws(() => game.loadSaveText(JSON.stringify(invalid)));
    assert.deepEqual(comparableSave(game), before, 'invalid import cannot change the active game');
  }
});

test('an activated elevator visits every previously visited normal floor but never the special cave', () => {
  const { game, elements } = createGame();
  const ids = ['home', 'stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'stage6', 'stage7'];
  for (const id of [...ids.slice(1), 'special', 'stage7']) game.enterLevel(id);
  let lift = game.level.elevators[0]; game.player.x = lift.x; game.player.y = lift.y;
  assert.equal(game.useElevator(lift), true); assert.equal(game.activateElevator(), true);
  assert.equal(elements['elevator-floors'].children.length, ids.length);
  assert.ok(elements['elevator-floors'].children.every((button) => !/special|secret/i.test(button.attributes['aria-label'])));
  assert.equal(game.travelByElevator('special'), false);
  game.closeStation();
  for (let i = 0; i < ids.length; i++) {
    const entries = game.level.elevators;
    lift = entries[i % entries.length]; game.player.x = lift.x; game.player.y = lift.y;
    assert.equal(game.useElevator(lift), true);
    assert.equal(elements['elevator-floors'].children[i].disabled, false, `${ids[i]} was visited`);
    elements['elevator-floors'].children[i].click();
    assert.equal(game.level.id, ids[i]);
    assert.equal(game.state.mode, 'playing');
  }
});

test('a faraway elevator does not steal an ordinary left-click swing', () => {
  const { game, elements } = createGame();
  game.enterLevel('stage6'); suppressNewEnemySpawns(game.level);
  const lift = game.level.elevators[0];
  game.player.x = lift.x + 8 * 32; game.player.y = lift.y;
  game.camera.x = game.player.x; game.camera.y = game.player.y;
  game.state.cooldown = 0; game.selectTool('sword');
  const x = lift.x - game.camera.x + 1280 / 2, y = lift.y - game.camera.y + 800 / 2;
  elements.game.dispatch('pointerdown', { clientX: x, clientY: y, pointerType: 'mouse' });
  assert.equal(game.state.mode, 'playing');
  assert.ok(game.state.cooldown > 0, 'left click still swings when the lift is out of reach');
});

test('randomized cave generation always leaves both staircase lifts usable', () => {
  const { game, math } = createGame();
  let seed = 431723;
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let run = 0; run < 12; run++) for (const build of [game.buildStage1, game.buildStage2,
    game.buildStage3, game.buildStage4, game.buildStage5, game.buildStage6, game.buildStage7]) {
    const area = build(), stairs = [area.stairsUp, area.stairsDown].filter(Boolean);
    assert.equal(area.elevators.length, stairs.length, `${area.id}, run ${run}`);
    const reachable = reachableWalkableTiles(game, area);
    for (const lift of area.elevators) {
      assert.ok(reachable.has(`${lift.tx},${lift.ty}`), `${area.id} lift must remain reachable`);
      assert.ok(!game.TILES[area.originalTiles[lift.ty * area.w + lift.tx]].solid);
      assert.ok(!area.originalStalagmites.has(`${lift.tx},${lift.ty}`));
    }
  }
});

test('a v2 ground pickup under a new clump is relocated and remains collectible', () => {
  const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-elevator-v2.json'), 'utf8'));
  const probe = createGame({ autoStart: false }); probe.game.loadSaveText(JSON.stringify(legacy));
  const area = probe.game.level;
  const oldReachable = reachableWalkableTiles(probe.game, area);
  let selected = null;
  for (let y = 2; y < area.h - 2 && !selected; y++) for (let x = 2; x < area.w - 2; x++) {
    const index = y * area.w + x;
    if (oldReachable.has(`${x},${y}`) && area.tiles[index] === probe.game.FLOOR &&
        probe.game.TILES[area.originalTiles[index]].solid) { selected = { x, y }; break; }
  }
  assert.ok(selected, 'a new clump replaces some previously walkable terrain');
  const x = (selected.x + 0.5) * 32, y = (selected.y + 0.5) * 32;
  legacy.areas.stage6.pickups.push({ item: 'quartz', count: 5, x, y, originX: x, originY: y,
    phase: 'ground', age: 0, delay: 0, rise: 20, source: 'mining', alreadyCollected: false });
  const loaded = createGame({ autoStart: false }); loaded.game.loadSaveText(JSON.stringify(legacy));
  const drop = loaded.game.pickups.find((p) => p.item === 'quartz' && p.count === 5);
  assert.ok(drop); assert.equal(drop.x, x); assert.equal(drop.y, y);
  loaded.elements.resume.click(); loaded.game.enterLevel('stage5'); loaded.game.enterLevel('stage6');
  suppressNewEnemySpawns(loaded.game.level);
  assert.ok(drop.x !== x || drop.y !== y, 'buried loot moves to a nearby reachable floor');
  const tx = Math.floor(drop.x / 32), ty = Math.floor(drop.y / 32);
  assert.equal(loaded.game.isSolid(tx, ty), false);
  assert.ok(reachableWalkableTiles(loaded.game, loaded.game.level).has(`${tx},${ty}`));
  loaded.game.player.x = drop.x; loaded.game.player.y = drop.y; loaded.step(30);
  assert.equal(loaded.game.countItem('quartz'), 5);
  assert.equal(loaded.game.pickups.includes(drop), false);
});
