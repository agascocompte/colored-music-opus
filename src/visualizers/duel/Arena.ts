import { noise1 } from '../common/math';
import { PAL } from '../common/pixel/palette';
import { ellipse, hash01, poly } from '../common/pixel/pixel';
import { EX } from './wizards';

/**
 * Duel arenas: dithered sky, a celestial body, two parallax layers and a tiled
 * floor, all procedural pixel art. Windows, crystals and mushrooms light up
 * with the kick; floating islands bob on the beat.
 */

type Props = 'towers' | 'trees' | 'ruins' | 'crystals';
type Ambient = 'motes' | 'fireflies' | 'petals' | 'sparkles';

interface ArenaDef {
  name: string;
  sky: string[];
  celestial: 'moon' | 'sun' | 'none';
  stars: number;
  far: string;
  farRim: string;
  mid: string;
  midRim: string;
  glow: string;
  props: Props;
  ground: { top: string; rim: string; fill: string; dark: string; detail: string };
  ambient: Ambient;
  ambientColor: string;
  /** Soft light behind the fighters (dark arenas). */
  backlight?: string;
}

export const ARENAS: ArenaDef[] = [
  {
    name: 'MOON TOWER', sky: [PAL.ink, PAL.ink, PAL.navy, PAL.navy, PAL.blue], celestial: 'moon', stars: 1,
    far: PAL.shadow, farRim: PAL.slate, mid: PAL.ink, midRim: PAL.navy, glow: PAL.yellow, props: 'towers',
    ground: { top: PAL.silver, rim: PAL.white, fill: PAL.slate, dark: PAL.shadow, detail: PAL.ink }, ambient: 'motes', ambientColor: PAL.silver, backlight: PAL.sky,
  },
  {
    name: 'DUSK GROVE', sky: [PAL.navy, PAL.plum, PAL.red, PAL.orange, PAL.yellow], celestial: 'sun', stars: 0.3,
    far: PAL.plum, farRim: PAL.red, mid: PAL.ink, midRim: PAL.plum, glow: PAL.cyan, props: 'trees',
    ground: { top: PAL.green, rim: PAL.lime, fill: PAL.teal, dark: PAL.shadow, detail: PAL.ink }, ambient: 'fireflies', ambientColor: PAL.lime,
  },
  {
    name: 'SKY RUINS', sky: [PAL.blue, PAL.sky, PAL.sky, PAL.cyan, PAL.white], celestial: 'sun', stars: 0,
    far: PAL.silver, farRim: PAL.white, mid: PAL.slate, midRim: PAL.silver, glow: EX.gold, props: 'ruins',
    ground: { top: PAL.white, rim: PAL.white, fill: PAL.silver, dark: PAL.slate, detail: PAL.shadow }, ambient: 'petals', ambientColor: EX.pink,
  },
  {
    name: 'CRYSTAL CAVERN', sky: [PAL.ink, PAL.shadow, PAL.shadow, PAL.plum, PAL.plum], celestial: 'none', stars: 0,
    far: PAL.ink, farRim: PAL.plum, mid: PAL.ink, midRim: PAL.shadow, glow: PAL.cyan, props: 'crystals',
    ground: { top: PAL.slate, rim: PAL.silver, fill: PAL.shadow, dark: PAL.ink, detail: EX.violet }, ambient: 'sparkles', ambientColor: PAL.cyan, backlight: EX.violet,
  },
];

export interface ArenaMusic {
  kick: number;
  hat: number;
  bass: number;
  beat: number;
  dark: number;
  /** Intense section 0..1: auroras in both wizards' colours. */
  intense: number;
  /** Right after a drop: everything lit. */
  surge: number;
  /** Snare flashes in the sky. */
  skyFlash: number;
  colors: [string, string];
  flashWho: number;
}

interface Mote { x: number; y: number; ph: number }

export class Arena {
  readonly def: ArenaDef;
  private sky: HTMLCanvasElement | null = null;
  private skyKey = '';
  private motes: Mote[] = [];

  constructor(index: number, private readonly seed: number) {
    this.def = ARENAS[index % ARENAS.length];
    for (let i = 0; i < 40; i++) this.motes.push({ x: hash01(seed + i * 3.1), y: hash01(seed * 2 + i * 7.7), ph: hash01(i * 5.3) * 6.28 });
  }

  private skyCanvas(w: number, horizon: number): HTMLCanvasElement {
    const key = `${w}x${horizon}`;
    if (this.sky && this.skyKey === key) return this.sky;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = Math.max(1, horizon);
    const g = cv.getContext('2d')!;
    const bands = this.def.sky;
    const bh = horizon / bands.length;
    for (let y = 0; y < horizon; y++) {
      const f = y / bh;
      const i = Math.min(bands.length - 1, Math.floor(f));
      const frac = f - i;
      g.fillStyle = bands[i];
      g.fillRect(0, y, w, 1);
      // Ordered dithering into the next band
      if (i + 1 < bands.length && frac > 0.6) {
        g.fillStyle = bands[i + 1];
        const step = frac > 0.85 ? 2 : 4;
        for (let x = (y % 2) * (step / 2); x < w; x += step) g.fillRect(x, y, 1, 1);
      }
    }
    this.sky = cv;
    this.skyKey = key;
    return cv;
  }

  draw(c: CanvasRenderingContext2D, w: number, h: number, camX: number, gy: number, t: number, mu: ArenaMusic): void {
    const d = this.def;
    const horizon = gy;
    c.drawImage(this.skyCanvas(w, horizon), 0, 0);

    // Stars
    if (d.stars > 0) {
      const n = Math.round(60 * d.stars);
      for (let i = 0; i < n; i++) {
        const sx = Math.floor(((hash01(this.seed + i * 1.7) * w * 1.5 - camX * 0.05) % w + w) % w);
        const sy = Math.floor(hash01(this.seed * 3 + i * 2.3) * horizon * 0.7);
        const tw = Math.sin(t * (1 + hash01(i) * 3) + i) + mu.hat * 1.5;
        c.fillStyle = tw > 1.2 ? PAL.white : tw > 0 ? PAL.silver : PAL.slate;
        c.fillRect(sx, sy, 1, 1);
      }
    }

    // Celestial body
    if (d.celestial === 'moon') {
      const mx = Math.round(w * 0.74 - camX * 0.02), my = Math.round(horizon * 0.3), r = Math.round(horizon * 0.16);
      c.globalAlpha = 0.12 + mu.kick * 0.12;
      ellipse(c, mx, my, r + 6, r + 6, PAL.cyan);
      c.globalAlpha = 1;
      ellipse(c, mx, my, r, r, PAL.white);
      ellipse(c, mx + r * 0.3, my - r * 0.1, r * 0.8, r * 0.85, '#dfe8ee');
      for (const [cx, cy, cr] of [[-0.35, -0.2, 0.18], [0.2, 0.35, 0.14], [0.35, -0.35, 0.1], [-0.1, 0.5, 0.08]]) ellipse(c, mx + cx * r, my + cy * r, cr * r, cr * r, PAL.silver);
    } else if (d.celestial === 'sun') {
      const ruins = d.props === 'ruins';
      const sx = Math.round(w * (ruins ? 0.8 : 0.3) - camX * 0.02), sy = Math.round(horizon * (ruins ? 0.2 : 0.62)), r = Math.round(horizon * (ruins ? 0.09 : 0.2));
      const hot = ruins ? PAL.white : PAL.yellow;
      c.globalAlpha = 0.18 + mu.kick * 0.15;
      ellipse(c, sx, sy, r + 5, r + 5, hot);
      c.globalAlpha = 1;
      ellipse(c, sx, sy, r, r, hot);
      if (!ruins) {
        // Retro stripes across the lower half
        c.fillStyle = d.sky[3];
        for (let k = 0; k < 5; k++) c.fillRect(sx - r - 1, sy + 2 + k * 4 + Math.floor(t * 6) % 4, r * 2 + 3, 1 + (k >> 1));
      }
    }

    // Auroras: curtains of light in both wizards' colours while the music is intense
    if (mu.intense > 0.05) {
      for (let r = 0; r < 2; r++) {
        const col = mu.colors[r];
        for (let x = r; x < w; x += 2) {
          const wx = x + camX * 0.05;
          const y = horizon * (0.34 + r * 0.12) + Math.sin(wx * 0.022 + t * (0.7 + r * 0.3) + r * 2) * horizon * 0.07 + Math.sin(wx * 0.009 - t * 0.5) * horizon * 0.05;
          const hh = Math.round((5 + 14 * mu.bass) * (0.5 + 0.5 * Math.sin(wx * 0.06 + t * 2.5 + r)));
          if (hh < 1) continue;
          const a = mu.intense * (0.22 + 0.18 * Math.sin(wx * 0.04 + t * 1.7));
          c.globalAlpha = Math.max(0, a);
          c.fillStyle = col;
          c.fillRect(x, Math.round(y), 1, hh);
          c.globalAlpha = Math.min(1, Math.max(0, a * 2.2));
          c.fillRect(x, Math.round(y) + hh - 1, 1, 1);
        }
      }
      c.globalAlpha = 1;
    }
    if (mu.skyFlash > 0.02) {
      c.globalAlpha = 0.16 * mu.skyFlash;
      c.fillStyle = mu.colors[mu.flashWho];
      c.fillRect(0, 0, w, horizon);
      c.globalAlpha = 1;
    }

    // Far silhouette (mountains / hills / clouds / cave wall)
    const fh = horizon * (d.props === 'crystals' ? 0.55 : 0.32);
    for (let x = 0; x < w; x++) {
      const wx = x + camX * 0.15;
      const hh = Math.round(fh * (0.45 + 0.35 * noise1(wx * 0.012, this.seed % 97) + 0.2 * noise1(wx * 0.05, 3)));
      c.fillStyle = d.far;
      c.fillRect(x, horizon - hh, 1, hh);
      c.fillStyle = d.farRim;
      c.fillRect(x, horizon - hh, 1, 1);
    }
    if (d.props === 'crystals') this.stalactites(c, w, camX, horizon);
    if (d.props === 'ruins') this.clouds(c, w, camX, horizon, t);

    // Darken the world while magic gathers
    if (mu.dark > 0.02) {
      c.globalAlpha = mu.dark * 0.45;
      c.fillStyle = PAL.ink;
      c.fillRect(0, 0, w, horizon);
      c.globalAlpha = 1;
    }

    // Mid layer props
    const par = 0.45;
    const spacing = 64;
    const k0 = Math.floor((camX * par - w) / spacing), k1 = Math.ceil((camX * par + w) / spacing);
    for (let k = k0; k <= k1; k++) {
      const r = hash01(this.seed * 0.37 + k * 13.1);
      if (r < 0.25) continue;
      const x = Math.round(k * spacing + (r - 0.5) * 30 - camX * par + w / 2);
      this.prop(c, x, horizon, r, k, t, mu);
    }

    // Floor
    this.floor(c, w, h, camX, gy);

    // Ambient particles (screen space, slow drift)
    for (const m of this.motes) {
      let x = 0, y = 0, col: string = d.ambientColor;
      switch (d.ambient) {
        case 'motes': x = m.x * w + Math.sin(t * 0.3 + m.ph) * 6; y = m.y * gy - ((t * 3 + m.ph * 10) % gy); break;
        case 'fireflies': x = m.x * w + Math.sin(t * 0.8 + m.ph) * 10; y = gy * (0.5 + m.y * 0.5) + Math.sin(t * 1.3 + m.ph * 2) * 6; if (Math.sin(t * 3 + m.ph * 5) < 0.2 - mu.kick) continue; break;
        case 'petals': x = ((m.x * w + t * 12 + Math.sin(t + m.ph) * 8) % w); y = ((m.y * h + t * 8) % h); col = Math.floor(t * 4 + m.ph) % 2 ? EX.pink : PAL.white; break;
        case 'sparkles': x = m.x * w; y = m.y * gy; if (Math.sin(t * 2 + m.ph * 9) < 0.7 - mu.hat * 0.5) continue; col = Math.sin(t * 5 + m.ph) > 0 ? PAL.white : PAL.cyan; break;
      }
      x = ((x - camX * 0.3) % w + w) % w;
      if (y < 0) y += gy;
      c.fillStyle = col;
      c.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }

  private stalactites(c: CanvasRenderingContext2D, w: number, camX: number, horizon: number): void {
    const d = this.def;
    for (let x = 0; x < w; x += 1) {
      const wx = Math.floor(x + camX * 0.2);
      const n = hash01(Math.floor(wx / 9) + this.seed);
      const local = (wx % 9) / 9;
      const hh = Math.round(n * horizon * 0.28 * (1 - Math.abs(local - 0.5) * 2)) + 3;
      c.fillStyle = d.far;
      c.fillRect(x, 0, 1, hh);
      c.fillStyle = PAL.ink;
      c.fillRect(x, 0, 1, Math.max(0, hh - 3));
    }
  }

  private clouds(c: CanvasRenderingContext2D, w: number, camX: number, horizon: number, t: number): void {
    for (let i = 0; i < 6; i++) {
      const cx = (((hash01(this.seed + i) * w * 1.6 - camX * 0.08 + t * 3) % (w + 80)) + w + 80) % (w + 80) - 40;
      const cy = horizon * (0.15 + hash01(i * 3.3) * 0.35);
      const s = 8 + hash01(i * 7.1) * 10;
      ellipse(c, cx, cy + 2, s * 1.8, s * 0.5, PAL.silver);
      ellipse(c, cx, cy, s * 1.6, s * 0.45, PAL.white);
      ellipse(c, cx - s * 0.6, cy - s * 0.3, s * 0.7, s * 0.5, PAL.white);
      ellipse(c, cx + s * 0.4, cy - s * 0.4, s * 0.8, s * 0.6, PAL.white);
    }
  }

  private prop(c: CanvasRenderingContext2D, x: number, gy: number, r: number, k: number, t: number, mu: ArenaMusic): void {
    const d = this.def;
    const lit = Math.max(0.35 + mu.kick * 0.65, mu.surge);
    switch (d.props) {
      case 'towers': {
        // A castle keep: walls, a crenellated top or a pointed roof, lit windows, a flag
        const tw = 12 + Math.round(r * 8), th = Math.round(gy * (0.2 + r * 0.25));
        const top = gy - th, xl = Math.round(x - tw / 2);
        c.fillStyle = d.mid;
        c.fillRect(xl, top, tw, th);
        c.fillStyle = d.midRim;
        c.fillRect(xl, top, 1, th);
        if (r > 0.6) {
          const peak = top - Math.round(tw * 1.1);
          poly(c, [xl - 2, top + 1, x, peak, xl + tw + 2, top + 1], d.mid);
          c.fillStyle = d.midRim;
          c.fillRect(xl - 2, top, tw + 4, 1);
          const fl = Math.floor(t * 6 + k) % 2;
          c.fillStyle = d.mid;
          c.fillRect(Math.round(x), peak - 6, 1, 6);
          c.fillStyle = PAL.red;
          c.fillRect(Math.round(x) + 1, peak - 6, 4 + fl, 2 + (fl ? 0 : 1) - 1);
        } else {
          c.fillStyle = d.mid;
          c.fillRect(xl - 1, top - 2, tw + 2, 2);
          for (let b = 0; b < tw + 2; b += 3) c.fillRect(xl - 1 + b, top - 4, 2, 2);
        }
        // Windows (arched: 2x3 with a lit top pixel)
        for (let j = 0; j < 4; j++) {
          const wy = top + 5 + j * 8;
          if (wy > gy - 6 || hash01(k * 3 + j) < 0.3) continue;
          const wx = x + (j % 2 ? 2 : -3);
          c.fillStyle = PAL.ink;
          c.fillRect(Math.round(wx) - 1, wy - 1, 4, 5);
          c.globalAlpha = lit * (0.55 + 0.45 * hash01(k + j));
          c.fillStyle = d.glow;
          c.fillRect(Math.round(wx), wy, 2, 3);
          c.fillStyle = PAL.white;
          c.fillRect(Math.round(wx), wy, 1, 1);
          c.globalAlpha = 1;
        }
        break;
      }
      case 'trees': {
        const th = Math.round(gy * (0.45 + r * 0.3));
        c.fillStyle = d.mid;
        c.fillRect(x - 2, gy - th, 5, th);
        for (let j = 0; j < 4; j++) {
          const bx = x + (hash01(k * 5 + j) - 0.5) * 22, by = gy - th + (hash01(k * 7 + j) - 0.3) * 14;
          ellipse(c, bx, by, 10 + hash01(k + j) * 6, 7 + hash01(k * 2 + j) * 4, d.mid);
        }
        ellipse(c, x - 6, gy - th - 4, 8, 5, d.midRim);
        ellipse(c, x - 6, gy - th - 3, 8, 5, d.mid);
        // Glowing mushrooms at the roots
        for (let j = 0; j < 2; j++) {
          const mx = x + (j ? 5 : -6), my = gy - 1;
          c.globalAlpha = 0.25 * lit;
          ellipse(c, mx, my - 2, 4, 3, d.glow);
          c.globalAlpha = 0.6 + 0.4 * lit;
          c.fillStyle = d.glow;
          c.fillRect(mx - 1, my - 3, 3, 1);
          c.fillRect(mx, my - 2, 1, 2);
          c.globalAlpha = 1;
        }
        break;
      }
      case 'ruins': {
        // Floating island bobbing on the beat + a broken column on the ground
        const bob = Math.round(Math.sin((mu.beat + k * 0.25) * Math.PI) * 2);
        const iy = Math.round(gy * (0.3 + r * 0.25)) + bob;
        const iw = 10 + r * 10;
        poly(c, [x - iw, iy, x + iw, iy, x + iw * 0.4, iy + iw * 0.8, x - iw * 0.2, iy + iw], d.mid);
        c.fillStyle = PAL.green;
        c.fillRect(Math.round(x - iw), iy - 1, Math.round(iw * 2), 2);
        c.fillStyle = PAL.lime;
        c.fillRect(Math.round(x - iw), iy - 1, Math.round(iw * 2), 1);
        c.fillStyle = d.glow;
        c.globalAlpha = lit;
        c.fillRect(Math.round(x + iw * 0.1), iy + Math.round(iw * 0.5), 1, 1);
        c.globalAlpha = 1;
        if (r > 0.55) {
          const ch = Math.round(gy * 0.18 + r * 10);
          c.fillStyle = d.midRim;
          c.fillRect(x - 4, gy - ch, 8, ch);
          c.fillStyle = d.mid;
          c.fillRect(x - 4, gy - ch, 2, ch);
          c.fillRect(x + 1, gy - ch, 1, ch);
          poly(c, [x - 5, gy - ch, x + 5, gy - ch, x + 3, gy - ch - 3, x - 1, gy - ch - 1], d.midRim);
        }
        break;
      }
      case 'crystals': {
        const n = 2 + Math.floor(r * 3);
        for (let j = 0; j < n; j++) {
          const cx = x + (j - n / 2) * 6, ch = 10 + hash01(k * 3 + j) * 24;
          const lean = (hash01(k + j * 7) - 0.5) * 8;
          const col = j % 2 ? EX.violet : PAL.cyan;
          c.globalAlpha = 0.15 * lit;
          ellipse(c, cx + lean / 2, gy - ch / 2, 6, ch / 2 + 3, col);
          c.globalAlpha = 1;
          poly(c, [cx - 3, gy, cx - 3 + lean, gy - ch + 3, cx + lean, gy - ch, cx + 3 + lean, gy - ch + 3, cx + 3, gy], PAL.ink);
          poly(c, [cx - 2, gy, cx - 2 + lean, gy - ch + 3, cx + lean, gy - ch + 1, cx + 2 + lean, gy - ch + 3, cx + 2, gy], col);
          c.globalAlpha = 0.4 + 0.6 * lit;
          c.fillStyle = PAL.white;
          c.fillRect(Math.round(cx + lean * 0.6), Math.round(gy - ch * 0.8), 1, Math.round(ch * 0.4));
          c.globalAlpha = 1;
        }
        break;
      }
    }
  }

  private floor(c: CanvasRenderingContext2D, w: number, h: number, camX: number, gy: number): void {
    const g = this.def.ground;
    c.fillStyle = g.fill;
    c.fillRect(0, gy, w, h - gy);
    c.fillStyle = g.top;
    c.fillRect(0, gy, w, 3);
    c.fillStyle = g.rim;
    c.fillRect(0, gy, w, 1);
    // Tiles / clods scrolling with the camera
    const tile = 12;
    const x0 = -((camX % tile) + tile) % tile;
    for (let row = 0; gy + 4 + row * 7 < h; row++) {
      const y = gy + 4 + row * 7;
      const off = row % 2 ? tile / 2 : 0;
      c.fillStyle = g.dark;
      c.fillRect(0, y + 6, w, 1);
      for (let x = x0 - off; x < w; x += tile) {
        c.fillRect(Math.round(x), y, 1, 6);
        const id = Math.floor((x + camX) / tile) * 31 + row * 7;
        if (hash01(id) > 0.8) {
          c.fillStyle = g.detail;
          c.fillRect(Math.round(x) + 3, y + 2, 2, 1);
          c.fillStyle = g.dark;
        }
      }
    }
    // Grass / pebbles on the edge
    for (let x = 0; x < w; x++) {
      const id = Math.floor(x + camX);
      const r = hash01(id * 1.37 + this.seed);
      if (r > 0.9) {
        c.fillStyle = g.rim;
        c.fillRect(x, gy - 1, 1, 1);
        if (r > 0.97) c.fillRect(x, gy - 2, 1, 1);
      }
    }
    // Depth shading toward the bottom
    c.globalAlpha = 0.35;
    c.fillStyle = PAL.ink;
    c.fillRect(0, Math.round(gy + (h - gy) * 0.55), w, h);
    c.globalAlpha = 1;
  }
}
