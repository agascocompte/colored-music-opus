import type { MusicFrame } from '../../analysis/types';
import { makeCanvas } from '../common/gl';
import { TAU, clamp, damp, easeInOutSine } from '../common/math';
import type { Visualizer } from '../types';

/**
 * LOOM — a modular times table woven with light.
 * M pins sit on a circle; pin i is threaded to pin (i · k) mod M. Integer k
 * draws cardioids, nephroids and roses; fractional k morphs between them.
 *  - phrases: every 2–4 bars (only when the music has momentum) the loom
 *    crossfades to the next clean figure — never through chaotic in-between values
 *  - spectrum: every thread's brightness follows the band under its pin
 *  - kick: the loom breathes out; snare: a soft echo of the figure flashes
 *  - hats: pins sparkle; drop: jump to a distant figure + flash
 */
const M = 360;
const GROUPS = 48;
// Cardioid families (small k) and polygon families (k = M/n + 1: stars, triangles, squares…)
const FIGURES = [2, 3, 4, 5, 181, 6, 7, 121, 8, 9, 91, 10, 73, 61];

type HSL = [number, number, number];
const PALETTES: { base: number; spread: number; bg: HSL }[] = [
  { base: 0.52, spread: 0.35, bg: [0.66, 0.5, 0.03] },
  { base: 0.95, spread: 0.2, bg: [0.9, 0.5, 0.03] },
  { base: 0.12, spread: 0.18, bg: [0.08, 0.4, 0.03] },
  { base: 0.72, spread: 0.3, bg: [0.72, 0.5, 0.035] },
];

export default class LoomVisualizer implements Visualizer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;

  private figure = 0;
  private kPrev = 2;
  private kCur = 2;
  private fade = 1;
  private fadeDur = 1;
  private rot = 0;
  private breath = 0;
  private flash = 0;
  private echo = 0;
  private echoRot = 0;
  private time = 0;
  private palIdx = 0;
  private hue = PALETTES[0].base;
  private spread = PALETTES[0].spread;
  private groupLevel = new Float32Array(GROUPS);
  private pinSpark = new Float32Array(M);
  private lastBeat = -1;
  private music = { level: 0, intensity: 0, bass: 0, spectrum: new Float32Array(64) };

  mount(layer: HTMLElement): void {
    this.canvas = makeCanvas(layer);
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
  }

  resize(width: number, height: number, dpr: number): void {
    this.w = width;
    this.h = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.fillStyle = '#05060a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private goTo(steps: number, dur: number): void {
    this.figure = (this.figure + steps + FIGURES.length) % FIGURES.length;
    this.kPrev = this.fade < 0.5 ? this.kPrev : this.kCur;
    this.kCur = FIGURES[this.figure];
    this.fade = 0;
    this.fadeDur = dur;
  }

  update(m: MusicFrame): void {
    const dt = m.dt;
    this.time += dt;
    const beatDur = 60 / Math.max(60, m.bpm);

    // Phrase boundaries move to the next figure when there's momentum:
    // every 4 bars normally, every 2 bars in intense passages.
    if (m.beat && m.beatIndex !== this.lastBeat) {
      this.lastBeat = m.beatIndex;
      const every = m.intensity > 0.7 ? 8 : 16;
      if (m.beatIndex % every === 0 && m.intensity > 0.35) this.goTo(1, beatDur * 2);
    }
    if (m.drop) { this.goTo(4, beatDur); this.flash = 1; }
    else if (m.sectionChange) this.goTo(1, beatDur * 2);
    if (m.sectionChange) this.palIdx = (this.palIdx + 1) % PALETTES.length;
    this.fade = Math.min(1, this.fade + dt / this.fadeDur);

    this.rot += dt * (0.03 + m.intensity * 0.07);
    if (m.kick) this.breath = Math.min(1, this.breath + 0.6 * (0.5 + m.hitStrength));
    this.breath = damp(this.breath, 0, 0.16, dt);
    if (m.snare) { this.echo = 1; this.echoRot = (Math.random() - 0.5) * 0.08; }
    this.echo = damp(this.echo, 0, 0.22, dt);
    this.flash = damp(this.flash, 0, 0.3, dt);

    const pal = PALETTES[this.palIdx];
    let dh = pal.base - this.hue;
    if (dh > 0.5) dh -= 1; else if (dh < -0.5) dh += 1;
    this.hue = (this.hue + dh * (1 - Math.exp(-dt / 1.5)) + 1) % 1;
    this.spread = damp(this.spread, pal.spread, 1.5, dt);

    // Group brightness from the band under each arc (mirrored: lows at the top).
    for (let g = 0; g < GROUPS; g++) {
      const u = (g + 0.5) / GROUPS;
      const b = Math.min(63, Math.floor(Math.abs(u * 2 - 1) * 63));
      this.groupLevel[g] = damp(this.groupLevel[g], m.spectrum[63 - b] ?? 0, 0.05, dt);
    }
    if (m.hat) for (let i = 0; i < 10; i++) this.pinSpark[(Math.random() * M) | 0] = 1;
    for (let i = 0; i < M; i++) this.pinSpark[i] *= Math.exp(-dt / 0.2);

    this.music.level = m.level;
    this.music.intensity = m.intensity;
    this.music.bass = damp(this.music.bass, m.bands.bass, 0.08, dt);
    this.music.spectrum.set(m.spectrum);
  }

  render(): void {
    const c = this.ctx;
    const { w, h } = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const pal = PALETTES[this.palIdx];

    // Motion-blurred clear: previous threads linger briefly.
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = `hsla(${pal.bg[0] * 360},${pal.bg[1] * 100}%,${pal.bg[2] * 100}%,0.5)`;
    c.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * (0.36 + this.breath * 0.025 + this.music.bass * 0.012);
    const lw = Math.max(0.6, Math.min(w, h) / 900) * (1 + this.breath * 0.6);

    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';

    // Soft halo behind the loom
    const halo = c.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.5);
    halo.addColorStop(0, `hsla(${this.hue * 360},80%,55%,${0.05 + this.music.level * 0.07 + this.flash * 0.2})`);
    halo.addColorStop(1, 'hsla(0,0%,0%,0)');
    c.fillStyle = halo;
    c.fillRect(0, 0, w, h);

    // Crossfade between two clean figures (never through fractional multipliers).
    const f = easeInOutSine(this.fade);
    if (f < 1) this.weave(c, cx, cy, R, this.rot, this.kPrev, lw, 1 - f);
    this.weave(c, cx, cy, R, this.rot, this.kCur, lw, f);
    if (this.echo > 0.02) this.weave(c, cx, cy, R * 1.05, this.rot + this.echoRot, this.kCur, lw * 0.8, this.echo * 0.3);

    // Pins and the spectral ring
    const spec = this.music.spectrum;
    for (let i = 0; i < M; i++) {
      const a = this.rot + (i / M) * TAU - Math.PI / 2;
      const u = i / M;
      const b = Math.min(63, Math.floor(Math.abs(u * 2 - 1) * 63));
      const v = spec[63 - b];
      const x = Math.cos(a), y = Math.sin(a);
      const tick = R * (1.03 + v * 0.1);
      c.strokeStyle = `hsla(${(this.hue + u * this.spread) * 360},90%,70%,${0.08 + v * 0.35})`;
      c.lineWidth = lw;
      c.beginPath();
      c.moveTo(cx + x * R * 1.02, cy + y * R * 1.02);
      c.lineTo(cx + x * tick, cy + y * tick);
      c.stroke();
      const s = this.pinSpark[i];
      if (s > 0.05) {
        c.fillStyle = `hsla(${(this.hue + 0.1) * 360},100%,90%,${s})`;
        c.beginPath();
        c.arc(cx + x * R, cy + y * R, lw * (1.5 + s * 2.5), 0, TAU);
        c.fill();
      }
    }

    if (this.flash > 0.01) {
      c.fillStyle = `rgba(255,255,255,${this.flash * 0.25})`;
      c.fillRect(0, 0, w, h);
    }
    c.globalCompositeOperation = 'source-over';
  }

  private weave(c: CanvasRenderingContext2D, cx: number, cy: number, R: number, rot: number, k: number, lw: number, gain: number): void {
    const per = M / GROUPS;
    for (let g = 0; g < GROUPS; g++) {
      const lvl = this.groupLevel[g];
      const alpha = clamp((0.035 + lvl * lvl * 0.32 + this.music.level * 0.04) * gain, 0, 1);
      if (alpha < 0.01) continue;
      const u = (g + 0.5) / GROUPS;
      const hue = (this.hue + (u < 0.5 ? u : 1 - u) * 2 * this.spread) * 360;
      c.strokeStyle = `hsla(${hue},${75 + lvl * 25}%,${48 + lvl * 30}%,${alpha})`;
      c.lineWidth = lw * (0.7 + lvl * 0.8);
      c.beginPath();
      for (let j = 0; j < per; j++) {
        const i = g * per + j;
        const a0 = rot + (i / M) * TAU - Math.PI / 2;
        const a1 = rot + ((i * k) / M) * TAU - Math.PI / 2;
        c.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
        c.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
      }
      c.stroke();
    }
  }

  dispose(): void {
    this.canvas.remove();
  }
}
