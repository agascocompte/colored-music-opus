import { PAL } from './palette';
import { bitmap, ellipse, line, ring } from './pixel';
import type { World } from './World';

export type EntityKind = 'slime' | 'bat' | 'thorn' | 'golem' | 'crate' | 'gem';

/** Things in the level. Positions are bottom-centre (feet), except bats/gems (centre). */
export class Entity {
  kind: EntityKind = 'slime';
  x = 0;
  y = 0;
  baseY = 0;
  vx = 0;
  hp = 1;
  alive = true;
  /** >0 while playing the death animation. */
  dying = 0;
  t = 0;
  flash = 0;
  seed = 0;
  /** The director has an action planned against this entity. */
  claimed = false;
  /** Part of a scripted arena (special move). */
  arena = false;
  knock = 0;

  get halfW(): number {
    switch (this.kind) {
      case 'golem': return 10;
      case 'crate': return 7;
      case 'bat': return 5;
      case 'gem': return 4;
      default: return 6;
    }
  }

  get height(): number {
    switch (this.kind) {
      case 'golem': return 26;
      case 'crate': return 14;
      case 'slime': return 9;
      case 'thorn': return 10;
      default: return 8;
    }
  }

  /** Top of the hitbox in world y. */
  get top(): number {
    return this.kind === 'bat' || this.kind === 'gem' ? this.y - 4 : this.y - this.height;
  }

  get bottom(): number {
    return this.kind === 'bat' || this.kind === 'gem' ? this.y + 4 : this.y;
  }

  /** Can be killed by a slash. */
  get slashable(): boolean { return this.kind !== 'thorn' && this.kind !== 'gem'; }
  /** Harms the hero on contact. */
  get hostile(): boolean { return this.kind === 'slime' || this.kind === 'bat' || this.kind === 'thorn' || this.kind === 'golem'; }
  /** Blocks the path (must be dealt with). */
  get blocking(): boolean { return this.kind !== 'gem' && this.kind !== 'bat'; }
}

export class EntityPool {
  readonly items: Entity[] = [];
  private free: Entity[] = [];

  spawn(kind: EntityKind, x: number, y: number, seed = Math.random()): Entity {
    const e = this.free.pop() ?? new Entity();
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.baseY = y;
    // Enemies hold their spot: the composer placed them exactly one sword-length
    // ahead of where the hero will stand on a beat.
    e.vx = 0;
    e.hp = kind === 'golem' ? 3 : 1;
    e.alive = true;
    e.dying = 0;
    e.t = seed * 10;
    e.flash = 0;
    e.seed = seed;
    e.claimed = false;
    e.arena = false;
    e.knock = 0;
    this.items.push(e);
    return e;
  }

  clear(): void {
    for (const e of this.items) this.free.push(e);
    this.items.length = 0;
  }

  /** Remove dead entities and those far behind the camera. */
  sweep(minX: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i];
      if ((!e.alive && e.dying <= 0) || e.x < minX) {
        this.free.push(e);
        this.items[i] = this.items[this.items.length - 1];
        this.items.pop();
      }
    }
  }

  update(dt: number, world: World, beatPulse: number, hatEnv: number): void {
    for (const e of this.items) {
      e.t += dt;
      if (e.flash > 0) e.flash -= dt;
      if (!e.alive) { e.dying -= dt; continue; }
      switch (e.kind) {
        case 'slime':
        case 'thorn': {
          // Patrol, never walk off ledges.
          const nx = e.x + e.vx * dt;
          const ahead = world.surfaceBelow(nx + Math.sign(e.vx) * 6, e.y, false, 2);
          if (ahead === null || Math.abs(ahead - e.y) > 1) e.vx = -e.vx;
          else e.x = nx;
          break;
        }
        case 'bat': {
          e.y = e.baseY + Math.sin(e.t * 2.6) * 3 - beatPulse * 2;
          break;
        }
        case 'gem': {
          e.y = e.baseY + Math.sin(e.t * 3) * 1.5;
          break;
        }
      }
      if (e.knock > 0) { e.x += e.knock * dt; e.knock *= Math.exp(-dt / 0.08); }
    }
    this.hatEnv = hatEnv;
    this.beatPulse = beatPulse;
  }

  private hatEnv = 0;
  private beatPulse = 0;

  render(c: CanvasRenderingContext2D, ox: number, oy: number, time: number): void {
    for (const e of this.items) {
      if (!e.alive && e.dying <= 0) continue;
      const x = Math.round(e.x - ox);
      const y = Math.round(e.y - oy);
      const white = e.flash > 0 ? PAL.white : undefined;
      if (!e.alive) {
        // Pop: a white core, then a crisp expanding pixel ring
        const k = 1 - e.dying / 0.25;
        const cy = y - e.height / 2;
        if (k < 0.3) ellipse(c, x, cy, 4 - k * 6, 4 - k * 6, PAL.white);
        ring(c, x, cy, 3 + k * 10, k < 0.5 ? PAL.white : PAL.cyan);
        if (k > 0.4) ring(c, x, cy, 1 + k * 5, PAL.yellow);
        continue;
      }
      switch (e.kind) {
        case 'slime': this.drawSlime(c, e, x, y, white); break;
        case 'bat': this.drawBat(c, e, x, y, white); break;
        case 'thorn': this.drawThorn(c, e, x, y, white); break;
        case 'golem': this.drawGolem(c, e, x, y, white, time); break;
        case 'crate': this.drawCrate(c, x, y, white); break;
        case 'gem': this.drawGem(c, e, x, y, time); break;
      }
    }
  }

  private drawSlime(c: CanvasRenderingContext2D, e: Entity, x: number, y: number, tint?: string): void {
    // Bounces on the beat: squash on the downbeat, stretch after.
    const b = this.beatPulse;
    const w = 6 + b * 1.5;
    const h = 4.5 - b * 1.2 + Math.sin(e.t * 5) * 0.3;
    ellipse(c, x, y - h - 0.5, w + 1, h + 1, tint ?? PAL.ink);
    ellipse(c, x, y - h - 0.5, w, h, tint ?? PAL.green);
    ellipse(c, x - 2, y - h * 1.5, 2, 1, tint ?? PAL.lime);
    c.fillStyle = tint ?? PAL.ink;
    const face = e.vx < 0 ? -2 : 2;
    c.fillRect(x + face - 1, Math.round(y - h - 1), 1, 2);
    c.fillRect(x + face + 2, Math.round(y - h - 1), 1, 2);
    c.fillStyle = tint ?? PAL.teal;
    c.fillRect(x - Math.round(w) + 1, y - 1, Math.round(w) * 2 - 1, 1);
  }

  private drawBat(c: CanvasRenderingContext2D, e: Entity, x: number, y: number, tint?: string): void {
    const flap = Math.sin(e.t * (14 + this.hatEnv * 14)) > 0;
    ellipse(c, x, y, 4, 3, tint ?? PAL.ink);
    ellipse(c, x, y, 3, 2, tint ?? PAL.plum);
    const wy = flap ? -4 : 2;
    line(c, x - 3, y, x - 9, y + wy, tint ?? PAL.ink, 1);
    line(c, x - 3, y + 1, x - 8, y + wy + 2, tint ?? PAL.plum, 1);
    line(c, x + 3, y, x + 9, y + wy, tint ?? PAL.ink, 1);
    line(c, x + 3, y + 1, x + 8, y + wy + 2, tint ?? PAL.plum, 1);
    c.fillStyle = tint ?? PAL.yellow;
    c.fillRect(x - 2, y - 1, 1, 1);
    c.fillRect(x + 1, y - 1, 1, 1);
  }

  private drawThorn(c: CanvasRenderingContext2D, e: Entity, x: number, y: number, tint?: string): void {
    const bob = Math.sin(e.t * 8) > 0 ? 0 : 1;
    ellipse(c, x, y - 5 + bob, 7, 5, tint ?? PAL.ink);
    ellipse(c, x, y - 5 + bob, 6, 4, tint ?? PAL.plum);
    // Spikes
    c.fillStyle = tint ?? PAL.silver;
    for (let i = -2; i <= 2; i++) {
      const sx = x + i * 3;
      const sy = y - 10 + bob + Math.abs(i);
      c.fillRect(sx, sy, 1, 2);
      c.fillStyle = tint ?? PAL.white;
      c.fillRect(sx, sy - 1, 1, 1);
      c.fillStyle = tint ?? PAL.silver;
    }
    c.fillStyle = tint ?? PAL.orange;
    c.fillRect(x - 5, y - 5 + bob, 1, 1);
    c.fillStyle = tint ?? PAL.ink;
    c.fillRect(x - 4, y - 1, 2, 1);
    c.fillRect(x + 3, y - 1, 2, 1);
  }

  private drawGolem(c: CanvasRenderingContext2D, e: Entity, x: number, y: number, tint: string | undefined, time: number): void {
    const stomp = this.beatPulse > 0.6 ? 1 : 0;
    const top = y - 26 + stomp;
    c.fillStyle = tint ?? PAL.ink;
    c.fillRect(x - 11, top - 1, 22, 27 - stomp);
    c.fillStyle = tint ?? PAL.slate;
    c.fillRect(x - 10, top, 20, 25 - stomp);
    c.fillStyle = tint ?? PAL.shadow;
    c.fillRect(x - 10, top + 14, 20, 11 - stomp);
    c.fillRect(x + 6, top, 4, 25 - stomp);
    c.fillStyle = tint ?? PAL.silver;
    c.fillRect(x - 9, top + 1, 8, 2);
    // Arms
    c.fillStyle = tint ?? PAL.ink;
    c.fillRect(x - 15, top + 8 + stomp, 5, 12);
    c.fillRect(x + 10, top + 8 + stomp, 5, 12);
    c.fillStyle = tint ?? PAL.slate;
    c.fillRect(x - 14, top + 9 + stomp, 3, 10);
    c.fillRect(x + 11, top + 9 + stomp, 3, 10);
    // Glowing core + eyes (pulse with the music)
    const g = 0.5 + 0.5 * Math.sin(time * 6);
    c.fillStyle = tint ?? (g > 0.5 ? PAL.orange : PAL.red);
    c.fillRect(x - 2, top + 10, 5, 5);
    c.fillStyle = tint ?? PAL.yellow;
    c.fillRect(x - 1, top + 11, 3, 3);
    c.fillStyle = tint ?? PAL.orange;
    c.fillRect(x - 6, top + 5, 3, 1);
    c.fillRect(x + 2, top + 5, 3, 1);
    // HP pips
    for (let i = 0; i < e.hp; i++) {
      c.fillStyle = PAL.red;
      c.fillRect(x - 5 + i * 4, top - 5, 3, 2);
    }
  }

  private drawCrate(c: CanvasRenderingContext2D, x: number, y: number, tint?: string): void {
    const rows = [
      '00000000000000',
      '03333333333330',
      '03222222222230',
      '03211111111230',
      '03213111113230',
      '03211311131230',
      '03211131311230',
      '03211113111230',
      '03211131311230',
      '03211311131230',
      '03213111113230',
      '03211111111230',
      '03222222222230',
      '00000000000000',
    ];
    bitmap(c, rows, { '0': PAL.ink, '1': PAL.plum, '2': PAL.red, '3': PAL.orange }, x - 7, y - 14, false, tint);
  }

  private drawGem(c: CanvasRenderingContext2D, e: Entity, x: number, y: number, time: number): void {
    const rows = ['..0..', '.0c0.', '0cac0', '.0a0.', '..0..'];
    const tw = Math.sin(time * 6 + e.seed * 10) > 0.6;
    bitmap(c, rows, { '0': PAL.ink, c: tw ? PAL.white : PAL.cyan, a: PAL.sky }, x - 2, y - 2);
    if (tw) {
      c.fillStyle = PAL.white;
      c.fillRect(x + 3, y - 3, 1, 1);
    }
  }
}
