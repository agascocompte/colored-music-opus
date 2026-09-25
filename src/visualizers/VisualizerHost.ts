import type { MusicFrame } from '../analysis/types';
import { VISUALIZERS } from './registry';
import type { Visualizer, VisualizerDescriptor } from './types';

interface Slot {
  desc: VisualizerDescriptor;
  vis: Visualizer;
  layer: HTMLElement;
  /** 0..1 opacity driven by the crossfade. */
  alpha: number;
  leaving: boolean;
}

const FADE_SECONDS = 0.6;

/**
 * Owns the lifecycle of scenes: lazy loading, crossfading, resizing, disposal.
 * Switching scenes never touches playback.
 */
export class VisualizerHost {
  private slots: Slot[] = [];
  private width = 1;
  private height = 1;
  private dpr = 1;
  private requestId = 0;
  private observer: ResizeObserver;
  current: VisualizerDescriptor | null = null;
  onChange?: (desc: VisualizerDescriptor) => void;

  constructor(private readonly root: HTMLElement) {
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(root);
    this.measure();
  }

  private measure(): void {
    const r = this.root.getBoundingClientRect();
    this.width = Math.max(1, Math.round(r.width));
    this.height = Math.max(1, Math.round(r.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const s of this.slots) s.vis.resize(this.width, this.height, this.dpr);
  }

  async show(id: string): Promise<void> {
    const desc = VISUALIZERS.find((v) => v.id === id) ?? VISUALIZERS[0];
    if (this.current?.id === desc.id) return;
    const req = ++this.requestId;
    this.current = desc;
    this.onChange?.(desc);

    const mod = await desc.load();
    if (req !== this.requestId) return; // a newer request superseded this one

    const layer = document.createElement('div');
    layer.className = 'vis-layer';
    layer.style.opacity = '0';
    this.root.appendChild(layer);
    const vis = new mod.default();
    vis.mount(layer);
    vis.resize(this.width, this.height, this.dpr);

    for (const s of this.slots) s.leaving = true;
    this.slots.push({ desc, vis, layer, alpha: 0, leaving: false });
  }

  tick(music: MusicFrame): void {
    const step = music.dt / FADE_SECONDS;
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      if (s.leaving) {
        s.alpha -= step;
        if (s.alpha <= 0) {
          s.vis.dispose();
          s.layer.remove();
          this.slots.splice(i, 1);
          continue;
        }
      } else {
        s.alpha = Math.min(1, s.alpha + step);
      }
      s.layer.style.opacity = String(s.alpha * s.alpha * (3 - 2 * s.alpha));
      s.vis.update(music);
      s.vis.render();
    }
  }

  dispose(): void {
    this.observer.disconnect();
    for (const s of this.slots) { s.vis.dispose(); s.layer.remove(); }
    this.slots = [];
  }
}
