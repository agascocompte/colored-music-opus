import { fetchLibrary, searchItunes, type Track } from '../library/sources';
import { ICONS } from './icons';

export interface LibraryHandlers {
  play: (track: Track, queue: Track[]) => void;
  onToggle?: (open: boolean) => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Side panel with two tabs: the shared library (colored-music-library) and an
 * iTunes search (30-second previews). Pure DOM; playback is delegated.
 */
export class LibraryPanel {
  readonly el = document.createElement('aside');
  private list = document.createElement('ul');
  private status = document.createElement('div');
  private searchRow = document.createElement('form');
  private input = document.createElement('input');
  private tabs: Record<'library' | 'search', HTMLButtonElement> = {
    library: document.createElement('button'),
    search: document.createElement('button'),
  };
  private tab: 'library' | 'search' = 'library';
  private library: Track[] | null = null;
  private libraryError = false;
  private results: Track[] = [];
  private searchAbort: AbortController | null = null;
  private currentId = '';
  private loadingId = '';
  open = false;

  constructor(private readonly h: LibraryHandlers) {
    this.el.className = 'library';
    this.el.setAttribute('aria-label', 'Biblioteca');
    const head = document.createElement('div');
    head.className = 'library-head';
    const tabs = document.createElement('div');
    tabs.className = 'library-tabs';
    this.tabs.library.textContent = 'Mi biblioteca';
    this.tabs.search.textContent = 'Buscar';
    this.tabs.library.onclick = () => this.showTab('library');
    this.tabs.search.onclick = () => this.showTab('search');
    tabs.append(this.tabs.library, this.tabs.search);
    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.innerHTML = ICONS.close;
    close.title = 'Cerrar (L)';
    close.onclick = () => this.toggle(false);
    head.append(tabs, close);

    this.searchRow.className = 'library-search';
    this.input.type = 'search';
    this.input.placeholder = 'Canción o artista…';
    this.input.setAttribute('aria-label', 'Buscar en iTunes');
    const go = document.createElement('button');
    go.type = 'submit';
    go.className = 'btn btn-primary';
    go.textContent = 'Buscar';
    this.searchRow.append(this.input, go);
    this.searchRow.onsubmit = (e) => { e.preventDefault(); void this.search(); };

    this.status.className = 'library-status';
    this.list.className = 'library-list';
    const foot = document.createElement('div');
    foot.className = 'library-foot';
    foot.textContent = 'Las búsquedas reproducen la vista previa de 30 s de iTunes.';
    this.el.append(head, this.searchRow, this.status, this.list, foot);
    this.showTab('library');
  }

  toggle(open = !this.open): void {
    this.open = open;
    this.el.classList.toggle('open', open);
    document.body.classList.toggle('library-open', open);
    if (open && this.tab === 'library' && !this.library) void this.loadLibrary();
    if (open && this.tab === 'search') setTimeout(() => this.input.focus(), 250);
    this.h.onToggle?.(open);
  }

  showTab(tab: 'library' | 'search'): void {
    this.tab = tab;
    this.tabs.library.classList.toggle('active', tab === 'library');
    this.tabs.search.classList.toggle('active', tab === 'search');
    this.searchRow.hidden = tab !== 'search';
    if (tab === 'library' && !this.library && this.open) void this.loadLibrary();
    if (tab === 'search' && this.open) setTimeout(() => this.input.focus(), 50);
    this.render();
  }

  setCurrent(id: string): void {
    this.currentId = id;
    this.loadingId = '';
    this.render();
  }

  setLoading(id: string): void {
    this.loadingId = id;
    this.render();
  }

  /** Track that follows `id` in the list it came from (for auto-advance). */
  nextAfter(id: string): { track: Track; queue: Track[] } | null {
    for (const q of [this.library ?? [], this.results]) {
      const i = q.findIndex((t) => t.id === id);
      if (i >= 0 && q.length > 1) return { track: q[(i + 1) % q.length], queue: q };
    }
    return null;
  }

  async loadLibrary(): Promise<void> {
    this.libraryError = false;
    this.render();
    try {
      this.library = await fetchLibrary();
    } catch {
      this.libraryError = true;
    }
    this.render();
  }

  private async search(): Promise<void> {
    const q = this.input.value.trim();
    if (!q) return;
    this.searchAbort?.abort();
    const ctl = (this.searchAbort = new AbortController());
    this.results = [];
    this.status.textContent = 'Buscando…';
    this.list.innerHTML = '';
    try {
      this.results = await searchItunes(q, ctl.signal);
      this.render();
      if (!this.results.length) this.status.textContent = 'Sin resultados.';
    } catch (err) {
      if ((err as Error).name !== 'AbortError') this.status.textContent = 'No se pudo buscar. Revisa la conexión.';
    }
  }

  private render(): void {
    const tracks = this.tab === 'library' ? this.library : this.results;
    if (this.tab === 'library') {
      this.status.textContent = this.libraryError ? 'No se pudo cargar la biblioteca compartida.' : this.library ? `${this.library.length} canciones` : 'Cargando biblioteca…';
    } else if (!this.results.length && !this.status.textContent) {
      this.status.textContent = 'Busca cualquier canción del catálogo de iTunes.';
    } else if (this.results.length) this.status.textContent = `${this.results.length} resultados`;
    this.list.innerHTML = '';
    if (!tracks) return;
    tracks.forEach((t, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'track';
      if (t.id === this.currentId) b.classList.add('current');
      if (t.id === this.loadingId) b.classList.add('loading');
      const art = t.artwork ? `<img src="${esc(t.artwork)}" alt="" loading="lazy">` : `<span class="num">${i + 1}</span>`;
      b.innerHTML = `${art}<span class="meta"><span class="t">${esc(t.title)}</span>${t.artist ? `<span class="a">${esc(t.artist)}</span>` : ''}</span><span class="state"></span>`;
      b.onclick = () => this.h.play(t, tracks);
      li.append(b);
      this.list.append(li);
    });
  }
}
