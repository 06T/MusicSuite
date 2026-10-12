import { mapConcurrent } from '../shared/async.ts';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Library, MAX_FILE_SIZE } from './library.ts';
import { baseArguments, checkImportTools, downloaderPath, runCommand, type RunOptions } from './downloader.ts';
import { MAX_PLAYLIST_TRACKS, isImportFinished, parseAudioLink, type AudioLink, type ImportTools, type OnlineItem, type OnlineJob, type Provider, type Source } from '../shared/online.ts';

type Runner = (command: string, args: string[], options: RunOptions) => Promise<string>;
type Metadata = {
  id?: string; title?: string; artist?: string; uploader?: string; album?: string; duration?: number;
  is_live?: boolean; live_status?: string; _type?: string; extractor_key?: string; webpage_url?: string; url?: string;
  thumbnail?: string; formats?: { format_id?: string }[]; entries?: (Metadata | null)[]; playlist_count?: number;
};
type Entry = { job: OnlineJob; controller: AbortController };
const clean = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : fallback;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not import this link.';
export class ImportRequestError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }

export class OnlineImports {
  private library: Library;
  private runner: Runner;
  private toolCheck: () => Promise<ImportTools>;
  private cover: (url: string, signal: AbortSignal) => Promise<Uint8Array | null>;
  private entries = new Map<string, Entry>();
  private queue: Entry[] = [];
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(library: Library, options: { runner?: Runner; tools?: () => Promise<ImportTools>; cover?: (url: string, signal: AbortSignal) => Promise<Uint8Array | null> } = {}) {
    this.library = library; this.runner = options.runner ?? runCommand; this.toolCheck = options.tools ?? checkImportTools; this.cover = options.cover ?? readCover;
  }
  tools() { return this.toolCheck(); }
  get(id: string) { const job = this.entries.get(id)?.job; return job ? structuredClone(job) : undefined; }
  list() { return [...this.entries.values()].map(entry => structuredClone(entry.job)).reverse(); }

  async start(value: unknown, playlistFromVideo = false): Promise<OnlineJob> {
    const link = parseAudioLink(value, playlistFromVideo);
    if (this.stopped) throw new ImportRequestError('MusicSuite is shutting down. Try after restarting.', 503);
    if ([...this.entries.values()].filter(entry => !isImportFinished(entry.job)).length >= 3) throw new ImportRequestError('Three link imports are already in progress. Wait for one to finish.', 409);
    const existing = link.kind === 'track' ? this.library.findSource(link.provider, link.url, link.id) : undefined;
    if (!existing) { const tools = await this.tools(); if (!tools.ready) throw new ImportRequestError(tools.message ?? 'Online import tools are unavailable.', 503); }
    if (this.stopped) throw new ImportRequestError('MusicSuite is shutting down. Try after restarting.', 503);

    if ([...this.entries.values()].filter(entry => !isImportFinished(entry.job)).length >= 3) throw new ImportRequestError('The import queue is full. Wait for one to finish.', 409);
    const job: OnlineJob = { id: randomUUID(), url: link.url, provider: link.provider, kind: link.kind, state: existing ? 'complete' : 'queued', progress: existing ? 100 : null, createdAt: new Date().toISOString(), ...(existing ? { track: existing, duplicate: true } : {}) };
    const entry = { job, controller: new AbortController() }; this.entries.set(job.id, entry);
    for (const [id, item] of this.entries) { if (this.entries.size <= 24) break; if (isImportFinished(item.job)) this.entries.delete(id); }
    if (!existing) { this.queue.push(entry); this.pump(); }
    return structuredClone(job);
  }

  cancel(id: string) {
    const entry = this.entries.get(id); if (!entry) throw new ImportRequestError('Import not found.', 404);
    if (entry.job.state === 'saving') throw new ImportRequestError('The current track is being saved. Try again in a moment.', 409);
    if (isImportFinished(entry.job) || entry.job.state === 'cancelling') return structuredClone(entry.job);
    const queued = this.queue.includes(entry);
    if (queued) this.queue = this.queue.filter(item => item !== entry);
    entry.job.state = queued ? 'cancelled' : 'cancelling';
    entry.controller.abort(new Error('Import cancelled.'));
    return structuredClone(entry.job);
  }

  private pump() {
    if (this.running || this.stopped) return;
    const entry = this.queue.shift(); if (!entry) return;
    if (entry.controller.signal.aborted) { this.pump(); return; }
    this.running = this.download(entry).finally(() => { this.running = null; this.pump(); });
  }

  async shutdown() {
    this.stopped = true;
    const queued = new Set(this.queue);
    for (const entry of this.entries.values()) if (!isImportFinished(entry.job)) {
      entry.controller.abort(new Error('Import cancelled.'));
      if (queued.has(entry)) entry.job.state = 'cancelled';
    }
    this.queue = []; await this.running;
  }

  private async download(entry: Entry) {
    const { job, controller } = entry; const signal = controller.signal;
    const directory = path.join(this.library.directory, 'incoming', `online-${job.id}`);
    let terminal: OnlineJob['state'] = 'failed';
    try {
      await mkdir(directory, { recursive: true }); signal.throwIfAborted(); job.state = 'checking';
      const url = await resolveShareLink(job.url, signal); const link = parseAudioLink(url);
      job.url = link.url; job.kind = link.kind;
      if (link.kind === 'playlist') await this.downloadPlaylist(entry, link, directory);
      else {
        const result = await this.downloadTrack(entry, link.url, directory, link.id);
        job.track = result.track; job.duplicate = result.duplicate;
      }
      terminal = 'complete';
    } catch (error) {
      terminal = signal.aborted ? 'cancelled' : 'failed';
      if (!signal.aborted || errorMessage(signal.reason) !== 'Import cancelled.') job.error = errorMessage(signal.aborted ? signal.reason : error);
    } finally {
      if (job.collection) {
        for (const item of job.collection.items) if (!['added', 'duplicate', 'failed'].includes(item.state)) { item.state = terminal === 'cancelled' ? 'cancelled' : 'failed'; item.progress = null; if (terminal === 'failed') item.error ??= job.error; }
        this.updateCollection(job);
      }
      await rm(directory, { recursive: true, force: true }).catch(() => {});

      job.state = terminal; if (terminal === 'complete') job.progress = 100;
    }
  }

  private async downloadPlaylist(entry: Entry, link: AudioLink, directory: string) {
    const { job, controller } = entry; const signal = controller.signal;
    const metadata = JSON.parse(await this.runner(downloaderPath(), [...baseArguments(job.provider, true), '--flat-playlist', '--playlist-items', `1:${MAX_PLAYLIST_TRACKS + 1}`, '--dump-single-json', '--skip-download', '--', link.url], { cwd: directory, signal, timeout: 120000 })) as Metadata;
    signal.throwIfAborted();
    if (metadata._type !== 'playlist' || metadata.extractor_key?.toLowerCase() !== (job.provider === 'youtube' ? 'youtubetab' : 'soundcloudset') || !metadata.id || !/^[\w-]{1,100}$/.test(metadata.id) || (link.id && link.id !== metadata.id)) throw new Error('This link did not return a supported playlist. Choose a public YouTube playlist or SoundCloud set.');
    if (!Array.isArray(metadata.entries) || !metadata.entries.length) throw new Error('This playlist has no accessible tracks.');
    if (metadata.entries.length > MAX_PLAYLIST_TRACKS || Number(metadata.playlist_count) > MAX_PLAYLIST_TRACKS) throw new Error(`Choose a playlist with ${MAX_PLAYLIST_TRACKS} tracks or fewer. Nothing has been downloaded.`);
    const source: Source = { provider: job.provider, url: link.url, id: metadata.id };
    const items = metadata.entries.map((value, index) => playlistItem(value, index + 1, job.provider));
    job.collection = { title: clean(metadata.title, 'Imported playlist'), artist: clean(metadata.uploader, providerAlbum(job.provider)), total: items.length, processed: 0, added: 0, duplicates: 0, failed: 0, items };
    job.playlist = this.library.findPlaylistSource(source.provider, source.url, source.id);
    this.updateCollection(job);

    await mapConcurrent(items, 1, async item => {
      signal.throwIfAborted();
      if (item.state === 'failed') return;
      try {
        const existing = this.library.findSource(job.provider, item.url!, item.sourceId);
        const result = existing ? { track: existing, duplicate: true } : await this.downloadTrack(entry, item.url!, path.join(directory, String(item.index)), item.sourceId, item);
        item.title = result.track.title; item.trackId = result.track.id; item.state = result.duplicate ? 'duplicate' : 'added'; item.progress = 100;
        this.saveCollection(job, source); this.updateCollection(job);
      } catch (error) {
        if (signal.aborted) throw error;
        item.state = 'failed'; item.progress = null; item.error = errorMessage(error); this.updateCollection(job);
      }
    }, signal);
    signal.throwIfAborted();
    if (!job.playlist?.trackIds.length) throw new Error('No tracks could be imported. See the track details below and try another public playlist.');
  }

  private saveCollection(job: OnlineJob, source: Source) {

    const existing = this.library.findPlaylistSource(source.provider, source.url, source.id);
    const imported = job.collection!.items.flatMap(item => item.trackId && this.library.getRow(item.trackId) ? [item.trackId] : []);
    const ids = [...new Set([...(existing?.trackIds ?? []), ...imported])];
    if (!ids.length) return;
    job.playlist = this.library.savePlaylist(existing?.id ?? null, existing?.name ?? job.collection!.title.slice(0, 80), ids, source);
  }

  private updateCollection(job: OnlineJob) {
    const collection = job.collection; if (!collection) return;
    collection.added = collection.items.filter(item => item.state === 'added').length;
    collection.duplicates = collection.items.filter(item => item.state === 'duplicate').length;
    collection.failed = collection.items.filter(item => item.state === 'failed').length;
    collection.processed = collection.added + collection.duplicates + collection.failed;
    const current = collection.items.find(item => ['checking', 'downloading', 'processing', 'saving'].includes(item.state));
    const fraction = current ? current.state === 'checking' ? 0 : current.state === 'downloading' ? (current.progress ?? 0) / 100 * 0.9 : 0.95 : 0;
    job.progress = Math.min(100, Math.floor((collection.processed + fraction) / collection.total * 100));
  }

  private stage(entry: Entry, state: 'checking' | 'downloading' | 'processing' | 'saving', item?: OnlineItem, progress: number | null = null) {
    if (entry.controller.signal.aborted) return;
    entry.job.state = state;
    if (item) { item.state = state; item.progress = progress; this.updateCollection(entry.job); }
    else entry.job.progress = progress;
  }

  private async downloadTrack(entry: Entry, url: string, directory: string, expectedId?: string, item?: OnlineItem) {
    const { job, controller } = entry; const sizeLimit = new AbortController(); const signal = AbortSignal.any([controller.signal, sizeLimit.signal]);
    let monitor: ReturnType<typeof setInterval> | undefined;
    try {
      await mkdir(directory, { recursive: true }); signal.throwIfAborted(); this.stage(entry, 'checking', item);
      const args = baseArguments(job.provider);
      const metadata = JSON.parse(await this.runner(downloaderPath(), [...args, '--dump-single-json', '--skip-download', '--', url], { cwd: directory, signal, timeout: 120000 })) as Metadata;
      signal.throwIfAborted();
      if (metadata._type === 'playlist' || !metadata.id || !/^[\w-]{1,100}$/.test(metadata.id) || metadata.extractor_key?.toLowerCase() !== job.provider) throw new Error('Choose a single public track from YouTube or SoundCloud.');
      if (expectedId && expectedId !== metadata.id) throw new Error('The source did not match the requested track.');
      if (metadata.is_live || metadata.live_status === 'is_upcoming') throw new Error('Live streams and upcoming premieres cannot be imported. Choose a finished track.');
      if (typeof metadata.duration !== 'number' || !Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.duration > 1200) throw new Error('Choose a track with a known duration of 20 minutes or less.');
      if (metadata.formats?.length && metadata.formats.every(format => /preview/i.test(format.format_id ?? ''))) throw new Error('This source only exposes preview audio. Choose a fully accessible track.');
      const title = clean(metadata.title, 'Imported track'); const artist = clean(metadata.artist ?? metadata.uploader, 'Unknown artist');
      job.preview = { title, artist, duration: metadata.duration, provider: job.provider }; if (item) item.title = title;
      let sourceUrl = url;
      if (metadata.webpage_url) { const resolved = parseAudioLink(metadata.webpage_url); if (resolved.provider !== job.provider || resolved.kind !== 'track' || (resolved.id && resolved.id !== metadata.id)) throw new Error('The track source was not valid.'); sourceUrl = resolved.url; }

      const validated = parseAudioLink(sourceUrl); if (validated.provider !== job.provider || validated.kind !== 'track') throw new Error('The track source was not valid.');
      const source: Source = { provider: job.provider, id: metadata.id, url: validated.url };
      const existing = this.library.findSource(source.provider, source.url, source.id);
      if (existing) return { track: existing, duplicate: true };
      this.stage(entry, 'downloading', item);
      let checkingSize = false;
      monitor = setInterval(() => {
        if (checkingSize) return; checkingSize = true;
        void readdir(directory).then(async names => {
          const sizes = await Promise.all(names.map(async name => { try { return (await stat(path.join(directory, name))).size; } catch { return 0; } }));
          if (sizes.reduce((total, size) => total + size, 0) > MAX_FILE_SIZE * 2.5) sizeLimit.abort(new Error('This download exceeds the local import size limit.'));
        }).catch(() => {}).finally(() => { checkingSize = false; });
      }, 1000);
      await this.runner(downloaderPath(), [...args, '--newline', '--progress', '--progress-delta', '0.5', '--progress-template', 'download:MS_PROGRESS:%(progress)j', '--progress-template', 'postprocess:MS_PROCESSING', '--no-simulate', '--format', 'bestaudio/best', '--max-filesize', String(MAX_FILE_SIZE), '--match-filters', '!is_live & duration <= 1200', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '2', '--embed-metadata', '--no-embed-info-json', '--no-embed-chapters', '--output', path.join(directory, 'audio.%(ext)s'), '--', url], {
        cwd: directory, signal, timeout: 600000,
        onLine: line => {
          if (signal.aborted) return;
          if (line.startsWith('MS_PROCESSING') || line.startsWith('[ExtractAudio]')) this.stage(entry, 'processing', item);
          if (!line.startsWith('MS_PROGRESS:')) return;
          try {
            const progress = JSON.parse(line.slice(12));
            const total = Number(progress.total_bytes || progress.total_bytes_estimate); const downloaded = Number(progress.downloaded_bytes);
            if (Number.isFinite(total) && total > 0 && Number.isFinite(downloaded)) this.stage(entry, 'downloading', item, Math.max(0, Math.min(100, Math.floor(downloaded / total * 100))));
            if (progress.status === 'finished') this.stage(entry, 'processing', item);
          } catch { /* Ignore non-progress messages. */ }
        },
      });
      clearInterval(monitor); monitor = undefined; signal.throwIfAborted();
      const file = path.join(directory, 'audio.mp3'); const size = (await stat(file)).size;
      if (size <= 0 || size > MAX_FILE_SIZE) throw new Error('This audio exceeds the 100 MB import limit.');
      this.stage(entry, 'saving', item);
      const result = await this.library.importFile(file, `${title}.mp3`, size, { title, artist, album: clean(metadata.album, providerAlbum(job.provider)), source });
      if (!result.duplicate && metadata.thumbnail) {
        try { const image = await this.cover(metadata.thumbnail, signal); if (image) result.track = await this.library.setArtwork(result.track.id, image); } catch { /* Generated art is the fallback when a cover cannot be read. */ }
      }
      return result;
    } catch (error) {
      if (sizeLimit.signal.aborted) throw sizeLimit.signal.reason;
      throw error;
    } finally {
      if (monitor) clearInterval(monitor);
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

const providerAlbum = (provider: Provider) => provider === 'youtube' ? 'From YouTube' : 'From SoundCloud';
function playlistItem(value: Metadata | null, index: number, provider: Provider): OnlineItem {
  let fallback = `Track ${index}`;
  try { const slug = new URL(value?.webpage_url ?? value?.url ?? '').pathname.split('/').filter(Boolean).at(-1); if (provider === 'soundcloud' && slug && !/^\d+$/.test(slug)) fallback = slug.replace(/[-_]/g, ' '); } catch { /* Use the entry's position when no title is available. */ }
  const item: OnlineItem = { index, title: clean(value?.title, fallback), state: 'pending', progress: null };
  try {
    if (!value || value._type === 'playlist') throw new Error('This entry is unavailable or is not an individual track.');
    const id = value.id;
    const raw = value.webpage_url ?? value.url;
    if (provider === 'soundcloud' && id && /^\d{1,20}$/.test(id) && (!raw || /^https:\/\/api(?:-v2)?\.soundcloud\.com\/tracks\/\d+$/.test(raw))) {
      item.url = `https://api-v2.soundcloud.com/tracks/${id}`; item.sourceId = id; return item;
    }
    const url = raw ?? (provider === 'youtube' && id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : '');
    const link = parseAudioLink(url);
    if (link.provider !== provider || link.kind !== 'track' || (id && link.id && id !== link.id)) throw new Error('This playlist entry does not point to a supported track.');
    item.url = link.url; item.sourceId = id ?? link.id;
  } catch (error) { item.state = 'failed'; item.error = errorMessage(error); }
  return item;
}

export async function resolveShareLink(value: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<string> {
  let link = parseAudioLink(value);
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!link.url.startsWith('https://on.soundcloud.com/')) return link.url;
    const response = await request(link.url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status > 399 || !location) throw new Error('This SoundCloud share link could not be resolved. Paste the full track or set link instead.');
    link = parseAudioLink(new URL(location, link.url).href);
    if (link.provider !== 'soundcloud') throw new Error('The share link did not lead to SoundCloud.');
  }
  throw new Error('Too many redirects. Paste the full SoundCloud track or set link.');
}

async function readCover(value: string, signal: AbortSignal): Promise<Uint8Array | null> {
  let url: URL; try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['ytimg.com', 'sndcdn.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  if (!response.ok || Number(response.headers.get('content-length')) > 10 * 1024 * 1024 || !response.body) return null;
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 10 * 1024 * 1024) { await reader.cancel(); return null; } chunks.push(chunk.value); }
  return Buffer.concat(chunks);
}
