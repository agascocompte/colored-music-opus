/**
 * Public, read-only description of "what the music is doing right now".
 * Visualizers consume only this; they never touch the Web Audio API.
 */

export type HitKind = 'kick' | 'snare' | 'hat';

export interface MusicEvent {
  /** Song time in seconds. */
  time: number;
  kind: HitKind;
  /** 0..1, relative to the song's own dynamics. */
  strength: number;
}

export interface Section {
  start: number;
  end: number;
  /** Mean normalized energy of the section, 0..1. */
  energy: number;
  /** 0 calm, 1 medium, 2 intense. */
  level: 0 | 1 | 2;
  /** True if this section starts with a sudden rise of energy. */
  isDrop: boolean;
}

/** Look-ahead queries backed by the offline analysis of the whole song. */
export interface TimelineQuery {
  readonly duration: number;
  readonly bpm: number;
  readonly beats: Float32Array;
  readonly sections: readonly Section[];
  /** Next event of the given kind strictly after `t` (and before `t + horizon`). */
  nextEvent(kind: HitKind, t: number, horizon?: number, minStrength?: number): MusicEvent | null;
  /** All events of a kind within [t0, t1). Writes into `out` and returns it. */
  eventsBetween(kind: HitKind, t0: number, t1: number, out: MusicEvent[], minStrength?: number): MusicEvent[];
  /** Index of the last beat at or before t (-1 if none). */
  beatIndexAt(t: number): number;
  /** Time of the first beat strictly after t. */
  nextBeat(t: number): number;
  /** Smoothed global energy 0..1 at time t. */
  energyAt(t: number): number;
  sectionAt(t: number): Section | null;
  /** Next section boundary after t, if any. */
  nextSection(t: number): Section | null;
}

export interface Bands {
  sub: number;
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  treble: number;
}

export interface MusicFrame {
  /** Song time (seconds). */
  time: number;
  /** Wall-clock seconds since last frame (clamped). */
  dt: number;
  playing: boolean;

  // ---- continuous, smoothed, 0..1 ----
  rms: number;
  /** Loudness after automatic gain control. */
  level: number;
  bands: Bands;
  /** 64 log-spaced bands, AGC-normalized and smoothed. */
  spectrum: Float32Array;
  /** Time-domain waveform, -1..1, 512 samples. */
  waveform: Float32Array;
  /** Spectral centroid, 0 (dark) .. 1 (bright). */
  brightness: number;
  /** Positive spectral flux, normalized. */
  flux: number;

  // ---- envelopes: jump to 1 on the event and decay ----
  kickEnv: number;
  snareEnv: number;
  hatEnv: number;
  beatEnv: number;

  // ---- discrete events fired this frame ----
  kick: boolean;
  snare: boolean;
  hat: boolean;
  beat: boolean;
  /** Strength of the strongest hit fired this frame. */
  hitStrength: number;
  /** Sudden rise of energy (drop / big entrance). */
  drop: boolean;
  /** Structural change detected (new section). */
  sectionChange: boolean;

  // ---- rhythm ----
  bpm: number;
  /** 0..1 position within the current beat. */
  beatPhase: number;
  /** Beats counted since song start. */
  beatIndex: number;
  /** 0..1 position within the current bar (4 beats). */
  barPhase: number;

  // ---- dynamics ----
  /** Slow energy (~6 s). */
  energy: number;
  /** Short-term musical intensity (~1 s), 0..1. */
  intensity: number;
  /** d(intensity)/dt smoothed: >0 building, <0 releasing. */
  trend: number;
  sectionIndex: number;
  /** 0 calm, 1 medium, 2 intense. */
  sectionLevel: number;

  /** Present once the offline analysis of the song is ready. */
  timeline: TimelineQuery | null;
  /** Increments every time a new song is loaded. */
  songId: number;
  songTitle: string;
}

export function createBands(): Bands {
  return { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 };
}

export function createFrame(): MusicFrame {
  return {
    time: 0, dt: 0, playing: false,
    rms: 0, level: 0, bands: createBands(),
    spectrum: new Float32Array(64), waveform: new Float32Array(512),
    brightness: 0, flux: 0,
    kickEnv: 0, snareEnv: 0, hatEnv: 0, beatEnv: 0,
    kick: false, snare: false, hat: false, beat: false, hitStrength: 0,
    drop: false, sectionChange: false,
    bpm: 120, beatPhase: 0, beatIndex: 0, barPhase: 0,
    energy: 0, intensity: 0, trend: 0, sectionIndex: 0, sectionLevel: 0,
    timeline: null,
    songId: 0,
    songTitle: '',
  };
}
