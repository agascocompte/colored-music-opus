import type { AudioPlayer } from '../audio/AudioPlayer';
import type { MusicFrame, TimelineQuery } from '../analysis/types';
import { VISUALIZERS } from '../visualizers/registry';
import type { Track } from '../library/sources';
import { ICONS } from './icons';
import { LibraryPanel } from './LibraryPanel';

export interface ControlsHandlers {
  openFile: (file: File) => void;
  playDemo: () => void;
  selectScene: (id: string) => void;
  playTrack: (track: Track, queue: Track[]) => void;
}

const fmt = (t: number) => {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/**
 * All DOM chrome: start screen, top bar, transport, scene selector, drag & drop,
 * auto-hide, keyboard shortcuts. Knows nothing about rendering.
 */
export class Controls {
  private songEl = el('div', 'song', '');
  private metaEl = el('div', 'meta');
  private statusEl = el('span');
  private pulseEl = el('span', 'pulse');
  private playBtn = el('button', 'icon-btn play-btn', ICONS.play);
  private curEl = el('div', 'time', '0:00');
  private durEl = el('div', 'time', '0:00');
  private progress = el('div', 'progress');
  private fill = el('div', 'fill');
  private thumb = el('div', 'thumb');
  private sectionsEl = el('div', 'sections');
  private energyCanvas = el('canvas', 'energy');
  private volBtn = el('button', 'icon-btn', ICONS.volume);
  private volInput = el('input');
  private fsBtn = el('button', 'icon-btn', ICONS.expand);
  private sceneBtns = new Map<string, HTMLButtonElement>();
  private start = el('div', 'start');
  private veil = el('div', 'drop-veil', '<div>Suelta la canción</div>');
  private toastEl = el('div', 'toast');
  private fileInput = el('input');
  private idleTimer = 0;
  private dragging = false;
  private lastVolume = 0.8;
  private toastTimer = 0;
  readonly library: LibraryPanel;

  constructor(private readonly root: HTMLElement, private readonly player: AudioPlayer, private readonly h: ControlsHandlers) {
    this.library = new LibraryPanel({ play: (t, q) => this.h.playTrack(t, q), onToggle: () => this.poke() });
    this.build();
    this.bind();
    document.body.classList.add('start-open');
  }

  private build(): void {
    const chrome = el('div', 'chrome');

    // Top bar
    const top = el('div', 'topbar');
    const brand = el('div', 'brand');
    brand.append(el('div', 'wordmark', '<b>Colored</b> Music'), this.songEl, this.metaEl);
    this.metaEl.append(this.pulseEl, this.statusEl);
    const actions = el('div', 'top-actions');
    const openBtn = el('button', 'icon-btn', ICONS.open);
    openBtn.title = 'Abrir canción (O)';
    openBtn.onclick = () => this.fileInput.click();
    this.fsBtn.title = 'Pantalla completa (F)';
    const libBtn = el('button', 'icon-btn', ICONS.list);
    libBtn.title = 'Biblioteca y búsqueda (L)';
    libBtn.onclick = () => this.library.toggle();
    actions.append(libBtn, openBtn, this.fsBtn);
    top.append(brand, actions);

    // Bottom bar
    const bottom = el('div', 'bottombar');
    const scenes = el('div', 'scenes');
    VISUALIZERS.forEach((v, i) => {
      const b = el('button', 'scene');
      b.style.setProperty('--c', v.accent);
      b.title = `${v.name} — ${v.tagline} (${i + 1})`;
      b.innerHTML = `<span class="key">${i + 1}</span><span class="label">${v.name}</span>`;
      b.onclick = () => this.h.selectScene(v.id);
      this.sceneBtns.set(v.id, b);
      scenes.append(b);
    });

    const transport = el('div', 'transport');
    this.playBtn.title = 'Reproducir / pausa (Espacio)';
    const track = el('div', 'track');
    track.append(this.fill);
    this.progress.append(this.energyCanvas, track, this.sectionsEl, this.thumb);
    this.volInput.type = 'range';
    this.volInput.min = '0';
    this.volInput.max = '1';
    this.volInput.step = '0.01';
    this.volInput.value = String(this.player.volume);
    this.volInput.setAttribute('aria-label', 'Volumen');
    this.volBtn.title = 'Silenciar (M)';
    const vol = el('div', 'volume');
    vol.append(this.volBtn, this.volInput);
    transport.append(this.playBtn, this.curEl, this.progress, this.durEl, vol);
    bottom.append(scenes, transport);

    chrome.append(top, bottom);

    // Start screen
    this.start.innerHTML = `
      <div class="start-inner">
        <div class="wordmark"><b>Colored</b> Music</div>
        <h1>Ver la música<br><span>como un lugar.</span></h1>
        <p>Carga una canción. Siete escenas la escuchan, la analizan y la convierten en luz, fluido, geometría… en una partida que se juega sola y en un duelo de magos al ritmo.</p>
        <div class="start-actions">
          <button class="btn btn-primary" data-act="open">${ICONS.open} Elegir canción</button>
          <button class="btn btn-ghost" data-act="library">${ICONS.list} Mi biblioteca</button>
          <button class="btn btn-ghost" data-act="demo">${ICONS.spark} Probar la demo</button>
        </div>
        <div class="hint">o arrastra un archivo de audio aquí · <kbd>L</kbd> biblioteca · <kbd>1</kbd>–<kbd>7</kbd> escenas · <kbd>Espacio</kbd> pausa · <kbd>F</kbd> pantalla completa</div>
      </div>`;
    (this.start.querySelector('[data-act=open]') as HTMLElement).onclick = () => this.fileInput.click();
    (this.start.querySelector('[data-act=demo]') as HTMLElement).onclick = () => this.h.playDemo();
    (this.start.querySelector('[data-act=library]') as HTMLElement).onclick = () => this.library.toggle(true);

    this.fileInput.type = 'file';
    this.fileInput.accept = 'audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.opus,.webm';
    this.fileInput.hidden = true;

    this.root.append(chrome, this.start, this.library.el, this.veil, this.toastEl, this.fileInput);
  }

  private bind(): void {
    const p = this.player;
    this.fileInput.onchange = () => {
      const f = this.fileInput.files?.[0];
      if (f) this.h.openFile(f);
      this.fileInput.value = '';
    };
    this.playBtn.onclick = () => p.toggle();
    p.on('state', () => this.syncPlay());
    p.on('loaded', () => { this.durEl.textContent = fmt(p.duration); });

    // Seek bar with pointer capture
    const seekAt = (ev: PointerEvent) => {
      const r = this.progress.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      p.seek(x * p.duration);
      this.renderProgress(x);
    };
    this.progress.addEventListener('pointerdown', (ev) => {
      if (!p.duration) return;
      this.dragging = true;
      this.progress.classList.add('dragging');
      this.progress.setPointerCapture(ev.pointerId);
      seekAt(ev);
    });
    this.progress.addEventListener('pointermove', (ev) => { if (this.dragging) seekAt(ev); });
    const end = () => { this.dragging = false; this.progress.classList.remove('dragging'); };
    this.progress.addEventListener('pointerup', end);
    this.progress.addEventListener('pointercancel', end);

    this.volInput.oninput = () => { p.setVolume(parseFloat(this.volInput.value)); this.syncVolume(); };
    this.volBtn.onclick = () => this.toggleMute();

    this.fsBtn.onclick = () => this.toggleFullscreen();
    document.addEventListener('fullscreenchange', () => {
      this.fsBtn.innerHTML = document.fullscreenElement ? ICONS.shrink : ICONS.expand;
    });

    // Drag & drop anywhere
    let depth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; this.veil.classList.add('on'); });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; this.veil.classList.remove('on'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      this.veil.classList.remove('on');
      const f = e.dataTransfer?.files?.[0];
      if (f) this.h.openFile(f);
    });

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); p.toggle(); }
      else if (k === 'arrowright') p.seek(p.time + 5);
      else if (k === 'arrowleft') p.seek(p.time - 5);
      else if (k === 'f') this.toggleFullscreen();
      else if (k === 'm') this.toggleMute();
      else if (k === 'o') this.fileInput.click();
      else if (k === 'l') this.library.toggle();
      else if (k === 'escape' && this.library.open) this.library.toggle(false);
      else if (/^[1-9]$/.test(k)) {
        const v = VISUALIZERS[parseInt(k, 10) - 1];
        if (v) this.h.selectScene(v.id);
      } else return;
      this.poke();
    });

    // Auto-hide
    const wake = () => this.poke();
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('touchstart', wake, { passive: true });
    this.poke();
  }

  private toggleMute(): void {
    const p = this.player;
    if (p.volume > 0.001) { this.lastVolume = p.volume; p.setVolume(0); }
    else p.setVolume(this.lastVolume || 0.8);
    this.volInput.value = String(p.volume);
    this.syncVolume();
  }

  private syncVolume(): void {
    this.volBtn.innerHTML = this.player.volume < 0.001 ? ICONS.mute : ICONS.volume;
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  /** Shows the chrome and schedules hiding it while music plays. */
  poke(): void {
    document.body.classList.remove('idle');
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      const hovering = document.querySelector('.bottombar:hover, .topbar:hover');
      if (this.player.playing && !this.dragging && !hovering && !this.library.open) document.body.classList.add('idle');
      else this.poke();
    }, 2600);
  }

  private syncPlay(): void {
    this.playBtn.innerHTML = this.player.playing ? ICONS.pause : ICONS.play;
    this.poke();
  }

  hideStart(): void {
    this.start.classList.add('hidden');
    document.body.classList.remove('start-open');
  }

  setSong(title: string): void {
    this.songEl.textContent = title;
    document.title = `${title} · Colored Music`;
    this.sectionsEl.innerHTML = '';
    const c = this.energyCanvas.getContext('2d');
    c?.clearRect(0, 0, this.energyCanvas.width, this.energyCanvas.height);
  }

  setStatus(text: string): void { this.statusEl.textContent = text; }

  setActiveScene(id: string): void {
    for (const [k, b] of this.sceneBtns) b.classList.toggle('active', k === id);
    const v = VISUALIZERS.find((x) => x.id === id);
    if (v) document.documentElement.style.setProperty('--accent', v.accent);
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 3500);
  }

  /** Draws section markers and the energy silhouette on the seek bar. */
  showTimeline(tl: TimelineQuery): void {
    this.sectionsEl.innerHTML = '';
    for (const s of tl.sections.slice(1)) {
      const i = el('i');
      i.style.left = `${(s.start / tl.duration) * 100}%`;
      this.sectionsEl.append(i);
    }
    const cv = this.energyCanvas;
    const w = (cv.width = 400);
    const h = (cv.height = 28);
    const c = cv.getContext('2d')!;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.beginPath();
    c.moveTo(0, h);
    for (let x = 0; x <= w; x++) {
      const e = tl.energyAt((x / w) * tl.duration);
      c.lineTo(x, h - e * h);
    }
    c.lineTo(w, h);
    c.fill();
  }

  private renderProgress(x: number): void {
    const pct = `${x * 100}%`;
    this.fill.style.width = pct;
    this.thumb.style.left = pct;
  }

  tick(music: MusicFrame): void {
    const p = this.player;
    const d = p.duration;
    const t = p.time;
    if (!this.dragging) this.renderProgress(d ? t / d : 0);
    this.curEl.textContent = fmt(t);
    this.pulseEl.style.setProperty('--beat', music.beatEnv.toFixed(3));
  }
}
