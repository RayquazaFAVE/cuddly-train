# Mining Simulator ⛏️

A top-down dungeon mining game. You start safe in **Home Base**, take the stairs down to
**Stage 1**, and work the cave for ore while slimes try to eat you.

No dependencies, no build step. Open `index.html` and play, or serve the folder:

```bash
python3 serve.py          # http://localhost:8000
```

`serve.py` sends `Cache-Control: no-store` on purpose. Plain `python3 -m http.server`
sends no cache headers, so browsers happily cache `js/game.js` and you end up running
yesterday's script against today's HTML — which looks exactly like a dead start button.
If you ever do see the page without a working start button, it is almost always a cached
copy: hard-reload with `Ctrl+Shift+R` (`Cmd+Shift+R` on macOS).

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` (or arrows) | Move |
| `Q` | Equip the **pickaxe** |
| `E` | Equip the **sword** |
| Left click / `Space` | Swing the equipped tool toward the cursor |
| Left click a station | Open the Melter or the Forge (in Home Base) |
| `Esc` | Pause · `M` mute |

## How a run works

You begin in Home Base, a warm little room with lanterns, crates, a bedroll and a set of
stairs down. Walking onto the stairs takes you to Stage 1; walking onto the stairs there
takes you back home. Your inventory and health carry between the two.

### Stage 1 · Weeping Hollow

The cave layout is preset — seven rooms joined by corridors — but the rock seeded into its
walls is randomised on every run, so no two digs are the same. Three things live in the
rock:

| Rock | Pickaxe hits (T1) | Yields |
| --- | --- | --- |
| Stone | 1 | Stone ×1–2 |
| Coal | 1 | Coal ×1 |
| Copper | 2 | Copper ×1 |

Copper becomes more common the further you get from the entrance, so pushing away from the
stairs pays better. Cracked tiles stay cracked, so a half-mined copper vein is easy to spot
and finish later.

### Slimes

Slimes spawn around the cave and chase you. A normal slime:

- has **30 HP** and dies to **3 sword hits** (10 damage each)
- bites for **20 damage**
- **splits into two Tiny Slimes** when killed

Tiny Slimes have exactly **half** of everything: **15 HP** (2 sword hits), **10 damage**,
and they move faster and are smaller, so they are easier to underestimate.

**They have short sight.** A normal slime notices you within **4 tiles**, a Tiny Slime only
within **2**. Outside that radius a slime loses interest and wanders in a random direction
at **half speed**, picking a new heading whenever it walks into a wall. Slimes hop as they
move — quick little bounces while chasing, a slower amble when wandering.

### The Melter and the Forge

Home Base has two workstations. Click either one to open its menu; `Esc` or **Close** to
leave. The game pauses while a menu is open.

**The Melter** turns copper into ingots:

1. Click the **fuel slot** to load **1 Coal** from your bag.
2. Click the **top slot** to load **1 Copper**.
3. Click **Melt** → **1 Copper Ingot**.

Shift-click a loaded slot to send its contents back to the bag.

**The Forge** spends ingots on permanent tool upgrades:

| Upgrade | Cost | Effect |
| --- | --- | --- |
| Pickaxe → T2 | 3 Copper Ingots | Cracks **any** rock (stone, coal, copper) in **one** hit |
| Sword → T2 | 3 Copper Ingots | **15** damage per hit instead of 10 — a normal slime dies in 2 hits |

Your current tiers show on the tool belt (`T1`/`T2`) and in the Forge. Upgrades are kept
through death; only resources are lost.

### Dying

When your health runs out you wake up in **Home Base** at full health, and **half of every
resource stack** in your bag is gone (rounded to the nearest whole item — `round(7/2)` is 4,
`round(5/2)` is 3). Tool upgrades, and the Melter's currently loaded coal and copper, are
untouched.

### Health

The player has **100 HP**. A normal slime kills you in **5 hits** exactly
(100 ÷ 20), and a Tiny Slime takes 10 of them. After being hit you get 0.9 seconds of
invulnerability so a pack cannot delete you in one frame.

Sword damage is deliberately lower than slime damage: trading blows loses, so you have to
use the reach of your swing (a bit over two tiles wide) rather than standing still.

## The interface

Health and the current area are top-left. The **tool belt** is bottom-centre with the
pickaxe (`Q`) and sword (`E` — clicking either one works too), and the **inventory** sits
just below it.

The inventory is ten slots, display only — there is no slot selection and no 1–0 hotkeys.
Ore is stacked automatically into the first slot with room, 99 per stack, and each slot
shows the ore's colour and count.

## How it is built

```
index.html        canvas, HUD, tool belt, inventory, title/pause/death cards
css/style.css     all styling
js/game.js        levels, mining, combat, physics, renderer, audio
```

Notes on the implementation:

- **Levels** are tile grids (32 px tiles). `buildHome()` and `buildStage1()` lay out rooms
  and corridors as data, so adding Stage 2 is a matter of adding a room list.
- **Ore seeding** floods outward from every walkable tile and converts walls within two
  tiles into rock: Stone, Coal or Copper, with copper odds rising with distance from the
  entrance. Cave walls beyond that ring stay indestructible, so you can dig into the rock
  but never wander off the level.
- **Mining** is hit-based rather than time-based, which is what makes the T1 pickaxe's
  1-hit Stone / 2-hit Copper behaviour exact. Partial damage is remembered per tile.
- **Combat** is an arc test: a swing hits everything inside the sword's range whose angle
  is within the arc of your aim. Damage numbers and slime health bars are drawn in world
  space.
- **Splitting** copies the parent into two half-strength slimes. A swing snapshots the
  slime list first, so the tinies created by a kill cannot be damaged by the blow that
  made them.
- **Lighting** is an offscreen darkness layer punched through with radial gradients at the
  player and each lantern. Home Base is lit softly; the cave is not.
- **Audio** is synthesised with Web Audio, so there are no asset files.

## Where to take it next

- **Stage 2** — add a room list and lower `stairsDown` through it; the tile, mining and
  combat systems are level-agnostic already.
- **Selling the haul** — the inventory is populated and stacked; a shop at Home Base that
  converts ore to gold is the natural sink, and the total is already tracked in
  `state.oreHauled`.
- **Tool tiers** — `TILES` holds a `hits` value per rock, currently read as "T1 pickaxe
  hits". Turning that into a per-tier table is the obvious next step for upgrades, and the
  tool belt is the right place to show it.
- **More enemies** — `makeSlime()` plus `updateSlimes()` is a compact template; a new
  enemy type is a new factory and a branch in the update loop.
- **More stations** — `level.stations` is just data (`{ kind, x, y }`); `openStation()`
  swaps which panel is visible, so a shop or a chest is a new panel and a branch on `kind`.
- **Higher tiers** — `state.tools` holds a tier per tool. `pickaxeHits()` maps a rock to
  the hits your current pickaxe needs, and `tierDamage()` maps the sword tier to damage,
  so T3 is a table entry rather than a rewrite.

## Poking at it

```js
MiningSim.state            // mode, hp, tool, counts
MiningSim.level            // the current level, its tiles and stairs
MiningSim.slimes           // live slime list
MiningSim.BALANCE          // all the tuning numbers in one object
MiningSim.addItem('copper', 5)
MiningSim.enterLevel('stage1', 'debug')
MiningSim.melter           // what is loaded into the Melter
MiningSim.melt()           // force a melt
MiningSim.upgradeTool('pickaxe')
MiningSim.halveResources() // the death penalty, on demand
```
