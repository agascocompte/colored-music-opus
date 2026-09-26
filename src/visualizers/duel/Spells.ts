import { PAL } from '../common/pixel/palette';
import { ditherEllipse, ellipse, hash01, line, poly } from '../common/pixel/pixel';
import type { ElementStyle } from './wizards';

/**
 * Pixel spell effects. Everything is drawn at the game's native resolution
 * from a few layered colours of the caster's element (dark → main → light →
 * white core), so every spell reads as that wizard's magic.
 */

const R = Math.round;

/** The basic projectile, in the element's shape. */
export function drawBolt(c: CanvasRenderingContext2D, st: ElementStyle, x: number, y: number, vx: number, vy: number, t: number, big: boolean): void {
  const k = big ? 2 : 1;
  const a = Math.atan2(vy, vx);
  const pulse = Math.sin(t * 30) > 0 ? 1 : 0;
  if (big) ditherEllipse(c, x, y, 7 + pulse, 7 + pulse, st.main, Math.floor(t * 20));
  switch (st.bolt) {
    case 'flame':
      ellipse(c, x - Math.cos(a) * 2 * k, y - Math.sin(a) * 2 * k, 2 * k, 2 * k, st.dark);
      ellipse(c, x, y, 2 * k + pulse * 0.5, 2 * k, st.main);
      ellipse(c, x + Math.cos(a) * k, y + Math.sin(a) * k, k, k, st.light);
      break;
    case 'shard': {
      const L = 4 * k + 1;
      line(c, x - Math.cos(a) * L, y - Math.sin(a) * L, x, y, st.dark, 2 * k);
      line(c, x - Math.cos(a) * (L - 1), y - Math.sin(a) * (L - 1), x + Math.cos(a), y + Math.sin(a), st.main, k);
      c.fillStyle = PAL.white;
      c.fillRect(R(x + Math.cos(a)), R(y + Math.sin(a)), k, k);
      break;
    }
    case 'spark': {
      const seed = Math.floor(t * 24);
      for (let i = 0; i < 4 + k * 2; i++) {
        const ang = hash01(seed * 7 + i) * Math.PI * 2;
        const len = (2 + hash01(seed * 13 + i) * 3) * k;
        line(c, x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, i % 2 ? st.main : st.light, 1);
      }
      ellipse(c, x, y, k, k, PAL.white);
      break;
    }
    case 'leaf': {
      const spin = Math.floor(t * 16) % 4;
      c.fillStyle = PAL.ink;
      c.fillRect(R(x) - 2 * k, R(y) - k, 4 * k, 2 * k + 1);
      c.fillStyle = spin % 2 ? st.dark : st.main;
      if (spin % 2) c.fillRect(R(x) - k, R(y) - 2 * k, 2 * k, 4 * k);
      else c.fillRect(R(x) - 2 * k, R(y) - k, 4 * k, 2 * k);
      c.fillStyle = st.light;
      c.fillRect(R(x), R(y), k, k);
      break;
    }
    case 'wisp':
      ellipse(c, x - Math.cos(a) * 3 * k, y - Math.sin(a) * 3 * k + Math.sin(t * 20), k, k, st.dark);
      ellipse(c, x, y, 2 * k, 2 * k, st.main);
      ellipse(c, x, y, k, k, st.light);
      if (big) {
        c.fillStyle = PAL.ink;
        c.fillRect(R(x) - 2, R(y) - 1, 1, 2);
        c.fillRect(R(x) + 1, R(y) - 1, 1, 2);
      }
      break;
    case 'star': {
      const r = 2 * k + pulse;
      c.fillStyle = st.main;
      c.fillRect(R(x) - r, R(y), r * 2 + 1, 1);
      c.fillRect(R(x), R(y) - r, 1, r * 2 + 1);
      c.fillStyle = st.light;
      c.fillRect(R(x) - 1, R(y) - 1, 3, 3);
      c.fillStyle = PAL.white;
      c.fillRect(R(x), R(y), 1, 1);
      break;
    }
  }
}

/**
 * A channelled ray from (x0, y) to (x1, y). The element decides its edge:
 * wavy (flames, vines), jagged (lightning, void) or smooth (frost, moonlight).
 */
export function drawBeam(c: CanvasRenderingContext2D, st: ElementStyle, x0: number, x1: number, y: number, t: number, width: number): void {
  const dir = x1 >= x0 ? 1 : -1;
  const n = Math.abs(R(x1) - R(x0));
  if (n < 1) return;
  const seed = Math.floor(t * 30);
  const layers: [string, number][] = [[st.dark, 1], [st.main, 0.72], [st.light, 0.42], [PAL.white, 0.16]];
  let jag = 0;
  for (let i = 0; i <= n; i++) {
    const x = R(x0) + i * dir;
    // Taper at the source, bulge at the head
    const grow = Math.min(1, i / 6);
    let half = width * (0.55 + 0.45 * grow);
    let yo = 0;
    if (st.beam === 'wavy') half *= 0.8 + 0.25 * Math.sin(i * 0.45 - t * 22);
    else if (st.beam === 'jagged') {
      if (i % 3 === 0) jag = (hash01(seed * 31 + i) - 0.5) * width * 0.9;
      yo = jag;
      half *= 0.7 + 0.3 * hash01(seed * 17 + (i >> 2));
    } else half *= 0.92 + 0.08 * Math.sin(t * 40);
    for (const [col, f] of layers) {
      const hh = Math.max(col === PAL.white ? 0 : 0.5, half * f);
      c.fillStyle = col;
      c.fillRect(x, R(y + yo - hh), 1, Math.max(1, R(hh * 2)));
    }
  }
  // Sparkles riding the ray
  c.fillStyle = PAL.white;
  for (let k = 0; k < 6; k++) {
    const u = (hash01(k * 11.3) + t * (1.5 + hash01(k) * 2)) % 1;
    c.fillRect(R(x0 + (x1 - x0) * u), R(y + (hash01(k * 5.7 + seed) - 0.5) * width * 2.2), 1, 1);
  }
}

/** A lightning bolt from the sky; `seed` changes it every few frames. */
export function drawLightning(c: CanvasRenderingContext2D, st: ElementStyle, x: number, yTop: number, yBottom: number, seed: number, k: number): void {
  const pts: number[] = [];
  let px = x + (hash01(seed) - 0.5) * 20;
  for (let y = yTop; y < yBottom; y += 6) {
    pts.push(px, y);
    px += (hash01(seed * 3 + y) - 0.5) * 10;
    px += (x - px) * 0.25;
  }
  pts.push(x, yBottom);
  const passes: [string, number][] = [[st.dark, 5], [st.main, 3], [st.light, 2], [PAL.white, 1]];
  for (const [col, w] of passes) {
    for (let i = 2; i < pts.length; i += 2) line(c, pts[i - 2], pts[i - 1], pts[i], pts[i + 1], col, Math.max(1, R(w * k)));
  }
  // A couple of branches
  for (let b = 0; b < 2; b++) {
    const i = 2 + 2 * Math.floor(hash01(seed * 7 + b) * (pts.length / 2 - 2));
    const bx = pts[i], by = pts[i + 1];
    const ex = bx + (hash01(seed + b * 9) - 0.5) * 30, ey = by + 10 + hash01(seed * 5 + b) * 14;
    line(c, bx, by, ex, ey, st.main, 1);
  }
}

/** Something big falling from the sky with a trail: meteor, icicle, star. */
export function drawFalling(c: CanvasRenderingContext2D, st: ElementStyle, x: number, y: number, dx: number, dy: number, t: number): void {
  const a = Math.atan2(dy, dx);
  const bx = -Math.cos(a), by = -Math.sin(a);
  // Trail
  for (let i = 12; i > 0; i--) {
    const r = 5 - i * 0.35 + (Math.sin(t * 40 + i) > 0 ? 0.5 : 0);
    ellipse(c, x + bx * i * 3, y + by * i * 3, Math.max(0.5, r), Math.max(0.5, r), i > 7 ? st.dark : i > 3 ? st.main : st.light);
  }
  if (st.bolt === 'shard') {
    // Icicle: a long crystal spike
    const tipX = x + Math.cos(a) * 9, tipY = y + Math.sin(a) * 9;
    const px = -Math.sin(a) * 5, py = Math.cos(a) * 5;
    const pts = [x + bx * 8 + px, y + by * 8 + py, tipX, tipY, x + bx * 8 - px, y + by * 8 - py];
    poly(c, pts.map((v, i) => v + (i % 2 ? 1 : 0)), PAL.ink);
    poly(c, pts, st.main);
    line(c, x + bx * 6, y + by * 6, tipX, tipY, PAL.white, 1);
  } else if (st.bolt === 'star') {
    const r = 6;
    c.fillStyle = st.main;
    c.fillRect(R(x) - r, R(y) - 1, r * 2 + 1, 3);
    c.fillRect(R(x) - 1, R(y) - r, 3, r * 2 + 1);
    ellipse(c, x, y, 3, 3, st.light);
    ellipse(c, x, y, 1, 1, PAL.white);
  } else {
    ellipse(c, x, y, 6, 6, PAL.ink);
    ellipse(c, x, y, 5, 5, st.dark);
    ellipse(c, x + Math.cos(a), y + Math.sin(a), 4, 4, st.main);
    ellipse(c, x + Math.cos(a) * 2, y + Math.sin(a) * 2, 2, 2, st.light);
  }
}

/** A vertical column of energy (flame pillar, geyser of light, sunbeam). */
export function drawColumn(c: CanvasRenderingContext2D, st: ElementStyle, x: number, yTop: number, yBottom: number, width: number, t: number, flames: boolean): void {
  const layers: [string, number][] = [[st.dark, 1], [st.main, 0.7], [st.light, 0.4], [PAL.white, 0.15]];
  const seed = Math.floor(t * 24);
  for (let y = R(yTop); y <= R(yBottom); y++) {
    const u = (y - yTop) / Math.max(1, yBottom - yTop);
    let half = width * (flames ? 0.4 + 0.6 * u : 1);
    if (flames) half *= 0.75 + 0.35 * hash01(seed * 13 + (y >> 1));
    else half *= 0.9 + 0.1 * Math.sin(y * 0.5 + t * 30);
    for (const [col, f] of layers) {
      const hw = half * f;
      if (hw < 0.5 && col !== st.dark) continue;
      c.fillStyle = col;
      c.fillRect(R(x - hw), y, Math.max(1, R(hw * 2)), 1);
    }
  }
  if (flames) {
    // Tongues escaping the top
    for (let i = 0; i < 5; i++) {
      const fx = x + (hash01(seed + i * 3) - 0.5) * width * 1.6;
      const fy = yTop - hash01(seed * 2 + i) * 10;
      c.fillStyle = i % 2 ? st.main : st.light;
      c.fillRect(R(fx), R(fy), 2, 2);
    }
  }
}

/** A crown of spikes bursting out of the ground (ice, thorns, shadow claws). */
export function drawSpikes(c: CanvasRenderingContext2D, st: ElementStyle, x: number, groundY: number, k: number, seed: number): void {
  const n = 7;
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * 5;
    const hgt = (14 + hash01(seed + i * 7) * 16) * k * (1 - Math.abs(off) / 26);
    if (hgt < 1) continue;
    const lean = off * 0.35;
    const bx = x + off;
    const pts = [bx - 3, groundY + 1, bx + lean, groundY - hgt, bx + 3, groundY + 1];
    poly(c, pts.map((v, j) => v + (j % 2 ? 0 : j === 0 ? -1 : j === 4 ? 1 : 0)), PAL.ink);
    poly(c, pts, i % 2 ? st.dark : st.main);
    line(c, bx, groundY, bx + lean, groundY - hgt + 1, st.light, 1);
  }
}

/** A glyph shield in front of a blocking wizard. */
export function drawShield(c: CanvasRenderingContext2D, st: ElementStyle, x: number, y: number, face: number, k: number, t: number): void {
  const r = 11;
  const n = 26;
  for (let i = 0; i < n; i++) {
    const a = -1.25 + (i / (n - 1)) * 2.5;
    const px = x + Math.cos(a) * r * face, py = y + Math.sin(a) * r * 1.2;
    const bright = (i + Math.floor(t * 20)) % 5 === 0;
    c.globalAlpha = k * (bright ? 1 : 0.75);
    c.fillStyle = bright ? PAL.white : i % 2 ? st.main : st.light;
    c.fillRect(R(px), R(py), 1, 2);
  }
  // Hexagonal runes on the arc
  c.globalAlpha = k * 0.5;
  for (let i = 0; i < 3; i++) {
    const a = -0.8 + i * 0.8;
    const px = x + Math.cos(a) * (r - 2) * face, py = y + Math.sin(a) * (r - 2) * 1.2;
    c.fillStyle = st.light;
    c.fillRect(R(px) - 1, R(py) - 1, 3, 3);
  }
  c.globalAlpha = 1;
}

/** Rotating rune circle on the ground under a casting wizard. */
export function drawRuneCircle(c: CanvasRenderingContext2D, st: ElementStyle, x: number, y: number, r: number, t: number, k: number, pulse: number): void {
  const rr = r * (0.9 + 0.1 * pulse);
  c.globalAlpha = Math.min(1, k * (0.55 + 0.45 * pulse));
  const n = Math.max(24, R(rr * 4));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    c.fillStyle = i % 3 ? st.main : st.light;
    c.fillRect(R(x + Math.cos(a) * rr), R(y + Math.sin(a) * rr * 0.3), 1, 1);
    c.fillStyle = st.dark;
    c.fillRect(R(x + Math.cos(-a) * rr * 0.65), R(y + Math.sin(-a) * rr * 0.65 * 0.3), 1, 1);
  }
  // Glyphs orbiting
  for (let i = 0; i < 6; i++) {
    const a = t * 1.6 + (i / 6) * Math.PI * 2;
    const gx = R(x + Math.cos(a) * rr * 0.82), gy = R(y + Math.sin(a) * rr * 0.82 * 0.3);
    c.fillStyle = PAL.white;
    c.fillRect(gx, gy - 1, 1, 3);
    c.fillStyle = st.light;
    c.fillRect(gx - 1, gy, 3, 1);
  }
  c.globalAlpha = 1;
}

/** Flickering aura: pixel flames licking up around the body. */
export function drawAura(c: CanvasRenderingContext2D, st: ElementStyle, x: number, y: number, k: number, t: number): void {
  c.globalAlpha = 0.5 * k;
  ditherEllipse(c, x, y - 12, 10, 15, st.dark, Math.floor(t * 10));
  c.globalAlpha = 0.9 * k;
  const seed = Math.floor(t * 20);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const rx = 9 + hash01(seed + i) * 3, ry = 14 + hash01(seed * 3 + i) * 3;
    const fx = x + Math.cos(a) * rx, fy = y - 12 + Math.sin(a) * ry - hash01(seed * 5 + i) * 4;
    c.fillStyle = i % 3 ? st.main : st.light;
    c.fillRect(R(fx), R(fy), 1, 2);
  }
  c.globalAlpha = 1;
}
