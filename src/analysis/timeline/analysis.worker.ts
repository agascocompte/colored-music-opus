/// <reference lib="webworker" />
import { analyzeSong } from './offlineAnalysis';

interface Request { id: number; samples: Float32Array; sampleRate: number }

self.onmessage = (ev: MessageEvent<Request>) => {
  const { id, samples, sampleRate } = ev.data;
  try {
    const data = analyzeSong(samples, sampleRate, (p) => self.postMessage({ id, progress: p }));
    const transfer = [
      data.beats, data.kickT, data.kickS, data.snareT, data.snareS,
      data.hatT, data.hatS, data.energy, data.sections,
    ].map((a) => a.buffer as ArrayBuffer);
    (self as unknown as Worker).postMessage({ id, data }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
