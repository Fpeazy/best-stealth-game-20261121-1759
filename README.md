# SHADOW DOCK — a night port heist

[![make.fun](https://make.fun/api/badge/best-stealth-game-20261121-1759)](https://make.fun/bounty/best-stealth-game-20261121-1759)
[![make.fun](https://make.fun/api/badge/best-stealth-game-20261121-1759/entries)](https://make.fun/bounty/best-stealth-game-20261121-1759)
[![make.fun](https://make.fun/api/badge/best-stealth-game-20261121-1759/prize)](https://make.fun/bounty/best-stealth-game-20261121-1759)

A top-down stealth game set in a night harbour. Steal the ship's
ignition key from the warehouse office, then board the moored ship
**Kestrel** and escape unseen — past four patrolling guards, a sweeping
crane searchlight, and the fog.

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
