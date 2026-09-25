import type { HitKind, MusicEvent, Section, TimelineQuery } from '../types';
import type { TimelineData } from './offlineAnalysis';

/** First index i with arr[i] > t. */
function upperBound(arr: Float32Array, t: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export class Timeline implements TimelineQuery {
  readonly duration: number;
  readonly bpm: number;
  readonly beats: Float32Array;
  readonly sections: Section[];
  private readonly ev: Record<HitKind, { t: Float32Array; s: Float32Array }>;
  private readonly energy: Float32Array;
  private readonly energyRate: number;

  constructor(d: TimelineData) {
    this.duration = d.duration;
    this.bpm = d.bpm;
    this.beats = d.beats;
    this.energy = d.energy;
    this.energyRate = d.energyRate;
    this.ev = {
      kick: { t: d.kickT, s: d.kickS },
      snare: { t: d.snareT, s: d.snareS },
      hat: { t: d.hatT, s: d.hatS },
    };
    this.sections = [];
    for (let i = 0; i < d.sections.length; i += 5) {
      this.sections.push({
        start: d.sections[i], end: d.sections[i + 1], energy: d.sections[i + 2],
        level: d.sections[i + 3] as 0 | 1 | 2, isDrop: d.sections[i + 4] > 0.5,
      });
    }
  }

  count(kind: HitKind): number { return this.ev[kind].t.length; }

  /** Raw arrays, for iteration by index (used by the engine's event cursor). */
  raw(kind: HitKind): { t: Float32Array; s: Float32Array } { return this.ev[kind]; }

  nextEvent(kind: HitKind, t: number, horizon = 1e9, minStrength = 0): MusicEvent | null {
    const { t: times, s } = this.ev[kind];
    for (let i = upperBound(times, t); i < times.length && times[i] < t + horizon; i++) {
      if (s[i] >= minStrength) return { time: times[i], kind, strength: s[i] };
    }
    return null;
  }

  eventsBetween(kind: HitKind, t0: number, t1: number, out: MusicEvent[], minStrength = 0): MusicEvent[] {
    out.length = 0;
    const { t: times, s } = this.ev[kind];
    for (let i = upperBound(times, t0 - 1e-6); i < times.length && times[i] < t1; i++) {
      if (s[i] >= minStrength) out.push({ time: times[i], kind, strength: s[i] });
    }
    return out;
  }

  beatIndexAt(t: number): number { return upperBound(this.beats, t) - 1; }

  nextBeat(t: number): number {
    const i = upperBound(this.beats, t);
    if (i < this.beats.length) return this.beats[i];
    const p = 60 / this.bpm;
    const last = this.beats.length ? this.beats[this.beats.length - 1] : 0;
    return last + Math.ceil((t - last) / p + 1e-6) * p;
  }

  energyAt(t: number): number {
    const x = t * this.energyRate;
    const i = Math.floor(x);
    if (i < 0) return this.energy[0] ?? 0;
    if (i >= this.energy.length - 1) return this.energy[this.energy.length - 1] ?? 0;
    const f = x - i;
    return this.energy[i] * (1 - f) + this.energy[i + 1] * f;
  }

  sectionAt(t: number): Section | null {
    for (const s of this.sections) if (t >= s.start && t < s.end) return s;
    return this.sections[this.sections.length - 1] ?? null;
  }

  sectionIndexAt(t: number): number {
    for (let i = 0; i < this.sections.length; i++) if (t < this.sections[i].end) return i;
    return Math.max(0, this.sections.length - 1);
  }

  nextSection(t: number): Section | null {
    for (const s of this.sections) if (s.start > t) return s;
    return null;
  }
}
