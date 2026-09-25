import type { MusicFrame } from '../../analysis/types';
import { DoubleTarget, Program, bindTarget, createGL, createTarget, deleteTarget, drawFullscreen, loseContext, makeCanvas, type Target } from '../common/gl';
import { TAU, clamp, damp, mulberry32 } from '../common/math';
import type { Visualizer } from '../types';

/**
 * INK — pigment dropped into a living fluid (stable-fluids on the GPU).
 *  - three nozzles orbit the centre, each fed by one band (bass / mid / treble);
 *    their orbit advances with the beat phase, so the swirl is in tempo
 *  - kicks: a ring of pigment bursts outward from the centre
 *  - snares: two jets collide from opposite sides
 *  - hats: pin-pricks of bright ink
 *  - energy: vorticity (turbulence) and how quickly old ink clears
 *  - drops: a vortex spins the whole canvas and the palette changes
 */

const VS = `#version 300 es
precision highp float;
uniform vec2 texelSize;
out vec2 vUv, vL, vR, vT, vB;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv, vL, vR, vT, vB;
out vec4 o;
`;

const SPLAT = HEAD + `
uniform sampler2D uTarget;
uniform float aspect, radius;
uniform vec3 color;
uniform vec2 point;
void main(){
  vec2 p = vUv - point;
  p.x *= aspect;
  vec3 s = exp(-dot(p, p) / radius) * color;
  o = vec4(texture(uTarget, vUv).xyz + s, 1.0);
}`;

const ADVECT = HEAD + `
uniform sampler2D uVelocity, uSource;
uniform vec2 velTexel;
uniform float dt, dissipation;
void main(){
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * velTexel;
  o = texture(uSource, coord) / (1.0 + dissipation * dt);
}`;

const DIVERGENCE = HEAD + `
uniform sampler2D uVelocity;
void main(){
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

const CURL = HEAD + `
uniform sampler2D uVelocity;
void main(){
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

const VORTICITY = HEAD + `
uniform sampler2D uVelocity, uCurl;
uniform float curl, dt;
void main(){
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 v = texture(uVelocity, vUv).xy + force * dt;
  o = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}`;

const PRESSURE = HEAD + `
uniform sampler2D uPressure, uDivergence;
void main(){
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float d = texture(uDivergence, vUv).x;
  o = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);
}`;

const GRADIENT = HEAD + `
uniform sampler2D uPressure, uVelocity;
void main(){
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 v = texture(uVelocity, vUv).xy - vec2(R - L, T - B);
  o = vec4(v, 0.0, 1.0);
}`;

const SCALE = HEAD + `
uniform sampler2D uTex;
uniform float value;
void main(){ o = value * texture(uTex, vUv); }`;

const DISPLAY = HEAD + `
uniform sampler2D uDye;
uniform vec2 dyeTexel;
uniform float flash, time;
uniform vec3 bgA, bgB;
float lum(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 c = texture(uDye, vUv).rgb;
  // Relief lighting from the pigment density gradient.
  vec2 e = dyeTexel * 1.5;
  float dx = lum(texture(uDye, vUv + vec2(e.x, 0.0)).rgb) - lum(texture(uDye, vUv - vec2(e.x, 0.0)).rgb);
  float dy = lum(texture(uDye, vUv + vec2(0.0, e.y)).rgb) - lum(texture(uDye, vUv - vec2(0.0, e.y)).rgb);
  vec3 n = normalize(vec3(-dx, -dy, 0.35));
  float diff = clamp(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-normalize(vec3(-0.4, 0.6, 0.7)), n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 24.0);
  // Soft glow: wide taps
  vec3 g = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    g += texture(uDye, vUv + vec2(cos(a), sin(a)) * dyeTexel * 14.0).rgb;
  }
  g /= 8.0;
  vec3 ink = 1.0 - exp(-c * 1.3);
  ink = max(mix(vec3(lum(ink)), ink, 1.7), 0.0);
  ink = pow(ink, vec3(1.45)) * 1.35;
  ink *= 0.72 + 0.45 * diff;
  ink += spec * 0.25 * clamp(lum(c) * 2.0, 0.0, 1.0);
  ink += (1.0 - exp(-g * 0.6)) * 0.18;
  vec2 q = vUv - 0.5;
  vec3 bg = mix(bgA, bgB, smoothstep(0.9, 0.0, length(q)));
  vec3 col = bg * (1.0 - clamp(lum(ink) * 1.5, 0.0, 1.0)) + ink;
  col += flash * vec3(1.0) * 0.35;
  col += (hash(vUv * 931.0 + time) - 0.5) * 0.015;
  o = vec4(col, 1.0);
}`;

type RGB = [number, number, number];
const PALETTES: RGB[][] = [
  [[1.0, 0.18, 0.55], [0.1, 0.75, 1.0], [1.0, 0.72, 0.15]],
  [[1.0, 0.38, 0.25], [0.1, 0.95, 0.75], [0.55, 0.3, 1.0]],
  [[0.3, 0.45, 1.0], [1.0, 0.25, 0.75], [0.85, 1.0, 0.35]],
  [[1.0, 0.55, 0.1], [0.9, 0.08, 0.25], [0.55, 0.85, 1.0]],
];

export default class InkVisualizer implements Visualizer {
  private canvas!: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private progs!: Record<'splat' | 'advect' | 'div' | 'curl' | 'vort' | 'pressure' | 'grad' | 'scale' | 'display', Program>;
  private vel: DoubleTarget | null = null;
  private dye: DoubleTarget | null = null;
  private pressure: DoubleTarget | null = null;
  private divT: Target | null = null;
  private curlT: Target | null = null;
  private w = 1;
  private h = 1;
  private simW = 1;
  private simH = 1;
  private dyeW = 1;
  private dyeH = 1;

  private rand = mulberry32(99);
  private time = 0;
  private orbit = 0;
  private palette = 0;
  private colors: RGB[] = PALETTES[0].map((c) => [...c] as RGB);
  private flash = 0;
  private swirl = 0;
  private swirlDir = 1;
  private curlStrength = 20;
  private dissipation = 0.8;
  private splats: { x: number; y: number; dx: number; dy: number; c: RGB; r: number }[] = [];

  mount(layer: HTMLElement): void {
    this.canvas = makeCanvas(layer);
    this.gl = createGL(this.canvas);
    if (!this.gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float no disponible');
    const gl = this.gl;
    const P = (fs: string) => new Program(gl, VS, fs);
    this.progs = {
      splat: P(SPLAT), advect: P(ADVECT), div: P(DIVERGENCE), curl: P(CURL), vort: P(VORTICITY),
      pressure: P(PRESSURE), grad: P(GRADIENT), scale: P(SCALE), display: P(DISPLAY),
    };
  }

  resize(width: number, height: number, dpr: number): void {
    const scale = Math.min(dpr, 1.5);
    this.w = Math.round(width * scale);
    this.h = Math.round(height * scale);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    const aspect = width / height;
    const fit = (base: number): [number, number] => aspect >= 1 ? [Math.round(base * aspect), base] : [base, Math.round(base / aspect)];
    const [sw, sh] = fit(160);
    const [dw, dh] = fit(Math.min(900, Math.round(Math.min(width, height) * scale)));
    if (sw === this.simW && sh === this.simH && dw === this.dyeW && dh === this.dyeH) return;
    this.simW = sw; this.simH = sh; this.dyeW = dw; this.dyeH = dh;
    this.freeTargets();
    const gl = this.gl;
    this.vel = new DoubleTarget(gl, sw, sh, { float: true });
    this.pressure = new DoubleTarget(gl, sw, sh, { float: true });
    this.divT = createTarget(gl, sw, sh, { float: true });
    this.curlT = createTarget(gl, sw, sh, { float: true });
    this.dye = new DoubleTarget(gl, dw, dh, { float: true });
    // Seed a little pigment so the scene is alive before music starts.
    for (let i = 0; i < 5; i++) this.queue(0.5 + (this.rand() - 0.5) * 0.4, 0.5 + (this.rand() - 0.5) * 0.4, (this.rand() - 0.5) * 600, (this.rand() - 0.5) * 600, this.colors[i % 3], 0.004, 0.25);
  }

  private queue(x: number, y: number, dx: number, dy: number, c: RGB, r: number, amount: number): void {
    if (this.splats.length > 64) return;
    this.splats.push({ x, y, dx, dy, c: [c[0] * amount, c[1] * amount, c[2] * amount], r });
  }

  update(m: MusicFrame): void {
    const dt = Math.min(m.dt, 1 / 30);
    this.time += dt;
    const aspect = this.w / this.h;
    const cx = 0.5, cy = 0.5;
    // Position helper: (angle, radius in "height units") → uv
    const at = (a: number, r: number): [number, number] => [cx + (Math.cos(a) * r) / aspect, cy + Math.sin(a) * r];

    // Orbit advances with the beat so nozzles sweep in tempo; idle drift otherwise.
    const beatsPerTurn = 16;
    this.orbit += (m.playing ? (TAU / beatsPerTurn) * (m.bpm / 60) : 0.15) * dt;

    // Continuous nozzles, one per band.
    const feeds = [m.bands.bass * 0.9 + m.bands.sub * 0.3, m.bands.mid, m.bands.highMid * 0.6 + m.bands.treble * 0.6];
    for (let i = 0; i < 3; i++) {
      const a = this.orbit + (i * TAU) / 3;
      const r = 0.23 + 0.05 * Math.sin(this.time * 0.3 + i);
      const [x, y] = at(a, r);
      const f = m.playing ? clamp(feeds[i]) : 0.12;
      const speed = 90 + 420 * f;
      // Tangent + slight inward pull: ink spirals.
      const tx = -Math.sin(a) * speed - Math.cos(a) * speed * 0.25;
      const ty = Math.cos(a) * speed - Math.sin(a) * speed * 0.25;
      this.queue(x, y, tx, ty, this.colors[i], 0.0007 + f * 0.001, (0.01 + f * f * 0.09) * (dt * 60));
    }

    if (m.kick) {
      const n = 8;
      const s = 0.5 + m.hitStrength;
      const base = this.rand() * TAU;
      for (let i = 0; i < n; i++) {
        const a = base + (i * TAU) / n;
        const [x, y] = at(a, 0.04);
        this.queue(x, y, Math.cos(a) * 1500 * s, Math.sin(a) * 1500 * s, this.colors[(i + this.palette) % 3], 0.0012, 0.22 * s);
      }
    }
    if (m.snare) {
      const a = this.rand() * TAU;
      for (const sgn of [1, -1]) {
        const [x, y] = at(a + (sgn > 0 ? 0 : Math.PI), 0.42);
        const dir = a + (sgn > 0 ? Math.PI : 0);
        this.queue(x, y, Math.cos(dir) * 2400, Math.sin(dir) * 2400, this.colors[sgn > 0 ? 1 : 2], 0.001, 0.3);
      }
    }
    if (m.hat) {
      const a = this.rand() * TAU;
      const [x, y] = at(a, 0.1 + this.rand() * 0.35);
      this.queue(x, y, 0, 0, [1, 0.95, 0.9], 0.00008, 0.6 * (0.5 + m.hatEnv * 0.5));
    }
    if (m.sectionChange) {
      this.palette = (this.palette + 1) % PALETTES.length;
    }
    if (m.drop) {
      this.flash = 1;
      this.swirl = 1;
      this.swirlDir = -this.swirlDir;
      for (let i = 0; i < 12; i++) {
        const a = (i * TAU) / 12;
        const [x, y] = at(a, 0.33);
        const t = this.swirlDir * 3000;
        this.queue(x, y, -Math.sin(a) * t, Math.cos(a) * t, this.colors[i % 3], 0.002, 0.5);
      }
    }
    this.flash = damp(this.flash, 0, 0.25, dt);
    this.swirl = damp(this.swirl, 0, 1.2, dt);
    const pal = PALETTES[this.palette];
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) this.colors[i][k] = damp(this.colors[i][k], pal[i][k], 1.0, dt);

    this.curlStrength = 5 + m.intensity * 18 + this.swirl * 20;
    this.dissipation = 0.55 + m.intensity * 1.1;

    if (this.swirl > 0.05) {
      // A slow vortex through ring splats (velocity only).
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6 + this.time;
        const [x, y] = at(a, 0.3);
        const t = this.swirlDir * 900 * this.swirl;
        this.queue(x, y, -Math.sin(a) * t, Math.cos(a) * t, [0, 0, 0], 0.01, 0);
      }
    }
    this.step(dt);
  }

  private step(dt: number): void {
    const gl = this.gl;
    const vel = this.vel!, dye = this.dye!, pres = this.pressure!;
    const p = this.progs;
    const simTexel: [number, number] = [1 / this.simW, 1 / this.simH];
    gl.disable(gl.BLEND);

    // Splats
    const aspect = this.w / this.h;
    for (const s of this.splats) {
      bindTarget(gl, vel.write);
      p.splat.use().f2('texelSize', ...simTexel).tex('uTarget', 0, vel.read.tex).f1('aspect', aspect)
        .f2('point', s.x, s.y).f3('color', s.dx, s.dy, 0).f1('radius', s.r);
      drawFullscreen(gl);
      vel.swap();
      if (s.c[0] + s.c[1] + s.c[2] > 0) {
        bindTarget(gl, dye.write);
        p.splat.use().f2('texelSize', 1 / this.dyeW, 1 / this.dyeH).tex('uTarget', 0, dye.read.tex).f3('color', s.c[0], s.c[1], s.c[2]);
        drawFullscreen(gl);
        dye.swap();
      }
    }
    this.splats.length = 0;

    // Curl + vorticity confinement
    bindTarget(gl, this.curlT);
    p.curl.use().f2('texelSize', ...simTexel).tex('uVelocity', 0, vel.read.tex);
    drawFullscreen(gl);
    bindTarget(gl, vel.write);
    p.vort.use().f2('texelSize', ...simTexel).tex('uVelocity', 0, vel.read.tex).tex('uCurl', 1, this.curlT!.tex).f1('curl', this.curlStrength).f1('dt', dt);
    drawFullscreen(gl);
    vel.swap();

    // Divergence + pressure solve
    bindTarget(gl, this.divT);
    p.div.use().f2('texelSize', ...simTexel).tex('uVelocity', 0, vel.read.tex);
    drawFullscreen(gl);
    bindTarget(gl, pres.write);
    p.scale.use().f2('texelSize', ...simTexel).tex('uTex', 0, pres.read.tex).f1('value', 0.8);
    drawFullscreen(gl);
    pres.swap();
    p.pressure.use().f2('texelSize', ...simTexel).tex('uDivergence', 1, this.divT!.tex);
    for (let i = 0; i < 20; i++) {
      bindTarget(gl, pres.write);
      p.pressure.tex('uPressure', 0, pres.read.tex);
      drawFullscreen(gl);
      pres.swap();
    }
    bindTarget(gl, vel.write);
    p.grad.use().f2('texelSize', ...simTexel).tex('uPressure', 0, pres.read.tex).tex('uVelocity', 1, vel.read.tex);
    drawFullscreen(gl);
    vel.swap();

    // Advection
    bindTarget(gl, vel.write);
    p.advect.use().f2('texelSize', ...simTexel).f2('velTexel', ...simTexel).tex('uVelocity', 0, vel.read.tex).tex('uSource', 1, vel.read.tex)
      .f1('dt', dt).f1('dissipation', 0.2);
    drawFullscreen(gl);
    vel.swap();
    bindTarget(gl, dye.write);
    p.advect.use().f2('texelSize', 1 / this.dyeW, 1 / this.dyeH).f2('velTexel', ...simTexel).tex('uVelocity', 0, vel.read.tex).tex('uSource', 1, dye.read.tex)
      .f1('dt', dt).f1('dissipation', this.dissipation);
    drawFullscreen(gl);
    dye.swap();
  }

  render(): void {
    const gl = this.gl;
    bindTarget(gl, null, this.w, this.h);
    const bgA = this.colors[1];
    this.progs.display.use().f2('texelSize', 1 / this.w, 1 / this.h).tex('uDye', 0, this.dye!.read.tex)
      .f2('dyeTexel', 1 / this.dyeW, 1 / this.dyeH).f1('flash', this.flash).f1('time', this.time % 100)
      .f3('bgA', 0.012, 0.012, 0.022).f3('bgB', 0.02 + bgA[0] * 0.035, 0.02 + bgA[1] * 0.035, 0.035 + bgA[2] * 0.05);
    drawFullscreen(gl);
  }

  private freeTargets(): void {
    const gl = this.gl;
    this.vel?.dispose(gl);
    this.dye?.dispose(gl);
    this.pressure?.dispose(gl);
    deleteTarget(gl, this.divT);
    deleteTarget(gl, this.curlT);
    this.vel = this.dye = this.pressure = null;
    this.divT = this.curlT = null;
  }

  dispose(): void {
    this.freeTargets();
    Object.values(this.progs).forEach((p) => p.dispose());
    loseContext(this.gl);
    this.canvas.remove();
  }
}
