/**
 * Remote song sources: the shared catalogue (colored-music-library, the same
 * one used by colored-music and colored-music-astra) and iTunes 30-second previews.
 */
export interface Track {
  id: string;
  title: string;
  artist?: string;
  url: string;
  artwork?: string;
  source: 'library' | 'itunes';
}

export const LIBRARY_URL = 'https://agascocompte.github.io/colored-music-library/library.json';

interface CatalogueEntry { id?: string; title?: string; artist?: string; url?: string }

export async function fetchLibrary(): Promise<Track[]> {
  const catalogueUrl = new URL(LIBRARY_URL);
  catalogueUrl.searchParams.set('v', String(Date.now()));
  const res = await fetch(catalogueUrl.href, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { tracks?: CatalogueEntry[] };
  const out: Track[] = [];
  for (const t of Array.isArray(data.tracks) ? data.tracks : []) {
    if (!t || typeof t.title !== 'string' || typeof t.url !== 'string') continue;
    const url = new URL(t.url, LIBRARY_URL);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    out.push({ id: `lib:${t.id ?? t.url}`, title: t.title, artist: typeof t.artist === 'string' ? t.artist : undefined, url: url.href, source: 'library' });
  }
  return out;
}

interface ItunesResult { trackId: number; trackName: string; artistName: string; previewUrl?: string; artworkUrl100?: string; artworkUrl60?: string }

export async function searchItunes(query: string, signal?: AbortSignal): Promise<Track[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=20`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { results?: ItunesResult[] };
  return (data.results ?? [])
    .filter((r) => r.previewUrl)
    .map((r) => ({
      id: `itunes:${r.trackId}`,
      title: r.trackName,
      artist: r.artistName,
      url: r.previewUrl!,
      artwork: r.artworkUrl100 ?? r.artworkUrl60,
      source: 'itunes' as const,
    }));
}

/** Downloads the audio so it can be both played and analysed. */
export async function downloadTrack(t: Track, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(t.url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

export function trackLabel(t: Track): string {
  return t.artist ? `${t.title} · ${t.artist}` : t.title;
}
