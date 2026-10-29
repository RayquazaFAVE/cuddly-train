# Cuddly Express 🚂

A cozy little night-train game that runs in the browser. You steer a train through a
moonlit meadow with your mouse, scoop up small animals who are out too late, and dodge
boulders and prickly bushes. Every passenger hops aboard, and every few passengers you
pick up adds a carriage — which means a longer train and a bigger thing to keep out of
trouble.

No dependencies, no build step. Just open `index.html`.

## Playing it

Serving the folder is enough:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

Or just open `index.html` directly in a browser.

| Action | Control |
| --- | --- |
| Steer the train | Move your mouse (or finger, on a touchscreen) — the engine chases the cursor and the carriages follow on a rail |
| Pause / resume | `Esc` or `P` (also happens automatically if the window loses focus) |
| Mute | The ♪ button, or `M` |
| Start / restart | The on-screen button, or `Space` / `Enter` |

## How scoring works

- Each animal is worth **10 points × your multiplier**.
- Your multiplier climbs with a combo: every 4 pickups in a row bumps it, up to **×8**.
- The combo cools off after ~3.6 seconds without a pickup, so keep moving.
- Every 6 passengers you carry earns a **+250 bonus**.
- You start with three hearts. Hitting a boulder or a bush costs one heart and shakes
  a few passengers loose. Lose all three and the ride ends.
- Your best score is saved in `localStorage`.

## Fairness details

Spawning is deliberately un-cheap: obstacles get a moment of grace before they can hit
you, they can never collide with you right at the top edge of the screen, and they prefer
to spawn away from your column when you are sitting high up and would have little time to
react. Passengers drift into view quickly and only lean toward the train once they are
actually on screen, so you are never chasing something you cannot see.

## What's in here

```
index.html        page shell, HUD and the three overlay screens
css/style.css     all styling — gradients, panels, buttons, responsive tweaks
js/game.js        the whole game: loop, physics, spawning, drawing, audio
```

A few notes on the implementation:

- **Rendering** is Canvas 2D, drawn every frame from scratch. The background, moonlight,
  grass, flowers and fireflies are all procedural — there are no image assets at all.
- **The train** is a chain of segments: the engine chases the pointer, and each carriage
  is pulled to a fixed distance behind the one in front of it. The visible track is a
  fading history of the engine's path, which is why the rails curve behind you.
- **The animals** are drawn from primitives in `drawCritter()` — body, ears (four styles:
  round, pointy, long, frog), eyes, cheeks and a little smile. Each species is an entry in
  the `CRITTERS` table, so adding a new animal is a few lines.
- **Sound** is synthesised with the Web Audio API (pickups, hits, milestones, the game-over
  fanfare) so there are no audio files to load. It starts silently-safe: audio only begins
  after your first click, per browser autoplay rules.
- **Accessibility**: keyboard start/pause, a mute toggle, `aria-label`s on the controls, and
  screen shake is disabled when the system asks for reduced motion.

## Poking at it

The game exposes a small debug handle from the console:

```js
CuddlyExpress.state          // score, hearts, combo, mode, ...
CuddlyExpress.train.segs     // the carriages
CuddlyExpress.obstacles      // what is currently falling
CuddlyExpress.passengers     // who is currently drifting by
CuddlyExpress.start()        // skip the title screen
```
