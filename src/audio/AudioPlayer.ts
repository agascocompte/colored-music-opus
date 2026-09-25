/**
 * Playback only: an <audio> element routed through Web Audio.
 *
 *   <audio> → MediaElementSource ─┬─► AnalyserNode            (analysis tap, pre-volume)
 *                                 └─► GainNode → destination   (what you hear)
 *
 * The analyser is tapped before the volume stage so turning the volume down
 * does not dim the visuals.
 */
export type PlayerEvent = 'state' | 'loaded' | 'time' | 'ended' | 'error';

export class AudioPlayer {
  readonly element: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private _analyser: AnalyserNode | null = null;
  private objectUrl: string | null = null;
  private listeners = new Map<PlayerEvent, Set<() => void>>();
  private _volume = 0.8;
  title = '';

  // Interpolated clock: HTMLMediaElement.currentTime updates coarsely.
  private clockMedia = 0;
  private clockPerf = 0;

  constructor() {
    this.element = new Audio();
    this.element.preload = 'auto';
    this.element.crossOrigin = 'anonymous';
    const el = this.element;
    el.addEventListener('play', () => this.emit('state'));
    el.addEventListener('pause', () => this.emit('state'));
    el.addEventListener('ended', () => this.emit('ended'));
    el.addEventListener('loadedmetadata', () => this.emit('loaded'));
    el.addEventListener('timeupdate', () => this.emit('time'));
    el.addEventListener('seeked', () => this.resyncClock());
    el.addEventListener('error', () => this.emit('error'));
  }

  /** Must be called from a user gesture the first time. */
  ensureContext(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.source = ctx.createMediaElementSource(this.element);
      this._analyser = ctx.createAnalyser();
      this._analyser.fftSize = 2048;
      this._analyser.smoothingTimeConstant = 0;
      this._analyser.minDecibels = -100;
      this._analyser.maxDecibels = -10;
      this.gain = ctx.createGain();
      this.gain.gain.value = this._volume * this._volume;
      this.source.connect(this._analyser);
      this.source.connect(this.gain);
      this.gain.connect(ctx.destination);
      this.ctx = ctx;
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    return this.ctx;
  }

  get context(): AudioContext | null { return this.ctx; }
  get analyser(): AnalyserNode | null { return this._analyser; }
  get hasSource(): boolean { return !!this.element.src; }
  get playing(): boolean { return !this.element.paused && !this.element.ended; }
  get duration(): number { return Number.isFinite(this.element.duration) ? this.element.duration : 0; }
  get volume(): number { return this._volume; }

  /** Seconds of delay between currentTime and what reaches the speakers. */
  get outputLatency(): number {
    if (!this.ctx) return 0;
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }

  on(ev: PlayerEvent, fn: () => void): () => void {
    let set = this.listeners.get(ev);
    if (!set) this.listeners.set(ev, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  private emit(ev: PlayerEvent): void {
    if (ev === 'state') this.resyncClock();
    this.listeners.get(ev)?.forEach((fn) => fn());
  }

  async load(src: Blob | string, title: string): Promise<void> {
    this.ensureContext();
    this.element.pause();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    const url = typeof src === 'string' ? src : (this.objectUrl = URL.createObjectURL(src));
    this.title = title;
    this.element.src = url;
    this.element.currentTime = 0;
    this.resyncClock();
    await new Promise<void>((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const ko = () => { cleanup(); reject(new Error('No se pudo leer el audio')); };
      const cleanup = () => {
        this.element.removeEventListener('canplay', ok);
        this.element.removeEventListener('error', ko);
      };
      this.element.addEventListener('canplay', ok);
      this.element.addEventListener('error', ko);
    });
  }

  async play(): Promise<void> {
    if (!this.hasSource) return;
    this.ensureContext();
    try { await this.element.play(); } catch { /* autoplay refusal: UI stays paused */ }
  }

  pause(): void { this.element.pause(); }

  toggle(): void { if (this.playing) this.pause(); else void this.play(); }

  seek(t: number): void {
    if (!this.duration) return;
    this.element.currentTime = Math.max(0, Math.min(this.duration - 0.05, t));
    this.resyncClock();
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    // Perceptual curve.
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(this._volume * this._volume, this.ctx.currentTime, 0.02);
  }

  private resyncClock(): void {
    this.clockMedia = this.element.currentTime;
    this.clockPerf = performance.now();
  }

  /** Smooth song time, interpolated between the element's coarse updates. */
  get time(): number {
    const el = this.element;
    if (el.paused) return el.currentTime;
    const now = performance.now();
    const predicted = this.clockMedia + (now - this.clockPerf) / 1000 * el.playbackRate;
    const actual = el.currentTime;
    // Re-anchor if we drifted (seek, stall, tab throttling).
    if (Math.abs(predicted - actual) > 0.08) { this.clockMedia = actual; this.clockPerf = now; return actual; }
    // Gently pull towards the reported time.
    this.clockMedia += (actual - predicted) * 0.05;
    return Math.max(predicted, 0);
  }
}
