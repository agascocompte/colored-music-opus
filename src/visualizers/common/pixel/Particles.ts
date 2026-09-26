const WHITE = '#f4f4f4';
const SILVER = '#94b0c2';

/** Structure-of-arrays particle pool: no allocation while playing. */
const MAX = 900;

export type ParticleKind = 0 | 1 | 2 | 3 | 4; // dust, spark, debris, ember, ring

export class Particles {
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private max = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private kind = new Uint8Array(MAX);
  private color: string[] = new Array(MAX).fill(WHITE);
  private count = 0;

  clear(): void { this.count = 0; }

  emit(x: number, y: number, vx: number, vy: number, life: number, color: string, size = 1, grav = 0, drag = 0, kind: ParticleKind = 1): void {
    let i = this.count;
    if (i >= MAX) {
      // Recycle the oldest-ish slot
      i = (Math.random() * MAX) | 0;
    } else this.count++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.max[i] = life; this.size[i] = size;
    this.grav[i] = grav; this.drag[i] = drag; this.kind[i] = kind;
    this.color[i] = color;
  }

  burst(x: number, y: number, n: number, speed: number, colors: readonly string[], opts: { life?: number; grav?: number; size?: number; up?: number; spread?: number; drag?: number; kind?: ParticleKind } = {}): void {
    const { life = 0.5, grav = 300, size = 1, up = 0, spread = Math.PI * 2, drag = 1.5, kind = 1 } = opts;
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.emit(x, y, Math.cos(a) * s, Math.sin(a) * s - up, life * (0.6 + Math.random() * 0.6), colors[k % colors.length], size, grav, drag, kind);
    }
  }

  dust(x: number, y: number, n: number, dir = 0, strength = 1): void {
    for (let k = 0; k < n; k++) {
      const side = dir === 0 ? (k % 2 ? 1 : -1) : dir;
      this.emit(x + side * (1 + Math.random() * 3), y - 1, side * (15 + Math.random() * 40) * strength, -(5 + Math.random() * 25) * strength, 0.35 + Math.random() * 0.3, k % 3 ? SILVER : WHITE, 1 + (Math.random() < 0.3 ? 1 : 0), 40, 4, 0);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const j = --this.count;
        this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
        this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.size[i] = this.size[j];
        this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.kind[i] = this.kind[j]; this.color[i] = this.color[j];
        i--;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }

  render(c: CanvasRenderingContext2D, ox: number, oy: number): void {
    for (let i = 0; i < this.count; i++) {
      const t = this.life[i] / this.max[i];
      const k = this.kind[i];
      if (k === 4) {
        // Ring shockwave: radius grows as life decreases
        const r = (1 - t) * this.size[i];
        c.fillStyle = this.color[i];
        const n = Math.max(12, Math.round(r * 1.5));
        for (let s = 0; s < n; s++) {
          const a = (s / n) * Math.PI * 2;
          c.fillRect(Math.round(this.x[i] - ox + Math.cos(a) * r), Math.round(this.y[i] - oy + Math.sin(a) * r * 0.35), 1, 1);
        }
        continue;
      }
      let s = this.size[i];
      if (t < 0.35) s = Math.max(1, Math.round(s * (t / 0.35 + 0.3)));
      // Pixel fade: flicker out at the end of life
      if (t < 0.18 && ((i + Math.floor(t * 60)) & 1)) continue;
      c.fillStyle = this.color[i];
      c.fillRect(Math.round(this.x[i] - ox), Math.round(this.y[i] - oy), s, s);
    }
  }
}
