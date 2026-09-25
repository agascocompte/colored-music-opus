/**
 * Terrain as a strip of 16 px columns. Each column has an optional ground
 * (solid from `ground` row down) and an optional one-way platform row.
 * Simple enough for the director to reason about, rich enough to look like a level.
 */
export const TILE = 16;
export const NONE = -1;

export type Biome = 'meadow' | 'ruins' | 'crystal';
export type Decor = 'none' | 'tree' | 'lamp' | 'flowers' | 'tuft' | 'rock' | 'pillar' | 'crystal' | 'sign' | 'banner';

export interface Column {
  ground: number;
  plat: number;
  biome: Biome;
  decor: Decor;
  seed: number;
  /** Marks the columns of a special-move arena (for rendering accents). */
  arena: boolean;
}

export class World {
  private cols: Column[] = [];
  private base = 0; // column index of cols[0]

  reset(startCol = 0): void {
    this.cols = [];
    this.base = startCol;
  }

  get firstCol(): number { return this.base; }
  get endCol(): number { return this.base + this.cols.length; }

  col(i: number): Column | undefined {
    return this.cols[i - this.base];
  }

  push(c: Column): void { this.cols.push(c); }

  /** Forget columns left of `i` (memory stays bounded on long songs). */
  prune(i: number): void {
    const n = Math.min(this.cols.length, i - this.base);
    if (n > 64) {
      this.cols.splice(0, n);
      this.base += n;
    }
  }

  static colAt(x: number): number { return Math.floor(x / TILE); }

  groundTopAt(x: number): number | null {
    const c = this.col(World.colAt(x));
    if (!c || c.ground === NONE) return null;
    return c.ground * TILE;
  }

  /**
   * Highest walkable surface whose top is at or below `y` (feet) at column of x.
   * Platforms count only when `platforms` is true (one-way, landing from above).
   */
  surfaceBelow(x: number, y: number, platforms = true, eps = 2): number | null {
    const c = this.col(World.colAt(x));
    if (!c) return null;
    let best: number | null = null;
    if (platforms && c.plat !== NONE) {
      const top = c.plat * TILE;
      if (top >= y - eps) best = top;
    }
    if (c.ground !== NONE) {
      const top = c.ground * TILE;
      if (top >= y - eps && (best === null || top < best)) best = top;
    }
    return best;
  }

  /** True when the point is inside solid ground (platforms are not solid). */
  solidAt(x: number, y: number): boolean {
    const c = this.col(World.colAt(x));
    if (!c || c.ground === NONE) return false;
    return y > c.ground * TILE + 0.5;
  }

  /**
   * Walkable surfaces in the column range [c0, c1], as contiguous runs.
   * Used by the director to find landing zones.
   */
  surfaces(c0: number, c1: number, out: { x0: number; x1: number; y: number; platform: boolean }[]): typeof out {
    out.length = 0;
    let run: { x0: number; x1: number; y: number; platform: boolean } | null = null;
    let prun: { x0: number; x1: number; y: number; platform: boolean } | null = null;
    for (let i = Math.max(c0, this.base); i <= c1; i++) {
      const c = this.col(i);
      if (!c) break;
      // Ground runs
      if (c.ground !== NONE) {
        const y = c.ground * TILE;
        if (run && run.y === y) run.x1 = (i + 1) * TILE;
        else { run = { x0: i * TILE, x1: (i + 1) * TILE, y, platform: false }; out.push(run); }
      } else run = null;
      // Platform runs
      if (c.plat !== NONE) {
        const y = c.plat * TILE;
        if (prun && prun.y === y) prun.x1 = (i + 1) * TILE;
        else { prun = { x0: i * TILE, x1: (i + 1) * TILE, y, platform: true }; out.push(prun); }
      } else prun = null;
    }
    return out;
  }
}
