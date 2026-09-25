/**
 * Causal onset detector over a novelty signal (e.g. band spectral flux).
 * Shared by the realtime analyzer and the offline worker.
 *
 * - Adaptive threshold: running mean + k * running deviation (time-based EMAs, so
 *   it works at any frame rate).
 * - Hysteresis: after firing, the signal must fall back under a lower "re-arm"
 *   level before another onset can fire.
 * - Cooldown: minimum time between onsets.
 * - Strength is normalized against a slowly decaying peak so it is comparable
 *   across quiet and loud songs.
 */
export interface OnsetOptions {
  /** Sensitivity: higher = fewer onsets. */
  k: number;
  /** Minimum seconds between onsets. */
  cooldown: number;
  /** Time constant (s) of the adaptive statistics. */
  tau: number;
  /** Absolute floor under which nothing fires (avoids noise in silence). */
  floor: number;
}

export class OnsetDetector {
  private mean = 0;
  private dev = 0;
  private armed = true;
  private lastTime = -1e9;
  private peak = 1e-6;
  private prevT = -1;
  private readonly o: OnsetOptions;
  /** Raw excess over the running mean of the last fired onset. */
  lastExcess = 0;

  constructor(options: Partial<OnsetOptions> = {}) {
    this.o = { k: 1.6, cooldown: 0.1, tau: 0.5, floor: 0.02, ...options };
  }

  reset(): void {
    this.mean = 0;
    this.dev = 0;
    this.armed = true;
    this.lastTime = -1e9;
    this.prevT = -1;
  }

  /**
   * Feed one novelty sample taken at time `t` (seconds).
   * Returns onset strength (0..1] if an onset fires, or 0.
   */
  push(value: number, t: number): number {
    const dt = this.prevT < 0 ? 1 / 60 : Math.max(1e-4, Math.min(0.25, t - this.prevT));
    this.prevT = t;
    const a = 1 - Math.exp(-dt / this.o.tau);

    const threshold = this.mean + this.o.k * this.dev + this.o.floor;
    const rearm = this.mean + 0.5 * this.o.k * this.dev + this.o.floor * 0.5;

    let fired = 0;
    if (!this.armed && value < rearm) this.armed = true;
    if (this.armed && value > threshold && t - this.lastTime >= this.o.cooldown) {
      this.armed = false;
      this.lastTime = t;
      const excess = value - this.mean;
      this.lastExcess = excess;
      this.peak = Math.max(this.peak * 0.98, excess);
      fired = Math.min(1, Math.max(0.05, excess / this.peak));
    }
    // Slow decay of the reference peak (~20 s)
    this.peak = Math.max(1e-6, this.peak * (1 - dt / 20));

    // Update statistics after the decision so the onset itself doesn't mask itself.
    const d = value - this.mean;
    this.mean += a * d;
    this.dev += a * (Math.abs(d) - this.dev);
    return fired;
  }
}
