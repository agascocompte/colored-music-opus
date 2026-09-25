import { OnsetDetector } from './OnsetDetector';
import type { Bands } from './types';

/**
 * Reads the AnalyserNode once per frame and extracts continuous features.
 * Every output is AGC-normalized (running peak with slow decay) and smoothed
 * with separate attack/release so values move fast up and fall gracefully.
 */
export class RealtimeAnalyzer {
  static readonly BANDS = 64;

  readonly spectrum = new Float32Array(RealtimeAnalyzer.BANDS);
  readonly waveform = new Float32Array(512);
  readonly bands: Bands = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 };
  rms = 0;
  level = 0;
  brightness = 0;
  flux = 0;
  /** Onsets detected this frame (strength, 0 = none). */
  kick = 0;
  snare = 0;
  hat = 0;

  private analyser: AnalyserNode | null = null;
  private freqDb = new Float32Array(1024);
  private mag = new Float32Array(1024);
  private logMag = new Float32Array(1024);
  private prevLog = new Float32Array(1024);
  private time = new Float32Array(2048);
  private bandLo = new Int32Array(RealtimeAnalyzer.BANDS);
  private bandHi = new Int32Array(RealtimeAnalyzer.BANDS);
  private bandPeak = new Float32Array(RealtimeAnalyzer.BANDS).fill(1e-3);
  private namedRanges: Record<keyof Bands, [number, number]> = {
    sub: [0, 0], bass: [0, 0], lowMid: [0, 0], mid: [0, 0], highMid: [0, 0], treble: [0, 0],
  };
  private namedPeak: Record<keyof Bands, number> = { sub: 1e-3, bass: 1e-3, lowMid: 1e-3, mid: 1e-3, highMid: 1e-3, treble: 1e-3 };
  private rmsPeak = 1e-3;
  private fluxPeak = 1e-3;
  private kickRange: [number, number] = [1, 3];
  private snareRanges: [number, number][] = [[23, 46], [46, 93], [93, 162]];
  private bodyRange: [number, number] = [3, 7];
  private hatRange: [number, number] = [160, 260];
  private kickDet = new OnsetDetector({ k: 2.0, cooldown: 0.16, tau: 0.6, floor: 0.01 });
  private snareDet = new OnsetDetector({ k: 2.0, cooldown: 0.14, tau: 0.6, floor: 0.01 });
  private hatDet = new OnsetDetector({ k: 1.5, cooldown: 0.07, tau: 0.4, floor: 0.008 });

  attach(analyser: AnalyserNode): void {
    if (this.analyser === analyser) return;
    this.analyser = analyser;
    const bins = analyser.frequencyBinCount;
    this.freqDb = new Float32Array(bins);
    this.mag = new Float32Array(bins);
    this.logMag = new Float32Array(bins);
    this.prevLog = new Float32Array(bins);
    this.time = new Float32Array(analyser.fftSize);
    const sr = analyser.context.sampleRate;
    const binHz = sr / analyser.fftSize;
    const toBin = (f: number) => Math.max(1, Math.min(bins - 1, Math.round(f / binHz)));

    // 64 log-spaced bands between 30 Hz and 16 kHz, at least one bin wide.
    const fMin = 30, fMax = 16000;
    let prevHi = 0;
    for (let i = 0; i < RealtimeAnalyzer.BANDS; i++) {
      const f0 = fMin * Math.pow(fMax / fMin, i / RealtimeAnalyzer.BANDS);
      const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / RealtimeAnalyzer.BANDS);
      const lo = Math.max(toBin(f0), prevHi);
      const hi = Math.max(lo, toBin(f1) - 1);
      this.bandLo[i] = lo;
      this.bandHi[i] = hi;
      prevHi = Math.min(hi + 1, bins - 1);
    }
    const r = (a: number, b: number): [number, number] => [toBin(a), Math.max(toBin(a), toBin(b))];
    this.namedRanges = {
      sub: r(20, 60), bass: r(60, 250), lowMid: r(250, 500),
      mid: r(500, 2000), highMid: r(2000, 6000), treble: r(6000, 16000),
    };
    this.kickRange = r(35, 130);
    this.bodyRange = r(150, 320);
    this.snareRanges = [r(1000, 2000), r(2000, 4000), r(4000, 7000)];
    this.hatRange = r(7000, 12000);
  }

  resetDetectors(): void {
    this.kickDet.reset();
    this.snareDet.reset();
    this.hatDet.reset();
  }

  /** Call once per frame. `t` is the song time, `dt` the frame delta. */
  analyze(t: number, dt: number, active: boolean): void {
    const an = this.analyser;
    this.kick = this.snare = this.hat = 0;
    if (!an || !active) {
      this.decayAll(dt);
      return;
    }
    an.getFloatFrequencyData(this.freqDb);
    an.getFloatTimeDomainData(this.time);

    // Waveform (decimated) + RMS
    let sum = 0;
    const tl = this.time.length;
    for (let i = 0; i < tl; i++) sum += this.time[i] * this.time[i];
    const step = tl / this.waveform.length;
    for (let i = 0; i < this.waveform.length; i++) this.waveform[i] = this.time[Math.floor(i * step)];
    const rmsNow = Math.sqrt(sum / tl);

    // Magnitudes, log-magnitudes and positive flux
    const bins = this.freqDb.length;
    let fluxNow = 0, centroidNum = 0, centroidDen = 0;
    for (let k = 1; k < bins; k++) {
      const db = this.freqDb[k];
      const m = db < -160 ? 0 : Math.pow(10, db / 20);
      this.mag[k] = m;
      const l = Math.log1p(1000 * m);
      this.logMag[k] = l;
      const d = l - this.prevLog[k];
      if (d > 0) fluxNow += d;
      centroidNum += k * m;
      centroidDen += m;
    }
    const bandFlux = (r: [number, number]) => {
      let s = 0;
      for (let k = r[0]; k <= r[1]; k++) { const d = this.logMag[k] - this.prevLog[k]; if (d > 0) s += d; }
      return s / (r[1] - r[0] + 1);
    };
    const kf = bandFlux(this.kickRange);
    const [s1, s2, s3] = this.snareRanges;
    const hf = bandFlux(this.hatRange);
    const sf = (Math.cbrt(bandFlux(s1) * bandFlux(s2) * bandFlux(s3)) * 0.8 + bandFlux(this.bodyRange) * 0.2);
    this.prevLog.set(this.logMag);

    this.kick = this.kickDet.push(kf, t);
    this.snare = this.snareDet.push(sf, t);
    this.hat = this.hatDet.push(hf, t);

    // AGC + attack/release smoothing
    const decay = Math.exp(-dt / 12); // peaks forget over ~12 s
    const atk = 1 - Math.exp(-dt / 0.03);
    const rel = 1 - Math.exp(-dt / 0.18);
    const follow = (cur: number, target: number) => cur + (target - cur) * (target > cur ? atk : rel);

    this.rmsPeak = Math.max(rmsNow, this.rmsPeak * decay, 0.02);
    this.rms = follow(this.rms, rmsNow);
    this.level = follow(this.level, Math.min(1, rmsNow / this.rmsPeak));

    this.fluxPeak = Math.max(fluxNow, this.fluxPeak * decay, 1);
    this.flux = follow(this.flux, Math.min(1, fluxNow / this.fluxPeak));

    const cen = centroidDen > 0 ? centroidNum / centroidDen / bins : 0;
    this.brightness = follow(this.brightness, Math.min(1, Math.sqrt(cen * 4)));

    for (let i = 0; i < RealtimeAnalyzer.BANDS; i++) {
      let s = 0;
      const lo = this.bandLo[i], hi = this.bandHi[i];
      for (let k = lo; k <= hi; k++) s += this.logMag[k];
      const v = s / (hi - lo + 1);
      // Per-band AGC with a shared floor, so tilt is flattened but silence stays dark.
      this.bandPeak[i] = Math.max(v, this.bandPeak[i] * decay, 0.35);
      const n = Math.min(1, v / this.bandPeak[i]);
      this.spectrum[i] = follow(this.spectrum[i], n * n);
    }

    for (const key of Object.keys(this.namedRanges) as (keyof Bands)[]) {
      const [lo, hi] = this.namedRanges[key];
      let s = 0;
      for (let k = lo; k <= hi; k++) s += this.mag[k] * this.mag[k];
      const v = Math.sqrt(s / (hi - lo + 1));
      this.namedPeak[key] = Math.max(v, this.namedPeak[key] * decay, 1e-3);
      this.bands[key] = follow(this.bands[key], Math.min(1, v / this.namedPeak[key]));
    }
  }

  private decayAll(dt: number): void {
    const k = Math.exp(-dt / 0.25);
    this.rms *= k;
    this.level *= k;
    this.flux *= k;
    this.brightness *= k;
    for (let i = 0; i < this.spectrum.length; i++) this.spectrum[i] *= k;
    for (let i = 0; i < this.waveform.length; i++) this.waveform[i] *= k;
    for (const key of Object.keys(this.bands) as (keyof Bands)[]) this.bands[key] *= k;
  }
}
