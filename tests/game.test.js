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
  click(options) { if (!this.disabled) this.dispatch('click', options); }
  querySelectorAll(selector) {
    if (selector === '.tool') return this.children.filter((child) => child.classList.contains('tool'));
    return [];
  }
  getContext() { return context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 800 }; }
}

function createGame() {
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
  const closers = [new Element('button'), new Element('button'), new Element('button')];
  const document = {
    hidden: false,
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
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
  };
  let callbacks = [];
  let now = 100;
  const requestAnimationFrame = (fn) => { callbacks.push(fn); return callbacks.length; };
  const math = Object.create(Math);
  math.random = Math.random;
  vm.runInNewContext(script, { window, document, requestAnimationFrame, console, Math: math }, { filename: 'game.js' });
  const step = (frames = 1, frameMs = 50) => {
    for (let i = 0; i < frames; i++) {
      now += frameMs;
      const pending = callbacks;
      callbacks = [];
      for (const fn of pending) fn(now);
    }
  };
  elements.play.click();
  step(2);
  return { game: window.MiningSim, elements, step, math, listeners };
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
  assert.equal(elements['upgrade-pickaxe'].textContent, 'Maxed');
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
  for (const id of ['home', 'stage1', 'stage2', 'stage3', 'stage4']) {
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
