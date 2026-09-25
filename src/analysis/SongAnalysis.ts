import { Timeline } from './timeline/Timeline';
import type { TimelineData } from './timeline/offlineAnalysis';

/** Runs the offline analysis in a worker. One worker, reused across songs. */
export class SongAnalysis {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (t: Timeline) => void; reject: (e: Error) => void; progress?: (p: number) => void }>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./timeline/analysis.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { id: number; progress?: number; data?: TimelineData; error?: string };
        const p = this.pending.get(msg.id);
        if (!p) return;
        if (msg.progress !== undefined) { p.progress?.(msg.progress); return; }
        this.pending.delete(msg.id);
        if (msg.error || !msg.data) p.reject(new Error(msg.error ?? 'analysis failed'));
        else p.resolve(new Timeline(msg.data));
      };
    }
    return this.worker;
  }

  /** Cancels any in-flight analysis (results are dropped). */
  cancelAll(): void {
    for (const p of this.pending.values()) p.reject(new Error('cancelled'));
    this.pending.clear();
  }

  analyzeBuffer(buffer: AudioBuffer, progress?: (p: number) => void): Promise<Timeline> {
    const mono = new Float32Array(buffer.length);
    const chans = buffer.numberOfChannels;
    for (let c = 0; c < chans; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / chans;
    }
    const id = this.nextId++;
    return new Promise<Timeline>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.ensureWorker().postMessage({ id, samples: mono, sampleRate: buffer.sampleRate }, [mono.buffer]);
    });
  }

  async analyzeBlob(ctx: BaseAudioContext, blob: Blob, progress?: (p: number) => void): Promise<Timeline> {
    const bytes = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    return this.analyzeBuffer(buffer, progress);
  }
}
