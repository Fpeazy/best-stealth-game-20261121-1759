// Rendering: tiles, entities, the RTX dark/light lighting pass, fog,
// water reflections, god rays, particles, HUD and screens. Canvas only,
// no sprites, no external assets. The palette is strict (see config.js);
// every colour on screen comes from PALETTE or a light's colour.
// The lighting pass is the defining visual: a dark harbour cut by
// bright light pools, god rays and reflections.
import {
  TILE, COLS, ROWS, WIDTH, HEIGHT, PALETTE, T,
  LEVEL, levelAt, tileCenter, LIGHT,
} from './config.js';
import { coneEdgePoints } from './vision.js';
import { GSTATE } from './guard.js';
import { hashNoise } from './random.js';

const FONT = "'Courier New', monospace";

// A reusable offscreen canvas for the darkness layer.
function makeLayer(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export const SCREEN = {
  TITLE: 'title',
  PLAY: 'play',
  PAUSE: 'pause',
  CAUGHT: 'caught',
  WIN: 'win',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dark = makeLayer(WIDTH, HEIGHT);
    this.fogBlobs = [];
    for (let i = 0; i < 14; i++) {
      this.fogBlobs.push({
        x: Math.random() * WIDTH, y: Math.random() * HEIGHT,
        r: 120 + Math.random() * 180, speed: 4 + Math.random() * 8,
        a: 0.05 + Math.random() * 0.05,
      });
    }
  }

  // --- tiles -----------------------------------------------------------
  drawTiles(world) {
    const ctx = this.ctx;
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        const ch = LEVEL[ty][tx];
        const x = tx * TILE;
        const y = ty * TILE;
        const n = hashNoise(tx, ty, 7);
        if (ch === T.WATER) {
          ctx.fillStyle = PALETTE.water;
          ctx.fillRect(x, y, TILE, TILE);
          // Shimmer lines, offset by time (deterministic via world.time).
          ctx.strokeStyle = PALETTE.waterLine;
          ctx.lineWidth = 1;
          const off = Math.sin(world.time * 1.4 + ty * 0.9 + tx * 0.4) * 3;
          ctx.beginPath();
          ctx.moveTo(x + 4, y + 12 + off);
          ctx.lineTo(x + TILE - 4, y + 12 + off);
          ctx.moveTo(x + 6, y + 28 - off);
          ctx.lineTo(x + TILE - 6, y + 28 - off);
          ctx.stroke();
        } else if (ch === T.DECK) {
          ctx.fillStyle = PALETTE.deck;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = PALETTE.deckLine;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y + TILE / 2);
          ctx.lineTo(x + TILE, y + TILE / 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          ctx.fillRect(x + 2, y + 2, TILE - 4, 6);
        } else if (ch === T.CONTAINER) {
          ctx.fillStyle = PALETTE.red;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(x, y, TILE, 5);
          ctx.fillRect(x, y, 5, TILE);
          ctx.strokeStyle = PALETTE.redDark;
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
          // Corrugation lines.
          ctx.strokeStyle = 'rgba(0,0,0,0.18)';
          ctx.lineWidth = 1;
          for (let i = 1; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(x + i * 10, y + 4);
            ctx.lineTo(x + i * 10, y + TILE - 4);
            ctx.stroke();
          }
        } else if (ch === T.CRATE) {
          ctx.fillStyle = PALETTE.crate;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = PALETTE.crateLine;
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6);
          ctx.beginPath();
          ctx.moveTo(x + 3, y + 3);
          ctx.lineTo(x + TILE - 3, y + TILE - 3);
          ctx.moveTo(x + TILE - 3, y + 3);
          ctx.lineTo(x + 3, y + TILE - 3);
          ctx.stroke();
        } else {
          // Dock floor: navy with a subtle tile edge and speckle.
          ctx.fillStyle = n > 0.5 ? PALETTE.dock : PALETTE.navyMid;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = PALETTE.dockLine;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        }
      }
    }
  }

  // --- entities --------------------------------------------------------
  drawKey(world) {
    if (world.keyTaken) return;
    const ctx = this.ctx;
    const { x, y } = world.keyPos;
    const pulse = 0.6 + Math.sin(world.time * 3) * 0.4;
    ctx.save();
    ctx.globalAlpha = 0.25 + pulse * 0.25;
    ctx.fillStyle = PALETTE.yellow;
    ctx.beginPath();
    ctx.arc(x, y, 22 + pulse * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = PALETTE.yellow;
    ctx.fillRect(x - 2, y - 8, 4, 12);
    ctx.beginPath();
    ctx.arc(x, y - 10, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x + 2, y - 2, 6, 3);
    ctx.fillRect(x + 2, y + 3, 5, 3);
  }

  drawExit(world) {
    const ctx = this.ctx;
    const { x, y } = world.exitPos;
    // Gangplank: a lit walkway from the dock onto the ship.
    ctx.fillStyle = PALETTE.yellow;
    ctx.fillRect(x - 18, y - 4, 36, 8);
    ctx.fillStyle = PALETTE.navyDark;
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('KESTREL', x, y - 10);
    if (world.keyTaken) {
      const pulse = 0.6 + Math.sin(world.time * 4) * 0.4;
      ctx.globalAlpha = 0.5 + pulse * 0.3;
      ctx.strokeStyle = PALETTE.yellow;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 20, y - 16, 40, 32);
      ctx.globalAlpha = 1;
    }
  }

  drawBreaker(world) {
    const ctx = this.ctx;
    const { x, y } = world.breakerPos;
    ctx.fillStyle = world.breakerUsed ? PALETTE.fog : PALETTE.yellow;
    ctx.fillRect(x - 7, y - 10, 14, 20);
    ctx.fillStyle = PALETTE.navyDark;
    ctx.font = `bold 10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('⚡', x, y + 4);
  }

  drawCoin(world) {
    if (!world.coin) return;
    const ctx = this.ctx;
    ctx.fillStyle = PALETTE.yellow;
    ctx.beginPath();
    ctx.arc(world.coin.x, world.coin.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.navyDark;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawPlayer(world) {
    const ctx = this.ctx;
    const p = world.player;
    // Sprint motion trail: fading ghosts of the last positions.
    for (let i = 0; i < p.trail.length; i++) {
      const t = p.trail[i];
      const a = 0.18 * (1 - t.age / 0.5) * (i / Math.max(1, p.trail.length));
      if (a <= 0) continue;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = PALETTE.cyan;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const bobY = p.bob;
    const h = p.crouched ? 16 : 22; // crouch pose: low and small
    const w = p.crouched ? 18 : 14;
    // Shadow under the player.
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 12, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body: white with a cyan outline; sprint leans forward.
    ctx.save();
    ctx.translate(p.x, p.y + bobY);
    if (p.sprinting) ctx.rotate(0.12 * Math.cos(p.facing));
    ctx.fillStyle = PALETTE.white;
    ctx.strokeStyle = PALETTE.cyan;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 5);
    ctx.fill();
    ctx.stroke();
    // Directional eye line (facing).
    ctx.strokeStyle = PALETTE.navyDark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(p.facing) * 12, Math.sin(p.facing) * 12);
    ctx.stroke();
    ctx.restore();
  }

  drawGuard(world, g) {
    const ctx = this.ctx;
    const alert = g.state === GSTATE.CHASE || g.state === GSTATE.INVESTIGATE;
    const suspicious = g.state === GSTATE.SUSPECT || g.state === GSTATE.SEARCH;
    // Vision cone (the core readable mechanic): a translucent arc,
    // clipped by the tilemap via raycast edge points.
    const pts = coneEdgePoints(
      g.x, g.y, g.facing, 0.61, 210, world.player.crouched, 20,
    );
    ctx.save();
    ctx.globalAlpha = alert ? 0.34 : suspicious ? 0.26 : 0.18;
    ctx.fillStyle = alert ? PALETTE.red : PALETTE.cyan;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Cone edge line.
    ctx.strokeStyle = alert ? 'rgba(217,35,35,0.6)' : 'rgba(0,242,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.closePath();
    ctx.stroke();
    // Body: blue on patrol, red when alert; a rounded rect with an eye line.
    const bobY = Math.sin(g.stepPhase * Math.PI * 2) * 1.2;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y + 12, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(g.x, g.y + bobY);
    ctx.fillStyle = alert ? PALETTE.red : '#3a6fd8';
    ctx.strokeStyle = alert ? PALETTE.redDark : '#1c3a6e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-9, -11, 18, 22, 5);
    ctx.fill();
    ctx.stroke();
    // Eye line (facing) + a small lamp dot when patrolling.
    ctx.strokeStyle = PALETTE.white;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(g.facing) * 12, Math.sin(g.facing) * 12);
    ctx.stroke();
    ctx.fillStyle = PALETTE.yellow;
    ctx.beginPath();
    ctx.arc(Math.cos(g.facing) * 8, Math.sin(g.facing) * 8, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Alert exclamation mark above the guard when it spots the player.
    if (g.alertMark > 0 || g.state === GSTATE.CHASE) {
      const a = Math.min(1, g.alertMark > 0 ? g.alertMark : 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = PALETTE.red;
      ctx.font = `bold 22px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('!', g.x, g.y - 22);
      ctx.globalAlpha = 1;
    }
    // Suspicion "?" when investigating.
    if (g.state === GSTATE.SUSPECT || g.state === GSTATE.INVESTIGATE) {
      ctx.fillStyle = PALETTE.yellow;
      ctx.font = `bold 18px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('?', g.x, g.y - 22);
    }
  }

  drawParticles(world) {
    const ctx = this.ctx;
    for (const pt of world.particles) {
      const a = Math.max(0, pt.life / pt.maxLife);
      ctx.globalAlpha = a * 0.7;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Flash rings (coin impact, key pickup, breaker).
    for (const f of world.flashes) {
      ctx.globalAlpha = Math.max(0, f.life / 0.6) * 0.8;
      ctx.strokeStyle = PALETTE.yellow;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // --- RTX dark/light lighting pass ------------------------------------
  // The defining visual: a dark harbour cut by bright light. Drawn as:
  // 1) a darkness layer (radial fog-of-war hole around the player),
  // 2) additive light pools at every light source (lamps, ship, flashlight),
  // 3) god-ray shafts from the lighthouse sweep and the crane searchlight,
  // 4) light streaks reflected on the water, 5) drifting fog blobs.
  drawLighting(world) {
    const ctx = this.ctx;
    const lights = world.lightList();
    const dark = this.dark.getContext('2d');
    // 1) Darkness: fill dark, then punch a soft hole around the player.
    dark.clearRect(0, 0, WIDTH, HEIGHT);
    dark.fillStyle = `rgba(5,6,11,${LIGHT.darkness})`;
    dark.fillRect(0, 0, WIDTH, HEIGHT);
    dark.globalCompositeOperation = 'destination-out';
    const p = world.player;
    const fog = dark.createRadialGradient(
      p.x, p.y, LIGHT.fogRadius * 0.3, p.x, p.y, LIGHT.fogRadius,
    );
    fog.addColorStop(0, 'rgba(0,0,0,1)');
    fog.addColorStop(0.7, 'rgba(0,0,0,0.7)');
    fog.addColorStop(1, 'rgba(0,0,0,0)');
    dark.fillStyle = fog;
    dark.beginPath();
    dark.arc(p.x, p.y, LIGHT.fogRadius, 0, Math.PI * 2);
    dark.fill();
    // Smaller holes at the bright light sources (they cut the dark).
    for (const l of lights) {
      if (l.kind === 'flashlight') continue;
      const g = dark.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.radius);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      dark.fillStyle = g;
      dark.beginPath();
      dark.arc(l.x, l.y, l.radius, 0, Math.PI * 2);
      dark.fill();
    }
    dark.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.dark, 0, 0);
    // 2) Additive light pools: bright, soft, high contrast against the dark.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.radius);
      const col = l.kind === 'ship' || l.kind === 'lamp' ? '255,215,0'
        : l.kind === 'crane' ? '255,255,255'
        : l.kind === 'lighthouse' ? '159,232,255' : '0,242,255';
      g.addColorStop(0, `rgba(${col},0.28)`);
      g.addColorStop(0.5, `rgba(${col},0.10)`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(l.x, l.y, l.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    // 3) God rays: shafts from the lighthouse sweep and the crane light.
    const ray = (x, y, angle, len, spread, color, alpha) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, `rgba(${color},${alpha})`);
      g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(len, -spread);
      ctx.lineTo(len, spread);
      ctx.lineTo(0, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    const lx = 4 * TILE + Math.cos(world.lighthouseAngle) * 320;
    const ly = 2 * TILE + Math.sin(world.lighthouseAngle) * 60;
    ray(lx, ly, world.lighthouseAngle + Math.PI / 2, 340, 46, '159,232,255', 0.16);
    const cx = 16.5 * TILE + Math.cos(world.craneAngle) * 240;
    const cy = 7.5 * TILE + Math.sin(world.craneAngle) * 150;
    ray(16.5 * TILE, 7.5 * TILE, world.craneAngle, 300, 34, '255,255,255', 0.2);
    ctx.restore();
    // 4) Water reflections: light streaks on the water under each light.
    ctx.save();
    ctx.globalAlpha = 0.35;
    for (const l of lights) {
      if (l.kind === 'flashlight') continue;
      const ch = levelAt(Math.floor(l.x / TILE), Math.floor(l.y / TILE));
      if (ch !== T.WATER) {
        // Find the water below the light (the streak falls on the water).
        const wy = (Math.floor(l.y / TILE) + 1) * TILE;
        if (wy < HEIGHT && levelAt(Math.floor(l.x / TILE), Math.floor(wy / TILE)) === T.WATER) {
          const wob = Math.sin(world.time * 2 + l.x * 0.05) * 4;
          ctx.strokeStyle = l.kind === 'ship' || l.kind === 'lamp' ? 'rgba(255,215,0,0.5)' : 'rgba(159,232,255,0.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(l.x - 14 + wob, wy + 8);
          ctx.lineTo(l.x + 14 + wob, wy + 8);
          ctx.moveTo(l.x - 9 - wob, wy + 20);
          ctx.lineTo(l.x + 9 - wob, wy + 20);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    // 5) Drifting fog blobs (a differentiator rank 1 lacks).
    ctx.save();
    for (const b of this.fogBlobs) {
      b.x += b.speed * 0.016;
      if (b.x - b.r > WIDTH) b.x = -b.r;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, `rgba(107,114,128,${b.a})`);
      g.addColorStop(1, 'rgba(107,114,128,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- HUD ---------------------------------------------------------------
  drawHUD(world) {
    const ctx = this.ctx;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Top-left: objective (fades between the two steps).
    const objective = world.keyTaken
      ? 'BOARD THE KESTREL — REACH THE GANGPLANK'
      : 'STEAL THE IGNITION KEY — WAREHOUSE OFFICE';
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillStyle = 'rgba(5,6,11,0.72)';
    ctx.fillRect(10, 10, ctx.measureText(objective).width + 20, 26);
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(objective, 20, 28);
    // Top-center: detection meter (arc ring, green -> yellow -> red).
    const d = world.detection;
    const mx = WIDTH / 2;
    const my = 30;
    const rr = 16;
    const col = d < 35 ? '#2fbf5a' : d < 70 ? PALETTE.yellow : PALETTE.red;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(mx, my, rr, 0, Math.PI * 2);
    ctx.stroke();
    if (d > 0) {
      const pulse = d > 50 ? 0.75 + Math.sin(world.time * 8) * 0.25 : 1;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = col;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(mx, my, rr, -Math.PI / 2, -Math.PI / 2 + (d / 100) * Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = PALETTE.text;
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('SEEN', mx, my + 32);
    ctx.textAlign = 'left';
    // Top-right: item slots (coins, key).
    const sx = WIDTH - 150;
    ctx.fillStyle = 'rgba(5,6,11,0.72)';
    ctx.fillRect(sx, 10, 140, 26);
    ctx.fillStyle = PALETTE.yellow;
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillText(`◉ ${world.coins}`, sx + 10, 28);
    ctx.fillStyle = world.keyTaken ? PALETTE.yellow : PALETTE.textDim;
    ctx.fillText(world.keyTaken ? '⚿ KEY' : '○ KEY', sx + 62, 28);
    // Bottom hint bar (controls), dim and unobtrusive.
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = `11px ${FONT}`;
    ctx.fillText('WASD MOVE · C CROUCH · SHIFT SPRINT · CLICK THROW COIN · E INTERACT · P PAUSE', 12, HEIGHT - 10);
  }

  // --- screens -----------------------------------------------------------
  drawTitle(world) {
    const ctx = this.ctx;
    // Foggy harbour silhouette behind the title.
    ctx.fillStyle = PALETTE.navyDark;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // A distant skyline + lighthouse beam.
    ctx.fillStyle = '#131a33';
    for (let i = 0; i < 12; i++) {
      const bx = 60 + i * 100 + hashNoise(i, 3, 11) * 40;
      const bh = 90 + hashNoise(i, 5, 11) * 130;
      ctx.fillRect(bx, HEIGHT - 180 - bh, 70, bh);
    }
    const lx = 90;
    const ly = HEIGHT - 260;
    ctx.fillStyle = PALETTE.yellow;
    ctx.fillRect(lx - 3, ly, 6, 90);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(lx, ly);
    ctx.rotate(world.lighthouseAngle);
    const g = ctx.createLinearGradient(0, 0, 420, 0);
    g.addColorStop(0, 'rgba(159,232,255,0.35)');
    g.addColorStop(1, 'rgba(159,232,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(420, -40);
    ctx.lineTo(420, 40);
    ctx.lineTo(0, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Neon stencil title.
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.cyan;
    ctx.font = `bold 84px ${FONT}`;
    ctx.shadowColor = PALETTE.cyan;
    ctx.shadowBlur = 26;
    ctx.fillText('SHADOW DOCK', WIDTH / 2, 300);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.text;
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillText('A NIGHT PORT HEIST — STEAL THE KEY. BOARD THE KESTREL.', WIDTH / 2, 350);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = `15px ${FONT}`;
    ctx.fillText('WASD MOVE · C CROUCH · SHIFT SPRINT · CLICK THROW COIN · E INTERACT', WIDTH / 2, 390);
    const pulse = 0.55 + Math.sin(world.time * 3) * 0.45;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = PALETTE.yellow;
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillText('PRESS ENTER TO START', WIDTH / 2, 470);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  drawPause() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.text;
    ctx.font = `bold 44px ${FONT}`;
    ctx.fillText('PAUSED', WIDTH / 2, HEIGHT / 2 - 20);
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = PALETTE.textDim;
    ctx.fillText('ENTER RESUME · R RESTART · Q QUIT TO TITLE', WIDTH / 2, HEIGHT / 2 + 24);
    ctx.textAlign = 'left';
  }

  drawCaught(world) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(20,2,2,0.82)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.red;
    ctx.font = `bold 52px ${FONT}`;
    ctx.fillText('CAUGHT', WIDTH / 2, HEIGHT / 2 - 30);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `17px ${FONT}`;
    ctx.fillText('A guard caught you on the dock. The Kestrel sails without you.', WIDTH / 2, HEIGHT / 2 + 12);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = `15px ${FONT}`;
    ctx.fillText('ENTER RETRY · Q QUIT TO TITLE', WIDTH / 2, HEIGHT / 2 + 52);
    ctx.textAlign = 'left';
  }

  drawWin(world) {
    const ctx = this.ctx;
    // The ship departure: the lit deck against the dark harbour.
    ctx.fillStyle = PALETTE.navyDark;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(WIDTH / 2, 260, 0, WIDTH / 2, 260, 320);
    g.addColorStop(0, 'rgba(255,215,0,0.30)');
    g.addColorStop(1, 'rgba(255,215,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(WIDTH / 2, 260, 320, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // The Kestrel's deck, lit, with the tiny player aboard.
    ctx.fillStyle = PALETTE.deck;
    ctx.fillRect(WIDTH / 2 - 260, 300, 520, 90);
    ctx.strokeStyle = PALETTE.deckLine;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(WIDTH / 2 - 260, 315 + i * 12);
      ctx.lineTo(WIDTH / 2 + 260, 315 + i * 12);
      ctx.stroke();
    }
    ctx.fillStyle = PALETTE.yellow;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(WIDTH / 2 - 220 + i * 62, 296, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = PALETTE.white;
    ctx.strokeStyle = PALETTE.cyan;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(WIDTH / 2 - 7, 330, 14, 22, 5);
    ctx.fill();
    ctx.stroke();
    // Fog parting around the ship.
    ctx.fillStyle = 'rgba(107,114,128,0.16)';
    ctx.fillRect(0, 420, WIDTH, 300);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.text;
    ctx.font = `bold 46px ${FONT}`;
    ctx.fillText('MISSION COMPLETE', WIDTH / 2, 150);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = `18px ${FONT}`;
    const mins = Math.floor(world.winTime / 60);
    const secs = Math.floor(world.winTime % 60);
    ctx.fillText(`ESCAPED IN ${mins}:${String(secs).padStart(2, '0')} — THE KESTREL SAILS AT DAWN`, WIDTH / 2, 190);
    if (world.noDetections) {
      ctx.fillStyle = PALETTE.yellow;
      ctx.font = `bold 20px ${FONT}`;
      ctx.fillText('★ NO DETECTIONS ★', WIDTH / 2, 230);
    }
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = `15px ${FONT}`;
    ctx.fillText('ENTER PLAY AGAIN · Q QUIT TO TITLE', WIDTH / 2, 520);
    // Route map (the player's path, bottom-left, on a faint panel so it
    // reads as a map and not a stray mark).
    ctx.fillStyle = 'rgba(5,6,11,0.6)';
    ctx.fillRect(40, 540, 260, 140);
    ctx.strokeStyle = PALETTE.dockLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(40, 540, 260, 140);
    ctx.textAlign = 'left';
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillText('ROUTE — SPAWN TO THE KESTREL', 52, 560);
    ctx.strokeStyle = PALETTE.cyan;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < world.route.length; i++) {
      const pt = world.route[i];
      const rx = 52 + (pt.x / WIDTH) * 236;
      const ry = 568 + (pt.y / HEIGHT) * 100;
      if (i === 0) ctx.moveTo(rx, ry);
      else ctx.lineTo(rx, ry);
    }
    ctx.stroke();
    // Start (spawn) and end (ship) dots.
    if (world.route.length > 0) {
      const first = world.route[0];
      const last = world.route[world.route.length - 1];
      ctx.fillStyle = PALETTE.text;
      ctx.beginPath();
      ctx.arc(52 + (first.x / WIDTH) * 236, 568 + (first.y / HEIGHT) * 100, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.yellow;
      ctx.beginPath();
      ctx.arc(52 + (last.x / WIDTH) * 236, 568 + (last.y / HEIGHT) * 100, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'left';
  }

  // --- full frame --------------------------------------------------------
  draw(world, screen) {
    const ctx = this.ctx;
    ctx.save();
    // Screen shake on being caught.
    if (world.shake > 0) {
      const s = world.shake * 8;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }
    if (screen === SCREEN.TITLE) {
      this.drawTitle(world);
      ctx.restore();
      return;
    }
    if (screen === SCREEN.WIN) {
      this.drawWin(world);
      ctx.restore();
      return;
    }
    this.drawTiles(world);
    this.drawKey(world);
    this.drawExit(world);
    this.drawBreaker(world);
    this.drawCoin(world);
    for (const g of world.guards) this.drawGuard(world, g);
    this.drawPlayer(world);
    this.drawParticles(world);
    this.drawLighting(world);
    this.drawHUD(world);
    if (screen === SCREEN.PAUSE) this.drawPause();
    else if (screen === SCREEN.CAUGHT) this.drawCaught(world);
    ctx.restore();
  }
}
