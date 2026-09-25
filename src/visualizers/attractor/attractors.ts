/**
 * Strange attractors. Each one integrates in its own space; `center`/`scale`
 * normalize it into roughly [-1, 1] and `basis` orients it for display
 * (row-major 3×3, applied to the normalized position).
 */
export interface AttractorDef {
  name: string;
  center: [number, number, number];
  scale: number;
  dt: number;
  /** Typical speed, used to normalize particle speed for coloring. */
  speedRef: number;
  basis: number[];
  /**
   * Integrates `n` particles in place for one step.
   * `mod` / `mod2` are 0..1 music modulations. They are kept tiny on purpose:
   * larger swings push the system out of its chaotic regime and the swarm
   * collapses onto one periodic orbit (it looks broken and stops evolving).
   * The music drives flow speed, camera, color and pulses instead.
   */
  step(pos: Float32Array, speed: Float32Array, n: number, dt: number, mod: number, mod2: number): void;
}

const Z_UP = [1, 0, 0, 0, 0, 1, 0, 1, 0];
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const ATTRACTORS: AttractorDef[] = [
  {
    name: 'Aizawa',
    center: [0, 0, 0.6], scale: 0.62, dt: 0.012, speedRef: 1.6, basis: Z_UP,
    step(p, s, n, dt, mod, mod2) {
      const a = 0.95, b = 0.7, c = 0.6, d = 3.5 + mod2 * 0.05, e = 0.25, f = 0.1 + mod * 0.01;
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        const x = p[j], y = p[j + 1], z = p[j + 2];
        const dx = (z - b) * x - d * y;
        const dy = d * x + (z - b) * y;
        const dz = c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x;
        p[j] = x + dx * dt; p[j + 1] = y + dy * dt; p[j + 2] = z + dz * dt;
        s[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    },
  },
  {
    name: 'Lorenz',
    center: [0, 0, 25], scale: 1 / 40, dt: 0.0035, speedRef: 120, basis: Z_UP,
    step(p, s, n, dt, mod, mod2) {
      const sigma = 10, rho = 28 + mod * 2, beta = 8 / 3 + mod2 * 0.05;
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        const x = p[j], y = p[j + 1], z = p[j + 2];
        const dx = sigma * (y - x);
        const dy = x * (rho - z) - y;
        const dz = x * y - beta * z;
        p[j] = x + dx * dt; p[j + 1] = y + dy * dt; p[j + 2] = z + dz * dt;
        s[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    },
  },
  {
    name: 'Thomas',
    center: [0, 0, 0], scale: 0.24, dt: 0.07, speedRef: 1.4, basis: ID,
    step(p, s, n, dt, mod, mod2) {
      const b = 0.19 - mod * 0.01 + mod2 * 0.004;
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        const x = p[j], y = p[j + 1], z = p[j + 2];
        const dx = Math.sin(y) - b * x;
        const dy = Math.sin(z) - b * y;
        const dz = Math.sin(x) - b * z;
        p[j] = x + dx * dt; p[j + 1] = y + dy * dt; p[j + 2] = z + dz * dt;
        s[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    },
  },
  {
    name: 'Halvorsen',
    center: [-3, -3, -3], scale: 1 / 8.5, dt: 0.005, speedRef: 25, basis: ID,
    step(p, s, n, dt, mod) {
      const a = 1.89 - mod * 0.06;
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        const x = p[j], y = p[j + 1], z = p[j + 2];
        const dx = -a * x - 4 * y - 4 * z - y * y;
        const dy = -a * y - 4 * z - 4 * x - z * z;
        const dz = -a * z - 4 * x - 4 * y - x * x;
        p[j] = x + dx * dt; p[j + 1] = y + dy * dt; p[j + 2] = z + dz * dt;
        s[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    },
  },
  {
    name: 'Rössler',
    center: [0, 0, 3], scale: 1 / 12, dt: 0.025, speedRef: 12, basis: Z_UP,
    step(p, s, n, dt, mod, mod2) {
      const a = 0.2, b = 0.2, c = 5.7 + mod * 0.15;
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        const x = p[j], y = p[j + 1], z = p[j + 2];
        const dx = -y - z;
        const dy = x + a * y;
        const dz = b + z * (x - c);
        p[j] = x + dx * dt; p[j + 1] = y + dy * dt; p[j + 2] = z + dz * dt;
        s[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    },
  },
];
