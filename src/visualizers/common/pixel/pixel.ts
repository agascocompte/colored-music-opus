/** Pixel-exact drawing helpers for the low-res game canvas (no anti-aliasing). */

/** Bresenham line; `w` draws a square brush. */
export function line(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, w = 1): void {
  c.fillStyle = color;
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const o = Math.floor((w - 1) / 2);
  for (let guard = 0; guard < 1024; guard++) {
    c.fillRect(x0 - o, y0 - o, w, w);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Filled pixel ellipse. */
export function ellipse(c: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string): void {
  c.fillStyle = color;
  cx = Math.round(cx); cy = Math.round(cy);
  const irx = Math.max(0, Math.round(rx)), iry = Math.max(0, Math.round(ry));
  for (let y = -iry; y <= iry; y++) {
    const t = iry === 0 ? 0 : y / (iry + 0.5);
    const half = Math.round(irx * Math.sqrt(Math.max(0, 1 - t * t)));
    c.fillRect(cx - half, cy + y, half * 2 + 1, 1);
  }
}

/** Pixel circle outline (midpoint), optionally squashed vertically. */
export function ring(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, yScale = 1): void {
  c.fillStyle = color;
  cx = Math.round(cx); cy = Math.round(cy);
  let x = Math.round(r), y = 0, err = 1 - x;
  const plot = (a: number, b: number) => c.fillRect(cx + a, cy + Math.round(b * yScale), 1, 1);
  while (x >= y) {
    plot(x, y); plot(y, x); plot(-y, x); plot(-x, y);
    plot(-x, -y); plot(-y, -x); plot(y, -x); plot(x, -y);
    y++;
    if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
  }
}

/** Draws a bitmap described by strings; each char maps to a color ('.' = transparent). */
export function bitmap(c: CanvasRenderingContext2D, rows: readonly string[], colors: Record<string, string>, x: number, y: number, flip = false, tint?: string): void {
  x = Math.round(x); y = Math.round(y);
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j];
    const w = r.length;
    for (let i = 0; i < w; i++) {
      const ch = r[i];
      if (ch === '.') continue;
      const col = tint ?? colors[ch];
      if (!col) continue;
      c.fillStyle = col;
      c.fillRect(x + (flip ? w - 1 - i : i), y + j, 1, 1);
    }
  }
}

/** Cheap deterministic hash → [0,1). */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Filled pixel polygon (scanline, even-odd). Points are [x0, y0, x1, y1, ...]. */
export function poly(c: CanvasRenderingContext2D, pts: number[], color: string): void {
  const n = pts.length / 2;
  if (n < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < pts.length; i += 2) { minY = Math.min(minY, pts[i]); maxY = Math.max(maxY, pts[i]); }
  c.fillStyle = color;
  const xs: number[] = [];
  for (let y = Math.round(minY); y <= Math.round(maxY); y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2], ay = pts[i * 2 + 1];
      const bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
      if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.round(xs[k]), x1 = Math.round(xs[k + 1]);
      if (x1 > x0) c.fillRect(x0, y, x1 - x0, 1);
    }
  }
}

/** Checkerboard-dithered filled ellipse: a pixel-art glow without alpha blending. */
export function ditherEllipse(c: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string, phase = 0): void {
  c.fillStyle = color;
  cx = Math.round(cx); cy = Math.round(cy);
  const irx = Math.max(0, Math.round(rx)), iry = Math.max(0, Math.round(ry));
  for (let y = -iry; y <= iry; y++) {
    const t = iry === 0 ? 0 : y / (iry + 0.5);
    const half = Math.round(irx * Math.sqrt(Math.max(0, 1 - t * t)));
    for (let x = -half; x <= half; x++) if (((x + y + phase) & 1) === 0) c.fillRect(cx + x, cy + y, 1, 1);
  }
}
