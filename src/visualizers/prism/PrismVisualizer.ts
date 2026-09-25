import type { MusicFrame } from '../../analysis/types';
import { FULLSCREEN_VS, Program, createGL, drawFullscreen, loseContext, makeCanvas } from '../common/gl';
import { damp, lerp } from '../common/math';
import type { Visualizer } from '../types';

/**
 * PRISM — flight through a crystal cathedral.
 * The tunnel is solved analytically per pixel (polygonal cross-section), so it
 * stays cheap at full resolution. Music mapping:
 *  - energy/intensity → flight speed; kicks → forward lurch + FOV punch + rib glow
 *  - spectrum → each wall panel is an equalizer cell
 *  - snares → rings of light that race ahead down the tunnel
 *  - hats → glints in the glass; treble → chromatic dispersion
 *  - section change → new cross-section (morph) and palette; drop → white bloom
 */
const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uTime, uZ, uRoll, uFov, uSidesA, uSidesB, uMorph, uFlash, uBass, uKick, uHat, uAber, uTwist, uLevel;
uniform vec3 uColA, uColB;
uniform vec4 uWaves;
uniform float uSpec[16];

#define TAU 6.28318530718
#define PI 3.14159265359
#define SPACING 2.2

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float polyR(float a, float n){
  float seg = TAU / n;
  float l = mod(a, seg) - seg * 0.5;
  return 1.0 / cos(l);
}

float specAt(float i){
  int k = int(mod(i, 16.0));
  return uSpec[k];
}

float lineAA(float d, float w){
  float fw = fwidth(d);
  return 1.0 - smoothstep(w, w + fw * 1.5, d);
}

vec3 shade(vec3 rd){
  vec2 q = rd.xy;
  float ql = max(length(q), 1e-4);
  float a = atan(q.y, q.x) + PI;
  float r = mix(polyR(a, uSidesA), polyR(a, uSidesB), uMorph);
  float t = r / ql;
  float depth = t * rd.z;
  float z = uZ + depth;

  float n = uMorph < 0.5 ? uSidesA : uSidesB;
  float seg = TAU / n;
  float a2 = a + uTwist * z;
  float faceF = a2 / seg;
  float face = mod(floor(faceF), n);
  float fu = fract(faceF);
  float cell = floor(z / SPACING);
  float fz = fract(z / SPACING);

  // Distances (world units) to the nearest seam and rib.
  float seamD = min(fu, 1.0 - fu) * seg * r;
  float ribD = min(fz, 1.0 - fz) * SPACING;
  float seam = lineAA(seamD, 0.006);
  float rib = lineAA(ribD, 0.01 + 0.03 * uKick);
  // Lines shimmer into moire far away: fade them with distance.
  float lineFade = exp(-depth * 0.035);

  // Panel = equalizer cell; bands spread around and along the tunnel.
  float band = specAt(face * 5.0 + cell * 3.0);
  float e = pow(band, 2.4);
  float edge = min(seamD, ribD);
  float bevel = smoothstep(0.02, 0.3, edge);
  float inner = smoothstep(0.02, 0.06, edge) - smoothstep(0.06, 0.12, edge);
  vec3 tint = mix(uColA, uColB, smoothstep(0.4, 0.95, band));
  // Dark glass with a faint moving reflection
  float refl = 0.5 + 0.5 * sin(a * n * 0.5 + z * 0.35 + uTime * 0.2);
  vec3 col = uColA * (0.012 + 0.02 * refl * refl);
  col += tint * tint * e * (0.15 + 0.85 * bevel) * 0.95;
  col += tint * inner * e * 1.1;

  // Crisp structure lines
  col += mix(uColA, vec3(1.0), 0.25) * seam * (0.35 + 0.9 * uLevel) * lineFade;
  col += mix(uColA, vec3(1.0), 0.45) * rib * (0.55 + 2.2 * uKick) * lineFade;
  col += uColA * exp(-ribD * 6.0) * 0.08 * (0.3 + 3.0 * uKick);

  // Snare rings racing ahead
  for (int i = 0; i < 4; i++) {
    float w = uWaves[i];
    if (w < 0.0) continue;
    float d = abs(depth - w);
    col += uColB * exp(-d * 2.5) * (1.3 - w * 0.011) * (0.25 + rib * 2.5 + seam * 1.5);
  }

  // Glints in the glass on hats
  float h = hash(vec2(face, floor(z * 1.5)));
  float gl = step(0.9, h) * smoothstep(0.12, 0.0, abs(fu - hash(vec2(cell, face)) * 0.8 - 0.1)) * smoothstep(0.2, 0.0, abs(fract(z * 1.5) - 0.5));
  col += mix(uColB, vec3(1.0), 0.7) * gl * uHat * 2.5;

  // Depth fog towards a luminous vanishing point
  float fog = exp(-depth * 0.05);
  vec3 fogCol = uColA * 0.015 + uColB * 0.02 * uBass;
  col = mix(fogCol, col, fog);
  float core = pow(max(rd.z, 0.0), 260.0);
  float halo = pow(max(rd.z, 0.0), 30.0);
  col += mix(uColB, vec3(1.0), 0.65) * core * (0.5 + 2.2 * uBass);
  col += uColB * halo * (0.06 + 0.35 * uBass);
  return col;
}

void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float cr = cos(uRoll), sr = sin(uRoll);
  p = mat2(cr, -sr, sr, cr) * p;
  vec3 col;
  if (uAber > 0.002) {
    col.r = shade(normalize(vec3(p * uFov * (1.0 + uAber), 1.0))).r;
    col.g = shade(normalize(vec3(p * uFov, 1.0))).g;
    col.b = shade(normalize(vec3(p * uFov * (1.0 - uAber), 1.0))).b;
  } else {
    col = shade(normalize(vec3(p * uFov, 1.0)));
  }
  col += uFlash * mix(uColB, vec3(1.0), 0.7) * 0.9;
  col = 1.0 - exp(-col * 1.25);
  float vig = smoothstep(1.25, 0.25, length(p));
  col *= mix(0.55, 1.0, vig);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.018;
  fragColor = vec4(pow(max(col, 0.0), vec3(0.95)), 1.0);
}`;

const PALETTES: [number[], number[]][] = [
  [[0.35, 0.85, 1.0], [1.0, 0.3, 0.62]],   // ice / magenta
  [[0.62, 0.45, 1.0], [1.0, 0.72, 0.3]],   // violet / amber
  [[0.2, 1.0, 0.78], [1.0, 0.42, 0.42]],   // teal / coral
  [[0.6, 0.78, 1.0], [1.0, 0.86, 0.3]],    // steel / gold
  [[1.0, 0.35, 0.5], [0.4, 0.9, 1.0]],     // rose / cyan
];
const SIDES = [6, 4, 8, 5, 3, 7];

export default class PrismVisualizer implements Visualizer {
  private canvas!: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private prog!: Program;
  private w = 1;
  private h = 1;

  private z = 0;
  private speed = 5;
  private lurch = 0;
  private roll = 0;
  private rollVel = 0;
  private fov = 1.0;
  private sidesA = 6;
  private sidesB = 6;
  private morph = 1;
  private sideIdx = 0;
  private palIdx = 0;
  private colA = [...PALETTES[0][0]];
  private colB = [...PALETTES[0][1]];
  private flash = 0;
  private waves = new Float32Array([-1, -1, -1, -1]);
  private spec = new Float32Array(16);
  private time = 0;
  private twist = 0.02;
  private uniformsCache = { kick: 0, bass: 0, hat: 0, aber: 0, level: 0 };

  mount(layer: HTMLElement): void {
    this.canvas = makeCanvas(layer);
    this.gl = createGL(this.canvas);
    this.prog = new Program(this.gl, FULLSCREEN_VS, FS);
  }

  resize(width: number, height: number, dpr: number): void {
    // Keep the pixel budget bounded; the analytic tunnel upsamples gracefully.
    const scale = Math.min(dpr, Math.sqrt(2_000_000 / (width * height)));
    this.w = Math.max(1, Math.round(width * scale));
    this.h = Math.max(1, Math.round(height * scale));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
  }

  update(m: MusicFrame): void {
    const dt = m.dt;
    this.time += dt;

    // Flight: cruise speed follows intensity, kicks give a lurch forward.
    const cruise = 2.5 + m.intensity * 11 + m.sectionLevel * 1.5;
    this.speed = damp(this.speed, cruise, 1.2, dt);
    if (m.kick) this.lurch = Math.min(this.lurch + 6 * (0.5 + m.hitStrength), 10);
    this.lurch = damp(this.lurch, 0, 0.18, dt);
    this.z += (this.speed + this.lurch) * dt;

    // Camera roll: slow drift that leans with the musical trend, nudged by snares.
    if (m.snare) this.rollVel += (Math.random() < 0.5 ? -1 : 1) * 0.35;
    this.rollVel = damp(this.rollVel, 0.06 + m.trend * 0.3, 0.8, dt);
    this.roll += this.rollVel * dt;
    this.fov = damp(this.fov, 1.0 - m.kickEnv * 0.1 + m.intensity * 0.08, 0.08, dt);

    // Snare rings travel ahead of the camera.
    for (let i = 0; i < 4; i++) {
      if (this.waves[i] >= 0) {
        this.waves[i] += dt * (26 + this.speed * 2);
        if (this.waves[i] > 110) this.waves[i] = -1;
      }
    }
    if (m.snare) {
      let slot = 0;
      for (let i = 0; i < 4; i++) if (this.waves[i] < 0) { slot = i; break; } else if (this.waves[i] > this.waves[slot]) slot = i;
      this.waves[slot] = 0.5;
    }

    // Structure: a new section reshapes the tunnel and rotates the palette.
    if (m.sectionChange) {
      this.sideIdx = (this.sideIdx + 1) % SIDES.length;
      this.sidesA = this.morph > 0.5 ? this.sidesB : this.sidesA;
      this.sidesB = SIDES[this.sideIdx];
      this.morph = 0;
      this.palIdx = (this.palIdx + 1) % PALETTES.length;
      this.twist = (Math.random() - 0.5) * 0.08;
    }
    if (m.drop) this.flash = 1;
    this.flash = damp(this.flash, 0, 0.35, dt);
    this.morph = Math.min(1, this.morph + dt / 1.6);

    const [pa, pb] = PALETTES[this.palIdx];
    for (let i = 0; i < 3; i++) {
      this.colA[i] = damp(this.colA[i], pa[i], 1.5, dt);
      this.colB[i] = damp(this.colB[i], pb[i], 1.5, dt);
    }

    for (let i = 0; i < 16; i++) {
      const v = (m.spectrum[i * 4] + m.spectrum[i * 4 + 1] + m.spectrum[i * 4 + 2] + m.spectrum[i * 4 + 3]) / 4;
      this.spec[i] = damp(this.spec[i], v, 0.06, dt);
    }
    const u = this.uniformsCache;
    u.kick = m.kickEnv;
    u.bass = lerp(u.bass, m.bands.bass, 0.3);
    u.hat = m.hatEnv;
    u.aber = 0.0015 + m.bands.treble * 0.005 + m.snareEnv * 0.006;
    u.level = m.level;
  }

  render(): void {
    const gl = this.gl;
    const eased = this.morph * this.morph * (3 - 2 * this.morph);
    gl.viewport(0, 0, this.w, this.h);
    const u = this.uniformsCache;
    this.prog.use()
      .f2('uRes', this.w, this.h)
      .f1('uTime', this.time)
      .f1('uZ', this.z)
      .f1('uRoll', this.roll)
      .f1('uFov', this.fov)
      .f1('uSidesA', this.sidesA)
      .f1('uSidesB', this.sidesB)
      .f1('uMorph', eased)
      .f1('uFlash', this.flash)
      .f1('uBass', u.bass)
      .f1('uKick', u.kick)
      .f1('uHat', u.hat)
      .f1('uAber', u.aber)
      .f1('uTwist', this.twist)
      .f1('uLevel', u.level)
      .f3('uColA', this.colA[0], this.colA[1], this.colA[2])
      .f3('uColB', this.colB[0], this.colB[1], this.colB[2])
      .f4('uWaves', this.waves[0], this.waves[1], this.waves[2], this.waves[3])
      .fv('uSpec', this.spec);
    drawFullscreen(gl);
  }

  dispose(): void {
    this.prog.dispose();
    loseContext(this.gl);
    this.canvas.remove();
  }
}
