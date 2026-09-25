import type { MusicFrame, TimelineQuery } from '../../analysis/types';

/**
 * Continuous beat position of the song, and conversions between beats and
 * seconds. With the offline timeline this is exact (interpolated beat grid);
 * without it, a smoothed projection of the live tempo estimate.
 *
 * The whole game is laid out in beats, so the hero's position is a pure
 * function of this clock: it cannot drift, stumble or fall out of time.
 */
export class BeatClock {
  now = 0;
  beat = 0;
  bpm = 120;
  period = 0.5;
  playing = false;
  /** True when beats come from the offline analysis. */
  exact = false;
  timeline: TimelineQuery | null = null;
  private fb = 0;
  private fbInit = false;

  update(m: MusicFrame, dt: number): void {
    this.now = m.time;
    this.playing = m.playing;
    this.timeline = m.timeline;
    const tl = m.timeline;
    if (tl && tl.beats.length > 4) {
      this.exact = true;
      this.bpm = tl.bpm;
      this.period = 60 / tl.bpm;
      this.beat = this.beatAt(m.time);
      return;
    }
    this.exact = false;
    this.bpm = Math.max(60, Math.min(200, m.bpm));
    this.period = 60 / this.bpm;
    const target = m.beatIndex + m.beatPhase;
    if (!this.fbInit || Math.abs(target - this.fb) > 1.5) { this.fb = target; this.fbInit = true; }
    else if (m.playing) this.fb += dt / this.period + (target - this.fb) * 0.04;
    this.beat = this.fb;
  }

  /** Song beat (float) at song time t. */
  beatAt(t: number): number {
    const tl = this.timeline;
    if (!tl || tl.beats.length < 2) return this.beat + (t - this.now) / this.period;
    const b = tl.beats;
    const n = b.length;
    if (t <= b[0]) return (t - b[0]) / (b[1] - b[0]);
    if (t >= b[n - 1]) return n - 1 + (t - b[n - 1]) / (b[n - 1] - b[n - 2]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid] <= t) lo = mid; else hi = mid;
    }
    return lo + (t - b[lo]) / (b[lo + 1] - b[lo]);
  }

  /** Song time of a (float) beat. */
  timeAt(beat: number): number {
    const tl = this.timeline;
    if (!tl || tl.beats.length < 2) return this.now + (beat - this.beat) * this.period;
    const b = tl.beats;
    const n = b.length;
    if (beat <= 0) return b[0] + beat * (b[1] - b[0]);
    if (beat >= n - 1) return b[n - 1] + (beat - n + 1) * (b[n - 1] - b[n - 2]);
    const i = Math.floor(beat);
    return b[i] + (beat - i) * (b[i + 1] - b[i]);
  }

  /** Kick strength (0..1) on this beat, if the timeline knows. */
  kickAt(beat: number): number {
    const tl = this.timeline;
    if (!tl) return 0.5;
    const t = this.timeAt(beat);
    return tl.nextEvent('kick', t - 0.08, 0.16)?.strength ?? 0;
  }

  levelAt(beat: number, fallback: number): number {
    const s = this.timeline?.sectionAt(this.timeAt(beat));
    return s ? s.level : fallback;
  }

  energyAt(beat: number, fallback: number): number {
    return this.timeline ? this.timeline.energyAt(this.timeAt(beat)) : fallback;
  }

  /** Beats where a drop section starts. */
  dropBeats(): number[] {
    const tl = this.timeline;
    if (!tl) return [];
    return tl.sections.filter((s) => s.isDrop).map((s) => Math.round(this.beatAt(s.start)));
  }
}
