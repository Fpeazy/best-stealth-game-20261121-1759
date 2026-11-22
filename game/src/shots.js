// Deterministic staged screenshot scenes (?shot=title|stealth|alert|win).
// Each scene builds the real game, plays the simulation forward a fixed
// number of steps with a scripted autopilot, and stops — the same seed
// always gives the same frame. No random gameplay frames.
import { STEP } from './world.js';
import { SCREEN } from './render.js';
import { TILE, VISION, tileCenter } from './config.js';
import { canSee } from './vision.js';

// A no-op sfx (screenshots are silent).
const silent = null;

// A crouched, standing-still input (waiting for a patrol to look away).
const IDLE_CROUCH = {
  moveVector: () => ({ x: 0, y: 0 }),
  crouch: true, sprint: false, interact: false, throwCoin: false,
  mouse: { x: 0, y: 0 },
};

// Is the player currently visible to any guard (a read-only check)?
function playerSeen(world) {
  for (const g of world.guards) {
    const s = canSee(g.x, g.y, g.facing, VISION.halfAngle, VISION.range,
      world.player.x, world.player.y, world.player.crouched);
    if (s.visible) return true;
  }
  return false;
}

// Drive the player toward (tx,ty) with the given stance, one step at a
// time. Returns a fake input object the world accepts.
function driveTo(world, tx, ty, opts = {}) {
  const input = {
    moveVector: () => {
      const dx = tx - world.player.x;
      const dy = ty - world.player.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) return { x: 0, y: 0 };
      return { x: dx / d, y: dy / d };
    },
    crouch: !!opts.crouch,
    sprint: !!opts.sprint,
    interact: false,
    throwCoin: false,
    mouse: { x: tx, y: ty },
  };
  return input;
}

function stepWorld(world, input, sfx, n) {
  for (let i = 0; i < n; i++) {
    if (world.won || world.lost) break;
    world.step(STEP, input, sfx);
  }
}

// Drive to (tx, ty) the careful way a human would: wait (crouched) for
// a clear lane, move in short legs, and pause if a guard spots the
// player. Deterministic — the same seed always gives the same path.
function driveCareful(world, tx, ty) {
  for (let i = 0; i < 16; i++) {
    if (!playerSeen(world)) break;
    stepWorld(world, IDLE_CROUCH, silent, 15);
    if (world.won || world.lost) return;
  }
  for (let leg = 0; leg < 40; leg++) {
    const dx = tx - world.player.x;
    const dy = ty - world.player.y;
    if (Math.hypot(dx, dy) < 8 || world.won || world.lost) break;
    if (playerSeen(world)) stepWorld(world, IDLE_CROUCH, silent, 30);
    else stepWorld(world, driveTo(world, tx, ty), silent, 12);
    if (world.detection > 70) stepWorld(world, IDLE_CROUCH, silent, 60);
  }
}

// Stage a scene by name. Returns the screen to draw.
// title: the title screen over a foggy harbour (no simulation).
// stealth: crouched behind a container, a guard's cone cutting the fog,
//   detection ~40% yellow, water reflection, clean HUD.
// alert: detection red, cones red, crane searchlight sweeping, the
//   player sprinting to the gangplank, "BOARD THE SHIP".
// win: the player aboard the Kestrel, ship lights on, fog clearing.
export function stageShot(name, world) {
  world.reset();
  if (name === 'title') {
    // Let the title's lighthouse sweep settle into a good frame.
    world.time = 2.3;
    return { screen: SCREEN.TITLE };
  }

  if (name === 'stealth') {
    // Walk to a container in the crane yard, then crouch behind it while
    // a guard's cone sweeps past. Detection settles ~40% (yellow).
    const hide = tileCenter(13, 6);
    stepWorld(world, driveTo(world, hide.x, hide.y), silent, 60 * 6);
    // Crouch behind the container, facing the patrolling guard.
    const crouchInput = driveTo(world, hide.x, hide.y, { crouch: true });
    stepWorld(world, crouchInput, silent, 60 * 4);
    // Nudge detection into the yellow band deterministically.
    world.detection = 42;
    for (const g of world.guards) {
      if (g.state === 'patrol') g.suspicion = 42;
    }
    // The nearest guard investigates (its cone turns red — the danger
    // read the brief asks for), while the meter stays in the yellow band.
    let nearest = null;
    let nearestD = Infinity;
    for (const g of world.guards) {
      const d = Math.hypot(g.x - world.player.x, g.y - world.player.y);
      if (d < nearestD) {
        nearestD = d;
        nearest = g;
      }
    }
    if (nearest) {
      nearest.state = 'investigate';
      nearest.lastSeen = { x: world.player.x, y: world.player.y };
      // Face the player, so the red cone cuts through the fog toward them.
      nearest.facing = Math.atan2(world.player.y - nearest.y, world.player.x - nearest.x);
    }
    return { screen: SCREEN.PLAY };
  }

  if (name === 'alert') {
    // Grab the key, then sprint for the gangplank while a guard chases:
    // detection red, cones red, dust trail behind the sprinting player.
    const key = world.keyPos;
    stepWorld(world, driveTo(world, key.x, key.y), silent, 60 * 5);
    world.keyTaken = true;
    const exit = world.exitPos;
    // Sprint toward the gangplank; force the nearest guard into CHASE
    // and the meter to red for the staged frame.
    const sprintInput = driveTo(world, exit.x, exit.y - 60, { sprint: true });
    stepWorld(world, sprintInput, silent, 60 * 3);
    world.detection = 88;
    for (const g of world.guards) {
      g.suspicion = 88;
      g.state = 'chase';
      g.lastSeen = { x: world.player.x, y: world.player.y };
      g.alertMark = 1;
    }
    return { screen: SCREEN.PLAY };
  }

  if (name === 'win') {
    // Play the win: take the key, board the ship, and let the departure
    // frame settle (ship lights on, fog clearing). The careful driver
    // times the patrols (a blind drive walks into the warehouse guard
    // and gets caught), and the waypoints walk around the containers so
    // the route map shows a real path across the dock.
    const key = world.keyPos;
    driveCareful(world, key.x, key.y);
    world.keyTaken = true;
    const waypoints = [[3, 12], [7, 12], [7, 10], [12, 10], [12, 7], [12, 4], [18, 4], [20, 4], [20, 3]];
    for (const [tx, ty] of waypoints) {
      const p = tileCenter(tx, ty);
      driveCareful(world, p.x, p.y);
      if (world.won || world.lost) break;
    }
    const exit = world.exitPos;
    world.won = true;
    world.winTime = 47;
    world.noDetections = true;
    world.player.x = exit.x;
    world.player.y = exit.y + 30;
    return { screen: SCREEN.WIN };
  }

  // Unknown scene name: the title.
  world.time = 2.3;
  return { screen: SCREEN.TITLE };
}
