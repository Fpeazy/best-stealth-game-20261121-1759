// Keyboard + mouse input. Tracks held keys and the mouse position in
// canvas pixels, plus edge-triggered presses (used once, then cleared).
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, down: false, clicked: false };
    this.canvas = canvas;
    this.onKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (!e.repeat) this.pressed.add(k);
      this.keys.add(k);
    };
    this.onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
    this.onMouseMove = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * canvas.width;
      this.mouse.y = ((e.clientY - r.top) / r.height) * canvas.height;
    };
    this.onMouseDown = (e) => {
      this.onMouseMove(e);
      this.mouse.down = true;
      this.mouse.clicked = true;
    };
    this.onMouseUp = () => {
      this.mouse.down = false;
    };
    this.onBlur = () => {
      this.keys.clear();
      this.mouse.down = false;
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onBlur);
  }

  // Movement axes: WASD + arrows. Returns a unit-ish vector (may be diagonal).
  moveVector() {
    let x = 0;
    let y = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.sqrt(2);
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  get crouch() {
    return this.keys.has('c');
  }
  get sprint() {
    return this.keys.has('shift');
  }
  // Edge-triggered: true once per physical press.
  wasPressed(key) {
    return this.pressed.has(key.toLowerCase());
  }
  get interact() {
    return this.wasPressed('e');
  }
  get pause() {
    return this.wasPressed('p') || this.wasPressed('escape');
  }
  get confirm() {
    return this.wasPressed('enter') || this.wasPressed(' ');
  }
  get throwCoin() {
    const c = this.mouse.clicked;
    this.mouse.clicked = false;
    return c;
  }
  // Clear edge-triggered state at the end of each frame.
  endFrame() {
    this.pressed.clear();
  }
  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
