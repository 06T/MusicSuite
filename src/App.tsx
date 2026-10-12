import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react';
import { ArrowUpRight, CheckCircle, DownloadSimple, FolderPlus, FolderSimple, Headphones, Heart, Info, LinkSimple, List, ListPlus, MagnifyingGlass, MusicNotes, Pause, PencilSimple, Play, Plus, Repeat, Shuffle, SkipBack, SkipForward, SpeakerHigh, SpeakerSlash, SpinnerGap, SquaresFour, Stack, Trash, VinylRecord as Vinyl, X } from '@phosphor-icons/react';
import { DEFAULT_EDIT, DEFAULT_MIX, resolveEdit, validateEdit, validateMix, type AudioEdit, type MixSettings, type Playlist, type SavedVersion, type Track } from '../shared/types.ts';
import { api, favoriteTrack, formatSize, formatTime, getLibrary, readLocal, saveVersion, uploadFiles, writeLocal } from './api.ts';
import { AudioEngine } from './audio/engine.ts';
import { exportAudio } from './audio/export.ts';
import { Artwork, Disc } from './components/Artwork.tsx';
import { Modal } from './components/Modal.tsx';
import { Studio } from './components/Studio.tsx';
import { Waveform } from './components/Waveform.tsx';
import { LibraryView } from './components/LibraryView.tsx';
import { PlaylistDialog } from './components/PlaylistDialog.tsx';
import { TrackDetails } from './components/TrackDetails.tsx';
import { Toast } from './components/Toast.tsx';
import { ImportFeedback, type ImportProgress, type ImportReport } from './components/ImportFeedback.tsx';
import { IMPORT_BATCH_SIZE, MAX_AUDIO_BYTES, isAudioFile, readDroppedAudio, type DroppedAudio } from './importAudio.ts';
import { isImportFinished, type OnlineJob } from '../shared/online.ts';
import { LinkImport, OnlineImportStatus, providerName } from './components/LinkImport.tsx';
import { validateQueuePreferences } from '../shared/queue.ts';
import { useListeningQueue } from './useListeningQueue.ts';
import { useMediaSession } from './useMediaSession.ts';
import { UpNext } from './components/UpNext.tsx';
import { ThemePicker } from './components/ThemePicker.tsx';

type View = 'library' | 'favorites' | 'versions' | 'playlist';
type Draft = { settings: MixSettings; edit: AudioEdit; name: string };
type History = { past: Draft[]; future: Draft[]; group: string; at: number };
type Session = { selectedId: string | null; drafts: Record<string, Draft>; volume: number; position: number; positionTrack: string | null };
type Notice = { id: number; message: string; error: boolean };

function initialSession(): Session {
  const fallback: Session = { selectedId: null, drafts: {}, volume: 0.75, position: 0, positionTrack: null };
  const stored = readLocal<Partial<Session>>('musicsuite.session', {});
  const drafts: Record<string, Draft> = {};
  if (stored.drafts && typeof stored.drafts === 'object') for (const [id, draft] of Object.entries(stored.drafts)) {
    try { drafts[id] = { settings: validateMix(draft.settings), edit: validateEdit(draft.edit), name: typeof draft.name === 'string' ? draft.name : 'Custom mix' }; } catch { /* Ignore outdated drafts. */ }
  }
  return {
    ...fallback, drafts,
    selectedId: typeof stored.selectedId === 'string' ? stored.selectedId : null,
    volume: typeof stored.volume === 'number' && Number.isFinite(stored.volume) ? Math.max(0, Math.min(1, stored.volume)) : fallback.volume,
    position: typeof stored.position === 'number' && Number.isFinite(stored.position) ? Math.max(0, stored.position) : 0,
    positionTrack: typeof stored.positionTrack === 'string' ? stored.positionTrack : null,
  };
}

export default function App() {
  const [session] = useState(initialSession);
  const [queuePreferences] = useState(() => validateQueuePreferences(readLocal('musicsuite.queue', null)));
  const [engine] = useState(() => new AudioEngine());
  const player = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [versions, setVersions] = useState<SavedVersion[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(session.selectedId);
  const [settings, setSettings] = useState<MixSettings>(session.selectedId && session.drafts[session.selectedId] ? session.drafts[session.selectedId].settings : { ...DEFAULT_MIX });
  const [mixName, setMixName] = useState(session.selectedId && session.drafts[session.selectedId] ? session.drafts[session.selectedId].name : 'Original');
  const [edit, setEdit] = useState<AudioEdit>(session.selectedId ? session.drafts[session.selectedId]?.edit ?? { ...DEFAULT_EDIT } : { ...DEFAULT_EDIT });
  const [loop, setLoop] = useState(false);
  const [shuffle, setShuffle] = useState(queuePreferences.shuffle);
  const [repeat, setRepeat] = useState(queuePreferences.repeat);
  const [crossfade, setCrossfade] = useState(() => {
    const value = readLocal<unknown>('musicsuite.crossfade', 3);
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(12, value)) : 3;
  });
  const [sort, setSort] = useState(readLocal('musicsuite.sort', 'recent'));
  const [playlistId, setPlaylistId] = useState<string | null>(queuePreferences.playlistId);
  const [playlistDialog, setPlaylistDialog] = useState<{ playlist: Playlist | null; initialTrack?: string } | null>(null);
  const [detailsTrack, setDetailsTrack] = useState<Track | null>(null);
  const [removePlaylist, setRemovePlaylist] = useState<Playlist | null>(null);
  const [backupFile, setBackupFile] = useState<{ name: string; value: unknown } | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [volume, setVolume] = useState(session.volume);
  const [view, setView] = useState<View>(queuePreferences.view);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [grid, setGrid] = useState(readLocal('musicsuite.grid', true));
  const [queueOpen, setQueueOpen] = useState(() => readLocal<unknown>('musicsuite.upNext', false) === true);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress>({ complete: 0, total: 0, percent: 0, reading: false });
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [inputMode, setInputMode] = useState('pointer');
  const [dragging, setDragging] = useState(false);
  const [dialog, setDialog] = useState<'save' | 'export' | 'help' | 'backup' | 'add-playlist' | 'link-import' | null>(null);
  const [onlineId, setOnlineId] = useState<string | null>(() => readLocal('musicsuite.onlineJob', null));
  const [onlineJob, setOnlineJob] = useState<OnlineJob | null>(null);
  const [onlineConnectionError, setOnlineConnectionError] = useState('');
  const [removeTrack, setRemoveTrack] = useState<Track | null>(null);
  const [removeVersion, setRemoveVersion] = useState<SavedVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [bitDepth, setBitDepth] = useState<16 | 24>(24);
  const [includeTail, setIncludeTail] = useState(true);
  const [normalize, setNormalize] = useState(false);
  const [exportPhase, setExportPhase] = useState('');
  const [notices, setNotices] = useState<Notice[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const shouldPlay = useRef(false);
  const restored = useRef(false);
  const dragDepth = useRef(0);
  const importLock = useRef(false);
  const drafts = useRef(session.drafts);
  const history = useRef<Record<string, History>>({});
  const ended = useRef(0);
  const unmutedVolume = useRef(session.volume || 0.75);
  const current = useRef({ selectedId, settings, edit, mixName, volume, loop });
  current.current = { selectedId, settings, edit, mixName, volume, loop };
  const tracksById = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);
  const selected = tracksById.get(selectedId ?? '') ?? null;
  const trackVersions = useMemo(() => versions.filter(version => version.trackId === selectedId), [versions, selectedId]);
  const ready = !!selected && !!player.duration && !player.loading;
  const activePlaylist = playlists.find(p => p.id === playlistId) ?? null;
  const sortedTracks = useMemo(() => [...tracks].sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'artist' ? a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title) : sort === 'duration' ? a.duration - b.duration : b.createdAt.localeCompare(a.createdAt)), [tracks, sort]);
  const viewTracks = useMemo(() => view === 'playlist' ? (activePlaylist?.trackIds.flatMap(id => tracksById.get(id) ?? []) ?? []) : sortedTracks.filter(track => view !== 'favorites' || track.favorite), [view, activePlaylist, tracksById, sortedTracks]);
  const queueControl = useListeningQueue(viewTracks, view === 'playlist' ? `playlist:${playlistId}` : view, shuffle, repeat, selectedId, libraryLoading, queuePreferences);
  const queue = queueControl.ids;
  const upcomingTracks = useMemo(() => queueControl.upcoming.flatMap(id => tracksById.get(id) ?? []), [queueControl.upcoming, tracksById]);
  const canPrevious = queue.length > 1 || queue.length === 1 && queue[0] !== selectedId;
  const canNext = queueControl.upcoming.length > 0;
  const trackHistory = selectedId ? history.current[selectedId] : undefined;
  void historyTick;

  const notify = useCallback((message: string, error = false) => {
    const id = Date.now() + Math.random();
    setNotices(previous => [...previous.slice(-3), { id, message, error }]);
  }, []);

  const reloadLibrary = useCallback(async () => {
    setLibraryLoading(true); setLibraryError('');
    try {
      const library = await getLibrary(); setTracks(library.tracks); setVersions(library.versions); setPlaylists(library.playlists);
      if (!library.tracks.some(track => track.id === current.current.selectedId)) {
        const first = library.tracks[0];
        setSelectedId(first?.id ?? null);
        const draft = first ? drafts.current[first.id] : undefined;
        setSettings(draft?.settings ?? { ...DEFAULT_MIX }); setEdit(draft?.edit ?? { ...DEFAULT_EDIT }); setMixName(draft?.name ?? 'Original');
      }
    } catch (error) { setLibraryError(error instanceof Error ? error.message : 'Could not open your library.'); }
    finally { setLibraryLoading(false); }
  }, []);

  useEffect(() => { void reloadLibrary(); }, [reloadLibrary]);
  useEffect(() => {
    if (!onlineId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let syncedTracks = -1;
    async function poll() {
      try {
        const job = await api<OnlineJob>(`/api/link-imports/${onlineId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setOnlineJob(job); setOnlineConnectionError('');
        const available = job.collection ? job.collection.added + job.collection.duplicates : job.track ? 1 : 0;
        if (available > 0 && (available !== syncedTracks || isImportFinished(job))) {
          try {
            const library = await getLibrary(); if (controller.signal.aborted) return;
            setTracks(library.tracks); setVersions(library.versions); setPlaylists(library.playlists); syncedTracks = available;
            if (!current.current.selectedId) { const first = job.track?.id ?? job.playlist?.trackIds[0]; if (first) switchTrack(first, undefined, false); }
          } catch { if (isImportFinished(job)) notify('Your audio was imported. Reload MusicSuite to refresh the library.', true); }
        }
        if (isImportFinished(job)) {
          setOnlineId(null); writeLocal('musicsuite.onlineJob', null);
          if (job.collection && available > 0) notify(`${job.state === 'cancelled' ? 'Import stopped. ' : ''}${job.collection.added} added, ${job.collection.duplicates} already in your library${job.collection.failed ? `, ${job.collection.failed} skipped` : ''}. “${job.playlist?.name ?? job.collection.title}” is ready.`, job.state === 'failed');
          else if (job.track) notify(job.duplicate ? 'This track is already in your library.' : `“${job.track.title}” added from ${providerName(job.provider)}.`);
          if (job.error) notify(job.error, true);
          return;
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'Could not check the import.';
        if (message.includes('no longer available')) {
          try { const library = await getLibrary(); if (controller.signal.aborted) return; setTracks(library.tracks); setVersions(library.versions); setPlaylists(library.playlists); } catch { /* The dialog reports the connection error. */ }
          setOnlineJob(null); setOnlineId(null); writeLocal('musicsuite.onlineJob', null); setOnlineConnectionError(message); notify(message, true); return;
        }
        setOnlineConnectionError('Connection interrupted. Reconnecting to your import…');
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1000);
    }
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [onlineId, notify]);
  useEffect(() => {
    const keyboard = () => setInputMode('keyboard');
    const pointer = () => setInputMode('pointer');
    window.addEventListener('keydown', keyboard, true); window.addEventListener('pointerdown', pointer, true);
    return () => { window.removeEventListener('keydown', keyboard, true); window.removeEventListener('pointerdown', pointer, true); };
  }, []);
  useEffect(() => {
    if (!selectedId || !tracks.some(track => track.id === selectedId)) return;
    const controller = new AbortController();
    const autoplay = shouldPlay.current; shouldPlay.current = false;

    if (engine.getSnapshot().trackId === selectedId && engine.getBuffer()) return;
    void engine.load(selectedId, controller.signal).then(async () => {
      if (controller.signal.aborted) return;
      if (!restored.current && session.positionTrack === selectedId) await engine.seek(session.position);
      restored.current = true;
      if (autoplay) await engine.play();
    }).catch(error => notify(error instanceof Error ? error.message : 'Could not play this track.', true));
    return () => controller.abort();


  }, [selectedId, engine, notify, libraryLoading]);

  useEffect(() => { engine.setMix(settings); }, [engine, settings]);
  useEffect(() => { void engine.setEdit(edit, loop).catch(error => notify(error.message, true)); }, [engine, edit, loop, notify]);
  useEffect(() => { engine.setVolume(volume); }, [engine, volume]);
  useEffect(() => { if (volume > 0) unmutedVolume.current = volume; }, [volume]);
  useEffect(() => {
    if (selectedId) drafts.current[selectedId] = { settings, edit, name: mixName };
    writeLocal('musicsuite.session', { selectedId, drafts: drafts.current, volume, position: engine.position(), positionTrack: selectedId });
  }, [selectedId, settings, edit, mixName, volume, engine]);
  useEffect(() => { writeLocal('musicsuite.grid', grid); }, [grid]);
  useEffect(() => { writeLocal('musicsuite.sort', sort); }, [sort]);
  useEffect(() => { writeLocal('musicsuite.crossfade', crossfade); }, [crossfade]);
  useEffect(() => { writeLocal('musicsuite.upNext', queueOpen); }, [queueOpen]);
  useEffect(() => {
    if (!libraryLoading && !libraryError) writeLocal('musicsuite.queue', { view, playlistId, shuffle, repeat, order: queue, excluded: queueControl.excluded, custom: queueControl.custom });
  }, [view, playlistId, shuffle, repeat, queue, queueControl.excluded, queueControl.custom, libraryLoading, libraryError]);
  useEffect(() => {
    if (!libraryLoading && !libraryError && view === 'playlist' && !activePlaylist) { setView('library'); setPlaylistId(null); }
  }, [libraryLoading, libraryError, view, activePlaylist]);
  useEffect(() => {
    const persist = () => {
      const value = current.current;
      writeLocal('musicsuite.session', { ...value, drafts: drafts.current, position: engine.position(), positionTrack: value.selectedId });
    };
    const interval = setInterval(persist, 3000); window.addEventListener('beforeunload', persist);
    return () => { persist(); clearInterval(interval); window.removeEventListener('beforeunload', persist); engine.dispose(); };
  }, [engine]);

  const togglePlay = useCallback(async () => {
    try { if (engine.isPlaying()) engine.pause(); else await engine.play(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not start playback.', true); }
  }, [engine, notify]);
  const toggleMute = useCallback(() => setVolume(value => value > 0 ? 0 : unmutedVolume.current), []);

  const applyDraft = useCallback((draft: Draft) => {
    current.current = { ...current.current, settings: draft.settings, edit: draft.edit, mixName: draft.name };
    setSettings({ ...draft.settings }); setEdit({ ...draft.edit }); setMixName(draft.name);
  }, []);

  const changeDraft = useCallback((next: Draft, group = '') => {
    const value = current.current; if (!value.selectedId) return;
    const previous = { settings: { ...value.settings }, edit: { ...value.edit }, name: value.mixName };
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    const stack = history.current[value.selectedId] ?? { past: [], future: [], group: '', at: 0 };
    if (!group || group !== stack.group || Date.now() - stack.at > 600 || stack.future.length) stack.past.push(previous);
    stack.past = stack.past.slice(-60); stack.future = []; stack.group = group; stack.at = Date.now();
    history.current[value.selectedId] = stack; applyDraft(next); setHistoryTick(tick => tick + 1);
  }, [applyDraft]);

  const switchTrack = useCallback((id: string, draft?: Draft, autoplay = true) => {
    const value = current.current;
    if (value.selectedId) drafts.current[value.selectedId] = { settings: value.settings, edit: value.edit, name: value.mixName };
    const next = draft ?? drafts.current[id] ?? { settings: { ...DEFAULT_MIX }, edit: { ...DEFAULT_EDIT }, name: 'Original' };
    if (id === value.selectedId && draft) changeDraft(next);
    else { engine.setMix(next.settings); setSettings({ ...next.settings }); setEdit({ ...next.edit }); setMixName(next.name); }
    if (id === value.selectedId) {
      engine.setMix(next.settings);
      void engine.setEdit(next.edit, value.loop).then(async () => { if (autoplay && !engine.getSnapshot().playing) await engine.play(); }).catch(error => notify(error.message, true));
    }
    else { shouldPlay.current = autoplay; setSelectedId(id); }
  }, [changeDraft, engine, notify]);
  const selectTrack = useCallback((track: Track) => switchTrack(track.id), [switchTrack]);
  const selectVersion = useCallback((version: SavedVersion) => switchTrack(version.trackId, { settings: version.settings, edit: version.edit, name: version.name }), [switchTrack]);

  function changeMix(mix: MixSettings, name = 'Custom mix') {
    const keys = (Object.keys(mix) as (keyof MixSettings)[]).filter(key => mix[key] !== current.current.settings[key]);
    changeDraft({ settings: mix, edit: current.current.edit, name }, keys.length === 1 && name === 'Custom mix' ? keys[0] : '');
  }

  function changeEdit(next: AudioEdit) {
    const keys = (Object.keys(next) as (keyof AudioEdit)[]).filter(key => next[key] !== current.current.edit[key]);
    changeDraft({ settings: current.current.settings, edit: next, name: 'Custom mix' }, keys.length === 1 ? keys[0] : '');
  }

  const restoreHistory = useCallback((redo = false) => {
    const value = current.current; const stack = value.selectedId ? history.current[value.selectedId] : undefined; if (!stack) return;
    const from = redo ? stack.future : stack.past; const to = redo ? stack.past : stack.future;
    const next = from.pop(); if (!next) return;
    to.push({ settings: { ...value.settings }, edit: { ...value.edit }, name: value.mixName }); stack.group = ''; stack.at = 0;
    applyDraft(next); setHistoryTick(tick => tick + 1);
  }, [applyDraft]);

  async function importAudio(source: File[] | Promise<DroppedAudio>) {
    if (importLock.current || importing) return;
    importLock.current = true;
    setImporting(true); setImportReport(null);
    setImportProgress({ complete: 0, total: 0, percent: 0, reading: false });
    const report: ImportReport = { added: 0, duplicates: 0, ignored: 0, errors: [] };
    let firstTrack: Track | undefined;
    try {
      const scanned = Array.isArray(source) ? { files: source, errors: [] } : await source;
      report.errors.push(...scanned.errors);
      const files = scanned.files.filter(file => {
        if (!isAudioFile(file)) { report.ignored++; return false; }
        if (file.size > MAX_AUDIO_BYTES) { report.errors.push(`${file.name}: larger than the 100 MB limit.`); return false; }
        return true;
      });
      if (!files.length) { report.errors.push('No supported audio files were found. Choose a folder containing music.'); return; }
      for (let offset = 0; offset < files.length; offset += IMPORT_BATCH_SIZE) {
        const batch = files.slice(offset, offset + IMPORT_BATCH_SIZE);
        setImportProgress({ complete: offset, total: files.length, percent: Math.round(offset / files.length * 100), reading: false });
        try {
          const result = await uploadFiles(batch, percent => setImportProgress({ complete: offset, total: files.length, percent: Math.round((offset + batch.length * percent / 100) / files.length * 100), reading: percent === 100 }));
          report.added += result.tracks.length - result.duplicates; report.duplicates += result.duplicates;
          report.errors.push(...result.errors.map(error => `${error.name}: ${error.message}`));
          firstTrack ??= result.tracks[0];
        } catch (error) {
          report.errors.push(`${batch.length} files: ${error instanceof Error ? error.message : 'Import failed.'}`);

          if (offset + batch.length < files.length) report.errors.push(`${files.length - offset - batch.length} ${files.length - offset - batch.length === 1 ? 'file was' : 'files were'} not attempted. Import the folder again to continue; duplicates will be skipped.`);
          break;
        }
      }
      const library = await getLibrary(); setTracks(library.tracks); setVersions(library.versions); setPlaylists(library.playlists);
      if (!current.current.selectedId && firstTrack) switchTrack(firstTrack.id, undefined, false);
      setView('library');
    } catch (error) { report.errors.push(error instanceof Error ? error.message : 'Import failed.'); }
    finally { setImportReport(report); setImporting(false); importLock.current = false; if (fileInput.current) fileInput.current.value = ''; if (folderInput.current) folderInput.current.value = ''; }
  }

  async function tryDemo() {
    if (importing) return;
    setImporting(true); setImportReport(null);
    try {
      const result = await api<{ track: Track; duplicate: boolean }>('/api/demo', { method: 'POST' });
      const library = await getLibrary(); setTracks(library.tracks); setVersions(library.versions); setPlaylists(library.playlists);
      switchTrack(result.track.id); notify('Blue hour is an original studio sketch. Make it your own.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not load the demo.', true); }
    finally { setImporting(false); }
  }

  async function startOnlineImport(url: string, playlist = false) {
    const job = await api<OnlineJob>('/api/link-imports', { method: 'POST', body: JSON.stringify({ url, playlist }) });
    setOnlineJob(job); setOnlineConnectionError(''); setOnlineId(job.id); writeLocal('musicsuite.onlineJob', job.id);
  }
  async function cancelOnlineImport() {
    if (!onlineJob) return;
    const job = await api<OnlineJob>(`/api/link-imports/${onlineJob.id}`, { method: 'DELETE' });
    setOnlineJob(job);

  }

  async function openImportedPlaylist(playlist: Playlist) {
    try {
      const library = await getLibrary(); setTracks(library.tracks); setVersions(library.versions); setPlaylists(library.playlists);
      if (!library.playlists.some(item => item.id === playlist.id)) throw new Error('This playlist has been removed. Your completed tracks remain in the library.');
      setPlaylistId(playlist.id); setView('playlist'); setQuery('');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not open this playlist.', true); }
  }

  const favorite = useCallback(async (track: Track) => {
    try { const updated = await favoriteTrack(track.id, !track.favorite); setTracks(previous => previous.map(item => item.id === track.id ? updated : item)); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update this favorite.', true); }
  }, [notify]);

  const nextTrack = useCallback((direction: number, automatic = false) => {
    if (!queue.length) return;
    const index = queue.indexOf(current.current.selectedId ?? '');
    if (direction > 0 && index === queue.length - 1 && !repeat) return;
    const id = queue[index < 0 ? direction > 0 ? 0 : queue.length - 1 : (index + direction + queue.length) % queue.length];
    const value = current.current;

    const edit = id === value.selectedId ? value.edit : drafts.current[id]?.edit ?? DEFAULT_EDIT;
    switchTrack(id, { settings: { ...value.settings }, edit: { ...edit }, name: value.mixName }, automatic || engine.isPlaying());
  }, [queue, repeat, switchTrack, engine]);

  useMediaSession(engine, selected, settings.speed, edit, ready, canNext, canPrevious, nextTrack, notify);

  useEffect(() => { if (player.ended === ended.current) return; ended.current = player.ended; nextTrack(1, true); }, [player.ended]);

  useEffect(() => {
    if (!player.trackId || !player.playing || player.trackId === current.current.selectedId) return;
    const previous = current.current;
    if (previous.selectedId) drafts.current[previous.selectedId] = { settings: previous.settings, edit: previous.edit, name: previous.mixName };
    const nextEdit = engine.getEdit();
    current.current = { ...previous, selectedId: player.trackId, edit: nextEdit };
    shouldPlay.current = false; setEdit(nextEdit); setSelectedId(player.trackId);
  }, [player.trackId, player.playing, engine]);

  useEffect(() => {
    if (player.crossfading || player.trackId !== selectedId || !ready) return;
    const index = queue.indexOf(selectedId ?? '');
    const nextId = !loop && queue.length && (index < queue.length - 1 || repeat) ? queue[(index + 1) % queue.length] : null;
    const nextEdit = nextId === selectedId ? edit : nextId ? drafts.current[nextId]?.edit ?? DEFAULT_EDIT : DEFAULT_EDIT;
    void engine.prepareNext(nextId, nextEdit, crossfade, tracksById.get(nextId ?? '')?.duration);
  }, [engine, selectedId, player.trackId, player.crossfading, ready, queue, repeat, loop, crossfade, edit, tracksById]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !target?.closest('input, textarea, dialog, [contenteditable="true"]')) { event.preventDefault(); restoreHistory(event.shiftKey); return; }
      if (target?.closest('input, textarea, select, button, dialog, [contenteditable="true"]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space' && ready) { event.preventDefault(); void togglePlay(); }
      else if (event.key === '/' && !dialog) { event.preventDefault(); searchInput.current?.focus(); }
      else if (event.key === 'ArrowRight' && ready) { event.preventDefault(); void engine.seek(engine.position() + 5 * settings.speed); }
      else if (event.key === 'ArrowLeft' && ready) { event.preventDefault(); void engine.seek(engine.position() - 5 * settings.speed); }
      else if (event.key.toLowerCase() === 'm') toggleMute();
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [engine, ready, dialog, settings.speed, togglePlay, toggleMute, restoreHistory]);

  async function submitVersion(event: FormEvent) {
    event.preventDefault(); if (!selected) return; setBusy(true);
    try {
      const version = await saveVersion(selected.id, versionName, settings, edit);
      setVersions(previous => [version, ...previous]); setMixName(version.name);
      setTracks(previous => previous.map(track => track.id === selected.id ? { ...track, versionCount: track.versionCount + 1 } : track));
      setDialog(null); notify(`“${version.name}” saved.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save your version.', true); }
    finally { setBusy(false); }
  }

  async function submitExport(event: FormEvent) {
    event.preventDefault(); const buffer = engine.getBuffer(); if (!buffer || !selected) return;
    setBusy(true); setExportPhase('Preparing audio…');
    try {
      const result = await exportAudio(buffer, { ...settings }, { bitDepth, tail: includeTail, normalize, edit: { ...edit } }, setExportPhase);
      const filename = `${selected.title} - ${mixName}`.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 180).trim() || 'MusicSuite mix';
      const url = URL.createObjectURL(result.blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${filename}.wav`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      setDialog(null); notify(result.clipped ? 'WAV exported. Some peaks clipped; try lowering output gain or enabling normalization.' : 'Your mix is exported. Enjoy the new sound.', !!result.clipped);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not export this mix.', true); }
    finally { setBusy(false); setExportPhase(''); }
  }

  async function confirmRemove() {
    setBusy(true);
    try {
      if (removeTrack) {
        await api(`/api/tracks/${removeTrack.id}`, { method: 'DELETE' });
        const remaining = tracks.filter(track => track.id !== removeTrack.id);
        setTracks(remaining); setVersions(previous => previous.filter(version => version.trackId !== removeTrack.id)); delete drafts.current[removeTrack.id];
        setPlaylists(previous => previous.map(p => ({ ...p, trackIds: p.trackIds.filter(id => id !== removeTrack.id) }))); delete history.current[removeTrack.id];
        if (selectedId === removeTrack.id) {
          engine.clear(); const first = remaining[0]; setSelectedId(first?.id ?? null);
          setSettings(first ? drafts.current[first.id]?.settings ?? { ...DEFAULT_MIX } : { ...DEFAULT_MIX });
          setEdit(first ? drafts.current[first.id]?.edit ?? { ...DEFAULT_EDIT } : { ...DEFAULT_EDIT });
          setMixName(first ? drafts.current[first.id]?.name ?? 'Original' : 'Original');
        }
        notify('Track removed from MusicSuite.'); setRemoveTrack(null);
      } else if (removeVersion) {
        await api(`/api/versions/${removeVersion.id}`, { method: 'DELETE' });
        setVersions(previous => previous.filter(version => version.id !== removeVersion.id));
        setTracks(previous => previous.map(track => track.id === removeVersion.trackId ? { ...track, versionCount: Math.max(0, track.versionCount - 1) } : track));
        if (selectedId === removeVersion.trackId && mixName === removeVersion.name) setMixName('Custom mix');
        notify('Saved version removed.'); setRemoveVersion(null);
      }
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not remove this item.', true); }
    finally { setBusy(false); }
  }

  function playlistSaved(playlist: Playlist) {
    setPlaylists(previous => [...previous.filter(p => p.id !== playlist.id), playlist]); setPlaylistId(playlist.id); setView('playlist'); setQuery(''); setPlaylistDialog(null); notify(`“${playlist.name}” saved.`);
  }

  async function addToPlaylist(playlist: Playlist) {
    if (!selected || playlist.trackIds.includes(selected.id)) return;
    setBusy(true);
    try {
      const updated = await api<Playlist>(`/api/playlists/${playlist.id}`, { method: 'PUT', body: JSON.stringify({ name: playlist.name, trackIds: [...playlist.trackIds, selected.id] }) });
      setPlaylists(previous => previous.map(p => p.id === updated.id ? updated : p)); setDialog(null); notify(`Added to “${updated.name}”.`);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not add this track.', true); }
    finally { setBusy(false); }
  }

  async function deletePlaylist() {
    if (!removePlaylist) return; setBusy(true);
    try { await api(`/api/playlists/${removePlaylist.id}`, { method: 'DELETE' }); setPlaylists(previous => previous.filter(p => p.id !== removePlaylist.id)); if (playlistId === removePlaylist.id) { setView('library'); setPlaylistId(null); } setRemovePlaylist(null); notify('Playlist removed. Your tracks stay in the library.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not remove this playlist.', true); }
    finally { setBusy(false); }
  }

  async function chooseBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('Choose a workspace backup under 8 MB.');
      const value = JSON.parse(await file.text());
      if (value?.app !== 'MusicSuite' || value?.format !== 1 || !Array.isArray(value.tracks) || !Array.isArray(value.playlists)) throw new Error('Choose a MusicSuite workspace backup.');
      setBackupFile({ name: file.name, value });
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not read this workspace backup.', true); }
    finally { if (backupInput.current) backupInput.current.value = ''; }
  }

  async function restoreBackup() {
    if (!backupFile) return; setBusy(true);
    try {
      const report = await api<{ matched: number; missing: number; versions: number; playlists: number }>('/api/restore', { method: 'POST', body: JSON.stringify(backupFile.value) });
      await reloadLibrary(); setBackupFile(null); setDialog(null);
      notify(`Workspace restored: ${report.matched} tracks matched, ${report.versions} versions and ${report.playlists} playlists added.${report.missing ? ` ${report.missing} audio files are missing; import them and restore again.` : ''}`, !!report.missing);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not restore this workspace.', true); }
    finally { setBusy(false); }
  }

  const viewTitle = view === 'playlist' ? activePlaylist?.name ?? 'Playlist' : view === 'library' ? 'Your library' : view === 'favorites' ? 'Favorites' : 'Saved versions';
  const count = view === 'versions' ? versions.length : viewTracks.length;
  const totalSize = useMemo(() => tracks.reduce((sum, track) => sum + track.size, 0), [tracks]);
  const viewDuration = useMemo(() => viewTracks.reduce((sum, track) => sum + track.duration, 0), [viewTracks]);
  const exportDuration = resolveEdit(edit, player.duration, settings.speed).length + (includeTail && settings.reverb > 0 ? settings.decay + 0.15 : 0);
  const exportSize = Math.ceil(exportDuration * 44100) * 2 * bitDepth / 8 + 44;
  const formatAccept = '.mp3,.wav,.flac,.m4a,.ogg,.aac,.opus,.aif,.aiff,audio/*';

  return <div className="app-shell" data-input={inputMode} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDragLeave={event => { event.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (event.dataTransfer.types.includes('Files') && !importLock.current && !importing) void importAudio(readDroppedAudio(event.dataTransfer)); }}>
    <input ref={fileInput} type="file" accept={formatAccept} multiple className="hidden-input" aria-label="Import audio files" onChange={event => void importAudio(Array.from(event.target.files ?? []))} />
    <input ref={backupInput} type="file" accept=".json,application/json" className="hidden-input" aria-label="Restore workspace file" onChange={event => void chooseBackup(event.target.files?.[0])} />
    <input ref={folderInput} type="file" multiple {...{ webkitdirectory: '', directory: '' }} className="hidden-input" aria-label="Import a music folder" onChange={event => { if (event.target.files?.length) void importAudio(Array.from(event.target.files)); }} />
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="MusicSuite home"><span className="brand-mark"><Vinyl weight="duotone" size={27} /></span><span>Music<span className="brand-light">Suite</span></span></a>
      <div className="sidebar-caption">Your listening space</div>
      <nav aria-label="Library navigation">{([{ id: 'library', label: 'Library', icon: MusicNotes }, { id: 'favorites', label: 'Favorites', icon: Heart }, { id: 'versions', label: 'Saved versions', icon: Stack }] as const).map(item => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => { setView(item.id); setQuery(''); }}><item.icon size={20} weight={view === item.id ? 'fill' : 'regular'} /><span>{item.label}</span>{item.id === 'versions' && versions.length > 0 && <span className="nav-count">{versions.length}</span>}</button>)}</nav>
      <div className="sidebar-divider" />
      <div className="playlist-nav"><div className="playlist-nav-heading"><span>Playlists</span><button className="icon-button small" aria-label="Create playlist" onClick={() => setPlaylistDialog({ playlist: null })}><Plus size={15} /></button></div><div className="playlist-nav-items">{playlists.map(playlist => <button key={playlist.id} className={`nav-item ${view === 'playlist' && playlistId === playlist.id ? 'active' : ''}`} aria-current={view === 'playlist' && playlistId === playlist.id ? 'page' : undefined} onClick={() => { setPlaylistId(playlist.id); setView('playlist'); setQuery(''); }}><List size={18} /><span>{playlist.name}</span><small>{playlist.trackIds.length}</small></button>)}{!playlists.length && <button className="text-button" onClick={() => setPlaylistDialog({ playlist: null })}>Make your first playlist</button>}</div></div>
      <button className="nav-item folder-import" disabled={importing} onClick={() => folderInput.current?.click()}><FolderPlus size={20} /><span>Import a folder</span></button>
      <button className="nav-item folder-import" disabled={importing} onClick={() => setDialog('link-import')}><LinkSimple size={20} /><span>Import from a link</span></button>
      <button className="nav-item folder-import" onClick={() => setDialog('backup')}><DownloadSimple size={20} /><span>Workspace backup</span></button>
      <div className="sidebar-bottom"><div className="local-card"><span className="local-icon"><FolderSimple size={21} /></span><strong>At home on your device</strong><p>Your library and mixes<br />stay right here.</p><div className="storage-info"><span>{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span><span>{formatSize(totalSize)}</span></div></div><button className="shortcut-help" onClick={() => setDialog('help')}><Info size={16} /><span>A few useful shortcuts</span></button></div>
    </aside>
    <div className="main-shell">
      <header className="app-header"><div className="breadcrumb"><Headphones size={17} /><span>Your music, at your pace.</span></div><div className="header-actions"><ThemePicker /><span className="local-status"><span />Local workspace</span><div className="import-actions"><button className="button secondary folder-button" aria-label="Import folder" title="Import a folder, including subfolders" disabled={importing} onClick={() => folderInput.current?.click()}><FolderPlus size={18} /><span className="import-label-desktop">Import folder</span><span className="import-label-mobile">Folder</span></button><button className="button secondary link-button" aria-label="Import link" disabled={importing} onClick={() => setDialog('link-import')}>{onlineJob && !isImportFinished(onlineJob) ? <SpinnerGap size={18} className="spin" /> : <LinkSimple size={18} />}<span className="import-label-desktop">Import link</span><span className="import-label-mobile">Link</span></button><button aria-label={importing ? 'Importing…' : 'Import music'} className="button primary import-button" disabled={importing} onClick={() => fileInput.current?.click()}>{importing ? <SpinnerGap size={18} className="spin" /> : <Plus size={18} />}<span className="import-label-desktop">{importing ? 'Importing…' : 'Import music'}</span><span className="import-label-mobile">{importing ? 'Importing…' : 'Files'}</span></button></div></div></header>
      <div className="workspace">
        <main className="library-main">
          <ImportFeedback importing={importing && importLock.current} progress={importProgress} report={importReport} onDismiss={() => setImportReport(null)} />
          {onlineJob && <OnlineImportStatus job={onlineJob} onOpen={() => setDialog('link-import')} />}
          <section className={`listening-deck ${!selected ? 'deck-empty' : ''}`} aria-label="Now playing">
            <div className="deck-topline"><span className="now-playing-label"><span className={player.playing ? 'play-dot active' : 'play-dot'} />{player.loading ? 'Loading your track' : player.playing ? 'Now playing' : selected ? 'Ready when you are' : 'Make yourself at home'}</span><span className="deck-format">{selected ? `${selected.format} / ${mixName}` : 'A little space for your sound'}</span></div>
            <div className="deck-center"><Disc track={selected} playing={player.playing} speed={settings.speed} /><div className="deck-copy">
              {selected ? <><span className="album-name" title={selected.album}>{selected.album}</span><h1 title={selected.title}>{selected.title}</h1><p className="artist-name" title={selected.artist}>{selected.artist}</p><div className="track-facts"><span>{formatTime(player.duration || selected.duration)}</span><span>{selected.format}</span>{selected.source && <span>{providerName(selected.source.provider)}</span>}{selected.versionCount > 0 && <span>{selected.versionCount} {selected.versionCount === 1 ? 'version' : 'versions'}</span>}</div><button className={`text-button deck-favorite ${selected.favorite ? 'active' : ''}`} aria-pressed={selected.favorite} onClick={() => void favorite(selected)}><Heart size={16} weight={selected.favorite ? 'fill' : 'regular'} />{selected.favorite ? 'In your favorites' : 'Add to favorites'}</button></>
                : <><span className="album-name">Welcome to MusicSuite</span><h1>A new spin<br />on your music.</h1><p className="empty-deck-text">Bring your collection. Find your pace.<br />Make something that sounds like you.</p><button className="text-button demo-button" disabled={importing} onClick={() => void tryDemo()}><Play size={16} weight="fill" />Try a studio sketch<ArrowUpRight size={14} /></button></>}
              {selected && <div className="deck-tools"><button className="text-button" onClick={() => setDetailsTrack(selected)}><PencilSimple size={15} />Track details</button><button className="text-button" onClick={() => setDialog('add-playlist')}><ListPlus size={15} />Add to playlist</button></div>}
            </div></div>
            <Waveform buffer={engine.getBuffer()} position={player.position} speed={settings.speed} onSeek={position => void engine.seek(position)} disabled={!ready} edit={edit} />
            <div className="transport"><div className="transport-volume"><button className="icon-button" aria-label={volume > 0 ? 'Mute' : 'Unmute'} onClick={toggleMute}>{volume > 0 ? <SpeakerHigh size={18} /> : <SpeakerSlash size={18} />}</button><input aria-label="Listening volume" type="range" min={0} max={1} step={0.01} value={volume} onChange={event => setVolume(Number(event.target.value))} style={{ '--fill': `${volume * 100}%` } as CSSProperties} /></div>
              <div className="playback-controls"><button className={`icon-button queue-toggle ${shuffle ? 'active' : ''}`} aria-label="Shuffle queue" aria-pressed={shuffle} disabled={!shuffle && queue.length < 2} onClick={() => setShuffle(!shuffle)}><Shuffle size={17} /></button><button className="icon-button" aria-label="Previous track" disabled={!ready || !canPrevious} onClick={() => nextTrack(-1)}><SkipBack size={20} weight="fill" /></button><button className="play-button" aria-label={player.playing ? 'Pause' : 'Play'} disabled={!ready} onClick={() => void togglePlay()}>{player.loading ? <SpinnerGap size={24} className="spin" /> : player.playing ? <Pause size={22} weight="fill" /> : <Play size={22} weight="fill" />}</button><button className="icon-button" aria-label="Next track" disabled={!ready || !canNext} onClick={() => nextTrack(1)}><SkipForward size={20} weight="fill" /></button><button className={`icon-button queue-toggle ${repeat ? 'active' : ''}`} aria-label="Repeat queue" aria-pressed={repeat} disabled={!ready} onClick={() => setRepeat(!repeat)}><Repeat size={17} /></button></div>
              <button className="button ghost export-trigger" aria-label="Export mix" disabled={!ready} onClick={() => setDialog('export')}><DownloadSimple size={17} /><span>Export mix</span></button>
            </div>
            {ready && <div className="queue-caption"><span>{player.crossfading ? 'Blending songs' : loop ? 'Selection on repeat' : activePlaylist && view === 'playlist' ? `Playing from ${activePlaylist.name}` : shuffle ? 'Shuffled listening' : 'Continuous listening'}</span><span>{!loop && upcomingTracks.length ? `Next: ${upcomingTracks[0].title}` : repeat && queue.length ? 'Queue repeats' : 'Last track in queue'}</span></div>}
            <div className={`crossfade-control ${player.crossfading ? 'is-blending' : ''}`}>
              <label htmlFor="crossfade"><span className="crossfade-symbol" aria-hidden="true"><span /><span /></span>Crossfade</label>
              <input id="crossfade" aria-label="Crossfade duration" aria-valuetext={crossfade ? `${crossfade} seconds` : 'Off'} type="range" min={0} max={12} step={1} value={crossfade} onChange={event => setCrossfade(Number(event.target.value))} style={{ '--fill': `${crossfade / 12 * 100}%` } as CSSProperties} />
              <output htmlFor="crossfade">{crossfade ? `${crossfade} s` : 'Off'}</output>
              <span className="crossfade-note" title={player.preloadLimited ? 'These tracks exceed the 256 MiB preloading budget. Playback continues without overlap.' : undefined}>{loop ? 'Paused for selection loop' : player.preloadLimited ? 'Long audio · overlap off' : player.crossfading ? 'A smooth handoff' : 'Blend into the next song'}</span>
            </div>
          </section>
          {selected && <UpNext tracks={upcomingTracks} current={selected} playing={player.playing} collection={view === 'playlist' ? activePlaylist?.name ?? 'this playlist' : view === 'favorites' ? 'Favorites' : 'your library'} expanded={queueOpen} modified={queueControl.custom || queueControl.excluded.length > 0} repeat={repeat && queue.length > 0} loop={loop} onExpandedChange={setQueueOpen} onMove={queueControl.move} onPlace={queueControl.place} onRemove={queueControl.remove} onReset={queueControl.reset} />}
          <section className="library-section" aria-label={viewTitle}>
            <div className="compact-collections"><select aria-label="Choose collection" value={view === 'playlist' ? playlistId ?? 'library' : view} onChange={event => { const value = event.target.value; if (['library', 'favorites', 'versions'].includes(value)) setView(value as View); else { setView('playlist'); setPlaylistId(value); } setQuery(''); }}><option value="library">All music</option><option value="favorites">Favorites</option><option value="versions">Saved versions</option>{playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="icon-button" aria-label="Create playlist" onClick={() => setPlaylistDialog({ playlist: null })}><ListPlus size={18} /></button><button className="icon-button" aria-label="Workspace backup" onClick={() => setDialog('backup')}><DownloadSimple size={18} /></button></div>
            <div className="library-heading"><div><h2>{viewTitle}<span className="count-badge">{count}</span></h2><p>{view === 'playlist' ? `${formatTime(viewDuration)} of music, in your order.` : view === 'versions' ? 'Different moods. Same favorite songs.' : view === 'favorites' ? 'The ones you keep coming back to.' : 'Good sounds deserve a place of their own.'}</p></div><div className="library-heading-actions">{view === 'playlist' && activePlaylist && <><button className="icon-button" aria-label="Edit playlist" onClick={() => setPlaylistDialog({ playlist: activePlaylist })}><PencilSimple size={17} /></button><button className="icon-button" aria-label="Delete playlist" onClick={() => setRemovePlaylist(activePlaylist)}><Trash size={17} /></button></>}{view !== 'versions' && <div className="view-switch" aria-label="Library layout"><button className={grid ? 'active' : ''} aria-label="Grid view" aria-pressed={grid} onClick={() => setGrid(true)}><SquaresFour size={18} weight={grid ? 'fill' : 'regular'} /></button><button className={!grid ? 'active' : ''} aria-label="List view" aria-pressed={!grid} onClick={() => setGrid(false)}><List size={19} /></button></div>}</div></div>
            {tracks.length > 0 && <div className="library-toolbar"><label className="search"><MagnifyingGlass size={17} /><input ref={searchInput} aria-label="Search library" placeholder="Search tracks, artists, albums…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button small" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label>{view !== 'playlist' && view !== 'versions' && <select className="library-sort" aria-label="Sort library" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Recently added</option><option value="title">Title A–Z</option><option value="artist">Artist A–Z</option><option value="duration">Shortest first</option></select>}</div>}
            {libraryLoading ? <div className="empty-small"><SpinnerGap className="spin" size={28} /><p>Opening your library…</p></div> : libraryError ? <div className="empty-small error-empty"><Info size={28} /><h3>Could not open your library</h3><p>{libraryError}</p><button className="button secondary" onClick={() => void reloadLibrary()}>Try again</button></div> : !tracks.length ? <div className="import-empty"><span className="import-empty-icon"><MusicNotes size={28} /></span><h3>Your collection starts with one track.</h3><p>Drop files or a music folder here. Subfolders are included.</p><div className="empty-import-actions"><button className="button primary" onClick={() => folderInput.current?.click()} disabled={importing}><FolderPlus size={17} />Choose a folder</button><button className="button secondary" onClick={() => fileInput.current?.click()} disabled={importing}><Plus size={17} />Choose audio files</button></div><span className="supported-formats">MP3, WAV, FLAC, M4A, OGG and more · Up to 100 MB</span></div> : <LibraryView tracks={view === 'versions' ? tracks : viewTracks} versions={versions} selectedId={selectedId} view={view} grid={grid} query={deferredQuery} onSelect={selectTrack} onFavorite={favorite} onRemove={setRemoveTrack} onVersion={selectVersion} onDeleteVersion={setRemoveVersion} />}
          </section>
          <footer className="workspace-footer"><Vinyl size={14} /><span>Made for listening a little differently.</span><span>Everything stays local.</span></footer>
        </main>
        <Studio track={selected} settings={settings} onChange={changeMix} onSave={() => { setVersionName(mixName === 'Original' || mixName === 'Custom mix' ? 'My mix' : mixName); setDialog('save'); }} versions={trackVersions} onVersion={selectVersion} mixName={mixName} peak={player.peak} edit={edit} duration={ready ? player.duration : 0} position={player.position} loop={loop} onEdit={changeEdit} onLoop={() => setLoop(!loop)} onUndo={() => restoreHistory()} onRedo={() => restoreHistory(true)} canUndo={!!trackHistory?.past.length} canRedo={!!trackHistory?.future.length} />
      </div>
    </div>
    {dragging && <div className="drop-overlay"><div><FolderPlus size={54} /><h2>Give your music a new home.</h2><p>Drop audio files or folders. We’ll find the music inside.</p></div></div>}
    {playlistDialog && <PlaylistDialog key={playlistDialog.playlist?.id ?? 'new'} playlist={playlistDialog.playlist} tracks={sortedTracks} initialTrack={playlistDialog.initialTrack} onClose={() => setPlaylistDialog(null)} onSaved={playlistSaved} onError={message => notify(message, true)} />}
    {dialog === 'link-import' && <LinkImport job={onlineJob} connectionError={onlineConnectionError} onStart={startOnlineImport} onCancel={cancelOnlineImport} onClose={() => setDialog(null)} onOpenTrack={track => { setView('library'); setQuery(''); switchTrack(track.id); }} onOpenPlaylist={playlist => void openImportedPlaylist(playlist)} />}
    {detailsTrack && <TrackDetails key={detailsTrack.id} track={detailsTrack} onClose={() => setDetailsTrack(null)} onSaved={updated => setTracks(previous => previous.map(track => track.id === updated.id ? updated : track))} onError={message => notify(message, true)} />}
    {removePlaylist && <Modal title="Remove this playlist?" description={`“${removePlaylist.name}” will be removed. Your music and saved versions stay in the library.`} onClose={() => setRemovePlaylist(null)} busy={busy}><div className="modal-actions"><button className="button ghost" disabled={busy} onClick={() => setRemovePlaylist(null)}>Keep playlist</button><button className="button danger" disabled={busy} onClick={() => void deletePlaylist()}><Trash size={17} />Remove playlist</button></div></Modal>}
    {dialog === 'add-playlist' && <Modal title="Add to playlist" description={selected?.title} busy={busy} onClose={() => setDialog(null)}><div className="add-playlist-list">{playlists.map(playlist => <button className="playlist-pick" key={playlist.id} disabled={busy || playlist.trackIds.includes(selectedId!)} onClick={() => void addToPlaylist(playlist)}><List size={19} /><span><strong>{playlist.name}</strong><small>{playlist.trackIds.includes(selectedId!) ? 'Already added' : `${playlist.trackIds.length} tracks`}</small></span><Plus size={17} /></button>)}</div><button className="button secondary full-width" onClick={() => { setDialog(null); setPlaylistDialog({ playlist: null, initialTrack: selectedId ?? undefined }); }} disabled={busy}><Plus size={17} />Create a playlist</button></Modal>}
    {dialog === 'backup' && !backupFile && <Modal title="Keep your workspace" description="Save your playlists, track details, favorites, and named mixes." onClose={() => setDialog(null)}><div className="backup-note"><FolderSimple size={28} /><p>Audio files and cover images stay separate. On another device, import the same audio files before restoring this backup.</p></div><a className="button primary full-width" href="/api/backup" download><DownloadSimple size={17} />Download workspace backup</a><button className="button secondary full-width restore-trigger" onClick={() => backupInput.current?.click()}>Restore a workspace</button></Modal>}
    {backupFile && <Modal title="Restore this workspace?" description={backupFile.name} busy={busy} onClose={() => setBackupFile(null)}><p className="restore-note">Matching audio files receive the backed-up details and favorites. Saved versions and playlists are added; existing ones are kept. Missing audio files will be reported.</p><div className="modal-actions"><button className="button ghost" onClick={() => setBackupFile(null)} disabled={busy}>Cancel</button><button className="button primary" onClick={() => void restoreBackup()} disabled={busy}>{busy ? <SpinnerGap size={17} className="spin" /> : <Stack size={17} />}Restore workspace</button></div></Modal>}
    <div className="toast-stack" aria-live="polite">{notices.map(notice => <Toast key={notice.id} message={notice.message} error={notice.error} onDismiss={() => setNotices(previous => previous.filter(item => item.id !== notice.id))} />)}</div>
    {dialog === 'save' && <Modal title="Save a new version" description="Keep this sound with your track. You can return to it anytime." onClose={() => setDialog(null)} busy={busy}><form onSubmit={event => void submitVersion(event)}><label className="field-label" htmlFor="version-name">Version name</label><input id="version-name" className="text-input" value={versionName} onChange={event => setVersionName(event.target.value)} maxLength={80} required autoFocus disabled={busy} /><div className="mix-summary"><span>{settings.speed.toFixed(2)}× speed</span><span>{Math.round(settings.reverb * 100)}% reverb</span><span>Custom EQ</span></div><div className="modal-actions"><button type="button" className="button ghost" onClick={() => setDialog(null)} disabled={busy}>Cancel</button><button className="button primary" disabled={busy || !versionName.trim()}>{busy ? <SpinnerGap className="spin" size={17} /> : <Stack size={17} />}Save version</button></div></form></Modal>}
    {dialog === 'export' && <Modal title="Take your sound with you" description={`Export “${selected?.title}” with your current mix.`} onClose={() => setDialog(null)} busy={busy}><form onSubmit={event => void submitExport(event)}><div className="export-format"><span className="export-format-icon"><MusicNotes size={27} /></span><div><strong>WAV audio</strong><span>Uncompressed stereo · 44.1 kHz</span></div><span className="small-tag">Lossless</span></div><div className="export-selection"><span>Range: {formatTime(resolveEdit(edit, player.duration).start)} – {formatTime(resolveEdit(edit, player.duration).end)}</span><span>{edit.fadeIn || edit.fadeOut ? 'Fades included' : 'Full mix processing'}</span></div><label className="field-label">Bit depth</label><div className="bit-depth-options">{([16, 24] as const).map(depth => <button type="button" className={bitDepth === depth ? 'active' : ''} onClick={() => setBitDepth(depth)} aria-pressed={bitDepth === depth} disabled={busy} key={depth}><strong>{depth}-bit</strong><span>{depth === 16 ? 'Everyday listening' : 'More room for your mix'}</span></button>)}</div><label className="checkbox-label"><input type="checkbox" checked={includeTail} onChange={event => setIncludeTail(event.target.checked)} disabled={busy} /><span><strong>Keep the reverb tail</strong><span>Let the last note fade naturally.</span></span></label><label className="checkbox-label"><input type="checkbox" checked={normalize} onChange={event => setNormalize(event.target.checked)} disabled={busy} /><span><strong>Normalize output</strong><span>Adjust the final peak level to −1 dB.</span></span></label><div className="export-estimate"><span>{formatTime(exportDuration)} duration</span><span>About {formatSize(exportSize)}</span></div>{busy && <p className="export-progress" role="status"><SpinnerGap size={18} className="spin" />{exportPhase}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={() => setDialog(null)} disabled={busy}>Cancel</button><button className="button primary" disabled={busy || !ready}>{busy ? <SpinnerGap size={17} className="spin" /> : <DownloadSimple size={17} />}{busy ? 'Exporting…' : 'Export WAV'}</button></div></form></Modal>}
    {(removeTrack || removeVersion) && <Modal title={removeTrack ? 'Remove this track?' : 'Remove this version?'} description={removeTrack ? `“${removeTrack.title}” and its saved versions will be removed from MusicSuite. Your original file stays on your device.` : `“${removeVersion?.name}” will be deleted. Your track stays in the library.`} onClose={() => { setRemoveTrack(null); setRemoveVersion(null); }} busy={busy}><div className="modal-actions"><button className="button ghost" onClick={() => { setRemoveTrack(null); setRemoveVersion(null); }} disabled={busy}>Keep it</button><button className="button danger" onClick={() => void confirmRemove()} disabled={busy}><Trash size={17} />{removeTrack ? 'Remove track' : 'Remove version'}</button></div></Modal>}
    {dialog === 'help' && <Modal title="A few useful shortcuts" description="Keep your hands on the music." onClose={() => setDialog(null)}><div className="shortcuts">{[['Play or pause', 'Space'], ['Seek 5 seconds', '← / →'], ['Search your library', '/'], ['Mute or unmute', 'M'], ['Undo mix change', 'Ctrl + Z'], ['Redo mix change', 'Ctrl + Shift + Z'], ['Close a dialog', 'Esc']].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div><p className="help-note">Import files or a folder, or drop audio anywhere in the workspace. Imported files and saved versions live in MusicSuite’s data folder. Temporary mixes and listening volume are remembered in this browser. Media keys and headset controls work in supported browsers.</p></Modal>}
  </div>;
}
