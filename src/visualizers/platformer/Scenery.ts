import { mulberry32 } from '../common/math';
import { MOODS, PAL, hexToRgb, type Mood, type MoodName } from './palette';
import { ellipse, hash01, line } from '../common/pixel/pixel';
import { NONE, TILE, type Biome, type Column, type World } from './World';

const LAYER_W = 512;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Silhouette masks for the parallax layers (white on transparent), tinted per mood. */
function buildMask(kind: 'far' | 'mid' | 'near', seed: number): HTMLCanvasElement {
  const h = kind === 'far' ? 120 : kind === 'mid' ? 110 : 90;
  const c = canvas(LAYER_W, h);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  const rnd = mulberry32(seed);
  // Periodic ridge made of a few sine harmonics so the strip tiles seamlessly.
  const harmonics = Array.from({ length: 5 }, (_, i) => ({ k: (i + 1) * (kind === 'far' ? 1 : 2), a: (0.3 + rnd()) / (i + 1), p: rnd() * Math.PI * 2 }));
  // Normalize so the ridge always stays inside the strip (no holes).
  const norm = harmonics.reduce((acc, hm) => acc + hm.a, 0);
  for (const hm of harmonics) hm.a /= norm;
  const base = kind === 'far' ? 70 : kind === 'mid' ? 72 : 60;
  const amp = kind === 'far' ? 48 : kind === 'mid' ? 26 : 14;
  for (let x = 0; x < LAYER_W; x++) {
    let v = 0;
    for (const hm of harmonics) v += Math.sin((x / LAYER_W) * Math.PI * 2 * hm.k + hm.p) * hm.a;
    let top = base - v * amp;
    if (kind === 'far') top -= Math.abs(Math.sin(x * 0.045 + 1.3)) * 10; // craggy peaks
    g.fillRect(x, Math.round(top), 1, h - Math.round(top));
  }
  if (kind !== 'far') {
    // Conifers along the ridge
    const count = kind === 'mid' ? 22 : 12;
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rnd() * LAYER_W);
      let v = 0;
      for (const hm of harmonics) v += Math.sin((x / LAYER_W) * Math.PI * 2 * hm.k + hm.p) * hm.a;
      const top = base - v * amp;
      const th = (kind === 'mid' ? 14 : 26) + rnd() * (kind === 'mid' ? 12 : 20);
      const tw = th * 0.38;
      for (let y = 0; y < th; y++) {
        const w = Math.max(1, Math.round((y / th) * tw * (0.8 + 0.2 * ((y % 4) / 3))));
        for (const dx of [0, LAYER_W]) g.fillRect(((x - w + dx) % (LAYER_W * 2)) - (dx ? LAYER_W : 0), Math.round(top - th + y + 2), w * 2 + 1, 1);
      }
    }
  }
  return c;
}

function tint(mask: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = canvas(mask.width, mask.height);
  const g = c.getContext('2d')!;
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

interface TileSet { top: HTMLCanvasElement[]; fill: HTMLCanvasElement[]; deep: HTMLCanvasElement; plat: HTMLCanvasElement }

function buildTiles(biome: Biome): TileSet {
  const rnd = mulberry32(biome === 'meadow' ? 11 : biome === 'ruins' ? 22 : 33);
  const make = (draw: (g: CanvasRenderingContext2D) => void, w = TILE, h = TILE) => {
    const c = canvas(w, h);
    draw(c.getContext('2d')!);
    return c;
  };
  const soil = biome === 'meadow' ? PAL.plum : biome === 'ruins' ? PAL.shadow : PAL.ink;
  const speck = biome === 'meadow' ? PAL.red : biome === 'ruins' ? PAL.slate : PAL.navy;
  const fillTile = (g: CanvasRenderingContext2D, v: number) => {
    g.fillStyle = soil;
    g.fillRect(0, 0, TILE, TILE);
    if (biome === 'ruins') {
      // Brick courses
      g.fillStyle = PAL.ink;
      g.fillRect(0, 7, TILE, 1);
      g.fillRect(0, 15, TILE, 1);
      g.fillRect(v > 0.5 ? 5 : 11, 0, 1, 7);
      g.fillRect(v > 0.5 ? 12 : 3, 8, 1, 7);
      g.fillStyle = PAL.slate;
      g.fillRect(0, 0, TILE, 1);
      g.fillRect(0, 8, TILE, 1);
    } else {
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i % 2 === 0 ? PAL.ink : speck;
        g.fillRect(Math.floor(rnd() * 15), Math.floor(rnd() * 15), i % 2 ? 2 : 1, 1);
      }
      if (biome === 'crystal' && v > 0.7) {
        g.fillStyle = PAL.teal;
        line(g, 3 + v * 6, 15, 8 + v * 5, 7, PAL.teal);
        g.fillStyle = PAL.cyan;
        g.fillRect(Math.round(8 + v * 5), 7, 1, 1);
      }
    }
  };
  const topTile = (g: CanvasRenderingContext2D, v: number) => {
    fillTile(g, v);
    if (biome === 'meadow') {
      g.fillStyle = PAL.teal;
      g.fillRect(0, 3, TILE, 2);
      g.fillStyle = PAL.green;
      g.fillRect(0, 0, TILE, 4);
      g.fillStyle = PAL.lime;
      g.fillRect(0, 0, TILE, 1);
      for (let x = 0; x < TILE; x += 3) {
        const d = Math.floor(rnd() * 3);
        g.fillStyle = PAL.green;
        g.fillRect(x, 4, 1, d);
      }
    } else if (biome === 'ruins') {
      g.fillStyle = PAL.silver;
      g.fillRect(0, 0, TILE, 1);
      g.fillStyle = PAL.green;
      for (let x = 0; x < TILE; x++) if (rnd() < 0.45) g.fillRect(x, 1, 1, 1 + Math.floor(rnd() * 2));
    } else {
      g.fillStyle = PAL.teal;
      g.fillRect(0, 0, TILE, 3);
      g.fillStyle = PAL.cyan;
      g.fillRect(0, 0, TILE, 1);
      g.fillStyle = PAL.sky;
      for (let x = 1; x < TILE; x += 4) g.fillRect(x, 1, 2, 1);
    }
  };
  const top = [0, 1, 2].map((i) => make((g) => topTile(g, i / 3)));
  const fill = [0, 1, 2, 3].map((i) => make((g) => fillTile(g, i / 4)));
  const deep = make((g) => {
    fillTile(g, 0.2);
    g.globalAlpha = 0.45;
    g.fillStyle = PAL.ink;
    g.fillRect(0, 0, TILE, TILE);
  });
  const plat = make((g) => {
    const main = biome === 'meadow' ? PAL.orange : biome === 'ruins' ? PAL.slate : PAL.teal;
    const hi = biome === 'meadow' ? PAL.yellow : biome === 'ruins' ? PAL.silver : PAL.cyan;
    g.fillStyle = PAL.ink;
    g.fillRect(0, 0, TILE, 7);
    g.fillStyle = main;
    g.fillRect(0, 1, TILE, 4);
    g.fillStyle = hi;
    g.fillRect(0, 1, TILE, 1);
    g.fillStyle = PAL.ink;
    g.fillRect(7, 1, 1, 4);
  }, TILE, 7);
  return { top, fill, deep, plat };
}

/** Everything behind and around the playfield. */
export class Scenery {
  private masks = { far: buildMask('far', 3), mid: buildMask('mid', 8), near: buildMask('near', 21) };
  private tinted = new Map<string, HTMLCanvasElement>();
  private tiles: Record<Biome, TileSet> = { meadow: buildTiles('meadow'), ruins: buildTiles('ruins'), crystal: buildTiles('crystal') };
  private skies = new Map<string, HTMLCanvasElement>();
  private skyH = 0;
  private skyW = 0;
  private stars: { x: number; y: number; p: number }[] = [];

  constructor() {
    const rnd = mulberry32(77);
    for (let i = 0; i < 80; i++) this.stars.push({ x: rnd(), y: rnd() * 0.55, p: rnd() * 10 });
  }

  private layer(kind: 'far' | 'mid' | 'near', color: string): HTMLCanvasElement {
    const key = kind + color;
    let c = this.tinted.get(key);
    if (!c) { c = tint(this.masks[kind], color); this.tinted.set(key, c); }
    return c;
  }

  private sky(mood: MoodName, w: number, h: number): HTMLCanvasElement {
    if (w !== this.skyW || h !== this.skyH) { this.skies.clear(); this.skyW = w; this.skyH = h; }
    let c = this.skies.get(mood);
    if (c) return c;
    c = canvas(w, h);
    const g = c.getContext('2d')!;
    const bands = MOODS[mood].sky.map(hexToRgb);
    const n = bands.length;
    const horizon = Math.round(h * 0.72);
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const t = Math.min(0.999, y / horizon);
      const f = t * (n - 1);
      const i = Math.floor(f);
      const frac = f - i;
      for (let x = 0; x < w; x++) {
        // Ordered (2×2 Bayer) dithering between bands
        const th = ([0, 2, 3, 1][(x & 1) + ((y & 1) << 1)]) / 4 + 0.125;
        // Solid bands; dither only in the last 30% before the next band.
        const k = (frac - 0.7) / 0.3;
        const col = bands[Math.min(n - 1, k > th ? i + 1 : i)];
        const o = (y * w + x) * 4;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.skies.set(mood, c);
    return c;
  }

  /** Sky, celestial body, stars and parallax silhouettes. `blend` crossfades from `prev`. */
  drawBackground(c: CanvasRenderingContext2D, w: number, h: number, camX: number, camY: number, mood: MoodName, prev: MoodName, blend: number, time: number, music: { bass: number; hat: number; kick: number }): void {
    const drawMood = (mn: MoodName, alpha: number) => {
      if (alpha <= 0.01) return;
      c.globalAlpha = alpha;
      const m = MOODS[mn];
      c.drawImage(this.sky(mn, w, h), 0, 0);
      this.drawCelestial(c, m, w, h, music);
      // Stars
      if (m.stars > 0) {
        for (const s of this.stars) {
          const tw = Math.sin(time * 2 + s.p * 7) * 0.5 + 0.5 + music.hat * 0.6;
          if (tw * m.stars < 0.45) continue;
          c.fillStyle = tw > 1 ? PAL.white : PAL.silver;
          const sx = Math.floor(((s.x * w * 1.5 - camX * 0.02) % w + w) % w);
          c.fillRect(sx, Math.round(s.y * h), 1, 1);
        }
      }
      // Parallax layers: anchored to a horizon that moves a little with the camera.
      const base = h * 0.66 - camY * 0.04;
      this.drawLayer(c, this.layer('far', m.far), camX * 0.12, base - 124, w);
      this.drawLayer(c, this.layer('mid', m.mid), camX * 0.3, base - 86, w);
      this.drawLayer(c, this.layer('near', m.near), camX * 0.55, base - 36, w);
      // Fill below the near layer
      c.fillStyle = m.near;
      c.fillRect(0, Math.round(base - 36 + 89), w, h);
    };
    drawMood(prev, 1);
    drawMood(mood, blend);
    c.globalAlpha = 1;
  }

  private drawCelestial(c: CanvasRenderingContext2D, m: Mood, w: number, h: number, music: { bass: number; kick: number }): void {
    const cx = Math.round(w * 0.72);
    const cy = Math.round(h * 0.3);
    if (m.celestial === 'moon') {
      const r = Math.round(Math.min(w, h) * 0.07);
      ellipse(c, cx, cy, r + 2, r + 2, PAL.navy);
      ellipse(c, cx, cy, r, r, PAL.silver);
      ellipse(c, cx - 2, cy - 2, r - 2, r - 2, PAL.white);
      ellipse(c, cx + r * 0.3, cy + r * 0.2, r * 0.25, r * 0.2, PAL.silver);
      ellipse(c, cx - r * 0.35, cy - r * 0.25, r * 0.15, r * 0.12, PAL.silver);
    } else {
      const r = Math.round(Math.min(w, h) * (0.1 + music.bass * 0.012 + music.kick * 0.008));
      ellipse(c, cx, cy, r + 3, r + 3, m.sky[3]);
      ellipse(c, cx, cy, r, r, PAL.yellow);
      ellipse(c, cx - 1, cy - 1, r - 3, r - 3, PAL.white);
      // Horizontal slits (retro sun)
      c.fillStyle = m.sky[3];
      for (let i = 1; i < 5; i++) {
        const yy = cy + Math.round((r * i) / 5);
        c.fillRect(cx - r - 3, yy, (r + 3) * 2, i);
      }
    }
  }

  private drawLayer(c: CanvasRenderingContext2D, img: HTMLCanvasElement, scroll: number, y: number, w: number): void {
    const off = -Math.floor(((scroll % LAYER_W) + LAYER_W) % LAYER_W);
    for (let x = off; x < w; x += LAYER_W) c.drawImage(img, x, Math.round(y));
  }

  /** Terrain, platforms and decor for visible columns. */
  drawTerrain(c: CanvasRenderingContext2D, world: World, camX: number, camY: number, w: number, h: number, time: number, music: { kick: number; hat: number; mid: number }, rim: string): void {
    const c0 = Math.floor(camX / TILE) - 1;
    const c1 = Math.ceil((camX + w) / TILE) + 1;
    const bottomRow = Math.ceil((camY + h) / TILE);
    // Decor behind tiles first
    for (let i = c0; i <= c1; i++) {
      const col = world.col(i);
      if (!col || col.ground === NONE || col.decor === 'none') continue;
      this.drawDecor(c, col, i * TILE - camX, col.ground * TILE - camY, time, music, rim);
    }
    for (let i = c0; i <= c1; i++) {
      const col = world.col(i);
      const x = Math.round(i * TILE - camX);
      if (!col) continue;
      const ts = this.tiles[col.biome];
      if (col.ground !== NONE) {
        const left = world.col(i - 1);
        const right = world.col(i + 1);
        for (let r = col.ground; r <= bottomRow; r++) {
          const y = Math.round(r * TILE - camY);
          const v = Math.floor(hash01(i * 31 + r * 7) * 4);
          const img = r === col.ground ? ts.top[v % 3] : r - col.ground > 3 ? ts.deep : ts.fill[v];
          c.drawImage(img, x, y);
        }
        // Cliff edges
        const top = Math.round(col.ground * TILE - camY);
        if (!left || left.ground === NONE || left.ground > col.ground) {
          const dh = left && left.ground !== NONE ? (left.ground - col.ground) * TILE : h;
          c.fillStyle = PAL.ink;
          c.fillRect(x, top + 1, 1, dh);
        }
        if (!right || right.ground === NONE || right.ground > col.ground) {
          const dh = right && right.ground !== NONE ? (right.ground - col.ground) * TILE : h;
          c.fillStyle = PAL.ink;
          c.fillRect(x + TILE - 1, top + 1, 1, dh);
        }
      } else {
        // Chasm: darkness with faint mist at depth
        const ref = world.col(i - 1)?.ground ?? world.col(i + 1)?.ground ?? 11;
        const y0 = Math.round((ref === NONE ? 11 : ref) * TILE - camY + 18);
        c.fillStyle = PAL.ink;
        c.fillRect(x, y0, TILE, h);
        if ((i + Math.floor(time * 2)) % 3 === 0) {
          c.fillStyle = PAL.shadow;
          c.fillRect(x + 3, y0 + 6 + (i % 4), 5, 1);
        }
      }
      if (col.plat !== NONE) c.drawImage(ts.plat, x, Math.round(col.plat * TILE - camY));
      if (col.arena && col.ground !== NONE) {
        // Arena rune lights along the ground
        const y = Math.round(col.ground * TILE - camY);
        c.fillStyle = (Math.floor(time * 8) + i) % 4 === 0 ? PAL.white : PAL.cyan;
        c.fillRect(x + 6, y + 6, 4, 1);
      }
    }
  }

  private drawDecor(c: CanvasRenderingContext2D, col: Column, x: number, y: number, time: number, music: { kick: number; hat: number; mid: number }, rim: string): void {
    x = Math.round(x);
    y = Math.round(y);
    const s = col.seed;
    const sway = Math.round(Math.sin(time * 2 + s * 10) * (0.6 + music.mid));
    switch (col.decor) {
      case 'tree': {
        const th = 20 + Math.floor(s * 14);
        c.fillStyle = PAL.ink;
        c.fillRect(x + 7, y - th, 3, th);
        c.fillStyle = PAL.plum;
        c.fillRect(x + 8, y - th, 1, th);
        const cx = x + 8 + sway, cy = y - th - 4;
        ellipse(c, cx, cy, 11, 8, PAL.ink);
        ellipse(c, cx, cy, 10, 7, PAL.teal);
        ellipse(c, cx - 2, cy - 2, 7, 4, PAL.green);
        ellipse(c, cx - 3, cy - 4, 3, 2, PAL.lime);
        break;
      }
      case 'flowers': {
        for (let k = 0; k < 3; k++) {
          const fx = x + 3 + k * 5 + (k === 1 ? sway : 0);
          c.fillStyle = PAL.green;
          c.fillRect(fx, y - 3, 1, 3);
          c.fillStyle = k === 1 ? PAL.yellow : PAL.red;
          c.fillRect(fx - 1, y - 4, 3, 1);
          c.fillRect(fx, y - 5, 1, 1);
        }
        break;
      }
      case 'tuft': {
        c.fillStyle = col.biome === 'crystal' ? PAL.teal : PAL.green;
        for (let k = 0; k < 4; k++) line(c, x + 4 + k * 2, y - 1, x + 4 + k * 2 + sway, y - 3 - (k % 2) * 2, col.biome === 'crystal' ? PAL.teal : PAL.green);
        break;
      }
      case 'rock':
        ellipse(c, x + 8, y - 2, 5, 3, PAL.ink);
        ellipse(c, x + 8, y - 2, 4, 2, PAL.slate);
        c.fillStyle = PAL.silver;
        c.fillRect(x + 6, y - 4, 2, 1);
        break;
      case 'sign':
        c.fillStyle = PAL.ink;
        c.fillRect(x + 7, y - 12, 2, 12);
        c.fillRect(x + 2, y - 15, 12, 7);
        c.fillStyle = PAL.orange;
        c.fillRect(x + 3, y - 14, 10, 5);
        c.fillStyle = PAL.ink;
        c.fillRect(x + 5, y - 12, 6, 1);
        c.fillRect(x + 9, y - 13, 1, 3);
        break;
      case 'pillar': {
        const ph = 26 + Math.floor(s * 20);
        c.fillStyle = PAL.ink;
        c.fillRect(x + 3, y - ph, 10, ph);
        c.fillStyle = PAL.slate;
        c.fillRect(x + 4, y - ph + 1, 8, ph - 1);
        c.fillStyle = PAL.silver;
        c.fillRect(x + 4, y - ph + 1, 2, ph - 1);
        c.fillStyle = PAL.shadow;
        for (let k = 6; k < ph; k += 8) c.fillRect(x + 4, y - k, 8, 1);
        c.fillStyle = PAL.ink;
        c.fillRect(x + 1, y - ph - 2, 14, 3);
        if (s > 0.5) { c.fillStyle = PAL.green; c.fillRect(x + 11, y - ph + 4, 1, 9); }
        break;
      }
      case 'lamp': {
        c.fillStyle = PAL.ink;
        c.fillRect(x + 7, y - 22, 2, 22);
        c.fillRect(x + 4, y - 26, 8, 5);
        const glow = 0.35 + music.kick * 0.65;
        c.globalAlpha = 0.18 * glow;
        ellipse(c, x + 8, y - 24, 14, 12, rim);
        c.globalAlpha = 0.35 * glow;
        ellipse(c, x + 8, y - 24, 7, 6, rim);
        c.globalAlpha = 1;
        c.fillStyle = glow > 0.7 ? PAL.white : PAL.yellow;
        c.fillRect(x + 5, y - 25, 6, 3);
        break;
      }
      case 'crystal': {
        const ch = 8 + Math.floor(s * 12);
        const lit = music.hat > 0.4 && s > 0.3;
        const body = lit ? PAL.cyan : PAL.teal;
        for (let k = 0; k < ch; k++) {
          const wdt = Math.max(1, Math.round((1 - k / ch) * 3));
          c.fillStyle = k === 0 || k === ch - 1 ? PAL.ink : body;
          c.fillRect(x + 8 - wdt, y - k - 1, wdt * 2, 1);
        }
        c.fillStyle = lit ? PAL.white : PAL.sky;
        c.fillRect(x + 7, y - ch + 2, 1, Math.max(1, ch - 5));
        if (lit) {
          c.globalAlpha = 0.25;
          ellipse(c, x + 8, y - ch / 2, 7, ch / 2 + 2, PAL.cyan);
          c.globalAlpha = 1;
        }
        break;
      }
      case 'banner': {
        c.fillStyle = PAL.ink;
        c.fillRect(x + 7, y - 30, 2, 30);
        for (let k = 0; k < 12; k++) {
          const wave = Math.round(Math.sin(time * 4 + k * 0.5) * (1 + music.mid));
          c.fillStyle = k % 4 === 0 ? PAL.yellow : PAL.red;
          c.fillRect(x + 9 + k, y - 29 + wave, 1, 9 - Math.floor(k / 3));
        }
        break;
      }
    }
  }

  /** Pre-rendered dithered vignette (pixel-art friendly), rebuilt on resize. */
  private vignette: HTMLCanvasElement | null = null;

  drawVignette(c: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.vignette || this.vignette.width !== w || this.vignette.height !== h) {
      const v = canvas(w, h);
      const g = v.getContext('2d')!;
      const img = g.createImageData(w, h);
      const ink = hexToRgb(PAL.ink);
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = (x / w - 0.5) * 2, dy = (y / h - 0.5) * 2;
          const r = Math.sqrt(dx * dx * 0.7 + dy * dy);
          const k = Math.max(0, (r - 1.05) / 0.5) * 0.6;
          if (k * 16 > bayer[(x & 3) + ((y & 3) << 2)] + 1) {
            const o = (y * w + x) * 4;
            img.data[o] = ink[0]; img.data[o + 1] = ink[1]; img.data[o + 2] = ink[2]; img.data[o + 3] = 255;
          }
        }
      }
      g.putImageData(img, 0, 0);
      this.vignette = v;
    }
    c.drawImage(this.vignette, 0, 0);
  }
}
