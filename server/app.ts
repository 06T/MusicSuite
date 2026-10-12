import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { Library, MAX_FILE_SIZE } from './library.ts';
import { createDemoWav } from './demo.ts';
import { ImportRequestError, OnlineImports } from './onlineImports.ts';

export function createApp(library: Library, online = new OnlineImports(library)) {
  const app = express();
  app.locals.onlineImports = online;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const hostname = req.hostname;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return res.status(403).json({ error: 'MusicSuite is available on localhost only.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: 'Open MusicSuite locally to use your library.' });
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    const origin = req.get('Origin');
    if (req.path.startsWith('/api') && origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Requests must come from MusicSuite.' });
    if (req.path.startsWith('/api') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('X-MusicSuite') !== 'local') return res.status(403).json({ error: 'Open MusicSuite locally to make changes.' });
    }
    next();
  });
  app.use(express.json({ limit: '8mb' }));
  const upload = multer({ dest: path.join(library.directory, 'incoming'), limits: { fileSize: MAX_FILE_SIZE, files: 50 } });
  const coverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  app.get('/api/health', (_req, res) => res.json({ app: 'MusicSuite', status: 'ok', version: '0.4.1' }));
  app.get('/api/library', (_req, res) => res.json({ tracks: library.listTracks(), versions: library.listVersions(), playlists: library.listPlaylists() }));
  app.get('/api/import-tools', async (_req, res) => res.json(await online.tools()));
  app.get('/api/link-imports', (_req, res) => res.json(online.list()));
  app.get('/api/link-imports/:id', (req, res) => { const job = online.get(String(req.params.id)); if (!job) return res.status(404).json({ error: 'This import is no longer available. The server may have restarted; check your library or import the link again.' }); res.json(job); });
  app.post('/api/link-imports', async (req, res) => {
    try {
      if (req.body?.playlist !== undefined && typeof req.body.playlist !== 'boolean') return res.status(400).json({ error: 'Choose a track or playlist import.' });
      res.status(202).json(await online.start(req.body?.url, req.body?.playlist === true));
    }
    catch (error) { res.status(error instanceof ImportRequestError ? error.status : 400).json({ error: error instanceof Error ? error.message : 'Could not import this link.' }); }
  });
  app.delete('/api/link-imports/:id', (req, res) => {
    try { res.json(online.cancel(String(req.params.id))); }
    catch (error) { res.status(error instanceof ImportRequestError ? error.status : 400).json({ error: error instanceof Error ? error.message : 'Could not cancel this import.' }); }
  });
  app.get('/api/backup', (_req, res) => res.attachment(`MusicSuite-workspace-${new Date().toISOString().slice(0, 10)}.json`).json(library.backup()));
  app.post('/api/restore', (req, res) => {
    try { res.json(library.restore(req.body)); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not restore your workspace.' }); }
  });
  app.post('/api/playlists', (req, res) => {
    try { res.status(201).json(library.savePlaylist(null, req.body?.name, req.body?.trackIds ?? [])); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not create your playlist.' }); }
  });
  app.put('/api/playlists/:id', (req, res) => {
    if (!library.listPlaylists().some(p => p.id === req.params.id)) return res.status(404).json({ error: 'Playlist not found.' });
    try { res.json(library.savePlaylist(req.params.id, req.body?.name, req.body?.trackIds)); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not save your playlist.' }); }
  });
  app.delete('/api/playlists/:id', (req, res) => res.status(library.deletePlaylist(req.params.id) ? 204 : 404).end());

  app.post('/api/import', upload.array('files', 50), async (req, res) => {
    const files = (req.files ?? []) as Express.Multer.File[];
    if (!files.length) return res.status(400).json({ error: 'Choose at least one audio file.' });
    const results: { tracks: unknown[]; duplicates: number; errors: { name: string; message: string }[] } = { tracks: [], duplicates: 0, errors: [] };
    for (const file of files) {
      try {

        const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const imported = await library.importFile(file.path, name, file.size);
        results.tracks.push(imported.track);
        if (imported.duplicate) results.duplicates++;
      } catch (error) {
        results.errors.push({ name: file.originalname, message: error instanceof Error ? error.message : 'Could not import this file.' });
      } finally { await rm(file.path, { force: true }); }
    }
    res.json(results);
  });

  app.post('/api/demo', async (_req, res) => {
    const filename = path.join(library.directory, 'incoming', randomUUID());
    const audio = createDemoWav();
    await writeFile(filename, audio);
    try {
      const result = await library.importFile(filename, 'Blue hour.wav', audio.length, { title: 'Blue hour', artist: 'MusicSuite Sessions', album: 'Studio sketches' });
      res.json(result);
    } finally { await rm(filename, { force: true }); }
  });

  app.get('/api/tracks/:id/audio', (req, res) => {
    const track = library.getRow(req.params.id);
    if (!track) return res.status(404).json({ error: 'Track not found.' });
    res.sendFile(library.audioPath(track), { dotfiles: 'allow', headers: { 'Cache-Control': 'private, max-age=31536000, immutable' } });
  });

  app.get('/api/tracks/:id/artwork', (req, res) => {
    const track = library.getRow(req.params.id);
    if (!track?.artwork_mime) return res.status(404).end();
    res.type(track.artwork_mime).sendFile(library.artworkPath(track.id), { dotfiles: 'allow', headers: { 'Cache-Control': 'private, no-cache' } });
  });

  app.post('/api/tracks/:id/artwork', coverUpload.single('artwork'), async (req, res) => {
    const id = String(req.params.id);
    if (!library.getRow(id)) return res.status(404).json({ error: 'Track not found.' });
    try { res.json(await library.setArtwork(id, req.file?.buffer ?? new Uint8Array())); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update your cover.' }); }
  });
  app.delete('/api/tracks/:id/artwork', async (req, res) => {
    if (!library.getRow(req.params.id)) return res.status(404).json({ error: 'Track not found.' });
    res.json(await library.removeArtwork(req.params.id));
  });

  app.patch('/api/tracks/:id', (req, res) => {
    if (!library.getRow(req.params.id)) return res.status(404).json({ error: 'Track not found.' });
    if (typeof req.body?.favorite === 'boolean') return res.json(library.setFavorite(req.params.id, req.body.favorite));
    try { res.json(library.updateTrack(req.params.id, req.body)); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update this track.' }); }
  });

  app.delete('/api/tracks/:id', async (req, res) => {
    const removed = await library.deleteTrack(req.params.id);
    res.status(removed ? 204 : 404).end();
  });

  app.post('/api/tracks/:id/versions', (req, res) => {
    if (!library.getRow(req.params.id)) return res.status(404).json({ error: 'Track not found.' });
    try { res.status(201).json(library.saveVersion(req.params.id, req.body?.name, req.body?.settings, req.body?.edit)); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not save this version.' }); }
  });

  app.delete('/api/versions/:id', (req, res) => res.status(library.deleteVersion(req.params.id) ? 204 : 404).end());

  app.use('/api', (_req, res) => res.status(404).json({ error: 'This action is not available.' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? 'Audio must be under 100 MB and cover art under 10 MB.' : 'Choose the supported files for this action.';
      return res.status(400).json({ error: message });
    }
    if (error && typeof error === 'object' && 'type' in error && (error.type === 'entity.too.large' || error.type === 'entity.parse.failed')) return res.status(400).json({ error: 'Choose a valid workspace backup under 8 MB.' });
    console.error('MusicSuite request failed:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'MusicSuite could not finish this action. Try again.' });
  });
  return app;
}
