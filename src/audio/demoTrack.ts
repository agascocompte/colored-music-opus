/**
 * A short procedurally synthesized track with a real arrangement
 * (intro → groove → breakdown → build → drop → outro) so the app can be tried
 * without a file, and so every analysis feature has something to find.
 */
const BPM = 124;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const SR = 44100;

// Section plan in bars.
const PLAN = [
  { name: 'intro', bars: 8 },
  { name: 'grooveA', bars: 8 },
  { name: 'grooveB', bars: 8 },
  { name: 'breakdown', bars: 8 },
  { name: 'build', bars: 4 },
  { name: 'drop', bars: 16 },
  { name: 'outro', bars: 4 },
] as const;

// A minor: i – VI – III – VII
const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const DEMO_TITLE = 'Demo · Neon Canopy (124 BPM)';

export async function renderDemoTrack(): Promise<{ buffer: AudioBuffer; wav: Blob }> {
  const totalBars = PLAN.reduce((a, s) => a + s.bars, 0);
  const duration = totalBars * BAR + 2;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR);

  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -14;
  master.ratio.value = 4;
  master.attack.value = 0.005;
  master.release.value = 0.15;
  master.connect(ctx.destination);

  // Shared noise buffer
  const noise = ctx.createBuffer(1, SR * 2, SR);
  const nd = noise.getChannelData(0);
  const rand = rng(7);
  for (let i = 0; i < nd.length; i++) nd[i] = rand() * 2 - 1;

  // Busses
  const drums = ctx.createGain(); drums.gain.value = 0.9; drums.connect(master);
  const music = ctx.createGain(); music.gain.value = 0.55; music.connect(master);
  // Simple stereo delay for the lead/arp
  const delay = ctx.createDelay(1); delay.delayTime.value = BEAT * 0.75;
  const fb = ctx.createGain(); fb.gain.value = 0.35;
  const delayOut = ctx.createGain(); delayOut.gain.value = 0.3;
  delay.connect(fb); fb.connect(delay); delay.connect(delayOut); delayOut.connect(master);

  const kick = (t: number, v = 1) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.1 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g); g.connect(drums);
    o.start(t); o.stop(t + 0.45);
  };

  const snare = (t: number, v = 1) => {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(bp); bp.connect(g); g.connect(drums);
    src.start(t, rand() * 1.5); src.stop(t + 0.22);
    const o = ctx.createOscillator(); const og = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    og.gain.setValueAtTime(0.5 * v, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(og); og.connect(drums); o.start(t); o.stop(t + 0.13);
  };

  const hat = (t: number, v = 1, open = false) => {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8000;
    const g = ctx.createGain();
    const len = open ? 0.22 : 0.045;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(hp); hp.connect(g); g.connect(drums);
    src.start(t, rand() * 1.5); src.stop(t + len + 0.02);
  };

  const crash = (t: number) => {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
    src.connect(hp); hp.connect(g); g.connect(drums);
    src.start(t); src.stop(t + 2);
  };

  const bass = (t: number, note: number, len: number, cutoff = 900) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(note);
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = midi(note - 12);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(cutoff, t); lp.frequency.exponentialRampToValueAtTime(120, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45, t + 0.01);
    g.gain.setValueAtTime(0.45, t + len * 0.7); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(music);
    o.start(t); o2.start(t); o.stop(t + len + 0.02); o2.stop(t + len + 0.02);
  };

  const pad = (t: number, notes: number[], len: number, v = 1, bright = 1400) => {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bright;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07 * v, t + len * 0.3);
    g.gain.setValueAtTime(0.07 * v, t + len * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    lp.connect(g); g.connect(music);
    for (const n of notes) {
      for (const det of [-9, 0, 8]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = midi(n); o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + len + 0.05);
      }
    }
  };

  const pluck = (t: number, note: number, v = 1, type: OscillatorType = 'square') => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = midi(note);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(lp); lp.connect(g); g.connect(music); g.connect(delay);
    o.start(t); o.stop(t + 0.3);
  };

  const riser = (t: number, len: number) => {
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(9000, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + len);
    src.connect(bp); bp.connect(g); g.connect(music);
    src.start(t); src.stop(t + len);
  };

  // Lead melody (drop), scale degrees over each chord.
  const LEAD = [
    [69, 72, 76, 74, 72, 69, 67, 69],
    [65, 69, 72, 74, 72, 69, 65, 64],
    [67, 72, 76, 79, 76, 74, 72, 71],
    [67, 71, 74, 76, 74, 71, 69, 67],
  ];

  let bar = 0;
  for (const sec of PLAN) {
    for (let b = 0; b < sec.bars; b++, bar++) {
      const t0 = bar * BAR + 0.05;
      const chord = CHORDS[bar % 4];
      const root = chord[0] - 24;
      const s = sec.name;
      const last = b === sec.bars - 1;

      // Pads everywhere except in the drop they get brighter.
      if (s !== 'build') pad(t0, chord, BAR, s === 'breakdown' ? 1.4 : s === 'drop' ? 1.1 : 1, s === 'drop' ? 2600 : 1300);

      for (let q = 0; q < 16; q++) {
        const t = t0 + q * BEAT / 4;
        const onBeat = q % 4 === 0;
        switch (s) {
          case 'intro':
            if (q % 2 === 0) hat(t, 0.3 + (b / 8) * 0.4);
            if (b >= 4 && onBeat && q === 0) kick(t, 0.6);
            break;
          case 'grooveA':
            if (onBeat) kick(t);
            if (q % 4 === 2) hat(t, 0.8, true); else if (q % 2 === 0) hat(t, 0.5);
            if (q % 4 === 2 || q % 4 === 3) bass(t, root, BEAT / 4, 700);
            break;
          case 'grooveB':
            if (onBeat) kick(t);
            if (q === 4 || q === 12) snare(t);
            if (q % 4 === 2) hat(t, 0.8, true); else hat(t, 0.35);
            if (q % 4 !== 0) bass(t, root + (q === 14 ? 7 : 0), BEAT / 4, 1100);
            if (q % 3 === 0) pluck(t, chord[(q / 3) % 3] + 12, 0.6);
            if (last && q >= 12) snare(t, 0.7);
            break;
          case 'breakdown':
            if (q % 2 === 0) pluck(t, chord[(q / 2) % 3] + 12 + (q >= 8 ? 12 : 0), 0.5 + b / 16, 'triangle');
            if (b >= 6 && q % 4 === 0) kick(t, 0.35);
            break;
          case 'build': {
            // Accelerating snare roll + riser.
            const div = b < 2 ? 4 : b < 3 ? 2 : 1;
            if (q % div === 0) snare(t, 0.35 + (b * 16 + q) / 64 * 0.65);
            if (onBeat) kick(t, 0.8);
            if (b === 0 && q === 0) riser(t, BAR * 4);
            if (q % 2 === 0) bass(t, root, BEAT / 4, 400 + b * 400);
            break;
          }
          case 'drop':
            if (onBeat) kick(t, 1.05);
            if (q === 4 || q === 12) snare(t, 1);
            if (q % 4 === 2) hat(t, 0.9, true); else hat(t, 0.45);
            if (q % 2 === 1 || q % 4 === 2) bass(t, root + (q === 14 ? 12 : 0), BEAT / 4, 1600);
            if (q % 2 === 0) pluck(t, LEAD[bar % 4][q / 2], 1, 'sawtooth');
            if (b === 0 && q === 0) crash(t);
            if (b === 8 && q === 0) crash(t);
            if (b % 4 === 3 && q >= 14) snare(t, 0.8);
            break;
          case 'outro':
            if (onBeat && b < 3) kick(t, 0.8 - b * 0.2);
            if (q % 2 === 0) hat(t, 0.3 - b * 0.06);
            break;
        }
      }
    }
  }

  const buffer = await ctx.startRendering();
  return { buffer, wav: encodeWav(buffer) };
}

function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const out = new ArrayBuffer(44 + len * ch * 2);
  const v = new DataView(out);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}
