import type { MusicFrame } from '../analysis/types';

/**
 * Contract every scene implements. A visualizer owns its canvas and GPU
 * resources; the host only mounts, resizes, ticks and disposes it.
 */
export interface Visualizer {
  /** Create the canvas inside `layer` and allocate resources. */
  mount(layer: HTMLElement): void;
  /** CSS pixel size and device pixel ratio of the layer. */
  resize(width: number, height: number, dpr: number): void;
  /** Advance simulation using the shared music frame. */
  update(music: MusicFrame): void;
  /** Draw the current state. */
  render(): void;
  /** Release every resource (GL contexts, listeners, pools). */
  dispose(): void;
}

export interface VisualizerDescriptor {
  id: string;
  name: string;
  /** One-line description shown in the selector. */
  tagline: string;
  /** Accent color for the selector. */
  accent: string;
  load: () => Promise<{ default: new () => Visualizer }>;
}
