import { PAL } from './palette';
import { bitmap, ellipse, line } from '../common/pixel/pixel';

export type HeroState = 'idle' | 'run' | 'jump' | 'fall' | 'land' | 'attack' | 'dash' | 'hit' | 'special' | 'slam';
type Face = 'normal' | 'blink' | 'focus' | 'hurt';

/** Everything needed to draw one frame of the hero (also stored for afterimages). */
interface Pose {
  x: number; y: number;
  sx: number; sy: number;
  lean: number; bob: number; crouch: number;
  fA: [number, number]; fB: [number, number];
  arm: number; sword: boolean; swordGlow: number;
  face: Face;
  cape: number;
  tuck: boolean;
  spin: number;
}

// Hooded head, facing right. 0 ink · 9 blue · a sky · 8 navy · c mask · e eye
const HEAD: Record<Face, string[]> = {
  normal: ['...0000...', '..0aa990..', '.0a999990.', '.09999cccc', '0999cecec0', '0999cecec0', '.0899ccc0.', '..08888o..', '...0000...'],
  blink: ['...0000...', '..0aa990..', '.0a999990.', '.09999cccc', '0999ccccc0', '0999cecec0', '.0899ccc0.', '..08888o..', '...0000...'],
  focus: ['...0000...', '..0aa990..', '.0a999990.', '.099990000', '0999cecec0', '0999ccccc0', '.0899ccc0.', '..08888o..', '...0000...'],
  hurt: ['...0000...', '..0aa990..', '.0a999990.', '.09999cccc', '0999ceccc0', '0999ccecc0', '.0899ccc0.', '..08888o..', '...0000...'],
};
const HEAD_COLORS: Record<string, string> = { '0': PAL.ink, '9': PAL.blue, a: PAL.sky, '8': PAL.navy, c: PAL.white, e: PAL.ink, o: PAL.red };

const SCARF_N = 7;
const SCARF_SEG = 2.6;

export interface HeroDrive {
  x: number;
  y: number;
  /** Horizontal speed in px/s (for lean, cape and scarf). */
  speed: number;
  /** Vertical velocity in px/s (for stretch). */
  vy: number;
  onGround: boolean;
  state: HeroState;
  /** Seconds since the current state began. */
  stateT: number;
  runPhase: number;
  charge: number;
  anticipation: number;
  /** Attack timing (seconds) when state === 'attack'. */
  attackWind?: number;
  attackAir?: boolean;
}

/**
 * The hero is a puppet: the choreography decides where it is and what it does
 * on every frame (all derived from the song's beat position), and this class
 * turns that into an expressive pixel-art pose with secondary motion
 * (squash & stretch, scarf, afterimages, slash trails).
 */
export class Hero {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  speed = 0;
  state: HeroState = 'idle';
  stateT = 0;
  onGround = true;
  anticipation = 0;
  charge = 0;
  squash = 0;
  private runPhase = 0;
  private attackDur = 0.3;
  private attackWind = 0.08;
  attackAir = false;
  private blinkT = 2;
  private time = 0;
  invuln = 0;

  private scarf = new Float32Array(SCARF_N * 2);
  private scarfPrev = new Float32Array(SCARF_N * 2);
  private ghosts: Pose[] = [];
  private ghostT = 0;
  private slashT = -1;
  private slashAir = false;

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = this.vy = this.speed = 0;
    this.state = 'idle';
    this.onGround = true;
    this.charge = 0;
    this.squash = 0;
    for (let i = 0; i < SCARF_N; i++) {
      this.scarf[i * 2] = this.scarfPrev[i * 2] = x - i * SCARF_SEG;
      this.scarf[i * 2 + 1] = this.scarfPrev[i * 2 + 1] = y - 10;
    }
    this.ghosts.length = 0;
  }

  /** Squash impulse (positive = squash, negative = stretch). */
  pulse(amount: number): void {
    this.squash = amount > 0 ? Math.max(this.squash, amount) : Math.min(this.squash, amount);
  }

  /** The blade connects (called exactly on the musical hit). */
  strike(air: boolean): void {
    this.slashT = 0;
    this.slashAir = air;
  }

  animate(dt: number, d: HeroDrive): void {
    this.time += dt;
    this.x = d.x;
    this.y = d.y;
    this.speed = d.speed;
    this.vx = d.speed;
    this.vy = d.vy;
    this.onGround = d.onGround;
    this.state = d.state;
    this.stateT = d.stateT;
    this.runPhase = d.runPhase;
    this.charge = d.charge;
    this.anticipation = d.anticipation;
    if (d.attackWind !== undefined) {
      this.attackWind = d.attackWind;
      this.attackDur = d.attackWind + 0.24;
      this.attackAir = !!d.attackAir;
    }
    this.squash += (0 - this.squash) * (1 - Math.exp(-dt / 0.09));
    if (this.slashT >= 0) { this.slashT += dt; if (this.slashT > 0.16) this.slashT = -1; }
    this.blinkT -= dt;
    if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 3;
    this.updateScarf(dt);
    this.ghostT -= dt;
    if ((this.state === 'dash' || this.state === 'special') && this.ghostT <= 0) {
      this.ghostT = 0.03;
      this.ghosts.push(this.pose());
      if (this.ghosts.length > 6) this.ghosts.shift();
    } else if (this.state !== 'dash' && this.state !== 'special' && this.ghosts.length && this.ghostT <= -0.05) {
      this.ghosts.shift();
      this.ghostT = 0;
    }
  }

  private updateScarf(dt: number): void {
    const p = this.pose();
    const ax = p.x + p.lean * 0.5 - 1;
    const ay = p.y - 10 * p.sy - p.crouch + p.bob - 1;
    const s = this.scarf, q = this.scarfPrev;
    s[0] = ax; s[1] = ay;
    q[0] = ax; q[1] = ay;
    const wind = -(Math.abs(this.vx) * 0.9 + 25);
    const flutter = Math.sin(this.time * 17) * 18;
    for (let i = 1; i < SCARF_N; i++) {
      const j = i * 2;
      const vx = (s[j] - q[j]) * 0.9;
      const vy = (s[j + 1] - q[j + 1]) * 0.9;
      q[j] = s[j]; q[j + 1] = s[j + 1];
      s[j] += vx + wind * dt * dt * 60;
      s[j + 1] += vy + (220 + flutter * (i / SCARF_N)) * dt * dt;
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < SCARF_N; i++) {
        const j = i * 2, k = (i - 1) * 2;
        const dx = s[j] - s[k], dy = s[j + 1] - s[k + 1];
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const diff = (d - SCARF_SEG) / d;
        if (i === 1) { s[j] -= dx * diff; s[j + 1] -= dy * diff; }
        else { s[j] -= dx * diff * 0.5; s[j + 1] -= dy * diff * 0.5; s[k] += dx * diff * 0.5; s[k + 1] += dy * diff * 0.5; }
      }
    }
  }

  // ---------- animation ----------

  private pose(): Pose {
    const st = this.state;
    const t = this.stateT;
    const pose: Pose = {
      x: this.x, y: this.y, sx: 1, sy: 1, lean: 0, bob: 0, crouch: 0,
      fA: [2, 0], fB: [-2, 0], arm: 0.5, sword: true, swordGlow: this.charge, face: 'normal', cape: 0, tuck: false, spin: 0,
    };
    const sq = this.squash + this.anticipation * 0.5;
    pose.sy = 1 - sq * 0.3;
    pose.sx = 1 + sq * 0.25;
    pose.lean = Math.min(3, Math.abs(this.speed) / 55);
    pose.cape = Math.min(3, Math.abs(this.vx) / 50);
    if (this.blinkT < 0) pose.face = 'blink';
    if (this.charge > 0.3 || st === 'attack' || st === 'special' || st === 'dash') pose.face = 'focus';

    const ph = this.runPhase;
    switch (st) {
      case 'idle': {
        pose.bob = Math.sin(this.time * 2.2) > 0.3 ? 1 : 0;
        pose.fA = [2, 0]; pose.fB = [-2, 0];
        pose.arm = 0.9 + Math.sin(this.time * 2.2) * 0.05;
        pose.lean = 0;
        break;
      }
      case 'run':
      case 'land':
      case 'slam': {
        const stride = Math.min(1.25, 0.55 + Math.abs(this.speed) / 140);
        pose.fA = [Math.sin(ph) * 4 * stride, -Math.max(0, Math.cos(ph)) * 3 * stride];
        pose.fB = [Math.sin(ph + Math.PI) * 4 * stride, -Math.max(0, Math.cos(ph + Math.PI)) * 3 * stride];
        pose.bob = Math.abs(Math.sin(ph)) > 0.7 ? -1 : 0;
        pose.arm = 0.9 - Math.sin(ph) * 0.5;
        if (st === 'land' || st === 'slam') {
          pose.fA = [3, 0]; pose.fB = [-3, 0];
          pose.crouch = st === 'slam' ? 3 : Math.round(2 * this.squash);
        }
        if (st === 'slam') { pose.arm = 1.5; pose.face = 'focus'; pose.lean = 1; }
        break;
      }
      case 'jump': {
        pose.fA = [3, -4]; pose.fB = [-2, -1];
        pose.arm = -0.6;
        break;
      }
      case 'fall': {
        const w = Math.sin(this.time * 14) * 0.5;
        pose.fA = [2, -1 + w]; pose.fB = [-3, 0];
        pose.arm = -1.5;
        break;
      }
      case 'attack': {
        const wind = this.attackWind;
        if (t < wind) {
          const k = t / wind;
          pose.arm = 0.9 + (-2.5 - 0.9) * k;
          pose.lean = -1 * k;
        } else {
          const k = Math.min(1, (t - wind) / 0.06);
          const rec = Math.max(0, (t - wind - 0.06) / 0.18);
          pose.arm = -2.5 + (1.1 + 2.5) * k - rec * 0.3;
          pose.lean = 2 * k - rec;
        }
        if (this.onGround) {
          pose.fA = [4, 0]; pose.fB = [-3, 0];
          pose.crouch = t > wind ? 1 : 0;
        } else {
          pose.fA = [3, -3]; pose.fB = [-2, -1];
          pose.spin = this.attackAir ? Math.min(1, t / this.attackDur) : 0;
        }
        break;
      }
      case 'dash': {
        pose.sx = 1.35; pose.sy = 0.82;
        pose.lean = 4;
        pose.fA = [1, -1]; pose.fB = [-5, -2];
        pose.arm = 0.1;
        pose.cape = 4;
        break;
      }
      case 'hit': {
        pose.lean = -3;
        pose.face = 'hurt';
        pose.fA = [1, -2]; pose.fB = [-3, 0];
        pose.arm = -1.8;
        break;
      }
      case 'special': {
        pose.tuck = true;
        pose.spin = (this.time * 3) % 1;
        pose.face = 'focus';
        pose.swordGlow = 1;
        break;
      }
    }
    if (!this.onGround && st !== 'special' && st !== 'dash') {
      // In the air: stretch rising, relax falling
      pose.sy = Math.max(pose.sy, 1 + Math.max(0, -this.vy) / 1400);
      pose.sx = Math.min(pose.sx, 1 - Math.max(0, -this.vy) / 2600);
    }
    return pose;
  }

  render(c: CanvasRenderingContext2D, ox: number, oy: number): void {
    // Afterimages
    for (let i = 0; i < this.ghosts.length; i++) {
      c.globalAlpha = ((i + 1) / this.ghosts.length) * 0.45;
      this.drawPose(c, this.ghosts[i], ox, oy, i % 2 ? PAL.cyan : PAL.sky);
    }
    c.globalAlpha = 1;
    const p = this.pose();
    const flicker = false;
    this.drawScarf(c, ox, oy);
    if (this.charge > 0.05 || this.state === 'special') this.drawAura(c, p, ox, oy);
    this.drawPose(c, p, ox, oy, flicker ? PAL.white : undefined);
    if (this.slashT >= 0) this.drawSlash(c, p, ox, oy);
  }

  private drawAura(c: CanvasRenderingContext2D, p: Pose, ox: number, oy: number): void {
    const k = this.state === 'special' ? 1 : this.charge;
    const cx = p.x - ox, cy = p.y - oy - 9;
    const r = 9 + Math.sin(this.time * 30) * 1 + k * 3;
    c.globalAlpha = 0.18 + k * 0.25;
    ellipse(c, cx, cy, r, r + 1, PAL.cyan);
    c.globalAlpha = 0.25 + k * 0.3;
    ellipse(c, cx, cy, r * 0.6, r * 0.7, PAL.white);
    c.globalAlpha = 1;
    // Rising sparks
    for (let i = 0; i < 4; i++) {
      const a = this.time * 5 + i * 1.7;
      const yy = cy + 8 - ((this.time * 40 + i * 9) % 22);
      c.fillStyle = i % 2 ? PAL.cyan : PAL.white;
      c.fillRect(Math.round(cx + Math.sin(a) * 7), Math.round(yy), 1, 1);
    }
  }

  private drawScarf(c: CanvasRenderingContext2D, ox: number, oy: number): void {
    const s = this.scarf;
    for (let i = 1; i < SCARF_N; i++) {
      const x0 = s[(i - 1) * 2] - ox, y0 = s[(i - 1) * 2 + 1] - oy;
      const x1 = s[i * 2] - ox, y1 = s[i * 2 + 1] - oy;
      line(c, x0, y0 + 1, x1, y1 + 1, PAL.plum, 1);
      line(c, x0, y0, x1, y1, i < 2 ? PAL.orange : PAL.red, 2);
    }
    // Tail tip
    const tx = s[(SCARF_N - 1) * 2] - ox, ty = s[(SCARF_N - 1) * 2 + 1] - oy;
    c.fillStyle = PAL.orange;
    c.fillRect(Math.round(tx) - 1, Math.round(ty), 1, 1);
  }

  private drawPose(c: CanvasRenderingContext2D, p: Pose, ox: number, oy: number, tint?: string): void {
    const fx = p.x - ox;
    const fy = p.y - oy;
    const col = (k: string) => tint ?? k;
    const hipY = fy - 5 * p.sy - p.crouch;
    const shY = fy - 10 * p.sy - p.crouch + p.bob;
    const shX = fx + p.lean * 0.5;

    if (p.tuck) {
      // Special leap: tight spinning ball with a glowing blade orbiting it.
      const cy = fy - 8;
      ellipse(c, fx, cy, 5, 5, col(PAL.ink));
      ellipse(c, fx, cy, 4, 4, col(PAL.blue));
      ellipse(c, fx - 1, cy - 1, 2, 2, col(PAL.sky));
      const a = p.spin * Math.PI * 2;
      const bx = fx + Math.cos(a) * 8, by = cy + Math.sin(a) * 8;
      line(c, fx + Math.cos(a) * 4, cy + Math.sin(a) * 4, bx, by, col(PAL.white), 1);
      c.fillStyle = col(PAL.cyan);
      c.fillRect(Math.round(bx), Math.round(by), 1, 1);
      bitmap(c, HEAD.focus, HEAD_COLORS, fx - 5 + Math.round(Math.cos(a + 1.5) * 1), cy - 9, false, tint);
      return;
    }

    // Back leg
    this.drawLeg(c, fx - 1, hipY, fx + p.fB[0], fy + p.fB[1], col(PAL.shadow), col(PAL.ink));

    // Cloak body (trapezoid, back side shaded, flutter at the hem)
    const top = Math.round(shY);
    const bottom = Math.round(hipY + 2);
    for (let yy = top; yy <= bottom; yy++) {
      const t = (yy - top) / Math.max(1, bottom - top);
      const half = (2.5 + t * 1.8) * p.sx;
      const off = p.lean * (1 - t) * 0.6;
      const back = t > 0.6 ? Math.round(p.cape * (t - 0.6) * 2.5 + (Math.sin(this.time * 20 + yy) > 0.6 ? 1 : 0) * (p.cape > 1 ? 1 : 0)) : 0;
      const x0 = Math.round(fx + off - half) - back;
      const x1 = Math.round(fx + off + half);
      c.fillStyle = col(PAL.ink);
      c.fillRect(x0 - 1, yy, x1 - x0 + 3, 1);
      c.fillStyle = col(PAL.blue);
      c.fillRect(x0, yy, x1 - x0 + 1, 1);
      c.fillStyle = col(PAL.navy);
      c.fillRect(x0, yy, Math.max(1, Math.round((x1 - x0) * 0.35)), 1);
    }
    c.fillStyle = col(PAL.ink);
    c.fillRect(Math.round(fx - 3 * p.sx), bottom + 1, Math.round(7 * p.sx), 1);
    // Belt
    c.fillStyle = col(PAL.plum);
    c.fillRect(Math.round(fx - 2 * p.sx + p.lean * 0.2), Math.round(hipY - 1), Math.round(5 * p.sx), 1);

    // Front leg
    this.drawLeg(c, fx + 1, hipY, fx + p.fA[0], fy + p.fA[1], col(PAL.ink), col(PAL.ink));

    // Head
    const hx = Math.round(shX + p.lean * 0.5 + 1);
    const hy = Math.round(shY - 4);
    bitmap(c, HEAD[p.face], HEAD_COLORS, hx - 5, hy - 5, false, tint);

    // Arm + sword
    if (p.sword) {
      const sx = shX + 1, sy = shY + 2;
      const a = p.arm;
      const hxp = sx + Math.cos(a) * 3.5, hyp = sy + Math.sin(a) * 3.5;
      line(c, sx, sy, hxp, hyp, col(PAL.navy), 1);
      const bl = 8;
      const ex = hxp + Math.cos(a) * bl, ey = hyp + Math.sin(a) * bl;
      line(c, hxp, hyp, ex, ey, col(p.swordGlow > 0.5 ? PAL.cyan : PAL.silver), 1);
      line(c, hxp + Math.cos(a) * 2, hyp + Math.sin(a) * 2, ex, ey, col(PAL.white), 1);
      // Cross-guard
      const px = -Math.sin(a), py = Math.cos(a);
      line(c, hxp - px * 1.5, hyp - py * 1.5, hxp + px * 1.5, hyp + py * 1.5, col(PAL.yellow), 1);
      if (p.swordGlow > 0.3 && !tint) {
        c.globalAlpha = p.swordGlow * 0.5;
        line(c, hxp + Math.cos(a) * 2, hyp + Math.sin(a) * 2 - 1, ex, ey - 1, PAL.cyan, 1);
        c.globalAlpha = 1;
      }
    }
  }

  private drawLeg(c: CanvasRenderingContext2D, hx: number, hy: number, fx: number, fy: number, color: string, boot: string): void {
    // Knee bends forward: midpoint pushed ahead
    const mx = (hx + fx) / 2 + 1, my = (hy + fy) / 2;
    line(c, hx, hy, mx, my, color, 1);
    line(c, mx, my, fx, fy - 1, color, 1);
    c.fillStyle = boot;
    c.fillRect(Math.round(fx) - 1, Math.round(fy) - 1, 3, 1);
  }

  private drawSlash(c: CanvasRenderingContext2D, p: Pose, ox: number, oy: number): void {
    const k = this.slashT / 0.16;
    const cx = p.x - ox + 2, cy = p.y - oy - 10 - p.crouch;
    const r0 = 11 + k * 3;
    const a0 = this.slashAir ? -Math.PI : -1.9;
    const a1 = this.slashAir ? Math.PI : 1.0;
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      if (u < k * 0.9) continue; // the arc eats itself from the start
      const a = a0 + (a1 - a0) * u;
      const thick = Math.sin(u * Math.PI) * 3 * (1 - k * 0.6);
      for (let r = 0; r < thick; r++) {
        c.fillStyle = r < 1 ? PAL.white : PAL.cyan;
        c.fillRect(Math.round(cx + Math.cos(a) * (r0 - r)), Math.round(cy + Math.sin(a) * (r0 - r) * 0.85), 1, 1);
      }
    }
  }
}
