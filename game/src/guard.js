// Guard AI: a state machine — PATROL -> SUSPECT -> INVESTIGATE ->
// SEARCH -> CHASE -> RETURN. Movement is smooth: guards accelerate
// toward their target speed, turn toward their heading gradually
// (natural turning), and pause at waypoints. Suspicion is shown by a
// head-sweep (the guard scans left/right) and an exclamation mark when
// the player is spotted. Deterministic: same inputs, same behaviour.
import { GUARD, VISION, DETECTION, tileCenter } from './config.js';
import { canSee, coneCentrality } from './vision.js';

export const GSTATE = {
  PATROL: 'patrol',
  SUSPECT: 'suspect',
  INVESTIGATE: 'investigate',
  SEARCH: 'search',
  CHASE: 'chase',
  RETURN: 'return',
};

const WAYPOINT_PAUSE = 1.2; // seconds a guard waits at each waypoint
const TURN_RATE = 5.0; // radians per second the guard can turn
const ACCEL = 260; // px/s^2 toward the target speed

// Shortest signed angle difference, in (-PI, PI].
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export class Guard {
  constructor(route, index) {
    this.route = route; // array of [tileX, tileY] waypoints
    this.index = index;
    const start = tileCenter(route[0][0], route[0][1]);
    this.x = start.x;
    this.y = start.y;
    this.vx = 0;
    this.vy = 0;
    this.facing = 0;
    this.state = GSTATE.PATROL;
    this.waypoint = 1 % route.length;
    this.pause = 0;
    this.suspicion = 0; // 0..100, per-guard suspicion (feeds the meter)
    this.lastSeen = null; // {x, y} of the last seen player position
    this.searchTime = 0;
    this.sweepPhase = 0; // head-sweep animation phase when suspicious
    this.alertMark = 0; // seconds the "!" mark shows above the guard
    this.stepPhase = 0; // footstep cycle (drives dust + sound)
    this.stuckTime = 0;
    // Static guards (one waypoint) face a fixed direction.
    this.static = route.length === 1;
    if (this.static) this.facing = Math.PI / 2; // face down the dock
  }

  get speed() {
    switch (this.state) {
      case GSTATE.PATROL: return GUARD.patrol;
      case GSTATE.SUSPECT: return GUARD.suspect;
      case GSTATE.INVESTIGATE: return GUARD.investigate;
      case GSTATE.SEARCH: return GUARD.search;
      case GSTATE.CHASE: return GUARD.chase;
      default: return GUARD.patrol;
    }
  }

  // Turn the facing angle toward `target` at most TURN_RATE * dt.
  turnToward(target, dt) {
    const d = angleDiff(this.facing, target);
    const max = TURN_RATE * dt;
    if (Math.abs(d) <= max) this.facing = target;
    else this.facing += Math.sign(d) * max;
  }

  // Move toward (tx, ty) with acceleration; returns the distance left.
  moveToward(tx, ty, dt, speed) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return 0;
    const wantX = (dx / dist) * speed;
    const wantY = (dy / dist) * speed;
    // Accelerate toward the wanted velocity (smooth, not instant).
    this.vx += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, wantX - this.vx));
    this.vy += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, wantY - this.vy));
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Face the movement direction.
    if (Math.hypot(this.vx, this.vy) > 5) {
      this.turnToward(Math.atan2(this.vy, this.vx), dt);
    }
    // Footstep cycle: one step per ~26px travelled.
    this.stepPhase += (Math.hypot(this.vx, this.vy) * dt) / 26;
    return dist;
  }

  // The guard's vision check against the player. Returns the detection
  // rate (per second) to add to the meter, 0 when the player is unseen.
  // `player` has x, y, crouched. `lights` is the light list for lit/shadow.
  seePlayer(player, lights, dt) {
    const seen = canSee(
      this.x, this.y, this.facing, VISION.halfAngle, VISION.range,
      player.x, player.y, player.crouched,
    );
    if (!seen.visible) return 0;
    // Lit or shadow: a point is lit when inside any light pool.
    let lit = false;
    for (const l of lights) {
      if (Math.hypot(player.x - l.x, player.y - l.y) < l.radius) {
        lit = true;
        break;
      }
    }
    const centrality = coneCentrality(
      this.x, this.y, this.facing, VISION.halfAngle, player.x, player.y,
    );
    const base = lit ? DETECTION.lit : DETECTION.shadow;
    const rate = base * (0.5 + 0.5 * centrality) * (player.crouched ? 0.5 : 1);
    this.lastSeen = { x: player.x, y: player.y };
    return rate;
  }

  // One simulation step. `ctx` carries the player, lights, noise events
  // and a callback to play sounds. Returns events for the world to act on.
  step(dt, ctx) {
    const events = [];
    // Vision: how fast is the player being detected right now?
    const rate = this.seePlayer(ctx.player, ctx.lights, dt);
    if (rate > 0) {
      this.suspicion = Math.min(100, this.suspicion + rate * dt);
      if (this.suspicion >= DETECTION.alertAt && this.state !== GSTATE.CHASE) {
        this.state = GSTATE.CHASE;
        this.alertMark = 1.2; // "!" above the guard
        events.push({ type: 'alert', guard: this });
      } else if (this.suspicion >= DETECTION.investigateAt && this.state === GSTATE.PATROL) {
        this.state = GSTATE.SUSPECT;
      }
    } else {
      this.suspicion = Math.max(0, this.suspicion - DETECTION.decay * dt);
    }

    // Noise: a coin throw or a sprint pulse pulls guards to investigate.
    for (const noise of ctx.noises) {
      const d = Math.hypot(noise.x - this.x, noise.y - this.y);
      if (d < noise.radius && this.state !== GSTATE.CHASE) {
        this.lastSeen = { x: noise.x, y: noise.y };
        if (this.state === GSTATE.PATROL || this.state === GSTATE.RETURN) {
          this.state = GSTATE.INVESTIGATE;
        }
      }
    }

    // Head-sweep: when suspicious, the guard scans left/right.
    if (this.state === GSTATE.SUSPECT) {
      this.sweepPhase += dt * 2.2;
      const sweep = Math.sin(this.sweepPhase) * 0.7;
      this.turnToward(this.facing + sweep * dt * 2, dt);
    }

    // State behaviour.
    if (this.state === GSTATE.PATROL) {
      if (this.static) {
        // Static guard: stand still, face the dock, slow scan.
        this.vx = 0;
        this.vy = 0;
        this.facing += Math.sin(ctx.time * 0.5) * 0.002;
      } else if (this.pause > 0) {
        this.pause -= dt;
        this.vx = 0;
        this.vy = 0;
      } else {
        const wp = this.route[this.waypoint];
        const target = tileCenter(wp[0], wp[1]);
        const left = this.moveToward(target.x, target.y, dt, this.speed);
        if (left < 6) {
          this.waypoint = (this.waypoint + 1) % this.route.length;
          this.pause = WAYPOINT_PAUSE;
        }
      }
    } else if (this.state === GSTATE.SUSPECT) {
      // Turn toward the last seen position, then investigate.
      if (this.lastSeen) this.turnToward(Math.atan2(this.lastSeen.y - this.y, this.lastSeen.x - this.x), dt);
      if (this.suspicion >= DETECTION.investigateAt) this.state = GSTATE.INVESTIGATE;
      else if (this.suspicion <= 5) this.state = GSTATE.RETURN;
    } else if (this.state === GSTATE.INVESTIGATE) {
      if (this.lastSeen) {
        const left = this.moveToward(this.lastSeen.x, this.lastSeen.y, dt, this.speed);
        if (left < 8) {
          this.state = GSTATE.SEARCH;
          this.searchTime = 4;
        }
      } else {
        this.state = GSTATE.SEARCH;
        this.searchTime = 4;
      }
    } else if (this.state === GSTATE.SEARCH) {
      this.searchTime -= dt;
      // Look around while searching.
      this.facing += dt * 1.5;
      if (this.searchTime <= 0) this.state = GSTATE.RETURN;
    } else if (this.state === GSTATE.CHASE) {
      if (this.lastSeen) {
        this.moveToward(this.lastSeen.x, this.lastSeen.y, dt, this.speed);
        // Caught: the guard touches the player.
        if (Math.hypot(ctx.player.x - this.x, ctx.player.y - this.y) < 24) {
          events.push({ type: 'caught', guard: this });
        }
      }
      if (this.suspicion <= 10) this.state = GSTATE.RETURN;
    } else if (this.state === GSTATE.RETURN) {
      // Walk back to the nearest waypoint, then resume patrol.
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < this.route.length; i++) {
        const c = tileCenter(this.route[i][0], this.route[i][1]);
        const d = Math.hypot(c.x - this.x, c.y - this.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const target = tileCenter(this.route[best][0], this.route[best][1]);
      const left = this.moveToward(target.x, target.y, dt, this.speed);
      if (left < 6) {
        this.waypoint = (best + 1) % this.route.length;
        this.state = GSTATE.PATROL;
      }
    }

    if (this.alertMark > 0) this.alertMark -= dt;
    return events;
  }
}
