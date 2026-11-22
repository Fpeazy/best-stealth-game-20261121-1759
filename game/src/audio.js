// Synthesized sound (Web Audio, no external files). Every sound is a
// short oscillator/noise burst, created lazily on first user gesture
// (browsers block audio before interaction). All sounds are optional:
// the game plays silently when audio is unavailable.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  ensure() {
    if (this.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.25;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  // A short tone: frequency sweep from f0 to f1 over `dur` seconds.
  tone(f0, f1, dur, type = 'sine', gain = 0.5) {
    if (!this.enabled || !this.ensure()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Filtered noise burst (footsteps, splashes, wind).
  noise(dur, freq, gain = 0.4, type = 'lowpass') {
    if (!this.enabled || !this.ensure()) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  // Footstep, synced to the player's step cycle. Sprint steps are
  // louder and faster; water steps splash.
  step(sprinting, inWater) {
    if (inWater) {
      this.noise(0.18, 900, sprinting ? 0.5 : 0.3, 'bandpass');
    } else {
      this.noise(0.07, sprinting ? 500 : 300, sprinting ? 0.5 : 0.28);
    }
  }

  coin() {
    this.tone(1800, 2400, 0.12, 'sine', 0.5);
    this.tone(2400, 1800, 0.1, 'sine', 0.3);
  }

  pickup() {
    this.tone(660, 990, 0.12, 'triangle', 0.5);
    this.tone(990, 1320, 0.14, 'triangle', 0.4);
  }

  alert() {
    this.tone(440, 880, 0.25, 'square', 0.35);
  }

  caught() {
    this.tone(220, 55, 0.6, 'sawtooth', 0.5);
    this.noise(0.4, 200, 0.5);
  }

  win() {
    this.tone(523, 523, 0.15, 'triangle', 0.45);
    this.tone(659, 659, 0.15, 'triangle', 0.45);
    this.tone(784, 1046, 0.35, 'triangle', 0.5);
  }

  // The ship's engine rumble on the win (low, slow, felt more than heard).
  engine() {
    if (!this.enabled || !this.ensure()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(48, t);
    o.frequency.linearRampToValueAtTime(72, t + 2.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.8);
    g.gain.linearRampToValueAtTime(0.001, t + 2.8);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 160;
    o.connect(f);
    f.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 3);
  }

  // A distant foghorn (two long, low notes).
  foghorn() {
    this.tone(110, 108, 1.6, 'sine', 0.22);
    setTimeout(() => this.tone(110, 104, 1.4, 'sine', 0.18), 2200);
  }
}
