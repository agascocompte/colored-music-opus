import { mulberry32 } from '../common/math';
import type { BeatClock } from '../common/pixel/BeatClock';
import type { PoseName } from './poses';
import type { Spell, SpellShape, WizardDef } from './wizards';

/**
 * DUEL COMPOSER — the duel is written as a score on the beat grid.
 *
 * Both wizards get keyframe tracks (position + pose) in slot time, and every
 * spell is placed so its impact lands on a beat (bolts leave on the eighth
 * before). The composer follows a random script on every play: the winner,
 * the kind of duel (comeback, domination, see-saw, neck and neck) and every
 * move; damage is dealt so the health bars follow that script; each drop is
 * a clash of rays that breaks exactly on the drop (and the first one makes
 * both wizards ascend); the final spell lands at the end of the song's last
 * intense stretch.
 */

export interface Key { s: number; x: number; y: number; pose: PoseName }

export class Track {
  keys: Key[] = [];
  add(k: Key): void {
    const ks = this.keys;
    while (ks.length && ks[ks.length - 1].s >= k.s) ks.pop();
    ks.push(k);
  }
  get last(): Key { return this.keys[this.keys.length - 1]; }
  /** Index of the last key at or before s. */
  find(s: number): number {
    const ks = this.keys;
    if (!ks.length || s < ks[0].s) return -1;
    let lo = 0, hi = ks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ks[mid].s <= s) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
}

export type DuelEvent =
  | { kind: 'hit'; s: number; target: number; heavy: boolean }
  | { kind: 'block'; s: number; target: number }
  | { kind: 'cast'; s: number; who: number }
  | { kind: 'dust'; s: number; who: number; big: boolean }
  | { kind: 'text'; s: number; text: string; big: boolean; who?: number }
  | { kind: 'explode'; s: number; who: number; size: number; from: number }
  | { kind: 'ascend'; s: number; who: number }
  | { kind: 'ko'; s: number; who: number }
  | { kind: 'death'; s: number; who: number }
  | { kind: 'duel'; s: number }
  | { kind: 'clash'; s: number }
  | { kind: 'blink'; s: number; who: number; out: boolean };

export interface Blast { s0: number; s1: number; from: number; to: number; big: boolean; arc: number }
export interface Beam { s0: number; s1: number; from: number; clash?: { until: number; win: boolean } }
export interface Strike { kind: 'sky' | 'pillar'; s0: number; s: number; from: number; to: number }
export interface Range { s0: number; s1: number }

interface Status { aura: Range[]; vanish: Range[]; circle: Range[]; glow: Range[]; ascFrom: number; deadAt: number; hp: { s: number; hp: number }[] }

/** Melee distance between the two wizards (staff reach). */
const G = 24;
/** Comfortable spell-slinging distance. */
const RANGE = 92;

export class DuelComposer {
  readonly tracks = [new Track(), new Track()];
  readonly events: DuelEvent[] = [];
  readonly blasts: Blast[] = [];
  readonly beams: Beam[] = [];
  readonly strikes: Strike[] = [];
  readonly st: Status[] = [this.status(), this.status()];
  unit = 1;
  startSlot = 0;
  koSlot = Infinity;
  winner = 0;
  finished = false;
  scenario = '';
  private cursor = 0;
  private nextBar = 0;
  private drops: number[] = [];
  private staged = new Set<number>();
  private hp = [1, 1];
  private rng = mulberry32(1);
  private lastSpecial = -99;
  private sc = { dip: 0.55, dipAt: 0.62, loserMid: 0.3, swing: 0 };

  constructor(private readonly clock: BeatClock, readonly wizards: [WizardDef, WizardDef]) {}

  private status(): Status {
    return { aura: [], vanish: [], circle: [], glow: [], ascFrom: Infinity, deadAt: Infinity, hp: [{ s: -1e9, hp: 1 }] };
  }

  reset(seed: number, startSlot: number, unit: number, winner: number, koSlot: number): void {
    this.rng = mulberry32(seed);
    const r = this.rng();
    if (r < 0.3) { this.scenario = 'comeback'; this.sc = { dip: 0.5 + this.rng() * 0.25, dipAt: 0.5 + this.rng() * 0.2, loserMid: 0.2 + this.rng() * 0.15, swing: 0 }; }
    else if (r < 0.5) { this.scenario = 'domination'; this.sc = { dip: 0.15 + this.rng() * 0.15, dipAt: 0.6, loserMid: 0.45 + this.rng() * 0.2, swing: 0 }; }
    else if (r < 0.75) { this.scenario = 'seesaw'; this.sc = { dip: 0.4, dipAt: 0.7, loserMid: 0.3, swing: 0.18 + this.rng() * 0.08 }; }
    else { this.scenario = 'close'; this.sc = { dip: 0.55 + this.rng() * 0.15, dipAt: 0.85, loserMid: 0.4, swing: 0.05 }; }
    this.unit = unit;
    this.startSlot = startSlot;
    this.koSlot = koSlot;
    this.winner = winner;
    this.finished = false;
    this.cursor = startSlot;
    this.nextBar = startSlot;
    this.tracks[0].keys = [];
    this.tracks[1].keys = [];
    this.events.length = 0;
    this.blasts.length = 0;
    this.beams.length = 0;
    this.strikes.length = 0;
    this.st[0] = this.status();
    this.st[1] = this.status();
    this.staged.clear();
    this.lastSpecial = -99;
    this.drops = this.clock.dropBeats().map((b) => Math.round(b / unit)).filter((s) => s >= startSlot + 10 && s < koSlot - 10);
    const u = this.u(startSlot);
    this.hp = [this.target(0, u), this.target(1, u)];
    this.st[0].hp = [{ s: -1e9, hp: this.hp[0] }];
    this.st[1].hp = [{ s: -1e9, hp: this.hp[1] }];
    // After a seek past the first drop both have already ascended.
    if (this.clock.dropBeats().some((b) => b / unit < startSlot)) this.st[0].ascFrom = this.st[1].ascFrom = -1e9;
    for (const i of [0, 1]) {
      this.key(i, startSlot - 64, 'idle', (i ? 1 : -1) * RANGE / 2, 0);
      this.key(i, startSlot, 'idle', (i ? 1 : -1) * RANGE / 2, 0);
    }
    this.events.push({ kind: 'duel', s: startSlot });
  }

  // ------------------------------------------------------------ script

  private u(s: number): number {
    if (!Number.isFinite(this.koSlot)) return 0.3;
    return Math.max(0, Math.min(1, s / Math.max(1, this.koSlot)));
  }

  private target(i: number, u: number): number {
    const sm = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    const { dip, dipAt, loserMid, swing } = this.sc;
    const wave = swing * Math.sin(u * Math.PI * 3);
    if (i === this.winner) return Math.min(1, Math.max(0.1, 1 - dip * sm(0, dipAt, u) - 0.12 * u - wave));
    return Math.min(1, Math.max(0, 1 - loserMid * sm(0, dipAt, u) - (1 - loserMid) * sm(dipAt, 1, u) + wave));
  }

  /** Who should take the next hit so the bars follow the script. */
  private defender(s: number): number {
    const u = this.u(s);
    const need0 = this.hp[0] - this.target(0, u);
    const need1 = this.hp[1] - this.target(1, u);
    if (Math.abs(need0 - need1) < 0.02) return this.rng() < 0.5 ? 0 : 1;
    return need0 > need1 ? 0 : 1;
  }

  private damage(i: number, s: number, k: number): void {
    const tgt = this.target(i, this.u(s));
    let hp = this.hp[i] - Math.max(0.006, Math.min(0.03 + 0.1 * k, (this.hp[i] - tgt) * 0.55));
    hp = Math.max(hp, i === this.winner ? 0.08 : 0.04, tgt - 0.06);
    this.hp[i] = Math.min(this.hp[i], hp);
    this.st[i].hp.push({ s, hp: this.hp[i] });
  }

  private pick(i: number, shapes?: SpellShape[]): Spell {
    const all = this.wizards[i].spells;
    const pool = shapes ? all.filter((sp) => shapes.includes(sp.shape)) : all;
    const list = pool.length ? pool : all;
    return list[Math.floor(this.rng() * list.length)];
  }

  // ------------------------------------------------------------ helpers

  private pos(i: number): { x: number; y: number } { const k = this.tracks[i].last; return { x: k.x, y: k.y }; }
  private dir(a: number): number { return Math.sign(this.pos(1 - a).x - this.pos(a).x) || (a === 0 ? 1 : -1); }
  private dist(): number { return Math.abs(this.pos(0).x - this.pos(1).x); }
  private mid(): number { return (this.pos(0).x + this.pos(1).x) / 2; }
  private side(i: number): number { return Math.sign(this.pos(i).x - this.mid()) || (i === 0 ? -1 : 1); }

  private key(i: number, s: number, pose: PoseName, x?: number, y?: number): void {
    const tr = this.tracks[i];
    const last = tr.keys.length ? tr.last : null;
    // Holding a pose for a long time: keep it until just before the next move.
    if (last && s - last.s > 0.6) tr.add({ s: s - 0.3, pose: last.pose, x: last.x, y: last.y });
    tr.add({ s, pose, x: x ?? last?.x ?? 0, y: y ?? last?.y ?? 0 });
  }

  private hold(i: number, s: number, pose: PoseName = 'idle'): void { this.key(i, s, pose); }

  // ------------------------------------------------------------ composing

  compose(untilSlot: number): void {
    let guard = 0;
    while (!this.finished && this.nextBar <= untilSlot && guard++ < 32) {
      this.bar(this.nextBar);
      this.nextBar += 4;
    }
  }

  private level(s: number): number { return this.clock.levelAt(s * this.unit, 1); }

  private bar(sb: number): void {
    const end = sb + 4;
    let guard = 0;
    while (this.cursor < end && !this.finished && guard++ < 12) {
      const s = Math.ceil(this.cursor - 0.05);
      if (s >= this.koSlot - 8) { this.finisher(Math.max(s, this.koSlot - 8)); return; }
      const drop = this.drops.find((d) => !this.staged.has(d) && d - 8 >= s - 0.01);
      if (drop !== undefined && drop - 8 < end) {
        if (drop - 8 > s) this.standoff(s, drop - 8 - s);
        this.clash(drop);
        continue;
      }
      const limit = drop !== undefined ? drop - 8 : this.koSlot - 8;
      const room = limit - s;
      if (room < 2) { this.standoff(s, Math.max(0.5, room)); continue; }
      // Songs without drops: both ascend around mid-duel anyway.
      if (!this.drops.length && this.u(s) > 0.45 && room >= 4) {
        const w = [0, 1].find((i) => !Number.isFinite(this.st[i].ascFrom));
        if (w !== undefined) { this.ascendAlone(w, s); continue; }
      }
      const lvl = this.level(s);
      const d = this.defender(s);
      const a = 1 - d;
      const r = this.rng();
      const close = this.dist() < 50;
      if (lvl === 0) {
        if (close) { if (r < 0.45) this.staffClash(s); else this.separate(s); }
        else if (r < 0.25) this.standoff(s, 2);
        else if (r < 0.5) this.powerUp(this.rng() < 0.5 ? 0 : 1, s, 2);
        else if (r < 0.8 && room >= 3) this.pingPong(a, d, s, 2);
        else this.staffClash(s);
        continue;
      }
      if (lvl === 1) {
        if (!close) {
          if (r < 0.45 && room >= 4) this.pingPong(a, d, s, 3);
          else if (r < 0.75 && room >= 4) this.volley(a, d, s, 3, 1);
          else this.approach(a, s);
        } else {
          if (r < 0.35) this.melee(a, d, s, false);
          else if (r < 0.6 && room >= 3) this.blinkStrike(a, d, s);
          else if (r < 0.8 && room >= 4) this.launcher(a, d, s);
          else this.retreat(a, s);
        }
        continue;
      }
      // Intense
      if (!close) {
        if (s - this.lastSpecial > 12 && room >= 6 && r < 0.45) this.special(a, d, s + 3);
        else if (r < 0.7 && room >= 4) this.volley(a, d, s, 4, 0.5);
        else if (r < 0.85 && room >= 5) this.airDuel(a, d, s);
        else this.approach(a, s);
      } else {
        if (r < 0.3 && room >= 4) this.launcher(a, d, s);
        else if (r < 0.55 && room >= 3) this.blinkStrike(a, d, s);
        else if (r < 0.75 && room >= 4) this.melee(a, d, s, true);
        else this.retreat(a, s);
      }
    }
  }

  // ------------------------------------------------------------ patterns

  private standoff(s: number, len: number): void {
    for (const i of [0, 1]) this.hold(i, s, 'idle');
    const i = this.rng() < 0.5 ? 0 : 1;
    const taunt = len >= 2 && this.rng() < 0.5;
    if (taunt) {
      this.hold(i, s + 1, 'taunt');
      this.hold(i, s + 1.8, 'taunt');
    }
    // Footsies: nobody stands still — a step in and back out, landing on each beat.
    const base = [this.pos(0).x, this.pos(1).x];
    for (let b = 1; b <= Math.floor(len); b++) {
      for (const j of [0, 1]) {
        if (taunt && j === i && b <= 2) continue;
        const step = b % 2 ? (j === i ? 4 : -3) : 0;
        this.key(j, s + b, b % 2 ? 'idle2' : 'idle', base[j] + this.dir(j) * step, 0);
      }
    }
    for (const j of [0, 1]) this.hold(j, s + len, j === i ? 'idle' : 'idle2');
    this.cursor = s + len;
  }

  /** Both leap apart to spell range. */
  private separate(s: number): void {
    const mid = this.mid();
    for (const i of [0, 1]) {
      const side = this.side(i);
      this.hold(i, s, 'idle');
      this.key(i, s + 0.5, 'float', mid + side * (RANGE / 2 - 4), -12);
      this.key(i, s + 1, 'idle', mid + side * RANGE / 2, 0);
      this.events.push({ kind: 'dust', s: s + 1, who: i, big: false });
    }
    this.cursor = s + 1;
  }

  private powerUp(i: number, s: number, len: number): void {
    this.hold(i, s, 'idle');
    this.hold(i, s + 0.25, 'charge');
    this.hold(i, s + len - 0.3, 'charge');
    this.hold(i, s + len, 'idle');
    this.hold(1 - i, s, 'idle');
    this.hold(1 - i, s + len, 'idle2');
    this.st[i].aura.push({ s0: s + 0.2, s1: s + len });
    this.st[i].circle.push({ s0: s + 0.2, s1: s + len });
    this.st[i].glow.push({ s0: s + 0.2, s1: s + len });
    this.events.push({ kind: 'dust', s: s + 0.25, who: i, big: true });
    this.cursor = s + len;
  }

  /** Close the gap: a blink (vanish, reappear) or a gliding dash. */
  private approach(a: number, s: number): void {
    const d = 1 - a;
    const target = this.pos(d).x - this.dir(a) * G;
    if (this.rng() < 0.5) this.blinkTo(a, s, target);
    else {
      this.hold(a, s, 'idle');
      this.key(a, s + 0.55, 'dash', target, -3);
      this.key(a, s + 0.75, 'idle', target, 0);
      this.events.push({ kind: 'dust', s: s + 0.75, who: a, big: false });
    }
    this.hold(d, s, 'idle');
    this.hold(d, s + 0.75, 'block');
    this.hold(d, s + 1, 'idle');
    this.cursor = s + 1;
  }

  private blinkTo(a: number, s: number, x: number, y = 0): void {
    this.hold(a, s, 'idle');
    this.st[a].vanish.push({ s0: s + 0.3, s1: s + 0.5 });
    this.events.push({ kind: 'blink', s: s + 0.3, who: a, out: true }, { kind: 'blink', s: s + 0.5, who: a, out: false });
    this.hold(a, s + 0.49, 'idle');
    this.key(a, s + 0.5, 'idle', x, y);
  }

  /** Blink back out to spell range. */
  private retreat(a: number, s: number): void {
    const d = 1 - a;
    const x = this.pos(d).x - this.dir(a) * RANGE;
    this.blinkTo(a, s, x);
    this.hold(d, s + 1, 'idle2');
    this.cursor = s + 1;
  }

  /** One staff blow landing on beat s. */
  private strike(a: number, d: number, s: number, hit: boolean, pose: 'swing' | 'swingUp', heavy = false): void {
    const dir = this.dir(a);
    const { x: ax, y: ay } = this.pos(a);
    this.key(a, s - 0.3, 'swingWind', ax, ay);
    this.key(a, s - 0.06, 'swingWind', ax - dir, ay);
    this.key(a, s, pose, ax + dir * 4, ay);
    this.key(a, s + 0.2, pose, ax + dir * 4, ay);
    this.key(a, s + 0.5, 'idle');
    const { x: dx, y: dy } = this.pos(d);
    if (hit) {
      const prev = this.tracks[d].last.pose;
      this.key(d, s - 0.03, prev === 'hit' || prev === 'block' ? 'idle' : prev);
      this.key(d, s, 'hit', dx + dir * (heavy ? 8 : 4), dy);
      this.key(d, s + 0.3, 'hit');
      this.key(d, s + 0.6, 'idle');
      this.damage(d, s, heavy ? 0.6 : 0.25);
      this.events.push({ kind: 'hit', s, target: d, heavy });
    } else {
      this.key(d, s - 0.12, 'block');
      this.key(d, s, 'block', dx + dir * 3);
      this.key(d, s + 0.35, 'block');
      this.key(d, s + 0.55, 'idle');
      this.events.push({ kind: 'block', s, target: d });
    }
  }

  private knockBack(d: number, dir: number, s: number, dist: number): void {
    const x = this.pos(d).x + dir * dist;
    this.key(d, s + 0.08, 'knock', this.pos(d).x + dir * 6, -7);
    this.key(d, s + 0.7, 'knock', x, -3);
    this.key(d, s + 0.85, 'idle', x + dir * 3, 0);
    this.events.push({ kind: 'dust', s: s + 0.85, who: d, big: true });
  }

  /** A bolt that leaves on the eighth before and lands on beat `hitT`. */
  private bolt(a: number, d: number, hitT: number, hit: boolean, big = false): void {
    const launch = hitT - (big ? 1 : 0.5);
    this.key(a, launch - 0.3, 'castWind');
    this.key(a, launch - 0.04, 'castWind');
    this.key(a, launch, 'castF');
    this.key(a, launch + 0.3, 'castF');
    this.blasts.push({ s0: launch, s1: hitT, from: a, to: d, big, arc: big ? 0 : (this.rng() - 0.5) * 16 });
    this.events.push({ kind: 'cast', s: launch, who: a });
    const prev = this.tracks[d].last.pose;
    const base = prev === 'hit' || prev === 'block' || prev === 'castF' || prev === 'castWind' ? 'idle' : prev;
    this.key(d, hitT - 0.2, hit ? base : 'block');
    this.key(d, hitT, hit ? 'hit' : 'block', this.pos(d).x + this.dir(a) * (hit ? 3 : 1));
    this.key(d, hitT + 0.3, hit ? 'hit' : 'block');
    if (hit) { this.damage(d, hitT, big ? 0.7 : 0.25); this.events.push({ kind: 'hit', s: hitT, target: d, heavy: big }); }
    else this.events.push({ kind: 'block', s: hitT, target: d });
    this.events.push({ kind: 'explode', s: hitT, who: d, size: big ? 10 : 4, from: a });
  }

  /** Spell tennis: bolts fly back and forth, one per beat, the last one lands. */
  private pingPong(a: number, d: number, s: number, n: number): void {
    if (this.dist() < 50) { this.separate(s); return; }
    for (let k = 0; k < n; k++) {
      const shooter = k % 2 === 0 ? a : d;
      const target = 1 - shooter;
      const hit = k === n - 1 && target === d;
      this.bolt(shooter, target, s + 1 + k, hit);
    }
    const end = s + n + 0.6;
    this.hold(a, end, 'idle');
    this.hold(d, end, 'idle');
    this.cursor = s + n + 0.6;
  }

  /** A string of bolts on beats (or eighths); the shield holds, then breaks. */
  private volley(a: number, d: number, s: number, n: number, step: number): void {
    if (this.dist() < 50) { this.separate(s); return; }
    for (let k = 0; k < n; k++) this.bolt(a, d, s + 1 + k * step, k % 2 === 1 || k === n - 1);
    const end = s + 1 + (n - 1) * step + 0.6;
    this.hold(a, end, 'idle');
    this.hold(d, end, 'idle');
    this.cursor = end;
  }

  private melee(a: number, d: number, s: number, combo: boolean): void {
    if (this.dist() > G + 8) { this.approach(a, s); return; }
    this.strike(a, d, s + 1, false, 'swing');
    this.strike(a, d, s + 2, true, 'swing', combo);
    if (combo) this.knockBack(d, this.dir(a), s + 2, 40);
    this.cursor = s + (combo ? 3 : 2.6);
  }

  /** Staff swipe launches the opponent; a bolt catches them in the air. */
  private launcher(a: number, d: number, s: number): void {
    if (this.dist() > G + 8) { this.approach(a, s); return; }
    const dir = this.dir(a);
    const dx = this.pos(d).x;
    this.strike(a, d, s + 1, true, 'swingUp', true);
    this.key(d, s + 1.08, 'knock', dx + dir * 6, -12);
    this.key(d, s + 1.9, 'knock', dx + dir * 14, -40);
    // Step back and fire at the airborne opponent
    this.key(a, s + 1.5, 'idle', this.pos(a).x - dir * 10, 0);
    this.bolt(a, d, s + 2, true, false);
    this.key(d, s + 2.05, 'knock', dx + dir * 18, -36);
    this.key(d, s + 2.5, 'down', dx + dir * 26, 0);
    this.events.push({ kind: 'dust', s: s + 2.5, who: d, big: true });
    this.key(d, s + 3.2, 'down');
    this.key(d, s + 3.6, 'idle', dx + dir * 26, 0);
    this.hold(a, s + 3.2, 'taunt');
    this.hold(a, s + 3.6, 'idle');
    this.cursor = s + 3.6;
  }

  /** Blink behind the opponent and hit on the beat. */
  private blinkStrike(a: number, d: number, s: number): void {
    const dir = this.dir(a);
    const dx = this.pos(d).x;
    this.blinkTo(a, s, dx + dir * G);
    this.hold(d, s + 0.6, 'idle2');
    this.strike(a, d, s + 1, true, 'swing', true);
    this.knockBack(d, -dir, s + 1, 38);
    this.cursor = s + 2;
  }

  /** Staffs clash in the middle on the downbeat: shockwave, both slide back. */
  private staffClash(s: number): void {
    const mid = this.mid();
    for (const i of [0, 1]) {
      const side = this.side(i);
      this.hold(i, s + 0.2, 'idle');
      this.key(i, s + 0.65, 'dash', mid + side * (G / 2 + 4), -2);
      this.key(i, s + 0.94, 'swingWind', mid + side * (G / 2 + 2), 0);
      this.key(i, s + 1, 'swing', mid + side * (G / 2 - 2), 0);
      this.key(i, s + 1.3, 'swing', mid + side * (G / 2), 0);
      this.key(i, s + 1.7, 'float', mid + side * (RANGE / 2 - 6), -10);
      this.key(i, s + 2, 'idle', mid + side * RANGE / 2, 0);
    }
    this.events.push({ kind: 'clash', s: s + 1 });
    this.cursor = s + 2;
  }

  /** Both levitate and duel in the air; the last bolt knocks one down. */
  private airDuel(a: number, d: number, s: number): void {
    const mid = this.mid();
    const ya = -34;
    for (const i of [0, 1]) this.key(i, s + 0.7, 'float', mid + this.side(i) * RANGE / 2, ya);
    this.hold(a, s + 0.8, 'float');
    this.hold(d, s + 0.8, 'float');
    this.bolt(a, d, s + 1.5, false);
    this.bolt(d, a, s + 2, false);
    this.bolt(a, d, s + 3, true, true);
    const dir = this.dir(a);
    const dx = this.pos(d).x;
    this.key(d, s + 3.1, 'knock', dx + dir * 8, ya + 4);
    this.key(d, s + 3.6, 'down', dx + dir * 18, 0);
    this.events.push({ kind: 'dust', s: s + 3.6, who: d, big: true });
    this.key(a, s + 3.5, 'float', this.pos(a).x, -14);
    this.key(a, s + 4, 'idle', this.pos(a).x, 0);
    this.key(d, s + 4.1, 'down');
    this.key(d, s + 4.5, 'idle', dx + dir * 18, 0);
    this.cursor = s + 4.5;
  }

  private chargePose(sp: Spell): PoseName {
    return sp.shape === 'sky' || sp.shape === 'pillar' ? 'castUp' : sp.shape === 'beam' ? 'channel' : 'charge';
  }

  /** Signature spell, chanted on the beats before sFire. */
  private special(a: number, d: number, sFire: number, finisher = false, forced?: Spell): void {
    const sp = forced ?? this.pick(a);
    const s0 = sFire - 2;
    const charge = this.chargePose(sp);
    this.hold(a, s0, 'idle');
    this.hold(a, s0 + 0.25, charge);
    this.st[a].aura.push({ s0, s1: sFire + 1 });
    this.st[a].circle.push({ s0: s0 + 0.25, s1: sFire + 0.5 });
    this.st[a].glow.push({ s0: s0 + 0.25, s1: sFire + 1 });
    const n = sp.chant.length;
    sp.chant.forEach((w, k) => this.events.push({ kind: 'text', s: n === 1 ? sFire : s0 + (k * 2) / (n - 1), text: w, big: false, who: a }));
    this.events.push({ kind: 'text', s: sFire + 0.02, text: sp.name, big: true });
    this.lastSpecial = sFire;
    const dir = this.dir(a);
    let impact = sFire + 1;
    switch (sp.shape) {
      case 'orb':
        this.hold(a, sFire - 0.3, 'castWind');
        this.hold(a, sFire, 'castF');
        this.hold(a, sFire + 0.8, 'castF');
        this.blasts.push({ s0: sFire, s1: impact, from: a, to: d, big: true, arc: 0 });
        this.events.push({ kind: 'cast', s: sFire, who: a });
        break;
      case 'beam':
        impact = sFire + 0.25;
        this.hold(a, sFire - 0.05, 'channel');
        this.hold(a, sFire + 1.2, 'channel');
        this.beams.push({ s0: sFire, s1: sFire + 1.2, from: a });
        break;
      case 'sky':
        this.hold(a, sFire, 'castUp');
        this.hold(a, sFire + 0.8, 'castUp');
        this.strikes.push({ kind: 'sky', s0: sFire - 1, s: impact, from: a, to: d });
        this.events.push({ kind: 'cast', s: sFire, who: a });
        break;
      case 'pillar':
        this.hold(a, sFire - 0.12, 'castUp');
        this.hold(a, sFire, 'slam');
        this.hold(a, sFire + 0.8, 'slam');
        this.strikes.push({ kind: 'pillar', s0: sFire, s: impact, from: a, to: d });
        this.events.push({ kind: 'dust', s: sFire, who: a, big: true });
        break;
    }
    this.hold(a, impact + 0.6, 'idle');
    const prev = this.tracks[d].last.pose;
    this.hold(d, impact - 0.05, prev === 'hit' ? 'idle2' : prev);
    this.events.push({ kind: 'hit', s: impact, target: d, heavy: true }, { kind: 'explode', s: impact, who: d, size: sp.shape === 'orb' ? 16 : 22, from: a });
    const dx = this.pos(d).x;
    if (finisher) {
      this.hp[d] = 0;
      this.st[d].hp.push({ s: impact, hp: 0 });
      this.cursor = impact;
      return;
    }
    this.damage(d, impact, 1);
    if (sp.shape === 'pillar' || sp.shape === 'sky') {
      // Thrown up by the blast
      this.key(d, impact, 'hit', dx, 0);
      this.key(d, impact + 0.1, 'knock', dx + dir * 4, -22);
      this.key(d, impact + 0.6, 'down', dx + dir * 12, 0);
      this.key(d, impact + 1.3, 'down');
      this.key(d, impact + 1.7, 'idle', dx + dir * 12, 0);
      this.events.push({ kind: 'dust', s: impact + 0.6, who: d, big: true });
    } else {
      this.key(d, impact, 'hit', dx + dir * 3);
      this.knockBack(d, dir, impact, 30);
    }
    this.cursor = impact + 1.7;
  }

  /** Drop: both charge through the build, rays collide, the clash breaks on the drop. */
  private clash(sd: number): void {
    this.staged.add(sd);
    const s0 = sd - 8;
    const mid = this.mid();
    for (const i of [0, 1]) {
      const side = this.side(i);
      this.hold(i, s0, 'idle');
      this.key(i, s0 + 0.7, 'float', mid + side * (RANGE / 2 + 6), -12);
      this.key(i, s0 + 1, 'charge', mid + side * (RANGE / 2 + 8), 0);
      this.hold(i, sd - 4.3, 'charge');
      this.st[i].aura.push({ s0: s0 + 1, s1: sd + 1 });
      this.st[i].circle.push({ s0: s0 + 1, s1: sd });
      this.st[i].glow.push({ s0: s0 + 1, s1: sd + 1 });
      this.events.push({ kind: 'dust', s: s0 + 1, who: i, big: true });
    }
    this.events.push({ kind: 'text', s: s0 + 1, text: 'ARCANA!', big: true });
    const lose = this.defender(sd);
    const win = 1 - lose;
    for (const i of [0, 1]) {
      const sp = this.pick(i, ['beam']);
      this.hold(i, sd - 4.05, 'channel');
      this.hold(i, sd, 'channel');
      this.beams.push({ s0: sd - 4, s1: i === win ? sd + 1 : sd + 0.3, from: i, clash: { until: sd, win: i === win } });
      this.events.push({ kind: 'text', s: sd - 4, text: sp.name, big: false, who: i });
    }
    // The first drop awakens both wizards' true power.
    for (const i of [0, 1]) {
      if (!Number.isFinite(this.st[i].ascFrom)) {
        this.st[i].ascFrom = sd;
        this.events.push({ kind: 'ascend', s: sd, who: i });
      }
    }
    const impact = sd + 0.35;
    this.hold(win, sd + 1, 'channel');
    this.hold(win, sd + 1.4, 'idle');
    this.hold(lose, impact - 0.05, 'channel');
    this.key(lose, impact, 'hit');
    this.events.push({ kind: 'hit', s: impact, target: lose, heavy: true }, { kind: 'explode', s: impact, who: lose, size: 22, from: win });
    this.damage(lose, impact, 1);
    this.knockBack(lose, Math.sign(this.pos(lose).x - this.pos(win).x) || 1, impact, 26);
    this.cursor = sd + 2;
  }

  /** Without drops: a wizard ascends on their own. */
  private ascendAlone(i: number, s: number): void {
    this.powerUp(i, s, 4);
    this.st[i].ascFrom = s + 3.5;
    this.events.push({ kind: 'ascend', s: s + 3.5, who: i });
  }

  private finisher(s: number): void {
    const w = this.winner, l = 1 - w;
    const ko = Math.max(this.koSlot, s + 6);
    const mid = this.mid();
    for (const i of [0, 1]) {
      this.hold(i, s, 'idle');
      this.key(i, s + 0.8, 'idle', mid + this.side(i) * (RANGE / 2 + 4), 0);
    }
    this.hold(l, ko - 2.5, 'idle2');
    const sp = this.pick(w, ['sky', 'beam', 'pillar']);
    // The impact of the last spell lands on the KO beat.
    const fireAt = sp.shape === 'beam' ? ko - 0.25 : ko - 1;
    this.special(w, l, fireAt, true, sp);
    const dir = this.dir(w);
    const lx = this.pos(l).x;
    this.key(l, ko, 'hit', lx, 0);
    this.key(l, ko + 0.15, 'knock', lx + dir * 8, -26);
    this.key(l, ko + 0.8, 'down', lx + dir * 22, 0);
    this.key(l, ko + 3, 'down');
    this.events.push({ kind: 'ko', s: ko, who: l }, { kind: 'dust', s: ko + 0.8, who: l, big: true });
    this.st[l].deadAt = ko + 3;
    this.events.push({ kind: 'death', s: ko + 3, who: l });
    this.hold(w, ko + 3.5, 'idle');
    this.hold(w, ko + 4, 'victory');
    this.hold(w, ko + 400, 'victory');
    this.events.push({ kind: 'text', s: ko + 4, text: `${this.wizards[w].name} WINS`, big: true });
    this.finished = true;
  }
}
