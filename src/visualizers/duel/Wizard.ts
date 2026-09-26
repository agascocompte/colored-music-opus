import { PAL } from '../common/pixel/palette';
import { bitmap, ditherEllipse, ellipse, line, poly } from '../common/pixel/pixel';
import type { WPose } from './poses';
import { ELEMENTS, type ElementStyle, type WizardDef } from './wizards';

/** Offscreen size and the feet pivot inside it. */
const W = 84, H = 84, FX = 42, FY = 70;
const CAPE_N = 5;
const CAPE_SEG = 2.4;
const GHOSTS = 6;

const SKULL = ['.bbb.', 'bebeb', 'bbbbb', '.b.b.'];

export interface WizardAnchors {
  /** Staff head (spells come out of it). */
  staff: [number, number];
  head: [number, number];
  chest: [number, number];
  hatTip: [number, number];
}

export interface DrawOpts {
  tint?: string;
  sx?: number;
  sy?: number;
  /** Ascended form 0..1: glowing trims and eyes. */
  asc?: number;
  /** Staff head glow 0..1 (charging, beat pulse). */
  glow?: number;
}

interface Ghost { cv: HTMLCanvasElement; x: number; y: number; face: 1 | -1; tilt: number; t: number }

/**
 * One wizard, drawn procedurally in the runner's pixel style: a chibi body in a
 * robe, a big hat whose tip lags behind every move (spring), a cape on a verlet
 * chain, eyes glowing under the brim, and a staff with an elemental head.
 * The body is drawn facing right into a small offscreen canvas and composited
 * with flip, tilt (knockdowns) and squash & stretch.
 */
export class WizardView {
  readonly style: ElementStyle;
  private off = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tip = [0, 0];
  private tipV = [0, 0];
  private cape = new Float32Array(CAPE_N * 2);
  private capePrev = new Float32Array(CAPE_N * 2);
  private capeInit = false;
  private px = NaN;
  private py = NaN;
  private vx = 0;
  private vy = 0;
  private lastCrouch = 0;
  private blinkT = 2;
  private time = 0;
  private ghosts: Ghost[] = [];
  private ghostT = 0;
  private ghostIdx = 0;

  constructor(readonly def: WizardDef) {
    this.style = ELEMENTS[def.element];
    this.off.width = W;
    this.off.height = H;
    this.g = this.off.getContext('2d')!;
    for (let i = 0; i < GHOSTS; i++) {
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      this.ghosts.push({ cv, x: 0, y: 0, face: 1, tilt: 0, t: -1 });
    }
  }

  /** Secondary motion: hat tip spring and cape, driven by how the body moves. */
  update(dt: number, x: number, y: number, face: 1 | -1, pose: WPose, trail: boolean): void {
    if (dt <= 0) return;
    this.time += dt;
    if (Number.isNaN(this.px)) { this.px = x; this.py = y; }
    const vx = Math.max(-600, Math.min(600, (x - this.px) / dt));
    const vy = Math.max(-600, Math.min(600, (y - this.py) / dt));
    const ax = Math.max(-4000, Math.min(4000, (vx - this.vx) / dt));
    const ay = Math.max(-4000, Math.min(4000, (vy - this.vy) / dt)) + ((pose.crouch - this.lastCrouch) / dt) * 25;
    this.px = x; this.py = y; this.vx = vx; this.vy = vy; this.lastCrouch = pose.crouch;
    // Hat tip: lags opposite to the acceleration, springs back.
    const lax = ax * face;
    const k = 170, c = 9;
    const t = this.tip, tv = this.tipV;
    tv[0] += (-k * t[0] - c * tv[0] - lax * 0.16 + Math.sin(this.time * 2.1) * 6) * dt;
    tv[1] += (-k * t[1] - c * tv[1] - ay * 0.08) * dt;
    t[0] = Math.max(-7, Math.min(7, t[0] + tv[0] * dt));
    t[1] = Math.max(-4, Math.min(5, t[1] + tv[1] * dt));
    this.updateCape(dt, vx * face, lax, pose);
    // Blink now and then
    this.blinkT -= dt;
    if (this.blinkT < -0.12) this.blinkT = 1.5 + Math.random() * 3;
    // Afterimages
    this.ghostT -= dt;
    if (trail && this.ghostT <= 0) this.ghostT = 0.035;
  }

  private shoulder(pose: WPose): [number, number] {
    return [FX + pose.lean * 0.6, FY - Math.round(13 * this.def.height) + pose.crouch];
  }

  private updateCape(dt: number, lvx: number, lax: number, pose: WPose): void {
    if (!this.def.cape) return;
    const [sx, sy] = this.shoulder(pose);
    const ax0 = sx - 2, ay0 = sy + 1;
    const s = this.cape, q = this.capePrev;
    if (!this.capeInit) {
      for (let i = 0; i < CAPE_N; i++) { s[i * 2] = q[i * 2] = ax0 - i * 0.5; s[i * 2 + 1] = q[i * 2 + 1] = ay0 + i * CAPE_SEG; }
      this.capeInit = true;
    }
    s[0] = q[0] = ax0; s[1] = q[1] = ay0;
    const wind = -Math.abs(lvx) * 0.5 - lax * 0.03 - 20 - pose.flare * 60;
    for (let i = 1; i < CAPE_N; i++) {
      const j = i * 2;
      const vx = (s[j] - q[j]) * 0.88, vy = (s[j + 1] - q[j + 1]) * 0.88;
      q[j] = s[j]; q[j + 1] = s[j + 1];
      s[j] += vx + (wind + Math.sin(this.time * 13 + i) * 25) * dt * dt;
      s[j + 1] += vy + 260 * dt * dt;
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < CAPE_N; i++) {
        const j = i * 2, k = (i - 1) * 2;
        const dx = s[j] - s[k], dy = s[j + 1] - s[k + 1];
        const d = Math.hypot(dx, dy) || 1;
        const diff = (d - CAPE_SEG) / d;
        if (i === 1) { s[j] -= dx * diff; s[j + 1] -= dy * diff; }
        else { s[j] -= dx * diff * 0.5; s[j + 1] -= dy * diff * 0.5; s[k] += dx * diff * 0.5; s[k + 1] += dy * diff * 0.5; }
      }
      // The cape never goes through the ground or in front of the body
      for (let i = 1; i < CAPE_N; i++) {
        s[i * 2 + 1] = Math.min(s[i * 2 + 1], FY - 1);
        s[i * 2] = Math.min(s[i * 2], sx + 1);
      }
    }
  }

  // ------------------------------------------------------------------ drawing

  /** Draws the body into the offscreen canvas; returns local anchors. */
  private paint(pose: WPose, o: DrawOpts): { staff: [number, number]; head: [number, number]; tip: [number, number] } {
    const g = this.g;
    const d = this.def, st = this.style;
    const asc = o.asc ?? 0;
    g.clearRect(0, 0, W, H);
    const [sx, sy] = this.shoulder(pose);
    const hem = FY - 2;
    const waist = Math.round(FY - 7 * d.height + pose.crouch * 0.5);
    const hx = sx + pose.lean * 0.4 + 0.5, hy = sy - 4;
    const trim = asc > 0.5 ? st.light : d.trim;

    // Cape (behind everything)
    if (d.cape) {
      const s = this.cape;
      for (let i = 1; i < CAPE_N; i++) line(g, s[(i - 1) * 2], s[(i - 1) * 2 + 1], s[i * 2], s[i * 2 + 1], PAL.ink, 4);
      for (let i = 1; i < CAPE_N; i++) line(g, s[(i - 1) * 2], s[(i - 1) * 2 + 1], s[i * 2], s[i * 2 + 1], i > CAPE_N - 2 ? d.robeShade : d.cape, 3);
    }

    // Back arm
    const bhx = sx + pose.bx, bhy = sy + pose.by;
    line(g, sx - 1, sy + 1, bhx, bhy, PAL.ink, 3);
    line(g, sx - 1, sy + 1, bhx, bhy, d.robeShade, 2);
    g.fillStyle = d.hand;
    g.fillRect(Math.round(bhx), Math.round(bhy), 2, 2);

    // Boots
    g.fillStyle = PAL.ink;
    const step = pose.flare > 0.9 ? 2 : 0;
    g.fillRect(FX - 4 - step, FY - 2, 3, 2);
    g.fillRect(FX + 1 + step, FY - 2, 3, 2);

    // Robe: trapezoid with an ink outline, shaded back, trims
    const flut = Math.round(Math.sin(this.time * 9) * pose.flare);
    const hb = FX - 6 - pose.flare * 3 + flut, hf = FX + 5 + pose.flare * 2;
    const robe = [sx - 3, sy, sx + 3.5, sy, hf, hem + 1, hb, hem + 1];
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) poly(g, robe.map((v, i) => v + (i % 2 ? oy : ox)), PAL.ink);
    poly(g, robe, d.robe);
    poly(g, [sx - 3, sy, sx - 1, sy, FX - 2, hem + 1, hb, hem + 1], d.robeShade);
    line(g, hb + 1, hem, hf - 1, hem, trim, 1);
    line(g, sx + 1.5, sy + 2, FX + 2, hem - 1, trim, 1);
    g.fillStyle = d.hatBand;
    g.fillRect(Math.round(sx - 2.5), waist, 6, 1);
    if (d.dots) {
      g.fillStyle = d.dots;
      for (const [dx, dy] of [[-3, -3], [1, -6], [-1, -9], [3, -2], [-4, -7]]) g.fillRect(FX + dx, hem + dy, 1, 1);
    }

    // Head: a face lost in shadow, eyes glowing
    const hood = d.hatStyle === 'hood';
    if (hood) {
      const tx = hx - 6 + this.tip[0] * 0.6, ty = hy - 9 + this.tip[1] * 0.5;
      const hoodPts = [hx - 5, hy + 4, hx - 5, hy - 2, tx, ty, hx + 1, hy - 6, hx + 5, hy - 2, hx + 5, hy + 4];
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) poly(g, hoodPts.map((v, i) => v + (i % 2 ? oy : ox)), PAL.ink);
      poly(g, hoodPts, d.hat);
      line(g, hx - 4, hy + 3, hx + 4, hy + 3, trim, 1);
      ellipse(g, hx + 1.5, hy + 0.5, 2.5, 2.5, PAL.ink);
    } else {
      ellipse(g, hx, hy + 0.5, 3.5, 3.2, PAL.ink);
    }
    if (d.beard) {
      const bp = [hx - 1, hy + 2, hx + 4, hy + 1, hx + 2.5, hy + 9, hx, hy + 6];
      poly(g, bp.map((v, i) => v + (i % 2 ? 1 : 0)), PAL.ink);
      poly(g, bp, d.beard);
    }
    // Hat
    let tip: [number, number] = [hx, hy - 6];
    if (!hood) tip = this.hat(g, hx, hy - 3, asc);

    const eyeOn = pose.eye > 0.5 || this.blinkT > 0;
    if (eyeOn) {
      const ec = asc > 0.5 || pose.eye > 0.8 ? st.light : d.eyes;
      const ex = Math.round(hx + (hood ? 1.5 : 1)), ey = Math.round(hy + 1);
      g.fillStyle = ec;
      g.fillRect(ex, ey, 1, 1);
      g.fillRect(ex + 2, ey, 1, 1);
      if (pose.eye > 0.5 || asc > 0.5) {
        // Blazing: a gleam trailing back from each eye
        g.fillStyle = st.main;
        g.fillRect(ex - 1, ey, 1, 1);
        g.fillRect(ex + 1, ey - 1, 1, 1);
      }
    }

    // Staff
    const handX = sx + pose.hx, handY = sy + pose.hy;
    const ux = Math.cos(pose.sa), uy = Math.sin(pose.sa);
    const L = 19;
    const tx = handX + ux * L * (1 - pose.grip), ty = handY + uy * L * (1 - pose.grip);
    const bx = handX - ux * L * pose.grip, by = handY - uy * L * pose.grip;
    line(g, bx, by, tx, ty, PAL.ink, 2);
    line(g, bx, by, tx, ty, d.staff, 1);
    const glow = Math.max(o.glow ?? 0, pose.eye * 0.4);
    this.staffHead(g, tx, ty, ux, uy, glow);

    // Front arm over the staff
    line(g, sx + 1, sy + 1, handX, handY, PAL.ink, 3);
    line(g, sx + 1, sy + 1, handX, handY, d.robe, 2);
    g.fillStyle = d.hand;
    g.fillRect(Math.round(handX), Math.round(handY), 2, 2);

    if (o.tint) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = o.tint;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
    return { staff: [tx, ty], head: [hx, hy], tip };
  }

  private hat(g: CanvasRenderingContext2D, cx: number, brimY: number, asc: number): [number, number] {
    const d = this.def;
    const style = d.hatStyle;
    const coneH = (style === 'crooked' ? 15 : style === 'wide' ? 10 : 12) * d.height;
    let tx = cx - 1 + this.tip[0], ty = brimY - coneH + this.tip[1];
    if (style === 'crooked') { tx -= 5; ty += 3; }
    const mx = cx + (tx - cx) * 0.3, my = brimY - coneH * 0.55 + (ty - (brimY - coneH)) * 0.3;
    const cone = [cx - 4.5, brimY, mx - 2.5, my, tx, ty, mx + 2.5, my, cx + 4.5, brimY];
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1]]) poly(g, cone.map((v, i) => v + (i % 2 ? oy : ox)), PAL.ink);
    poly(g, cone, d.hat);
    // Brim
    const bw = style === 'wide' ? 18 : 13;
    g.fillStyle = PAL.ink;
    g.fillRect(Math.round(cx - bw / 2) - 1, Math.round(brimY) - 1, bw + 2, 4);
    g.fillStyle = d.hat;
    g.fillRect(Math.round(cx - bw / 2), Math.round(brimY), bw, 2);
    // Band
    g.fillStyle = asc > 0.5 ? this.style.light : d.hatBand;
    g.fillRect(Math.round(cx - 4), Math.round(brimY) - 2, 9, 2);
    if (d.element === 'star') {
      g.fillStyle = PAL.white;
      g.fillRect(Math.round(mx), Math.round(my), 1, 1);
      g.fillRect(Math.round(cx - 2), Math.round(brimY - 5), 1, 1);
    }
    return [tx, ty];
  }

  private staffHead(g: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number, glow: number): void {
    const st = this.style;
    if (glow > 0.05) {
      const r = 2 + glow * 3;
      ditherEllipse(g, x, y, r, r, st.main, Math.floor(this.time * 12));
      if (glow > 0.5) ditherEllipse(g, x, y, r * 0.6, r * 0.6, st.light, Math.floor(this.time * 12) + 1);
    }
    switch (this.def.head) {
      case 'orb':
        ellipse(g, x, y, 2.5, 2.5, PAL.ink);
        ellipse(g, x, y, 1.8, 1.8, glow > 0.5 ? st.light : st.main);
        g.fillStyle = PAL.white;
        g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 1, 1);
        break;
      case 'crook': {
        const px = -uy, py = ux;
        const cx = x + px * 2, cy = y + py * 2;
        for (let a = 0; a < 7; a++) {
          const t = -1.2 + a * 0.75;
          g.fillStyle = PAL.ink;
          g.fillRect(Math.round(cx + Math.cos(t) * 2.5), Math.round(cy + Math.sin(t) * 2.5) - 1, 1, 2);
          g.fillStyle = this.def.staff;
          g.fillRect(Math.round(cx + Math.cos(t) * 2.5), Math.round(cy + Math.sin(t) * 2.5), 1, 1);
        }
        ellipse(g, cx, cy, 1, 1, glow > 0.5 ? st.light : st.main);
        break;
      }
      case 'fork': {
        const a = Math.atan2(uy, ux);
        for (const s of [-0.55, 0.55]) line(g, x, y, x + Math.cos(a + s) * 4, y + Math.sin(a + s) * 4, this.def.staff, 1);
        g.fillStyle = glow > 0.3 || Math.sin(this.time * 40) > 0.6 ? st.light : st.main;
        g.fillRect(Math.round(x + ux * 3), Math.round(y + uy * 3), 1, 1);
        break;
      }
      case 'leaf':
        ellipse(g, x - 1, y, 1.5, 1, PAL.green);
        ellipse(g, x + 1, y - 1, 1.5, 1, PAL.lime);
        ellipse(g, x, y + 1, 1, 1, PAL.green);
        g.fillStyle = glow > 0.3 ? st.light : '#ff9ac8';
        g.fillRect(Math.round(x), Math.round(y) - 1, 1, 1);
        break;
      case 'skull':
        bitmap(g, SKULL, { b: '#e8dcc0', e: glow > 0.3 ? st.main : PAL.ink }, x - 2, y - 2);
        break;
      case 'star': {
        const c = glow > 0.3 ? PAL.white : '#e8b33a';
        g.fillStyle = PAL.ink;
        g.fillRect(Math.round(x) - 3, Math.round(y) - 1, 7, 3);
        g.fillRect(Math.round(x) - 1, Math.round(y) - 3, 3, 7);
        g.fillStyle = c;
        g.fillRect(Math.round(x) - 2, Math.round(y), 5, 1);
        g.fillRect(Math.round(x), Math.round(y) - 2, 1, 5);
        g.fillStyle = PAL.white;
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
        break;
      }
    }
  }

  /** Composite the wizard at world feet (x, y). */
  render(c: CanvasRenderingContext2D, x: number, y: number, face: 1 | -1, pose: WPose, o: DrawOpts = {}): WizardAnchors {
    const loc = this.paint(pose, o);
    const sx = o.sx ?? 1, sy = o.sy ?? 1;
    const tilt = pose.tilt;
    // Snapshot for afterimages
    if (this.ghostT > 0.03) {
      const gh = this.ghosts[this.ghostIdx];
      this.ghostIdx = (this.ghostIdx + 1) % GHOSTS;
      const gg = gh.cv.getContext('2d')!;
      gg.clearRect(0, 0, W, H);
      gg.drawImage(this.off, 0, 0);
      gg.globalCompositeOperation = 'source-atop';
      gg.fillStyle = this.style.main;
      gg.fillRect(0, 0, W, H);
      gg.globalCompositeOperation = 'source-over';
      Object.assign(gh, { x, y, face, tilt, t: this.time });
      this.ghostT = 0;
    }
    for (const gh of this.ghosts) {
      const age = this.time - gh.t;
      if (gh.t < 0 || age > 0.2) continue;
      c.globalAlpha = 0.3 * (1 - age / 0.2);
      this.blit(c, gh.cv, gh.x, gh.y, gh.face, gh.tilt, 1, 1);
    }
    c.globalAlpha = 1;
    this.blit(c, this.off, x, y, face, tilt, sx, sy);
    const w = (lx: number, ly: number): [number, number] => {
      const rx = lx - FX, ry = ly - FY;
      const cs = Math.cos(tilt), sn = Math.sin(tilt);
      return [x + (rx * cs - ry * sn) * face * sx, y + (rx * sn + ry * cs) * sy];
    };
    return { staff: w(loc.staff[0], loc.staff[1]), head: w(loc.head[0], loc.head[1]), chest: w(FX, FY - 9), hatTip: w(loc.tip[0], loc.tip[1]) };
  }

  private blit(c: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, face: 1 | -1, tilt: number, sx: number, sy: number): void {
    c.save();
    c.translate(Math.round(x), Math.round(y));
    c.scale(face * sx, sy);
    if (tilt) c.rotate(tilt);
    c.drawImage(img, -FX, -FY);
    c.restore();
  }

  /** The hat alone (it stays behind when its wizard is defeated). */
  drawHat(c: CanvasRenderingContext2D, x: number, brimY: number, face: 1 | -1, spin: number): void {
    const g = this.g;
    g.clearRect(0, 0, W, H);
    if (this.def.hatStyle === 'hood') {
      // An empty hood, crumpled on the ground
      const cx = FX, cy = FY - 3;
      const pts = [cx - 6, cy + 2, cx - 4, cy - 3, cx - 8, cy - 7, cx + 1, cy - 5, cx + 5, cy - 1, cx + 6, cy + 2];
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) poly(g, pts.map((v, i) => v + (i % 2 ? oy : ox)), PAL.ink);
      poly(g, pts, this.def.hat);
      line(g, cx - 5, cy + 1, cx + 5, cy + 1, this.def.trim, 1);
    } else this.hat(g, FX, FY - 3, 0);
    c.save();
    c.translate(Math.round(x), Math.round(brimY));
    c.scale(face, 1);
    if (spin) c.rotate(spin);
    c.drawImage(this.off, -FX, -(FY - 3));
    c.restore();
  }
}
