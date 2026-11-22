// Rendering: tiles, entities, the RTX dark/light lighting pass, fog,
// water reflections, god rays, particles, HUD and screens. Canvas only,
// no sprites, no external assets. The palette is strict (see config.js);
// every colour on screen comes from PALETTE or a light's colour.
// The lighting pass is the defining visual: a dark harbour cut by
// bright light pools, god rays and reflections.
import {
  TILE, COLS, ROWS, WIDTH, HEIGHT, PALETTE, T,
  LEVEL, levelAt, tileCenter, LIGHT, OFFICE, LOOT, DECOR, NOISE,
} from './config.js';
import { coneEdgePoints } from './vision.js';
import { GSTATE } from './guard.js';
import { hashNoise } from './random.js';
import { computeBreakdown, formatScore, liveScore } from './score.js';

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
    for (let i = 0; i < 30; i++) {
      this.fogBlobs.push({
        x: Math.random() * WIDTH, y: Math.random() * HEIGHT,
        r: 120 + Math.random() * 180, speed: 5 + Math.random() * 9,
        a: 0.07 + Math.random() * 0.06,
      });
    }
    // Ambient dust motes (deterministic placement, animated by time).
    this.dust = [];
    for (let i = 0; i < 46; i++) {
      this.dust.push({
        x: hashNoise(i, 0, 41) * WIDTH, y: hashNoise(i, 1, 41) * HEIGHT,
        r: 1 + hashNoise(i, 2, 41) * 1.6, speed: 3 + hashNoise(i, 3, 41) * 7,
        phase: hashNoise(i, 4, 41) * Math.PI * 2,
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
        // The warehouse office, themed as a futuristic space-station
        // control room (metallic floor, hologram walls, neon airlock).
        if (tx >= OFFICE.x0 && tx <= OFFICE.x1 && ty >= OFFICE.y0 && ty <= OFFICE.y1) {
          const isDoor = tx === OFFICE.door.x && ty === OFFICE.door.y;
          const isKey = tx === OFFICE.key.x && ty === OFFICE.key.y;
          if (isDoor) {
            // Airlock door gap: metallic floor + neon-cyan frame + magenta seal.
            ctx.fillStyle = '#1a1f2e';
            ctx.fillRect(x, y, TILE, TILE);
            ctx.strokeStyle = PALETTE.cyan;
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
            ctx.strokeStyle = PALETTE.magenta;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x + 4, y + TILE / 2);
            ctx.lineTo(x + TILE - 4, y + TILE / 2);
            ctx.stroke();
          } else if (ch === T.CONTAINER) {
            // Hologram wall: dark metallic + cyan wireframe + magenta seal.
            ctx.fillStyle = '#1e2a38';
            ctx.fillRect(x, y, TILE, TILE);
            ctx.strokeStyle = PALETTE.cyan;
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12);
            ctx.strokeStyle = PALETTE.magenta;
            ctx.beginPath();
            ctx.arc(x + TILE / 2, y + TILE / 2, 3, 0, Math.PI * 2);
            ctx.stroke();
            // Rivet dots.
            ctx.fillStyle = '#4a5568';
            ctx.fillRect(x + 3, y + 3, 2, 2);
            ctx.fillRect(x + TILE - 5, y + 3, 2, 2);
            ctx.fillRect(x + 3, y + TILE - 5, 2, 2);
            ctx.fillRect(x + TILE - 5, y + TILE - 5, 2, 2);
            // Holographic screen on the back wall (rotating schematic ring).
            if (ty === OFFICE.y0 && tx !== OFFICE.door.x) {
              const ring = (world.time * 0.5) % (Math.PI * 2);
              ctx.save();
              ctx.globalAlpha = 0.85;
              ctx.fillStyle = 'rgba(0,242,255,0.18)';
              ctx.fillRect(x + 6, y + 8, TILE - 12, 24);
              ctx.strokeStyle = PALETTE.cyan;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.arc(x + TILE / 2, y + 20, 7, ring, ring + Math.PI * 1.2);
              ctx.stroke();
              ctx.restore();
            }
          } else {
            // Metallic floor: dark grey + thin white seam grid.
            ctx.fillStyle = '#1a1f2e';
            ctx.fillRect(x, y, TILE, TILE);
            ctx.strokeStyle = 'rgba(255,255,255,0.14)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
            ctx.beginPath();
            ctx.moveTo(x + TILE / 2, y);
            ctx.lineTo(x + TILE / 2, y + TILE);
            ctx.stroke();
            if (isKey) {
              // Console pedestal under the floating key.
              ctx.fillStyle = '#3a4555';
              ctx.fillRect(x + 6, y + 22, TILE - 12, 12);
              ctx.fillStyle = PALETTE.cyan;
              ctx.fillRect(x + 10, y + 25, 4, 4);
              ctx.fillRect(x + 18, y + 25, 4, 4);
              ctx.fillRect(x + 26, y + 25, 4, 4);
            }
          }
          continue;
        }
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
          // Futuristic neon strip on the top edge of the container block.
          if (levelAt(tx, ty - 1) !== T.CONTAINER) {
            const pick = hashNoise(tx, ty, 13);
            const col = pick < 0.5 ? PALETTE.cyan : pick < 0.8 ? PALETTE.magenta : PALETTE.amber;
            // Neon strips pulse (1Hz, per-tile phase) — the yard breathes.
            const pulse = 0.65 + 0.35 * Math.sin(world.time * 6.3 + tx * 0.9 + ty * 1.4);
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.shadowColor = col;
            ctx.shadowBlur = 6;
            ctx.fillStyle = col;
            ctx.fillRect(x, y, TILE, 4);
            ctx.restore();
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
          // Dock floor: 3 navy variants + a subtle tile edge and speckle.
          ctx.fillStyle = n > 0.66 ? PALETTE.dock : n > 0.33 ? PALETTE.navyMid : PALETTE.navyDark;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = PALETTE.dockLine;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        }
      }
    }
    // Decor objects (non-solid) + loot, drawn on top of the floor.
    this.drawDecor(world);
    this.drawLoot(world);
  }

  // Decor: barrels, pallets, bollards, lamps, buoys, rope coils.
  drawDecor(world) {
    const ctx = this.ctx;
    for (const d of DECOR) {
      const x = d.tx * TILE;
      const y = d.ty * TILE;
      const cx = x + TILE / 2;
      const cy = y + TILE / 2;
      if (d.kind === 'barrel') {
        ctx.fillStyle = '#5a4a2a';
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8a7a4a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.stroke();
      } else if (d.kind === 'pallet') {
        ctx.fillStyle = '#6b4c2f';
        ctx.fillRect(x + 4, y + 6, TILE - 8, 8);
        ctx.fillRect(x + 4, y + 18, TILE - 8, 8);
        ctx.fillRect(x + 6, y + 26, TILE - 12, 6);
        ctx.strokeStyle = '#a07d42';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 4, y + 6, TILE - 8, 8);
      } else if (d.kind === 'bollard') {
        ctx.fillStyle = PALETTE.yellow;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.navyDark;
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (d.kind === 'lamp') {
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(cx - 2, cy - 10, 4, 20);
        // Dock lamps flicker (per-lamp phase) — a living yard.
        const flick = 0.72 + 0.28 * Math.sin(world.time * 3.1 + d.tx * 1.7 + d.ty * 2.3);
        ctx.save();
        ctx.globalAlpha = flick;
        ctx.shadowColor = PALETTE.yellow;
        ctx.shadowBlur = 10;
        ctx.fillStyle = PALETTE.yellow;
        ctx.beginPath();
        ctx.arc(cx, cy - 10, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (d.kind === 'buoy') {
        const bob = Math.sin(world.time * 1.5 + d.tx) * 2;
        ctx.fillStyle = '#ff5a3c';
        ctx.beginPath();
        ctx.arc(cx, cy + bob, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.white;
        ctx.fillRect(cx - 8, cy + bob - 2, 16, 4);
      } else if (d.kind === 'rope') {
        ctx.strokeStyle = '#a07d42';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // Loot: the 3 manifest items, glowing so they read as objectives.
  drawLoot(world) {
    const ctx = this.ctx;
    for (const l of world.loot) {
      if (l.taken) continue;
      const c = tileCenter(l.tx, l.ty);
      const pulse = 0.6 + Math.sin(world.time * 3 + l.tx) * 0.4;
      ctx.save();
      ctx.globalAlpha = 0.3 + pulse * 0.3;
      ctx.fillStyle = PALETTE.cyan;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 18 + pulse * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#2a3340';
      ctx.fillRect(c.x - 10, c.y - 10, 20, 20);
      ctx.strokeStyle = PALETTE.cyan;
      ctx.lineWidth = 2;
      ctx.shadowColor = PALETTE.cyan;
      ctx.shadowBlur = 8;
      ctx.strokeRect(c.x - 10, c.y - 10, 20, 20);
      ctx.shadowBlur = 0;
      ctx.fillStyle = PALETTE.yellow;
      ctx.font = `bold 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('◆', c.x, c.y + 4);
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
    // The key floats above its console pedestal: hologram yellow,
    // flipping 1Hz (a hologram spin) + bobbing 2px.
    const bob = Math.sin(world.time * 2) * 2;
    const flip = Math.cos(world.time * Math.PI * 2);
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(flip, 1);
    ctx.shadowColor = PALETTE.yellow;
    ctx.shadowBlur = 10;
    ctx.fillStyle = PALETTE.yellow;
    ctx.fillRect(-2, -8, 4, 12);
    ctx.beginPath();
    ctx.arc(0, -10, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(2, -2, 6, 3);
    ctx.fillRect(2, 3, 5, 3);
    ctx.restore();
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
    // Holographic sign "KESTREL DOCK" above the gangplank.
    ctx.save();
    ctx.font = `bold 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.cyan;
    ctx.shadowColor = PALETTE.cyan;
    ctx.shadowBlur = 8;
    ctx.fillText('KESTREL DOCK', x + 60, y - 40);
    ctx.restore();
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
    // Sprint noise ring: the sound radius, so the noise system reads.
    if (p.sprinting) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = PALETTE.cyan;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, NOISE.sprintRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const bobY = p.bob;
    // Round 2 (12:05 WIB): the player was still hard to find at
    // contact-sheet size (768x480), so the drawn figure is bigger and
    // brighter. Drawn size only — the collision radius in config.js is
    // unchanged, so movement, vision and the lose condition are untouched.
    const h = p.crouched ? 20 : 30; // crouch: low and wide; standing: tall and slim
    const w = p.crouched ? 28 : 22;
    // Strong cyan glow halo so the player pops at contact-sheet size.
    ctx.save();
    const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 46);
    halo.addColorStop(0, 'rgba(0,242,255,0.45)');
    halo.addColorStop(1, 'rgba(0,242,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Shadow under the player.
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 14, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body: white with a 3px cyan outline; sprint leans forward.
    ctx.save();
    ctx.translate(p.x, p.y + bobY);
    if (p.sprinting) ctx.rotate(0.12 * Math.cos(p.facing));
    ctx.fillStyle = PALETTE.white;
    ctx.strokeStyle = PALETTE.cyan;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 6);
    ctx.fill();
    ctx.stroke();
    // Directional eye line (facing): 5px cyan, the player's mark.
    ctx.strokeStyle = PALETTE.cyan;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(p.facing) * 18, Math.sin(p.facing) * 18);
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
    ctx.globalAlpha = alert ? 0.22 : suspicious ? 0.22 : 0.18;
    ctx.fillStyle = alert ? PALETTE.red : PALETTE.cyan;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Cone edge line: 2px cyan glow on PATROL, 2px red edge on ALERT.
    ctx.save();
    ctx.strokeStyle = alert ? '#ff3300' : PALETTE.cyan;
    ctx.shadowColor = alert ? '#ff3300' : PALETTE.cyan;
    ctx.shadowBlur = alert ? 0 : 6;
    ctx.globalAlpha = alert ? 0.8 : 0.5;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // Body: a trapezoid with wide shoulders + helmet + weapon/flashlight.
    // Blue on patrol, red when alert (no cyan outline — that is the player's mark).
    const bobY = Math.sin(g.stepPhase * Math.PI * 2) * 1.2;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y + 12, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(g.x, g.y + bobY);
    const chasing = g.state === GSTATE.CHASE;
    // Red pulse outline in CHASE.
    if (chasing) {
      const pulse = 0.5 + Math.sin(world.time * 8) * 0.5;
      ctx.globalAlpha = 0.4 + pulse * 0.6;
      ctx.strokeStyle = PALETTE.red;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-13, -16, 26, 32, 6);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = alert ? '#ff2e2e' : '#3a6fd8';
    ctx.strokeStyle = alert ? PALETTE.redDark : '#1c3a6e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Trapezoid: wide shoulders (top) tapering to the waist.
    ctx.moveTo(-11, -13);
    ctx.lineTo(11, -13);
    ctx.lineTo(8, 13);
    ctx.lineTo(-8, 13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Helmet: a 4px cap on top.
    ctx.fillStyle = alert ? '#ff2e2e' : '#2c55a0';
    ctx.beginPath();
    ctx.roundRect(-9, -17, 18, 5, 2);
    ctx.fill();
    // Weapon / flashlight in the right hand (6px, toward the facing).
    const wx = Math.cos(g.facing) * 12;
    const wy = Math.sin(g.facing) * 12;
    ctx.fillStyle = '#1c2340';
    ctx.fillRect(wx - 3, wy - 3, 6, 6);
    ctx.fillStyle = PALETTE.yellow;
    ctx.beginPath();
    ctx.arc(wx + Math.cos(g.facing) * 4, wy + Math.sin(g.facing) * 4, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Eye line (facing).
    ctx.strokeStyle = PALETTE.white;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(g.facing) * 12, Math.sin(g.facing) * 12);
    ctx.stroke();
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
    // Shooting effects (visual only): muzzle flash, tracer, flare.
    const fx = world.shotFx;
    if (fx) {
      if (fx.flash) {
        const a = Math.max(0, fx.flash.life / fx.flash.maxLife);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#00f2ff';
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.arc(fx.flash.x, fx.flash.y, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (fx.tracer) {
        const a = Math.max(0, fx.tracer.life / fx.tracer.maxLife);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = PALETTE.cyan;
        ctx.shadowColor = PALETTE.cyan;
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx.tracer.x1, fx.tracer.y1);
        ctx.lineTo(fx.tracer.x2, fx.tracer.y2);
        ctx.stroke();
        ctx.restore();
      }
      if (fx.flare) {
        const a = Math.max(0, fx.flare.life / fx.flare.maxLife);
        ctx.save();
        ctx.globalAlpha = a * 0.8;
        const g = ctx.createRadialGradient(fx.flare.x, fx.flare.y, 0, fx.flare.x, fx.flare.y, 80);
        g.addColorStop(0, 'rgba(255,51,0,0.5)');
        g.addColorStop(1, 'rgba(255,51,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(fx.flare.x, fx.flare.y, 80, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff3300';
        ctx.beginPath();
        ctx.arc(fx.flare.x, fx.flare.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
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
    // God rays breathe with time — the beams are visibly sweeping.
    ray(lx, ly, world.lighthouseAngle + Math.PI / 2, 340, 46, '159,232,255', 0.13 + 0.06 * Math.sin(world.time * 1.7));
    const cx = 16.5 * TILE + Math.cos(world.craneAngle) * 240;
    const cy = 7.5 * TILE + Math.sin(world.craneAngle) * 150;
    ray(16.5 * TILE, 7.5 * TILE, world.craneAngle, 300, 34, '255,255,255', 0.16 + 0.07 * Math.sin(world.time * 2.3 + 1));
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
    // 6) Ambient dust motes drifting through the light — the air is alive.
    ctx.save();
    for (const m of this.dust) {
      const mx = (m.x + world.time * m.speed) % WIDTH;
      const my = m.y + Math.sin(world.time * 0.8 + m.phase) * 6;
      const tw = 0.25 + 0.25 * Math.sin(world.time * 2 + m.phase);
      ctx.globalAlpha = tw;
      ctx.fillStyle = '#cfe8ff';
      ctx.beginPath();
      ctx.arc(mx, my, m.r, 0, Math.PI * 2);
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
    const ow = ctx.measureText(objective).width + 20;
    ctx.fillStyle = 'rgba(5,6,11,0.72)';
    ctx.fillRect(10, 10, ow, 26);
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(objective, 20, 28);
    // Neon underline under the objective bar.
    ctx.fillStyle = PALETTE.cyan;
    ctx.fillRect(10, 36, ow, 2);
    // Top-center: detection meter (arc ring, green -> yellow -> red).
    const d = world.detection;
    const mx = WIDTH / 2;
    const my = 30;
    const rr = 16;
    const col = d < 35 ? '#2fbf5a' : d < 70 ? PALETTE.yellow : PALETTE.red;
    const label = d < 35 ? 'HIDDEN' : d < 70 ? 'SPOTTED' : 'SEEN';
    // Detection ring breathes (a living HUD) — faster when danger rises.
    const breathe = 0.85 + 0.15 * Math.sin(world.time * 2.4);
    ctx.save();
    ctx.globalAlpha = breathe;
    ctx.shadowColor = PALETTE.cyan;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(mx, my, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
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
    // The SEEN label pulses in brightness (always visible — a staged
    // screenshot must never catch it hidden) — the danger is unmissable.
    ctx.save();
    if (label === 'SEEN') ctx.globalAlpha = 0.8 + 0.2 * Math.sin(world.time * 10);
    ctx.fillStyle = col;
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(label, mx, my + 32);
    ctx.restore();
    // Lit/shadow indicator: whether the player is in an environmental light.
    const lit = world.playerLit ? world.playerLit() : false;
    ctx.fillStyle = lit ? PALETTE.yellow : PALETTE.cyan;
    ctx.font = `bold 10px ${FONT}`;
    ctx.fillText(lit ? '◉ LIT' : '◐ SHADOW', mx, my + 48);
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
    // Top-right, second row: the live score (cyan; red + shake when detected).
    ctx.fillStyle = 'rgba(5,6,11,0.72)';
    ctx.fillRect(sx, 36, 140, 26);
    ctx.save();
    if (d > 0) {
      ctx.translate(Math.sin(world.time * 30) * 2, 0);
      ctx.fillStyle = PALETTE.red;
    } else {
      ctx.fillStyle = PALETTE.cyan;
    }
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillText(formatScore(liveScore(world.score)), sx + 10, 54);
    ctx.restore();
    // Interaction prompt: what E does here (responsive interaction feedback).
    const pp = world.player;
    let prompt = '';
    if (!world.keyTaken && Math.hypot(pp.x - world.keyPos.x, pp.y - world.keyPos.y) < 40) prompt = 'E — TAKE THE IGNITION KEY';
    else if (!world.breakerUsed && Math.hypot(pp.x - world.breakerPos.x, pp.y - world.breakerPos.y) < 40) prompt = 'E — SABOTAGE BREAKER (DARKEN THE YARD)';
    else if (world.keyTaken && Math.hypot(pp.x - world.exitPos.x, pp.y - world.exitPos.y) < 42) prompt = 'E — BOARD THE KESTREL';
    if (prompt) {
      ctx.font = `bold 14px ${FONT}`;
      const pw = ctx.measureText(prompt).width + 20;
      ctx.fillStyle = 'rgba(5,6,11,0.8)';
      ctx.fillRect(WIDTH / 2 - pw / 2, HEIGHT - 44, pw, 26);
      ctx.fillStyle = PALETTE.yellow;
      ctx.textAlign = 'center';
      ctx.fillText(prompt, WIDTH / 2, HEIGHT - 26);
      ctx.textAlign = 'left';
    }
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
    // Layered harbour: 14 buildings (80-180px tall) with neon windows.
    for (let i = 0; i < 14; i++) {
      const bx = 40 + i * 90 + hashNoise(i, 3, 11) * 30;
      const bh = 80 + hashNoise(i, 5, 11) * 100;
      const by = 480 - bh;
      ctx.fillStyle = '#131a33';
      ctx.fillRect(bx, by, 70, bh);
      // Neon windows (small cyan/yellow rects with glow), twinkling.
      const rows = Math.floor(bh / 34);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 2; c++) {
          if (hashNoise(i * 7 + r, c, 17) > 0.45) {
            const winCol = hashNoise(i, r + c, 19) > 0.5 ? PALETTE.cyan : PALETTE.yellow;
            // Windows twinkle (per-window phase) — the skyline is awake.
            const tw = 0.55 + 0.45 * Math.sin(world.time * 2.2 + i * 1.3 + r * 2.1 + c * 3.7);
            ctx.save();
            ctx.globalAlpha = tw;
            ctx.shadowColor = winCol;
            ctx.shadowBlur = 6;
            ctx.fillStyle = winCol;
            ctx.fillRect(bx + 10 + c * 28, by + 12 + r * 34, 12, 16);
            ctx.restore();
          }
        }
      }
    }
    // 3 crane silhouettes with a 1px neon-cyan outline.
    for (const cx of [200, 640, 1100]) {
      const ch = 150 + hashNoise(cx, 2, 23) * 50;
      const cy = 480 - ch;
      ctx.save();
      ctx.strokeStyle = PALETTE.cyan;
      ctx.shadowColor = PALETTE.cyan;
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, 480);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + 90, cy + 18);
      ctx.moveTo(cx, cy + 30);
      ctx.lineTo(cx - 40, cy + 30);
      ctx.stroke();
      ctx.restore();
      // Crane hook line.
      ctx.strokeStyle = 'rgba(0,242,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 90, cy + 18);
      ctx.lineTo(cx + 90, cy + 60);
      ctx.stroke();
    }
    // Water + neon reflections at the bottom.
    ctx.fillStyle = '#001a2e';
    ctx.fillRect(0, 500, WIDTH, 220);
    const wob = Math.sin(world.time * 2) * 2;
    ctx.save();
    for (let i = 0; i < 10; i++) {
      // Reflections drift and shimmer — the water is moving.
      const rx = 80 + i * 120 + hashNoise(i, 9, 29) * 40 + Math.sin(world.time * 0.7 + i) * 12;
      ctx.globalAlpha = 0.3 + 0.2 * Math.sin(world.time * 1.8 + i * 1.1);
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(255,0,255,0.35)' : 'rgba(0,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rx, 520 + wob);
      ctx.lineTo(rx + 50, 520 + wob);
      ctx.moveTo(rx + 10, 540 - wob);
      ctx.lineTo(rx + 40, 540 - wob);
      ctx.stroke();
    }
    ctx.restore();
    // Lighthouse (wider beam, pale cyan, with glow).
    const lx = 90;
    const ly = HEIGHT - 260;
    ctx.fillStyle = PALETTE.yellow;
    ctx.fillRect(lx - 3, ly, 6, 90);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(lx, ly);
    ctx.rotate(world.lighthouseAngle);
    const g = ctx.createLinearGradient(0, 0, 460, 0);
    g.addColorStop(0, 'rgba(159,232,255,0.4)');
    g.addColorStop(1, 'rgba(159,232,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(460, -58);
    ctx.lineTo(460, 58);
    ctx.lineTo(0, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Title briefing box (centered 480x120 at (640,220), two lines, no tail).
    ctx.fillStyle = 'rgba(5,6,11,0.72)';
    ctx.fillRect(WIDTH / 2 - 240, 160, 480, 120);
    ctx.strokeStyle = PALETTE.cyan;
    ctx.lineWidth = 1;
    ctx.strokeRect(WIDTH / 2 - 240, 160, 480, 120);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.text;
    ctx.font = `bold 17px ${FONT}`;
    ctx.fillText('Secure the key. Escape unseen.', WIDTH / 2, 210);
    ctx.fillStyle = PALETTE.cyan;
    ctx.font = `15px ${FONT}`;
    ctx.fillText('— Understood.', WIDTH / 2, 242);
    // Holographic neon title: cyan + a magenta echo, pulsing, scanlines.
    const tPulse = 1 + Math.sin(world.time * Math.PI) * 0.07;
    ctx.save();
    ctx.translate(WIDTH / 2, 330);
    ctx.scale(tPulse, tPulse);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.magenta;
    ctx.font = `bold 84px ${FONT}`;
    ctx.shadowColor = PALETTE.magenta;
    ctx.shadowBlur = 15;
    ctx.fillText('SHADOW DOCK', 3, 3);
    ctx.fillStyle = PALETTE.cyan;
    ctx.shadowColor = PALETTE.cyan;
    ctx.shadowBlur = 26;
    ctx.fillText('SHADOW DOCK', 0, 0);
    ctx.restore();
    // Scanlines over the title (a 60fps shimmer).
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#000000';
    for (let y = 290; y < 380; y += 6) {
      ctx.fillRect(WIDTH / 2 - 340, y, 680, 2);
    }
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.text;
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillText('A NIGHT PORT HEIST — STEAL THE KEY. BOARD THE KESTREL.', WIDTH / 2, 400);
    const pulse = 0.55 + Math.sin(world.time * 3) * 0.45;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = PALETTE.yellow;
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillText('PRESS ENTER TO START', WIDTH / 2, 470);
    ctx.globalAlpha = 1;
    // Controls line, moved to y=620 with a dark background (no overlap).
    const ctrl = 'WASD MOVE · C CROUCH · SHIFT SPRINT · CLICK THROW COIN · E INTERACT';
    ctx.font = `14px ${FONT}`;
    const cw = ctx.measureText(ctrl).width + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(WIDTH / 2 - cw / 2, 604, cw, 30);
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(ctrl, WIDTH / 2, 624);
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
    // Water below the hull (gradient + mast/neon reflections).
    const wg = ctx.createLinearGradient(0, 420, 0, HEIGHT);
    wg.addColorStop(0, '#001a3a');
    wg.addColorStop(1, '#000a1a');
    ctx.fillStyle = wg;
    ctx.fillRect(0, 420, WIDTH, 300);
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = 'rgba(255,170,0,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2 - 30, 440);
    ctx.lineTo(WIDTH / 2 + 30, 440);
    ctx.moveTo(WIDTH / 2 - 20, 460);
    ctx.lineTo(WIDTH / 2 + 20, 460);
    ctx.stroke();
    ctx.restore();
    // The Kestrel: a real ship (hull trapezoid + mast + rail + portholes).
    ctx.save();
    ctx.shadowColor = PALETTE.amber;
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#1a1a1a';
    ctx.strokeStyle = PALETTE.amber;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(400, 300);
    ctx.lineTo(880, 300);
    ctx.lineTo(920, 420);
    ctx.lineTo(360, 420);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Mast (neon amber) + railing + portholes + cabin lights.
    ctx.save();
    ctx.strokeStyle = PALETTE.amber;
    ctx.shadowColor = PALETTE.amber;
    ctx.shadowBlur = 6;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(640, 300);
    ctx.lineTo(640, 180);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,170,0,0.33)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(400, 320);
    ctx.lineTo(880, 320);
    ctx.moveTo(370, 380);
    ctx.lineTo(910, 380);
    ctx.stroke();
    for (let pi = 0; pi < 6; pi++) {
      const px = [460, 540, 620, 700, 780, 860][pi];
      // Portholes twinkle — the ship is alive and lit.
      ctx.save();
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(world.time * 2.6 + pi * 1.7);
      ctx.fillStyle = PALETTE.amber;
      ctx.shadowColor = PALETTE.amber;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(px, 360, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (const cx of [460, 580, 700, 820]) {
      ctx.save();
      ctx.fillStyle = '#ffdd00';
      ctx.shadowColor = '#ffdd00';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(cx, 310, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Thruster glow (blue, pulsing) at the stern.
    const tpulse = 0.5 + Math.sin(world.time * Math.PI) * 0.5;
    ctx.save();
    ctx.globalAlpha = 0.3 + tpulse * 0.4;
    const tg = ctx.createRadialGradient(370, 410, 0, 370, 410, 60);
    tg.addColorStop(0, 'rgba(0,136,255,0.6)');
    tg.addColorStop(1, 'rgba(0,136,255,0)');
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.arc(370, 410, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // The player aboard, radius 16px with a pulse glow.
    const ppulse = 12 + Math.sin(world.time * 3) * 4;
    ctx.save();
    const pg = ctx.createRadialGradient(WIDTH / 2, 330, 0, WIDTH / 2, 330, ppulse + 12);
    pg.addColorStop(0, 'rgba(0,242,255,0.35)');
    pg.addColorStop(1, 'rgba(0,242,255,0)');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(WIDTH / 2, 330, ppulse + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = PALETTE.white;
    ctx.strokeStyle = PALETTE.cyan;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(WIDTH / 2 - 8, 330 - 12, 16, 24, 5);
    ctx.fill();
    ctx.stroke();
    // Fog parting around the ship.
    ctx.fillStyle = 'rgba(107,114,128,0.16)';
    ctx.fillRect(0, 420, WIDTH, 300);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.text;
    ctx.font = `bold 46px ${FONT}`;
    ctx.fillText('MISSION COMPLETE', WIDTH / 2, 120);
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = `18px ${FONT}`;
    const mins = Math.floor(world.winTime / 60);
    const secs = Math.floor(world.winTime % 60);
    ctx.fillText(`ESCAPED IN ${mins}:${String(secs).padStart(2, '0')} — THE KESTREL SAILS AT DAWN`, WIDTH / 2, 160);
    if (world.noDetections) {
      ctx.fillStyle = PALETTE.yellow;
      ctx.font = `bold 20px ${FONT}`;
      ctx.fillText('★ NO DETECTIONS ★', WIDTH / 2, 200);
    }
    // "Clean getaway." — the player's win line, in a talk bubble above the deck.
    const winLine = 'Clean getaway.';
    ctx.font = `12px 'IBM Plex Mono', 'Courier New', monospace`;
    const bw = Math.ceil(ctx.measureText(winLine).width) + 20;
    const bx = WIDTH / 2 - bw / 2;
    const by = 213;
    ctx.fillStyle = 'rgba(20,20,20,0.92)';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, 32, 6);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2 - 7, by + 32);
    ctx.lineTo(WIDTH / 2 + 7, by + 32);
    ctx.lineTo(WIDTH / 2, by + 42);
    ctx.closePath();
    ctx.fillStyle = 'rgba(20,20,20,0.92)';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#eeeeee';
    ctx.textAlign = 'left';
    ctx.fillText(winLine, bx + 10, by + 21);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = `15px ${FONT}`;
    ctx.fillText('ENTER PLAY AGAIN · Q QUIT TO TITLE', WIDTH / 2, 520);
    // Score breakdown (computed, never hardcoded) + grade, bottom-right.
    const allLoot = world.loot.every((l) => l.taken);
    const bd = computeBreakdown(world.score, world.winTime, allLoot);
    const px = 980;
    const py = 540;
    ctx.fillStyle = 'rgba(5,6,11,0.6)';
    ctx.fillRect(px, py, 260, 140);
    ctx.strokeStyle = PALETTE.dockLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, 260, 140);
    ctx.textAlign = 'left';
    ctx.fillStyle = PALETTE.textDim;
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillText('SCORE', px + 12, py + 20);
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = PALETTE.text;
    const rows = bd.rows;
    for (let i = 0; i < rows.length; i++) {
      const yy = py + 40 + i * 15;
      ctx.fillText(rows[i][0], px + 12, yy);
      ctx.textAlign = 'right';
      ctx.fillText(String(rows[i][1]), px + 248, yy);
      ctx.textAlign = 'left';
    }
    ctx.fillStyle = PALETTE.text;
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillText('TOTAL', px + 12, py + 118);
    ctx.textAlign = 'right';
    ctx.fillText(String(bd.total), px + 248, py + 118);
    ctx.fillStyle = PALETTE.yellow;
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillText('GRADE: ' + bd.grade, px + 248, py + 136);
    ctx.textAlign = 'left';
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

  // Talk bubbles (z-order: cones < guards/player < bubbles < HUD).
  drawTalk(world) {
    if (world.talk) world.talk.draw(this.ctx, world);
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
    this.drawTalk(world);
    this.drawHUD(world);
    if (screen === SCREEN.PAUSE) this.drawPause();
    else if (screen === SCREEN.CAUGHT) this.drawCaught(world);
    ctx.restore();
  }
}
