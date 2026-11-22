// Vision: Bresenham raycast against the tilemap. A guard sees the player
// only when the player is inside the cone AND the raycast from the guard
// to the player is unblocked. This is a line-of-sight check, not a
// distance check — containers block cones, and crates hide a CROUCHED
// player (half cover). Deterministic: same positions, same answer.
import { TILE, levelAt, isSolidTile, T } from './config.js';

// Walk the grid cells a line from (x0,y0) to (x1,y1) passes through
// (Bresenham). Calls visit(tx, ty) for each cell; stops when visit
// returns false. Returns true when the walk completed (no blocker).
export function raycastTiles(x0, y0, x1, y1, visit) {
  let tx0 = Math.floor(x0 / TILE);
  let ty0 = Math.floor(y0 / TILE);
  const tx1 = Math.floor(x1 / TILE);
  const ty1 = Math.floor(y1 / TILE);
  const dx = Math.abs(tx1 - tx0);
  const dy = -Math.abs(ty1 - ty0);
  const sx = tx0 < tx1 ? 1 : -1;
  const sy = ty0 < ty1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (!visit(tx0, ty0)) return false;
    if (tx0 === tx1 && ty0 === ty1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      tx0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ty0 += sy;
    }
  }
}

// Is the tile at (tx,ty) opaque to a vision ray? Containers always block.
// A crate blocks only a crouched target (half cover).
function blocksVision(tx, ty, targetCrouched) {
  const ch = levelAt(tx, ty);
  if (ch === T.CONTAINER) return true;
  if (ch === T.CRATE && targetCrouched) return true;
  return false;
}

// Is `target` (px, py) visible from `from` (fx, fy) given the cone?
// Returns { visible, blocked } — visible only when inside the cone AND
// the raycast is clear. `facing` is the guard's facing angle (radians),
// `halfAngle` the cone half-angle, `range` the cone length.
export function canSee(fx, fy, facing, halfAngle, range, tx, ty, targetCrouched) {
  const dx = tx - fx;
  const dy = ty - fy;
  const dist = Math.hypot(dx, dy);
  if (dist > range) return { visible: false, blocked: false };
  if (dist < 1) return { visible: true, blocked: false };
  // Angle between the facing direction and the direction to the target.
  let ang = Math.atan2(dy, dx) - facing;
  while (ang > Math.PI) ang -= Math.PI * 2;
  while (ang < -Math.PI) ang += Math.PI * 2;
  if (Math.abs(ang) > halfAngle) return { visible: false, blocked: false };
  // Raycast: blocked when any cell on the line is opaque. Skip the
  // guard's own cell and the target's cell (the target stands in it).
  let blocked = false;
  let first = true;
  raycastTiles(fx, fy, tx, ty, (cx, cy) => {
    if (first) {
      first = false;
      return true; // guard's own cell
    }
    if (cx === Math.floor(tx / TILE) && cy === Math.floor(ty / TILE)) return true;
    if (blocksVision(cx, cy, targetCrouched)) {
      blocked = true;
      return false;
    }
    return true;
  });
  return { visible: !blocked, blocked };
}

// How central is the target inside the cone? 1 = dead centre, 0 = edge.
// Used to scale how fast detection fills (lit + central fills fastest).
export function coneCentrality(fx, fy, facing, halfAngle, tx, ty) {
  const dx = tx - fx;
  const dy = ty - fy;
  let ang = Math.atan2(dy, dx) - facing;
  while (ang > Math.PI) ang -= Math.PI * 2;
  while (ang < -Math.PI) ang += Math.PI * 2;
  const a = Math.abs(ang) / halfAngle;
  return Math.max(0, 1 - a);
}

// Is a point lit (not in shadow)? A point is in shadow when a container
// stands between it and the nearest light — simplified: a point is lit
// when no container is within 60px on the side away from the player
// flashlight. For the game we use: lit when the point is inside any
// light pool (lamp, ship deck, crane light) or within the player's
// flashlight cone. This helper answers the simple case used by detection:
// lit when the player is NOT behind a container from the guard's side.
export function isLit(px, py, lights) {
  for (const l of lights) {
    const d = Math.hypot(px - l.x, py - l.y);
    if (d < l.radius) return true;
  }
  return false;
}

// Sample points along the cone edge (for rendering the cone polygon).
// Returns the points where each ray hits a blocker or the range limit.
export function coneEdgePoints(fx, fy, facing, halfAngle, range, targetCrouched, steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = facing - halfAngle + (2 * halfAngle * i) / steps;
    const ex = fx + Math.cos(a) * range;
    const ey = fy + Math.sin(a) * range;
    // March along the ray in 8px steps; stop at the first opaque cell.
    let hitX = ex;
    let hitY = ey;
    const len = Math.hypot(ex - fx, ey - fy);
    const n = Math.max(1, Math.ceil(len / 8));
    for (let s = 1; s <= n; s++) {
      const px = fx + ((ex - fx) * s) / n;
      const py = fy + ((ey - fy) * s) / n;
      const tx = Math.floor(px / TILE);
      const ty = Math.floor(py / TILE);
      if (blocksVision(tx, ty, targetCrouched)) {
        hitX = px;
        hitY = py;
        break;
      }
    }
    pts.push({ x: hitX, y: hitY });
  }
  return pts;
}

// Is a tile solid for movement (containers + crates block the player)?
export function solidAtPixel(x, y) {
  const ch = levelAt(Math.floor(x / TILE), Math.floor(y / TILE));
  return isSolidTile(ch);
}
