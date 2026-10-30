# Mining Simulator ⛏️

A top-down dungeon mining game. Start safe in **Home Base**, explore **Cave Entrance**,
then descend through **Dreadful Tunnels**, **Auag Cavern**, and **Stalag Cavern** to
**Alumina Cave**.

No dependencies, no build step. Open `index.html` and play, or serve the folder:

```bash
python3 serve.py          # http://localhost:8000
```

`serve.py` sends `Cache-Control: no-store` on purpose. Plain `python3 -m http.server`
sends no cache headers, so browsers happily cache `js/game.js` and you end up running
yesterday's script against today's HTML — which looks exactly like a dead start button.
If you ever do see the page without a working start button, it is almost always a cached
copy: hard-reload with `Ctrl+Shift+R` (`Cmd+Shift+R` on macOS).

## Deploy to Render

Use a **Static Site**, connected to this GitHub repository. No server or build tools are
needed. In Render's build settings:

- **Branch:** select the branch containing the version you want to publish.
- **Root Directory:** leave empty (the repository root).
- **Build Command:** leave empty; if Render requires a command, use `true`.
- **Publish Directory:** `.`

Save the settings and deploy the latest commit. With auto-deploy enabled, future pushes to
that branch are deployed automatically. If the site looks old, check the branch and commit
shown in Render's deploy log, wait for the deploy to go live, then hard-refresh the page.
`serve.py` is only for local previews and is not needed for a Render Static Site.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` (or arrows) | Move |
| `Q` | Equip the **pickaxe** |
| `E` | Equip the **sword** |
| Left click / `Space` | Swing the equipped tool toward the cursor |
| Left click a station | Open the Melter, Storage Chest, Forge, Coin Press or Coin Trader (in Home Base) |
| `Esc` | Pause · `M` mute |

## How a run works

You begin in Home Base, a warm little room with lanterns, crates, a bedroll and a set of
stairs down. Walking onto the stairs takes you to Cave Entrance. The stairs in its far
chamber lead down to Dreadful Tunnels, whose lower gallery descends into Auag Cavern.
Stairs in Auag Cavern lead to Stalag Cavern, whose far chamber descends into Alumina Cave.
Each stage also has stairs back up. Your inventory and health carry between areas. When you
re-enter an area, its tiles and stalagmites return to their original state for that run:
mined blocks and ore reappear, and partial cracks are cleared. Uncollected drops and
Prospector hauls remain safe. On arrival, the stage title appears at the top of the screen,
then shrinks into a small area bubble.

### Stage 1 · Cave Entrance

The cave layout is preset — seven rooms joined by corridors — but the rock seeded into its
walls is randomised on every run, so no two digs are the same. Three things live in the
rock:

| Rock | Pickaxe hits (T1) | Yields |
| --- | --- | --- |
| Stone | 1 | Stone ×1–2 |
| Coal | 1 | Coal ×1 |
| Copper | 2 | Copper ×1 |

Copper becomes more common the further you get from the entrance, so pushing away from the
stairs pays better. A half-mined vein stays cracked while you're in the area, but leaving
and returning restores it.

### Stage 2 · Dreadful Tunnels

Descend from the far room of Cave Entrance to a network of **long, straight tunnels** with
a few larger openings. It contains Stone, Coal, Copper and the new **Iron** ore. The
layout is fixed, while ore is re-seeded on each new run. Slimes still live here, and the
new Drill Moles can reach you through solid rock.

| Rock | T1 pickaxe | T2 pickaxe | T3 pickaxe | Yields |
| --- | --- | --- | --- | --- |
| Stone | 1 hit | 1 hit | 1 hit | Stone ×1–2 |
| Coal | 1 hit | 1 hit | 1 hit | Coal ×1 |
| Copper | 2 hits | 1 hit | 1 hit | Copper ×1 |
| Iron | 5 hits | 3 hits | 2 hits | Iron ×1 |

The arrival subtitle is “Moles have carved these tunnels”.

### Stage 3 · Auag Cavern

The rounded chambers of Auag Cavern contain **Stone, Gold and Silver**. Its arrival subtitle
is “The abundant riches have attracted the greedy”. The layout is fixed and the ore is
randomised for each new run. Gold and Silver currently have the same mining requirements as
Iron: **5 / 3 / 2 hits** with a T1 / T2 / T3 pickaxe. Each ore block yields one piece.
They can be kept in the Home Base Storage Chest or pressed into coins.

### Stage 4 · Stalag Cavern

The subtitle is “The calcium grows into spikes here”. The cavern's rock contains **Stone,
Iron and Gold**. Pale **Stalagmites** grow on open ground, some beside walls and others
freestanding; they never generate inside walls or ore. Mine a stalagmite to get **1 Calcite**.
It takes **2 hits with a T1 pickaxe** or **1 hit with T2 or T3**. Like other terrain,
stalagmites grow back when you leave the area and return. Store Calcite in the Home Base
chest. Prospectors, Large Slimes and Spiders inhabit this stage.

### Stage 5 · Alumina Cave

Beyond Stalag Cavern lies **Alumina Cave**, with broad galleries containing **Stone, Iron
and Bauxite**. Bauxite yields one piece and takes **5 / 3 / 2 hits** with a T1 / T2 / T3
pickaxe. Melt one Bauxite with one Coal at Home Base to produce **Aluminum**. Large Slimes,
Spiders and Golems spawn here; the area's tiles reset when you leave and return.

### Prospectors

Prospectors appear in Auag Cavern and Stalag Cavern. They wander at the same speed as wandering slimes. They search within **4 tiles** for
Gold or Silver, walk around obstacles (or mine intervening stone), and collect the ore they
mine. If defeated, a Prospector drops **all** the Gold and Silver it collected. Their haul
and any uncollected drops remain in their cavern if you leave and come back.

A Prospector ignores you unless you have Gold or Silver **in your bag** and are within
**4 tiles**. Then it chases at a normal slime's speed, swings its pickaxe for **20 damage**
up close, and throws dynamite from farther away. Prospectors have **45 HP** and wait
**8 seconds between throws**. Dynamite lands on the tile you were standing on when it was
thrown and explodes **2 seconds after landing**, so move away from the red warning. Damage
is a percentage of maximum HP, measured in tile rings
(including diagonals):

| Distance from dynamite | Damage |
| --- | --- |
| Same tile | Instant death |
| 1 tile | 70% |
| 2 tiles | 60% |
| 3 tiles | 50% |
| 4 tiles | 25% |
| 5 or more tiles | None |

Explosions bypass the brief contact-hit invulnerability, so a same-tile blast is always fatal.

### Slimes

Slimes spawn around the cave and chase you. A normal slime:

- has **30 HP** and dies to **3 T1 sword hits** (10 damage each)
- bites for **20 damage**
- **splits into two Tiny Slimes** when killed

Tiny Slimes have **half the HP and damage**: **15 HP** (2 T1 sword hits) and **10 damage**.
They move faster and are smaller, so they are easier to underestimate.

**They have short sight.** A normal slime notices you within **4 tiles**, a Tiny Slime only
within **2**. Outside that radius a slime loses interest and wanders in a random direction
at **half speed**, picking a new heading whenever it walks into a wall. Slimes hop as they
move — quick little bounces while chasing, a slower amble when wandering.

**Large Slimes** in Stalag Cavern and Alumina Cave have **60 HP** and deal **40 damage**: double a regular
slime. They spot you from **6 tiles** away but move at **half a regular slime's speed**.
Defeating one splits it into **two regular slimes**, which can then split into tiny slimes.

### Spiders

Spiders skitter quickly through Stalag Cavern and Alumina Cave and navigate around
obstacles. They have **15 HP**, deal **5 damage** per bite, and can attack every
**0.4 seconds**. Spider bites give a shorter **0.3-second** recovery window, so their
quick attacks can land repeatedly.

### Golems

Golems are slow, bulky stone guardians found in Alumina Cave. They have **100 HP**, deal
**45 damage**, and move at **24 pixels per second** while chasing. After every **10 tiles
of actual travel**, a Golem becomes **disabled for 3 seconds**: it cannot move or deal
contact damage, even if you stand next to it. A blue ring and label show when it is safe
to attack. Hitting a disabled Golem does not push it; attempted movement into walls does
not count toward its distance.

### Drill Moles

Drill Moles appear in Dreadful Tunnels. Like normal slimes they have **30 HP** and deal
**20 damage**, but they do not split. They chase from up to **5 tiles** away, and can
burrow straight through solid blocks. Each time a mole enters a block, it has a **1 in 10**
chance of destroying it. Blocks destroyed by moles drop nothing; the outer map boundary
remains intact.

### Home Base stations

Click a workstation or the chest to open its menu; `Esc` or **Close** to leave. The game
pauses while a menu is open.

**The Storage Chest** keeps all resources and coins, including Bauxite and Aluminum, safe
at home. Each row shows how many are in your bag and how many are stored. Click
**Store** or **Take** to move
one item; Shift-click either button to move as many as possible. **Deposit all** and
**Take all** work across every resource. Stored resources survive cave deaths, and anything
that doesn't fit in your bag stays in the chest. Storage lasts for the current run; like
the rest of the game, it is reset when starting a new run or reloading the page.

**The Melter** turns Copper and Iron into matching ingots, and Bauxite into Aluminum:

1. Choose **Copper**, **Iron** or **Bauxite**, then click the **top slot** to load one.
2. Click the **bottom slot** to load **1 Coal** as fuel.
3. Click **Melt**. The menu closes, a flame bursts from the Melter, and the resulting
   ingot or Aluminum flies over to you and into your bag.

The top slot holds one kind of ore at a time. Shift-click it to return its contents before
switching types; anything that doesn't fit stays in the Melter. The Melt button needs room
in the bag for the ingot.

**The Forge** spends ingots on permanent tool upgrades:

| Upgrade | Cost | Effect |
| --- | --- | --- |
| Pickaxe T1 → T2 | 3 Copper Ingots | Stone, coal and copper take 1 hit; iron takes 3 |
| Sword T1 → T2 | 3 Copper Ingots | **15** damage per hit — a normal slime or mole takes 2 hits |
| Pickaxe T2 → T3 | 3 Iron Ingots | Stone, coal and copper take 1 hit; iron takes 2 |
| Sword T2 → T3 | 3 Iron Ingots | **30** damage per hit — a normal slime or mole takes 1 hit |

A tool must reach T2 before it can be upgraded to T3. Your current tiers show on the tool
belt and in the Forge. Upgrades are kept through death; only resources in the bag are lost.

**The Coin Press** turns **1 raw Copper, Silver or Gold** into its matching coin. It also
turns **1 Aluminum** into an Aluminum Coin; Bauxite must first be melted into Aluminum.
The station uses materials in your bag. Pressing the first Silver, Gold or Aluminum Coin
unlocks that coin's trade at the Coin Trader.

**The Coin Trader** exchanges coins in your bag for Coal:

| Trade | Availability |
| --- | --- |
| 2 Copper Coins → 1 Coal | Available from the start |
| 1 Silver Coin → 1 Coal | Unlock by pressing a Silver Coin |
| 1 Gold Coin → 2 Coal | Unlock by pressing a Gold Coin |
| 1 Aluminum Coin → 4 Coal | Unlock by pressing an Aluminum Coin |

Unlocked trades remain available through death, but reset on a new run. Pressing or trading
never consumes ingredients unless the complete result fits in the bag; a stack used up by
the exchange can free a slot for its output.

### Dying

When your health runs out you wake up in **Home Base** at full health, keeping **half of
each resource's total** in your bag, rounded to the nearest whole item (`round(7/2)` is 4,
`round(5/2)` is 3). Tool upgrades, unlocked coin trades, the Storage Chest, and the Melter's
currently loaded coal and ore are untouched. Coins and Aluminum in the bag are halved like
other resources.

### Health

The player has **100 HP**. A normal slime or Drill Mole kills you in **5 hits** exactly
(100 ÷ 20), and a Tiny Slime takes 10 of them. Most hits grant 0.9 seconds of
invulnerability; a spider bite grants 0.3 seconds, making its fast attacks dangerous.
Use the reach of your sword rather than standing still and trading blows.

## The interface

Health is top-left and the current area is top-centre. The **tool belt** is bottom-centre
with the pickaxe (`Q`) and sword (`E` — clicking either one works too), and the
**inventory** sits just below it.

The inventory is ten slots, display only — there is no slot selection and no 1–0 hotkeys.
Ore is stacked automatically into the first slot with room, 99 per stack, and each slot
shows the ore's colour and count. Collected items pop up and fly to the player; resources
that won't fit remain on the ground until there is room and you return to collect them.

## How it is built

```
index.html          canvas, HUD, tool belt, inventory, station and game screens
css/style.css       all styling
js/game.js          levels, mining, storage, combat, physics, renderer, audio
tests/game.test.js  dependency-free integration tests (Node.js)
```

To run the tests with Node.js installed:

```bash
node --test tests/game.test.js
```

Notes on the implementation:

- **Levels** are tile grids (32 px tiles). Stage 1 connects rooms, Stage 2 combines straight
  galleries and openings, and Stages 3–5 connect broad cavern chambers.
- **Ore seeding** converts walls near walkable tiles into each area's rock resources. The
  outer boundary stays intact. Stage 4's stalagmites are separate objects placed only on
  floor tiles, with routes kept open for players and Large Slimes.
- **Mining** is hit-based rather than time-based. Iron, Gold, Silver and Bauxite have
  per-tier hit tables, and partial damage is remembered per tile until you leave and return.
- **Area resets** restore the original terrain, ore and stalagmites generated for the current
  run on each return. Stored items, upgrades, machines and uncollected loot are preserved;
  drops or Prospectors trapped by restored obstacles are moved onto reachable floor.
- **Moles** ignore interior collisions and roll once when entering a solid tile. Their
  break chance is not repeatedly applied each frame, and destroyed blocks drop nothing.
- **Prospectors** pathfind to reachable ore, carry what they mine, and switch to combat when
  the nearby player has treasure. Dynamite targets a fixed tile, with an eight-second throw
  cooldown and a two-second fuse after it lands.
- **Combat** is an arc test: a swing hits everything inside the sword's range whose angle
  is within the arc of your aim. Golems count actual movement and pause without contact
  damage after ten tiles. Damage numbers and enemy health bars are drawn in world space.
- **Coins** are exchanged atomically against a copy of the bag, then committed only if the
  output fits. Unlocks live for the current run and are not lost on death.
- **Splitting** makes two regular slimes from a Large Slime, and two tinies from a regular
  slime. A swing snapshots the enemy list first, so newly spawned slimes cannot be damaged
  by the blow that made them.
- **Lighting** is an offscreen darkness layer punched through with radial gradients at the
  player and each lantern. Home Base is lit softly; the cave is not.
- **Audio** is synthesised with Web Audio, so there are no asset files.

## Where to take it next

- **More stages** — add another level, its stair targets and new ores or enemies.
- **More trades** — extend the Coin Trader with additional recipes or rewards; the total
  resources gathered by mining are already tracked in `state.oreHauled`.
- **More enemies** — `makeSlime()` plus `updateSlimes()` is a compact template; a new
  enemy type is a new factory and a branch in the update loop.
- **More stations** — `level.stations` is just data (`{ kind, x, y }`); `openStation()`
  swaps which panel is visible, so a shop could be a new panel and a branch on `kind`.
- **Higher tiers** — `state.tools` holds a tier per tool. `pickaxeHits()` maps a rock to
  the hits your current pickaxe needs, and `tierDamage()` maps the sword tier to damage.

## Poking at it

```js
MiningSim.state            // mode, hp, tool, counts
MiningSim.level            // the current level, its tiles and stairs
MiningSim.slimes           // live slime list
MiningSim.moles            // live Drill Moles
MiningSim.spiders          // live Spiders
MiningSim.golems           // live Golems
MiningSim.prospectors      // Prospectors in the current area
MiningSim.dynamites        // active dynamite in the current area
MiningSim.BALANCE          // all the tuning numbers in one object
MiningSim.addItem('gold', 5)
MiningSim.enterLevel('stage5', 'debug')
MiningSim.melter           // what is loaded into the Melter
MiningSim.traderUnlocked   // coin trade unlocks for this run
MiningSim.storage          // resources safe in the Storage Chest
MiningSim.pickups          // items flying or waiting on the current floor
MiningSim.melt()           // start a melt at Home Base
MiningSim.pressCoin('silver') // press one Silver Coin at Home Base
MiningSim.tradeCoin('silver') // trade a Silver Coin for Coal
MiningSim.upgradeTool('pickaxe')
MiningSim.halveResources() // the death penalty, on demand
```
