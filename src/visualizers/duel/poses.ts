/**
 * Wizard poses: a handful of numbers blended between keyframes, so every move
 * travels (the staff swings from the wind-up into the cast) instead of popping.
 *
 * Local space: facing right, +x forward, +y down, offsets in pixels.
 */
export type PoseName =
  | 'idle' | 'idle2' | 'taunt' | 'charge' | 'castWind' | 'castF' | 'castUp' | 'slam' | 'channel'
  | 'block' | 'swingWind' | 'swing' | 'swingUp' | 'hit' | 'knock' | 'down' | 'float' | 'dash' | 'victory';

export interface WPose {
  /** Upper body shift forward. */
  lean: number;
  crouch: number;
  /** Whole-body rotation around the feet (negative = falling backwards). */
  tilt: number;
  /** Staff angle: 0 points forward, -π/2 straight up. */
  sa: number;
  /** Front hand relative to the shoulder. */
  hx: number;
  hy: number;
  /** Free hand relative to the shoulder. */
  bx: number;
  by: number;
  /** Where along the staff the hand grips (0 = bottom, 1 = head). */
  grip: number;
  /** Robe hem flare 0..1. */
  flare: number;
  /** Eyes blaze 0..1. */
  eye: number;
}

const P = (lean: number, crouch: number, tilt: number, sa: number, hx: number, hy: number, bx: number, by: number, grip: number, flare: number, eye: number): WPose =>
  ({ lean, crouch, tilt, sa, hx, hy, bx, by, grip, flare, eye });

const UP = -Math.PI / 2;

export const POSES: Record<PoseName, WPose> = {
  idle: P(0, 0, 0, -1.3, 3, 3, -2, 4, 0.45, 0, 0),
  idle2: P(1, 1, 0, -1.15, 4, 2, -1, 3, 0.45, 0.1, 0),
  taunt: P(-1, 0, 0, -0.5, 4, 1, 4, -4, 0.4, 0.2, 0.4),
  charge: P(0, 1, 0, UP, 2, -5, -4, -2, 0.35, 0.7, 1),
  castWind: P(-2, 1, 0, -2.4, -1, -2, 3, 2, 0.35, 0.3, 0.6),
  castF: P(3, 0, 0, -0.12, 6, 1, -3, 3, 0.3, 0.5, 1),
  castUp: P(-1, 0, 0, UP - 0.1, 1, -7, 2, -6, 0.3, 0.6, 1),
  slam: P(2, 3, 0, 1.1, 4, 4, 3, 4, 0.4, 0.9, 1),
  channel: P(2, 1, 0, -0.05, 5, 1, 4, 2, 0.3, 0.6, 1),
  block: P(-1, 1, 0, UP, 5, 0, 3, 2, 0.5, 0.3, 0.5),
  swingWind: P(-2, 1, 0, -2.7, -2, -3, -1, 1, 0.2, 0.3, 0.5),
  swing: P(4, 1, 0, 0.45, 6, 2, -3, 2, 0.2, 0.6, 0.8),
  swingUp: P(2, 0, 0, -1.95, 4, -4, -3, 1, 0.2, 0.5, 0.8),
  hit: P(-3, 1, -0.28, -2.1, 0, 0, -4, -2, 0.45, 0.4, 0),
  knock: P(-3, 0, -0.9, -2.5, -1, -2, -4, -4, 0.45, 1, 0),
  down: P(0, 0, -1.5, -2.9, 0, 1, -2, 2, 0.45, 0, 0),
  float: P(0, 0, 0, -1.15, 3, 2, -3, 1, 0.45, 0.8, 0.3),
  dash: P(5, 1, 0.12, 2.9, -2, 2, -3, 2, 0.45, 1, 0.5),
  victory: P(0, 0, 0, UP, 2, -8, -3, 1, 0.35, 0.3, 1),
};

export function blendPose(a: WPose, b: WPose, t: number, out: WPose): WPose {
  const e = t * t * (3 - 2 * t);
  for (const k of Object.keys(out) as (keyof WPose)[]) out[k] = a[k] + (b[k] - a[k]) * e;
  return out;
}

export const newPose = (): WPose => ({ ...POSES.idle });
