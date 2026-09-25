import type { MusicFrame } from '../../analysis/types';
import { makeCanvas } from '../common/gl';
import { clamp, damp, lerp, mulberry32, noise1 } from '../common/math';
import type { Visualizer } from '../types';

/**
 * RIDGES — a spectral mountain range under a pulsing sun.
 * Each ridge is a snapshot of the spectrum (low frequencies in the centre),
 * spawned twice per beat, so the landscape advances in tempo toward the viewer.
 *  - kick: the sun swells and the newest ridge flares
 *  - snare: a scan line races from the front to the horizon
 *  - hats: stars twinkle; treble: ridge sharpness
 *  - section change: palette; drop: the whole range surges and the sun flares
 */
type RGB = [number, number, number];
interface Palette { skyTop: RGB; skyBottom: RGB; near: RGB; far: RGB; sunTop: RGB; sunBottom: RGB }

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const PALETTES: Palette[] = [
  { skyTop: hex('#06051a'), skyBottom: hex('#1d0b31'), near: hex('#ffb86b'), far: hex('#4b33b5'), sunTop: hex('#ffe08a'), sunBottom: hex('#ff4f8b') },
  { skyTop: hex('#020912'), skyBottom: hex('#062238'), near: hex('#a6f4ff'), far: hex('#23507e'), sunTop: hex('#f2fdff'), sunBottom: hex('#4fb8ff') },
  { skyTop: hex('#0d0206'), skyBottom: hex('#2b0712'), near: hex('#ff5a74'), far: hex('#651a3c'), sunTop: hex('#ffd1a8'), sunBottom: hex('#ff2e4d') },
  { skyTop: hex('#020f0d'), skyBottom: hex('#0a2a22'), near: hex('#86ffb8'), far: hex('#1d6553'), sunTop: hex('#f1ffc9'), sunBottom: hex('#35d99a') },
];

const ROWS = 60;
const POINTS = 120;
const rgb = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export default class RidgesVisualizer implements Visualizer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;

  /** Ring buffer of ridge profiles (0..1 heights). */
  private rows = new Float32Array(ROWS * POINTS);
  private rowFlare = new Float32Array(ROWS);
  private head = 0;
  private phase = 0;
  private live = new Float32Array(POINTS);
  private pal: Palette = structuredClone(PALETTES[0]);
  private palIdx = 0;
  private sun = 0;
  private flare = 0;
  private surge = 0;
  private scan = -1;
  private time = 0;
  private stars: { x: number; y: number; r: number; p: number }[] = [];
  private seed = 0;
  private xs = new Float32Array(POINTS);
  private weights = new Float32Array(POINTS);
  private bandIdx = new Float32Array(POINTS);

  mount(layer: HTMLElement): void {
    this.canvas = makeCanvas(layer);
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    const rnd = mulberry32(5);
    for (let i = 0; i < 160; i++) this.stars.push({ x: rnd(), y: rnd() * rnd(), r: 0.4 + rnd() * 1.2, p: rnd() * 10 });
    for (let i = 0; i < POINTS; i++) {
      const x = (i / (POINTS - 1)) * 2 - 1;
      this.xs[i] = x;
      // Mountains in the middle, plains at the edges.
      this.weights[i] = Math.pow(Math.exp(-x * x * 4.5), 0.9) * 0.92 + 0.08;
      // Centre = low frequencies, edges = highs (mirrored).
      this.bandIdx[i] = Math.pow(Math.abs(x), 0.85) * 60;
    }
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.w = width;
    this.h = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  private profile(m: MusicFrame, out: Float32Array, offset: number): void {
    const spec = m.spectrum;
    this.seed += 1.7;
    const sharp = 1.2 + m.bands.treble * 0.8;
    for (let i = 0; i < POINTS; i++) {
      const b = this.bandIdx[i];
      const i0 = Math.floor(b);
      const f = b - i0;
      const v = spec[i0] * (1 - f) + spec[Math.min(63, i0 + 1)] * f;
      const rough = 0.06 * (noise1(i * 0.35 + this.seed, 3) * 0.5 + 0.5);
      out[offset + i] = (Math.pow(v, sharp) * 0.95 + rough * (0.3 + v)) * this.weights[i];
    }
  }

  update(m: MusicFrame): void {
    const dt = m.dt;
    this.time += dt;
    // Two ridges per beat when playing; a slow drift otherwise.
    const rate = m.playing ? (m.bpm / 60) * 2 : 0.6;
    this.phase += rate * dt;
    while (this.phase >= 1) {
      this.phase -= 1;
      this.head = (this.head + 1) % ROWS;
      this.profile(m, this.rows, this.head * POINTS);
      this.rowFlare[this.head] = m.kickEnv;
    }
    this.profile(m, this.live, 0);

    if (m.kick) this.sun = Math.min(1, this.sun + 0.5 * (0.5 + m.hitStrength));
    this.sun = damp(this.sun, 0, 0.25, dt);
    if (m.snare) this.scan = 0;
    if (this.scan >= 0) { this.scan += dt * 1.6; if (this.scan > 1) this.scan = -1; }
    if (m.drop) { this.flare = 1; this.surge = 1; }
    this.flare = damp(this.flare, 0, 0.6, dt);
    this.surge = damp(this.surge, 0, 2.5, dt);
    if (m.sectionChange) this.palIdx = (this.palIdx + 1) % PALETTES.length;

    const target = PALETTES[this.palIdx];
    const k = 1 - Math.exp(-dt / 1.2);
    for (const key of Object.keys(target) as (keyof Palette)[]) {
      for (let c = 0; c < 3; c++) this.pal[key][c] += (target[key][c] - this.pal[key][c]) * k;
    }
    this.levels.bass = damp(this.levels.bass, m.bands.bass, 0.08, dt);
    this.levels.hat = m.hatEnv;
    this.levels.intensity = m.intensity;
  }

  private levels = { bass: 0, hat: 0, intensity: 0 };

  render(): void {
    const c = this.ctx;
    const { w, h, pal } = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const horizon = h * 0.42;
    // Sky
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, rgb(pal.skyTop));
    sky.addColorStop(0.42, rgb(pal.skyBottom));
    sky.addColorStop(1, rgb(pal.skyTop));
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);

    // Stars
    for (const s of this.stars) {
      const tw = 0.5 + 0.5 * Math.sin(this.time * 1.3 + s.p * 7);
      const a = (0.25 + 0.5 * tw) * (0.6 + this.levels.hat * 0.8);
      c.fillStyle = `rgba(255,255,255,${Math.min(1, a) * 0.7})`;
      c.fillRect(s.x * w, s.y * horizon * 0.95, s.r * (1 + this.levels.hat * 0.6), s.r * (1 + this.levels.hat * 0.6));
    }

    // Sun, sliced like a retro horizon, breathing with the bass.
    const sunR = Math.min(w, h) * (0.17 + this.levels.bass * 0.025 + this.sun * 0.02 + this.flare * 0.04);
    const sunY = horizon - sunR * 0.32;
    const glow = c.createRadialGradient(w / 2, sunY, sunR * 0.4, w / 2, sunY, sunR * (3 + this.flare * 2));
    glow.addColorStop(0, rgb(pal.sunBottom, 0.35 + this.sun * 0.25 + this.flare * 0.3));
    glow.addColorStop(1, rgb(pal.sunBottom, 0));
    c.fillStyle = glow;
    c.fillRect(0, 0, w, horizon + sunR);
    c.save();
    c.beginPath();
    c.arc(w / 2, sunY, sunR, 0, Math.PI * 2);
    c.clip();
    const sg = c.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
    sg.addColorStop(0, rgb(mix(pal.sunTop, [255, 255, 255], this.flare * 0.6)));
    sg.addColorStop(1, rgb(pal.sunBottom));
    c.fillStyle = sg;
    c.fillRect(w / 2 - sunR, sunY - sunR, sunR * 2, sunR * 2);
    // Scrolling slices
    c.fillStyle = rgb(pal.skyBottom);
    const sliceScroll = (this.time * 0.25) % 1;
    for (let i = 0; i < 9; i++) {
      const t = (i + sliceScroll) / 9;
      const y = sunY + t * sunR;
      const th = sunR * 0.02 + t * sunR * 0.075;
      c.fillRect(w / 2 - sunR, y, sunR * 2, th);
    }
    c.restore();

    // Ridges, back to front.
    const bottom = h * 1.02;
    const persp = 0.13;
    const spread = w * 0.62;
    const heightScale = h * 0.3 * (1 + this.surge * 0.35);
    const lw = Math.max(1, Math.min(w, h) / 520);
    for (let d = ROWS - 1; d >= -1; d--) {
      const depth = d + this.phase; // continuous
      const z = 1 + depth * persp;
      const y0 = horizon + (bottom - horizon) / z;
      const sx = spread / z * (1 + depth * 0.004);
      const hs = heightScale / z;
      let data: Float32Array;
      let off: number;
      let flare = 0;
      if (d === -1) { data = this.live; off = 0; }
      else {
        const idx = ((this.head - d) % ROWS + ROWS) % ROWS;
        data = this.rows; off = idx * POINTS;
        flare = this.rowFlare[idx];
      }
      const t = clamp(depth / ROWS);
      const fade = Math.pow(1 - t, 1.3);
      let col = mix(pal.near, pal.far, Math.pow(t, 0.6));
      // Snare scan line
      if (this.scan >= 0) {
        const sd = Math.abs(t - this.scan);
        if (sd < 0.06) col = mix(col, [255, 255, 255], (1 - sd / 0.06) * 0.8);
      }
      if (flare > 0.2 && d < 6) col = mix(col, pal.sunTop, flare * 0.5 * (1 - d / 6));

      c.beginPath();
      this.trace(c, data, off, w / 2, sx, y0, hs);
      // Occlude everything behind: fill down to the bottom.
      c.lineTo(w / 2 + sx, h + 2);
      c.lineTo(w / 2 - sx, h + 2);
      c.closePath();
      c.fillStyle = rgb(mix(mix(pal.skyTop, pal.skyBottom, 0.2), pal.skyBottom, Math.pow(t, 1.5)));
      c.fill();
      // Edge
      c.beginPath();
      this.trace(c, data, off, w / 2, sx, y0, hs);
      if (d < 3) {
        c.strokeStyle = rgb(col, 0.18 * fade);
        c.lineWidth = lw * 6;
        c.stroke();
      }
      c.strokeStyle = rgb(col, Math.min(1, 0.25 + fade * 0.85));
      c.lineWidth = lw * (0.6 + fade * 1.4);
      c.stroke();
    }

    // Horizon haze
    const haze = c.createLinearGradient(0, horizon - h * 0.05, 0, horizon + h * 0.12);
    haze.addColorStop(0, rgb(pal.skyBottom, 0));
    haze.addColorStop(0.45, rgb(pal.far, 0.12 + this.levels.intensity * 0.1));
    haze.addColorStop(1, rgb(pal.skyBottom, 0));
    c.fillStyle = haze;
    c.fillRect(0, horizon - h * 0.05, w, h * 0.17);

    // Vignette
    const vg = c.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.3, w / 2, h * 0.55, Math.max(w, h) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
  }

  /** Smooth curve through the ridge points (quadratic through midpoints). */
  private trace(c: CanvasRenderingContext2D, data: Float32Array, off: number, cx: number, sx: number, y0: number, hs: number): void {
    let px = cx + this.xs[0] * sx;
    let py = y0 - data[off] * hs;
    c.moveTo(px, py);
    for (let i = 1; i < POINTS; i++) {
      const x = cx + this.xs[i] * sx;
      const y = y0 - data[off + i] * hs;
      c.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      px = x; py = y;
    }
    c.lineTo(px, py);
  }

  dispose(): void {
    this.canvas.remove();
  }
}
