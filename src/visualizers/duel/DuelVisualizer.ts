import type { MusicFrame } from '../../analysis/types';
import { makeCanvas } from '../common/gl';
import type { Visualizer } from '../types';
import { DuelGame } from './DuelGame';

/**
 * DUEL — adapter between the visualizer host and the wizard duel.
 * The game renders into a small offscreen canvas and is scaled up by an
 * integer factor with smoothing disabled, so pixels stay square and crisp.
 */
const TARGET_H = 150;
const MIN_W = 210;

export default class DuelVisualizer implements Visualizer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private low = document.createElement('canvas');
  private lctx = this.low.getContext('2d', { alpha: false })!;
  private scale = 3;
  private game = new DuelGame();

  mount(layer: HTMLElement): void {
    this.canvas = makeCanvas(layer);
    this.canvas.style.imageRendering = 'pixelated';
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    // Exposed for the automated visual checks.
    (window as unknown as { __duel?: DuelGame }).__duel = this.game;
  }

  resize(width: number, height: number, dpr: number): void {
    const devW = Math.round(width * dpr);
    const devH = Math.round(height * dpr);
    this.canvas.width = devW;
    this.canvas.height = devH;
    this.scale = Math.max(1, Math.min(Math.round(devH / TARGET_H), Math.floor(devW / MIN_W)));
    this.game.hudTop = Math.ceil((84 * dpr) / this.scale);
    this.low.width = Math.ceil(devW / this.scale);
    this.low.height = Math.ceil(devH / this.scale);
    this.lctx.imageSmoothingEnabled = false;
    this.ctx.imageSmoothingEnabled = false;
  }

  update(m: MusicFrame): void {
    this.game.update(m);
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
