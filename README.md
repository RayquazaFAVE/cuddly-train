# Mining Simulator ⛏️

A top-down dungeon mining game. Start safe in **Home Base**, explore **Cave Entrance**,
then descend through **Dreadful Tunnels**, **Auag Cavern**, **Stalag Cavern**,
**Alumina Cave**, **Luscious Cave**, **Spiral Cavern**, **Haunted Descent** and
**Pitch-Black Depths**, **Warden’s Core**, **Amethyst Cavern**, **Ancient Temple** and
**Ancient Mine**.
A hidden cave waits beyond a secret seam.

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
| Touch | Drag the **MOVE** stick to move; tap the field to aim and swing, and tap the tool belt to change tools |
| `F`, or click / tap a nearby elevator, pedestal or shrine | Use the elevator, awaken the Warden or summon the shrine guardian |
| `X` or tap **VOID POWER** | Activate the Core of Darkness after defeating the Warden |
| Left click a station | Open the Melter, Storage Chest, Forge, Coin Press, Coin Trader or Gem Polisher (in Home Base) |
| `Esc` / pause button (top-right) | Pause, save or load · `M` mute |

## Saving and loading

Saving is **manual**. Pause with `Esc` or the top-right pause button, then choose:

- **Save to browser** writes one save slot for this browser and site. Choose **Continue
  saved game** on the title screen after reopening or refreshing. Saving again replaces
  the previous browser save; starting a new game does not replace it until you save. The
  game asks before a different run or imported file replaces an existing browser save.
- **Download save file** creates `mining-simulator-save.json` as a portable backup. Keep
  the file somewhere safe or move it to another device.
- **Load save file** on the title or pause screen restores a downloaded backup. Loading
  while a run is paused asks for confirmation before replacing unsaved progress. The
  imported file does not replace the browser slot until you choose **Save to browser**.

A loaded game starts paused. The save includes inventory, health, upgrades, storage,
Melter contents, unlocked trades and elevator power, visited floors, cave layouts and
current mining damage, ground loot, Prospectors, active enemies and projectiles. Natural
healing progress, an active Warden encounter, the Core of Darkness and its timers,
the Temple shrine’s activation and cooldown, and poison timers and partial ticks are saved
too. Leaving and returning to an area still resets its tiles and stalagmites to that run's
original layout. An unfinished Warden fight resets when you leave the arena or die.

Version 1 through 8 saves still load. Living Slimes, Moles, Spiders, Prospectors and
Golems from versions 1–5 gain double maximum and current HP, preserving their health
percentage; a version-6 Warden fight likewise keeps its health percentage and phase at
the new, higher maximum; Ghosts, Grave Diggers and Infected Skeletons are unchanged. Older Home Bases
expand without moving the player or ground loot, visited Spiral Caverns gain the Stage 8
staircase without changing the hidden seam, visited Haunted Descents gain the Stage 9
staircase, visited Pitch-Black Depths gain the Stage 10 staircase, and the Warden’s Core
gains the Stage 11 staircase. Version-7 Ancient Temples gain the Stage 13 staircase without
changing other tiles. Version-8 Ancient Mine deposits update to the new resource mix, while
previously mined and dropped items stay as they were. Previous Mercury purchases become the
poison edge automatically; existing Golems retain their historical maximum and remaining HP.
Older Alumina saves
gain the Stage 6 staircase. Injured version 1–4 saves wait four seconds before
healing, since those formats did not record the time of the last hit. A previously visited
Luscious Cave keeps its current terrain and loot on load; the redesigned open layout
appears the next time you leave and return, with loot moved to reachable floor if needed.
Pre-elevator saves must still reactivate the elevator on Stage 7; a version 3 save keeps
its existing elevator state.

Browser saves stay on this device and are tied to the browser and site address; clearing
site data, private browsing, or switching browsers can remove or hide them. Browser storage
can also be blocked or full. Download a save file for a backup, especially before clearing
browser data or moving devices. No save is sent to a server.

## How a run works

You begin in an expanded Home Base, a lantern-lit room with crates, a bedroll and a set of
stairs down. Walking onto the stairs takes you to Cave Entrance. The stairs in its far
chamber lead down to Dreadful Tunnels, whose lower gallery descends into Auag Cavern.
Stairs in Auag Cavern lead to Stalag Cavern, whose far chamber descends into Alumina Cave.
Continue down to Luscious Cave, Spiral Cavern, Haunted Descent, Pitch-Black Depths and
Warden’s Core, Amethyst Cavern, Ancient Temple and Ancient Mine.
Each stage also has stairs back up.
Your inventory and health carry between areas. When you re-enter an area, its tiles and
stalagmites return to their original state for that run:
mined blocks and ore reappear, and partial cracks are cleared. Uncollected drops and
Prospector hauls remain safe. On arrival, the stage title appears at the top of the screen,
then shrinks into a small area bubble.

### Elevator

The lift entrances next to the ordinary stairs start offline. Reach **Stage 7 · Spiral
Cavern**, walk up to its elevator, and click or tap it (or press **F**) to **reactivate**
the system. Then use the elevators beside the stairs to travel between **Home Base and
any Stage 1–13 floor you have already visited**. Unvisited destinations stay locked. The
Secret Cave has no elevator and is never a destination: reach it through the hidden seam.

Elevator travel follows the usual area-reset and loot rules. Reactivation and visited floors
survive death and are included in saves; a new run starts with the elevator offline again.

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

### Stage 6 · Luscious Cave

“A peaceful break from the monsters” is a broad, open oasis with scattered small clumps of
mineable **Stone, Gold, Cobalt and Quartz**. Walk into the shallow wet spots to collect pink
**Axolotls**; the Coin Trader buys each one for **1 Gold Coin**. Uncollected Axolotls stay in
this cave if you leave. Blue, sunglasses-wearing **Tropical Slimes** tend to spawn and wander
near the water without forming tight crowds. They are peaceful until you hit them, and each
new offspring is peaceful until attacked itself. There are no other enemies in this area.

### Stage 7 · Spiral Cavern

“The pinnacle of circles” is a winding spiral containing **Gold, Cobalt, Iridium and
Titanium**. Spiders, Prospectors, Drill Moles and regular Golems patrol it. Titanium is used
for T4 upgrades; Cobalt, Quartz and Iridium can be polished at Home Base. An ordinary
staircase leads down to Stage 8. Separately, look for a **shimmering Titanium seam at the
spiral's heart**: mine it to reveal a hidden staircase. Like the rest of the terrain it
reseals when the area is re-entered.

### Stage 8 · Haunted Descent

“ooOOOOooo!! spoooOOOOoooky ghosts!” welcomes you to a long, winding passage lined
with gravestones. Mine **Stone, Silver, Quartz and Ruby**, and watch for Ghosts and Grave
Diggers. The ordinary staircase in Spiral Cavern leads here; the secret seam is a separate
route. The Stage 8 elevator becomes available after you visit and have restored power.
The ordinary stairs at the far end descend to Stage 9.

### Stage 9 · Pitch-Black Depths

“Its eerie in the darkness of this cave” is a much darker cavern full of graves. Mine
**Ruby, Sapphire and Darkstone**; Darkstone takes one hit and drops one or two pieces,
like ordinary Stone. Ghosts and Grave Diggers share the depths with **Infected Skeletons**.
Look for gravestones coated in infected goop: the skeletons emerge when you approach.
The Stage 9 elevator becomes available once you've visited and restored power. Its far
staircase leads to Warden’s Core.

### Stage 10 · Warden’s Core

A single, large circular arena holds a central pedestal. Mine **Darkstone and Black
Amethyst** around its edge; polish the Amethyst at Home Base and sell each polished piece
for **2 Gold Coins**. Walk up to the pedestal and press **F**, or click or tap it, to awaken
the **Warden of Darkness**. The elevator becomes available after you visit, and the
north stairs lead onward to Stage 11.

The Warden has **3,500 HP**—exactly **100 hits from an unenhanced T4 sword**. In phase 1
it slowly follows you, warning in red before charging or slamming its sword. In phase 2
it stays in the center and telegraphs erupting, slowly sinking void spikes and a returning
sword. In phase 3 the spikes emerge and the sword travels faster, and it adds a void beam.
Charge deals **40**, the sword slam **45**, the returning sword **30** and the beam
**50 damage**. Lingering spikes deal **12 damage every 0.65 seconds** while you remain
in their lane. Move out of the marked lanes before attacks land. If you leave or die, an unfinished
encounter starts fresh the next time you activate the pedestal; you can save and reload
the fight while still inside.

Victory permanently grants the **Core of Darkness** for this run; it is not a bag item,
and the Warden will not return. Press **X** or tap the **VOID POWER** button to gain
**50% more sword damage for 8 seconds**. Its **20-second cooldown starts when activated**;
it boosts direct sword damage in addition to Mercury poison, and also works against Ghosts,
which are immune to that poison.
The Core survives death and is recorded in saves.

### Stage 11 · Amethyst Cavern

“The shimmering purple crystals line the walls” describes three large chambers joined by
tunnels. Mine **Stone, Quartz and Amethyst**; each polished Amethyst sells for **2 Gold
Coins**. Purple Slimes and Crabocks patrol the cavern. The Purple Slime has **90 HP**,
1.5 times a regular slime’s health, and splits into two **45-HP** Purple Tiny Slimes;
each tiny has a 50% chance of dropping one Amethyst. Crabocks chase and bite like Spiders,
but are slower and have **90 HP**. The ordinary stairs lead onward to Stage 12.

### Stage 12 · Ancient Temple

“This ancient place is strangely deep beneath the surface” begins in rocky caves and
opens into straight ruin halls. Mine **Gold, Titanium, Diamond and Mossy Stone**; Mossy
Stone is cosmetic and drops normal Stone, while each polished Diamond sells for **1
Aluminum Coin**. Spiders, Prospectors and Golems roam the temple.

Walk up to the **Golem shrine** and press **F**, or click or tap it, to summon a larger
Shrine Golem. It has **three times the full health of an ordinary Golem**, including its
spawn-time armour. Its defeat drops exactly **2 Diamonds and 5 Stone**. Once awakened, it
respawns 20 seconds after defeat while the temple is active; the cooldown pauses when you
leave and is saved with your progress. Leaving with a living guardian resets that encounter
on re-entry, like other ordinary enemies. Drops remain on the ground if your bag is full.
The lower hall has stairs down to Stage 13.

### Stage 13 · Ancient Mine

“The ancient people appeared to be miners, but something stopped them” is an abandoned
network of mine galleries, old rails and supports. Mine **Gold, Diamond, Mossy Stone, Iron
and Basalt**. Basalt takes one pickaxe hit and yields **1–2 Basalt**, like Stone; you can
collect and store it, but it has no use yet. Mossy Stone still yields ordinary Stone. The
stairs return to the Ancient Temple, and the elevator becomes available once you've visited
and restored power.

- **Ancient Golems** are moss-covered and have **490 HP**: 14 hits from an unenhanced T4
  sword. They deal the same **45 damage** as ordinary Golems, but only shut down after
  **20 tiles of actual travel**, for the usual three seconds.
- **Skeleton Prospectors** mine and carry Gold like other Prospectors, but move faster and
  have **420 HP** (12 unenhanced T4 hits). Their bombs have a smaller two-tile blast radius
  but deal **100%, 90% or 75%** of maximum HP at distances 0, 1 and 2 tiles respectively.
  They still wait **8 seconds** between throws.
- **Venom Spiders** have **315 HP** (9 T4 hits). A successful bite applies **Poisoned**
  for 10 seconds: every tile of actual movement deals **5 damage**. The top-left status
  shows the remaining time. Standing still is safe; blocked movement and knockback do not
  count. Poison damage bypasses contact invulnerability but causes no knockback.
- **Skeletons** also have **315 HP**. They are never hidden under gravestones: they move
  unpredictably side to side, keep their distance, and throw bone projectiles.

### Special Cave

“A secluded mercury paradise” contains **Titanium, Iridium, Quartz and Mercury**, with
Mercury found only here. Its only enemy is the **Mercury Golem**. At the Forge, **3 raw
Mercury** buy a permanent **Mercury Edge**: sword hits poison enemies for a random **4–8
seconds** and slow their movement to **75%**. Poison deals **5% of maximum HP each second**.
Another hit refreshes the duration without losing progress toward the next tick. Ghosts and
Venom Spiders are immune; the Warden and shrine guardian are not. The edge no longer adds
direct sword damage, survives death and is saved with your game. Previous purchases carry
over automatically.

New ore yields one piece per block. Mining requirements are:

| Ore | T1 | T2 | T3 | T4 |
| --- | --- | --- | --- | --- |
| Cobalt | 7 | 5 | 4 | 2 |
| Quartz | 5 | 4 | 3 | 1 |
| Iridium | 8 | 6 | 4 | 2 |
| Titanium | 9 | 7 | 5 | 3 |
| Mercury | 8 | 6 | 4 | 2 |
| Ruby | 8 | 6 | 4 | 2 |
| Sapphire | 8 | 6 | 4 | 2 |
| Black Amethyst | 9 | 7 | 5 | 3 |
| Amethyst | 9 | 7 | 5 | 3 |
| Diamond | 10 | 8 | 6 | 4 |

### Prospectors

Prospectors appear in Auag Cavern, Stalag Cavern, Spiral Cavern and Ancient Temple. They wander at the same
speed as wandering slimes. They search within **4 tiles** for Gold or Silver, walk around
obstacles (or mine intervening stone), and collect the ore they
mine. If defeated, a Prospector drops **all** the Gold and Silver it collected. Their haul
and any uncollected drops remain in their cavern if you leave and come back.

A Prospector ignores you unless you have Gold or Silver **in your bag** and are within
**4 tiles**. Then it chases at a normal slime's speed, swings its pickaxe for **20 damage**
up close, and throws dynamite from farther away. Prospectors have **90 HP** and wait
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
Skeleton Prospectors use the stronger, shorter-range bombs described in Stage 13 above.

### Slimes

Slimes spawn around the cave and chase you. A normal slime:

- has **60 HP** and dies to **6 T1 sword hits** (10 damage each)
- bites for **20 damage**
- **splits into two Tiny Slimes** when killed

Tiny Slimes have **half the HP and damage**: **30 HP** (3 T1 sword hits) and **10 damage**.
They move faster and are smaller, so they are easier to underestimate.

**They have short sight.** A normal slime notices you within **4 tiles**, a Tiny Slime only
within **2**. Outside that radius a slime loses interest and wanders in a random direction
at **half speed**, picking a new heading whenever it walks into a wall. Slimes hop as they
move — quick little bounces while chasing, a slower amble when wandering.

**Large Slimes** in Stalag Cavern and Alumina Cave have **120 HP** and deal **40 damage**:
double a regular slime. They spot you from **6 tiles** away but move at **half a regular slime's speed**.
Defeating one splits it into **two regular slimes**, which can then split into tiny slimes.
Amethyst Cavern has Purple Slimes and their Amethyst-dropping tinies instead.

### Spiders

Spiders skitter quickly through Stalag Cavern, Alumina Cave, Spiral Cavern and Ancient
Temple and navigate around
obstacles. They have **30 HP**, deal **5 damage** per bite, and can attack every
**0.4 seconds**. Spider bites give a shorter **0.3-second** recovery window, so their
quick attacks can land repeatedly. Crabocks in Amethyst Cavern use the same behavior
and bite damage, but are slower and have **90 HP**. Ancient Mine's green Venom Spiders
have **315 HP** and apply movement-based poison on a successful bite.

### Golems

Golems are bulky stone guardians found in Alumina Cave, Spiral Cavern and Ancient Temple. They deal
**45 damage** and chase at **42 pixels per second**. **Mercury Golems** in the Special
Cave deal **55 damage** and chase faster, at **60 pixels per second**.

Newly spawned regular Golems have **200 base HP plus twice one hit of your current
sword's base damage**; Mercury Golems have **160 base HP plus twice one sword hit**.
Mercury Edge and temporary Void Power do not change newly spawned armour. Maximum HP is
set on spawning and persists while they live; older saves preserve their historical armour.
Living Golems in versions 1–5 migrate with both maximum and remaining HP doubled.

After every **10 tiles of actual travel**, either Golem is **disabled for 3 seconds**:
it cannot move or deal contact damage, even if you stand next to it. A blue ring and label
show when it is safe to attack. Hitting a disabled Golem does not push it; attempted
movement into walls does not count toward its distance. Ancient Golems instead have a fixed
**490 HP** and deactivate after **20 tiles**.

A defeated regular Golem drops **2 Stone and 3 Bauxite**, with a **1% chance of 1
Titanium** as well. A Mercury Golem drops **2–4 Mercury**. Drops remain in their cave if
your bag is full, just like other ground loot. The Temple’s shrine Golem instead drops
exactly **2 Diamonds and 5 Stone**, as described above.

### Drill Moles

Drill Moles appear in Dreadful Tunnels and Spiral Cavern. Like normal slimes they have **60 HP** and deal
**20 damage**, but they do not split. They chase from up to **5 tiles** away, and can
burrow straight through solid blocks. Each time a mole enters a block, it has a **1 in 10**
chance of destroying it. Blocks destroyed by moles drop nothing; the outer map boundary
remains intact.

### Ghosts and Grave Diggers

**Ghosts** drift slowly near gravestones, pass through walls and chase quickly when they
spot you within **4 tiles**. They can dash in a straight line for **3 tiles at twice their
chase speed**, then recharge for **7 seconds**. A Ghost deals **10 damage** on contact and
has **175 HP**: five hits from a Titanium sword. Ghosts are immune to Mercury poison.

**Grave Diggers** tend graves and occasionally dig to summon **three Ghosts** at once.
They notice you within **4 tiles** and flee until you attack them; once provoked, they
chase and fight. Their ordinary shovel attack deals **16 damage**, while a clearly marked
wind-up precedes a **60-damage spin** affecting anything on their tile or the eight
adjacent tiles, including other creatures but not the Digger itself. They have **210 HP**
and fall in six hits from an unenhanced Titanium sword. Both enemies appear in Haunted
Descent and Pitch-Black Depths.

### Infected Skeletons

In the Pitch-Black Depths, these creatures hide as **goop-covered gravestones** until you
come within **4 tiles**. After emerging, they try to keep their distance and throw bones
that deal **15 damage**; bones are stopped by walls. A skeleton has **210 HP**, so six
hits with an unenhanced T4 sword defeat it.

### Home Base stations

Click a workstation or the chest to open its menu; `Esc` or **Close** to leave. The game
pauses while a menu is open.

**The Storage Chest** keeps all resources, polished gems, Axolotls and coins safe at home. Each row shows
how many are in your bag and how many are stored. Click **Store** or **Take** to move
one item; Shift-click either button to move as many as possible. **Deposit all** and
**Take all** work across every resource. Stored resources survive cave deaths, and anything
that doesn't fit in your bag stays in the chest. Storage is included in saves and resets
when starting a new run.

**The Melter** turns Copper and Iron into matching ingots, and Bauxite into Aluminum:

1. Choose **Copper**, **Iron** or **Bauxite**, then click the **top slot** to load one.
2. Click the **bottom slot** to load **1 Coal** as fuel.
3. Click **Melt**. The menu closes, a flame bursts from the Melter, and the resulting
   ingot or Aluminum flies over to you and into your bag.

The top slot holds one kind of ore at a time. Shift-click it to return its contents before
switching types; anything that doesn't fit stays in the Melter. The Melt button needs room
in the bag for the ingot.

**The Forge** spends materials on permanent tool upgrades:

| Upgrade | Cost | Effect |
| --- | --- | --- |
| Pickaxe T1 → T2 | 3 Copper Ingots | Stone, coal and copper take 1 hit; iron takes 3 |
| Sword T1 → T2 | 3 Copper Ingots | **15** damage per hit — a normal slime or mole takes 4 hits |
| Pickaxe T2 → T3 | 3 Iron Ingots | Stone, coal and copper take 1 hit; iron takes 2 |
| Sword T2 → T3 | 3 Iron Ingots | **30** damage per hit — a normal slime or mole takes 2 hits |
| Pickaxe T3 → T4 | 3 raw Titanium | Two fewer hits than T3, minimum 1 |
| Sword T3 → T4 | 3 raw Titanium | **35** damage per hit — a newly spawned normal Golem takes 8 hits |
| Mercury edge | 3 raw Mercury, once | Permanently poison and slow enemies on sword hits; Ghosts and Venom Spiders are immune |

A tool must reach each tier before upgrading to the next. Your current tiers show on the
tool belt and in the Forge. Upgrades are kept through death; only resources in the bag are
lost. A Large Slime has 120 HP, so the 35-damage T4 sword kills it in four hits; a
newly spawned normal Golem has 270 HP with an unenhanced T4 sword and takes eight.

**The Coin Press** turns **1 raw Copper, Silver or Gold** into its matching coin. It also
turns **1 Aluminum** into an Aluminum Coin; Bauxite must first be melted into Aluminum.
The station uses materials in your bag. Pressing the first Silver, Gold or Aluminum Coin
unlocks that coin's trade at the Coin Trader.

**The Gem Polisher** converts **one raw Cobalt, Quartz, Iridium, Ruby, Calcite, Sapphire,
Black Amethyst, Amethyst or Diamond**
into one matching polished gem. Polished gems are separate inventory items: keep them,
store them, or sell them for coins.

**The Coin Trader** exchanges coins in your bag for Coal and buys Axolotls and polished gems:

| Trade | Availability |
| --- | --- |
| 2 Copper Coins → 1 Coal | Available from the start |
| 1 Silver Coin → 1 Coal | Unlock by pressing a Silver Coin |
| 1 Gold Coin → 2 Coal | Unlock by pressing a Gold Coin |
| 1 Aluminum Coin → 4 Coal | Unlock by pressing an Aluminum Coin |
| 1 Axolotl → 1 Gold Coin | Available from the start |
| 1 polished Cobalt, Quartz, Iridium, Ruby, Calcite or Sapphire → 1 Gold Coin | Available from the start |
| 1 polished Black Amethyst or Amethyst → 2 Gold Coins | Available from the start |
| 1 polished Diamond → 1 Aluminum Coin | Available from the start |

Unlocked trades remain available through death, but reset on a new run. Pressing or trading
never consumes ingredients unless the complete result fits in the bag; a stack used up by
the exchange can free a slot for its output. Polishing and selling gems use the same atomic
rule, and selling gems does not unlock the separate Gold or Aluminum Coin → Coal trade.

### Dying

When your health runs out you wake up in **Home Base** at full health, keeping **half of
each resource's total** in your bag, rounded to the nearest whole item (`round(7/2)` is 4,
`round(5/2)` is 3). Tool upgrades, unlocked coin trades, the Storage Chest, and the Melter's
currently loaded coal and ore are untouched. Coins, Aluminum and polished gems in the bag
are halved like other resources.

### Health

The player has **100 HP**. A normal slime or Drill Mole kills you in **5 hits** exactly
(100 ÷ 20), and a Tiny Slime takes 10 of them. Most hits grant 0.9 seconds of
invulnerability; a spider bite grants 0.3 seconds, making its fast attacks dangerous.
Use the reach of your sword rather than standing still and trading blows. After **4 seconds
without taking damage**, health naturally recovers **1 HP every 0.2 seconds** (5 HP per
second) up to 100. Taking damage restarts the wait; hits blocked by invulnerability do not.
Healing pauses while menus are open, and the health bar brightens when recovery begins.
Venom Spider poison deals damage only while you move, and each poison tick restarts the
healing delay.

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
  galleries and openings, Stages 3–5 connect broad chambers, Stage 6 is an open cavern with
  small rock clumps, Stage 7 forms three coils around a hidden seam, Stage 8 winds
  through grave-lined passages, Stage 9 connects dark chambers, and Stage 10 is a circular
  arena with a central pedestal. Stage 11 joins three large chambers, Stage 12 transitions
  from rocky caves to straight temple halls and a summonable shrine, and Stage 13 is an
  abandoned network of mine galleries.
- **Ore seeding** converts walls near walkable tiles into each area's rock resources; Stage 6's
  clumps are completely mineable. The outer boundary stays intact. Stage 4's stalagmites are
  separate objects placed only on floor tiles, with routes kept open for players and Large Slimes.
- **Mining** is hit-based rather than time-based. Iron, Gold, Silver and Bauxite have
  per-tier hit tables, and partial damage is remembered per tile until you leave and return.
  The shimmering Titanium seam becomes stairs when mined and resets on re-entry.
- **Area resets** restore the original terrain, ore and stalagmites generated for the current
  run on each return. Stored items, upgrades, machines and uncollected loot are preserved;
  drops or Prospectors trapped by restored obstacles are moved onto reachable floor.
- **Save files** are versioned JSON. A complete file is validated before any active state is
  replaced; loading reconstructs the visited areas without triggering their re-entry reset.
  Version-1 through version-8 saves migrate to version 9 without changing the browser-slot
  key; old Home coordinates, ground loot, cracks, the secret seam and historic Golem armour
  are preserved. In version-8 Ancient Mine terrain, Titanium, Quartz and Stone deposits
  become Diamond, Iron and Basalt respectively, including in the reset snapshot. Items
  already mined or stored, including uncollected drops, stay unchanged. Poison timers and
  partial ticks, the Warden encounter, Core unlock, Void timers, enemy variants, projectile
  types and shrine cooldown are included, with version-6 Warden health scaled proportionally
  to its new maximum.
- **Elevators** use visited area records and a saved reactivation flag. Their menu excludes
  the Special Cave, and a trip uses the same terrain reset and loot relocation as the stairs.
- **Moles** ignore interior collisions and roll once when entering a solid tile. Their
  break chance is not repeatedly applied each frame, and destroyed blocks drop nothing.
- **Prospectors** pathfind to reachable ore, carry what they mine, and switch to combat when
  the nearby player has treasure. Dynamite targets a fixed tile, with an eight-second throw
  cooldown and a two-second fuse after it lands.
- **Combat** is an arc test: a swing hits everything inside the sword's range whose angle
  is within the arc of your aim (overlapping enemies can always be struck). Golems count
  actual movement and pause without contact damage after ten tiles, or twenty for Ancient
  Golems. Mercury poison slows enemies and ticks on elapsed time; player poison counts
  actual voluntary travel. The Warden has three telegraphed attack patterns, repeating
  spike damage and a boss HUD. Natural enemy caps and spawn rates are higher across
  eligible floors.
  Damage numbers and enemy health bars are drawn in world space.
- **Coins and gems** are exchanged atomically against a copy of the bag, then committed only
  if the output fits. Unlocks live for the current run and are not lost on death; Axolotl
  sales use the same rule. Ghost dash state, Grave Digger wind-ups, Skeleton emergence
  and bone projectiles are saved as well.
- **Splitting** makes two regular slimes from a Large Slime, and two tinies from a regular
  slime. A swing snapshots the enemy list first, so newly spawned slimes cannot be damaged
  by the blow that made them.
- **Lighting** is an offscreen darkness layer punched through with radial gradients at the
  player and each lantern. Home Base is lit softly; the Pitch-Black Depths have a tighter
  player light and less ambient light than the other caves.
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
MiningSim.spiders          // live Spiders, Crabocks and Venom Spiders
MiningSim.golems           // live Golems, including Ancient Golems
MiningSim.ghosts           // live Ghosts
MiningSim.graveDiggers     // live Grave Diggers
MiningSim.infectedSkeletons // live Infected Skeletons and normal Skeletons
MiningSim.boneProjectiles  // active bones in the current area
MiningSim.warden           // current Warden encounter, or null
MiningSim.activateVoidPower() // activate the unlocked Core
MiningSim.useGolemShrine() // summon the nearby Temple guardian
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
MiningSim.polishGem('ruby')  // polish one Ruby at Home Base
MiningSim.sellPolishedGem('ruby') // sell it for one Gold Coin
MiningSim.upgradeTool('pickaxe')
MiningSim.halveResources() // the death penalty, on demand
```
