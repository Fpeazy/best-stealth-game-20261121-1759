// The world: level state, the player (with smooth acceleration and
// distinct crouch/walk/sprint feel), collision, detection, objectives,
// particles and the fixed-step simulation. Deterministic: step(dt) with
// the same inputs always gives the same state.
import {
  TILE, COLS, ROWS, PLAYER, NOISE, DETECTION, LIGHT, CRANE,
  LEVEL, levelAt, tileCenter, isSolidTile, isWaterTile, T, LOOT,
} from './config.js';
import { Guard, GSTATE } from './guard.js';
import { GUARD_ROUTES } from './config.js';
import { solidAtPixel } from './vision.js';
import { mulberry32 } from './random.js';
import { Talk, TALK_LINES, TALK_PRIORITY, emotionFor } from './talk.js';
import { newScoreState } from './score.js';

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
    // Scoring (reconciled thousand-scale rules) + loot.
    this.score = newScoreState();
    this.loot = LOOT.map((l) => ({ ...l, taken: false }));
    // Talk system (state-mapped barks + player lines).
    this.talk = new Talk();
    this.talk.reset(0);
    this.lastGuardState = this.guards.map((g) => g.state);
    this.obj1Said = false; // player line near the warehouse
    this.obj2Said = false; // player line near the ship
    // Shooting effects (visual only): warning shot + flare.
    this.shotFx = { flash: null, tracer: null, flare: null };
    this.warnedShot = false; // warning shot fired once per run
    this.flareDone = false; // flare fired once per chase
    this.coinJustLanded = false;
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
      // Walk bob, synced to the step cycle — amplitude by stance
      // (crouch is a low shuffle, sprint is a big pounding stride).
      const bobAmp = p.crouched ? 0.8 : p.sprinting ? 2.5 : 1.5;
      p.bob = Math.sin(p.stepPhase * Math.PI * 2) * bobAmp;
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
      { x: this.exitPos.x, y: this.exitPos.y, radius: 90, color: '#ffd700', kind: 'ship' },
      { x: this.breakerPos.x, y: this.breakerPos.y, radius: 90, color: '#ffd700', kind: 'lamp' },
      { x: 6 * TILE, y: 4 * TILE, radius: 110, color: '#ffd700', kind: 'lamp' },
      { x: 26 * TILE, y: 12 * TILE, radius: 110, color: '#ffd700', kind: 'lamp' },
    ];
    // Varied lights (futuristic neon + dock lamps + beacons + deck lights).
    // Dock lamps: warm yellow, 8 points, zone A, 0.5Hz flicker.
    for (const [lx, ly] of [[2, 5], [5, 10], [10, 13], [13, 12], [2, 12], [5, 13], [10, 12], [13, 10]]) {
      const flick = 0.85 + Math.sin(this.time * Math.PI) * 0.15;
      lights.push({ x: lx * TILE + 20, y: ly * TILE + 20, radius: 60 * flick, color: '#ffcc00', kind: 'docklamp' });
    }
    // Neon strips on containers: cyan/magenta/amber, 1Hz pulse.
    const pulse = 0.7 + Math.sin(this.time * Math.PI * 2) * 0.3;
    for (const [lx, ly, col] of [[8, 4, '#00ffff'], [14, 5, '#ff00ff'], [22, 6, '#00ffff'], [10, 9, '#ffaa00'], [24, 10, '#00ffff'], [6, 8, '#ff00ff']]) {
      lights.push({ x: lx * TILE + 40, y: ly * TILE, radius: 70 * pulse, color: col, kind: 'neon' });
    }
    // Warning beacons (gangplank + crane base): red, blink 2Hz.
    const blink = (Math.floor(this.time * 2) % 2 === 0) ? 1 : 0.15;
    for (const [lx, ly] of [[20, 3], [16, 7], [17, 8], [21, 4]]) {
      lights.push({ x: lx * TILE + 20, y: ly * TILE + 20, radius: 30 * blink, color: '#ff0000', kind: 'beacon' });
    }
    // Deck lights (Kestrel): warm white, 5 points, steady.
    for (const [lx, ly] of [[22, 1], [25, 1], [28, 1], [23, 2], [27, 2]]) {
      lights.push({ x: lx * TILE + 20, y: ly * TILE + 20, radius: 40, color: '#ffeedd', kind: 'decklight' });
    }
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

  // Is the player in an ENVIRONMENTAL light pool (not their own
  // flashlight)? This drives the lit/shadow detection rate and the HUD
  // LIT/SHADOW indicator.
  playerLit() {
    const p = this.player;
    for (const l of this.lightList()) {
      if (l.kind === 'flashlight') continue;
      if (Math.hypot(p.x - l.x, p.y - l.y) < l.radius) return true;
    }
    return false;
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
        this.coinJustLanded = true;
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
          // Guards react to each other's alerts: nearby guards (within
          // 300px) turn SUSPECT toward the alerting guard's lastSeen.
          for (const og of this.guards) {
            if (og === ev.guard) continue;
            if (og.state !== GSTATE.PATROL && og.state !== GSTATE.RETURN) continue;
            if (Math.hypot(og.x - ev.guard.x, og.y - ev.guard.y) < 300) {
              og.state = GSTATE.SUSPECT;
              og.lastSeen = ev.guard.lastSeen ? { x: ev.guard.lastSeen.x, y: ev.guard.lastSeen.y } : { x: ev.guard.x, y: ev.guard.y };
              og.suspicion = Math.max(og.suspicion, 40);
            }
          }
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
    // Scoring: undetected seconds + the no-detection flag.
    if (this.detection === 0 && !this.won && !this.lost) this.score.undetectedSec += dt;
    if (this.detection > 0) this.score.noDetection = false;
    // Gadget efficiency: a coin that pulls a guard to SUSPECT/INVESTIGATE
    // while the player is undetected earns +200 (max 3).
    if (this.coinJustLanded) {
      this.coinJustLanded = false;
      const lured = this.guards.some((g) => g.state === GSTATE.SUSPECT || g.state === GSTATE.INVESTIGATE);
      if (lured && this.detection === 0 && this.score.gadgetCount < 3) {
        this.score.gadgetCount++;
        this.score.gadgetPoints += 200;
      }
    }
    // Loot: the player takes a manifest item within 30px.
    for (const l of this.loot) {
      if (l.taken) continue;
      const c = tileCenter(l.tx, l.ty);
      if (Math.hypot(this.player.x - c.x, this.player.y - c.y) < 30) {
        l.taken = true;
        this.score.lootPoints += l.points;
        this.score.lootCollected.push(l.name);
        this.flashes.push({ x: c.x, y: c.y, radius: 0, life: 0.5 });
      }
    }
    // Talk: guard state changes map to bark lines (highest priority wins).
    for (let i = 0; i < this.guards.length; i++) {
      const g = this.guards[i];
      if (g.state !== this.lastGuardState[i]) {
        const prev = this.lastGuardState[i];
        this.lastGuardState[i] = g.state;
        if (g.state === GSTATE.SUSPECT) this.talk.say(emotionFor('suspect') + TALK_LINES.guardSuspect, g.x, g.y - 56, 'guard', 'guard', TALK_PRIORITY.suspect);
        else if (g.state === GSTATE.INVESTIGATE) this.talk.say(emotionFor('investigate') + TALK_LINES.guardInvestigate, g.x, g.y - 56, 'guard', 'guard', TALK_PRIORITY.investigate);
        else if (g.state === GSTATE.CHASE) this.talk.say(emotionFor('chase') + TALK_LINES.guardChase, g.x, g.y - 56, 'guard', 'guard', TALK_PRIORITY.chase);
        else if (g.state === GSTATE.PATROL && prev !== GSTATE.PATROL) this.talk.say(emotionFor('patrol') + TALK_LINES.guardPatrol, g.x, g.y - 56, 'guard', 'guard', TALK_PRIORITY.patrol);
      }
    }
    // Talk: player objective lines (once each, when near the place).
    if (!this.obj1Said && Math.hypot(this.player.x - this.keyPos.x, this.player.y - this.keyPos.y) < 160) {
      this.obj1Said = true;
      this.talk.say(TALK_LINES.playerObj1, this.player.x, this.player.y - 56, 'player', 'player');
    }
    if (!this.obj2Said && Math.hypot(this.player.x - this.exitPos.x, this.player.y - this.exitPos.y) < 200) {
      this.obj2Said = true;
      this.talk.say(TALK_LINES.playerObj2, this.player.x, this.player.y - 56, 'player', 'player');
    }
    // Shooting effects (visual only): a warning shot the first time the
    // meter passes 30, and a red flare when a chase starts.
    if (!this.warnedShot && this.detection > 30) {
      this.warnedShot = true;
      const g = this.guards.find((gg) => gg.suspicion > 0) || this.guards[0];
      this.shotFx.flash = { x: g.x, y: g.y, life: 0.08, maxLife: 0.08 };
      this.shotFx.tracer = { x1: g.x, y1: g.y, x2: this.player.x, y2: this.player.y, life: 0.25, maxLife: 0.25 };
      for (let i = 0; i < 8; i++) this.spawnParticle({ x: g.x, y: g.y, vx: (this.rng() - 0.5) * 160, vy: (this.rng() - 0.5) * 160, life: 0.3, maxLife: 0.3, size: 2, color: '#ffffff', kind: 'spark' });
    }
    if (!this.flareDone && this.alerted) {
      this.flareDone = true;
      const g = this.guards.find((gg) => gg.state === GSTATE.CHASE) || this.guards[0];
      this.shotFx.flare = { x: g.x, y: g.y - 30, vy: -20, life: 2.5, maxLife: 2.5 };
    }
    // Shooting-effect timers.
    if (this.shotFx.flash) { this.shotFx.flash.life -= dt; if (this.shotFx.flash.life <= 0) this.shotFx.flash = null; }
    if (this.shotFx.tracer) { this.shotFx.tracer.life -= dt; if (this.shotFx.tracer.life <= 0) this.shotFx.tracer = null; }
    if (this.shotFx.flare) { this.shotFx.flare.life -= dt; this.shotFx.flare.y += this.shotFx.flare.vy * dt; this.shotFx.flare.vy += 20 * dt; if (this.shotFx.flare.life <= 0) this.shotFx.flare = null; }
    this.talk.update(dt);
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
