// SHADOW DOCK — boot, game loop, screens and the ?shot= staged scenes.
// A night port heist: steal the ignition key, board the Kestrel, escape
// unseen. Top-down, Canvas 1280x720, one screen, no camera, no procgen.
import { WIDTH, HEIGHT } from './config.js';
import { World, STEP } from './world.js';
import { Renderer, SCREEN } from './render.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { stageShot } from './shots.js';

const canvas = document.getElementById('game');
// Size the canvas FIRST: setting width/height clears it, so this must
// happen before any draw (in particular before a staged ?shot= frame).
canvas.width = WIDTH;
canvas.height = HEIGHT;
const statusEl = document.getElementById('status');
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const sfx = new Sfx();
const world = new World(1);

let screen = SCREEN.TITLE;
let accumulator = 0;
let lastTime = 0;
let started = false;

// A staged screenshot scene (?shot=title|stealth|alert|win&seed=1):
// build the real game, play it forward a fixed number of steps, stop.
// The same seed always gives the same frame. No input is read.
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
if (shotName) {
  const seed = Number(params.get('seed') || 1);
  world.seed = seed;
  const staged = stageShot(shotName, world);
  screen = staged.screen;
  // Draw one deterministic frame and stop (no loop, no input).
  renderer.draw(world, screen);
  announce(screen);
} else {
  // Real gameplay: fixed-step simulation, requestAnimationFrame render.
  requestAnimationFrame(function frame(t) {
    const dt = Math.min(0.1, (t - lastTime) / 1000 || 0);
    lastTime = t;
    accumulator += dt;
    let guard = 0;
    while (accumulator >= STEP && guard < 5) {
      accumulator -= STEP;
      guard++;
      tick(STEP);
    }
    renderer.draw(world, screen);
    input.endFrame();
    requestAnimationFrame(frame);
  });
}

function announce(s) {
  const text = {
    [SCREEN.TITLE]: 'SHADOW DOCK. A night port heist. Press Enter to start.',
    [SCREEN.PLAY]: world.keyTaken
      ? 'Objective: board the Kestrel. Reach the gangplank unseen.'
      : 'Objective: steal the ignition key from the warehouse office.',
    [SCREEN.PAUSE]: 'Paused.',
    [SCREEN.CAUGHT]: 'Caught. A guard caught you on the dock.',
    [SCREEN.WIN]: 'Mission complete. You escaped aboard the Kestrel.',
  }[s] || '';
  if (statusEl) statusEl.textContent = text;
}

function tick(dt) {
  if (screen === SCREEN.TITLE) {
    world.time += dt;
    if (input.confirm) {
      started = true;
      screen = SCREEN.PLAY;
      sfx.ensure();
      sfx.foghorn();
      announce(screen);
    }
    return;
  }
  if (screen === SCREEN.PAUSE) {
    if (input.pause || input.confirm) {
      screen = SCREEN.PLAY;
      announce(screen);
    }
    if (input.wasPressed('r')) {
      world.reset();
      screen = SCREEN.PLAY;
      announce(screen);
    }
    if (input.wasPressed('q')) {
      world.reset();
      screen = SCREEN.TITLE;
      announce(screen);
    }
    return;
  }
  if (screen === SCREEN.CAUGHT) {
    if (input.confirm) {
      world.reset();
      screen = SCREEN.PLAY;
      announce(screen);
    }
    if (input.wasPressed('q')) {
      world.reset();
      screen = SCREEN.TITLE;
      announce(screen);
    }
    return;
  }
  if (screen === SCREEN.WIN) {
    world.time += dt;
    if (input.confirm) {
      world.reset();
      screen = SCREEN.PLAY;
      announce(screen);
    }
    if (input.wasPressed('q')) {
      world.reset();
      screen = SCREEN.TITLE;
      announce(screen);
    }
    return;
  }
  // PLAY.
  if (input.pause) {
    screen = SCREEN.PAUSE;
    announce(screen);
    return;
  }
  world.step(dt, input, sfx);
  if (world.won) {
    screen = SCREEN.WIN;
    sfx.win();
    sfx.engine();
    announce(screen);
  } else if (world.lost) {
    screen = SCREEN.CAUGHT;
    announce(screen);
  } else if (input.wasPressed('r')) {
    world.reset();
    announce(screen);
  }
}
