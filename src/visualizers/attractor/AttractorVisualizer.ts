import type { MusicFrame } from '../../analysis/types';
import { DoubleTarget, FULLSCREEN_VS, Program, bindTarget, createGL, drawFullscreen, loseContext, makeCanvas } from '../common/gl';
import { clamp, damp, mulberry32 } from '../common/math';
import type { Visualizer } from '../types';
import { ATTRACTORS, type AttractorDef } from './attractors';

/**
 * ATTRACTOR — tens of thousands of particles riding a strange attractor.
 *  - flow speed: intensity, with kicks as bursts of acceleration
 *  - bass / mids bend the attractor's own parameters (its shape breathes)
 *  - snares: the camera swings; hats: random particles flare
 *  - drop: switch to another attractor (particles are re-mapped and flow into it)
 *  - section change: palette
 * Trails come from a feedback buffer that fades each frame.
 */
const N = 40000;

const POINT_VS = `#version 300 es
precision highp float;
in vec3 aPos;
in float aSpeed;
uniform vec3 uCenter;
uniform float uScale, uYaw, uPitch, uDist, uAspect, uSize, uHat, uPunch, uSeed;
uniform mat3 uBasis;
uniform vec3 uColA, uColB, uColC;
out vec3 vCol;
float hash(float n){ return fract(sin(n * 12.9898 + uSeed) * 43758.5453); }
void main(){
  vec3 p = uBasis * ((aPos - uCenter) * uScale);
  float cy = cos(uYaw), sy = sin(uYaw);
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  float cp = cos(uPitch), sp = sin(uPitch);
  p = vec3(p.x, cp * p.y - sp * p.z, sp * p.y + cp * p.z);
  p *= 1.0 + uPunch;
  float z = p.z + uDist;
  gl_Position = vec4(p.x * 1.9 / z / uAspect, p.y * 1.9 / z, 0.0, 1.0);
  float sparkle = step(1.0 - uHat * 0.06, hash(float(gl_VertexID / 2)));
  float t = clamp(aSpeed, 0.0, 1.6);
  vec3 c = t < 0.7 ? mix(uColA, uColB, t / 0.7) : mix(uColB, uColC, clamp((t - 0.7) / 0.9, 0.0, 1.0));
  float depthFade = clamp(1.6 - z * 0.35, 0.25, 1.0);
  vCol = c * depthFade * (0.6 + sparkle * 4.0) * uSize;
}`;

const POINT_FS = `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 o;
void main(){
  o = vec4(vCol * 0.34, 1.0);
}`;

const FADE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uPrev;
uniform float uFade;
void main(){ o = vec4(texture(uPrev, vUv).rgb * uFade, 1.0); }`;

const DISPLAY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec3 uBg;
uniform float uFlash, uTime;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  // Cheap bloom from a few wide taps
  vec2 px = 1.0 / vec2(textureSize(uTex, 0));
  vec3 b = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.047;
    b += texture(uTex, vUv + vec2(cos(a), sin(a)) * px * 6.0).rgb;
    b += texture(uTex, vUv + vec2(cos(a + 0.5), sin(a + 0.5)) * px * 16.0).rgb;
  }
  c += b / 12.0 * 0.6;
  c = 1.0 - exp(-c * 1.6);
  vec2 q = vUv - 0.5;
  vec3 bg = uBg * smoothstep(0.95, 0.0, length(q));
  vec3 col = bg + c + uFlash * 0.3;
  col += (hash(vUv * 700.0 + uTime) - 0.5) * 0.012;
  o = vec4(col, 1.0);
}`;

type RGB = [number, number, number];
const PALETTES: [RGB, RGB, RGB, RGB][] = [
  [[0.12, 0.25, 1.0], [0.7, 0.25, 1.0], [1.0, 0.75, 0.9], [0.02, 0.02, 0.07]],
  [[0.0, 0.55, 0.6], [1.0, 0.7, 0.22], [1.0, 0.97, 0.85], [0.01, 0.04, 0.05]],
  [[0.75, 0.08, 0.2], [1.0, 0.45, 0.1], [1.0, 0.95, 0.6], [0.06, 0.01, 0.02]],
  [[0.1, 0.75, 0.4], [0.2, 0.75, 1.0], [0.95, 1.0, 1.0], [0.01, 0.05, 0.04]],
];

export default class AttractorVisualizer implements Visualizer {
  private canvas!: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private points!: Program;
  private fade!: Program;
  private display!: Program;
  private vao!: WebGLVertexArrayObject;
  private posBuf!: WebGLBuffer;
  private speedBuf!: WebGLBuffer;
  private trail: DoubleTarget | null = null;
  private w = 1;
  private h = 1;
  private dpr = 1;

  private pos = new Float32Array(N * 3);
  /** Two vertices per particle: previous and current position (motion streaks). */
  private seg = new Float32Array(N * 6);
  private segSpeed = new Float32Array(N * 2);
  private speed = new Float32Array(N);
  private rand = mulberry32(3);
  private def: AttractorDef = ATTRACTORS[0];
  private defIdx = 0;
  private center: [number, number, number] = [...ATTRACTORS[0].center];
  private scale = ATTRACTORS[0].scale;
  private yaw = 0.4;
  private yawVel = 0.12;
  private pitch = 0.35;
  private dist = 2.6;
  private punch = 0;
  private flash = 0;
  private flow = 1;
  private time = 0;
  private palIdx = 0;
  private cols: RGB[] = PALETTES[0].map((c) => [...c] as RGB);
  private mods = { a: 0, b: 0, hat: 0, intensity: 0 };

  mount(layer: HTMLElement): void {
    this.canvas = makeCanvas(layer);
    const gl = (this.gl = createGL(this.canvas));
    gl.getExtension('EXT_color_buffer_float');
    this.points = new Program(gl, POINT_VS, POINT_FS);
    this.fade = new Program(gl, FULLSCREEN_VS, FADE_FS);
    this.display = new Program(gl, FULLSCREEN_VS, DISPLAY_FS);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.seg.byteLength, gl.DYNAMIC_DRAW);
    const locPos = gl.getAttribLocation(this.points.program, 'aPos');
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 0, 0);
    this.speedBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.speedBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.segSpeed.byteLength, gl.DYNAMIC_DRAW);
    const locSpeed = gl.getAttribLocation(this.points.program, 'aSpeed');
    gl.enableVertexAttribArray(locSpeed);
    gl.vertexAttribPointer(locSpeed, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    for (let i = 0; i < N; i++) this.respawn(i, false);
    // Let the particles settle onto the attractor before the first frame.
    for (let k = 0; k < 700; k++) this.def.step(this.pos, this.speed, N, this.def.dt, 0.5, 0.5);
    for (let i = 0; i < N * 3; i++) this.seg[Math.floor(i / 3) * 6 + (i % 3)] = this.pos[i];
  }

  /** Respawn on the attractor (copy of a random sibling) or, initially, in a cloud. */
  private respawn(i: number, onAttractor = true): void {
    const d = this.def;
    if (onAttractor) {
      const k = Math.floor(this.rand() * N) * 3;
      const jitter = 0.06 / d.scale;
      if (Number.isFinite(this.pos[k] + this.pos[k + 1] + this.pos[k + 2])) {
        this.pos[i * 3] = this.pos[k] + (this.rand() - 0.5) * jitter;
        this.pos[i * 3 + 1] = this.pos[k + 1] + (this.rand() - 0.5) * jitter;
        this.pos[i * 3 + 2] = this.pos[k + 2] + (this.rand() - 0.5) * jitter;
        return;
      }
    }
    const r = 1.2 / d.scale;
    this.pos[i * 3] = d.center[0] + (this.rand() - 0.5) * r;
    this.pos[i * 3 + 1] = d.center[1] + (this.rand() - 0.5) * r;
    this.pos[i * 3 + 2] = d.center[2] + (this.rand() - 0.5) * r;
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = Math.min(dpr, 1.5);
    this.w = Math.round(width * this.dpr);
    this.h = Math.round(height * this.dpr);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.trail?.dispose(this.gl);
    this.trail = new DoubleTarget(this.gl, this.w, this.h, { float: true });
  }

  private switchTo(idx: number): void {
    const old = this.def;
    const next = ATTRACTORS[idx];
    // Re-map positions from the old space to the new one so the swarm flows across.
    const k = old.scale / next.scale;
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      this.pos[j] = (this.pos[j] - old.center[0]) * k * 0.6 + next.center[0];
      this.pos[j + 1] = (this.pos[j + 1] - old.center[1]) * k * 0.6 + next.center[1];
      this.pos[j + 2] = (this.pos[j + 2] - old.center[2]) * k * 0.6 + next.center[2];
    }
    this.def = next;
    this.defIdx = idx;
  }

  update(m: MusicFrame): void {
    const dt = m.dt;
    this.time += dt;
    if (m.drop) {
      this.switchTo((this.defIdx + 1) % ATTRACTORS.length);
      this.flash = 1;
    }
    if (m.sectionChange) this.palIdx = (this.palIdx + 1) % PALETTES.length;

    // Flow speed
    const targetFlow = m.playing ? 0.35 + m.intensity * 1.4 : 0.25;
    this.flow = damp(this.flow, targetFlow, 0.8, dt);
    const burst = m.kickEnv * 1.6;
    const mult = (this.flow + burst) * dt * 60;
    this.mods.a = damp(this.mods.a, m.bands.bass, 0.3, dt);
    this.mods.b = damp(this.mods.b, m.bands.mid, 0.3, dt);
    const d = this.def;
    for (let i = 0; i < N; i++) {
      const j = i * 3, q = i * 6;
      this.seg[q] = this.pos[j]; this.seg[q + 1] = this.pos[j + 1]; this.seg[q + 2] = this.pos[j + 2];
    }
    const steps = Math.max(1, Math.min(4, Math.ceil(mult / 1.5)));
    for (let s = 0; s < steps; s++) d.step(this.pos, this.speed, N, (d.dt * mult) / steps, this.mods.a, this.mods.b);

    // Normalize speed & recycle escaped particles (and a trickle for coverage).
    const inv = 1 / d.speedRef;
    const lim = 3.5 / d.scale;
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      const x = this.pos[j] - d.center[0], y = this.pos[j + 1] - d.center[1], z = this.pos[j + 2] - d.center[2];
      const q = i * 6;
      if (!(Math.abs(x) < lim && Math.abs(y) < lim && Math.abs(z) < lim) || this.rand() < 0.0015) {
        this.respawn(i);
        this.seg[q] = this.pos[j]; this.seg[q + 1] = this.pos[j + 1]; this.seg[q + 2] = this.pos[j + 2];
      }
      this.seg[q + 3] = this.pos[j]; this.seg[q + 4] = this.pos[j + 1]; this.seg[q + 5] = this.pos[j + 2];
      const sp = this.speed[i] * inv;
      this.segSpeed[i * 2] = sp; this.segSpeed[i * 2 + 1] = sp;
    }

    // Display space glides to the current attractor.
    for (let k = 0; k < 3; k++) this.center[k] = damp(this.center[k], d.center[k], 0.9, dt);
    this.scale = damp(this.scale, d.scale, 0.9, dt);

    // Camera
    if (m.snare) this.yawVel += (this.rand() < 0.5 ? -1 : 1) * 0.5 * (0.5 + m.hitStrength);
    this.yawVel = damp(this.yawVel, 0.1 + m.intensity * 0.15, 0.9, dt);
    this.yaw += this.yawVel * dt;
    this.pitch = 0.3 + Math.sin(this.time * 0.13) * 0.35;
    this.dist = damp(this.dist, 2.7 - m.intensity * 0.4, 1.5, dt);
    this.punch = damp(this.punch, m.kickEnv * 0.06, 0.05, dt);
    this.flash = damp(this.flash, 0, 0.3, dt);
    this.mods.hat = m.hatEnv;
    this.mods.intensity = m.intensity;

    const pal = PALETTES[this.palIdx];
    for (let i = 0; i < 4; i++) for (let c = 0; c < 3; c++) this.cols[i][c] = damp(this.cols[i][c], pal[i][c], 1.2, dt);
  }

  render(): void {
    const gl = this.gl;
    const tr = this.trail!;
    // 1) fade previous trails into the write target
    gl.disable(gl.BLEND);
    bindTarget(gl, tr.write);
    const fade = clamp(0.9 - this.mods.intensity * 0.12 + (1 - this.flow) * 0.05, 0.7, 0.94);
    this.fade.use().tex('uPrev', 0, tr.read.tex).f1('uFade', fade);
    drawFullscreen(gl);
    // 2) splat particles additively
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.seg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.speedBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.segSpeed);
    const [ca, cb, cc] = this.cols;
    const b = this.def.basis;
    this.points.use()
      .f3('uCenter', this.center[0], this.center[1], this.center[2])
      .f1('uScale', this.scale).f1('uYaw', this.yaw).f1('uPitch', this.pitch).f1('uDist', this.dist)
      .f1('uAspect', this.w / this.h).f1('uSize', 1)
      .f1('uHat', this.mods.hat).f1('uPunch', this.punch).f1('uSeed', Math.floor(this.time * 8))
      .f3('uColA', ca[0], ca[1], ca[2]).f3('uColB', cb[0], cb[1], cb[2]).f3('uColC', cc[0], cc[1], cc[2]);
    gl.uniformMatrix3fv(this.points.loc('uBasis'), true, b);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINES, 0, N * 2);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    tr.swap();
    // 3) present
    bindTarget(gl, null, this.w, this.h);
    const bg = this.cols[3];
    this.display.use().tex('uTex', 0, tr.read.tex).f3('uBg', bg[0], bg[1], bg[2]).f1('uFlash', this.flash).f1('uTime', this.time % 50);
    drawFullscreen(gl);
  }

  dispose(): void {
    const gl = this.gl;
    this.trail?.dispose(gl);
    gl.deleteBuffer(this.posBuf);
    gl.deleteBuffer(this.speedBuf);
    gl.deleteVertexArray(this.vao);
    this.points.dispose();
    this.fade.dispose();
    this.display.dispose();
    loseContext(gl);
    this.canvas.remove();
  }
}
