import type { Playlist, Track } from './types.ts';

export type Provider = 'youtube' | 'soundcloud';
export type Source = { provider: Provider; url: string; id: string };
export type OnlinePreview = { title: string; artist: string; duration: number; provider: Provider };
export const MAX_PLAYLIST_TRACKS = 100;
export type AudioLink = { provider: Provider; url: string; id?: string; kind: 'track' | 'playlist' };
export type OnlineItem = {
  index: number; title: string; url?: string; sourceId?: string;
  state: 'pending' | 'checking' | 'downloading' | 'processing' | 'saving' | 'added' | 'duplicate' | 'failed' | 'cancelled';
  progress: number | null; trackId?: string; error?: string;
};
export type OnlineCollection = { title: string; artist: string; total: number; processed: number; added: number; duplicates: number; failed: number; items: OnlineItem[] };
export type OnlineJob = {
  id: string; url: string; provider: Provider; kind?: 'track' | 'playlist';
  state: 'queued' | 'checking' | 'downloading' | 'processing' | 'saving' | 'cancelling' | 'complete' | 'failed' | 'cancelled';
  progress: number | null; preview?: OnlinePreview; track?: Track; duplicate?: boolean; error?: string;
  collection?: OnlineCollection; playlist?: Playlist;
  createdAt: string;
};
export type ImportTools = { ready: boolean; downloader: string | null; ffmpeg: boolean; message?: string };

export function parseAudioLink(value: unknown, playlistFromVideo = false): AudioLink {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Paste a YouTube video or playlist, or a SoundCloud track or set.');
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { throw new Error('Paste a complete YouTube or SoundCloud link.'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) throw new Error('Use a standard public YouTube or SoundCloud link.');
  const host = parsed.hostname.toLowerCase();
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host)) {
    const parts = parsed.pathname.split('/').filter(Boolean);
    const list = parsed.searchParams.get('list');
    if (parsed.pathname === '/playlist' || (parsed.pathname === '/watch' && !parsed.searchParams.get('v') && list) || (playlistFromVideo && list)) {
      if (!list || !/^[\w-]{10,100}$/.test(list) || /^(RD|WL$|LL$)/.test(list)) throw new Error('Choose a public YouTube playlist. Radio mixes, Watch later, and Liked videos are not supported.');
      return { provider: 'youtube', kind: 'playlist', id: list, url: `https://www.youtube.com/playlist?list=${list}` };
    }
    const id = host.endsWith('youtu.be') && parts.length === 1 ? parts[0]
      : parsed.pathname === '/watch' ? parsed.searchParams.get('v')
      : parts.length === 2 && ['shorts', 'live', 'embed'].includes(parts[0]) ? parts[1] : null;
    if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Choose a YouTube video or public playlist. Channel links are not supported.');
    return { provider: 'youtube', kind: 'track', id, url: `https://www.youtube.com/watch?v=${id}` };
  }
  if (host === 'on.soundcloud.com') {
    if (!/^\/[a-z\d]+\/?$/i.test(parsed.pathname)) throw new Error('Choose a SoundCloud track share link.');
    return { provider: 'soundcloud', kind: 'track', url: `https://on.soundcloud.com${parsed.pathname.replace(/\/$/, '')}` };
  }
  if (['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(host)) {
    const parts = parsed.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const set = parts.length === 3 && parts[1] === 'sets';
    if ((!set && parts.length !== 2) || parts.some(part => !/^[a-z\d_-]+$/i.test(part)) || (!set && ['sets', 'tracks', 'likes', 'reposts', 'albums', 'popular-tracks'].includes(parts[1])) || ['discover', 'search', 'you', 'charts', 'stream'].includes(parts[0])) throw new Error('Choose a public SoundCloud track or set. Profiles are not supported.');
    return { provider: 'soundcloud', kind: set ? 'playlist' : 'track', url: `https://soundcloud.com/${parts.join('/')}` };
  }
  throw new Error('MusicSuite supports YouTube and SoundCloud links.');
}

export function videoHasPlaylist(value: string) {
  try { const track = parseAudioLink(value); return track.provider === 'youtube' && track.kind === 'track' && new URL(value).searchParams.has('list'); } catch { return false; }
}

export const isImportFinished = (job: OnlineJob) => ['complete', 'failed', 'cancelled'].includes(job.state);
