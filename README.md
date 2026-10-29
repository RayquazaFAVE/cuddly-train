# Deep Dig ⛏️

A top-down 2D mining game that runs in the browser. You are dropped at the top of a
mountain of rock with a lantern on your helmet, and there is ore below. Dig, haul it up,
and go deeper for the good stuff.

No dependencies, no build step. Open `index.html` and play.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` (or arrow keys) | Walk |
| Left mouse button (hold) | Mine the tile you are pointing at |
| `Space` | Mine the tile you are facing — no mouse needed |
| `1` … `9`, then `0` | Select inventory slot 1 … 10 |
| `Esc` | Pause / resume |
| `M` | Mute |

Slots can also be clicked, and they stay in sync with the number keys.

## The inventory

Ten slots along the bottom of the screen. The key above each slot is its hotkey:

```
 [1]  [2]  [3]  [4]  [5]  [6]  [7]  [8]  [9]  [0]
```

Slot 1 sits under the `1` key and slot 10 sits under the `0` key. Ore you dig up is
sucked toward you and stacked into the first slot that has room, up to 99 per stack.
Each slot shows the ore's colour as a little gem and its count in the corner. Mining with
a full bag leaves the ore on the floor and tells you about it.

## What's down there

Ore is placed with value noise, so it forms clusters you can follow rather than
confetti. The deeper you go, the better the odds:

| Ore | First appears | Value | Rock per tile |
| --- | --- | --- | --- |
| Coal | 3 m | $6 | ~0.62 s |
| Iron | 11 m | $18 | ~0.86 s |
| Gold | 26 m | $55 | ~1.05 s |
| Diamond | 46 m | $180 | ~1.5 s |

Roughly 11% of the rock below the surface is ore and 81% is plain rock, which keeps
mining a decision rather than a formality. Natural caverns open up as you go down, and
bedrock at the bottom of the world cannot be broken.

Your helmet lantern is the only light source — that is what the darkness gradient is —
and ore drops glint faintly in the dark before you pick them up.

## How it is built

```
index.html        canvas, HUD, hotbar container, title and pause cards
css/style.css     all styling, including the hotbar slot states
js/game.js        the whole game: world generation, mining, physics, renderer
```

A few implementation notes:

- **World** is an infinite grid of 32 px tiles, generated lazily from a deterministic
  hash. Every tile the player digs is stored in an `overrides` map, so terrain is stable
  but costs nothing to remember. Because it is procedural, there is no save file to grow.
- **Tiles are the walls.** Rock, ore and bedrock are solid; the tunnels you carve are the
  only walkable space. Movement is axis-separated collision against the tile grid, so you
  slide along walls instead of catching on them.
- **Mining** tracks a target tile, accumulates progress against that tile's hardness, and
  resets if you switch targets. Cracks appear as it weakens. Ore pops out as a physical
  drop that is pulled toward you, and only enters the bag when it reaches you.
- **Rendering** is Canvas 2D. Lighting is a second offscreen canvas filled with darkness
  and then punched through with radial gradients at the player and each lantern
  (`destination-out`), which is cheap and gives soft falloff.
- **Sound** is synthesised with Web Audio — a pick hitting rock, rock breaking, and the
  pickup chime — so there are no audio files.

## Where to take it next

The pieces are deliberately small and separate, so the obvious extensions are:

- **Tools that wear out** — give each slot a durability and gate hardness on the tool in
  the selected slot (the hotbar is already the right shape for this).
- **Selling the haul** — the haul value is already tracked; add a lift or a shop at the
  surface that converts the bag to money.
- **Deeper rock types** — add a tile to the `TILES` table and an entry to `ORE_DEFS`; the
  renderer and inventory pick it up automatically.
- **Hazards** — gas pockets or collapsing ceilings on the same tile grid.

## Poking at it

```js
DeepDig.state              // mode, haul value, selected slot
DeepDig.player             // x, y, facing
DeepDig.inventory          // the ten slots
DeepDig.addItem('gold', 5) // stuff a slot
DeepDig.tileAt(tx, ty)     // inspect the world
DeepDig.setTile(0, 0, 0)   // carve a tile
```
