import { PAL } from '../common/pixel/palette';

export { PAL };

export type RGB = [number, number, number];

export function hexToRgb(h: string): RGB {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgbStr(c: RGB, a = 1): string {
  return a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export type MoodName = 'dusk' | 'night' | 'neon' | 'dawn';

/** Lighting moods. Each drives sky bands, parallax silhouettes and ambient tint. */
export interface Mood {
  sky: string[]; // top → horizon bands
  far: string;
  mid: string;
  near: string;
  rim: string; // highlight on silhouettes / ambient particles
  celestial: 'moon' | 'sun';
  stars: number; // 0..1
}

export const MOODS: Record<MoodName, Mood> = {
  dusk: { sky: [PAL.navy, PAL.plum, PAL.red, PAL.orange, PAL.yellow], far: PAL.plum, mid: PAL.shadow, near: PAL.ink, rim: PAL.orange, celestial: 'sun', stars: 0.25 },
  night: { sky: [PAL.ink, PAL.ink, PAL.navy, PAL.navy, PAL.blue], far: PAL.shadow, mid: PAL.navy, near: PAL.ink, rim: PAL.cyan, celestial: 'moon', stars: 1 },
  neon: { sky: [PAL.ink, PAL.ink, PAL.navy, PAL.plum, PAL.red], far: PAL.plum, mid: PAL.navy, near: PAL.ink, rim: PAL.cyan, celestial: 'sun', stars: 0.9 },
  dawn: { sky: [PAL.blue, PAL.sky, PAL.cyan, PAL.silver, PAL.yellow], far: PAL.slate, mid: PAL.teal, near: PAL.shadow, rim: PAL.yellow, celestial: 'sun', stars: 0 },
};
