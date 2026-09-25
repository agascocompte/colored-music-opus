import { FFT } from '../fft';
import { OnsetDetector } from '../OnsetDetector';

/** Raw, transferable result of analysing a whole song. */
export interface TimelineData {
  duration: number;
  bpm: number;
  beats: Float32Array;
  kickT: Float32Array; kickS: Float32Array;
  snareT: Float32Array; snareS: Float32Array;
  hatT: Float32Array; hatS: Float32Array;
  /** Normalized energy sampled at `energyRate` Hz. */
  energy: Float32Array;
  energyRate: number;
  /** Flat array: [start, end, energy, level, isDrop] * n */
  sections: Float32Array;
}

const N = 1024;
const HOP = 256;

interface BandIdx { lo: number; hi: number }

function band(fLo: number, fHi: number, sr: number): BandIdx {
  const binHz = sr / N;
  const lo = Math.max(1, Math.floor(fLo / binHz));
  const hi = Math.min(N / 2 - 1, Math.max(lo + 1, Math.ceil(fHi / binHz)));
  return { lo, hi };
}

function percentile(values: Float32Array, p: number): number {
  const sorted = Float32Array.from(values).sort();
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

function smooth(src: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(src.length);
  let acc = 0;
  let count = 0;
  for (let i = 0; i < src.length + radius; i++) {
    if (i < src.length) { acc += src[i]; count++; }
    if (i - 2 * radius - 1 >= 0) { acc -= src[i - 2 * radius - 1]; count--; }
    const c = i - radius;
    if (c >= 0 && c < src.length) out[c] = acc / count;
  }
  return out;
}

export function analyzeSong(input: Float32Array, inputRate: number, onProgress?: (p: number) => void): TimelineData {
  // ---- 1. Decimate to ~22 kHz (box filter is a crude but adequate anti-alias here) ----
  const factor = Math.max(1, Math.round(inputRate / 22050));
  const sr = inputRate / factor;
  const len = Math.floor(input.length / factor);
  const x = new Float32Array(len);
  for (let i = 0, j = 0; i < len; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += input[j++];
    x[i] = s / factor;
  }
  const duration = input.length / inputRate;
  const frameRate = sr / HOP;
  const frames = Math.max(1, Math.floor((len - N) / HOP) + 1);

  const fft = new FFT(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const logMag = new Float32Array(N / 2);
  const prevLog = new Float32Array(N / 2);

  const kickB = band(35, 130, sr);
  const bodyB = band(150, 320, sr);
  // Snare = noise burst: it must light up several bands at once (geometric mean).
  const snare1 = band(1000, 2000, sr);
  const snare2 = band(2000, 4000, sr);
  const snare3 = band(4000, 7000, sr);
  const hatB = band(7000, 11000, sr);
  // 8 log bands for structure features
  const featEdges = [30, 90, 200, 400, 800, 1600, 3200, 6400, 11000];
  const featBands = featEdges.slice(0, -1).map((f, i) => band(f, featEdges[i + 1], sr));

  const rms = new Float32Array(frames);
  const env = new Float32Array(frames); // global onset envelope
  const kickNov = new Float32Array(frames);
  const snareNov = new Float32Array(frames);
  const hatNov = new Float32Array(frames);
  const feats = new Float32Array(frames * 8);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const s = x[off + i];
      e += s * s;
      re[i] = s * fft.window[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(e / N);
    fft.transform(re, im);

    let total = 0;
    for (let k = 1; k < N / 2; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N;
      const l = Math.log1p(1000 * m);
      logMag[k] = l;
      const d = l - prevLog[k];
      if (d > 0) total += d;
    }
    env[f] = total;

    const flux = (b: BandIdx) => {
      let s = 0;
      for (let k = b.lo; k <= b.hi; k++) {
        const d = logMag[k] - prevLog[k];
        if (d > 0) s += d;
      }
      return s / (b.hi - b.lo + 1);
    };
    const kf = flux(kickB);
    const bf = flux(bodyB);
    const sf = Math.cbrt(flux(snare1) * flux(snare2) * flux(snare3));
    const hf = flux(hatB);
    kickNov[f] = kf;
    // Snare: broadband noise burst with some body, but not a pure low hit.
    snareNov[f] = sf * 0.8 + bf * 0.2;
    hatNov[f] = hf;

    for (let b = 0; b < 8; b++) {
      const fb = featBands[b];
      let s = 0;
      for (let k = fb.lo; k <= fb.hi; k++) s += logMag[k];
      feats[f * 8 + b] = s / (fb.hi - fb.lo + 1);
    }

    prevLog.set(logMag);
    if (onProgress && (f & 1023) === 0) onProgress(f / frames * 0.7);
  }

  // ---- 2. Drum hits via the shared causal onset detector ----
  const detect = (nov: Float32Array, opts: ConstructorParameters<typeof OnsetDetector>[0]) => {
    const det = new OnsetDetector(opts);
    const times: number[] = [];
    const excess: number[] = [];
    for (let f = 0; f < frames; f++) {
      const t = (f * HOP + N / 2) / sr;
      if (det.push(nov[f], t) > 0) { times.push(t); excess.push(det.lastExcess); }
    }
    // Normalize against the whole song: its typical strong hit maps to ~1.
    const ref = percentile(Float32Array.from(excess), 0.85) || 1;
    const strengths = excess.map((e) => Math.min(1, e / ref));
    return { t: Float32Array.from(times), s: Float32Array.from(strengths) };
  };
  const kickFloor = percentile(kickNov, 0.6) * 0.5 + 1e-4;
  const snareFloor = percentile(snareNov, 0.6) * 0.5 + 1e-4;
  const hatFloor = percentile(hatNov, 0.6) * 0.5 + 1e-4;
  const kicks = detect(kickNov, { k: 2.0, cooldown: 0.16, tau: 0.6, floor: kickFloor });
  const snares = detect(snareNov, { k: 2.0, cooldown: 0.14, tau: 0.6, floor: snareFloor });
  const hats = detect(hatNov, { k: 1.4, cooldown: 0.07, tau: 0.4, floor: hatFloor });
  onProgress?.(0.75);

  // ---- 3. Tempo: autocorrelation of the high-passed onset envelope ----
  const envLocal = smooth(env, Math.round(frameRate * 0.5));
  const oenv = new Float32Array(frames);
  let envStd = 0;
  for (let f = 0; f < frames; f++) {
    oenv[f] = Math.max(0, env[f] - envLocal[f]);
    envStd += oenv[f] * oenv[f];
  }
  envStd = Math.sqrt(envStd / frames) + 1e-9;
  for (let f = 0; f < frames; f++) oenv[f] /= envStd;

  const minLag = Math.floor(frameRate * 60 / 200);
  const maxLag = Math.ceil(frameRate * 60 / 60);
  let bestLag = Math.round(frameRate * 0.5);
  let bestScore = -Infinity;
  // Autocorrelation out to 4× the slowest period so every candidate can be
  // checked against its half-bar (2×) and bar (4×) multiples.
  const acLen = Math.min(frames - 1, maxLag * 4 + 4);
  const ac = new Float32Array(acLen + 2);
  for (let lag = minLag; lag <= acLen; lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += oenv[f] * oenv[f - lag];
    ac[lag] = s / (frames - lag);
  }
  const acAt = (x: number) => {
    const i = Math.round(x);
    if (i < 1 || i + 1 > acLen) return 0;
    return Math.max(ac[i - 1], ac[i], ac[i + 1]);
  };
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 * frameRate / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 1.0, 2));
    // Metrical consistency: a true beat period repeats at the half-bar and the bar.
    const score = (ac[lag] + 0.6 * acAt(lag * 2) + 0.45 * acAt(lag * 4)) * prior;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  // Parabolic refinement
  let period = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-9) period = bestLag + 0.5 * (a - c) / denom;
  }
  const bpm = 60 * frameRate / period;

  // ---- 4. Beat tracking by dynamic programming (Ellis 2007) ----
  const tightness = 100;
  const score = new Float32Array(frames);
  const back = new Int32Array(frames).fill(-1);
  const pMin = Math.round(period / 2);
  const pMax = Math.round(period * 2);
  for (let f = 0; f < frames; f++) {
    let best = 0;
    let bestPrev = -1;
    for (let p = f - pMax; p <= f - pMin; p++) {
      if (p < 0) continue;
      const r = Math.log((f - p) / period);
      const v = score[p] - tightness * r * r;
      if (v > best || bestPrev < 0) { best = v; bestPrev = p; }
    }
    score[f] = oenv[f] + Math.max(0, best);
    back[f] = best > 0 ? bestPrev : -1;
  }
  let end = frames - 1;
  let endScore = -Infinity;
  for (let f = Math.max(0, frames - Math.round(period)); f < frames; f++) {
    if (score[f] > endScore) { endScore = score[f]; end = f; }
  }
  const beatFrames: number[] = [];
  for (let f = end; f >= 0; f = back[f]) {
    beatFrames.push(f);
    if (back[f] < 0) break;
  }
  beatFrames.reverse();
  // Extrapolate the grid backwards to song start so early quiet intros still have beats.
  const beatsList: number[] = [];
  if (beatFrames.length) {
    let t0 = (beatFrames[0] * HOP + N / 2) / sr;
    const pSec = period / frameRate;
    const pre: number[] = [];
    while (t0 - pSec > 0) { t0 -= pSec; pre.push(t0); }
    pre.reverse();
    beatsList.push(...pre);
    for (const f of beatFrames) beatsList.push((f * HOP + N / 2) / sr);
    // …and forward to the end.
    let tl = beatsList[beatsList.length - 1];
    while (tl + pSec < duration) { tl += pSec; beatsList.push(tl); }
  }
  const beats = Float32Array.from(beatsList);
  onProgress?.(0.85);

  // ---- 5. Energy curve at 10 Hz, normalized to the song's own range ----
  const energyRate = 10;
  const eLen = Math.max(1, Math.ceil(duration * energyRate));
  const energyRaw = new Float32Array(eLen);
  for (let i = 0; i < eLen; i++) {
    const f0 = Math.floor(i / energyRate * frameRate);
    const f1 = Math.min(frames, Math.floor((i + 1) / energyRate * frameRate));
    let s = 0, c = 0;
    for (let f = f0; f < f1; f++) { s += rms[f] * rms[f]; c++; }
    energyRaw[i] = c ? 10 * Math.log10(s / c + 1e-10) : -100;
  }
  const lo = percentile(energyRaw, 0.05);
  const hi = percentile(energyRaw, 0.98);
  const energyNorm = new Float32Array(eLen);
  for (let i = 0; i < eLen; i++) energyNorm[i] = Math.min(1, Math.max(0, (energyRaw[i] - lo) / Math.max(1, hi - lo)));
  const energy = smooth(energyNorm, 5);

  // ---- 6. Sections via novelty on half-second feature blocks ----
  const blockSec = 0.5;
  const blocks = Math.max(1, Math.floor(duration / blockSec));
  const bf = new Float32Array(blocks * 9);
  for (let b = 0; b < blocks; b++) {
    const f0 = Math.floor(b * blockSec * frameRate);
    const f1 = Math.min(frames, Math.floor((b + 1) * blockSec * frameRate));
    const c = Math.max(1, f1 - f0);
    for (let d = 0; d < 8; d++) {
      let s = 0;
      for (let f = f0; f < f1; f++) s += feats[f * 8 + d];
      bf[b * 9 + d] = s / c;
    }
    bf[b * 9 + 8] = energy[Math.min(eLen - 1, Math.floor(b * blockSec * energyRate))] * 3;
  }
  // z-normalize each dimension
  for (let d = 0; d < 9; d++) {
    let m = 0;
    for (let b = 0; b < blocks; b++) m += bf[b * 9 + d];
    m /= blocks;
    let v = 0;
    for (let b = 0; b < blocks; b++) v += (bf[b * 9 + d] - m) ** 2;
    const sd = Math.sqrt(v / blocks) + 1e-6;
    for (let b = 0; b < blocks; b++) bf[b * 9 + d] = (bf[b * 9 + d] - m) / sd;
  }
  const W = 12; // 6 s each side
  const novelty = new Float32Array(blocks);
  for (let b = W; b < blocks - W; b++) {
    let dist = 0;
    for (let d = 0; d < 9; d++) {
      let before = 0, after = 0;
      for (let k = 1; k <= W; k++) { before += bf[(b - k) * 9 + d]; after += bf[(b + k - 1) * 9 + d]; }
      dist += ((after - before) / W) ** 2;
    }
    novelty[b] = Math.sqrt(dist);
  }
  let nm = 0, ns = 0;
  for (let b = 0; b < blocks; b++) nm += novelty[b];
  nm /= blocks;
  for (let b = 0; b < blocks; b++) ns += (novelty[b] - nm) ** 2;
  ns = Math.sqrt(ns / blocks);
  const boundaries: number[] = [0];
  const minGapBlocks = 11; // 5.5 s
  for (let b = W; b < blocks - W; b++) {
    const v = novelty[b];
    if (v < nm + 0.6 * ns) continue;
    let isMax = true;
    for (let k = -8; k <= 8 && isMax; k++) if (k && novelty[b + k] > v) isMax = false;
    if (!isMax) continue;
    let t = b * blockSec;
    if (t - boundaries[boundaries.length - 1] < minGapBlocks * blockSec) continue;
    // Snap to the nearest beat so structural events land on the grid.
    if (beats.length) {
      let bestB = t, bestD = 1e9;
      for (let i = 0; i < beats.length; i++) {
        const d = Math.abs(beats[i] - t);
        if (d < bestD) { bestD = d; bestB = beats[i]; }
      }
      if (bestD < 0.6) t = bestB;
    }
    boundaries.push(t);
  }
  // Energy jumps (drops): short-term energy after vs. before. They override nearby
  // novelty boundaries because their timing matters most for choreography.
  const dropTimes: number[] = [];
  const dropJump = new Map<number, number>();
  {
    // Low-end curve: drops are mostly the bass/kick coming back.
    const lowRaw = new Float32Array(eLen);
    for (let i = 0; i < eLen; i++) {
      const f0 = Math.floor(i / energyRate * frameRate);
      const f1 = Math.min(frames, Math.floor((i + 1) / energyRate * frameRate));
      let acc = 0, c = 0;
      for (let f = f0; f < f1; f++) { acc += feats[f * 8] + feats[f * 8 + 1]; c++; }
      lowRaw[i] = c ? acc / c : 0;
    }
    const llo = percentile(lowRaw, 0.05), lhi = percentile(lowRaw, 0.98);
    const low = smooth(lowRaw.map((v) => Math.min(1, Math.max(0, (v - llo) / Math.max(1e-6, lhi - llo)))), 3);
    const sig = new Float32Array(eLen);
    for (let i = 0; i < eLen; i++) sig[i] = 0.5 * energy[i] + 0.5 * low[i];
    const jump = new Float32Array(eLen);
    for (let i = 20; i < eLen - 10; i++) {
      let a = 0, b = 0;
      for (let k = 0; k < 10; k++) a += sig[i + k];
      for (let k = 1; k <= 20; k++) b += sig[i - k];
      jump[i] = a / 10 - b / 20;
    }
    let last = -1e9;
    for (let i = 21; i < eLen - 11; i++) {
      const v = jump[i];
      if (v < 0.1 || v < jump[i - 1] || v < jump[i + 1]) continue;
      let post = 0;
      for (let k = 0; k < 20 && i + k < eLen; k++) post += energy[i + k] / 20;
      if (post < 0.6) continue;
      let t = i / energyRate;
      if (t - last < 8) continue;
      if (beats.length) {
        let bestB = t, bestD = 1e9;
        for (let k = 0; k < beats.length; k++) { const d = Math.abs(beats[k] - t); if (d < bestD) { bestD = d; bestB = beats[k]; } }
        if (bestD < 0.4) t = bestB;
      }
      // Drops start on a big hit: among nearby strong kicks, pick the one where the
      // bass/energy step is sharpest.
      const around = (from: number, to: number) => {
        let acc = 0, c = 0;
        for (let k = Math.max(0, Math.floor(from * energyRate)); k < Math.min(eLen, Math.ceil(to * energyRate)); k++) { acc += sig[k]; c++; }
        return c ? acc / c : 0;
      };
      let bestStep = -1;
      let snapped = t;
      for (let k = 0; k < kicks.t.length; k++) {
        const kt = kicks.t[k];
        if (kt < t - 1.2 || kt > t + 0.4 || kicks.s[k] < 0.4) continue;
        let onBeat = beats.length === 0;
        for (let q = 0; q < beats.length && !onBeat; q++) if (Math.abs(beats[q] - kt) < 0.07) onBeat = true;
        if (!onBeat) continue;
        const step = around(kt, kt + 0.6) - around(kt - 0.6, kt);
        if (step > bestStep) { bestStep = step; snapped = kt; }
      }
      t = snapped;
      dropTimes.push(t);
      dropJump.set(t, v);
      last = t;
    }
  }
  for (const dt of dropTimes) {
    let replaced = false;
    for (let k = 1; k < boundaries.length; k++) {
      if (Math.abs(boundaries[k] - dt) < 4.5) { boundaries[k] = dt; replaced = true; break; }
    }
    if (!replaced && dt > 4) boundaries.push(dt);
  }
  boundaries.sort((a, b) => a - b);
  for (let k = boundaries.length - 1; k > 0; k--) if (boundaries[k] - boundaries[k - 1] < 3) boundaries.splice(k, 1);
  boundaries.push(duration);

  // Section levels are relative to the song's own dynamics (z-score of the energy
  // curve), so a loud rock song still has calm and intense parts.
  let eMean = 0, eStd = 0;
  for (let k = 0; k < eLen; k++) eMean += energy[k];
  eMean /= eLen;
  for (let k = 0; k < eLen; k++) eStd += (energy[k] - eMean) ** 2;
  eStd = Math.sqrt(eStd / eLen) + 1e-3;
  const jb = (a: number, b: number) => {
    let acc = 0, c = 0;
    for (let k = Math.max(0, a); k < Math.min(eLen, b); k++) { acc += energy[k]; c++; }
    return c ? acc / c : 0;
  };
  interface Sec { s: number; e: number; m: number; level: number; jump: number; drop: boolean }
  const secs: Sec[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const s0 = boundaries[i];
    const e0 = boundaries[i + 1];
    const i0 = Math.floor(s0 * energyRate);
    const i1 = Math.max(i0 + 1, Math.min(eLen, Math.floor(e0 * energyRate)));
    let m = 0;
    for (let k = i0; k < i1; k++) m += energy[k];
    m /= i1 - i0;
    const z = (m - eMean) / eStd;
    const level = m < 0.35 || z < -0.6 ? 0 : z > 0.3 && m > 0.55 ? 2 : 1;
    const jump = Math.max(dropJump.get(s0) ?? 0, jb(i0, i0 + 30) - jb(i0 - 30, i0));
    secs.push({ s: s0, e: e0, m, level, jump, drop: false });
  }
  // Drops: entering an intense section from a calmer one with a clear energy step.
  const cands = secs.filter((x, i) => i > 0 && x.level === 2 && secs[i - 1].level < 2 && x.jump > 0.1);
  cands.sort((x, y) => y.jump - x.jump);
  const maxDrops = Math.max(1, Math.min(5, Math.round(duration / 55)));
  for (const c of cands.slice(0, maxDrops)) c.drop = true;
  const secFlat: number[] = [];
  for (const x of secs) secFlat.push(x.s, x.e, x.m, x.level, x.drop ? 1 : 0);
  onProgress?.(1);

  return {
    duration, bpm, beats,
    kickT: kicks.t, kickS: kicks.s,
    snareT: snares.t, snareS: snares.s,
    hatT: hats.t, hatS: hats.s,
    energy, energyRate,
    sections: Float32Array.from(secFlat),
  };
}
