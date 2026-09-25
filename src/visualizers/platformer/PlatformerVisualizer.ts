import type { MusicFrame } from '../../analysis/types';
import { makeCanvas } from '../common/gl';
import type { Visualizer } from '../types';
import { Game } from './Game';

/**
 * RUNNER — adapter between the visualizer host and the pixel-art game.
 * The game renders into a small offscreen canvas (≈200–260 px tall) and is
 * scaled up by an integer factor with smoothing disabled, so pixels stay square
 * and crisp at any resolution or aspect ratio.
 */
const TARGET_H = 200;
const MIN_W = 240;

export default class PlatformerVisualizer implements Visualizer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private low = document.createElement('canvas');
  private lctx = this.low.getContext('2d', { alpha: false })!;
  private scale = 3;
  private game = new Game();

  mount(layer: HTMLElement): void {
    this.canvas = makeCanvas(layer);
    this.canvas.style.imageRendering = 'pixelated';
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    // Exposed for the automated visual checks (scratch/game.mjs).
    (window as unknown as { __game?: Game }).__game = this.game;
  }

  resize(width: number, height: number, dpr: number): void {
    const devW = Math.round(width * dpr);
    const devH = Math.round(height * dpr);
    this.canvas.width = devW;
    this.canvas.height = devH;
    // Integer scale so the logical view is close to TARGET_H tall.
    // Portrait screens: keep at least ~240 px of world visible horizontally.
    this.scale = Math.max(1, Math.min(Math.round(devH / TARGET_H), Math.floor(devW / MIN_W)));
    this.game.hudTop = Math.ceil((84 * dpr) / this.scale);
    this.low.width = Math.ceil(devW / this.scale);
    this.low.height = Math.ceil(devH / this.scale);
    this.lctx.imageSmoothingEnabled = false;
    this.ctx.imageSmoothingEnabled = false;
  }

  update(m: MusicFrame): void {
    this.game.update(m, this.low.width, this.low.height);
  }

  render(): void {
    this.game.render(this.lctx, this.low.width, this.low.height);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.low, 0, 0, this.low.width * this.scale, this.low.height * this.scale);
  }

  dispose(): void {
    this.canvas.remove();
  }
}
