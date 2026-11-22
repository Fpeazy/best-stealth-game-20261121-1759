// The world: level state, the player (with smooth acceleration and
// distinct crouch/walk/sprint feel), collision, detection, objectives,
// particles and the fixed-step simulation. Deterministic: step(dt) with
// the same inputs always gives the same state.
import {
  TILE, COLS, ROWS, PLAYER, NOISE, DETECTION, LIGHT, CRANE,
  LEVEL, levelAt, tileCenter, isSolidTile, isWaterTile, T,
} from './config.js';
import { Guard, GSTATE } from './guard.js';
import { GUARD_ROUTES } from './config.js';
import { solidAtPixel } from './vision.js';
import { mulberry32 } from './random.js';

export const STEP = 1 / 60; // fixed simulation step

// Find a tile of kind `ch` in the level; returns {x, y} tile coords.
function findTile(ch) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (LEVEL[y][x] === ch) return { x, y };
    }
  }
  return { x: 1, y: 1 };
}

export class World {
  constructor(seed = 1) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.time = 0;
    this.reset();
  }

  reset() {
    this.rng = mulberry32(this.seed);
    this.time = 0;
    const spawn = findTile(T.SPAWN);
    const sc = tileCenter(spawn.x, spawn.y);
    this.player = {
      x: sc.x, y: sc.y, vx: 0, vy: 0,
      facing: -Math.PI / 2, // face up the dock
      crouched: false, sprinting: false, moving: false,
      speed: 0, stepPhase: 0, stepIndex: 0,
      bob: 0, // walk-bob offset (pixels), synced to steps
      trail: [], // sprint motion-trail positions [{x,y,age}]
      inWater: false,
    };
    this.guards = GUARD_ROUTES.map((route, i) => new Guard(route, i));
    this.keyTaken = false;
    this.keyPos = tileCenter(findTile(T.KEY).x, findTile(T.KEY).y);
    this.exitPos = tileCenter(findTile(T.EXIT).x, findTile(T.EXIT).y);
    this.breakerPos = tileCenter(findTile(T.BREAKER).x, findTile(T.BREAKER).y);
    this.breakerUsed = false;
    this.darkUntil = 0; // breaker darkens the yard until this time
    this.coins = NOISE.coinCount;
    this.coin = null; // a thrown coin in flight {x,y,vx,vy}
    this.noises = []; // noise events this step [{x,y,radius}]
    this.detection = 0; // 0..100, the HUD meter
    this.detected = false; // any guard currently sees the player
    this.alerted = false; // any guard in CHASE
    this.won = false;
    this.lost = false;
    this.winTime = 0;
    this.noDetections = true; // true until detection first passes 50
    this.particles = []; // {x,y,vx,vy,life,maxLife,size,color,kind}
    this.shake = 0; // screen shake (seconds left)
    this.flashes = []; // coin/breaker flash rings {x,y,radius,life}
    this.craneAngle = -Math.PI / 2; // searchlight sweep angle
    this.lighthouseAngle = 0; // lighthouse sweep angle
    this.route = []; // player route (for the end-of-job report)
    this.routeTimer = 0;
  }

  // --- collision -------------------------------------------------------
  // Move a circle (x,y,r) by (dx,dy), sliding along solid tiles.
  moveCircle(p, dx, dy, r) {
    // X axis.
    let nx = p.x + dx;
    if (dx !== 0) {
      const top = Math.floor((p.y - r) / TILE);
      const bottom = Math.floor((p.y + r) / TILE);
      const edge = dx > 0 ? Math.floor((nx + r) / TILE) : Math.floor((nx - r) / TILE);
      for (let ty = top; ty <= bottom; ty++) {
        if (isSolidTile(levelAt(edge, ty))) {
          nx = dx > 0 ? edge * TILE - r - 0.01 : (edge + 1) * TILE + r + 0.01;
          break;
        }
      }
    }
    p.x = nx;
    // Y axis.
    let ny = p.y + dy;
    if (dy !== 0) {
      const left = Math.floor((p.x - r) / TILE);
      const right = Math.floor((p.x + r) / TILE);
      const edge = dy > 0 ? Math.floor((ny + r) / TILE) : Math.floor((ny - r) / TILE);
      for (let tx = left; tx <= right; tx++) {
        if (isSolidTile(levelAt(tx, edge))) {
          ny = dy > 0 ? edge * TILE - r - 0.01 : (edge + 1) * TILE + r + 0.01;
          break;
        }
      }
    }
    p.y = ny;
  }

  // --- particles -------------------------------------------------------
  spawnParticle(p) {
    if (this.particles.length < 240) this.particles.push(p);
  }
  dust(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      const s = 8 + this.rng() * 22;
      this.spawnParticle({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6,
        life: 0.5 + this.rng() * 0.4, maxLife: 0.9,
        size: 2 + this.rng() * 3, color, kind: 'dust',
      });
    }
  }
  splash(x, y) {
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (this.rng() - 0.5) * 1.6;
      const s = 30 + this.rng() * 50;
      this.spawnParticle({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.4 + this.rng() * 0.3, maxLife: 0.7,
        size: 1.5 + this.rng() * 2, color: '#7fc4e0', kind: 'splash',
      });
    }
  }

  // --- player ----------------------------------------------------------
  stepPlayer(dt, input) {
    const p = this.player;
    if (this.won || this.lost) return;
    const mv = input.moveVector();
    p.crouched = input.crouch;
    p.sprinting = input.sprint && !p.crouched && (mv.x !== 0 || mv.y !== 0);
    const maxSpeed = p.crouched ? PLAYER.crouch : p.sprinting ? PLAYER.sprint : PLAYER.walk;
    const wantX = mv.x * maxSpeed;
    const wantY = mv.y * maxSpeed;
    // Acceleration toward the wanted velocity (smooth start), fast
    // deceleration when no input (smooth stop, never instant).
    const rate = (mv.x !== 0 || mv.y !== 0) ? PLAYER.accel : PLAYER.decel;
    p.vx += Math.max(-rate * dt, Math.min(rate * dt, wantX - p.vx));
    p.vy += Math.max(-rate * dt, Math.min(rate * dt, wantY - p.vy));
    const r = p.crouched ? PLAYER.crouchRadius : PLAYER.radius;
    this.moveCircle(p, p.vx * dt, p.vy * dt, r);
    p.speed = Math.hypot(p.vx, p.vy);
    p.moving = p.speed > 8;
    // Face the movement direction; else face the mouse.
    if (p.moving) p.facing = Math.atan2(p.vy, p.vx);
    else p.facing = Math.atan2(input.mouse.y - p.y, input.mouse.x - p.x);
    // Water: slow + splash on entry and while moving through it.
    const tile = levelAt(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
    const wasWater = p.inWater;
    p.inWater = isWaterTile(tile);
    if (p.inWater && p.moving) {
      p.vx *= 1 - 0.5 * dt;
      p.vy *= 1 - 0.5 * dt;
      if (!wasWater) this.splash(p.x, p.y);
      if (this.rng() < dt * 6) this.splash(p.x, p.y);
    }
    // Footsteps: one step per ~30px travelled; dust + sound on each step.
    if (p.moving) {
      const prev = p.stepPhase;
      p.stepPhase += (p.speed * dt) / 30;
      if (Math.floor(p.stepPhase) !== Math.floor(prev)) {
        p.stepIndex++;
        // Dust wisp behind the player; bigger + louder when sprinting.
        const back = p.facing + Math.PI;
        const dx = p.x + Math.cos(back) * 10;
        const dy = p.y + Math.sin(back) * 10;
        this.dust(dx, dy, p.sprinting ? 4 : 1, p.inWater ? '#7fc4e0' : '#9aa3b2');
        if (p.sprinting) this.splash(p.x, p.y);
        this.noises.push({ type: 'step', x: p.x, y: p.y, loud: p.sprinting });
      }
      // Walk bob, synced to the step cycle.
      p.bob = Math.sin(p.stepPhase * Math.PI * 2) * 1.5;
      // Sprint motion trail: keep the last positions, fading.
      if (p.sprinting) {
        p.trail.push({ x: p.x, y: p.y, age: 0 });
        if (p.trail.length > 8) p.trail.shift();
      } else if (p.trail.length > 0) {
        p.trail.shift();
      }
    } else {
      p.bob = 0;
      if (p.trail.length > 0) p.trail.shift();
    }
    for (const t of p.trail) t.age += dt;
    // Sprint noise: guards within the radius investigate.
    if (p.sprinting && this.rng() < dt * 4) {
      this.noises.push({ x: p.x, y: p.y, radius: NOISE.sprintRadius });
    }
    // Route tracking (for the end-of-job report), one point per second.
    this.routeTimer += dt;
    if (this.routeTimer >= 1) {
      this.routeTimer = 0;
      this.route.push({ x: Math.round(p.x), y: Math.round(p.y) });
    }
  }

  // --- interaction -----------------------------------------------------
  tryInteract() {
    const p = this.player;
    if (this.won || this.lost) return;
    // Ignition key.
    if (!this.keyTaken && Math.hypot(p.x - this.keyPos.x, p.y - this.keyPos.y) < 34) {
      this.keyTaken = true;
      this.flashes.push({ x: this.keyPos.x, y: this.keyPos.y, radius: 0, life: 0.5 });
      return;
    }
    // Breaker: darkens the crane yard for ~12s.
    if (!this.breakerUsed && Math.hypot(p.x - this.breakerPos.x, p.y - this.breakerPos.y) < 34) {
      this.breakerUsed = true;
      this.darkUntil = this.time + 12;
      this.flashes.push({ x: this.breakerPos.x, y: this.breakerPos.y, radius: 0, life: 0.6 });
      return;
    }
    // Board the ship: only with the key.
    if (this.keyTaken && Math.hypot(p.x - this.exitPos.x, p.y - this.exitPos.y) < 36) {
      this.won = true;
      this.winTime = this.time;
    }
  }

  throwCoin(mx, my) {
    const p = this.player;
    if (this.won || this.lost || this.coins <= 0 || this.coin) return;
    this.coins--;
    const dx = mx - p.x;
    const dy = my - p.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const speed = 320;
    this.coin = {
      x: p.x, y: p.y,
      vx: (dx / d) * speed, vy: (dy / d) * speed,
      travelled: 0, maxTravel: Math.min(d, 260),
    };
  }

  // --- lights ----------------------------------------------------------
  // Light pools for the lit/shadow test and the RTX lighting pass.
  lightList() {
    const lights = [
      { x: this.player.x, y: this.player.y, radius: 150, color: '#00f2ff', kind: 'flashlight' },
      { x: this.exitPos.x, y: this.exitPos.y, radius: 170, color: '#ffd700', kind: 'ship' },
      { x: this.breakerPos.x, y: this.breakerPos.y, radius: 90, color: '#ffd700', kind: 'lamp' },
      { x: 6 * TILE, y: 4 * TILE, radius: 110, color: '#ffd700', kind: 'lamp' },
      { x: 26 * TILE, y: 12 * TILE, radius: 110, color: '#ffd700', kind: 'lamp' },
    ];
    // Lighthouse sweep: a moving light across the water.
    const lx = 4 * TILE + Math.cos(this.lighthouseAngle) * 320;
    const ly = 2 * TILE + Math.sin(this.lighthouseAngle) * 60;
    lights.push({ x: lx, y: ly, radius: 130, color: '#9fe8ff', kind: 'lighthouse' });
    // Crane searchlight: a bright pool that sweeps the yard.
    const cx = (16.5 * TILE) + Math.cos(this.craneAngle) * 240;
    const cy = (7.5 * TILE) + Math.sin(this.craneAngle) * 150;
    lights.push({ x: cx, y: cy, radius: 120, color: '#ffffff', kind: 'crane' });
    return lights;
  }

  // --- one fixed step --------------------------------------------------
  step(dt, input, sfx) {
    this.time += dt;
    // Sweeps advance with time (deterministic: driven by this.time).
    this.lighthouseAngle = (this.time / LIGHT.lighthousePeriod) * Math.PI * 2;
    this.craneAngle = (this.time / LIGHT.cranePeriod) * Math.PI * 2 - Math.PI / 2;
    this.noises = [];

    // Coin in flight.
    if (this.coin) {
      const c = this.coin;
      const stepX = c.vx * dt;
      const stepY = c.vy * dt;
      c.x += stepX;
      c.y += stepY;
      c.travelled += Math.hypot(stepX, stepY);
      if (c.travelled >= c.maxTravel || solidAtPixel(c.x, c.y)) {
        this.noises.push({ x: c.x, y: c.y, radius: NOISE.coinRadius });
        this.flashes.push({ x: c.x, y: c.y, radius: 0, life: 0.4 });
        this.coin = null;
        if (sfx) sfx.coin();
      }
    }

    // Player.
    this.stepPlayer(dt, input);
    if (input.interact) this.tryInteract();
    if (input.throwCoin) this.throwCoin(input.mouse.x, input.mouse.y);

    // Guards.
    const lights = this.lightList();
    this.detected = false;
    this.alerted = false;
    let maxRate = 0;
    for (const g of this.guards) {
      const events = g.step(dt, { player: this.player, lights, noises: this.noises, time: this.time });
      for (const ev of events) {
        if (ev.type === 'caught') {
          this.lost = true;
          this.shake = 0.6;
          if (sfx) sfx.caught();
        } else if (ev.type === 'alert') {
          if (sfx) sfx.alert();
        }
      }
      if (g.suspicion > 0) this.detected = true;
      if (g.state === GSTATE.CHASE) this.alerted = true;
      maxRate = Math.max(maxRate, g.suspicion);
    }
    // The HUD detection meter follows the highest guard suspicion.
    const prevDetection = this.detection;
    this.detection = maxRate;
    if (this.detection > 50) this.noDetections = false;
    // Footstep sounds, synced to the player's step cycle.
    if (sfx) {
      const p = this.player;
      if (p.moving) {
        const whole = Math.floor(p.stepPhase);
        if (whole !== (this.lastStep || 0)) {
          this.lastStep = whole;
          sfx.step(p.sprinting, p.inWater);
        }
      }
    }
    // Crane searchlight as a hazard: standing in its beam raises
    // detection like being lit inside a cone.
    const beamX = (16.5 * TILE) + Math.cos(this.craneAngle) * 240;
    const beamY = (7.5 * TILE) + Math.sin(this.craneAngle) * 150;
    if (Math.hypot(this.player.x - beamX, this.player.y - beamY) < 60 && !this.won && !this.lost) {
      this.detection = Math.min(100, this.detection + 25 * dt);
      if (this.detection > 50) this.noDetections = false;
    }
    // Breaker darkening: while active, detection drains faster.
    if (this.time < this.darkUntil) {
      this.detection = Math.max(0, this.detection - 20 * dt);
    }
    if (this.shake > 0) this.shake -= dt;
    // Particles age.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy -= 4 * dt;
      if (pt.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      f.radius += 260 * dt;
      if (f.life <= 0) this.flashes.splice(i, 1);
    }
    // Ambient dust motes drifting through the fog.
    if (this.rng() < dt * 8) {
      this.spawnParticle({
        x: this.player.x + (this.rng() - 0.5) * 500,
        y: this.player.y + (this.rng() - 0.5) * 300,
        vx: (this.rng() - 0.5) * 6, vy: -4 - this.rng() * 6,
        life: 2 + this.rng() * 2, maxLife: 4,
        size: 1 + this.rng() * 1.5, color: '#9aa3b2', kind: 'mote',
      });
    }
    return { detection: this.detection, prevDetection };
  }
}
