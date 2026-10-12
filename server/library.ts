import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { DEFAULT_EDIT, validateEdit, validateMix, type Track, type SavedVersion, type Playlist, type WorkspaceBackup } from '../shared/types.ts';
import type { Source, Provider } from '../shared/online.ts';

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac', '.opus', '.aif', '.aiff']);
export const MAX_FILE_SIZE = 100 * 1024 * 1024;

interface TrackRow {
  id: string; title: string; artist: string; album: string; duration: number;
  format: string; size: number; filename: string; hash: string; artwork_mime: string | null;
  favorite: number; created_at: string; artwork_revision: number; version_count?: number;
  source_type: Provider | null; source_url: string | null; source_id: string | null;
}

interface VersionRow { id: string; track_id: string; name: string; settings: string; edit: string; created_at: string }
interface PlaylistRow { id: string; name: string; created_at: string; source_type: Provider | null; source_url: string | null; source_id: string | null }

export class Library {
  readonly directory: string;
  readonly db: DatabaseSync;

  constructor(directory: string) {
    this.directory = directory;
    this.db = new DatabaseSync(path.join(directory, 'library.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL,
        duration REAL NOT NULL, format TEXT NOT NULL, size INTEGER NOT NULL,
        filename TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, artwork_mime TEXT,
        favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        name TEXT NOT NULL, settings TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS versions_track ON versions(track_id);
      CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, position INTEGER NOT NULL,
        PRIMARY KEY (playlist_id, track_id)
      );
    `);
    const columns = (table: string) => (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(row => row.name);
    if (!columns('tracks').includes('artwork_revision')) this.db.exec('ALTER TABLE tracks ADD COLUMN artwork_revision INTEGER NOT NULL DEFAULT 0');
    if (!columns('versions').includes('edit')) this.db.exec(`ALTER TABLE versions ADD COLUMN edit TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_EDIT)}'`);
    for (const name of ['source_type', 'source_url', 'source_id']) if (!columns('tracks').includes(name)) this.db.exec(`ALTER TABLE tracks ADD COLUMN ${name} TEXT`);
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS tracks_source ON tracks(source_type, source_id) WHERE source_id IS NOT NULL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS track_sources (
      source_type TEXT NOT NULL, source_id TEXT NOT NULL, source_url TEXT NOT NULL,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      PRIMARY KEY (source_type, source_id)
    );
    CREATE INDEX IF NOT EXISTS track_sources_url ON track_sources(source_type, source_url);
    INSERT OR IGNORE INTO track_sources (source_type, source_id, source_url, track_id)
      SELECT source_type, source_id, source_url, id FROM tracks WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND source_url IS NOT NULL;`);
    for (const name of ['source_type', 'source_url', 'source_id']) if (!columns('playlists').includes(name)) this.db.exec(`ALTER TABLE playlists ADD COLUMN ${name} TEXT`);
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS playlists_source ON playlists(source_type, source_id) WHERE source_id IS NOT NULL');
  }

  static async open(directory: string) {
    await Promise.all(['', 'audio', 'artwork', 'incoming'].map(folder => mkdir(path.join(directory, folder), { recursive: true })));
    return new Library(directory);
  }

  listTracks(): Track[] {
    const rows = this.db.prepare(`SELECT tracks.*, (SELECT COUNT(*) FROM versions WHERE track_id = tracks.id) AS version_count FROM tracks ORDER BY created_at DESC`).all() as unknown as TrackRow[];
    return rows.map(row => this.toTrack(row));
  }

  getRow(id: string): TrackRow | undefined {
    return this.db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as unknown as TrackRow | undefined;
  }

  toTrack(row: TrackRow): Track {
    return {
      id: row.id, title: row.title, artist: row.artist, album: row.album,
      duration: row.duration, format: row.format, size: row.size,
      hasArtwork: !!row.artwork_mime, favorite: !!row.favorite,
      createdAt: row.created_at,
      versionCount: row.version_count ?? Number((this.db.prepare('SELECT COUNT(*) AS count FROM versions WHERE track_id = ?').get(row.id) as { count: number }).count),
      artworkRevision: row.artwork_revision,
      ...(row.source_type && row.source_url && row.source_id ? { source: { provider: row.source_type, url: row.source_url, id: row.source_id } } : {}),
    };
  }

  audioPath(row: TrackRow) { return path.join(this.directory, 'audio', row.filename); }
  artworkPath(id: string) { return path.join(this.directory, 'artwork', id); }

  findSource(provider: Provider, url: string, id?: string): Track | undefined {
    const row = this.db.prepare('SELECT tracks.* FROM tracks JOIN track_sources ON track_sources.track_id = tracks.id WHERE track_sources.source_type = ? AND (track_sources.source_url = ? OR track_sources.source_id = ?)').get(provider, url, id ?? null) as unknown as TrackRow | undefined;
    return row ? this.toTrack(row) : undefined;
  }

  attachSource(id: string, source: Source) {
    this.db.prepare('INSERT OR IGNORE INTO track_sources (source_type, source_id, source_url, track_id) VALUES (?, ?, ?, ?)').run(source.provider, source.id, source.url, id);
    this.db.prepare('UPDATE tracks SET source_type = ?, source_url = ?, source_id = ? WHERE id = ? AND source_id IS NULL').run(source.provider, source.url, source.id, id);
    return this.toTrack(this.getRow(id)!);
  }

  async importFile(filePath: string, originalName: string, size: number, overrides?: { title: string; artist: string; album: string; source?: Source }) {
    const extension = path.extname(originalName).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(extension)) throw new Error('Use MP3, WAV, FLAC, M4A, OGG, AAC, Opus, or AIFF audio.');
    if (size > MAX_FILE_SIZE) throw new Error('This file is larger than 100 MB.');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) digest.update(chunk);
    const hash = digest.digest('hex');
    const duplicate = this.db.prepare('SELECT * FROM tracks WHERE hash = ?').get(hash) as unknown as TrackRow | undefined;
    if (duplicate) return { track: overrides?.source ? this.attachSource(duplicate.id, overrides.source) : this.toTrack(duplicate), duplicate: true };

    const metadata = await parseFile(filePath, { duration: true });
    const duration = metadata.format.duration ?? 0;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read this audio file. It may be damaged or unsupported.');
    if (duration > 20 * 60) throw new Error('This first version supports tracks up to 20 minutes.');
    const id = randomUUID();
    const filename = `${id}${extension}`;
    const pictures = metadata.common.picture ?? [];
    const picture = pictures.find(p => ['image/jpeg', 'image/png', 'image/webp'].includes(p.format) && p.data.byteLength <= 10 * 1024 * 1024);
    const clean = (value: string | undefined, fallback: string) => value?.trim().slice(0, 300) || fallback;
    const title = clean(overrides?.title ?? metadata.common.title, path.basename(originalName, path.extname(originalName)));
    const artist = clean(overrides?.artist ?? metadata.common.artist, 'Unknown artist');
    const album = clean(overrides?.album ?? metadata.common.album, 'Local collection');
    const createdAt = new Date().toISOString();
    await rename(filePath, path.join(this.directory, 'audio', filename));
    try {
      if (picture) await writeFile(this.artworkPath(id), picture.data);
      this.db.exec('BEGIN');
      try {
        this.db.prepare('INSERT INTO tracks (id, title, artist, album, duration, format, size, filename, hash, artwork_mime, created_at, source_type, source_url, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, title, artist, album, duration, extension.slice(1).toUpperCase(), size, filename, hash, picture?.format ?? null, createdAt, overrides?.source?.provider ?? null, overrides?.source?.url ?? null, overrides?.source?.id ?? null);
        if (overrides?.source) this.attachSource(id, overrides.source);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    } catch (error) {
      await Promise.all([rm(path.join(this.directory, 'audio', filename), { force: true }), rm(this.artworkPath(id), { force: true })]);
      const concurrentDuplicate = this.db.prepare('SELECT * FROM tracks WHERE hash = ?').get(hash) as unknown as TrackRow | undefined;
      if (concurrentDuplicate) return { track: overrides?.source ? this.attachSource(concurrentDuplicate.id, overrides.source) : this.toTrack(concurrentDuplicate), duplicate: true };
      throw error;
    }
    return { track: this.toTrack(this.getRow(id)!), duplicate: false };
  }

  setFavorite(id: string, favorite: boolean) {
    if (!this.getRow(id)) throw new Error('Track not found.');
    this.db.prepare('UPDATE tracks SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, id);
    return this.toTrack(this.getRow(id)!);
  }

  updateTrack(id: string, value: unknown) {
    if (!this.getRow(id)) throw new Error('Track not found.');
    if (!value || typeof value !== 'object') throw new Error('Track details are missing.');
    const details = value as Record<string, unknown>;
    for (const key of ['title', 'artist', 'album']) if (typeof details[key] !== 'string' || !(details[key] as string).trim() || (details[key] as string).length > 300) throw new Error('Use 1 to 300 characters for each track detail.');
    this.db.prepare('UPDATE tracks SET title = ?, artist = ?, album = ? WHERE id = ?').run((details.title as string).trim(), (details.artist as string).trim(), (details.album as string).trim(), id);
    return this.toTrack(this.getRow(id)!);
  }

  async setArtwork(id: string, bytes: Uint8Array) {
    if (!this.getRow(id)) throw new Error('Track not found.');
    const b = Buffer.from(bytes);
    const mime = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'image/jpeg'
      : b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
    if (!mime || b.length > 10 * 1024 * 1024) throw new Error('Choose a PNG, JPEG, or WebP cover under 10 MB.');
    const temporary = path.join(this.directory, 'incoming', randomUUID());
    try { await writeFile(temporary, b); await rename(temporary, this.artworkPath(id)); }
    finally { await rm(temporary, { force: true }); }
    this.db.prepare('UPDATE tracks SET artwork_mime = ?, artwork_revision = artwork_revision + 1 WHERE id = ?').run(mime, id);
    return this.toTrack(this.getRow(id)!);
  }

  async removeArtwork(id: string) {
    if (!this.getRow(id)) throw new Error('Track not found.');
    await rm(this.artworkPath(id), { force: true });
    this.db.prepare('UPDATE tracks SET artwork_mime = NULL, artwork_revision = artwork_revision + 1 WHERE id = ?').run(id);
    return this.toTrack(this.getRow(id)!);
  }

  listVersions(trackId?: string): SavedVersion[] {
    const rows = (trackId
      ? this.db.prepare('SELECT * FROM versions WHERE track_id = ? ORDER BY created_at DESC').all(trackId)
      : this.db.prepare('SELECT * FROM versions ORDER BY created_at DESC').all()) as unknown as VersionRow[];
    return rows.map(row => ({ id: row.id, trackId: row.track_id, name: row.name, settings: validateMix(JSON.parse(row.settings)), edit: validateEdit(JSON.parse(row.edit)), createdAt: row.created_at }));
  }

  saveVersion(trackId: string, name: string, settings: unknown, edit: unknown = DEFAULT_EDIT): SavedVersion {
    if (!this.getRow(trackId)) throw new Error('Track not found.');
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new Error('Give your version a name of 1 to 80 characters.');
    const version = { id: randomUUID(), trackId, name: name.trim(), settings: validateMix(settings), edit: validateEdit(edit), createdAt: new Date().toISOString() };
    const duration = this.getRow(trackId)!.duration;
    if (version.edit.start >= duration || (version.edit.end !== null && version.edit.end > duration + 0.05)) throw new Error('Trim points must fit inside the track.');
    this.db.prepare('INSERT INTO versions (id, track_id, name, settings, edit, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(version.id, trackId, version.name, JSON.stringify(version.settings), JSON.stringify(version.edit), version.createdAt);
    return version;
  }

  deleteVersion(id: string) { return this.db.prepare('DELETE FROM versions WHERE id = ?').run(id).changes > 0; }

  listPlaylists(): Playlist[] {
    const rows = this.db.prepare('SELECT * FROM playlists ORDER BY created_at ASC').all() as unknown as PlaylistRow[];
    const memberships = this.db.prepare('SELECT playlist_id, track_id FROM playlist_tracks ORDER BY playlist_id, position ASC').all() as { playlist_id: string; track_id: string }[];
    const byPlaylist = new Map<string, string[]>();
    for (const item of memberships) {
      const ids = byPlaylist.get(item.playlist_id) ?? [];
      ids.push(item.track_id); byPlaylist.set(item.playlist_id, ids);
    }
    return rows.map(row => this.toPlaylist(row, byPlaylist.get(row.id) ?? []));
  }

  private toPlaylist(row: PlaylistRow, trackIds: string[]): Playlist {
    return {
      id: row.id, name: row.name, createdAt: row.created_at,
      trackIds,
      ...(row.source_type && row.source_url && row.source_id ? { source: { provider: row.source_type, url: row.source_url, id: row.source_id } } : {}),
    };
  }

  private playlistFromRow(row: PlaylistRow): Playlist {
    const ids = this.db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC').all(row.id) as { track_id: string }[];
    return this.toPlaylist(row, ids.map(item => item.track_id));
  }

  findPlaylistSource(provider: Provider, url: string, id?: string) {
    const row = this.db.prepare('SELECT * FROM playlists WHERE source_type = ? AND (source_url = ? OR source_id = ?) ORDER BY created_at ASC LIMIT 1').get(provider, url, id ?? null) as unknown as PlaylistRow | undefined;
    return row ? this.playlistFromRow(row) : undefined;
  }

  savePlaylist(id: string | null, name: unknown, trackIds: unknown, source?: Source): Playlist {
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('Name your playlist with 1 to 80 characters.');
    const exists = this.db.prepare('SELECT id FROM tracks WHERE id = ?');
    if (!Array.isArray(trackIds) || trackIds.length > 10000 || trackIds.some(item => typeof item !== 'string' || !exists.get(item)) || new Set(trackIds).size !== trackIds.length) throw new Error('Choose existing tracks without duplicates.');
    if (id && !this.db.prepare('SELECT id FROM playlists WHERE id = ?').get(id)) throw new Error('Playlist not found.');
    const playlistId = id ?? randomUUID();
    this.db.exec('BEGIN');
    try {
      if (id) this.db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name.trim(), id);
      else this.db.prepare('INSERT INTO playlists (id, name, created_at) VALUES (?, ?, ?)').run(playlistId, name.trim(), new Date().toISOString());
      if (source) this.db.prepare('UPDATE playlists SET source_type = ?, source_url = ?, source_id = ? WHERE id = ?').run(source.provider, source.url, source.id, playlistId);
      this.db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId);
      const statement = this.db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)');
      trackIds.forEach((trackId, index) => statement.run(playlistId, trackId, index));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    const row = this.db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId) as unknown as PlaylistRow;
    return this.playlistFromRow(row);
  }

  deletePlaylist(id: string) { return this.db.prepare('DELETE FROM playlists WHERE id = ?').run(id).changes > 0; }

  backup(): WorkspaceBackup {
    const tracks = this.db.prepare('SELECT * FROM tracks ORDER BY created_at DESC').all() as unknown as TrackRow[];
    const versionsByTrack = new Map<string, SavedVersion[]>();
    for (const version of this.listVersions()) {
      const items = versionsByTrack.get(version.trackId) ?? [];
      items.push(version); versionsByTrack.set(version.trackId, items);
    }
    const hashes = new Map(tracks.map(track => [track.id, track.hash]));
    return { app: 'MusicSuite', format: 1, createdAt: new Date().toISOString(),
      tracks: tracks.map(track => ({ hash: track.hash, title: track.title, artist: track.artist, album: track.album, favorite: !!track.favorite,
        versions: (versionsByTrack.get(track.id) ?? []).map(({ name, settings, edit }) => ({ name, settings, edit })),
      })),
      playlists: this.listPlaylists().map(playlist => ({ name: playlist.name, hashes: playlist.trackIds.map(id => hashes.get(id)!) })),
    };
  }

  restore(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('Choose a MusicSuite workspace backup.');
    const backup = value as WorkspaceBackup;
    if (backup.app !== 'MusicSuite' || backup.format !== 1 || !Array.isArray(backup.tracks) || !Array.isArray(backup.playlists) || backup.tracks.length > 10000 || backup.playlists.length > 500) throw new Error('This workspace backup is not supported.');

    const hashes = new Set<string>();
    for (const track of backup.tracks) {
      if (!track || typeof track.hash !== 'string' || !/^[a-f0-9]{64}$/.test(track.hash) || hashes.has(track.hash)) throw new Error('The backup contains invalid tracks.');
      hashes.add(track.hash);
      for (const key of ['title', 'artist', 'album'] as const) if (typeof track[key] !== 'string' || !track[key].trim() || track[key].length > 300) throw new Error('The backup contains invalid track details.');
      if (typeof track.favorite !== 'boolean' || !Array.isArray(track.versions) || track.versions.length > 1000) throw new Error('The backup contains invalid versions.');
      for (const version of track.versions) {
        if (!version || typeof version.name !== 'string' || !version.name.trim() || version.name.length > 80) throw new Error('The backup contains invalid version names.');
        validateMix(version.settings); validateEdit(version.edit);
      }
    }
    for (const playlist of backup.playlists) if (!playlist || typeof playlist.name !== 'string' || !playlist.name.trim() || playlist.name.length > 80 || !Array.isArray(playlist.hashes) || playlist.hashes.length > 10000 || new Set(playlist.hashes).size !== playlist.hashes.length || playlist.hashes.some(hash => !hashes.has(hash))) throw new Error('The backup contains invalid playlists.');
    const byHash = new Map(this.listTracks().map(track => [this.getRow(track.id)!.hash, track]));
    const report = { matched: 0, missing: 0, versions: 0, playlists: 0 };
    this.db.exec('BEGIN');
    try {
      for (const item of backup.tracks) {
        const track = byHash.get(item.hash);
        if (!track) { report.missing++; continue; }
        report.matched++;
        this.updateTrack(track.id, item); this.setFavorite(track.id, item.favorite);
        for (const version of item.versions) {
          const edit = validateEdit(version.edit); const settings = validateMix(version.settings);
          if (edit.start >= track.duration || (edit.end !== null && edit.end > track.duration + 0.05)) throw new Error('A saved trim does not fit its track.');
          const exists = this.listVersions(track.id).some(v => v.name === version.name.trim() && JSON.stringify(v.settings) === JSON.stringify(settings) && JSON.stringify(v.edit) === JSON.stringify(edit));
          if (!exists) { this.saveVersion(track.id, version.name, settings, edit); report.versions++; }
        }
      }

      const knownPlaylists = new Set(this.listPlaylists().map(playlist => JSON.stringify([playlist.name, playlist.trackIds])));
      for (const item of backup.playlists) {
        const ids = item.hashes.flatMap(hash => byHash.get(hash)?.id ?? []);
        if (item.hashes.length && !ids.length) continue;
        const signature = JSON.stringify([item.name.trim(), ids]);
        if (knownPlaylists.has(signature)) continue;
        const id = randomUUID();
        this.db.prepare('INSERT INTO playlists (id, name, created_at) VALUES (?, ?, ?)').run(id, item.name.trim(), new Date().toISOString());
        ids.forEach((trackId, index) => this.db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)').run(id, trackId, index));
        knownPlaylists.add(signature);
        report.playlists++;
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return report;
  }

  async deleteTrack(id: string) {
    const row = this.getRow(id);
    if (!row) return false;
    this.db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
    await Promise.all([rm(this.audioPath(row), { force: true }), rm(this.artworkPath(id), { force: true })]);
    return true;
  }

  close() { this.db.close(); }
}
