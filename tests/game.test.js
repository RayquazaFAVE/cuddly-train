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
  for (let i = 0; i < 6; i++) {
    game.state.cooldown = 0;
    game.swing();
  }
  assert.equal(mole.dead, true);
  assert.equal(game.state.molesSlain, 1);
  assert.equal(game.slimes.length, 0);

  const stronger = game.makeMole(game.player.x + 32, game.player.y);
  game.moles.push(stronger);
  game.state.tools.sword = 3;
  for (let i = 0; i < 2; i++) { game.state.cooldown = 0; game.swing(); }
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
  assert.ok(game.moles.length > 0 && game.moles.length <= game.BALANCE.maxMoles);
  assert.ok(game.slimes.length > 0 && game.slimes.length <= game.BALANCE.maxSlimes);
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
  for (let i = 0; i < 3; i++) { game.state.cooldown = 0; game.swing(); }
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
  for (let i = 0; i < 3; i++) { game.state.cooldown = 0; game.swing(); }
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
  for (let i = 0; i < 3; i++) { game.state.cooldown = 0; game.swing(); }
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
  for (const id of ['home', 'stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'stage6', 'stage7', 'stage8', 'stage9', 'stage10', 'stage11', 'stage12', 'stage13', 'special']) {
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
  assert.equal(large.hp, 90);
  assert.equal(game.slimes.length, 1);
  for (let i = 0; i < 3; i++) { game.state.cooldown = 0; game.swing(); }
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
  for (let i = 0; i < 2; i++) { game.state.cooldown = 0; game.swing(); }
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
  assert.equal(spider.hp, 20);
  for (let i = 0; i < 2; i++) { game.state.cooldown = 0; game.swing(); }
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
  for (let i = 0; i < 8; i++) { game.state.cooldown = 0; game.swing(); }
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
  assert.equal((html.match(/data-close-station/g) || []).length, 7);
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
  for (const id of ['stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'stage6', 'stage7', 'stage8', 'stage9', 'stage10', 'stage11', 'stage12', 'stage13', 'special']) {
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
  area.ghostTimer = area.graveDiggerTimer = area.infectedSkeletonTimer = 999;
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
    ['stage8', ['STONE', 'SILVER', 'QUARTZ', 'RUBY']],
    ['stage9', ['DARKSTONE', 'RUBY', 'SAPPHIRE']],
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
  for (let i = 0; i < 5; i++) { game.state.cooldown = 0; game.swing(); }
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
  assert.equal(mercury.hp, 180); assert.equal(mercury.speed, 60); assert.equal(mercury.dmg, 55);
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

test('T4 costs raw Titanium, improves pickaxe thresholds and kills a reinforced Golem in eight hits', () => {
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
  for (let i = 0; i < 7; i++) { game.state.cooldown = 0; game.swing(); }
  assert.equal(golem.hp, 25); assert.equal(golem.dead, false);
  game.state.cooldown = 0; game.swing();
  assert.equal(golem.dead, true);
  const large = game.makeSlime(game.player.x + 32, game.player.y, false, true);
  assert.equal(large.hp, 120, 'Large Slime health is doubled');
  game.slimes.push(large);
  for (let i = 0; i < 4; i++) { game.state.cooldown = 0; game.swing(); }
  assert.equal(large.dead, true, 'four T4 hits defeat the 120-HP Large Slime');
});

test('Mercury enhancement costs three once, keeps base sword damage, survives death, and resets on a new run', () => {
  const { game, elements } = createGame();
  game.state.tools.sword = 4;
  game.addItem('mercury', 2); game.openStation('forge');
  assert.equal(elements['upgrade-mercury'].disabled, true);
  assert.equal(game.upgradeMercurySword(), false);
  game.addItem('mercury', 4);
  elements['upgrade-mercury'].click();
  assert.equal(game.state.mercurySword, true);
  assert.equal(game.tierDamage(), 35);
  assert.equal(game.countItem('mercury'), 3);
  assert.equal(game.upgradeMercurySword(), false);
  assert.equal(game.countItem('mercury'), 3);
  game.state.tools.sword = 1;
  assert.equal(game.tierDamage(), 10);
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
  assert.equal(game.golems[0].hp, 142); assert.equal(game.golems[0].disabled, 2);
  const exit = 36 * 64 + 42;
  const migrated = JSON.parse(game.createSaveText());
  assert.equal(migrated.version, 9);
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
  assert.equal(tropicalLoaded.game.tierDamage(), 35);
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
  for (const id of ['stage6', 'stage7', 'stage8', 'stage9', 'stage11', 'stage12', 'stage13', 'special']) {
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
  for (const id of ['home', 'stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'stage6', 'stage7', 'stage8', 'stage9', 'stage10', 'stage11', 'stage12', 'stage13', 'special']) {
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
  assert.equal(elements['elevator-floors'].children.length, 14);
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
  assert.equal(saved.version, 9); assert.equal(saved.state.elevatorUnlocked, true);
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
  assert.equal(game.slimes[0].hp, 34); assert.equal(game.slimes[0].provoked, true);
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

test('newly spawned Golems have doubled adaptive health at every sword tier, with or without Mercury Edge', () => {
  const { game } = createGame();
  game.enterLevel('stage5'); suppressNewEnemySpawns(game.level);
  game.player.x = 10.5 * 32; game.player.y = 10.5 * 32;
  for (const mercurySword of [false, true]) for (const tier of [1, 2, 3, 4]) {
    game.state.tools.sword = tier; game.state.mercurySword = mercurySword;
    const damage = game.tierDamage();
    for (const mercuryGolem of [false, true]) {
      const base = mercuryGolem ? 80 : 100;
      const golem = game.makeGolem(game.player.x + 32, game.player.y, mercuryGolem);
      assert.equal(golem.maxHp, 2 * (base + damage));
      assert.equal(golem.hp, golem.maxHp);
      assert.equal(golem.speed, mercuryGolem ? 60 : 42);
      game.golems.length = 0; game.golems.push(golem);
      aimSwordAt(game, golem);
      game.state.tools.sword = tier; // the shared aim helper defaults to T3
      const oldHits = Math.ceil(2 * (base + damage) / damage) - 1;
      for (let hit = 0; hit < oldHits; hit++) { game.state.cooldown = 0; game.swing(); }
      assert.equal(golem.dead, false, `tier ${tier}, Mercury Edge ${mercurySword}, Mercury Golem ${mercuryGolem}`);
      game.state.cooldown = 0; game.swing();
      assert.equal(golem.dead, true, 'the next swing kills it at its doubled health');
    }
  }
});

test('current saves persist Golem maximum HP and legacy Golems keep their relative health', () => {
  const current = createGame();
  current.game.enterLevel('special'); suppressNewEnemySpawns(current.game.level);
  current.game.state.tools.sword = 4; current.game.state.mercurySword = true;
  const enemy = current.game.makeGolem(current.game.player.x + 32, current.game.player.y, true);
  enemy.hp = 41; current.game.golems.push(enemy);
  const saved = JSON.parse(current.game.createSaveText());
  assert.equal(saved.enemies.golems[0].maxHp, 230);
  // Changing the current sword after spawning must not recalculate a live Golem.
  saved.state.tools.sword = 1; saved.state.mercurySword = false;
  const restored = createGame({ autoStart: false }); restored.game.loadSaveText(JSON.stringify(saved));
  assert.equal(restored.game.golems[0].hp, 41);
  assert.equal(restored.game.golems[0].maxHp, 230);
  assert.equal(restored.game.golems[0].speed, 60);

  const legacy = structuredClone(saved);
  legacy.version = 2; delete legacy.state.elevatorUnlocked; delete legacy.enemies.golems[0].maxHp;
  // A genuine v2 Home has the original 19×13 layout, not the expanded v4 map.
  legacy.areas.home = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-elevator-v2.json'), 'utf8')).areas.home;
  const migrated = createGame({ autoStart: false }); migrated.game.loadSaveText(JSON.stringify(legacy));
  assert.equal(migrated.game.golems[0].hp, 82, 'migration doubles the remaining health');
  assert.equal(migrated.game.golems[0].maxHp, 180);
  assert.equal(migrated.game.golems[0].speed, 60);
  const genuineV1 = createGame({ autoStart: false });
  genuineV1.game.loadSaveText(fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-stage6-v1.json'), 'utf8'));
  assert.equal(genuineV1.game.golems[0].hp, 142);
  assert.equal(genuineV1.game.golems[0].maxHp, 230, 'base and saved T2 armour are doubled');
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
  const ids = ['home', 'stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'stage6', 'stage7', 'stage8', 'stage9', 'stage10', 'stage11', 'stage12', 'stage13'];
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
    game.buildStage3, game.buildStage4, game.buildStage5, game.buildStage6, game.buildStage7, game.buildStage8, game.buildStage9, game.buildStage10, game.buildStage11, game.buildStage12, game.buildStage13]) {
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

// Haunted Descent, gem polishing and authentic pre-expansion migrations.
test('Stage 8 is a winding, grave-lined route with its own stairs and requested title', () => {
  const { game, elements, step } = createGame();
  game.enterLevel('stage7'); suppressNewEnemySpawns(game.level);
  const spiral = game.level, exit = spiral.stairsDown, seam = spiral.secretTile;
  assert.deepEqual({ tx: exit.tx, ty: exit.ty }, { tx: 40, ty: 36 });
  assert.ok(reachableWalkableTiles(game, spiral).has(`${exit.tx},${exit.ty}`));
  assert.equal(spiral.downTarget, 'stage8');
  assert.equal(game.getTile(seam.tx, seam.ty), game.TITANIUM);
  moveToStairs(game, step, exit);
  assert.equal(game.level.id, 'stage8');
  assert.equal(elements['stage-name'].textContent, 'Haunted Descent');
  assert.equal(elements['area-kicker'].textContent, 'Stage 08');
  assert.equal(elements['area-subtitle'].textContent, 'ooOOOOooo!! spoooOOOOoooky ghosts!');
  assert.equal(game.level.upTarget, 'stage7');
  const area = game.level, reachable = reachableWalkableTiles(game, area);
  assert.ok(area.graves.length >= 12);
  assert.ok(reachable.has('61,42'), 'the winding path reaches its far end');
  assert.ok(reachable.size < area.w * area.h / 2, 'walls separate the winding turns');
  for (const grave of area.graves) {
    assert.equal(game.isSolid(grave.tx, grave.ty), false);
    assert.ok(reachable.has(`${grave.tx},${grave.ty}`), 'gravestones sit on reachable floor');
  }
  moveToStairs(game, step, area.stairsUp);
  assert.equal(game.level.id, 'stage7');
  assert.equal(Math.floor(game.player.x / 32), exit.tx, 'returning from Stage 8 uses the ordinary stair');
  assert.equal(game.getTile(seam.tx, seam.ty), game.TITANIUM);
});

test('the ordinary Stage 8 stair and the Titanium secret stair route independently in both directions', () => {
  const { game, step } = createGame();
  game.enterLevel('stage7'); suppressNewEnemySpawns(game.level);
  const area = game.level, seam = area.secretTile;
  game.setTile(seam.tx, seam.ty, game.STAIRS_DOWN);
  moveToStairs(game, step, seam);
  assert.equal(game.level.id, 'special');
  moveToStairs(game, step, game.level.stairsUp);
  assert.equal(game.level, area);
  assert.equal(Math.floor(game.player.x / 32), seam.tx, 'secret return lands beside the secret seam, not the new exit');
  assert.equal(game.getTile(seam.tx, seam.ty), game.TITANIUM, 'the seam reseals on re-entry');
  moveToStairs(game, step, area.stairsDown);
  assert.equal(game.level.id, 'stage8');
  moveToStairs(game, step, game.level.stairsUp);
  assert.equal(Math.floor(game.player.x / 32), area.stairsDown.tx);
});

test('Ruby can be mined with the mouse, collected, stored and reset on cave re-entry', () => {
  const { game, elements, step } = createGame();
  game.enterLevel('stage8'); suppressNewEnemySpawns(game.level);
  const ore = findReachableOre(game, game.RUBY);
  aimPickaxeAt(game, ore);
  game.state.tools.pickaxe = 4;
  const hits = game.pickaxeHits(game.TILES[game.RUBY]);
  for (let i = 0; i < hits; i++) {
    game.state.cooldown = 0;
    elements.game.dispatch('pointerdown', { pointerType: 'mouse', clientX: game.pointer.x, clientY: game.pointer.y });
  }
  assert.equal(game.getTile(ore.tx, ore.ty), game.FLOOR);
  assert.ok(game.pickups.some((p) => p.item === 'ruby'));
  step(28);
  assert.equal(game.countItem('ruby'), 1);
  assert.equal(game.depositToStorage('ruby', 1), 1);
  assert.equal(game.storage.ruby, 1);
  game.enterLevel('stage7'); game.enterLevel('stage8');
  assert.equal(game.getTile(ore.tx, ore.ty), game.RUBY);
  assert.equal(game.storage.ruby, 1);
});

test('Stage 8 naturally spawns only Ghosts and Grave Diggers near gravestones', () => {
  const { game, step } = createGame();
  for (const area of ['home', 'stage1', 'stage7', 'special']) {
    game.enterLevel(area);
    assert.equal(game.spawnGhostAwayFromPlayer(), null);
    assert.equal(game.spawnGraveDiggerAwayFromPlayer(), null);
  }
  game.enterLevel('stage8');
  game.level.ghostTimer = game.level.graveDiggerTimer = 0;
  game.state.invuln = 999;
  step(1);
  assert.equal(game.ghosts.length, 1);
  assert.equal(game.graveDiggers.length, 1);
  for (const creature of [...game.ghosts, ...game.graveDiggers]) {
    assert.ok(game.level.graves.some((g) => Math.hypot(g.x - creature.x, g.y - creature.y) < 2 * 32));
    assert.ok(Math.hypot(creature.x - game.player.x, creature.y - game.player.y) >= 6 * 32);
  }
  assert.equal(game.slimes.length + game.moles.length + game.spiders.length + game.golems.length + game.prospectors.length, 0);
  game.enterLevel('stage7');
  assert.equal(game.ghosts.length + game.graveDiggers.length, 0, 'enemies do not follow between areas');
});

test('Ghosts detect at four tiles and dash exactly three tiles through walls at double chase speed', () => {
  const { game, step } = createGame();
  game.enterLevel('stage8'); suppressNewEnemySpawns(game.level);
  for (let y = 8; y <= 12; y++) for (let x = 8; x <= 20; x++) game.setTile(x, y, game.FLOOR);
  game.setTile(12, 10, game.WALL);
  const ghost = game.makeGhost(10.5 * 32, 10.5 * 32);
  ghost.dashCooldown = 7; game.ghosts.push(ghost);
  game.player.x = ghost.x + 4.1 * 32; game.player.y = ghost.y;
  game.state.invuln = 999;
  step(1);
  assert.equal(ghost.chasing, false);
  game.player.x = ghost.x + 3 * 32; game.player.y = ghost.y; ghost.dashCooldown = 0;
  const startX = ghost.x, startY = ghost.y;
  step(1);
  assert.equal(ghost.chasing, true);
  assert.ok(Math.abs(ghost.x - startX - game.BALANCE.ghostChaseSpeed * 2 * 0.05) < 1e-8);
  assert.equal(ghost.dashCooldown, 7);
  while (ghost.dashRemaining > 0) step(1);
  assert.ok(Math.abs(ghost.x - startX - 3 * 32) < 1e-7, 'dash distance is exactly three tiles');
  assert.ok(Math.abs(ghost.y - startY) < 1e-7, 'dash follows a straight line');
  assert.equal(game.getTile(12, 10), game.WALL, 'the wall is neither blocking nor destroyed');
  assert.ok(ghost.dashCooldown > 6.5);
  for (let i = 0; i < 60; i++) {
    ghost.x = 10.5 * 32; ghost.y = 10.5 * 32;
    game.player.x = ghost.x + 3 * 32; game.player.y = ghost.y;
    step(1);
    assert.equal(ghost.dashRemaining, 0, 'no early dash during recharge');
  }
  assert.ok(ghost.dashCooldown > 3 && ghost.dashCooldown < 4);
  let newDash = false;
  for (let i = 0; i < 80 && !newDash; i++) {
    ghost.x = 10.5 * 32; ghost.y = 10.5 * 32;
    game.player.x = ghost.x + 3 * 32; game.player.y = ghost.y;
    step(1); newDash = ghost.dashRemaining > 0;
  }
  assert.ok(newDash, 'the dash becomes available again after seven seconds');
});

test('Ghosts prefer graves while wandering and ignore Mercury poison', () => {
  const { game, step, math } = createGame();
  game.enterLevel('stage8'); suppressNewEnemySpawns(game.level);
  const grave = game.level.graves[0];
  const ghost = game.makeGhost(grave.x + 5 * 32, grave.y);
  ghost.wanderTimer = 0; ghost.dashCooldown = 7;
  game.player.x = 6.5 * 32; game.player.y = 24.5 * 32;
  game.ghosts.push(ghost); math.random = () => 0.5;
  const nearest = () => Math.min(...game.level.graves.map((g) => Math.hypot(g.x - ghost.x, g.y - ghost.y)));
  const before = nearest(); step(1);
  assert.ok(nearest() < before, 'idle ghosts steer back toward a nearby grave');
  game.player.x = ghost.x - 26; game.player.y = ghost.y;
  aimSwordAt(game, ghost); game.state.tools.sword = 4; game.state.mercurySword = true;
  for (let hit = 1; hit <= 5; hit++) {
    game.state.cooldown = 0; game.swing();
    if (hit < 5) { assert.equal(ghost.dead, false); assert.equal(ghost.hp, 175 - hit * 35); }
  }
  assert.equal(ghost.dead, true);
  assert.equal(game.state.ghostsSlain, 1);
});

test('Grave Diggers flee on detection, become hostile when hit, and take six Titanium hits', () => {
  const { game, step } = createGame();
  game.enterLevel('stage8'); suppressNewEnemySpawns(game.level);
  for (let y = 8; y <= 12; y++) for (let x = 8; x <= 20; x++) game.setTile(x, y, game.FLOOR);
  const digger = game.makeGraveDigger(12.5 * 32, 10.5 * 32, 0);
  digger.digCooldown = 15; game.graveDiggers.push(digger);
  game.player.x = digger.x + 3 * 32; game.player.y = digger.y;
  const x = digger.x; step(1);
  assert.equal(digger.fleeing, true); assert.equal(digger.provoked, false);
  assert.ok(digger.x < x, 'an unprovoked digger runs away');
  game.player.x = digger.x + 25; game.player.y = digger.y;
  aimSwordAt(game, digger); game.state.tools.sword = 4; game.state.mercurySword = false;
  for (let hit = 1; hit <= 6; hit++) {
    game.state.cooldown = 0; game.swing();
    assert.equal(digger.provoked, true);
    if (hit < 6) { assert.equal(digger.dead, false); assert.equal(digger.hp, 210 - hit * 35); }
  }
  assert.equal(digger.dead, true);
  assert.equal(game.state.graveDiggersSlain, 1);
});

test('a Grave Digger shovel spin visibly winds up and hurts every adjacent tile except itself', () => {
  const { game, step } = createGame();
  game.enterLevel('stage8'); suppressNewEnemySpawns(game.level);
  for (let y = 8; y <= 13; y++) for (let x = 17; x <= 24; x++) game.setTile(x, y, game.FLOOR);
  const digger = game.makeGraveDigger(20.5 * 32, 10.5 * 32, 0);
  const bystander = game.makeGraveDigger(20.5 * 32, 11.5 * 32, 0);
  const ghost = game.makeGhost(19.5 * 32, 10.5 * 32);
  const outside = game.makeGhost(22.5 * 32, 10.5 * 32);
  bystander.speed = 0; bystander.digCooldown = 15;
  ghost.speed = outside.speed = 0; ghost.dashCooldown = outside.dashCooldown = 7;
  game.graveDiggers.push(digger);
  game.player.x = 21.5 * 32; game.player.y = digger.y;
  aimSwordAt(game, digger); game.state.tools.sword = 4; game.state.cooldown = 0; game.swing();
  assert.equal(digger.hp, 175); assert.equal(digger.provoked, true);
  game.graveDiggers.push(bystander); game.ghosts.push(ghost, outside);
  step(1);
  assert.ok(digger.spinWindup > 0, 'the attack has a warning period');
  assert.equal(game.state.hp, 100); assert.equal(ghost.hp, 175);
  step(14);
  assert.equal(game.state.hp, 40);
  assert.equal(ghost.hp, 115, 'a ghost in the adjacent tile is hit');
  assert.equal(bystander.hp, 150, 'another Grave Digger can be hit');
  assert.equal(outside.hp, 175, 'a creature two tiles away is outside the spin');
  assert.equal(digger.hp, 175, 'the attacker never damages itself');
  assert.equal(bystander.provoked, false, 'a shovel hit is not a player attack');
  assert.ok(digger.spinFlash > 0);
  game.player.x = digger.x + 26; game.player.y = digger.y; game.state.invuln = 0;
  step(1);
  assert.equal(game.state.hp, 24, 'the ordinary shovel attack is weaker than the spin');
});

test('an actual grave dig summons exactly three Ghosts and respects the overall population cap', () => {
  const { game, step } = createGame();
  game.enterLevel('stage8'); suppressNewEnemySpawns(game.level);
  const index = game.level.graves.length - 1, grave = game.level.graves[index];
  const digger = game.makeGraveDigger(grave.x, grave.y, index);
  digger.speed = 0; digger.digCooldown = 0; game.graveDiggers.push(digger);
  for (let i = 0; i < 15; i++) {
    const g = game.makeGhost(grave.x + 2 * 32, grave.y + i);
    g.speed = 0; g.dashCooldown = 7; game.ghosts.push(g);
  }
  game.player.x = game.level.spawn.x; game.player.y = game.level.spawn.y;
  step(1);
  assert.ok(digger.digWindup > 0); assert.equal(game.ghosts.length, 15);
  step(24);
  assert.equal(game.ghosts.length, 18, 'a completed dig always produces three');
  assert.equal(digger.digWindup, 0); assert.equal(digger.digCooldown, 15);
  digger.digCooldown = 0;
  step(30);
  assert.equal(digger.digWindup, 0, 'there is no partial dig when three ghosts cannot fit');
  assert.equal(game.ghosts.length, 18);
});

test('all nine raw gems polish and sell through the actual station buttons', () => {
  const { game, elements } = createGame();
  const kinds = ['cobalt', 'quartz', 'iridium', 'ruby', 'calcite', 'sapphire', 'blackAmethyst', 'amethyst', 'diamond'];
  const polished = ['polishedCobalt', 'polishedQuartz', 'polishedIridium', 'polishedRuby', 'polishedCalcite', 'polishedSapphire', 'polishedBlackAmethyst', 'polishedAmethyst', 'polishedDiamond'];
  assert.equal(game.level.w, 27); assert.equal(game.level.h, 17);
  const station = game.level.stations.find((s) => s.kind === 'polisher');
  assert.ok(station);
  kinds.forEach((kind) => game.addItem(kind, 1));
  elements.game.dispatch('pointerdown', { pointerType: 'touch',
    clientX: station.x - game.camera.x + 640, clientY: station.y - game.camera.y + 400 });
  assert.equal(game.state.openStation, 'polisher');
  assert.equal(elements['view-polisher'].classList.contains('is-hidden'), false);
  assert.equal(elements['polisher-gems'].children.length, 9);
  for (let i = 0; i < kinds.length; i++) {
    const button = elements['polisher-gems'].children[i].children[2];
    assert.equal(button.disabled, false); button.click();
    assert.equal(game.countItem(kinds[i]), 0); assert.equal(game.countItem(polished[i]), 1);
    assert.equal(button.disabled, true);
  }
  game.closeStation(); game.openStation('trader');
  assert.equal(elements['trader-gems'].children.length, 9);
  for (let i = 0; i < kinds.length; i++) {
    const button = elements['trader-gems'].children[i].children[2];
    assert.equal(button.disabled, false); button.click();
    assert.equal(game.countItem(polished[i]), 0);
  }
  assert.equal(game.countItem('goldCoin'), 10);
  assert.equal(game.countItem('aluminumCoin'), 1);
  assert.equal(game.traderUnlocked.gold, false, 'selling gems does not bypass the coin-press unlock');
});

test('gem polishing and sales are atomic in full bags and survive storage and death', () => {
  const first = createGame(), game = first.game;
  game.addItem('stone', 891); game.addItem('ruby', 2); game.openStation('polisher');
  assert.equal(game.polishGem('ruby'), false);
  assert.equal(game.countItem('ruby'), 2); assert.equal(game.countItem('polishedRuby'), 0);
  game.removeItem('ruby', 1);
  assert.equal(game.polishGem('ruby'), true, 'spending the last raw gem frees a slot');
  assert.equal(game.countItem('polishedRuby'), 1);
  game.closeStation(); game.openStation('trader');
  assert.equal(game.sellPolishedGem('ruby'), true, 'selling the last polished gem frees a slot');
  assert.equal(game.countItem('goldCoin'), 1);
  const second = createGame(), g = second.game;
  g.addItem('stone', 891); g.addItem('polishedQuartz', 2); g.openStation('trader');
  assert.equal(g.sellPolishedGem('quartz'), false);
  assert.equal(g.countItem('polishedQuartz'), 2); assert.equal(g.countItem('goldCoin'), 0);
  g.removeItem('polishedQuartz', 1);
  assert.equal(g.sellPolishedGem('quartz'), true);
  g.closeStation();
  g.storage.polishedRuby = 7; g.removeItem('stone', 99); g.addItem('polishedRuby', 4);
  g.respawnAtBase();
  assert.equal(g.storage.polishedRuby, 7);
  assert.equal(g.countItem('polishedRuby'), 2, 'the usual half-bag death penalty applies');
  assert.equal(g.polishGem('coal'), false); assert.equal(g.sellPolishedGem('coal'), false);
});

test('genuine version-3 Stage 7 saves gain the new exit without losing the revealed seam or progress', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-haunted-v3.json'), 'utf8');
  const old = JSON.parse(text), slot = createMemoryStorage(); slot.setItem('cuddly-train.mining-simulator.save.v1', text);
  const loaded = createGame({ storage: slot, autoStart: false });
  assert.equal(loaded.elements['continue-save'].disabled, false);
  loaded.elements['continue-save'].click();
  const { game, elements, step } = loaded;
  assert.equal(game.level.id, 'stage7'); assert.equal(game.state.mode, 'paused');
  assert.equal(game.state.elevatorUnlocked, true); assert.equal(game.state.mercurySword, true);
  assert.equal(game.state.tools.sword, 4);
  assert.equal(game.golems[0].hp, old.enemies.golems[0].hp * 2);
  assert.equal(game.getTile(37, 36), game.STAIRS_DOWN);
  assert.equal(game.getTile(40, 36), game.STAIRS_DOWN);
  const now = JSON.parse(game.createSaveText());
  assert.equal(now.version, 9);
  for (const field of ['tiles', 'originalTiles']) {
    const expected = old.areas.stage7[field].slice(); expected[36 * 72 + 40] = game.STAIRS_DOWN;
    assert.deepEqual(now.areas.stage7[field], expected, `only the new stair changes ${field}`);
  }
  assert.deepEqual(now.areas.stage7.damage, old.areas.stage7.damage);
  assert.deepEqual(now.inventory, old.inventory);
  assert.equal(slot.getItem(game.saveKey), text, 'migration never overwrites the original browser save');
  elements.resume.click(); moveToStairs(game, step, game.level.secretTile);
  assert.equal(game.level.id, 'special');
  moveToStairs(game, step, game.level.stairsUp);
  assert.equal(Math.floor(game.player.x / 32), 37);
  moveToStairs(game, step, game.level.stairsDown);
  assert.equal(game.level.id, 'stage8');
});

test('genuine old Home saves expand without moving players or losing ground pickups', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-haunted-home-v3.json'), 'utf8');
  const old = JSON.parse(text), loaded = createGame({ autoStart: false });
  loaded.game.loadSaveText(text);
  const { game, elements, step } = loaded;
  assert.equal(game.level.id, 'home'); assert.equal(game.level.w, 27); assert.equal(game.level.h, 17);
  assert.equal(game.player.x, old.player.x); assert.equal(game.player.y, old.player.y);
  assert.equal(game.isSolid(16, 10), false);
  assert.equal(game.isSolid(17, 10), false, 'the old east wall opens into the expansion');
  assert.equal(game.isSolid(16, 11), false, 'the old south wall opens into the expansion');
  assert.equal(game.getTile(9, 9), game.STAIRS_DOWN);
  assert.deepEqual(JSON.parse(JSON.stringify(game.pickups)), old.areas.home.pickups);
  const reachable = reachableWalkableTiles(game, game.level);
  for (const station of game.level.stations) {
    assert.ok(reachable.has(`${Math.floor(station.x / 32)},${Math.floor(station.y / 32)}`), `${station.kind} remains reachable`);
  }
  assert.equal(game.countItem('cobalt'), old.inventory.find((c) => c && c.item === 'cobalt').count);
  const drop = game.pickups.find((p) => p.item === 'iron');
  assert.ok(drop); elements.resume.click();
  game.player.x = drop.x; game.player.y = drop.y; step(30);
  assert.ok(!game.pickups.includes(drop), 'the original ground pickup remains collectible');
});

test('current saves round-trip active haunted enemy attacks, gems, timers and elevator unlock', () => {
  const first = createGame(), { game } = first;
  game.enterLevel('stage7');
  let lift = game.level.elevators[0]; game.player.x = lift.x; game.player.y = lift.y;
  assert.equal(game.useElevator(lift), true); assert.equal(game.activateElevator(), true); game.closeStation();
  game.enterLevel('stage8'); suppressNewEnemySpawns(game.level);
  const ghost = game.makeGhost(12.5 * 32, 10.5 * 32);
  ghost.hp = 105; ghost.dashRemaining = 48; ghost.dashX = 1; ghost.dashY = 0; ghost.dashCooldown = 6.5;
  const grave = game.level.graves[1], digger = game.makeGraveDigger(grave.x, grave.y, 1);
  digger.hp = 140; digger.provoked = true; digger.spinWindup = 0.35; digger.spinCooldown = 7.65;
  game.ghosts.push(ghost); game.graveDiggers.push(digger);
  game.addItem('ruby', 4); game.addItem('polishedRuby', 2); game.storage.polishedQuartz = 8;
  game.state.ghostsSlain = 3; game.state.graveDiggersSlain = 2;
  const expected = comparableSave(game), saved = JSON.stringify({ ...expected, savedAt: new Date().toISOString() });
  const loaded = createGame({ autoStart: false }); loaded.game.loadSaveText(saved);
  assert.deepEqual(comparableSave(loaded.game), expected);
  assert.equal(loaded.game.ghosts[0].dashRemaining, 48);
  assert.equal(loaded.game.graveDiggers[0].spinWindup, 0.35);
  assert.equal(loaded.game.graveDiggers[0].provoked, true);
  assert.equal(loaded.game.countItem('ruby'), 4); assert.equal(loaded.game.countItem('polishedRuby'), 2);
  assert.equal(loaded.game.storage.polishedQuartz, 8);
  assert.equal(loaded.game.state.elevatorUnlocked, true);
  loaded.elements.resume.click();
  lift = loaded.game.level.elevators[0]; loaded.game.player.x = lift.x; loaded.game.player.y = lift.y;
  assert.equal(loaded.game.useElevator(lift), true);
  assert.equal(loaded.game.travelByElevator('stage7'), true);
  lift = loaded.game.level.elevators[0]; loaded.game.player.x = lift.x; loaded.game.player.y = lift.y;
  assert.equal(loaded.game.useElevator(lift), true);
  assert.equal(loaded.game.travelByElevator('stage8'), true, 'visited Stage 8 remains a lift destination');
});

test('malformed haunted saves fail atomically instead of replacing a good run', () => {
  const { game } = createGame(); game.enterLevel('stage8'); suppressNewEnemySpawns(game.level);
  const grave = game.level.graves[0];
  game.ghosts.push(game.makeGhost(grave.x, grave.y)); game.graveDiggers.push(game.makeGraveDigger(grave.x, grave.y, 0));
  game.addItem('ruby', 3);
  const before = comparableSave(game), cases = [];
  const excessiveDash = structuredClone(before); excessiveDash.enemies.ghosts[0].dashRemaining = 97; cases.push(excessiveDash);
  const invalidVector = structuredClone(before); invalidVector.enemies.ghosts[0].dashRemaining = 10; cases.push(invalidVector);
  const invalidHP = structuredClone(before); invalidHP.enemies.ghosts[0].hp = 176; cases.push(invalidHP);
  const invalidGrave = structuredClone(before); invalidGrave.enemies.graveDiggers[0].graveIndex = 999; cases.push(invalidGrave);
  const invalidFlag = structuredClone(before); invalidFlag.enemies.graveDiggers[0].provoked = 'yes'; cases.push(invalidFlag);
  const invalidSpin = structuredClone(before); invalidSpin.enemies.graveDiggers[0].spinWindup = 2; cases.push(invalidSpin);
  for (const invalid of cases) {
    invalid.savedAt = new Date().toISOString();
    assert.throws(() => game.loadSaveText(JSON.stringify(invalid)));
    assert.deepEqual(comparableSave(game), before);
  }
});

test('simultaneous grave digs reserve three Ghosts each without exceeding the cap', () => {
  const { game, step } = createGame();
  game.enterLevel('stage8'); suppressNewEnemySpawns(game.level);
  const indices = [game.level.graves.length - 1, game.level.graves.length - 2];
  for (const index of indices) {
    const grave = game.level.graves[index], digger = game.makeGraveDigger(grave.x, grave.y, index);
    digger.speed = 0; digger.digCooldown = 0; game.graveDiggers.push(digger);
  }
  const grave = game.level.graves[indices[0]];
  for (let i = 0; i < 6; i++) {
    const ghost = game.makeGhost(grave.x + 40, grave.y + i);
    ghost.speed = 0; ghost.dashCooldown = 7; game.ghosts.push(ghost);
  }
  step(1);
  assert.ok(game.graveDiggers.every((d) => d.digWindup > 0));
  step(24);
  assert.equal(game.ghosts.length, 12, 'both complete digs spawn exactly three apiece');
  assert.ok(game.graveDiggers.every((d) => d.digCooldown === 15));
});

test('a saved Ghost dash and grave dig finish normally after loading', () => {
  const source = createGame(), { game } = source;
  game.enterLevel('stage8'); suppressNewEnemySpawns(game.level);
  const ghost = game.makeGhost(16.5 * 32, 6.5 * 32);
  ghost.dashX = 1; ghost.dashY = 0; ghost.dashRemaining = 48; ghost.dashCooldown = 6;
  game.ghosts.push(ghost);
  const index = game.level.graves.length - 1, grave = game.level.graves[index];
  const digger = game.makeGraveDigger(grave.x, grave.y, index);
  digger.digCooldown = 0; digger.digWindup = 0.6; game.graveDiggers.push(digger);
  const text = game.createSaveText(), restored = createGame({ autoStart: false });
  restored.game.loadSaveText(text); restored.elements.resume.click();
  const ghost2 = restored.game.ghosts[0], digger2 = restored.game.graveDiggers[0], startX = ghost2.x;
  let frames = 0;
  while (ghost2.dashRemaining > 0 && frames++ < 20) restored.step(1);
  assert.equal(ghost2.dashRemaining, 0);
  assert.ok(Math.abs(ghost2.x - startX - 48) < 1e-7, 'the saved remaining dash distance is retained');
  while (digger2.digWindup > 0 && frames++ < 40) restored.step(1);
  assert.equal(digger2.digWindup, 0);
  assert.equal(restored.game.ghosts.length, 4, 'the saved dig completes with all three Ghosts');
});

// Pitch-Black Depths, ranged infected skeletons, natural recovery and v5 saves.
test('Stage 8 stairs lead to Pitch-Black Depths and back, with the requested banner and visited lift', () => {
  const { game, elements, step } = createGame();
  game.enterLevel('stage7');
  let lift = game.level.elevators[0]; game.player.x = lift.x; game.player.y = lift.y;
  assert.equal(game.useElevator(lift), true); assert.equal(game.activateElevator(), true);
  assert.equal(elements['elevator-floors'].children[9].disabled, true, 'Stage 9 is locked until visited');
  game.closeStation(); game.enterLevel('stage8'); suppressNewEnemySpawns(game.level);
  const haunted = game.level, exit = haunted.stairsDown;
  assert.deepEqual({ tx: exit.tx, ty: exit.ty }, { tx: 61, ty: 42 });
  assert.equal(haunted.downTarget, 'stage9');
  assert.ok(reachableWalkableTiles(game, haunted).has('61,42'));
  moveToStairs(game, step, exit);
  assert.equal(game.level.id, 'stage9');
  assert.equal(game.level.upTarget, 'stage8');
  assert.equal(elements['stage-name'].textContent, 'Pitch-Black Depths');
  assert.equal(elements['area-kicker'].textContent, 'Stage 09');
  assert.equal(elements['area-subtitle'].textContent, 'Its eerie in the darkness of this cave');
  assert.equal(game.level.elevators.length, 2);
  const depth = game.level;
  suppressNewEnemySpawns(depth);
  moveToStairs(game, step, depth.stairsUp);
  assert.equal(game.level, haunted);
  assert.equal(Math.floor(game.player.x / 32), exit.tx);
  assert.equal(Math.floor(game.player.y / 32), exit.ty - 1);
  lift = game.level.elevators[0]; game.player.x = lift.x; game.player.y = lift.y;
  assert.equal(game.useElevator(lift), true);
  assert.equal(elements['elevator-floors'].children[9].disabled, false, 'visited Stage 9 is a destination');
  elements['elevator-floors'].children[9].click();
  assert.equal(game.level, depth);
  assert.equal(game.state.mode, 'playing');
});

test('randomized Depths have reachable Ruby, Sapphire and Darkstone, no Stone, and walkable graves', () => {
  const { game, math } = createGame();
  let seed = 734129;
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let run = 0; run < 16; run++) {
    game.level.id === 'stage9' && game.enterLevel('home');
    game.levels.stage9 = null; game.enterLevel('stage9');
    const area = game.level, reachable = reachableWalkableTiles(game, area);
    assert.equal(area.tiles.includes(game.STONE), false);
    for (const tile of [game.DARKSTONE, game.RUBY, game.SAPPHIRE]) {
      assert.ok(area.tiles.includes(tile));
      assert.doesNotThrow(() => findReachableOre(game, tile), `reachable ore ${tile}, run ${run}`);
    }
    assert.ok(area.graves.length >= 15);
    assert.ok(reachable.has('62,44'), 'the far end of the cave remains reachable');
    for (const grave of area.graves) assert.ok(reachable.has(`${grave.tx},${grave.ty}`));
    assert.ok(reachable.has(`${area.elevators[0].tx},${area.elevators[0].ty}`));
  }
});

test('Sapphire and Darkstone mine with mouse and Space, collect, store and reset normally', () => {
  for (const [tileName, item] of [['SAPPHIRE', 'sapphire'], ['DARKSTONE', 'darkstone']]) {
    const { game, elements, listeners, step } = createGame();
    game.enterLevel('stage9'); suppressNewEnemySpawns(game.level);
    const area = game.level, ore = findReachableOre(game, game[tileName]);
    aimPickaxeAt(game, ore); game.state.tools.pickaxe = 4;
    const hits = game.pickaxeHits(game.TILES[game[tileName]]);
    for (let i = 0; i < hits; i++) {
      game.state.cooldown = 0;
      if (i % 2 === 0) elements.game.dispatch('pointerdown', { pointerType: 'mouse', clientX: game.pointer.x, clientY: game.pointer.y });
      else listeners.keydown[0]({ code: 'Space', target: { tagName: 'BODY' }, preventDefault: noop });
    }
    assert.equal(game.getTile(ore.tx, ore.ty), game.FLOOR);
    const pickup = game.pickups.find((p) => p.item === item);
    assert.ok(pickup, `${item} should drop`);
    assert.ok(item === 'sapphire' ? pickup.count === 1 : pickup.count >= 1 && pickup.count <= 2);
    step(30);
    const collected = game.countItem(item); assert.ok(collected >= 1);
    assert.equal(game.depositToStorage(item, collected), collected);
    game.enterLevel('stage8'); game.enterLevel('stage9');
    assert.equal(game.level, area); assert.equal(game.getTile(ore.tx, ore.ty), game[tileName]);
    assert.equal(game.storage[item], collected);
  }
});

test('Sapphire polishing and sale remain atomic with full bags and obey storage/death rules', () => {
  const { game } = createGame();
  game.addItem('stone', 891); game.addItem('sapphire', 2);
  assert.equal(game.polishGem('sapphire'), false, 'a full bag cannot consume a gem without room for its result');
  assert.equal(game.countItem('sapphire'), 2); assert.equal(game.countItem('polishedSapphire'), 0);
  game.removeItem('sapphire', 1);
  assert.equal(game.polishGem('sapphire'), true, 'the emptied input slot can hold the result');
  assert.equal(game.countItem('polishedSapphire'), 1);
  assert.equal(game.sellPolishedGem('sapphire'), true);
  assert.equal(game.countItem('goldCoin'), 1);
  game.removeItem('stone', 198); game.addItem('sapphire', 6); game.addItem('darkstone', 8);
  game.storage.polishedSapphire = 4; game.respawnAtBase();
  assert.equal(game.countItem('sapphire'), 3); assert.equal(game.countItem('darkstone'), 4);
  assert.equal(game.storage.polishedSapphire, 4);
});

test('Stage 9 naturally spawns only Ghosts, Grave Diggers and disguised Infected Skeletons', () => {
  const { game, step } = createGame();
  for (const id of ['home', 'stage7', 'stage8', 'special']) {
    game.enterLevel(id); assert.equal(game.spawnInfectedSkeletonAwayFromPlayer(), null);
  }
  game.enterLevel('stage9');
  game.level.ghostTimer = game.level.graveDiggerTimer = game.level.infectedSkeletonTimer = 0;
  step(1);
  assert.equal(game.ghosts.length, 1); assert.equal(game.graveDiggers.length, 1);
  assert.equal(game.infectedSkeletons.length, 1);
  assert.equal(game.slimes.length + game.moles.length + game.spiders.length + game.golems.length + game.prospectors.length, 0);
  const skeleton = game.infectedSkeletons[0], grave = game.level.graves[skeleton.graveIndex];
  assert.equal(skeleton.hidden, true); assert.equal(skeleton.x, grave.x); assert.equal(skeleton.y, grave.y);
  assert.ok(Math.hypot(skeleton.x - game.player.x, skeleton.y - game.player.y) >= 7 * 32);
  assert.equal(game.boneProjectiles.length, 0);
  game.enterLevel('stage8');
  assert.equal(game.infectedSkeletons.length, 0, 'enemies do not follow to another area');
});

function openDepthArena(game) {
  game.enterLevel('stage9'); suppressNewEnemySpawns(game.level);
  for (let y = 4; y <= 18; y++) for (let x = 4; x <= 35; x++) {
    if (![game.STAIRS_UP, game.STAIRS_DOWN].includes(game.getTile(x, y))) game.setTile(x, y, game.FLOOR);
  }
  game.state.transitionLock = 999;
}

test('an infected grave stays hidden outside four tiles, emerges on sight, then throws a bone', () => {
  const { game, step } = createGame(); openDepthArena(game);
  const grave = game.level.graves[1], skeleton = game.makeInfectedSkeleton(grave.x, grave.y, 1);
  skeleton.speed = 0; game.infectedSkeletons.push(skeleton);
  game.player.x = grave.x - 4 * 32 - 1; game.player.y = grave.y;
  step(10); assert.equal(skeleton.hidden, true); assert.equal(game.boneProjectiles.length, 0);
  game.player.x = grave.x - 4 * 32;
  step(1); assert.equal(skeleton.hidden, false); assert.ok(skeleton.emergeTimer > 0);
  step(10); assert.equal(game.boneProjectiles.length, 0, 'the emerging animation is a warning');
  let frames = 0;
  while (!game.boneProjectiles.length && frames++ < 25) step(1);
  assert.equal(game.boneProjectiles.length, 1);
  assert.ok(Math.abs(Math.hypot(game.boneProjectiles[0].vx, game.boneProjectiles[0].vy) - game.BALANCE.boneSpeed) < 1e-6);
  assert.ok(skeleton.throwCooldown > 2);
});

test('an emerged Infected Skeleton backs away from a nearby player and respects its sight range', () => {
  const { game, step } = createGame(); openDepthArena(game);
  const grave = game.level.graves[1], skeleton = game.makeInfectedSkeleton(grave.x, grave.y, 1);
  skeleton.hidden = false; skeleton.throwCooldown = 2.4; game.infectedSkeletons.push(skeleton);
  game.player.x = grave.x - 48; game.player.y = grave.y;
  const before = Math.hypot(skeleton.x - game.player.x, skeleton.y - game.player.y);
  step(10);
  assert.ok(Math.hypot(skeleton.x - game.player.x, skeleton.y - game.player.y) > before + 20, 'keeps its distance');
  game.boneProjectiles.length = 0; skeleton.throwCooldown = 0;
  game.player.x = skeleton.x - 4 * 32 - 20;
  step(20);
  assert.equal(game.boneProjectiles.length, 0, 'no attack beyond the four-tile sight range');
});

test('six unenhanced T4 sword swings defeat an Infected Skeleton, with its own death count', () => {
  const { game, step, elements } = createGame(); openDepthArena(game);
  const grave = game.level.graves[1], skeleton = game.makeInfectedSkeleton(grave.x, grave.y, 1);
  game.infectedSkeletons.push(skeleton);
  game.player.x = skeleton.x - 48; game.player.y = skeleton.y;
  aimSwordAt(game, skeleton); game.state.tools.sword = 4; game.state.mercurySword = false;
  for (let i = 1; i <= 6; i++) {
    game.state.cooldown = 0; game.swing();
    assert.equal(skeleton.hp, 210 - 35 * i);
    assert.equal(skeleton.dead, i === 6);
  }
  assert.equal(skeleton.hidden, false, 'attacking the disguise makes it emerge');
  assert.equal(game.state.infectedSkeletonsSlain, 1);
  game.state.hp = 10; game.state.invuln = 0;
  game.boneProjectiles.push({ x: game.player.x - 20, y: game.player.y, vx: 190, vy: 0, age: 0 });
  step(1);
  assert.equal(game.state.mode, 'dead');
  assert.equal(elements['over-infected-skeletons'].textContent, '1');
  assert.match(elements['over-line'].textContent, /1 cave creature/);
  game.respawnAtBase();
  assert.equal(game.level.id, 'home'); assert.equal(game.state.hp, 100);
});

test('bone projectiles hurt the player, stop at walls and do not cross floor transitions', () => {
  const { game, step } = createGame(); openDepthArena(game);
  game.player.x = 15.5 * 32; game.player.y = 10.5 * 32;
  game.setTile(14, 10, game.WALL);
  game.boneProjectiles.push({ x: 13.5 * 32, y: game.player.y, vx: 190, vy: 0, age: 0 });
  step(20); assert.equal(game.state.hp, 100); assert.equal(game.boneProjectiles.length, 0, 'a wall absorbs the bone');
  game.setTile(14, 10, game.FLOOR);
  game.boneProjectiles.push({ x: game.player.x - 20, y: game.player.y, vx: 190, vy: 0, age: 0 });
  step(1); assert.equal(game.state.hp, 85); assert.equal(game.boneProjectiles.length, 0);
  assert.equal(game.state.healDelay, 4);
  game.boneProjectiles.push({ x: game.player.x + 60, y: game.player.y, vx: -190, vy: 0, age: 0 });
  const depth = game.level; game.enterLevel('stage8');
  assert.equal(depth.boneProjectiles.length, 0);
});

test('Ghost contact deals 10 damage on both haunted floors', () => {
  for (const id of ['stage8', 'stage9']) {
    const { game, step } = createGame(); game.enterLevel(id); suppressNewEnemySpawns(game.level);
    const ghost = game.makeGhost(game.player.x, game.player.y);
    ghost.speed = 0; ghost.dashCooldown = 7; game.ghosts.push(ghost);
    step(1);
    assert.equal(ghost.dmg, 10); assert.equal(game.state.hp, 90, `${id} Ghost damage`);
  }
});

test('natural healing starts after four safe seconds, ticks every 0.2 seconds and caps at max HP', () => {
  const { game, step } = createGame(); game.enterLevel('stage8'); suppressNewEnemySpawns(game.level);
  const ghost = game.makeGhost(game.player.x, game.player.y);
  ghost.speed = 0; ghost.dashCooldown = 7; game.ghosts.push(ghost);
  step(1); assert.equal(game.state.hp, 90); assert.equal(game.state.healDelay, 4);
  ghost.dead = true;
  step(79); assert.equal(game.state.hp, 90); assert.ok(game.state.healDelay > 0);
  step(1); assert.equal(game.state.hp, 90); assert.equal(game.state.healDelay, 0);
  step(3); assert.equal(game.state.hp, 90);
  step(1); assert.equal(game.state.hp, 91);
  step(16); assert.equal(game.state.hp, 95, 'five HP per safe second');
  step(20); assert.equal(game.state.hp, 100);
  step(20); assert.equal(game.state.hp, 100); assert.equal(game.state.healProgress, 0, 'no healing is banked at full HP');
});

test('only actual damage restarts healing; invulnerable hits do not, and pauses freeze recovery', () => {
  const { game, step, elements } = createGame(); openDepthArena(game);
  game.player.x = 15.5 * 32; game.player.y = 10.5 * 32;
  game.boneProjectiles.push({ x: game.player.x - 20, y: game.player.y, vx: 190, vy: 0, age: 0 });
  step(1); assert.equal(game.state.hp, 85); assert.equal(game.state.healDelay, 4);
  game.boneProjectiles.push({ x: game.player.x - 20, y: game.player.y, vx: 190, vy: 0, age: 0 });
  step(1); assert.equal(game.state.hp, 85); assert.ok(Math.abs(game.state.healDelay - 3.95) < 1e-8);
  step(20);
  const beforePause = game.state.healDelay;
  elements['pause-btn'].click(); step(60);
  assert.equal(game.state.healDelay, beforePause); assert.equal(game.state.hp, 85);
  elements.resume.click();
  game.state.invuln = 0;
  game.boneProjectiles.push({ x: game.player.x - 20, y: game.player.y, vx: 190, vy: 0, age: 0 });
  step(1); assert.equal(game.state.hp, 70); assert.equal(game.state.healDelay, 4);
  step(80); assert.equal(game.state.hp, 70);
  step(4); assert.equal(game.state.hp, 71);
});

test('current saves round-trip active skeletons, bones, healing, loot and timers', () => {
  const { game } = createGame(); game.enterLevel('stage7');
  let lift = game.level.elevators[0]; game.player.x = lift.x; game.player.y = lift.y;
  assert.equal(game.useElevator(lift), true); assert.equal(game.activateElevator(), true); game.closeStation();
  game.enterLevel('stage9'); suppressNewEnemySpawns(game.level);
  const g0 = game.level.graves[0], g1 = game.level.graves[1];
  const hidden = game.makeInfectedSkeleton(g0.x, g0.y, 0);
  const active = game.makeInfectedSkeleton(g1.x, g1.y, 1);
  active.hidden = false; active.emergeTimer = 0.35; active.throwCooldown = 1.5;
  active.strafeTimer = 1.75; active.strafeSign = -1; active.hp = 140;
  game.infectedSkeletons.push(hidden, active);
  game.boneProjectiles.push({ x: g1.x, y: g1.y, vx: 190, vy: 0, age: 0.3 });
  game.addItem('sapphire', 4); game.addItem('darkstone', 8); game.addItem('polishedSapphire', 2);
  game.storage.polishedSapphire = 7; game.state.hp = 63; game.state.healDelay = 2.35;
  game.state.infectedSkeletonsSlain = 5; game.level.infectedSkeletonTimer = 4.2;
  const expected = comparableSave(game);
  assert.equal(expected.version, 9);
  const restored = createGame({ autoStart: false });
  restored.game.loadSaveText(JSON.stringify({ ...expected, savedAt: new Date().toISOString() }));
  assert.deepEqual(comparableSave(restored.game), expected);
  assert.equal(restored.game.infectedSkeletons[0].hidden, true);
  assert.equal(restored.game.infectedSkeletons[1].emergeTimer, 0.35);
  assert.equal(restored.game.boneProjectiles[0].age, 0.3);
  assert.equal(restored.game.state.healDelay, 2.35);
  assert.equal(restored.game.state.infectedSkeletonsSlain, 5);
  restored.elements.resume.click();
  lift = restored.game.level.elevators[0]; restored.game.player.x = lift.x; restored.game.player.y = lift.y;
  assert.equal(restored.game.useElevator(lift), true);
  assert.equal(restored.game.travelByElevator('stage7'), true);
  lift = restored.game.level.elevators[0]; restored.game.player.x = lift.x; restored.game.player.y = lift.y;
  assert.equal(restored.game.useElevator(lift), true);
  assert.equal(restored.game.travelByElevator('stage9'), true);
});

test('saved partial healing ticks resume rather than restarting or granting an early HP', () => {
  const { game } = createGame(); game.state.hp = 60; game.state.healDelay = 0; game.state.healProgress = 0.15;
  const text = game.createSaveText(), restored = createGame({ autoStart: false });
  restored.game.loadSaveText(text); assert.equal(restored.game.state.healProgress, 0.15);
  restored.elements.resume.click(); restored.step(1); // first frame after loading establishes time
  assert.equal(restored.game.state.hp, 60);
  restored.step(1); assert.equal(restored.game.state.hp, 61);
});

test('a genuine v4 Haunted Descent save gains both Stage 9 stairs without losing progress', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-depths-v4.json'), 'utf8');
  const old = JSON.parse(text), slot = createMemoryStorage(); slot.setItem('cuddly-train.mining-simulator.save.v1', text);
  const loaded = createGame({ storage: slot, autoStart: false });
  assert.equal(loaded.elements['continue-save'].disabled, false);
  loaded.elements['continue-save'].click();
  const { game, elements, step } = loaded;
  assert.equal(game.state.mode, 'paused'); assert.equal(game.level.id, 'stage8');
  assert.equal(game.state.hp, 67); assert.equal(game.state.healDelay, 4); assert.equal(game.state.healProgress, 0);
  assert.equal(game.state.elevatorUnlocked, true); assert.equal(game.state.mercurySword, true);
  assert.equal(game.ghosts[0].dashRemaining, 48); assert.equal(game.ghosts[0].dmg, 10);
  assert.equal(game.graveDiggers[0].spinWindup, 0.35);
  assert.equal(game.countItem('ruby'), 4); assert.equal(game.countItem('polishedRuby'), 2);
  assert.equal(game.storage.polishedQuartz, 8);
  for (const item of ['sapphire', 'darkstone', 'polishedSapphire']) assert.equal(game.storage[item], 0);
  const now = JSON.parse(game.createSaveText()); assert.equal(now.version, 9);
  for (const field of ['tiles', 'originalTiles']) {
    const expected = old.areas.stage8[field].slice(); expected[42 * 70 + 61] = game.STAIRS_DOWN;
    assert.deepEqual(now.areas.stage8[field], expected, `only the new stair changes ${field}`);
  }
  assert.deepEqual(now.areas.stage8.damage, old.areas.stage8.damage);
  assert.deepEqual(now.areas.stage7.tiles, old.areas.stage7.tiles, 'revealed secret seam is untouched');
  assert.deepEqual(now.inventory, old.inventory);
  assert.equal(slot.getItem(game.saveKey), text, 'loading never overwrites the old browser save');
  elements.resume.click(); suppressNewEnemySpawns(game.level);
  moveToStairs(game, step, game.level.stairsDown);
  assert.equal(game.level.id, 'stage9');
  moveToStairs(game, step, game.level.stairsUp);
  assert.equal(game.level.id, 'stage8'); assert.equal(game.getTile(61, 42), game.STAIRS_DOWN);
});

test('malformed skeleton, bone and healing fields fail atomically', () => {
  const { game } = createGame(); game.enterLevel('stage9'); suppressNewEnemySpawns(game.level);
  const grave = game.level.graves[1]; game.infectedSkeletons.push(game.makeInfectedSkeleton(grave.x, grave.y, 1));
  game.boneProjectiles.push({ x: grave.x, y: grave.y, vx: 190, vy: 0, age: 0.2 });
  game.state.hp = 80; game.state.healDelay = 2;
  const before = comparableSave(game), cases = [];
  function invalid(change) { const save = structuredClone(before); change(save); cases.push(save); }
  invalid((s) => { s.enemies.infectedSkeletons[0].graveIndex = 999; });
  invalid((s) => { s.enemies.infectedSkeletons[0].hidden = 'yes'; });
  invalid((s) => { s.enemies.infectedSkeletons[0].x += 100; });
  invalid((s) => { s.enemies.infectedSkeletons[0].hp = 211; });
  invalid((s) => { s.enemies.infectedSkeletons[0].throwCooldown = -1; });
  invalid((s) => { s.enemies.infectedSkeletons[0].strafeSign = 0; });
  invalid((s) => { s.areas.stage9.boneProjectiles[0].vx = 500; });
  invalid((s) => { s.areas.stage9.boneProjectiles[0].vy = 2; });
  invalid((s) => { s.areas.stage9.boneProjectiles[0].age = 2.5; });
  invalid((s) => { delete s.areas.stage9.boneProjectiles; });
  invalid((s) => { s.state.healDelay = 5; });
  invalid((s) => { s.state.healProgress = 0.1; });
  invalid((s) => { s.state.healDelay = 0; s.state.healProgress = 0.2; });
  for (const save of cases) {
    save.savedAt = new Date().toISOString();
    assert.throws(() => game.loadSaveText(JSON.stringify(save)));
    assert.deepEqual(comparableSave(game), before, 'a rejected import leaves the run unchanged');
  }
});

test('a naturally thrown bone and emerging Skeleton resume and damage normally after a v5 reload', () => {
  const source = createGame(), { game, step } = source; openDepthArena(game);
  const grave = game.level.graves[1], skeleton = game.makeInfectedSkeleton(grave.x, grave.y, 1);
  skeleton.speed = 0; game.infectedSkeletons.push(skeleton);
  game.player.x = grave.x - 100; game.player.y = grave.y;
  let frames = 0;
  while (!game.boneProjectiles.length && frames++ < 40) step(1);
  assert.equal(skeleton.hidden, false); assert.equal(game.boneProjectiles.length, 1);
  const saved = game.createSaveText(), restored = createGame({ autoStart: false });
  restored.game.loadSaveText(saved);
  assert.equal(restored.game.boneProjectiles.length, 1);
  restored.elements.resume.click(); restored.step(1); // loading resets the frame clock
  restored.step(20);
  assert.equal(restored.game.state.hp, 85, 'the saved bone remains dangerous after loading');
  assert.ok(restored.game.state.healDelay > 3);
});

test('the saved four-second healing delay resumes precisely and the recovery indicator updates', () => {
  const { game } = createGame();
  game.state.hp = 94; game.state.healDelay = 1.25; game.state.healProgress = 0;
  const restored = createGame({ autoStart: false }); restored.game.loadSaveText(game.createSaveText());
  assert.equal(restored.elements['hp-fill'].classList.contains('is-healing'), false);
  restored.elements.resume.click(); restored.step(1);
  restored.step(24); assert.equal(restored.game.state.hp, 94);
  assert.ok(restored.game.state.healDelay > 0);
  restored.step(1); assert.equal(restored.game.state.healDelay, 0);
  assert.equal(restored.elements['hp-fill'].classList.contains('is-healing'), true);
  restored.step(4); assert.equal(restored.game.state.hp, 95);
  restored.step(20); assert.equal(restored.game.state.hp, 100);
  assert.equal(restored.elements['hp-fill'].classList.contains('is-healing'), false);
});

test('all genuine v1–v4 injured saves begin a conservative fresh healing wait', () => {
  for (const fixture of ['pre-stage6-v1.json', 'pre-elevator-v2.json', 'pre-haunted-v3.json', 'pre-depths-v4.json']) {
    const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8'));
    const restored = createGame({ autoStart: false }); restored.game.loadSaveText(JSON.stringify(original));
    assert.equal(restored.game.state.hp, original.state.hp, fixture);
    assert.equal(restored.game.state.healDelay, 4, fixture);
    assert.equal(restored.game.state.healProgress, 0, fixture);
    assert.equal(restored.game.storage.sapphire, 0); assert.equal(restored.game.storage.darkstone, 0);
    assert.equal(restored.game.storage.polishedSapphire, 0);
  }
});

// Warden's Core, rebalanced enemies and the Core of Darkness.
function wardenArena() {
  const run = createGame(), g = run.game;
  g.enterLevel('stage10'); suppressNewEnemySpawns(g.level);
  const p = g.level.pedestal;
  g.player.x = p.x - 60; g.player.y = p.y;
  g.camera.x = g.player.x; g.camera.y = g.player.y;
  g.state.transitionLock = 999;
  assert.equal(g.useWardenPedestal(), true);
  return run;
}
function hitWarden(g) {
  const boss = g.warden;
  assert.ok(boss);
  g.player.x = boss.x - 60; g.player.y = boss.y;
  aimSwordAt(g, boss); g.state.tools.sword = 4; g.state.mercurySword = false;
  g.state.cooldown = 0; g.swing();
}

test('all ordinary enemies have double their old health while haunted enemies are unchanged', () => {
  const { game: g } = createGame();
  assert.equal(g.makeSlime(100, 100, false).hp, 60);
  assert.equal(g.makeSlime(100, 100, true).hp, 30);
  assert.equal(g.makeSlime(100, 100, false, true).hp, 120);
  assert.equal(g.makeSlime(100, 100, false, false, true).hp, 60);
  assert.equal(g.makeMole(100, 100).hp, 60);
  assert.equal(g.makeSpider(100, 100).hp, 30);
  assert.equal(g.makeProspector(100, 100).hp, 90);
  assert.equal(g.makeGolem(100, 100, false, 35).hp, 270);
  assert.equal(g.makeGolem(100, 100, true, 35).hp, 230);
  assert.equal(g.makeGhost(100, 100).hp, 175);
  assert.equal(g.makeGraveDigger(100, 100).hp, 210);
  assert.equal(g.makeInfectedSkeleton(100, 100).hp, 210);
});

test('Stage 9 leads to the single circular Stage 10 arena, then back and by visited elevator', () => {
  const { game: g, step, elements } = createGame();
  g.enterLevel('stage7'); let lift = g.level.elevators[0]; g.player.x = lift.x; g.player.y = lift.y;
  assert.equal(g.useElevator(lift), true); assert.equal(g.activateElevator(), true);
  assert.equal(elements['elevator-floors'].children[10].disabled, true);
  g.closeStation(); g.enterLevel('stage9'); suppressNewEnemySpawns(g.level);
  const depths = g.level, exit = depths.stairsDown;
  assert.deepEqual({ tx: exit.tx, ty: exit.ty }, { tx: 61, ty: 41 });
  assert.ok(reachableWalkableTiles(g, depths).has('61,41'));
  moveToStairs(g, step, exit);
  assert.equal(g.level.id, 'stage10'); assert.equal(g.level.name, "Warden's Core");
  assert.equal(elements['area-kicker'].textContent, 'Stage 10');
  const arena = g.level, center = arena.pedestal;
  assert.equal(arena.upTarget, 'stage9'); assert.equal(arena.downTarget, 'stage11');
  assert.ok(reachableWalkableTiles(g, arena).has(`${Math.floor(center.x / 32)},${Math.floor(center.y / 32)}`));
  assert.ok(arena.tiles.includes(g.DARKSTONE)); assert.ok(arena.tiles.includes(g.BLACK_AMETHYST));
  assert.equal(arena.tiles.includes(g.STONE), false);
  for (let y = 1; y < arena.h - 1; y++) for (let x = 1; x < arena.w - 1; x++) {
    if (!g.TILES[arena.tiles[y * arena.w + x]].solid) {
      assert.ok(Math.hypot(x - 29, y - 29) <= 24.3 + 1e-7, 'all floor belongs to the single circle');
    }
  }
  step(100); assert.equal(g.slimes.length + g.moles.length + g.spiders.length + g.golems.length +
    g.ghosts.length + g.graveDiggers.length + g.infectedSkeletons.length + g.prospectors.length, 0);
  moveToStairs(g, step, arena.stairsUp); assert.equal(g.level, depths);
  lift = g.level.elevators[0]; g.player.x = lift.x; g.player.y = lift.y;
  assert.equal(g.useElevator(lift), true); assert.equal(elements['elevator-floors'].children[10].disabled, false);
  elements['elevator-floors'].children[10].click(); assert.equal(g.level, arena);
});

test('the nearby pedestal starts the Warden with F, and a distant pedestal does not steal mouse swings', () => {
  const { game: g, elements, listeners } = createGame(); g.enterLevel('stage10');
  const p = g.level.pedestal;
  g.player.x = p.x - 4 * 32; g.player.y = p.y; g.camera.x = g.player.x; g.camera.y = g.player.y;
  g.selectTool('sword'); g.state.cooldown = 0;
  elements.game.dispatch('pointerdown', { pointerType: 'mouse', clientX: p.x - g.camera.x + 640, clientY: 400 });
  assert.equal(g.warden, null); assert.ok(g.state.cooldown > 0, 'far click remains a sword swing');
  g.player.x = p.x - 60; g.state.cooldown = 0;
  listeners.keydown[0]({ code: 'KeyF', target: { tagName: 'BODY' }, preventDefault: noop });
  assert.ok(g.warden); assert.equal(g.warden.hp, 3500); assert.equal(g.warden.phase, 1);
  assert.equal(elements['warden-hud'].classList.contains('is-hidden'), false);
  assert.equal(g.useWardenPedestal(), false, 'the active fight cannot be restarted');
  assert.equal(elements['area-banner'].classList.contains('has-warden'), true);
  assert.equal(elements['area-banner'].classList.contains('is-arriving'), false);
});

test('Warden takes exactly 100 unenhanced T4 hits, enters all phases and permanently unlocks the Core', () => {
  const { game: g, elements } = wardenArena();
  g.addItem('stone', 990); // the permanent Core must work even with a full bag
  const before = JSON.stringify(g.inventory);
  for (let i = 1; i <= 99; i++) {
    hitWarden(g); assert.ok(g.warden, `still alive after ${i} hits`);
    assert.equal(g.warden.hp, 3500 - i * 35);
    assert.equal(g.warden.phase, i < 34 ? 1 : i < 67 ? 2 : 3);
    if (g.warden.phase > 1) {
      assert.equal(g.warden.x, g.level.pedestal.x); assert.equal(g.warden.y, g.level.pedestal.y);
    }
  }
  hitWarden(g);
  assert.equal(g.warden, null); assert.equal(g.state.wardenDefeated, true);
  assert.equal(elements['warden-hud'].classList.contains('is-hidden'), true);
  assert.equal(elements['void-power'].classList.contains('is-hidden'), false);
  assert.equal(JSON.stringify(g.inventory), before, 'the Core does not use a bag slot');
  assert.equal(g.useWardenPedestal(), true); assert.equal(g.warden, null, 'victory cannot be replayed');
  g.enterLevel('stage9'); g.enterLevel('stage10'); g.player.x = g.level.pedestal.x; g.player.y = g.level.pedestal.y;
  g.useWardenPedestal(); assert.equal(g.warden, null);
  g.respawnAtBase(); assert.equal(g.state.wardenDefeated, true);
});

test('Phase 1 flashes a fixed charge path and only damages the player during the charge', () => {
  const { game: g, step } = wardenArena(), boss = g.warden;
  g.player.x = boss.x + 170; g.player.y = boss.y; boss.timer = 0; boss.attackIndex = 0;
  step(1); assert.equal(boss.action, 'chargeWarning');
  const beforeX = boss.x, beforeY = boss.y;
  step(20); assert.equal(boss.action, 'chargeWarning');
  assert.equal(boss.x, beforeX); assert.equal(boss.y, beforeY); assert.equal(g.state.hp, 100);
  while (boss.action === 'chargeWarning') step(1);
  assert.equal(boss.action, 'charge');
  step(15); assert.ok(boss.x > beforeX + 100); assert.equal(g.state.hp, 60);
});

test('Phase 1 sword slam warns with a box and lets the player dodge out of its range', () => {
  for (const dodge of [false, true]) {
    const { game: g, step } = wardenArena(), boss = g.warden;
    g.player.x = boss.x + 70; g.player.y = boss.y; boss.timer = 0; boss.attackIndex = 1;
    step(1); assert.equal(boss.action, 'slamWarning'); assert.equal(g.state.hp, 100);
    if (dodge) g.player.y += 110;
    while (boss.action === 'slamWarning') step(1);
    assert.equal(boss.action, 'slamImpact'); assert.equal(g.state.hp, dodge ? 100 : 55);
  }
});

test('Phase 2 remains centered and creates a warned spike lane that lingers and sinks', () => {
  const { game: g, step } = wardenArena();
  for (let i = 0; i < 34; i++) hitWarden(g);
  const boss = g.warden, center = g.level.pedestal;
  assert.equal(boss.phase, 2); boss.timer = 0; boss.attackIndex = 0;
  g.player.x = center.x + 180; g.player.y = center.y;
  step(1); assert.equal(boss.action, 'spikeWarning'); assert.equal(g.state.hp, 100);
  assert.equal(boss.x, center.x); assert.equal(boss.y, center.y);
  step(15); assert.equal(boss.action, 'spikeWarning'); assert.equal(g.state.hp, 100);
  while (boss.action === 'spikeWarning') step(1);
  assert.equal(boss.action, 'spikes'); step(1); assert.equal(g.state.hp, 88);
  g.player.y += 130;
  step(40); assert.equal(boss.action, 'spikes', 'the spikes linger for multiple seconds');
  step(25); assert.equal(boss.action, 'spikes', 'they sink gradually, not instantly');
  while (boss.action === 'spikes') step(1);
  assert.equal(boss.x, center.x); assert.equal(boss.y, center.y);
});

test('Phase 3 spikes rise faster and the boomerang travels faster than in Phase 2', () => {
  function sample(phase, index) {
    const run = wardenArena(), { game: g, step } = run, b = g.warden, p = g.level.pedestal;
    b.phase = phase; b.hp = phase === 2 ? 2000 : 1000; b.action = 'idle'; b.timer = 0; b.attackIndex = index;
    b.x = p.x; b.y = p.y; g.player.x = p.x + 280; g.player.y = p.y; g.state.invuln = 999;
    step(1);
    const warning = b.timer;
    while (b.action.endsWith('Warning')) step(1);
    const action = b.action, activeTimer = b.timer;
    if (index === 1) step(10);
    return { warning, activeTimer, action, distance: b.swordX - p.x, g, step, b };
  }
  const p2spikes = sample(2, 0), p3spikes = sample(3, 0);
  assert.equal(p2spikes.action, 'spikes'); assert.equal(p3spikes.action, 'spikes');
  assert.ok(p3spikes.warning < p2spikes.warning);
  assert.ok(p3spikes.activeTimer < p2spikes.activeTimer, 'same hold/sink with a faster rise');
  const p2sword = sample(2, 1), p3sword = sample(3, 1);
  assert.equal(p2sword.action, 'sword'); assert.equal(p3sword.action, 'sword');
  assert.ok(p3sword.distance > p2sword.distance + 40);
  const thrown = p3sword.b; let frames = 0, returned = false;
  while (thrown.action === 'sword' && frames++ < 100) {
    p3sword.step(1); returned ||= thrown.swordReturning;
  }
  assert.equal(returned, true); assert.equal(thrown.action, 'idle', 'the sword returns to the Warden');
});

test('Phase 3 warns before its damaging Void beam and supports moving out of the lane', () => {
  for (const dodge of [false, true]) {
    const { game: g, step } = wardenArena(), b = g.warden, p = g.level.pedestal;
    b.phase = 3; b.hp = 1000; b.action = 'idle'; b.timer = 0; b.attackIndex = 2;
    g.player.x = p.x + 180; g.player.y = p.y; step(1);
    assert.equal(b.action, 'beamWarning'); assert.equal(g.state.hp, 100);
    step(15); assert.equal(b.action, 'beamWarning'); assert.equal(g.state.hp, 100);
    if (dodge) g.player.y += 120;
    while (b.action === 'beamWarning') step(1);
    assert.equal(b.action, 'beam'); step(1);
    assert.equal(g.state.hp, dodge ? 100 : 50);
  }
});

test('Void Power works via X or touch button, boosts sword damage by 50%, and recharges after 20 seconds', () => {
  const { game: g, step, listeners, elements } = wardenArena();
  for (let i = 0; i < 100; i++) hitWarden(g);
  assert.equal(g.state.wardenDefeated, true);
  listeners.keydown[0]({ code: 'KeyX', target: { tagName: 'BODY' }, preventDefault: noop });
  assert.equal(g.state.voidPowerTime, 8); assert.equal(g.state.voidPowerCooldown, 20);
  assert.equal(elements['void-power'].disabled, true); assert.equal(g.activateVoidPower(), false);
  g.enterLevel('stage8'); suppressNewEnemySpawns(g.level);
  const ghost = g.makeGhost(g.player.x + 50, g.player.y); g.ghosts.push(ghost);
  aimSwordAt(g, ghost); g.state.tools.sword = 4; g.state.mercurySword = true;
  g.state.cooldown = 0; g.swing();
  assert.equal(ghost.hp, 175 - 52.5, 'Void boosts Ghost damage, while Mercury poison does not apply');
  ghost.dead = true;
  g.enterLevel('stage5'); suppressNewEnemySpawns(g.level);
  const golem = g.makeGolem(g.player.x + 50, g.player.y); g.golems.push(golem);
  assert.equal(golem.maxHp, 200 + 2 * 35, 'temporary Void Power does not change spawned armour');
  aimSwordAt(g, golem); g.state.tools.sword = 4; g.state.cooldown = 0; g.swing();
  assert.equal(golem.hp, golem.maxHp - 35 * 1.5, 'Void boosts the unenhanced base damage while Mercury poisons');
  golem.dead = true;
  step(160); assert.equal(g.state.voidPowerTime, 0); assert.ok(Math.abs(g.state.voidPowerCooldown - 12) < 1e-7);
  step(240); assert.equal(g.state.voidPowerCooldown, 0); assert.equal(elements['void-power'].disabled, false);
  elements['void-power'].click(); assert.equal(g.state.voidPowerTime, 8);
});

test('Black Amethyst is mineable, polishable and sells atomically for two Gold Coins', () => {
  const { game: g, step, elements } = createGame(); g.enterLevel('stage10');
  const ore = findReachableOre(g, g.BLACK_AMETHYST); aimPickaxeAt(g, ore); g.state.tools.pickaxe = 4;
  for (let i = 0; i < g.pickaxeHits(g.TILES[g.BLACK_AMETHYST]); i++) {
    g.state.cooldown = 0; elements.game.dispatch('pointerdown', { pointerType: 'mouse', clientX: g.pointer.x, clientY: g.pointer.y });
  }
  assert.equal(g.getTile(ore.tx, ore.ty), g.FLOOR);
  assert.ok(g.pickups.some((p) => p.item === 'blackAmethyst')); step(30);
  assert.equal(g.countItem('blackAmethyst'), 1);
  g.enterLevel('home'); assert.equal(g.polishGem('blackAmethyst'), true);
  assert.equal(g.countItem('polishedBlackAmethyst'), 1);
  assert.equal(g.sellPolishedGem('blackAmethyst'), true);
  assert.equal(g.countItem('goldCoin'), 2);
  g.removeItem('goldCoin', 2); g.addItem('polishedBlackAmethyst', 2); g.addItem('stone', 891);
  assert.equal(g.sellPolishedGem('blackAmethyst'), false, 'two coins must both fit');
  assert.equal(g.countItem('polishedBlackAmethyst'), 2);
  g.enterLevel('stage9'); g.enterLevel('stage10'); assert.equal(g.getTile(ore.tx, ore.ty), g.BLACK_AMETHYST);
});

test('the thrown Warden sword damages on its outward trip and returns', () => {
  const { game: g, step } = wardenArena(), boss = g.warden, p = g.level.pedestal;
  boss.phase = 2; boss.hp = 2000; boss.action = 'idle'; boss.timer = 0; boss.attackIndex = 1;
  g.player.x = p.x + 180; g.player.y = p.y;
  step(1); assert.equal(boss.action, 'swordWarning');
  while (boss.action === 'swordWarning') step(1);
  assert.equal(boss.action, 'sword');
  let frames = 0; while (g.state.hp === 100 && frames++ < 50) step(1);
  assert.equal(g.state.hp, 70);
  let returning = false;
  while (boss.action === 'sword' && frames++ < 120) { step(1); returning ||= boss.swordReturning; }
  assert.equal(returning, true); assert.equal(boss.action, 'idle');
});

test('an unfinished Warden fight resets on leaving or death, but can be retried', () => {
  const { game: g } = wardenArena();
  hitWarden(g); assert.equal(g.warden.hp, 3465);
  g.enterLevel('stage9'); assert.equal(g.warden, null);
  g.enterLevel('stage10'); g.player.x = g.level.pedestal.x; g.player.y = g.level.pedestal.y;
  assert.equal(g.useWardenPedestal(), true); assert.equal(g.warden.hp, 3500);
  g.respawnAtBase(); assert.equal(g.state.wardenDefeated, false); assert.equal(g.warden, null);
  g.enterLevel('stage10'); g.player.x = g.level.pedestal.x; g.player.y = g.level.pedestal.y;
  assert.equal(g.useWardenPedestal(), true); assert.equal(g.warden.hp, 3500);
});

test('v7 saves resume an in-progress Warden warning, attack and arena state', () => {
  const { game: g, step } = wardenArena(), boss = g.warden;
  g.player.x = boss.x + 150; g.player.y = boss.y; boss.timer = 0; boss.attackIndex = 0;
  step(1); assert.equal(boss.action, 'chargeWarning'); step(7);
  g.addItem('blackAmethyst', 3); g.storage.polishedBlackAmethyst = 2;
  const before = comparableSave(g), text = JSON.stringify({ ...before, savedAt: new Date().toISOString() });
  assert.equal(before.version, 9);
  const restored = createGame({ autoStart: false }); restored.game.loadSaveText(text);
  assert.deepEqual(comparableSave(restored.game), before);
  assert.equal(restored.game.warden.action, 'chargeWarning');
  assert.equal(restored.elements['warden-hud'].classList.contains('is-hidden'), false);
  assert.equal(restored.elements['area-banner'].classList.contains('has-warden'), true);
  assert.equal(restored.elements['area-banner'].classList.contains('is-arriving'), false);
  restored.elements.resume.click(); restored.step(1);
  let frames = 0; while (restored.game.warden.action === 'chargeWarning' && frames++ < 30) restored.step(1);
  assert.equal(restored.game.warden.action, 'charge');
  restored.step(15); assert.equal(restored.game.state.hp, 60);
});

test('v7 persists victory and an active Void Power across reloads and prevents another fight', () => {
  const { game: g } = wardenArena(); for (let i = 0; i < 100; i++) hitWarden(g);
  assert.equal(g.activateVoidPower(), true);
  g.enterLevel('stage9');
  const before = comparableSave(g), restored = createGame({ autoStart: false });
  restored.game.loadSaveText(JSON.stringify({ ...before, savedAt: new Date().toISOString() }));
  assert.deepEqual(comparableSave(restored.game), before);
  assert.equal(restored.game.state.wardenDefeated, true); assert.equal(restored.game.state.voidPowerTime, 8);
  restored.elements.resume.click(); restored.game.enterLevel('stage10');
  restored.game.player.x = restored.game.level.pedestal.x; restored.game.player.y = restored.game.level.pedestal.y;
  assert.equal(restored.game.useWardenPedestal(), true); assert.equal(restored.game.warden, null);
  restored.game.respawnAtBase(); assert.equal(restored.game.state.wardenDefeated, true);
  assert.equal(restored.game.state.voidPowerTime, 0); assert.equal(restored.game.state.voidPowerCooldown, 20);
});

test('genuine v5 Depths saves gain the Stage 10 stair while preserving haunted enemies and healing', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-warden-depths-v5.json'), 'utf8');
  const old = JSON.parse(text), restored = createGame({ autoStart: false }); restored.game.loadSaveText(text);
  const g = restored.game, now = JSON.parse(g.createSaveText());
  assert.equal(now.version, 9); assert.equal(g.level.id, 'stage9');
  for (const field of ['tiles', 'originalTiles']) {
    const expected = old.areas.stage9[field].slice(); expected[41 * 72 + 61] = g.STAIRS_DOWN;
    assert.deepEqual(now.areas.stage9[field], expected, `only the new stair changes ${field}`);
  }
  assert.deepEqual(now.areas.stage9.damage, old.areas.stage9.damage);
  assert.deepEqual(now.inventory, old.inventory); assert.equal(g.state.hp, 67);
  assert.equal(g.state.healDelay, 2.35); assert.equal(g.storage.polishedSapphire, 7);
  assert.equal(g.ghosts[0].hp, 105); assert.equal(g.graveDiggers[0].hp, 140);
  assert.equal(g.infectedSkeletons[0].hidden, true); assert.equal(g.infectedSkeletons[1].hp, 140);
  assert.equal(g.boneProjectiles[0].age, 0.3); assert.equal(g.state.wardenDefeated, false);
  assert.equal(g.storage.blackAmethyst, 0); assert.equal(g.storage.polishedBlackAmethyst, 0);
  restored.elements.resume.click(); moveToStairs(g, restored.step, g.level.stairsDown);
  assert.equal(g.level.id, 'stage10');
});

test('genuine v5 active enemies retain their health percentage when migrated to doubled HP', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-warden-enemies-v5.json'), 'utf8');
  const old = JSON.parse(text), restored = createGame({ autoStart: false }); restored.game.loadSaveText(text);
  const g = restored.game;
  assert.deepEqual(Array.from(g.slimes, (s) => s.hp), old.enemies.slimes.map((s) => s.hp * 2));
  assert.equal(g.moles[0].hp, old.enemies.moles[0].hp * 2);
  assert.equal(g.spiders[0].hp, old.enemies.spiders[0].hp * 2);
  assert.equal(g.prospectors[0].hp, old.areas.stage7.prospectors[0].hp * 2);
  assert.equal(g.prospectors[0].haul.gold, 3);
  for (let i = 0; i < 2; i++) {
    assert.equal(g.golems[i].hp, old.enemies.golems[i].hp * 2);
    assert.equal(g.golems[i].maxHp, old.enemies.golems[i].maxHp * 2);
  }
});

test('malformed v7 boss and Void Power saves fail atomically', () => {
  const { game: g } = wardenArena(), before = comparableSave(g), cases = [];
  function invalid(change) { const save = structuredClone(before); change(save); cases.push(save); }
  invalid((s) => { s.warden.hp = 3501; });
  invalid((s) => { s.warden.phase = 2; });
  invalid((s) => { s.warden.action = 'invalid'; });
  invalid((s) => { s.warden.angle = 8; });
  invalid((s) => { s.warden.timer = 9; });
  invalid((s) => { s.warden.hit = 'yes'; });
  invalid((s) => { s.currentLevel = 'home'; });
  invalid((s) => { s.state.wardenDefeated = true; });
  invalid((s) => { s.state.voidPowerTime = 4; });
  invalid((s) => { s.state.wardenDefeated = true; s.warden = null; s.state.voidPowerTime = 8; s.state.voidPowerCooldown = 2; });
  invalid((s) => { delete s.warden; });
  for (const save of cases) {
    save.savedAt = new Date().toISOString();
    assert.throws(() => g.loadSaveText(JSON.stringify(save)));
    assert.deepEqual(comparableSave(g), before);
  }
});

test('actual charge, slam, spikes, outbound/returning sword and beam survive v7 saves mid-attack', () => {
  for (const scenario of [
    { phase: 1, index: 0, action: 'charge' },
    { phase: 1, index: 1, action: 'slamImpact' },
    { phase: 2, index: 0, action: 'spikes' },
    { phase: 2, index: 1, action: 'sword' },
    { phase: 3, index: 1, action: 'sword', returning: true },
    { phase: 3, index: 2, action: 'beam' },
  ]) {
    const { game: g, step } = wardenArena(), b = g.warden;
    b.phase = scenario.phase; b.hp = [0, 3500, 2000, 1000][scenario.phase];
    b.action = scenario.phase === 1 ? 'approach' : 'idle'; b.timer = 0; b.attackIndex = scenario.index;
    g.player.x = b.x + 200; g.player.y = b.y; g.state.invuln = 999;
    let frames = 0;
    while ((b.action !== scenario.action || (scenario.returning && !b.swordReturning)) && frames++ < 160) step(1);
    assert.equal(b.action, scenario.action, JSON.stringify(scenario));
    if (scenario.returning) assert.equal(b.swordReturning, true);
    else if (scenario.action === 'charge' || scenario.action === 'sword') step(3);
    const before = comparableSave(g), restored = createGame({ autoStart: false });
    restored.game.loadSaveText(JSON.stringify({ ...before, savedAt: new Date().toISOString() }));
    assert.deepEqual(comparableSave(restored.game), before, JSON.stringify(scenario));
    restored.elements.resume.click(); restored.step(2);
    assert.equal(restored.game.state.mode, 'playing');
    assert.equal(restored.game.warden.phase, scenario.phase);
  }
});

test('a T4 fighter can dodge telegraphs and defeat all three Warden phases without invulnerability', () => {
  const { game: g, elements, listeners, step } = wardenArena();
  g.state.tools.sword = 4; g.state.mercurySword = false; g.selectTool('sword');
  const held = new Set(), seen = new Set(); let minimumHp = 100, swings = 0;
  const event = (code) => ({ code, target: { tagName: 'BODY' }, preventDefault: noop });
  function move(vx, vy) {
    const next = new Set();
    if (vx > 0.25) next.add('KeyD'); else if (vx < -0.25) next.add('KeyA');
    if (vy > 0.25) next.add('KeyS'); else if (vy < -0.25) next.add('KeyW');
    for (const code of held) if (!next.has(code)) { listeners.keyup[0](event(code)); held.delete(code); }
    for (const code of next) if (!held.has(code)) { listeners.keydown[0](event(code)); held.add(code); }
  }
  for (let frame = 0; frame < 5000 && g.state.mode === 'playing' && g.warden; frame++) {
    const b = g.warden; seen.add(b.phase);
    const dx = b.x - g.player.x, dy = b.y - g.player.y, distance = Math.hypot(dx, dy) || 1;
    const dangerous = b.action.endsWith('Warning') || ['charge', 'slamImpact', 'spikes', 'sword', 'beam'].includes(b.action);
    if (dangerous) {
      const side = -(g.player.x - b.originX) * Math.sin(b.angle) + (g.player.y - b.originY) * Math.cos(b.angle);
      const width = b.action.startsWith('slam') ? g.BALANCE.wardenSlamWidth
        : b.action.startsWith('beam') ? g.BALANCE.wardenBeamWidth
        : b.action.startsWith('sword') ? 38 : g.BALANCE.wardenSpikeWidth;
      if (Math.abs(side) < width / 2 + g.BALANCE.playerRadius + 20) {
        const sign = side >= 0 ? 1 : -1;
        move(-Math.sin(b.angle) * sign, Math.cos(b.angle) * sign);
      } else move(0, 0);
    } else if (distance > 68) move(dx / distance, dy / distance);
    else if (distance < 45) move(-dx / distance, -dy / distance);
    else move(0, 0);
    if (distance < g.BALANCE.swordRange + b.r - 5 && g.state.cooldown <= 0) {
      const oldHp = b.hp;
      g.pointer.inside = true; g.pointer.x = b.x - g.camera.x + 640; g.pointer.y = b.y - g.camera.y + 400;
      elements.game.dispatch('pointerdown', { pointerType: 'mouse', clientX: g.pointer.x, clientY: g.pointer.y });
      if (b.hp < oldHp) swings++;
    }
    step(1); minimumHp = Math.min(minimumHp, g.state.hp);
  }
  move(0, 0);
  assert.equal(g.state.wardenDefeated, true, `fighter survived with ${g.state.hp} HP; boss HP ${g.warden?.hp}`);
  assert.equal(swings, 100, 'only unenhanced T4 sword hits dealt damage');
  assert.deepEqual([...seen], [1, 2, 3]);
  assert.ok(minimumHp > 0, 'the fight remains survivable by moving out of marked lanes');
});

test('v5 Prospectors in previously visited areas migrate even when that area is inactive', () => {
  const old = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-warden-enemies-v5.json'), 'utf8'));
  const home = createGame().game.level;
  old.currentLevel = 'home'; old.player.x = home.spawn.x; old.player.y = home.spawn.y;
  for (const key of Object.keys(old.enemies)) old.enemies[key] = [];
  const restored = createGame({ autoStart: false }); restored.game.loadSaveText(JSON.stringify(old));
  const prospector = restored.game.levels.stage7.prospectors[0];
  assert.equal(restored.game.level.id, 'home');
  assert.equal(prospector.hp, old.areas.stage7.prospectors[0].hp * 2);
  assert.equal(prospector.maxHp, 90); assert.equal(prospector.haul.gold, 3);
  restored.game.enterLevel('stage7');
  assert.equal(restored.game.prospectors[0], prospector);
  assert.equal(restored.game.prospectors[0].hp, old.areas.stage7.prospectors[0].hp * 2);
});

test('Phase 1 follows slowly and Space swings the equipped sword toward the Warden', () => {
  const { game: g, step, listeners } = wardenArena(), boss = g.warden;
  g.player.x = boss.x + 200; g.player.y = boss.y;
  const start = boss.x; step(20);
  assert.equal(boss.action, 'approach');
  assert.ok(Math.abs(boss.x - start - g.BALANCE.wardenWalkSpeed) < 1e-7);
  assert.equal(g.state.hp, 100, 'following is not unavoidable contact damage');
  g.player.x = boss.x - 60; g.player.y = boss.y; g.player.faceX = 1; g.player.faceY = 0;
  g.pointer.inside = false; g.state.tools.sword = 4; g.selectTool('sword');
  listeners.keydown[0]({ code: 'Space', target: { tagName: 'BODY' }, preventDefault: noop });
  assert.equal(boss.hp, 3465);
});

// Stage 11/12, denser encounters and the stronger Warden.
test('the Warden arena, three Amethyst chambers and Ancient Temple connect in both directions', () => {
  const { game: g, elements, step } = createGame();
  g.enterLevel('stage10');
  const arena = g.level;
  assert.equal(arena.tiles[7 * arena.w + 29], g.STAIRS_DOWN);
  moveToStairs(g, step, arena.stairsDown);
  const cavern = g.level;
  assert.equal(cavern.id, 'stage11'); assert.equal(cavern.name, 'Amethyst Cavern');
  assert.equal(elements['area-kicker'].textContent, 'Stage 11');
  assert.equal(elements['area-subtitle'].textContent, 'The shimmering purple crystals line the walls');
  assert.equal(cavern.upTarget, 'stage10'); assert.equal(cavern.downTarget, 'stage12');
  const seen = reachableForRadius(g, cavern, g.BALANCE.playerRadius);
  for (const point of ['13,13', '39,33', '66,13', '68,13']) assert.ok(seen.has(point), point);
  assert.ok(cavern.decor.filter((d) => d.kind === 'crystal').length >= 9);
  for (const tile of [g.STONE, g.QUARTZ, g.AMETHYST]) assert.ok(cavern.tiles.includes(tile));
  assert.equal(cavern.elevators.length, 2);
  moveToStairs(g, step, cavern.stairsDown);
  const temple = g.level;
  assert.equal(temple.id, 'stage12'); assert.equal(temple.name, 'Ancient Temple');
  assert.equal(elements['area-kicker'].textContent, 'Stage 12');
  assert.equal(elements['area-subtitle'].textContent, 'This ancient place is strangely deep beneath the surface');
  assert.equal(temple.upTarget, 'stage11'); assert.equal(temple.downTarget, 'stage13');
  const wide = reachableForRadius(g, temple, g.BALANCE.shrineGolemRadius);
  for (const point of ['22,18', '31,34', '49,33', '67,13', '67,37']) assert.ok(wide.has(point), point);
  for (const tile of [g.GOLD, g.TITANIUM, g.MOSSY_STONE, g.DIAMOND]) assert.ok(temple.tiles.includes(tile));
  assert.ok(temple.decor.some((d) => d.kind === 'ruinPillar'));
  assert.ok(temple.decor.some((d) => d.kind === 'ruinDebris'));
  assert.equal(temple.elevators.length, 2);
  moveToStairs(g, step, temple.stairsUp); assert.equal(g.level, cavern);
  moveToStairs(g, step, cavern.stairsUp); assert.equal(g.level, arena);
});

test('the new ore tiles mine and restore, including Mossy Stone dropping ordinary Stone', () => {
  const { game: g, elements, step } = createGame();
  for (const [area, tileName, item] of [['stage11', 'AMETHYST', 'amethyst'],
    ['stage12', 'MOSSY_STONE', 'stone'], ['stage12', 'DIAMOND', 'diamond']]) {
    g.enterLevel(area); suppressNewEnemySpawns(g.level);
    const level = g.level, ore = findReachableOre(g, g[tileName]);
    const before = g.countItem(item);
    aimPickaxeAt(g, ore); g.state.tools.pickaxe = 4;
    for (let n = 0; n < g.pickaxeHits(g.TILES[g[tileName]]); n++) {
      g.state.cooldown = 0;
      elements.game.dispatch('pointerdown', { pointerType: 'mouse', clientX: g.pointer.x, clientY: g.pointer.y });
    }
    assert.equal(g.getTile(ore.tx, ore.ty), g.FLOOR);
    const drop = g.pickups.find((p) => p.item === item);
    assert.ok(drop); assert.ok(drop.count >= 1 && drop.count <= (item === 'stone' ? 2 : 1));
    step(30); assert.equal(g.countItem(item), before + drop.count);
    g.enterLevel('home'); g.enterLevel(area);
    assert.equal(g.level, level); assert.equal(g.getTile(ore.tx, ore.ty), g[tileName]);
  }
});

test('Amethyst and Diamond exchanges give their exact coins and remain atomic with a full bag', () => {
  const { game: g, elements } = createGame();
  g.addItem('amethyst', 1); g.addItem('diamond', 1);
  g.openStation('polisher');
  for (const index of [7, 8]) elements['polisher-gems'].children[index].children[2].click();
  assert.equal(g.countItem('polishedAmethyst'), 1); assert.equal(g.countItem('polishedDiamond'), 1);
  g.closeStation(); g.openStation('trader');
  assert.match(elements['trader-gems'].children[7].children[1].children[0].textContent, /2 Gold Coins/);
  assert.match(elements['trader-gems'].children[8].children[1].children[0].textContent, /1 Aluminum Coin/);
  elements['trader-gems'].children[7].children[2].click();
  elements['trader-gems'].children[8].children[2].click();
  assert.equal(g.countItem('goldCoin'), 2); assert.equal(g.countItem('aluminumCoin'), 1);
  assert.equal(g.traderUnlocked.gold, false); assert.equal(g.traderUnlocked.aluminum, false);

  for (const [raw, polished, coin] of [['amethyst', 'polishedAmethyst', 'goldCoin'],
    ['diamond', 'polishedDiamond', 'aluminumCoin']]) {
    const full = createGame().game;
    full.addItem('stone', 891); full.addItem(raw, 2);
    assert.equal(full.polishGem(raw), false); assert.equal(full.countItem(raw), 2);
    full.removeItem(raw, 2); full.addItem(polished, 2);
    assert.equal(full.sellPolishedGem(raw), false);
    assert.equal(full.countItem(polished), 2); assert.equal(full.countItem(coin), 0);
    full.removeItem(polished, 1);
    assert.equal(full.sellPolishedGem(raw), true, 'consuming the last gem frees the coin slot');
    assert.equal(full.countItem(coin), raw === 'amethyst' ? 2 : 1);
  }
});

test('Purple Slimes split into 1.5x-health minis, each dropping zero or one Amethyst', () => {
  for (const random of [0, 0.99]) {
    const { game: g, math } = createGame(); g.enterLevel('stage11'); suppressNewEnemySpawns(g.level);
    math.random = () => random;
    const slime = g.makeSlime(g.player.x + 50, g.player.y, false, false, false, true);
    assert.equal(slime.hp, 90); assert.equal(slime.purple, true); g.slimes.push(slime);
    aimSwordAt(g, slime); g.state.tools.sword = 4;
    for (let n = 0; n < 3; n++) { g.state.cooldown = 0; g.swing(); }
    assert.equal(slime.dead, true);
    const minis = g.slimes.filter((s) => !s.dead);
    assert.equal(minis.length, 2);
    for (const mini of minis) { assert.equal(mini.tiny, true); assert.equal(mini.purple, true); assert.equal(mini.hp, 45); }
    for (let n = 0; n < 2; n++) { g.state.cooldown = 0; g.swing(); }
    assert.ok(minis.every((s) => s.dead));
    const drops = g.pickups.filter((p) => p.item === 'amethyst');
    assert.equal(drops.length, random === 0 ? 2 : 0);
    assert.ok(drops.every((p) => p.count === 1));
  }
});

test('Crabocks have slower spider movement, higher health and their own defeat statistic', () => {
  const { game: g, elements, step } = createGame(); g.enterLevel('stage11'); suppressNewEnemySpawns(g.level);
  const crab = g.makeSpider(g.player.x + 65, g.player.y, true), spider = g.makeSpider(100, 100);
  assert.equal(crab.kind, 'crabock'); assert.equal(crab.hp, 90);
  assert.ok(crab.hp > spider.hp && crab.speed < spider.speed && crab.r > spider.r);
  g.spiders.push(crab); const distance = crab.x - g.player.x; step(4);
  assert.equal(crab.chasing, true); assert.ok(crab.x - g.player.x < distance);
  g.player.x = crab.x - 20; g.player.y = crab.y; g.state.invuln = 0; step(1);
  assert.equal(g.state.hp, 100 - g.BALANCE.spiderDamage);
  g.player.x = crab.x - 45; g.player.y = crab.y; aimSwordAt(g, crab); g.state.tools.sword = 4;
  for (let i = 0; i < 3; i++) { g.state.cooldown = 0; g.swing(); }
  assert.equal(crab.dead, true); assert.equal(g.state.crabocksSlain, 1); assert.equal(g.state.spidersSlain, 0);
  g.state.hp = g.BALANCE.spiderDamage; g.state.invuln = 0;
  g.spiders.push(g.makeSpider(g.player.x + 20, g.player.y, true)); step(1);
  assert.equal(g.state.mode, 'dead');
  assert.equal(elements['over-crabocks'].textContent, '1');
  assert.match(elements['over-line'].textContent, /1 cave creature/);
  g.start(); assert.equal(g.state.crabocksSlain, 0);
});

test('new floors spawn the requested enemy types at the increased population caps', () => {
  const { game: g, step } = createGame();
  assert.ok(g.BALANCE.maxSlimes > 7 && g.BALANCE.slimeSpawnEvery < 3);
  assert.ok(g.BALANCE.maxSpiders > 5 && g.BALANCE.maxGolems > 3 && g.BALANCE.maxMoles > 3);
  assert.ok(g.BALANCE.maxProspectors > 4 && g.BALANCE.maxGhosts > 12);
  g.enterLevel('stage11'); g.state.invuln = 999; g.state.transitionLock = 999;
  step(600);
  assert.equal(g.state.mode, 'playing');
  assert.equal(g.slimes.length, g.BALANCE.maxSlimes); assert.equal(g.spiders.length, g.BALANCE.maxSpiders);
  assert.ok(g.slimes.every((s) => s.purple && !s.large)); assert.ok(g.spiders.every((s) => s.crabock));
  assert.equal(g.golems.length + g.prospectors.length + g.moles.length + g.ghosts.length + g.graveDiggers.length, 0);
  g.enterLevel('stage12'); g.state.invuln = 999; g.state.transitionLock = 999;
  step(600);
  assert.equal(g.state.mode, 'playing');
  assert.equal(g.spiders.length, g.BALANCE.maxSpiders); assert.ok(g.spiders.every((s) => !s.crabock));
  assert.equal(g.golems.length, g.BALANCE.maxGolems); assert.ok(g.golems.every((s) => !s.shrine && !s.mercury));
  assert.equal(g.prospectors.length, g.BALANCE.maxProspectors);
  assert.equal(g.slimes.length + g.moles.length + g.ghosts.length + g.graveDiggers.length, 0);
});

function shrineArena() {
  const run = createGame(), g = run.game; g.enterLevel('stage12'); suppressNewEnemySpawns(g.level);
  g.state.transitionLock = 999; g.player.x = g.level.golemShrine.x - 60; g.player.y = g.level.golemShrine.y;
  g.camera.x = g.player.x; g.camera.y = g.player.y; g.state.tools.sword = 4;
  return run;
}

function hitGuardian(g, guardian) {
  g.player.x = guardian.x - 60; g.player.y = guardian.y;
  aimSwordAt(g, guardian); g.state.tools.sword = 4; g.state.cooldown = 0; g.swing();
}

test('the shrine responds to F and touch, but a distant click and attacking its guardian still swing', () => {
  const { game: g, elements, listeners } = shrineArena(), shrine = g.level.golemShrine;
  g.player.x = shrine.x - 4 * 32; g.camera.x = g.player.x;
  g.selectTool('sword'); g.state.cooldown = 0;
  elements.game.dispatch('pointerdown', { pointerType: 'mouse', clientX: shrine.x - g.camera.x + 640, clientY: 400 });
  assert.equal(g.golems.length, 0); assert.ok(g.state.cooldown > 0, 'far clicks are still sword swings');
  g.player.x = shrine.x - 60; g.camera.x = g.player.x;
  listeners.keydown[0]({ code: 'KeyF', target: { tagName: 'BODY' }, preventDefault: noop });
  const guardian = g.golems[0]; assert.ok(guardian && guardian.shrine);
  assert.equal(guardian.hp, 3 * g.makeGolem(0, 0, false, 35).hp);
  assert.equal(guardian.r, g.BALANCE.shrineGolemRadius);
  g.state.cooldown = 0;
  elements.game.dispatch('pointerdown', { pointerType: 'touch', clientX: shrine.x - g.camera.x + 640, clientY: 400 });
  assert.equal(guardian.hp, guardian.maxHp - 35, 'tap through the active shrine attacks the guardian');
  assert.equal(g.golems.length, 1);
  const touch = shrineArena(), tg = touch.game, ts = tg.level.golemShrine;
  touch.elements.game.dispatch('pointerdown', { pointerType: 'touch', clientX: ts.x - tg.camera.x + 640, clientY: 400 });
  assert.ok(tg.golems[0].shrine, 'a touch on the nearby shrine summons');
});

test('shrine guardian drops exactly two Diamonds and five Stone and returns after its cooldown', () => {
  const { game: g, step } = shrineArena(); g.addItem('coal', 990); // full bag
  assert.equal(g.useGolemShrine(), true); let guardian = g.golems[0];
  while (!guardian.dead) hitGuardian(g, guardian);
  assert.equal(g.state.golemsSlain, 1); assert.equal(g.level.shrineCooldown, 20);
  const loot = g.pickups.filter((p) => p.source === 'golem');
  assert.deepEqual(Array.from(loot, (p) => [p.item, p.count]), [['diamond', 2], ['stone', 5]]);
  hitGuardian(g, guardian); assert.equal(g.pickups.length, 2, 'a second hit cannot duplicate drops');
  g.state.invuln = 999; step(100);
  assert.ok(g.level.shrineCooldown > 14.9 && g.level.shrineCooldown < 15.1);
  assert.equal(g.golems.filter((x) => x.shrine && !x.dead).length, 0);
  const remaining = g.level.shrineCooldown;
  g.enterLevel('stage11'); step(25); g.enterLevel('stage12'); suppressNewEnemySpawns(g.level);
  assert.equal(g.level.shrineCooldown, remaining, 'cooldown pauses while the temple is not active');
  assert.deepEqual(Array.from(g.pickups, (p) => [p.item, p.count]), [['diamond', 2], ['stone', 5]]);
  g.state.invuln = 999; step(301);
  guardian = g.golems.find((x) => x.shrine && !x.dead);
  assert.ok(guardian); assert.equal(guardian.hp, guardian.maxHp); assert.equal(g.level.shrineCooldown, 0);
  assert.equal(g.pickups.length, 2, 'the uncollected first reward is not duplicated');
});

test('v7 saves round-trip Purple Slimes, Crabocks and their stats', () => {
  const { game: g } = createGame(); g.enterLevel('stage11'); suppressNewEnemySpawns(g.level);
  const s = g.makeSlime(g.player.x + 35, g.player.y, false, false, false, true); s.hp = 55;
  const mini = g.makeSlime(g.player.x + 20, g.player.y + 35, true, false, false, true); mini.hp = 20;
  const crab = g.makeSpider(g.player.x + 65, g.player.y, true); crab.hp = 45;
  g.slimes.push(s, mini); g.spiders.push(crab); g.state.crabocksSlain = 3;
  g.addItem('amethyst', 4); g.storage.polishedDiamond = 2;
  const before = comparableSave(g), loaded = createGame({ autoStart: false });
  loaded.game.loadSaveText(JSON.stringify({ ...before, savedAt: new Date().toISOString() }));
  assert.deepEqual(comparableSave(loaded.game), before);
  assert.ok(loaded.game.slimes.every((x) => x.purple)); assert.equal(loaded.game.slimes[1].maxHp, 45);
  assert.equal(loaded.game.spiders[0].kind, 'crabock'); assert.equal(loaded.game.spiders[0].hp, 45);
  assert.equal(loaded.game.state.crabocksSlain, 3);
});

test('v7 saves preserve a living shrine guardian, its armour and the shrine cooldown/reward', () => {
  const { game: g } = shrineArena(); g.useGolemShrine();
  const guardian = g.golems[0]; hitGuardian(g, guardian); g.state.tools.sword = 1;
  const before = comparableSave(g), loaded = createGame({ autoStart: false });
  loaded.game.loadSaveText(JSON.stringify({ ...before, savedAt: new Date().toISOString() }));
  assert.deepEqual(comparableSave(loaded.game), before);
  const savedGuardian = loaded.game.golems[0]; assert.equal(savedGuardian.shrine, true);
  assert.equal(savedGuardian.maxHp, guardian.maxHp); assert.equal(savedGuardian.hp, guardian.hp);
  loaded.elements.resume.click();
  while (!savedGuardian.dead) hitGuardian(loaded.game, savedGuardian);
  const afterKill = comparableSave(loaded.game), roundTrip = createGame({ autoStart: false });
  roundTrip.game.loadSaveText(JSON.stringify({ ...afterKill, savedAt: new Date().toISOString() }));
  assert.deepEqual(comparableSave(roundTrip.game), afterKill);
  assert.equal(roundTrip.game.level.shrineActivated, true); assert.equal(roundTrip.game.level.shrineCooldown, 20);
  assert.deepEqual(Array.from(roundTrip.game.pickups, (p) => [p.item, p.count]), [['diamond', 2], ['stone', 5]]);
  roundTrip.elements.resume.click(); suppressNewEnemySpawns(roundTrip.game.level);
  roundTrip.game.state.invuln = 999; roundTrip.step(401);
  assert.equal(roundTrip.game.golems.filter((x) => x.shrine && !x.dead).length, 1);
});

test('a Prospector mines Mossy Stone blocking Gold and can be saved while targeting it', () => {
  const { game: g, step } = createGame(); g.enterLevel('stage12'); suppressNewEnemySpawns(g.level);
  for (let y = 4; y <= 17; y++) for (let x = 4; x <= 23; x++) {
    if (g.getTile(x, y) !== g.STAIRS_UP) g.setTile(x, y, g.FLOOR);
  }
  g.player.x = 20.5 * 32; g.player.y = 16.5 * 32;
  const p = g.makeProspector(10.5 * 32, 10.5 * 32); g.prospectors.push(p);
  g.setTile(12, 10, g.GOLD);
  for (const [x, y] of [[11, 10], [12, 9], [13, 10], [12, 11]]) g.setTile(x, y, g.MOSSY_STONE);
  step(1); assert.equal(p.oreTarget.tile, g.MOSSY_STONE);
  const saved = g.createSaveText(), loaded = createGame({ autoStart: false }); loaded.game.loadSaveText(saved);
  assert.equal(loaded.game.prospectors[0].oreTarget.tile, g.MOSSY_STONE);
  step(180); assert.equal(g.getTile(12, 10), g.FLOOR); assert.equal(p.haul.gold, 1);
});

test('genuine v6 fights migrate proportionally with the new stair, spike cooldown and intact progress', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-caverns-warden-v6.json'), 'utf8');
  const old = JSON.parse(text), loaded = createGame({ autoStart: false }); loaded.game.loadSaveText(text);
  const g = loaded.game, now = JSON.parse(g.createSaveText());
  assert.equal(now.version, 9); assert.equal(g.level.id, 'stage10');
  assert.equal(g.warden.hp, old.warden.hp * 2); assert.equal(g.warden.phase, old.warden.phase);
  assert.equal(g.warden.action, 'spikes'); assert.equal(g.warden.hit, true);
  assert.equal(g.warden.spikeCooldown, g.BALANCE.wardenSpikeTick);
  for (const field of ['tiles', 'originalTiles']) {
    const expected = old.areas.stage10[field].slice(); expected[7 * 59 + 29] = g.STAIRS_DOWN;
    assert.deepEqual(now.areas.stage10[field], expected, `only the exit changes ${field}`);
  }
  assert.deepEqual(now.areas.stage10.damage, old.areas.stage10.damage);
  assert.deepEqual(now.areas.stage10.pickups, old.areas.stage10.pickups);
  assert.deepEqual(now.inventory, old.inventory); assert.equal(g.state.hp, old.state.hp);
  assert.equal(g.state.crabocksSlain, 0);
  for (const item of ['amethyst', 'polishedAmethyst', 'diamond', 'polishedDiamond']) assert.equal(g.storage[item], 0);
  loaded.elements.resume.click(); moveToStairs(g, loaded.step, g.level.stairsDown);
  assert.equal(g.level.id, 'stage11'); assert.equal(g.warden, null);
});

test('genuine v6 victory and active Void Power remain unlocked and can enter the new floors', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-caverns-victory-v6.json'), 'utf8');
  const old = JSON.parse(text), loaded = createGame({ autoStart: false }); loaded.game.loadSaveText(text);
  const g = loaded.game;
  assert.equal(g.state.wardenDefeated, true); assert.equal(g.warden, null);
  assert.equal(g.state.voidPowerTime, old.state.voidPowerTime); assert.equal(g.state.voidPowerCooldown, old.state.voidPowerCooldown);
  assert.equal(g.countItem('blackAmethyst'), old.inventory[0].count);
  loaded.elements.resume.click(); moveToStairs(g, loaded.step, g.level.stairsDown);
  assert.equal(g.level.id, 'stage11'); moveToStairs(g, loaded.step, g.level.stairsDown);
  assert.equal(g.level.id, 'stage12'); assert.equal(g.state.wardenDefeated, true);
});

test('lingering Warden spikes repeatedly tick on the lane, with recovery, escape and saved cooldown', () => {
  const { game: g, step } = wardenArena(), boss = g.warden, p = g.level.pedestal;
  boss.phase = 2; boss.hp = 2000; boss.x = p.x; boss.y = p.y;
  boss.action = 'idle'; boss.timer = 0; boss.attackIndex = 0;
  g.player.x = p.x + 180; g.player.y = p.y; step(1);
  while (boss.action === 'spikeWarning') step(1);
  step(1); assert.equal(g.state.hp, 88); assert.equal(boss.spikeCooldown, 0.65);
  const before = comparableSave(g), loaded = createGame({ autoStart: false });
  loaded.game.loadSaveText(JSON.stringify({ ...before, savedAt: new Date().toISOString() }));
  assert.deepEqual(comparableSave(loaded.game), before);
  loaded.elements.resume.click(); loaded.step(2);
  assert.equal(loaded.game.state.hp, 88, 'reloading must not apply a duplicate immediate tick');
  step(12); assert.equal(g.state.hp, 88, 'tick recovery prevents rapid damage');
  step(2); assert.equal(g.state.hp, 76);
  step(14); assert.equal(g.state.hp, 64, 'the same attack can tick repeatedly');
  g.player.y += 120; step(20); assert.equal(g.state.hp, 64, 'leaving the lane avoids further ticks');
});

test('malformed v7 variant, shrine and spike saves fail atomically', () => {
  const { game: g } = shrineArena(); g.useGolemShrine();
  const before = comparableSave(g), cases = [];
  function invalid(change) { const data = structuredClone(before); change(data); cases.push(data); }
  invalid((s) => { s.enemies.golems[0].shrine = 'yes'; });
  invalid((s) => { s.enemies.golems[0].mercury = true; });
  invalid((s) => { s.enemies.golems[0].maxHp += 3; });
  invalid((s) => { s.areas.stage12.shrine.cooldown = 21; });
  invalid((s) => { s.areas.stage12.shrine.activated = false; });
  invalid((s) => { s.enemies.golems.push(structuredClone(s.enemies.golems[0])); });
  invalid((s) => { delete s.areas.stage12.shrine; });
  invalid((s) => { s.currentLevel = 'home'; s.player.x = s.areas.home.w; });
  for (const save of cases) {
    save.savedAt = new Date().toISOString(); assert.throws(() => g.loadSaveText(JSON.stringify(save)));
    assert.deepEqual(comparableSave(g), before);
  }
  const boss = wardenArena().game, bossBefore = comparableSave(boss), bad = structuredClone(bossBefore);
  bad.savedAt = new Date().toISOString(); bad.warden.spikeCooldown = 5;
  assert.throws(() => boss.loadSaveText(JSON.stringify(bad))); assert.deepEqual(comparableSave(boss), bossBefore);
});

test('v6 migration preserves inactive Warden arena loot and cracks before the next normal reset', () => {
  const old = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-caverns-warden-v6.json'), 'utf8'));
  const fresh = createGame(), spawn = fresh.game.level.spawn;
  old.currentLevel = 'home'; old.player.x = spawn.x; old.player.y = spawn.y; old.warden = null;
  for (const key of Object.keys(old.enemies)) old.enemies[key] = [];
  const area = old.areas.stage10, width = 59;
  const ore = area.tiles.findIndex((tile) => tile === fresh.game.BLACK_AMETHYST);
  assert.ok(ore >= 0);
  area.damage.push([`${ore % width},${Math.floor(ore / width)}`, 2]);
  area.pickups.push(savedPickup('blackAmethyst', 29.5 * 32, 45.5 * 32, { count: 4 }));
  const loaded = createGame({ autoStart: false }); loaded.game.loadSaveText(JSON.stringify(old));
  const now = JSON.parse(loaded.game.createSaveText()), changed = now.areas.stage10;
  assert.deepEqual(changed.damage, area.damage); assert.deepEqual(changed.pickups, area.pickups);
  for (const field of ['tiles', 'originalTiles']) {
    const expected = area[field].slice(); expected[7 * width + 29] = fresh.game.STAIRS_DOWN;
    assert.deepEqual(changed[field], expected);
  }
  loaded.elements.resume.click(); loaded.game.enterLevel('stage10');
  assert.equal(loaded.game.level.damage.size, 0, 'normal re-entry still restores cracks');
  assert.equal(loaded.game.pickups[0].count, 4, 'the saved drop remains safe');
});

test('v6 phase-one and phase-three fights retain their warning and health percentage', () => {
  const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-caverns-warden-v6.json'), 'utf8'));
  for (const [phase, hp, action] of [[1, 1600, 'chargeWarning'], [3, 500, 'beamWarning']]) {
    const old = structuredClone(original);
    Object.assign(old.warden, { phase, hp, action, timer: 0.6, hit: false });
    const loaded = createGame({ autoStart: false }); loaded.game.loadSaveText(JSON.stringify(old));
    const boss = loaded.game.warden;
    assert.equal(boss.hp, hp * 2); assert.equal(boss.phase, phase); assert.equal(boss.action, action);
    assert.equal(boss.timer, 0.6); assert.equal(boss.spikeCooldown, 0);
    loaded.elements.resume.click(); loaded.step(1);
    assert.equal(loaded.game.warden.action, action);
  }
});

test('malformed Purple Slime and Crabock variants are rejected without replacing a run', () => {
  const { game: g } = createGame(); g.enterLevel('stage11'); suppressNewEnemySpawns(g.level);
  g.slimes.push(g.makeSlime(g.player.x + 50, g.player.y, false, false, false, true));
  g.spiders.push(g.makeSpider(g.player.x + 75, g.player.y, true));
  const before = comparableSave(g), cases = [];
  function invalid(change) { const data = structuredClone(before); change(data); cases.push(data); }
  invalid((s) => { s.enemies.slimes[0].purple = 'true'; });
  invalid((s) => { s.enemies.slimes[0].large = true; });
  invalid((s) => { s.enemies.slimes[0].hp = 91; });
  invalid((s) => { s.enemies.spiders[0].crabock = 'true'; });
  invalid((s) => { s.enemies.spiders[0].hp = 91; });
  invalid((s) => { delete s.state.stats.crabocksSlain; });
  for (const bad of cases) {
    bad.savedAt = new Date().toISOString(); assert.throws(() => g.loadSaveText(JSON.stringify(bad)));
    assert.deepEqual(comparableSave(g), before);
  }
});

// Stage 13: Ancient Mine, Mercury's poison edge, and current saves.
function ancientMineArena() {
  const run = createGame(), g = run.game;
  g.enterLevel('stage13'); suppressNewEnemySpawns(g.level);
  // A clear, predictable test arena away from either staircase.
  for (let y = 18; y <= 28; y++) for (let x = 5; x <= 32; x++) g.setTile(x, y, g.FLOOR);
  g.player.x = 12.5 * 32; g.player.y = 22.5 * 32;
  g.camera.x = g.player.x; g.camera.y = g.player.y;
  g.state.transitionLock = 999;
  return run;
}

function venomBite(run) {
  const g = run.game;
  const spider = g.makeSpider(g.player.x + 18, g.player.y, false, true);
  spider.speed = 0; g.spiders.push(spider); g.state.invuln = 0;
  run.step(1);
  assert.equal(g.state.poisonTime, 10);
  g.spiders.length = 0;
  return spider;
}

function setMove(run, code, down = true) {
  run.listeners[down ? 'keydown' : 'keyup'][0]({ code, target: { tagName: 'BODY' }, preventDefault: noop });
}

function hitWithSword(g, enemy, tier = 4, mercury = false) {
  aimSwordAt(g, enemy); g.state.tools.sword = tier; g.state.mercurySword = mercury;
  g.state.cooldown = 0; g.swing();
}

function approx(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be near ${expected}`);
}

test('Ancient Mine connects to the temple, has traversable mine galleries and a visited-floor lift', () => {
  const { game: g, elements, step } = createGame();
  g.enterLevel('stage12');
  const temple = g.level;
  assert.equal(temple.downTarget, 'stage13');
  assert.equal(temple.tiles[temple.stairsDown.ty * temple.w + temple.stairsDown.tx], g.STAIRS_DOWN);
  moveToStairs(g, step, temple.stairsDown);
  const mine = g.level;
  assert.equal(mine.id, 'stage13'); assert.equal(mine.name, 'Ancient Mine');
  assert.equal(elements['area-kicker'].textContent, 'Stage 13');
  assert.equal(elements['area-subtitle'].textContent, 'The ancient people appeared to be miners, but something stopped them');
  assert.equal(mine.upTarget, 'stage12'); assert.equal(mine.downTarget, null);
  assert.equal(mine.elevators.length, 1);
  const accessible = reachableForRadius(g, mine, g.BALANCE.golemRadius);
  for (const point of ['8,10', '40,10', '44,31', '70,35', '15,42', '30,42']) {
    assert.ok(accessible.has(point), `Ancient Golems can navigate to ${point}`);
  }
  assert.ok(accessible.has(`${mine.elevators[0].tx},${mine.elevators[0].ty}`));
  for (const t of [g.GOLD, g.DIAMOND, g.MOSSY_STONE, g.IRON, g.BASALT]) assert.ok(mine.tiles.includes(t));
  assert.ok(mine.decor.some((d) => d.kind === 'mineRail'));
  assert.ok(mine.decor.some((d) => d.kind === 'mineSupport'));
  moveToStairs(g, step, mine.stairsUp);
  assert.equal(g.level, temple);
  assert.equal(g.level.tiles[temple.stairsDown.ty * temple.w + temple.stairsDown.tx], g.STAIRS_DOWN);
});

test('Stage 13 naturally spawns all four requested variants and no disguised skeleton graves', () => {
  const { game: g, step } = createGame(); g.enterLevel('stage13');
  g.state.invuln = 999; g.state.transitionLock = 999;
  step(1100); // skeletons spawn every seven seconds, so allow time to reach their cap
  assert.equal(g.state.mode, 'playing');
  assert.equal(g.golems.length, g.BALANCE.maxGolems);
  assert.equal(g.prospectors.length, g.BALANCE.maxProspectors);
  assert.equal(g.spiders.length, g.BALANCE.maxSpiders);
  assert.equal(g.infectedSkeletons.length, g.BALANCE.maxInfectedSkeletons);
  assert.ok(g.golems.every((e) => e.ancient && e.maxHp === 490));
  assert.ok(g.prospectors.every((e) => e.skeleton && e.maxHp === 420));
  assert.ok(g.spiders.every((e) => e.venom && !e.crabock && e.maxHp === 315));
  assert.ok(g.infectedSkeletons.every((e) => e.kind === 'skeleton' && !e.hidden && e.graveIndex === -1 && e.maxHp === 315));
  assert.equal(g.slimes.length + g.moles.length + g.ghosts.length + g.graveDiggers.length, 0);
  assert.equal(g.level.graves.length, 0);
});

test('new enemies take exactly 14, 12, 9 and 9 unenhanced T4 sword hits', () => {
  const { game: g } = ancientMineArena();
  const cases = [
    ['Ancient Golem', g.golems, () => g.makeGolem(g.player.x + 40, g.player.y, false, 35, false, true), 14, 490],
    ['Skeleton Prospector', g.prospectors, () => g.makeProspector(g.player.x + 40, g.player.y, true), 12, 420],
    ['Venom Spider', g.spiders, () => g.makeSpider(g.player.x + 40, g.player.y, false, true), 9, 315],
    ['Skeleton', g.infectedSkeletons, () => g.makeInfectedSkeleton(g.player.x + 40, g.player.y, -1, true), 9, 315],
  ];
  for (const [name, list, create, hits, hp] of cases) {
    const enemy = create(); list.push(enemy); assert.equal(enemy.maxHp, hp, name);
    for (let i = 0; i < hits - 1; i++) hitWithSword(g, enemy, 4, false);
    assert.equal(enemy.hp, 35, `${name} survives until the last hit`);
    assert.equal(enemy.dead, false);
    hitWithSword(g, enemy, 4, false);
    assert.equal(enemy.dead, true, `${name} dies on hit ${hits}`);
    list.length = 0;
  }
  assert.equal(g.state.skeletonsSlain, 1);
});

test('Ancient Golems keep normal Golem damage and disable at twenty actual tiles, not ten', () => {
  const run = ancientMineArena(), g = run.game;
  const a = g.makeGolem(10.5 * 32, 22.5 * 32, false, 35, false, true);
  assert.equal(a.dmg, g.BALANCE.golemDamage); assert.equal(a.moveLimit, 20 * 32);
  assert.equal(g.makeGolem(a.x, a.y).moveLimit, 10 * 32);
  g.golems.push(a); g.player.x = a.x + 90; g.player.y = a.y; g.state.invuln = 999;
  a.moved = 10 * 32 - 0.1; run.step(1);
  assert.equal(a.disabled, 0); assert.ok(a.moved > 10 * 32);
  a.moved = 20 * 32 - 1; run.step(1);
  assert.equal(a.disabled, 3); assert.equal(a.moved, 0);
  const x = a.x, y = a.y; run.step(20);
  assert.equal(a.x, x); assert.equal(a.y, y); assert.equal(g.state.hp, 100);
});

test('Skeleton Prospectors mine Gold and move faster than ordinary Prospectors', () => {
  const run = ancientMineArena(), g = run.game;
  const ordinary = g.makeProspector(0, 0), miner = g.makeProspector(10.5 * 32, 22.5 * 32, true);
  assert.ok(miner.speed > ordinary.speed); assert.equal(miner.maxHp, 420);
  g.player.x = 30.5 * 32; g.player.y = 26.5 * 32;
  g.setTile(12, 22, g.GOLD); g.prospectors.push(miner);
  run.step(100);
  assert.equal(g.getTile(12, 22), g.FLOOR);
  assert.equal(miner.haul.gold, 1);
});

test('Skeleton Prospector bombs have a two-tile radius, heavier damage and the eight-second cooldown', () => {
  for (const [ring, hp] of [[0, 0], [1, 10], [2, 25], [3, 100], [4, 100]]) {
    const run = ancientMineArena(), g = run.game;
    const miner = g.makeProspector(g.player.x - 3 * 32, g.player.y, true);
    miner.speed = 0; g.prospectors.push(miner); g.addItem('gold', 1);
    g.state.invuln = 999; run.step(1);
    assert.equal(g.dynamites.length, 1); assert.equal(g.dynamites[0].skeleton, true);
    assert.equal(miner.throwCd, 8);
    const bomb = g.dynamites[0]; miner.dead = true;
    g.player.x = bomb.targetX + ring * 32; g.player.y = bomb.targetY;
    run.step(48);
    assert.equal(g.state.hp, hp, `blast ring ${ring}`);
    if (ring === 0) assert.equal(g.state.mode, 'dead');
  }
});

test('normal Skeletons keep their distance, weave in both directions and throw bones without hiding', () => {
  const run = ancientMineArena(), g = run.game;
  const skeleton = g.makeInfectedSkeleton(g.player.x + 70, g.player.y, -1, true);
  g.infectedSkeletons.push(skeleton); g.state.invuln = 999;
  assert.equal(skeleton.kind, 'skeleton'); assert.equal(skeleton.hidden, false);
  assert.equal(skeleton.graveIndex, -1); assert.equal(skeleton.maxHp, 315);
  const start = { x: skeleton.x, y: skeleton.y };
  run.math.random = () => 0; // force leftward strafe
  run.step(1); assert.equal(g.boneProjectiles.length, 1); assert.equal(skeleton.strafeSign, -1);
  assert.notEqual(skeleton.y, start.y, 'it sidesteps instead of only retreating');
  assert.ok(Math.hypot(skeleton.x - g.player.x, skeleton.y - g.player.y) > 70, 'it creates distance');
  skeleton.strafeTimer = 0; run.math.random = () => 0.99;
  run.step(1); assert.equal(skeleton.strafeSign, 1);
  assert.equal(skeleton.hidden, false);
});

test('Venom Spider poison requires a successful bite and displays its ten-second status', () => {
  const run = ancientMineArena(), g = run.game;
  const spider = g.makeSpider(g.player.x + 18, g.player.y, false, true);
  spider.speed = 0; g.spiders.push(spider);
  g.state.invuln = 1; run.step(1);
  assert.equal(g.state.hp, 100); assert.equal(g.state.poisonTime, 0);
  assert.ok(run.elements['poison-status'].classList.contains('is-hidden'));
  g.state.invuln = 0; spider.attackCd = 0; run.step(1);
  assert.equal(g.state.hp, 95); assert.equal(g.state.poisonTime, 10);
  assert.equal(run.elements['poison-status'].classList.contains('is-hidden'), false);
  assert.match(run.elements['poison-status'].textContent, /POISONED.*10s/);
  g.spiders.length = 0; run.step(201);
  assert.equal(g.state.poisonTime, 0); assert.equal(g.state.poisonDistance, 0);
  assert.ok(run.elements['poison-status'].classList.contains('is-hidden'));
});

test('player poison uses actual voluntary distance, ignores invulnerability and excludes walls and knockback', () => {
  const run = ancientMineArena(), g = run.game;
  venomBite(run); g.state.invuln = 999;
  const x0 = g.player.x;
  setMove(run, 'KeyD'); run.step(4); setMove(run, 'KeyD', false);
  approx(g.player.x - x0, 34); assert.equal(g.state.hp, 90); approx(g.state.poisonDistance, 2);
  // Walking against a solid tile does not accrue distance or extra damage.
  const wallX = Math.floor((g.player.x + 20) / 32), wallY = Math.floor(g.player.y / 32);
  g.setTile(wallX, wallY, g.WALL);
  const before = { x: g.player.x, hp: g.state.hp, partial: g.state.poisonDistance };
  setMove(run, 'KeyD'); run.step(12); setMove(run, 'KeyD', false);
  assert.equal(g.player.x, before.x); assert.equal(g.state.hp, before.hp); approx(g.state.poisonDistance, before.partial);
  g.setTile(wallX, wallY, g.FLOOR);
  // An ordinary bite pushes the player, but that involuntary step is not charged.
  const spider = g.makeSpider(g.player.x + 18, g.player.y); spider.speed = 0;
  g.spiders.push(spider); g.state.invuln = 0; const oldX = g.player.x;
  run.step(1); assert.ok(g.player.x < oldX); assert.equal(g.state.hp, before.hp - 5);
  approx(g.state.poisonDistance, before.partial);
  g.spiders.length = 0; g.state.invuln = 999;
  setMove(run, 'KeyA'); run.step(4); setMove(run, 'KeyA', false);
  assert.equal(g.state.hp, before.hp - 10); approx(g.state.poisonDistance, 4);
});

test('diagonal movement counts Euclidean distance; standing still, pausing and knockback do not', () => {
  const run = ancientMineArena(), g = run.game;
  venomBite(run); g.state.invuln = 999;
  const start = { x: g.player.x, y: g.player.y };
  setMove(run, 'KeyD'); setMove(run, 'KeyS'); run.step(4);
  setMove(run, 'KeyD', false); setMove(run, 'KeyS', false);
  approx(Math.hypot(g.player.x - start.x, g.player.y - start.y), 34);
  assert.equal(g.state.hp, 90); approx(g.state.poisonDistance, 2);
  const remaining = g.state.poisonTime;
  run.elements['pause-btn'].click(); run.step(60);
  assert.equal(g.state.poisonTime, remaining); approx(g.state.poisonDistance, 2);
  run.elements.resume.click(); run.step(10);
  assert.equal(g.state.hp, 90); approx(g.state.poisonDistance, 2);
});

test('Mercury sword poison ticks 5% max HP each second for four to eight seconds and re-hits preserve progress', () => {
  const run = ancientMineArena(), g = run.game;
  const skeleton = g.makeInfectedSkeleton(g.player.x + 50, g.player.y, -1, true);
  skeleton.speed = 0; skeleton.throwCooldown = 99; g.infectedSkeletons.push(skeleton);
  g.state.invuln = 999; run.math.random = () => 0;
  hitWithSword(g, skeleton, 4, true);
  assert.equal(g.tierDamage(), 35); assert.equal(skeleton.hp, 280); assert.equal(skeleton.poisonTime, 4);
  run.step(10); approx(skeleton.poisonProgress, 0.5); assert.equal(skeleton.hp, 280);
  hitWithSword(g, skeleton, 4, true);
  assert.equal(skeleton.hp, 245); approx(skeleton.poisonProgress, 0.5); assert.equal(skeleton.poisonTime, 4);
  run.step(10); approx(skeleton.hp, 245 - 315 * 0.05); approx(skeleton.poisonProgress, 0);
  run.step(70); approx(skeleton.hp, 245 - 4 * 315 * 0.05);
  assert.equal(skeleton.poisonTime, 0); assert.equal(skeleton.poisonProgress, 0);
  const hp = skeleton.hp; run.step(25); assert.equal(skeleton.hp, hp);
  run.math.random = () => 0.999999; hitWithSword(g, skeleton, 4, true);
  assert.equal(skeleton.poisonTime, 8);
});

test('Ghosts and Venom Spiders take ordinary sword damage but are immune to Mercury poison', () => {
  const run = ancientMineArena(), g = run.game;
  const venom = g.makeSpider(g.player.x + 40, g.player.y, false, true); venom.speed = 0;
  g.spiders.push(venom); hitWithSword(g, venom, 4, true);
  assert.equal(venom.hp, 280); assert.equal(venom.poisonTime, 0);
  g.spiders.length = 0; g.enterLevel('stage8'); suppressNewEnemySpawns(g.level);
  const ghost = g.makeGhost(g.player.x + 40, g.player.y); g.ghosts.push(ghost);
  hitWithSword(g, ghost, 4, true); assert.equal(ghost.hp, 140); assert.equal(ghost.poisonTime, 0);
  g.state.invuln = 999; run.step(25); assert.equal(ghost.hp, 140);
});

test('Mercury poison applies to each ordinary enemy family, including both Skeleton variants', () => {
  const run = ancientMineArena(), g = run.game;
  const x = g.player.x + 40, y = g.player.y;
  const enemies = [
    [g.slimes, g.makeSlime(x, y, false)], [g.moles, g.makeMole(x, y)],
    [g.spiders, g.makeSpider(x, y)], [g.spiders, g.makeSpider(x, y, true)],
    [g.golems, g.makeGolem(x, y, false, 10, false, true)],
    [g.prospectors, g.makeProspector(x, y, true)], [g.graveDiggers, g.makeGraveDigger(x, y, 0)],
    [g.infectedSkeletons, g.makeInfectedSkeleton(x, y, 0)],
    [g.infectedSkeletons, g.makeInfectedSkeleton(x, y, -1, true)],
  ];
  for (const [list, enemy] of enemies) {
    enemy.speed = 0; if (enemy.kind === 'infectedSkeleton') enemy.hidden = false;
    if (enemy.kind === 'infectedSkeleton' || enemy.kind === 'skeleton') enemy.throwCooldown = 99;
    list.push(enemy);
  }
  g.state.invuln = 999; run.math.random = () => 0;
  hitWithSword(g, enemies[0][1], 1, true); // one sweep reaches every enemy
  for (const [, e] of enemies) {
    assert.equal(e.hp, e.maxHp - 10, `${e.kind || 'slime'} direct damage`);
    assert.equal(e.poisonTime, 4, `${e.kind || 'slime'} gets poisoned`);
  }
  run.step(20);
  for (const [, e] of enemies) approx(e.hp, e.maxHp - 10 - e.maxHp * 0.05);
});

test('poison slows ordinary enemies to 75% of their normal actual movement speed', () => {
  const types = [
    ['stage1', 'slimes', (g, x, y) => g.makeSlime(x, y, false)],
    ['stage2', 'moles', (g, x, y) => g.makeMole(x, y)],
    ['stage12', 'spiders', (g, x, y) => g.makeSpider(x, y)],
    ['stage11', 'spiders', (g, x, y) => g.makeSpider(x, y, true)],
    ['stage5', 'golems', (g, x, y) => g.makeGolem(x, y)],
    ['stage13', 'golems', (g, x, y) => g.makeGolem(x, y, false, 10, false, true)],
    ['stage3', 'prospectors', (g, x, y) => g.makeProspector(x, y)],
    ['stage13', 'prospectors', (g, x, y) => g.makeProspector(x, y, true)],
    ['stage8', 'graveDiggers', (g, x, y) => g.makeGraveDigger(x, y, 0)],
    ['stage13', 'infectedSkeletons', (g, x, y) => g.makeInfectedSkeleton(x, y, -1, true)],
    ['stage9', 'infectedSkeletons', (g, x, y) => { const s = g.makeInfectedSkeleton(x, y, 0); s.hidden = false; return s; }],
  ];
  for (const [area, list, make] of types) {
    const run = createGame(), g = run.game; g.enterLevel(area); suppressNewEnemySpawns(g.level);
    for (let ty = 18; ty <= 27; ty++) for (let tx = 6; tx <= 28; tx++) g.setTile(tx, ty, g.FLOOR);
    const x = 10.5 * 32, y = 22.5 * 32;
    g.player.x = 24.5 * 32; g.player.y = y; g.state.transitionLock = 999;
    const a = make(g, x, y), b = make(g, x, y + 3 * 32);
    for (const e of [a, b]) {
      e.wanderAngle = 0; e.wanderTimer = 20; e.scanTimer = 20;
      e.knockX = e.knockY = 0; e.throwCooldown = 20;
      if (e.kind === 'graveDigger') { e.graveIndex = 0; g.level.graves[0].x = x; g.level.graves[0].y = y; }
    }
    // Infected skeletons only move while the player is in sight. Keep both at
    // the same distance and standoff angle in separate otherwise-identical frames.
    if (area === 'stage9') {
      g.player.x = x + 70; g.player.y = y; a.strafeTimer = b.strafeTimer = 2;
      b.x = x; b.y = y;
    }
    if (area === 'stage8') { b.x = x; b.y = y; }
    b.poisonTime = 4; b.poisonProgress = 0;
    g[list].push(a, b); run.step(1);
    const regular = Math.hypot(a.x - x, a.y - y);
    const slow = Math.hypot(b.x - x, b.y - (area === 'stage8' || area === 'stage9' ? y : y + 3 * 32));
    assert.ok(regular > 0, `${area} ${list} must actually move`);
    approx(slow / regular, 0.75, 1e-5);
  }
});

test('Mercury poison affects shrine guardian and Warden, including their ordinary defeat rewards', () => {
  {
    const run = shrineArena(), g = run.game;
    assert.equal(g.useGolemShrine(), true);
    const guardian = g.golems.find((e) => e.shrine); guardian.hp = 36;
    g.player.x = guardian.x - 55; g.player.y = guardian.y; g.state.invuln = 999;
    run.math.random = () => 0; hitWithSword(g, guardian, 4, true);
    assert.equal(guardian.hp, 1); assert.equal(guardian.poisonTime, 4);
    run.step(20); assert.equal(guardian.dead, true);
    assert.ok(g.level.shrineCooldown > 19);
    assert.equal(g.pickups.filter((p) => p.item === 'diamond').reduce((n, p) => n + p.count, 0), 2);
    assert.equal(g.pickups.filter((p) => p.item === 'stone').reduce((n, p) => n + p.count, 0), 5);
  }
  {
    const run = wardenArena(), g = run.game, boss = g.warden;
    boss.hp = 150; g.state.invuln = 999; run.math.random = () => 0;
    hitWithSword(g, boss, 4, true);
    assert.equal(boss.hp, 115); assert.equal(boss.poisonTime, 4); assert.equal(boss.phase, 3);
    run.step(20); assert.equal(g.warden, null); assert.equal(g.state.wardenDefeated, true);
    assert.equal(run.elements['void-power'].classList.contains('is-hidden'), false);
  }
});

test('a poisoned Warden walks and charges at 75% speed', () => {
  const run = wardenArena(), g = run.game, boss = g.warden;
  g.state.invuln = 999; g.player.x = boss.x + 150; g.player.y = boss.y;
  const x = boss.x, y = boss.y;
  boss.action = 'approach'; boss.timer = 2; boss.poisonTime = 0; run.step(1);
  const walk = boss.x - x;
  boss.x = x; boss.y = y; boss.action = 'approach'; boss.timer = 2; boss.poisonTime = 4; boss.poisonProgress = 0;
  run.step(1); approx((boss.x - x) / walk, 0.75);
  boss.x = x; boss.y = y; boss.action = 'charge'; boss.angle = 0; boss.travel = 0;
  boss.originX = x; boss.originY = y; boss.poisonTime = 0; boss.poisonProgress = 0; run.step(1);
  const charge = boss.x - x;
  boss.x = x; boss.y = y; boss.action = 'charge'; boss.angle = 0; boss.travel = 0;
  boss.originX = x; boss.originY = y; boss.poisonTime = 4; boss.poisonProgress = 0; run.step(1);
  approx((boss.x - x) / charge, 0.75);
});

test('player poison refreshes on another successful venom bite, expires mid-step and can cause death', () => {
  const run = ancientMineArena(), g = run.game;
  const spider = venomBite(run);
  g.state.poisonDistance = 20; g.state.poisonTime = 2;
  spider.x = g.player.x + 18; spider.y = g.player.y; spider.attackCd = 0;
  g.spiders.push(spider); g.state.invuln = 0; run.step(1);
  assert.equal(g.state.poisonTime, 10); approx(g.state.poisonDistance, 20);
  g.spiders.length = 0; g.state.invuln = 999;
  g.state.poisonTime = 0.1;
  const x = g.player.x, before = g.state.hp;
  setMove(run, 'KeyD'); run.step(4); setMove(run, 'KeyD', false);
  approx(g.player.x - x, 34); assert.equal(g.state.hp, before - 5);
  assert.equal(g.state.poisonTime, 0); assert.equal(g.state.poisonDistance, 0);
  g.state.hp = 5; g.state.poisonTime = 5; g.state.poisonDistance = 31;
  setMove(run, 'KeyD'); run.step(1); setMove(run, 'KeyD', false);
  assert.equal(g.state.mode, 'dead');
  g.respawnAtBase(); assert.equal(g.state.hp, 100);
  assert.equal(g.state.poisonTime, 0); assert.equal(g.state.poisonDistance, 0);
  assert.ok(run.elements['poison-status'].classList.contains('is-hidden'));
});

test('current saves resume active poison, new enemy variants, partial counters and both projectile types', () => {
  const run = ancientMineArena(), g = run.game;
  g.addItem('gold', 1); g.state.tools.sword = 4; g.state.mercurySword = true;
  const miner = g.makeProspector(g.player.x - 3 * 32, g.player.y, true);
  miner.speed = 0; miner.haul.gold = 4; g.prospectors.push(miner);
  const skeleton = g.makeInfectedSkeleton(g.player.x + 70, g.player.y, -1, true);
  skeleton.speed = 0; g.infectedSkeletons.push(skeleton);
  const venom = g.makeSpider(g.player.x + 220, g.player.y, false, true); venom.speed = 0; g.spiders.push(venom);
  const golem = g.makeGolem(g.player.x + 250, g.player.y, false, 35, false, true);
  golem.disabled = 2; golem.moved = 15 * 32; g.golems.push(golem);
  g.state.invuln = 999; run.step(1);
  assert.equal(g.dynamites[0].skeleton, true); assert.equal(g.boneProjectiles.length, 1);
  miner.poisonTime = 6.25; miner.poisonProgress = 0.4;
  skeleton.poisonTime = 4.3; skeleton.poisonProgress = 0.65;
  golem.poisonTime = 5; golem.poisonProgress = 0.5;
  g.state.poisonTime = 7.2; g.state.poisonDistance = 19.5;
  const text = g.createSaveText(), before = comparableSave(g);
  const next = createGame({ autoStart: false }); next.game.loadSaveText(text);
  assert.equal(next.game.state.mode, 'paused');
  assert.deepEqual(comparableSave(next.game), before);
  assert.equal(next.game.level.id, 'stage13');
  assert.equal(next.game.prospectors[0].skeleton, true); assert.equal(next.game.prospectors[0].haul.gold, 4);
  assert.equal(next.game.golems[0].ancient, true); assert.equal(next.game.golems[0].moved, 15 * 32);
  assert.equal(next.game.infectedSkeletons[0].kind, 'skeleton');
  assert.equal(next.game.spiders[0].venom, true);
  assert.equal(next.game.dynamites[0].skeleton, true); assert.equal(next.game.boneProjectiles.length, 1);
  assert.match(next.elements['poison-status'].textContent, /POISONED.*8s/);
  next.elements.resume.click(); next.step(8); // the first post-load frame establishes the clock
  approx(next.game.infectedSkeletons[0].hp, 315 - 315 * 0.05);
  assert.ok(next.game.state.poisonTime < 7.2);
});

test('inactive poisoned Skeleton Prospectors retain their haul and timers across travel and saves', () => {
  const run = ancientMineArena(), g = run.game;
  const p = g.makeProspector(g.player.x + 50, g.player.y, true);
  p.haul.gold = 7; p.hp = 320; p.poisonTime = 6; p.poisonProgress = 0.6;
  g.prospectors.push(p); g.enterLevel('home');
  run.step(40);
  assert.equal(p.poisonTime, 6); assert.equal(p.poisonProgress, 0.6); assert.equal(p.hp, 320);
  const text = g.createSaveText(), next = createGame({ autoStart: false }); next.game.loadSaveText(text);
  const saved = next.game.levels.stage13.prospectors[0];
  assert.equal(saved.skeleton, true); assert.equal(saved.haul.gold, 7);
  assert.equal(saved.hp, 320); assert.equal(saved.poisonTime, 6); assert.equal(saved.poisonProgress, 0.6);
  next.elements.resume.click(); next.game.enterLevel('stage13'); suppressNewEnemySpawns(next.game.level);
  next.game.state.invuln = 999; next.step(9);
  approx(saved.hp, 320 - 420 * 0.05);
});

test('Warden poison and its fractional tick survive a mid-attack save', () => {
  const run = wardenArena(), g = run.game, b = g.warden;
  g.state.invuln = 999; run.math.random = () => 0; hitWithSword(g, b, 4, true);
  b.action = 'chargeWarning'; b.timer = 0.8; b.originX = b.x; b.originY = b.y; b.angle = 0;
  run.step(10); const text = g.createSaveText(), expected = comparableSave(g);
  const next = createGame({ autoStart: false }); next.game.loadSaveText(text);
  assert.deepEqual(comparableSave(next.game), expected);
  assert.equal(next.game.warden.action, 'chargeWarning'); approx(next.game.warden.poisonProgress, 0.5);
  next.elements.resume.click(); next.step(11);
  assert.equal(next.game.warden.hp, 3500 - 35 - 175);
});

test('genuine version-7 Temple saves keep every tile and legacy Mercury guardian armour when migrated and resaved', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-ancient-temple-v7.json'), 'utf8');
  const old = JSON.parse(text), run = createGame({ autoStart: false }), g = run.game;
  g.loadSaveText(text);
  assert.equal(g.level.id, 'stage12'); assert.equal(g.level.downTarget, 'stage13');
  assert.equal(g.state.hp, 72); assert.equal(g.state.healDelay, 2);
  assert.equal(g.state.mercurySword, true); assert.equal(g.state.elevatorUnlocked, true);
  assert.equal(g.state.poisonTime, 0); assert.equal(g.state.poisonDistance, 0);
  assert.equal(g.state.skeletonsSlain, 0); assert.equal(g.level.damage.get('9,1'), 2);
  assert.equal(g.level.shrineActivated, true); assert.equal(g.level.shrineCooldown, 0);
  assert.equal(g.prospectors[0].hp, 65); assert.equal(g.prospectors[0].haul.gold, 3);
  assert.equal(g.prospectors[0].skeleton, false); assert.equal(g.prospectors[0].poisonTime, 0);
  assert.ok(g.pickups.some((p) => p.item === 'diamond' && p.count === 2));
  const exit = g.level.stairsDown.ty * g.level.w + g.level.stairsDown.tx;
  for (const key of ['tiles', 'originalTiles']) {
    const expected = old.areas.stage12[key].slice(); expected[exit] = g.STAIRS_DOWN;
    assert.deepEqual(Array.from(g.level[key]), expected, `${key} preserved except the new staircase`);
  }
  const guardian = g.golems[0];
  assert.equal(guardian.shrine, true); assert.equal(guardian.maxHp, 841.5);
  assert.equal(guardian.hp, 736.5); assert.equal(guardian.poisonTime, 0);
  const v9 = g.createSaveText(); assert.equal(JSON.parse(v9).version, 9);
  const restored = createGame({ autoStart: false }); restored.game.loadSaveText(v9);
  assert.equal(restored.game.golems[0].maxHp, 841.5);
  assert.equal(restored.game.golems[0].hp, 736.5);
  restored.elements.resume.click();
  const liveGuardian = restored.game.golems[0];
  restored.game.player.x = liveGuardian.x - 50; restored.game.player.y = liveGuardian.y;
  hitWithSword(restored.game, liveGuardian, 4, true);
  assert.equal(liveGuardian.hp, 736.5 - 35, 'old Mercury purchase uses base sword damage now');
  assert.ok(liveGuardian.poisonTime >= 4 && liveGuardian.poisonTime <= 8);
});

test('genuine version-7 Amethyst saves preserve old enemy state and Mercury grants poison automatically', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'pre-ancient-cavern-v7.json'), 'utf8');
  const old = JSON.parse(text), run = createGame({ autoStart: false }), g = run.game;
  g.loadSaveText(text); assert.equal(g.level.id, 'stage11');
  assert.equal(g.state.mercurySword, true); assert.equal(g.tierDamage(), 30);
  assert.equal(g.slimes[0].purple, true); assert.equal(g.slimes[0].hp, 47);
  assert.equal(g.spiders[0].crabock, true); assert.equal(g.spiders[0].hp, 62);
  assert.deepEqual(Array.from(g.level.tiles), old.areas.stage11.tiles);
  assert.deepEqual(Array.from(g.level.originalTiles), old.areas.stage11.originalTiles);
  const v9 = g.createSaveText(), loaded = createGame({ autoStart: false }); loaded.game.loadSaveText(v9);
  loaded.elements.resume.click();
  const crabock = loaded.game.spiders[0]; loaded.game.player.x = crabock.x - 40; loaded.game.player.y = crabock.y;
  hitWithSword(loaded.game, crabock, 3, true);
  assert.equal(crabock.hp, 32); assert.ok(crabock.poisonTime >= 4 && crabock.poisonTime <= 8);
});

test('Skeleton bomb flight and explosion appearance remain the small-radius variant across reload', () => {
  const run = ancientMineArena(), g = run.game;
  g.addItem('gold', 1); const miner = g.makeProspector(g.player.x - 3 * 32, g.player.y, true);
  miner.speed = 0; g.prospectors.push(miner); g.state.invuln = 999; run.step(1);
  const bomb = g.dynamites[0]; miner.dead = true;
  g.player.x = bomb.targetX + 3 * 32;
  const inFlight = g.createSaveText();
  const next = createGame({ autoStart: false }); next.game.loadSaveText(inFlight);
  assert.equal(next.game.dynamites[0].skeleton, true);
  next.elements.resume.click(); next.step(49);
  assert.equal(next.game.state.hp, 100, 'three tiles away is outside the smaller blast');
  assert.equal(next.game.level.explosions[0].skeleton, true);
  const burst = next.game.createSaveText();
  const last = createGame({ autoStart: false }); last.game.loadSaveText(burst);
  assert.equal(last.game.level.explosions[0].skeleton, true);
});

test('malformed current poison, variants and projectiles are rejected transactionally', () => {
  const run = ancientMineArena(), g = run.game;
  const venom = g.makeSpider(g.player.x + 40, g.player.y, false, true); g.spiders.push(venom);
  const golem = g.makeGolem(g.player.x + 80, g.player.y, false, 35, false, true); g.golems.push(golem);
  const skeleton = g.makeInfectedSkeleton(g.player.x + 100, g.player.y, -1, true); g.infectedSkeletons.push(skeleton);
  const miner = g.makeProspector(g.player.x - 70, g.player.y, true); g.prospectors.push(miner);
  g.dynamites.push({ fromX: miner.x, fromY: miner.y, x: miner.x, y: miner.y,
    targetX: g.player.x, targetY: g.player.y, age: 0, skeleton: true });
  const original = JSON.parse(g.createSaveText()), baseline = comparableSave(g);
  const cases = [
    (s) => { s.state.poisonTime = -1; },
    (s) => { s.state.poisonTime = 11; },
    (s) => { s.state.poisonTime = 0; s.state.poisonDistance = 5; },
    (s) => { s.state.poisonTime = 4; s.state.poisonDistance = 32; },
    (s) => { delete s.state.poisonDistance; },
    (s) => { s.enemies.spiders[0].poisonTime = 2; },
    (s) => { s.enemies.golems[0].poisonProgress = 1; },
    (s) => { s.enemies.golems[0].poisonTime = 0; s.enemies.golems[0].poisonProgress = 0.5; },
    (s) => { s.enemies.golems[0].moved = 20 * 32 + 1; },
    (s) => { s.enemies.golems[0].maxHp = 491; },
    (s) => { s.enemies.golems[0].mercury = true; },
    (s) => { s.enemies.infectedSkeletons[0].hidden = true; },
    (s) => { s.enemies.infectedSkeletons[0].graveIndex = 0; },
    (s) => { s.areas.stage13.prospectors[0].skeleton = 'yes'; },
    (s) => { delete s.areas.stage13.dynamites[0].skeleton; },
    (s) => { s.version = 7; },
  ];
  for (const mutate of cases) {
    const invalid = structuredClone(original); mutate(invalid);
    assert.throws(() => g.loadSaveText(JSON.stringify(invalid)));
    assert.deepEqual(comparableSave(g), baseline, 'a rejected import does not modify the running game');
  }
});

test('left click and Space remain usable when an enemy overlaps the player', () => {
  const run = ancientMineArena(), g = run.game;
  const enemy = g.makeInfectedSkeleton(g.player.x - 3, g.player.y, -1, true);
  g.infectedSkeletons.push(enemy); g.state.tools.sword = 4; g.selectTool('sword');
  g.camera.x = g.player.x; g.camera.y = g.player.y; g.player.faceX = 1; g.player.faceY = 0;
  run.elements.game.dispatch('pointerdown', { clientX: 637, clientY: 400, pointerType: 'mouse' });
  assert.equal(enemy.hp, 280, 'a close mouse click aims at the overlap');
  g.state.cooldown = 0; g.pointer.inside = false;
  run.listeners.keydown[0]({ code: 'Space', target: { tagName: 'BODY' }, preventDefault: noop });
  assert.equal(enemy.hp, 245, 'Space still strikes an overlapping enemy');
});

// Floor 13's corrected resources, Basalt, and genuine version-8 migrations.
test('Ancient Mine seeds exactly the five requested resources even with extreme random seeds', () => {
  const { game: g, math } = createGame();
  const expected = [g.GOLD, g.DIAMOND, g.MOSSY_STONE, g.IRON, g.BASALT].sort((a, b) => a - b);
  for (const [random, dominant] of [[0.01, g.GOLD], [0.32, g.DIAMOND], [0.50, g.IRON],
    [0.65, g.MOSSY_STONE], [0.95, g.BASALT]]) {
    math.random = () => random;
    const mine = g.buildStage13();
    const resources = [...new Set([...mine.tiles].filter((t) => g.TILES[t].hits > 0))].sort((a, b) => a - b);
    assert.deepEqual(resources, expected, `resources at random value ${random}`);
    assert.ok([...mine.tiles].filter((t) => t === dominant).length > 100, 'the intended random band dominates');
    assert.deepEqual(Array.from(mine.originalTiles), Array.from(mine.tiles));
    const accessible = reachableWalkableTiles(g, mine);
    for (const ore of expected) {
      let reachable = false;
      for (let i = 0; i < mine.tiles.length && !reachable; i++) {
        if (mine.tiles[i] !== ore) continue;
        const x = i % mine.w, y = Math.floor(i / mine.w);
        reachable = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .some(([dx, dy]) => accessible.has(`${x + dx},${y + dy}`));
      }
      assert.ok(reachable, `resource ${g.TILES[ore].drop} has a reachable vein at random value ${random}`);
    }
  }
});

test('Basalt is distinct from Stone, breaks in one hit at every tier, and drops one or two collectible pieces', () => {
  const run = ancientMineArena(), g = run.game;
  assert.equal(g.ITEMS.basalt.name, 'Basalt');
  assert.notEqual(g.TILES[g.BASALT].base, g.TILES[g.STONE].base);
  assert.equal(g.TILES[g.BASALT].solid, true);
  assert.equal(g.TILES[g.BASALT].drop, 'basalt');
  for (const tier of [1, 2, 3, 4]) {
    g.state.tools.pickaxe = tier;
    assert.equal(g.pickaxeHits(g.TILES[g.BASALT]), 1);
    for (const [random, amount] of [[0, 1], [0.999, 2]]) {
      run.math.random = () => random;
      mine(g, g.BASALT);
      assert.equal(g.getTile(6, 5), g.FLOOR);
      const drop = g.pickups[g.pickups.length - 1];
      assert.equal(drop.item, 'basalt'); assert.equal(drop.count, amount);
      assert.equal(drop.source, 'mining');
    }
  }
  run.math.random = () => 0.5;
  run.step(30);
  assert.equal(g.pickups.length, 0);
  assert.equal(g.countItem('basalt'), 12);
  assert.equal(g.state.oreHauled, 12);
  assert.equal(g.countItem('stone'), 0, 'Basalt and ordinary Stone stay separate in the bag');
  mine(g, g.MOSSY_STONE); run.step(30);
  assert.equal(g.countItem('stone'), 2, 'Mossy Stone still produces ordinary Stone');
  assert.equal(g.countItem('basalt'), 12);
});

test('Basalt is stored and survives death like Stone, but has no crafting, melter or trade recipe', () => {
  const { game: g, elements } = createGame();
  assert.equal(Object.keys(g.ITEMS).at(-1), 'basalt', 'existing Storage row ordering stays unchanged');
  g.addItem('basalt', 9); g.openStation('storage');
  const row = storageRow(elements, Object.keys(g.ITEMS).indexOf('basalt'));
  assert.equal(row.bag.textContent, '9'); assert.equal(row.stored.textContent, '0');
  for (let i = 0; i < 4; i++) row.store.click();
  assert.equal(g.storage.basalt, 4); assert.equal(g.countItem('basalt'), 5);
  assert.equal(row.bag.textContent, '5'); assert.equal(row.stored.textContent, '4');
  assert.equal(g.selectMelterOre('basalt'), false);
  g.loadSlot('basalt');
  assert.equal(g.polishGem('basalt'), false); assert.equal(g.sellPolishedGem('basalt'), false);
  assert.equal(g.pressCoin('basalt'), false); assert.equal(g.tradeCoin('basalt'), false);
  assert.equal(g.countItem('basalt'), 5);
  g.closeStation(); g.respawnAtBase();
  assert.equal(g.countItem('basalt'), 3, 'death rounds half the bag contents up');
  assert.equal(g.storage.basalt, 4, 'stored Basalt is safe from death');
  g.openStation('storage'); row.take.click();
  assert.equal(g.storage.basalt, 3); assert.equal(g.countItem('basalt'), 4);
});

test('a full bag leaves Basalt on the ground, and it survives saves, travel and later collection once', () => {
  const run = ancientMineArena(), g = run.game;
  g.addItem('coal', 990); run.math.random = () => 0.999;
  mine(g, g.BASALT); run.step(25);
  assert.equal(g.countItem('basalt'), 0); assert.equal(g.pickups.length, 1);
  assert.equal(g.pickups[0].phase, 'ground'); assert.equal(g.pickups[0].count, 2);
  const next = createGame({ autoStart: false }); next.game.loadSaveText(g.createSaveText());
  const ng = next.game; next.elements.resume.click();
  assert.equal(ng.pickups[0].item, 'basalt'); assert.equal(ng.pickups[0].count, 2);
  ng.enterLevel('home'); ng.enterLevel('stage13'); suppressNewEnemySpawns(ng.level);
  assert.equal(ng.pickups.length, 1); assert.equal(ng.pickups[0].item, 'basalt');
  ng.removeItem('coal', 99);
  ng.player.x = ng.pickups[0].x; ng.player.y = ng.pickups[0].y;
  ng.state.invuln = 999; ng.state.transitionLock = 999; next.step(30);
  assert.equal(ng.countItem('basalt'), 2); assert.equal(ng.pickups.length, 0);
  assert.equal(ng.state.oreHauled, 2);
  next.step(30); assert.equal(ng.countItem('basalt'), 2, 'no duplicate pickup');
});

test('a Skeleton Prospector can clear Basalt blocking Gold and resume its route after a save', () => {
  const run = ancientMineArena(), g = run.game;
  g.player.x = 28.5 * 32; g.player.y = 27.5 * 32;
  const miner = g.makeProspector(10.5 * 32, 22.5 * 32, true); g.prospectors.push(miner);
  g.setTile(12, 22, g.GOLD);
  for (const [x, y] of [[11, 22], [12, 21], [13, 22], [12, 23]]) g.setTile(x, y, g.BASALT);
  run.step(1);
  assert.equal(miner.oreTarget.tile, g.BASALT);
  assert.equal(miner.oreTarget.tx, 11); assert.equal(miner.oreTarget.ty, 22);
  const next = createGame({ autoStart: false }); next.game.loadSaveText(g.createSaveText());
  assert.equal(next.game.prospectors[0].oreTarget.tile, g.BASALT);
  next.elements.resume.click(); next.game.state.invuln = 999; next.step(180);
  assert.equal(next.game.getTile(12, 22), next.game.FLOOR);
  assert.ok(next.game.prospectors[0].haul.gold >= 1, 'the miner collects the buried Gold');
  assert.equal(next.game.countItem('basalt'), 0, 'NPC-cleared rock is not credited to the player');
});

test('mined Basalt and cracked Diamond return on re-entry without losing the Basalt pickup', () => {
  const run = ancientMineArena(), g = run.game;
  const area = g.level, original = Array.from(area.originalTiles);
  const basalt = findReachableOre(g, g.BASALT), diamond = findReachableOre(g, g.DIAMOND);
  const hit = (ore) => {
    g.player.x = (ore.adjacentX + 0.5) * 32; g.player.y = (ore.adjacentY + 0.5) * 32;
    g.camera.x = g.player.x; g.camera.y = g.player.y; g.state.cooldown = 0;
    g.selectTool('pickaxe');
    run.elements.game.dispatch('pointerdown', { pointerType: 'mouse',
      clientX: (ore.tx + 0.5) * 32 - g.camera.x + 640,
      clientY: (ore.ty + 0.5) * 32 - g.camera.y + 400 });
  };
  g.state.tools.pickaxe = 1; hit(basalt);
  assert.equal(g.getTile(basalt.tx, basalt.ty), g.FLOOR);
  assert.equal(g.pickups[0].item, 'basalt');
  hit(diamond); assert.equal(area.damage.get(`${diamond.tx},${diamond.ty}`), 1);
  g.enterLevel('home');
  assert.ok(g.countItem('basalt') >= 1 && g.countItem('basalt') <= 2);
  const carried = g.countItem('basalt');
  g.enterLevel('stage13');
  assert.deepEqual(Array.from(area.tiles), original);
  assert.equal(area.damage.size, 0);
  assert.equal(g.getTile(basalt.tx, basalt.ty), g.BASALT);
  assert.equal(g.getTile(diamond.tx, diamond.ty), g.DIAMOND);
  assert.equal(g.countItem('basalt'), carried);
});

test('version-9 saves round-trip Basalt in the bag, chest, ground, flying loot and a Prospector target', () => {
  const run = ancientMineArena(), g = run.game;
  g.addItem('basalt', 7); g.storage.basalt = 12;
  g.pickups.push(savedPickup('basalt', g.player.x + 32, g.player.y, { count: 2 }));
  g.pickups.push(savedPickup('basalt', g.player.x + 64, g.player.y, { phase: 'flying', age: 0.2 }));
  g.setTile(11, 22, g.BASALT);
  const miner = g.makeProspector(10.5 * 32, 22.5 * 32, true);
  miner.oreTarget = { tx: 11, ty: 22, tile: g.BASALT, goalTx: 10, goalTy: 22, route: [], routeIndex: 0 };
  miner.mineProgress = 0.35; miner.haul.gold = 3; g.prospectors.push(miner);
  const text = g.createSaveText(), saved = JSON.parse(text);
  assert.equal(saved.version, 9); assert.equal(saved.storage.basalt, 12);
  const next = createGame({ autoStart: false }); next.game.loadSaveText(text);
  assert.deepEqual(comparableSave(next.game), comparableSave(g));
  assert.equal(next.game.countItem('basalt'), 7); assert.equal(next.game.storage.basalt, 12);
  assert.equal(next.game.prospectors[0].oreTarget.tile, next.game.BASALT);
  assert.equal(next.game.prospectors[0].mineProgress, 0.35);
  next.elements.resume.click(); next.game.state.invuln = 999; next.step(35);
  assert.equal(next.game.countItem('basalt'), 10);
  assert.equal(next.game.pickups.length, 0);
  assert.equal(next.game.storage.basalt, 12);
});

for (const variant of ['active', 'inactive']) {
  test(`genuine version-8 ${variant} Ancient Mine migrates both terrain snapshots without losing progress`, () => {
    const text = fs.readFileSync(path.join(__dirname, 'fixtures', `pre-basalt-mine-${variant}-v8.json`), 'utf8');
    const old = JSON.parse(text), slot = createMemoryStorage();
    assert.equal(old.version, 8); assert.ok(!Object.hasOwn(old.storage, 'basalt'));
    slot.setItem('cuddly-train.mining-simulator.save.v1', text);
    const next = createGame({ storage: slot, autoStart: false });
    assert.equal(next.elements['continue-save'].disabled, false, 'the existing browser slot is recognized');
    next.elements['continue-save'].click();
    const g = next.game, now = JSON.parse(g.createSaveText());
    assert.equal(g.state.mode, 'paused'); assert.equal(now.version, 9);
    assert.equal(now.currentLevel, old.currentLevel); assert.equal(g.storage.basalt, 0);
    assert.deepEqual(now.inventory, old.inventory);
    assert.deepEqual(now.storage, { ...old.storage, basalt: 0 });
    assert.deepEqual(now.player, old.player); assert.deepEqual(now.state, old.state);
    assert.deepEqual(now.enemies, old.enemies); assert.deepEqual(now.warden, old.warden);
    assert.deepEqual(now.areas.stage7, old.areas.stage7, 'Titanium and Stone in earlier floors are untouched');
    assert.deepEqual(now.areas.home, old.areas.home);
    const replacement = new Map([[g.STONE, g.BASALT], [g.TITANIUM, g.DIAMOND], [g.QUARTZ, g.IRON]]);
    const expected = structuredClone(old.areas.stage13);
    for (const field of ['tiles', 'originalTiles']) {
      for (const oldType of replacement.keys()) assert.ok(expected[field].includes(oldType));
      expected[field] = expected[field].map((tile) => replacement.get(tile) ?? tile);
    }
    assert.equal(expected.prospectors[0].oreTarget.tile, g.STONE);
    expected.prospectors[0].oreTarget.tile = g.BASALT;
    assert.deepEqual(now.areas.stage13, expected, 'only the intended terrain and target values change');
    assert.deepEqual(now.areas.stage13.damage, old.areas.stage13.damage, 'partial mining cracks persist');
    assert.equal(now.areas.stage13.pickups[0].item, 'quartz', 'uncollected Quartz remains Quartz');
    const mined = old.areas.stage13.tiles.findIndex((tile, i) => tile === g.FLOOR && old.areas.stage13.originalTiles[i] === g.STONE);
    assert.notEqual(mined, -1); assert.equal(now.areas.stage13.tiles[mined], g.FLOOR);
    assert.equal(now.areas.stage13.originalTiles[mined], g.BASALT, 'a mined block remains mined until reset');
    assert.equal(slot.getItem(g.saveKey), text, 'Continue never overwrites the old browser save');
    const resaved = g.createSaveText(), again = createGame({ autoStart: false });
    again.game.loadSaveText(resaved);
    assert.deepEqual(comparableSave(again.game), comparableSave(g), 'v9 reload does not apply migration twice');
    if (variant === 'active') {
      const target = g.prospectors[0].oreTarget;
      assert.equal(g.getTile(target.tx, target.ty), g.BASALT);
      next.elements.resume.click(); suppressNewEnemySpawns(g.level); g.state.invuln = 999;
      next.step(16);
      assert.equal(g.getTile(target.tx, target.ty), g.FLOOR, 'in-progress mining continues against the new Basalt');
      g.enterLevel('home');
    } else next.elements.resume.click();
    g.enterLevel('stage13');
    assert.deepEqual(Array.from(g.level.tiles), expected.originalTiles, 're-entry restores the corrected snapshot');
    assert.equal(g.level.damage.size, 0);
    assert.equal(g.prospectors[0].haul.gold, 5); assert.ok(g.prospectors[0].hp > 0 && g.prospectors[0].hp <= 321);
    const quartzOnGround = g.pickups.filter((pickup) => pickup.item === 'quartz').reduce((sum, pickup) => sum + pickup.count, 0);
    assert.equal(g.countItem('quartz') + quartzOnGround, 5, 'both carried and uncollected old Quartz remain safe');
  });
}

test('invalid Basalt save data is rejected without changing the current run', () => {
  const run = ancientMineArena(), g = run.game;
  g.addItem('basalt', 3); g.storage.basalt = 4;
  const saved = JSON.parse(g.createSaveText()), before = comparableSave(g);
  const cases = [
    (s) => { delete s.storage.basalt; },
    (s) => { s.storage.basalt = -1; },
    (s) => { s.storage.basalt = 1.5; },
    (s) => { s.inventory[0].item = 'notBasalt'; },
    (s) => { s.areas.stage13.tiles[1] = 999; },
    (s) => { s.version = 8; delete s.storage.basalt; }, // a v8 file cannot contain v9 Basalt tiles
  ];
  for (const mutate of cases) {
    const invalid = structuredClone(saved); mutate(invalid);
    assert.throws(() => g.loadSaveText(JSON.stringify(invalid)));
    assert.deepEqual(comparableSave(g), before, 'a rejected save leaves the live game untouched');
  }
});
