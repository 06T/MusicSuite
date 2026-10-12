import type { Track, SavedVersion, MixSettings, AudioEdit, Playlist } from '../shared/types.ts';

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), 'X-MusicSuite': 'local', ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'MusicSuite could not complete this action.');
  }
  return response.status === 204 ? undefined as T : response.json();
}

export const getLibrary = () => api<{ tracks: Track[]; versions: SavedVersion[]; playlists: Playlist[] }>('/api/library');
export const favoriteTrack = (id: string, favorite: boolean) => api<Track>(`/api/tracks/${id}`, { method: 'PATCH', body: JSON.stringify({ favorite }) });
export const saveVersion = (id: string, name: string, settings: MixSettings, edit: AudioEdit) => api<SavedVersion>(`/api/tracks/${id}/versions`, { method: 'POST', body: JSON.stringify({ name, settings, edit }) });

export function uploadFiles(files: File[], onProgress: (progress: number) => void) {
  return new Promise<{ tracks: Track[]; duplicates: number; errors: { name: string; message: string }[] }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const data = new FormData(); files.forEach(file => data.append('files', file));
    request.open('POST', '/api/import'); request.setRequestHeader('X-MusicSuite', 'local');
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onerror = () => reject(new Error('Could not reach MusicSuite. Check that the local server is running.'));
    request.onload = () => {
      try {
        const result = JSON.parse(request.responseText);
        if (request.status < 200 || request.status >= 300) reject(new Error(result.error || 'Import failed.'));
        else resolve(result);
      } catch { reject(new Error('Import failed. Try again.')); }
    };
    request.send(data);
  });
}

export const formatTime = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
export const formatSize = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
export const dbLabel = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(0)} dB`;

export function readLocal<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
export function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Library and saved versions remain on disk if browser storage is full. */ }
}
