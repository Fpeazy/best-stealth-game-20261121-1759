// SHADOW DOCK — the entrypoint (Node 22, standard library only).
// A night port stealth game: steal the ship's ignition key from the
// space-station control room, then board the moored ship Kestrel and
// escape unseen. The game is the game/ folder beside this file: plain
// static files a desktop browser loads offline (game/index.html and its
// ES modules, no library, no network request). This program hands it in:
// it copies game/ and screenshots/ to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library.
//
// REVISION (22 Nov 2026): futuristic neon art, a talk system (guard
// barks + player lines in tidy bubbles), a thousand-scale scoring system
// (loot, undetected seconds, time bonus, gadget efficiency, clean-run
// multiplier, grades S/A/B/C), a space-station control room, more
// objects, varied lights + shooting effects, smoother player movement
// (stance-dependent walk-bob, interaction prompts), smarter guard AI
// (alerts propagate to nearby guards, last-seen memory), and a lit /
// shadow detection system (the player's own flashlight does not light
// them; a LIT/SHADOW HUD indicator shows the state).
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The output directory holds game/, screenshots/ and dossier.json.
mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps (from this competition's gate), passed through so
// the entry is refused here rather than at the scorer: the dossier's text
// budget is 160 KiB; at most 4 screenshots, each at most 256 KiB; the
// game/ tree at most 993 files and 48 MiB in all, with no path under
// game/ over 1000 bytes. The 4 screenshots are deterministic staged
// scenes (?shot=title|stealth|alert|win, seed 1) rendered from the real
// game, so the same seed always gives the same frame.
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(out, 'dossier.json'), dossier);
