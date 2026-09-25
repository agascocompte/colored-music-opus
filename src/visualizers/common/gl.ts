/** Tiny WebGL2 toolkit shared by the shader-based scenes. */

export function createGL(canvas: HTMLCanvasElement, opts: WebGLContextAttributes = {}): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance', ...opts });
  if (!gl) throw new Error('WebGL2 no disponible');
  return gl;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader: ' + log + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
  }
  return sh;
}

export class Program {
  readonly program: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(private readonly gl: WebGL2RenderingContext, vs: string, fs: string) {
    const p = gl.createProgram()!;
    const v = compile(gl, gl.VERTEX_SHADER, vs);
    const f = compile(gl, gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    this.program = p;
  }

  use(): this { this.gl.useProgram(this.program); return this; }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.uniforms.get(name);
    if (l === undefined) { l = this.gl.getUniformLocation(this.program, name); this.uniforms.set(name, l); }
    return l;
  }

  f1(n: string, a: number): this { this.gl.uniform1f(this.loc(n), a); return this; }
  f2(n: string, a: number, b: number): this { this.gl.uniform2f(this.loc(n), a, b); return this; }
  f3(n: string, a: number, b: number, c: number): this { this.gl.uniform3f(this.loc(n), a, b, c); return this; }
  f4(n: string, a: number, b: number, c: number, d: number): this { this.gl.uniform4f(this.loc(n), a, b, c, d); return this; }
  i1(n: string, a: number): this { this.gl.uniform1i(this.loc(n), a); return this; }
  fv(n: string, v: Float32Array): this { this.gl.uniform1fv(this.loc(n), v); return this; }
  tex(n: string, unit: number, t: WebGLTexture): this {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, t);
    this.gl.uniform1i(this.loc(n), unit);
    return this;
  }

  dispose(): void { this.gl.deleteProgram(this.program); }
}

/** Vertex shader for a single fullscreen triangle; exposes vUv in 0..1. */
export const FULLSCREEN_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function drawFullscreen(gl: WebGL2RenderingContext): void {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export function createTarget(gl: WebGL2RenderingContext, w: number, h: number, opts: { float?: boolean; linear?: boolean } = {}): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const float = opts.float ?? false;
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const filter = opts.linear === false ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | null): void {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

export class DoubleTarget {
  read: Target;
  write: Target;
  constructor(gl: WebGL2RenderingContext, w: number, h: number, opts: { float?: boolean; linear?: boolean } = {}) {
    this.read = createTarget(gl, w, h, opts);
    this.write = createTarget(gl, w, h, opts);
  }
  swap(): void { const t = this.read; this.read = this.write; this.write = t; }
  dispose(gl: WebGL2RenderingContext): void { deleteTarget(gl, this.read); deleteTarget(gl, this.write); }
}

export function bindTarget(gl: WebGL2RenderingContext, t: Target | null, w?: number, h?: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
  gl.viewport(0, 0, t ? t.w : w!, t ? t.h : h!);
}

/** Frees the context immediately instead of waiting for GC. */
export function loseContext(gl: WebGL2RenderingContext): void {
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

/** Canvas sized to its layer, with resolution scale applied. */
export function makeCanvas(layer: HTMLElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'vis-canvas';
  layer.appendChild(c);
  return c;
}
