// SHADOW DOCK — talk system: state-mapped guard barks + player lines,
// animated speech bubbles with a tidy layout.
// Lines (EN, <=6 words). Animation: pop-in 80ms (ease-out), typing
// 30ms/char (max 1.2s), hold 2.0s, fade-out 400ms, auto-hide 3.5s.
// Layout: anchor (0,-56px) above the speaker; max width 220px, min
// 80px; padding 10px/8px; tail 14x10; z-order cones < guards/player <
// bubbles < HUD. Collision avoid: shift ±X up to 60px, then suppress
// (cone priority; the player line is never suppressed).
export const TALK_LINES = {
  system: 'Secure the key. Escape unseen.',
  playerUnderstood: 'Understood.',
  guardPatrol: 'All clear. Night shift drags.',
  guardSuspect: "Halt! Who's there?",
  guardInvestigate: 'Something moved over there.',
  guardChase: 'Intruder! Sound the alarm!',
  playerObj1: "Key's in the office.",
  playerObj2: 'Board the Kestrel. Now.',
  playerWin: 'Clean getaway.',
};

// Guard-state priority for the single guard-bubble slot:
// CHASE > INVESTIGATE > SUSPECT > PATROL.
export const TALK_PRIORITY = { patrol: 1, suspect: 2, investigate: 3, chase: 4 };

// Emotion marks prepended to a line by state.
export function emotionFor(state) {
  if (state === 'chase' || state === 'suspect') return '! ';
  if (state === 'investigate') return '? ';
  return '... ';
}

const POP_IN = 0.08; // seconds, scale 0 -> 1 (ease-out)
const TYPE_MS = 0.03; // seconds per char
const TYPE_MAX = 1.2; // seconds, typing cap
const HOLD = 2.0; // seconds after typing
const FADE = 0.4; // seconds, fade-out
const AUTO_HIDE = 3.5; // seconds from pop-in start
const MAX_W = 220;
const MIN_W = 80;
const PAD_X = 10;
const PAD_Y = 8;
const TAIL_W = 14;
const TAIL_H = 10;
const FONT = "12px 'IBM Plex Mono', 'Courier New', monospace";
const LINE_H = 16;

export class Talk {
  constructor() {
    this.now = 0;
    this.bubbles = []; // {text, ax, ay, kind, slot, t0, below}
  }

  reset(now) {
    this.now = now || 0;
    this.bubbles = [];
  }

  // Add a live bubble (animates from pop-in). slot is 'guard' | 'player'
  // | 'system' — at most one bubble per slot; a guard bubble is replaced
  // only by a higher-priority guard state.
  say(text, ax, ay, kind, slot, priority) {
    const i = this.bubbles.findIndex((b) => b.slot === slot);
    if (i >= 0) {
      if (slot === 'guard' && (priority || 0) < (this.bubbles[i].priority || 0)) return false;
      this.bubbles.splice(i, 1);
    }
    this.bubbles.push({ text, ax, ay, kind, slot, priority: priority || 0, t0: this.now, below: false });
    return true;
  }

  // Add a bubble already fully typed and in its hold phase (for the
  // staged ?shot= scenes, which draw a single deterministic frame).
  stage(text, ax, ay, kind, slot) {
    const i = this.bubbles.findIndex((b) => b.slot === slot);
    if (i >= 0) this.bubbles.splice(i, 1);
    this.bubbles.push({ text, ax, ay, kind, slot, priority: 0, t0: this.now - 1.0, below: false });
  }

  update(dt) {
    this.now += dt;
    this.bubbles = this.bubbles.filter((b) => this.now - b.t0 < AUTO_HIDE);
  }

  // Wrap the text to the max width; returns the lines and the bubble size.
  measure(ctx, text) {
    ctx.font = FONT;
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > MAX_W - PAD_X * 2 && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    let w = MIN_W;
    for (const ln of lines) w = Math.max(w, Math.ceil(ctx.measureText(ln).width) + PAD_X * 2);
    w = Math.min(MAX_W, w);
    return { lines, w, h: lines.length * LINE_H + PAD_Y * 2 };
  }

  // The bubble rect for an anchor (ax, ay) with a given size and shift.
  // The tail tip sits at the anchor; the box sits above it (or below it
  // when `below` is set, e.g. near the top HUD).
  rectFor(ax, ay, w, h, shiftX, below) {
    const x = ax - w / 2 + shiftX;
    const y = below ? ay + TAIL_H : ay - TAIL_H - h;
    return { x, y, w, h };
  }

  // Does a rect overlap the player, a guard, or the HUD bars?
  overlaps(world, r) {
    const p = world.player;
    if (r.x < p.x + 26 && r.x + r.w > p.x - 26 && r.y < p.y + 26 && r.y + r.h > p.y - 26) return true;
    for (const g of world.guards) {
      if (r.x < g.x + 26 && r.x + r.w > g.x - 26 && r.y < g.y + 26 && r.y + r.h > g.y - 26) return true;
    }
    if (r.y < 70) return true; // top HUD bar
    if (r.y + r.h > 690) return true; // bottom hint bar
    return false;
  }

  draw(ctx, world) {
    for (const b of this.bubbles) {
      const age = this.now - b.t0;
      if (age < 0 || age >= AUTO_HIDE) continue;
      const { lines, w, h } = this.measure(ctx, b.text);
      // Typing: 30ms/char, capped at 1.2s; pop-in 80ms; hold 2.0s; fade 400ms.
      const typeTime = Math.min(TYPE_MAX, b.text.length * TYPE_MS);
      const shown = age < POP_IN ? 0
        : age < POP_IN + typeTime ? Math.floor(((age - POP_IN) / TYPE_MS))
        : b.text.length;
      const scale = age < POP_IN ? 0.2 + 0.8 * (age / POP_IN) : 1;
      const fadeStart = POP_IN + typeTime + HOLD;
      const alpha = age < fadeStart ? 1 : Math.max(0, 1 - (age - fadeStart) / FADE);
      // Place above the speaker; if that would hit the top HUD, go below.
      let below = b.ay - TAIL_H - h < 70;
      // Collision avoid: try shifts 0, -30, +30, -60, +60; pick the first
      // clear one. A guard bubble is suppressed if none is clear (cone
      // priority); a player bubble is never suppressed.
      let shift = 0;
      let clear = false;
      for (const s of [0, -30, 30, -60, 60]) {
        const r = this.rectFor(b.ax, b.ay, w, h, s, below);
        if (!this.overlaps(world, r)) {
          shift = s;
          clear = true;
          break;
        }
      }
      if (!clear && b.slot === 'guard') continue;
      if (!clear && b.slot === 'player') shift = 0;
      const r = this.rectFor(b.ax, b.ay, w, h, shift, below);
      const cx = b.ax + shift;
      const tipY = below ? b.ay : b.ay;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, below ? r.y + h / 2 : r.y + h / 2);
      ctx.scale(scale, scale);
      ctx.translate(-cx, below ? -(r.y + h / 2) : -(r.y + h / 2));
      // Bubble box.
      ctx.fillStyle = 'rgba(20,20,20,0.92)';
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 6);
      ctx.fill();
      ctx.stroke();
      // Tail (isosceles 14x10) pointing at the anchor.
      ctx.beginPath();
      if (below) {
        ctx.moveTo(cx - TAIL_W / 2, r.y);
        ctx.lineTo(cx + TAIL_W / 2, r.y);
        ctx.lineTo(cx, tipY);
      } else {
        ctx.moveTo(cx - TAIL_W / 2, r.y + r.h);
        ctx.lineTo(cx + TAIL_W / 2, r.y + r.h);
        ctx.lineTo(cx, tipY);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(20,20,20,0.92)';
      ctx.fill();
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Typed text (clipped to the shown char count).
      ctx.fillStyle = '#eeeeee';
      ctx.font = FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      let remaining = shown;
      for (let i = 0; i < lines.length; i++) {
        const part = lines[i].slice(0, Math.max(0, remaining));
        ctx.fillText(part, r.x + PAD_X, r.y + PAD_Y + (i + 1) * LINE_H - 4);
        remaining -= lines[i].length;
        if (remaining <= 0) break;
      }
      ctx.restore();
    }
  }
}
