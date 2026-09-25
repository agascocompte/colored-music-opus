import { mulberry32 } from '../common/math';
import type { BeatClock } from './BeatClock';
import type { Entity, EntityPool } from './Entities';
import { NONE, TILE, type Biome, type Column, type Decor, type World } from './World';

/**
 * THE COMPOSER — the level is written like a score.
 *
 * The song is divided into slots (one beat, or two for very fast songs) and
 * bars of four slots. The hero's x position is a pure function of the slot
 * position, so the composer knows exactly where the hero will be on every
 * beat, and writes terrain, enemies and the hero's actions together:
 *
 *   - a pit is cut so that the take-off is on beat s and the landing on beat s+1
 *     (preferring landings that coincide with a strong kick);
 *   - an enemy is placed one sword-length ahead of where the hero stands on a
 *     beat, and the strike is scheduled on that beat;
 *   - a drop is announced bars ahead: charge-up, leap two beats before, slam
 *     exactly on the drop, and the arena crowd bursts in a rhythmic cascade.
 *
 * Energy and section level decide speed (pixels per beat) and density.
 */

export type JumpStyle = 'jump' | 'hop' | 'special' | 'stomp' | 'bounce';

export interface JumpAct { kind: 'jump'; s0: number; s1: number; y0: number; y1: number; h: number; style: JumpStyle; target?: Entity }
export interface StrikeAct { kind: 'strike'; s: number; target: Entity; air: boolean }
export interface DashAct { kind: 'dash'; s0: number; s1: number }
export interface KillAct { kind: 'kill'; s: number; target: Entity }
export interface ChargeAct { kind: 'charge'; s0: number; s1: number }
export type Act = JumpAct | StrikeAct | DashAct | KillAct | ChargeAct;

interface Change { x: number; ground?: number; plat?: number; biome?: Biome; arena?: boolean }

const MIN_ROW = 6;
const MAX_ROW = 14;
const REACH = 13;

export const actStart = (a: Act): number => (a.kind === 'strike' || a.kind === 'kill' ? a.s : a.s0);

export class Composer {
  unit = 1;
  startSlot = 0;
  private x0 = 0;
  private xs: number[] = [];
  private ppbs: number[] = [];
  private dashSlot = new Set<number>();
  private rest = new Set<number>();
  private lastRestBar = -99;
  private nextBar = 0;
  private busyUntil = 0;
  private row = 11;
  private startRow = 11;
  readonly acts: Act[] = [];
  private changes: Change[] = [];
  private state = { ground: 11, plat: NONE, biome: 'meadow' as Biome, arena: false };
  private nextCol = 0;
  private drops: number[] = [];
  private staged = new Set<number>();
  private rng = mulberry32(1);
  private lastPattern = '';
  /** Fallback energy/level when there is no timeline. */
  liveIntensity = 0.5;
  liveLevel = 1;

  constructor(private readonly world: World, private readonly entities: EntityPool, private readonly clock: BeatClock) {}

  reset(seed: number, startSlot: number, unit: number, x0: number, row: number): void {
    this.rng = mulberry32(seed);
    this.unit = unit;
    this.startSlot = startSlot;
    this.x0 = x0;
    this.xs = [x0];
    this.ppbs = [];
    this.dashSlot.clear();
    this.rest.clear();
    this.lastRestBar = -99;
    this.nextBar = startSlot;
    this.busyUntil = startSlot;
    this.row = this.startRow = row;
    this.acts.length = 0;
    this.changes.length = 0;
    this.staged.clear();
    this.drops = this.clock.dropBeats().map((b) => Math.round(b / unit)).filter((s) => s > startSlot + 3);
    const startCol = Math.floor(x0 / TILE) - 40;
    this.world.reset(startCol);
    this.state = { ground: row, plat: NONE, biome: 'meadow', arena: false };
    this.nextCol = startCol;
    this.emitTo(x0 + TILE * 2);
  }

  // ------------------------------------------------------------ beat → space

  private ensure(slot: number): void {
    // xs[k] = x at slot startSlot+k; ppbs are decided a whole bar at a time.
    let k = this.xs.length - 1;
    while (this.startSlot + k <= slot) {
      if (k >= this.ppbs.length) {
        const s = this.startSlot + k;
        const beat = s * this.unit;
        const lvl = this.clock.levelAt(beat, this.liveLevel);
        const e = this.clock.energyAt(beat, this.liveIntensity);
        const pps = 48 + e * 100 + (lvl === 2 ? 14 : 0);
        let ppb = pps * this.clock.period * this.unit;
        ppb = Math.max(20, Math.min(72, ppb));
        const prev = k > 0 ? this.lastMovingPpb(k) : ppb;
        ppb = Math.max(prev * 0.72, Math.min(prev * 1.35, ppb));
        // Calm passages: now and then the hero stops for a bar and looks around.
        const bar = k / 4;
        const nearDrop = this.drops.some((d) => d >= s - 4 && d <= s + 12);
        const rest = bar > 3 && lvl === 0 && e < 0.3 && bar - this.lastRestBar > 8 && !nearDrop && this.rng() < 0.3;
        if (rest) { this.lastRestBar = bar; for (let i = 0; i < 4; i++) this.rest.add(s + i); }
        for (let i = 0; i < 4; i++) this.ppbs.push(rest ? 0 : ppb);
      }
      this.xs.push(this.xs[k] + this.ppbs[k]);
      k++;
    }
  }

  private lastMovingPpb(k: number): number {
    for (let i = k - 1; i >= 0; i--) if (this.ppbs[i] > 0) return this.ppbs[i];
    return 40;
  }

  /** Hero x at a (float) slot position. */
  slotX(p: number): number {
    if (p <= this.startSlot) return this.x0;
    const s = Math.floor(p);
    this.ensure(s + 1);
    const k = s - this.startSlot;
    let f = p - s;
    if (this.dashSlot.has(s)) f = 1 - Math.pow(1 - f, 3); // burst on the beat, then glide
    return this.xs[k] + f * this.ppbs[k];
  }

  /** Pixels per slot at slot s. */
  ppbAt(s: number): number {
    if (s < this.startSlot) return 0;
    this.ensure(s + 1);
    return this.ppbs[Math.floor(s) - this.startSlot];
  }

  isRest(s: number): boolean { return this.rest.has(Math.floor(s)); }
  isDashSlot(s: number): boolean { return this.dashSlot.has(Math.floor(s)); }

  /** Ground height (feet y) when not jumping at slot position p. */
  groundY(p: number): number {
    let y = this.startRow * TILE;
    let best = -Infinity;
    for (const a of this.acts) {
      if (a.kind === 'jump' && a.s1 <= p && a.s1 > best) { best = a.s1; y = a.y1; }
    }
    return y;
  }

  // ------------------------------------------------------------ composition

  /** Compose bars until the hero's path is known beyond `x`. */
  compose(x: number): void {
    let guard = 0;
    while (this.slotX(this.nextBar) < x && guard++ < 64) {
      this.composeBar(this.nextBar);
      this.nextBar += 4;
    }
    this.emitTo(this.slotX(this.nextBar));
    // Forget old actions.
    const cutoff = this.nextBar - 64;
    for (let i = this.acts.length - 1; i >= 0; i--) {
      const a = this.acts[i];
      const end = a.kind === 'strike' || a.kind === 'kill' ? a.s : a.s1;
      if (end < cutoff) this.acts.splice(i, 1);
    }
  }

  private X(s: number): number { return this.slotX(s); }
  private span(s0: number, s1: number): number { return this.X(s1) - this.X(s0); }

  private level(s: number): number { return this.clock.levelAt(s * this.unit, this.liveLevel); }
  private energy(s: number): number { return this.clock.energyAt(s * this.unit, this.liveIntensity); }

  private composeBar(sb: number): void {
    this.ensure(sb + 8);
    const lvl = this.level(sb);
    const e = this.energy(sb);
    const biome: Biome = lvl >= 2 ? 'crystal' : lvl === 1 ? 'ruins' : 'meadow';
    this.changes.push({ x: this.X(sb), biome });
    if (this.rest.has(sb)) { this.busyUntil = Math.max(this.busyUntil, sb + 4); return; }

    // Next drop that still needs staging: nothing may overlap its leap.
    const drop = this.drops.find((d) => !this.staged.has(d) && d >= sb);
    const limit = drop !== undefined ? drop - 2 : Infinity;
    if (drop !== undefined && drop - 2 < sb + 4 && drop - 2 >= this.busyUntil) {
      this.stageDrop(drop);
      return;
    }

    // Density by section level: attempts per bar and their preferred beats.
    const plans: { off: number; p: number }[] =
      lvl === 0 ? [{ off: 0, p: 0.5 }] :
      lvl === 1 ? [{ off: 0, p: 0.8 }, { off: 2, p: 0.55 }] :
      [{ off: 0, p: 0.9 }, { off: 2, p: 0.75 }, { off: 1, p: 0.25 }, { off: 3, p: 0.2 }];
    for (const pl of plans) {
      const s = Math.max(sb + pl.off, this.busyUntil);
      if (s >= sb + 4) break;
      if (this.rng() > pl.p * (0.6 + e * 0.6)) continue;
      this.pattern(s, lvl, limit);
    }
  }

  private pattern(s: number, lvl: number, limit: number): void {
    const opts: [string, number][] =
      lvl === 0 ? [['gap', 3], ['step', 3], ['slime', 3], ['gems', 2], ['crates', 1]] :
      lvl === 1 ? [['gap', 4], ['slime', 4], ['bat', 3], ['crates', 3], ['thorn', 2], ['step', 3], ['stomp', 2], ['gems', 1]] :
      [['gap', 4], ['combo', 3], ['stomp', 3], ['dash', 3], ['platforms', 3], ['thorn', 2], ['bat', 3], ['slime', 3], ['step', 2]];
    for (let tries = 0; tries < 4; tries++) {
      let total = 0;
      for (const [, w] of opts) total += w;
      let r = this.rng() * total;
      let name = opts[0][0];
      for (const [n, w] of opts) { if ((r -= w) <= 0) { name = n; break; } }
      if (name === this.lastPattern && this.rng() < 0.5) continue;
      if (this.apply(name, s, limit)) { this.lastPattern = name; return; }
    }
  }

  /** Try to write a pattern starting at slot s. Returns false if it doesn't fit. */
  private apply(name: string, s: number, limit: number): boolean {
    const y = this.row * TILE;
    const fits = (end: number) => end <= limit - 1;
    switch (name) {
      case 'gap': {
        // Prefer the airtime (1 or 2 slots) whose landing hits the stronger kick.
        let g = 0;
        for (const cand of [1, 2, 3]) if (this.span(s, s + cand) >= 40) { g = cand; break; }
        if (!g || !fits(s + g)) return false;
        if (g === 1 && this.span(s, s + 2) < 110 && this.clock.kickAt((s + 2) * this.unit) > this.clock.kickAt((s + 1) * this.unit) + 0.25) g = 2;
        const newRow = this.clampRow(this.row + [0, 0, -1, 1][Math.floor(this.rng() * 4)]);
        this.changes.push({ x: this.X(s) + 10, ground: NONE }, { x: this.X(s + g) - 10, ground: newRow });
        this.jump(s, s + g, newRow * TILE, 10 + this.span(s, s + g) * 0.16, 'jump');
        this.row = newRow;
        this.busyUntil = s + g;
        return true;
      }
      case 'step': {
        const up = this.row > MIN_ROW + 1 && (this.row >= 12 || this.rng() < 0.5);
        const d = 1 + (this.rng() < 0.35 ? 1 : 0);
        const newRow = this.clampRow(this.row + (up ? -d : d));
        if (newRow === this.row) return false;
        const g = this.span(s, s + 1) >= 24 ? 1 : 2;
        if (!fits(s + g)) return false;
        const sp = this.span(s, s + g);
        const wallX = this.X(s) + Math.max(10, sp * (up ? 0.6 : 0.35));
        this.changes.push({ x: wallX, ground: newRow });
        const h = up ? this.clearance(s, s + g, y, newRow * TILE, wallX - 4) : 6;
        this.jump(s, s + g, newRow * TILE, h, up ? 'jump' : 'hop');
        this.row = newRow;
        this.busyUntil = s + g;
        return true;
      }
      case 'slime':
      case 'bat': {
        if (!fits(s + 1)) return false;
        const e = this.entities.spawn(name, this.X(s) + REACH, name === 'bat' ? y - 16 : y, this.rng());
        this.acts.push({ kind: 'strike', s, target: e, air: false });
        this.busyUntil = s + 1;
        return true;
      }
      case 'crates': {
        const n = this.rng() < 0.5 ? 2 : 1;
        if (!fits(s + n)) return false;
        for (let i = 0; i < n; i++) {
          const e = this.entities.spawn('crate', this.X(s + i) + REACH - 1, y, this.rng());
          this.acts.push({ kind: 'strike', s: s + i, target: e, air: false });
        }
        this.busyUntil = s + n;
        return true;
      }
      case 'combo': {
        if (!fits(s + 3)) return false;
        ['slime', 'bat', 'slime'].forEach((k, i) => {
          const e = this.entities.spawn(k as 'slime', this.X(s + i) + REACH, k === 'bat' ? y - 16 : y, this.rng());
          this.acts.push({ kind: 'strike', s: s + i, target: e, air: false });
        });
        this.busyUntil = s + 3;
        return true;
      }
      case 'dash': {
        const sp = this.span(s, s + 1);
        if (sp < 34 || !fits(s + 1)) return false;
        this.dashSlot.add(s);
        this.entities.spawn('crate', this.X(s) + sp * 0.45, y, this.rng());
        this.entities.spawn('crate', this.X(s) + sp * 0.45 + 14, y, this.rng());
        this.acts.push({ kind: 'dash', s0: s, s1: s + 1 });
        this.busyUntil = s + 1;
        return true;
      }
      case 'thorn': {
        let g = 0;
        for (const cand of [1, 2]) if (this.span(s, s + cand) >= 44) { g = cand; break; }
        if (!g || !fits(s + g)) return false;
        const mid = this.X(s) + this.span(s, s + g) / 2;
        this.entities.spawn('thorn', mid, y, this.rng());
        this.jump(s, s + g, y, 24, 'jump');
        this.busyUntil = s + g;
        return true;
      }
      case 'stomp': {
        if (this.span(s, s + 1) < 26 || !fits(s + 2)) return false;
        const e = this.entities.spawn('slime', this.X(s + 1), y, this.rng());
        this.jump(s, s + 1, y - 7, 16, 'stomp', e);
        this.acts.push({ kind: 'kill', s: s + 1, target: e });
        this.jump(s + 1, s + 2, y, 18, 'bounce');
        this.busyUntil = s + 2;
        return true;
      }
      case 'gems': {
        const pr = this.row - 3;
        if (pr < MIN_ROW - 1 || this.span(s, s + 1) < 20 || !fits(s + 4)) return false;
        this.changes.push({ x: this.X(s + 1) - 14, plat: pr }, { x: this.X(s + 3) + 10, plat: NONE });
        this.jump(s, s + 1, pr * TILE, 12 + (y - pr * TILE) * 0.3, 'jump');
        for (const k of [1.5, 2.5]) this.entities.spawn('gem', this.X(s + k), pr * TILE - 9, this.rng());
        this.jump(s + 3, s + 4, y, 8, 'hop');
        this.busyUntil = s + 4;
        return true;
      }
      case 'platforms': {
        if (this.span(s, s + 1) < 42 || !fits(s + 3)) return false;
        const r1 = this.clampRow(this.row - 1);
        const r2 = this.clampRow(this.row - 2);
        this.changes.push(
          { x: this.X(s) + 10, ground: NONE },
          { x: this.X(s + 1) - 12, plat: r1 }, { x: this.X(s + 1) + 12, plat: NONE },
          { x: this.X(s + 2) - 12, plat: r2 }, { x: this.X(s + 2) + 12, plat: NONE },
          { x: this.X(s + 3) - 10, ground: this.row },
        );
        this.jump(s, s + 1, r1 * TILE, 14, 'jump');
        this.jump(s + 1, s + 2, r2 * TILE, 14, 'jump');
        this.jump(s + 2, s + 3, y, 16, 'jump');
        this.busyUntil = s + 3;
        return true;
      }
    }
    return false;
  }

  /** Charge-up, leap two slots before the drop, slam on it, crowd cascade. */
  private stageDrop(sd: number): void {
    this.staged.add(sd);
    const y = this.row * TILE;
    this.acts.push({ kind: 'charge', s0: sd - 8, s1: sd - 2 });
    this.changes.push({ x: this.X(sd - 2), arena: true, biome: 'crystal' }, { x: this.X(sd + 6), arena: false });
    this.jump(sd - 2, sd, y, 58, 'special');
    const crowd: [string, number, number][] = [['slime', 22, 0], ['bat', 36, -18], ['slime', 48, 0], ['slime', 70, 0], ['bat', 82, -20], ['golem', 100, 0]];
    crowd.forEach(([k, dx, dy], i) => {
      const e = this.entities.spawn(k as 'slime', this.X(sd) + dx, y + dy, this.rng());
      e.arena = true;
      // They burst on the following eighth notes, nearest first.
      this.acts.push({ kind: 'kill', s: sd + (i * 0.5) / this.unit, target: e });
    });
    this.busyUntil = sd + 4;
  }

  private jump(s0: number, s1: number, y1: number, h: number, style: JumpStyle, target?: Entity): void {
    const y0 = this.groundYAtPlan(s0);
    this.acts.push({ kind: 'jump', s0, s1, y0, y1, h: h + Math.abs(y0 - y1) * 0.5, style, target });
  }

  /** Planned ground at the start of an action (latest landing before it). */
  private groundYAtPlan(s: number): number {
    let y = this.startRow * TILE;
    let best = -Infinity;
    for (const a of this.acts) if (a.kind === 'jump' && a.s1 <= s && a.s1 > best) { best = a.s1; y = a.y1; }
    return y;
  }

  /** Apex height needed to clear a wall at x when rising from y0 to y1. */
  private clearance(s0: number, s1: number, y0: number, y1: number, wallX: number): number {
    const u = Math.max(0.05, Math.min(0.95, (wallX - this.X(s0)) / Math.max(1, this.span(s0, s1))));
    const need = ((1 - u) * y0 + u * y1 - (y1 - 5)) / (4 * u * (1 - u));
    return Math.max(12, need - Math.abs(y0 - y1) * 0.5 + 2);
  }

  private clampRow(r: number): number { return Math.max(MIN_ROW, Math.min(MAX_ROW, r)); }

  // ------------------------------------------------------------ terrain output

  private emitTo(x: number): void {
    this.changes.sort((a, b) => a.x - b.x);
    let ci = 0;
    while ((this.nextCol + 0.5) * TILE < x) {
      const center = (this.nextCol + 0.5) * TILE;
      while (ci < this.changes.length && this.changes[ci].x <= center) {
        const c = this.changes[ci++];
        if (c.ground !== undefined) this.state.ground = c.ground;
        if (c.plat !== undefined) this.state.plat = c.plat;
        if (c.biome !== undefined) this.state.biome = c.biome;
        if (c.arena !== undefined) this.state.arena = c.arena;
      }
      const st = this.state;
      const col: Column = {
        ground: st.ground, plat: st.plat, biome: st.biome,
        decor: st.ground === NONE || st.plat !== NONE ? 'none' : this.decor(st.biome),
        seed: this.rng(), arena: st.arena,
      };
      this.world.push(col);
      this.nextCol++;
    }
    this.changes.splice(0, ci);
    this.world.prune(this.nextCol - 120);
  }

  private decor(biome: Biome): Decor {
    const r = this.rng();
    switch (biome) {
      case 'meadow':
        if (r < 0.08) return 'tree';
        if (r < 0.18) return 'flowers';
        if (r < 0.32) return 'tuft';
        if (r < 0.36) return 'rock';
        if (r < 0.38) return 'sign';
        return 'none';
      case 'ruins':
        if (r < 0.08) return 'pillar';
        if (r < 0.14) return 'lamp';
        if (r < 0.24) return 'tuft';
        if (r < 0.27) return 'banner';
        return 'none';
      case 'crystal':
        if (r < 0.14) return 'crystal';
        if (r < 0.2) return 'lamp';
        if (r < 0.26) return 'tuft';
        return 'none';
    }
  }
}
