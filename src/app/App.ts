import { AudioPlayer } from '../audio/AudioPlayer';
import { DEMO_TITLE, renderDemoTrack } from '../audio/demoTrack';
import { MusicEngine } from '../analysis/MusicEngine';
import { SongAnalysis } from '../analysis/SongAnalysis';
import type { Timeline } from '../analysis/timeline/Timeline';
import { downloadTrack, trackLabel, type Track } from '../library/sources';
import { Controls } from '../ui/Controls';
import { VisualizerHost } from '../visualizers/VisualizerHost';
import { VISUALIZERS } from '../visualizers/registry';

const STORAGE_KEY = 'colored-music-opus:scene';

/** Wires playback, analysis, UI and visualizers together, and runs the frame loop. */
export class App {
  private readonly player = new AudioPlayer();
  private readonly engine = new MusicEngine();
  private readonly analysis = new SongAnalysis();
  private readonly host: VisualizerHost;
  private readonly controls: Controls;
  private lastNow = 0;
  private loadToken = 0;
  private currentTrack: Track | null = null;
  /** Bumped on every song request so slow downloads can be discarded. */
  private request = 0;

  constructor(root: HTMLElement) {
    const stage = document.createElement('div');
    stage.id = 'stage';
    root.append(stage);
    this.host = new VisualizerHost(stage);
    this.controls = new Controls(root, this.player, {
      openFile: (f) => void this.openFile(f),
      playDemo: () => void this.playDemo(),
      selectScene: (id) => void this.selectScene(id),
      playTrack: (t) => void this.playTrack(t),
    });

    let initial = VISUALIZERS[0].id;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const hash = location.hash.slice(1);
      if (VISUALIZERS.some((v) => v.id === hash)) initial = hash;
      else if (saved && VISUALIZERS.some((v) => v.id === saved)) initial = saved;
    } catch { /* storage unavailable */ }
    void this.selectScene(initial);

    this.player.on('ended', () => {
      this.controls.poke();
      // Library / search playback continues with the next track in the list.
      const next = this.currentTrack ? this.controls.library.nextAfter(this.currentTrack.id) : null;
      if (next) void this.playTrack(next.track);
    });
    this.player.on('error', () => this.controls.toast('No se pudo reproducir este archivo.'));

    // Debug/test hook
    (window as unknown as { __app: App }).__app = this;

    requestAnimationFrame(this.loop);
  }

  async selectScene(id: string): Promise<void> {
    this.controls.setActiveScene(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
    try {
      await this.host.show(id);
    } catch (err) {
      console.error(err);
      this.controls.toast('Esta escena necesita WebGL2, que no está disponible.');
    }
  }

  private async playTrack(t: Track): Promise<void> {
    this.player.ensureContext();
    const req = ++this.request;
    const title = trackLabel(t);
    this.controls.library.setLoading(t.id);
    this.controls.hideStart();
    this.controls.setSong(title);
    this.controls.setStatus('Descargando…');
    let blob: Blob;
    try {
      blob = await downloadTrack(t);
    } catch {
      this.controls.library.setLoading('');
      this.controls.toast('No se pudo descargar esta canción.');
      return;
    }
    if (req !== this.request) return; // another song was requested meanwhile
    this.currentTrack = t;
    this.controls.library.setCurrent(t.id);
    await this.startSong(blob, title, (ctx) => this.analysis.analyzeBlob(ctx, blob, this.progress));
  }

  private async openFile(file: File): Promise<void> {
    this.request++;
    this.currentTrack = null;
    this.controls.library.setCurrent('');
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i.test(file.name)) {
      this.controls.toast('Eso no parece un archivo de audio.');
      return;
    }
    const title = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
    await this.startSong(file, title, (ctx) => this.analysis.analyzeBlob(ctx, file, this.progress));
  }

  private async playDemo(): Promise<void> {
    this.player.ensureContext();
    this.request++;
    this.currentTrack = null;
    this.controls.library.setCurrent('');
    this.controls.hideStart();
    this.controls.setSong(DEMO_TITLE);
    this.controls.setStatus('Sintetizando la demo…');
    const { buffer, wav } = await renderDemoTrack();
    await this.startSong(wav, DEMO_TITLE, () => this.analysis.analyzeBuffer(buffer, this.progress));
  }

  private progress = (p: number) => this.controls.setStatus(`Analizando estructura · ${Math.round(p * 100)}%`);

  private async startSong(src: Blob, title: string, analyze: (ctx: AudioContext) => Promise<Timeline>): Promise<void> {
    const token = ++this.loadToken;
    const ctx = this.player.ensureContext();
    this.analysis.cancelAll();
    this.engine.reset(title);
    this.controls.hideStart();
    this.controls.setSong(title);
    this.controls.setStatus('Cargando…');
    try {
      await this.player.load(src, title);
    } catch {
      this.controls.toast('No se pudo leer el audio.');
      return;
    }
    if (token !== this.loadToken) return;
    await this.player.play();
    this.engine.resync(0);
    this.controls.setStatus('Analizando estructura…');
    try {
      const tl = await analyze(ctx);
      if (token !== this.loadToken) return;
      this.engine.setTimeline(tl);
      this.controls.showTimeline(tl);
      const drops = tl.sections.filter((s) => s.isDrop).length;
      this.controls.setStatus(`${Math.round(tl.bpm)} BPM · ${tl.sections.length} secciones${drops ? ` · ${drops} drop${drops > 1 ? 's' : ''}` : ''}`);
    } catch (err) {
      if (token !== this.loadToken) return;
      console.warn(err);
      this.controls.setStatus('Análisis en vivo');
    }
  }

  private loop = (now: number) => {
    const dt = this.lastNow ? Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000)) : 1 / 60;
    this.lastNow = now;
    if (this.player.analyser) this.engine.realtime.attach(this.player.analyser);
    const music = this.engine.update(this.player.time, dt, this.player.playing, this.player.outputLatency);
    this.host.tick(music);
    this.controls.tick(music);
    requestAnimationFrame(this.loop);
  };
}
