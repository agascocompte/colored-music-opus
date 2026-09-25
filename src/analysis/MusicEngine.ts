import { RealtimeAnalyzer } from './RealtimeAnalyzer';
import { Timeline } from './timeline/Timeline';
import { createFrame, type HitKind, type MusicFrame } from './types';

/**
 * AUDIO → ANALYSIS → EVENTS/PARAMETERS.
 *
 * Merges the realtime analyzer (continuous signals, always available) with the
 * offline Timeline (precise events + look-ahead, available shortly after load).
 * Produces one MusicFrame per rendered frame, shared by every visualizer.
 */
export class MusicEngine {
  readonly frame: MusicFrame = createFrame();
  readonly realtime = new RealtimeAnalyzer();
  private timeline: Timeline | null = null;

  private lastTime = 0;
  private cursors: Record<HitKind, number> = { kick: 0, snare: 0, hat: 0 };
  private beatCursor = 0;
  private sectionCursor = 0;

  // Fallback tempo tracking (before the timeline is ready)
  private fbPeriod = 0.5;
  private fbPhaseT = 0; // time of last predicted beat
  private fbLastOnset = -1;
  private fbBeatCount = 0;

  private slowEnergy = 0;
  private prevIntensity = 0;
  private lastDropT = -1e9;
  /** Seconds of playback since the last reset/seek (realtime heuristics need a warm-up). */
  private warm = 0;
  private lastSectionT = -1e9;
  private profFast = new Float32Array(6);
  private profSlow = new Float32Array(6);

  setTimeline(tl: Timeline | null): void {
    this.timeline = tl;
    this.frame.timeline = tl;
    this.resync(this.lastTime);
  }

  getTimeline(): Timeline | null { return this.timeline; }

  /** Call after a seek or a new song so events aren't replayed. */
  resync(t: number): void {
    this.lastTime = t;
    const tl = this.timeline;
    if (tl) {
      for (const k of ['kick', 'snare', 'hat'] as HitKind[]) {
        const arr = tl.raw(k).t;
        let i = 0;
        while (i < arr.length && arr[i] <= t) i++;
        this.cursors[k] = i;
      }
      this.beatCursor = tl.beatIndexAt(t) + 1;
      this.sectionCursor = tl.sectionIndexAt(t);
    }
    this.realtime.resetDetectors();
    this.warm = 0;
  }

  /** New song: clears state and bumps the song id visualizers can react to. */
  reset(title = ''): void {
    this.frame.songId++;
    this.frame.songTitle = title;
    this.setTimeline(null);
    this.slowEnergy = 0;
    this.fbBeatCount = 0;
    this.fbLastOnset = -1;
    this.lastDropT = this.lastSectionT = -1e9;
    this.resync(0);
  }

  update(songTime: number, dt: number, playing: boolean, latency: number): MusicFrame {
    const f = this.frame;
    const rt = this.realtime;
    // What the listener hears right now.
    const t = Math.max(0, songTime - latency);
    if (Math.abs(t - this.lastTime) > 0.4 || t < this.lastTime - 1e-3) this.resync(t);

    rt.analyze(t, dt, playing);
    this.warm = playing ? this.warm + dt : this.warm;

    f.time = t;
    f.dt = dt;
    f.playing = playing;
    f.rms = rt.rms;
    f.level = rt.level;
    f.bands.sub = rt.bands.sub; f.bands.bass = rt.bands.bass; f.bands.lowMid = rt.bands.lowMid;
    f.bands.mid = rt.bands.mid; f.bands.highMid = rt.bands.highMid; f.bands.treble = rt.bands.treble;
    f.spectrum.set(rt.spectrum);
    f.waveform.set(rt.waveform);
    f.brightness = rt.brightness;
    f.flux = rt.flux;

    f.kick = f.snare = f.hat = f.beat = f.drop = f.sectionChange = false;
    f.hitStrength = 0;

    const tl = this.timeline;
    let kickS = 0, snareS = 0, hatS = 0;
    if (playing) {
      if (tl) {
        kickS = this.consume(tl, 'kick', t);
        snareS = this.consume(tl, 'snare', t);
        hatS = this.consume(tl, 'hat', t);
      } else {
        kickS = rt.kick; snareS = rt.snare; hatS = rt.hat;
      }
    }
    if (kickS > 0.12) { f.kick = true; f.kickEnv = Math.max(f.kickEnv, 0.4 + 0.6 * kickS); }
    if (snareS > 0.12) { f.snare = true; f.snareEnv = Math.max(f.snareEnv, 0.4 + 0.6 * snareS); }
    if (hatS > 0.1) { f.hat = true; f.hatEnv = Math.max(f.hatEnv, 0.3 + 0.7 * hatS); }
    f.hitStrength = Math.max(f.kick ? kickS : 0, f.snare ? snareS : 0);

    // Envelopes decay with time constants tuned per instrument.
    f.kickEnv *= Math.exp(-dt / 0.14);
    f.snareEnv *= Math.exp(-dt / 0.12);
    f.hatEnv *= Math.exp(-dt / 0.06);
    f.beatEnv *= Math.exp(-dt / 0.18);

    // ---- Rhythm ----
    if (tl && tl.beats.length) {
      const beats = tl.beats;
      while (this.beatCursor < beats.length && beats[this.beatCursor] <= t) {
        this.beatCursor++;
        if (playing) { f.beat = true; f.beatEnv = 1; }
      }
      const i = this.beatCursor - 1;
      const b0 = i >= 0 ? beats[i] : beats[0] - 60 / tl.bpm;
      const b1 = i + 1 < beats.length ? beats[i + 1] : b0 + 60 / tl.bpm;
      f.bpm = tl.bpm;
      f.beatIndex = Math.max(0, i);
      f.beatPhase = Math.min(1, Math.max(0, (t - b0) / Math.max(1e-3, b1 - b0)));
    } else {
      this.fallbackTempo(t, kickS || snareS * 0.8, playing);
    }
    f.barPhase = ((f.beatIndex % 4) + f.beatPhase) / 4;

    // ---- Dynamics ----
    const lvl = tl ? tl.energyAt(t) * 0.6 + rt.level * 0.4 : rt.level;
    this.slowEnergy += (lvl - this.slowEnergy) * (1 - Math.exp(-dt / 6));
    f.energy = this.slowEnergy;
    const activity = Math.min(1, lvl * 0.75 + rt.flux * 0.35 + f.kickEnv * 0.1);
    f.intensity += (activity - f.intensity) * (1 - Math.exp(-dt / 0.9));
    const d = (f.intensity - this.prevIntensity) / Math.max(dt, 1e-3);
    this.prevIntensity = f.intensity;
    f.trend += (d - f.trend) * (1 - Math.exp(-dt / 1.5));

    // ---- Structure ----
    if (tl && tl.sections.length) {
      const idx = tl.sectionIndexAt(t);
      if (idx !== this.sectionCursor) {
        if (playing && idx === this.sectionCursor + 1) {
          f.sectionChange = true;
          if (tl.sections[idx].isDrop) f.drop = true;
        }
        this.sectionCursor = idx;
      }
      f.sectionIndex = idx;
      f.sectionLevel = tl.sections[idx].level;
    } else if (playing) {
      this.fallbackStructure(t, dt);
    }
    this.lastTime = t;
    return f;
  }

  private consume(tl: Timeline, kind: HitKind, t: number): number {
    const { t: times, s } = tl.raw(kind);
    let best = 0;
    let c = this.cursors[kind];
    while (c < times.length && times[c] <= t) { best = Math.max(best, s[c]); c++; }
    this.cursors[kind] = c;
    return best;
  }

  /** Simple IOI + phase-locked tempo follower used until the timeline arrives. */
  private fallbackTempo(t: number, onset: number, playing: boolean): void {
    const f = this.frame;
    if (onset > 0.2) {
      if (this.fbLastOnset > 0) {
        let ioi = t - this.fbLastOnset;
        // Fold the interval into 0.33..0.8 s (75–180 BPM)
        while (ioi > 0 && ioi < 0.33) ioi *= 2;
        while (ioi > 0.8) ioi /= 2;
        if (ioi >= 0.33 && ioi <= 0.8) this.fbPeriod += (ioi - this.fbPeriod) * 0.12;
      }
      this.fbLastOnset = t;
      // Phase correction towards the onset
      const err = t - this.fbPhaseT;
      const wrapped = err - Math.round(err / this.fbPeriod) * this.fbPeriod;
      this.fbPhaseT += wrapped * 0.25;
    }
    while (t - this.fbPhaseT >= this.fbPeriod) {
      this.fbPhaseT += this.fbPeriod;
      this.fbBeatCount++;
      if (playing) { f.beat = true; f.beatEnv = 1; }
    }
    if (t < this.fbPhaseT) this.fbPhaseT = t;
    f.bpm = 60 / this.fbPeriod;
    f.beatIndex = this.fbBeatCount;
    f.beatPhase = Math.min(1, (t - this.fbPhaseT) / this.fbPeriod);
  }

  /** Drop / section-change heuristics used until the timeline arrives. */
  private fallbackStructure(t: number, dt: number): void {
    const f = this.frame;
    const b = f.bands;
    const vals = [b.sub, b.bass, b.lowMid, b.mid, b.highMid, b.treble];
    let dist = 0;
    for (let i = 0; i < 6; i++) {
      this.profFast[i] += (vals[i] - this.profFast[i]) * (1 - Math.exp(-dt / 1.5));
      this.profSlow[i] += (vals[i] - this.profSlow[i]) * (1 - Math.exp(-dt / 10));
      dist += (this.profFast[i] - this.profSlow[i]) ** 2;
    }
    if (this.warm > 12 && f.intensity - f.energy > 0.22 && f.trend > 0.15 && t - this.lastDropT > 10) {
      f.drop = true;
      f.sectionChange = true;
      this.lastDropT = this.lastSectionT = t;
      f.sectionIndex++;
    } else if (this.warm > 12 && Math.sqrt(dist) > 0.35 && t - this.lastSectionT > 12) {
      f.sectionChange = true;
      this.lastSectionT = t;
      f.sectionIndex++;
    }
    f.sectionLevel = f.intensity < 0.4 ? 0 : f.intensity < 0.65 ? 1 : 2;
  }
}
