# SHADOW DOCK — a night port heist

[![make.fun](https://make.fun/badge/best-stealth-game-20261121-1759.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759)
[![rank](https://make.fun/badge/best-stealth-game-20261121-1759/Fpeazy/best-stealth-game-20261121-1759/rank.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759)
[![reward](https://make.fun/badge/best-stealth-game-20261121-1759/Fpeazy/best-stealth-game-20261121-1759/reward.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759)

A top-down stealth game set in a night harbour. Steal the ship's
ignition key from the space-station control room (the warehouse office,
re-themed as a futuristic control room with an airlock door, hologram
walls and a console pedestal), then board the moored ship **Kestrel**
and escape unseen — past four patrolling guards, a sweeping crane
searchlight, and the fog.

## What is new in the revision (22 Nov 2026)

- **Futuristic neon** — a dark `#0B0E14` base with cyan / magenta /
  amber neon: a holographic title, a "KESTREL DOCK" sign, neon strips
  on the containers, a neon ship hull line with a thruster glow, neon
  water reflections, and cyan cone edge-glow on patrol.
- **Talk system** — guards bark by state ("All clear. Night shift
  drags.", "Halt! Who's there?", "Intruder! Sound the alarm!") and the
  player answers ("Key's in the office.", "Board the Kestrel. Now.",
  "Clean getaway."), in tidy speech bubbles (max 220px, tail, pop-in +
  typing + hold + fade, auto-hide 3.5s, collision-avoid, cone priority).
- **Scoring system** — thousand-scale: +10/sec undetected, loot
  (Manifest Kargo +500, Log Kapal +750, Kunci Cadangan +1,000), time
  bonus, +5,000 no-detection bonus, +200 per effective noise bolt,
  clean-run multiplier ×1.5, grades S / A / B / C. The live score is
  top-right; the win screen shows the full 6-row breakdown.
- **Space-station control room** — the office (bottom-left, key at
  tile (3,14)) is a control room: metallic floor, neon-cyan airlock
  frame with a magenta seal, hologram walls with a rotating schematic
  ring, and a spinning hologram key on a console pedestal.
- **More objects** — ~24 decor pieces (barrels, pallets, bollards,
  dock lamps, buoys, rope coils) that never block the objective path
  or a guard route, plus richer tiles, fog and UI.
- **Varied lights + shooting effects** — dock lamps (flicker), neon
  strips (pulse), warning beacons (blink), deck lights, a ship light;
  a warning shot (muzzle flash + tracer + sparks) and a red flare,
  visual only — the lose condition is unchanged.
- **Player movement** — smoother and more responsive: acceleration /
  deceleration, distinct crouch / walk / sprint feel, stance-dependent
  walk-bob, a sprint trail and a sprint noise ring, and an interaction
  prompt ("E — TAKE THE IGNITION KEY", ...).
- **Smarter guard AI** — waypoint pauses, natural turning, last-seen
  memory, a real search, and alerts that propagate: a guard entering
  CHASE turns nearby guards SUSPECT toward the same last-seen spot.
  Deterministic — the staged screenshots are reproducible.
- **Stealth + detection** — the dynamic HIDDEN / SPOTTED / SEEN label,
  a readable detection ring, clear cone colours, the Bresenham raycast
  (unchanged), and a real lit / shadow system: the player's own
  flashlight does not light them, a LIT / SHADOW HUD indicator shows
  the state, and the thrown coin pulls guards to investigate.

## How to play

- **WASD / arrows** — move (smooth acceleration, not instant)
- **C** — crouch (slow, quiet, harder to see; hides behind crates)
- **Shift** — sprint (fast, noisy, leaves a dust trail)
- **Click** — throw a noise bolt (3 only; guards investigate the sound)
- **E** — interact (take the key, sabotage the breaker, board the ship)
- **P** — pause, **R** — restart

Guards have vision cones (raycast against the tilemap, not a distance
check). The detection meter fills faster when you are lit and central
in a cone, and drains when hidden. Containers block cones completely;
crates hide you only while crouched. Water slows you and splashes.

## The engine

A custom vanilla TypeScript + Canvas engine, no libraries, no network:
game loop, input, tile collision, guard AI (patrol → suspect →
investigate → search → chase → return), Bresenham vision raycast,
single-pass night lighting (fog-of-war, god rays, water reflections),
particles, and synthesized Web Audio. One deep level, 32×18 tiles.

## Screenshots

Four deterministic staged scenes (`?shot=title|stealth|alert|win`):
the title, the core stealth moment, the alert/chase, and the win on
the ship. The same seed always gives the same frame.

## Play it

```sh
node serve.ts   # serves game/ on http://localhost:8080
```

## Hand-in

`main.ts` (Node 22) copies `game/` and `screenshots/` to `/output` and
writes `/output/dossier.json` with the vendored make.fun library.
