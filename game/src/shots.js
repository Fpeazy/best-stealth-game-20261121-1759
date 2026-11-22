// Deterministic staged screenshot scenes (?shot=title|stealth|alert|win).
// Each scene builds the real game, plays the simulation forward a fixed
// number of steps with a scripted autopilot, and stops — the same seed
// always gives the same frame. No random gameplay frames.
import { STEP } from './world.js';
import { SCREEN } from './render.js';
import { TILE, VISION, tileCenter } from './config.js';
import { canSee } from './vision.js';
import { TALK_LINES, emotionFor } from './talk.js';

// A no-op sfx (screenshots are silent).
const silent = null;

// A crouched, standing-still input (waiting for a patrol to look away).
const IDLE_CROUCH = {
  moveVector: () => ({ x: 0, y: 0 }),
  crouch: true, sprint: false, interact: false, throwCoin: false,
  mouse: { x: 0, y: 0 },
};

// Round 2 (12:05 WIB): the careful driver treats "near a cone" as
// "seen" — a safety margin, because the guards MOVE during a leg and
// crouching only halves the detection RATE, not the vision range (see
// guard.js seePlayer: crouched x0.5 on the rate, full 210px range).
// Without the margin, a guard's cone sweeps onto the player mid-leg and
// the +5000 no-detection bonus is lost on a 0.1 suspicion blip.
// The margin (range +50px, half-angle +0.15 rad) covers a guard moving
// ~11px per leg plus the player's own movement.
const MARGIN_RANGE = 50;
const MARGIN_ANGLE = 0.3;

// A guard's cone also sweeps toward its movement direction while it
// turns at a waypoint — a waiting player in the sweep path gets caught
// even though the CURRENT facing is safe (G2's turn at (11,15) swept
// its cone onto a stationary player at row 10, t=7.85). So check BOTH
// the current facing and the movement-direction facing.
function guardCovers(g, x, y, crouched) {
  if (canSee(g.x, g.y, g.facing, VISION.halfAngle + MARGIN_ANGLE, VISION.range + MARGIN_RANGE, x, y, crouched).visible) return true;
  const sp = Math.hypot(g.vx || 0, g.vy || 0);
  if (sp > 1) {
    const mf = Math.atan2(g.vy, g.vx);
    if (canSee(g.x, g.y, mf, VISION.halfAngle + MARGIN_ANGLE, VISION.range + MARGIN_RANGE, x, y, crouched).visible) return true;
  }
  return false;
}

// Is the player currently visible to any guard (a read-only check)?
// Uses the safety margin: near a cone counts as seen.
function playerSeen(world) {
  for (const g of world.guards) {
    if (guardCovers(g, world.player.x, world.player.y, world.player.crouched)) return true;
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

// Is the point (x,y) currently visible to any guard (a read-only check)?
// The careful driver waits until the DESTINATION is unseen, so it never
// walks into a cone (any exposure loses the no-detection bonus).
function targetSeen(world, tx, ty) {
  for (const g of world.guards) {
    if (guardCovers(g, tx, ty, false)) return true;
  }
  return false;
}

// Would the player be visible after the next short leg toward (tx,ty)?
// A 1-leg lookahead: the driver checks where it will be, not just where
// it is, so it never steps into a cone's edge mid-leg.
function futureSeen(world, tx, ty) {
  const p = world.player;
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 8) return false;
  // 12 steps at walk speed (112px/s) = ~22px toward the target.
  const nx = p.x + (dx / d) * 22;
  const ny = p.y + (dy / d) * 22;
  for (const g of world.guards) {
    if (guardCovers(g, nx, ny, false)) return true;
  }
  return false;
}

// Drive to (tx, ty) the careful way a human would: wait (crouched) for
// a clear lane, move in short legs, and pause if a guard spots the
// player. Deterministic — the same seed always gives the same path.
function driveCareful(world, tx, ty) {
  // Wait longer for a clear window (up to 20s): with the safety margin
  // the driver must not proceed into a marginal lane, and a guard loop
  // takes ~15s, so a clear window needs a longer wait. The waits step
  // 2 steps at a time so a sweeping cone is caught before it lands.
  for (let i = 0; i < 600; i++) {
    if (!playerSeen(world) && !targetSeen(world, tx, ty) && !futureSeen(world, tx, ty)) break;
    stepWorld(world, IDLE_CROUCH, silent, 2);
    if (world.won || world.lost) return;
  }
  // Move in 2-step chunks (not 12): a guard turns 5 rad/s, so in a
  // 12-step chunk its cone sweeps a full radian and can land on the
  // player mid-chunk. At 2 steps the sweep is 0.17 rad, inside the
  // 0.30 rad margin, so the check-before-every-chunk stays valid.
  for (let leg = 0; leg < 300; leg++) {
    const dx = tx - world.player.x;
    const dy = ty - world.player.y;
    if (Math.hypot(dx, dy) < 8 || world.won || world.lost) break;
    if (playerSeen(world) || targetSeen(world, tx, ty) || futureSeen(world, tx, ty)) stepWorld(world, IDLE_CROUCH, silent, 2);
    // The win driver crouches while moving: a crouched player is seen
    // at half the detection rate, so the patrol crossings stay safe.
    else stepWorld(world, driveTo(world, tx, ty, { crouch: true }), silent, 2);
    if (world.detection > 70) stepWorld(world, IDLE_CROUCH, silent, 2);
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
    // Walk to a container in the crane yard, then crouch beside it while
    // a guard's cone sweeps past. Detection settles ~40% (yellow).
    // The hide is 1 tile west of the container, so the player reads
    // beside it (not fully behind it) at contact-sheet size.
    const hide = tileCenter(12, 6);
    stepWorld(world, driveTo(world, hide.x, hide.y), silent, 60 * 6);
    // Crouch beside the container, facing the patrolling guard.
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
    // Talk bubbles (staged, fully typed): a patrolling guard's line +
    // the player's objective line. The investigating guard has no bubble
    // (the queue shows one guard bubble; the red cone still reads danger).
    let patrolGuard = null;
    let farthestD = -1;
    for (const g of world.guards) {
      if (g.state !== 'patrol') continue;
      const d = Math.hypot(g.x - world.player.x, g.y - world.player.y);
      if (d > farthestD) {
        farthestD = d;
        patrolGuard = g;
      }
    }
    if (patrolGuard) {
      world.talk.stage(emotionFor('patrol') + TALK_LINES.guardPatrol, patrolGuard.x, patrolGuard.y - 56, 'guard', 'guard');
    }
    world.talk.stage(TALK_LINES.playerObj1, world.player.x, world.player.y - 56, 'player', 'player');
    return { screen: SCREEN.PLAY };
  }

  if (name === 'alert') {
    // Grab the key, then sprint for the gangplank while guards chase:
    // detection red, cones red, dust trail behind the sprinting player.
    const key = world.keyPos;
    stepWorld(world, driveTo(world, key.x, key.y), silent, 60 * 5);
    world.keyTaken = true;
    const exit = world.exitPos;
    // Sprint toward the gangplank; the 2 nearest guards go to CHASE and
    // the meter to red for the staged frame (the others investigate, so
    // the cones stay distinct instead of a muddy red wash).
    const sprintInput = driveTo(world, exit.x, exit.y - 60, { sprint: true });
    stepWorld(world, sprintInput, silent, 60 * 3);
    world.detection = 88;
    const byDist = [...world.guards].sort((a, b) => {
      const da = Math.hypot(a.x - world.player.x, a.y - world.player.y);
      const db = Math.hypot(b.x - world.player.x, b.y - world.player.y);
      return da - db;
    });
    byDist.forEach((g, i) => {
      g.lastSeen = { x: world.player.x, y: world.player.y };
      if (i < 2) {
        g.suspicion = 88;
        g.state = 'chase';
        g.alertMark = 1;
      } else if (i === 2) {
        g.suspicion = 70;
        g.state = 'investigate';
      } else {
        g.suspicion = 50;
        g.state = 'suspect';
      }
    });
    // The nearest guard's cone is rotated -15 deg so it does not cover
    // the player.
    const nearest = byDist[0];
    nearest.facing = Math.atan2(world.player.y - nearest.y, world.player.x - nearest.x) - 0.26;
    // Shooting effects (visual only): a warning shot + a red flare.
    world.shotFx.flash = { x: nearest.x, y: nearest.y, life: 0.08, maxLife: 0.08 };
    world.shotFx.tracer = { x1: nearest.x, y1: nearest.y, x2: world.player.x, y2: world.player.y, life: 0.25, maxLife: 0.25 };
    world.shotFx.flare = { x: nearest.x, y: nearest.y - 30, vy: -20, life: 2.5, maxLife: 2.5 };
    // Talk bubbles (staged, fully typed): the chase bark + the player's line.
    world.talk.stage(emotionFor('chase') + TALK_LINES.guardChase, nearest.x, nearest.y - 56, 'guard', 'guard');
    world.talk.stage(TALK_LINES.playerObj2, world.player.x, world.player.y - 56, 'player', 'player');
    return { screen: SCREEN.PLAY };
  }

  if (name === 'win') {
    // Play the win: take the key, board the ship, and let the departure
    // frame settle (ship lights on, fog clearing). The careful driver
    // times the patrols (a blind drive walks into the warehouse guard
    // and gets caught), and the waypoints walk around the containers so
    // the route map shows a real path across the dock — via all 3 loot
    // tiles (and over the deck, around the gangplank guard), so the
    // staged win shows the computed Grade S score.
    const key = world.keyPos;
    driveCareful(world, key.x, key.y);
    world.keyTaken = true;
    const waypoints = [[3, 12], [6, 12], [7, 12], [7, 10], [12, 10], [12, 7], [12, 4], [17, 4], [18, 4], [19, 3], [24, 3], [24, 4], [20, 3]];
    for (const [tx, ty] of waypoints) {
      const p = tileCenter(tx, ty);
      driveCareful(world, p.x, p.y);
      if (world.won || world.lost) break;
    }
    const exit = world.exitPos;
    world.won = true;
    // The timer is the staged run's REAL time (computed, not hardcoded).
    world.winTime = Math.round(world.time);
    world.noDetections = world.score.noDetection;
    world.player.x = exit.x;
    world.player.y = exit.y + 30;
    return { screen: SCREEN.WIN };
  }

  // Unknown scene name: the title.
  world.time = 2.3;
  return { screen: SCREEN.TITLE };
}
