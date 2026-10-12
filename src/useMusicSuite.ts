import { useCallback, useEffect, useMemo } from 'react';
import { DEFAULT_EDIT, resolveEdit, type Track } from '../shared/types.ts';
import { writeLocal } from './api.ts';
import { useLibraryActions } from './useLibraryActions.ts';
import { useLibraryLoading } from './useLibraryLoading.ts';
import { useListeningQueue } from './useListeningQueue.ts';
import { useLocalImports } from './useLocalImports.ts';
import { useMediaSession } from './useMediaSession.ts';
import { useMixHistory } from './useMixHistory.ts';
import { useOnlineImports } from './useOnlineImports.ts';
import { useStudioActions } from './useStudioActions.ts';
import { useTrackSelection } from './useTrackSelection.ts';
import { useWorkspaceState, type WorkspaceState } from './useWorkspaceState.ts';

export function useMusicSuite() {
  const state = useWorkspaceState();
  const { session, queuePreferences, engine, player, selectedId, setSelectedId, settings, mixName, edit, setEdit, loop, shuffle, repeat, crossfade, sort, playlistId, historyTick, volume, setVolume, grid, queueOpen, libraryLoading, libraryError, setInputMode, dialog, bitDepth, includeTail, setNotices, searchInput, shouldPlay, restored, drafts, history, ended, unmutedVolume, current } = state;
  const { tracksById, selected, trackVersions, ready, activePlaylist, view, sortedTracks, viewTracks, viewTitle, count, totalSize, viewDuration } = useLibraryView(state);
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
  }, [setNotices]);

  const { changeDraft, changeMix, changeEdit, restoreHistory } = useMixHistory(state);
  const { switchTrack, selectTrack, selectVersion } = useTrackSelection(state, notify, changeDraft);
  const { reloadLibrary } = useLibraryLoading(state);
  const { importAudio, tryDemo } = useLocalImports(state, notify, switchTrack);
  const { startOnlineImport, cancelOnlineImport } = useOnlineImports(state, notify, switchTrack);
  const { openImportedPlaylist, favorite, confirmRemove, playlistSaved, addToPlaylist, deletePlaylist, chooseBackup, restoreBackup } = useLibraryActions(state, notify, selected, reloadLibrary);
  const { submitVersion, submitExport } = useStudioActions(state, notify, selected);


  useEffect(() => {
    const keyboard = () => setInputMode('keyboard');
    const pointer = () => setInputMode('pointer');
    window.addEventListener('keydown', keyboard, true); window.addEventListener('pointerdown', pointer, true);
    return () => { window.removeEventListener('keydown', keyboard, true); window.removeEventListener('pointerdown', pointer, true); };
  }, [setInputMode]);
  const selectedExists = tracksById.has(selectedId ?? "");
  useEffect(() => {
    if (!selectedId || !selectedExists) return;
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

  }, [selectedId, selectedExists, engine, notify, libraryLoading, session.position, session.positionTrack, shouldPlay, restored]);

  useEffect(() => { engine.setMix(settings); }, [engine, settings]);
  useEffect(() => { void engine.setEdit(edit, loop).catch(error => notify(error.message, true)); }, [engine, edit, loop, notify]);
  useEffect(() => { engine.setVolume(volume); }, [engine, volume]);
  useEffect(() => { if (volume > 0) unmutedVolume.current = volume; }, [volume, unmutedVolume]);
  useEffect(() => {
    if (selectedId) drafts.current[selectedId] = { settings, edit, name: mixName };
    writeLocal('musicsuite.session', { selectedId, drafts: drafts.current, volume, position: engine.position(), positionTrack: selectedId });
  }, [selectedId, settings, edit, mixName, volume, engine, drafts]);
  useEffect(() => { writeLocal('musicsuite.grid', grid); }, [grid]);
  useEffect(() => { writeLocal('musicsuite.sort', sort); }, [sort]);
  useEffect(() => { writeLocal('musicsuite.crossfade', crossfade); }, [crossfade]);
  useEffect(() => { writeLocal('musicsuite.upNext', queueOpen); }, [queueOpen]);
  useEffect(() => {
    if (!libraryLoading && !libraryError) writeLocal('musicsuite.queue', { view, playlistId, shuffle, repeat, order: queue, excluded: queueControl.excluded, custom: queueControl.custom });
  }, [view, playlistId, shuffle, repeat, queue, queueControl.excluded, queueControl.custom, libraryLoading, libraryError]);
  useEffect(() => {
    const persist = () => {
      const value = current.current;
      writeLocal('musicsuite.session', { ...value, drafts: drafts.current, position: engine.position(), positionTrack: value.selectedId });
    };
    const interval = setInterval(persist, 3000); window.addEventListener('beforeunload', persist);
    return () => { persist(); clearInterval(interval); window.removeEventListener('beforeunload', persist); engine.dispose(); };
  }, [engine, current, drafts]);

  const togglePlay = useCallback(async () => {
    try { if (engine.isPlaying()) engine.pause(); else await engine.play(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not start playback.', true); }
  }, [engine, notify]);
  const toggleMute = useCallback(() => setVolume(value => value > 0 ? 0 : unmutedVolume.current), [setVolume, unmutedVolume]);

  const nextTrack = useCallback((direction: number, automatic = false) => {
    if (!queue.length) return;
    const index = queue.indexOf(current.current.selectedId ?? '');
    if (direction > 0 && index === queue.length - 1 && !repeat) return;
    const id = queue[index < 0 ? direction > 0 ? 0 : queue.length - 1 : (index + direction + queue.length) % queue.length];
    const value = current.current;

    const edit = id === value.selectedId ? value.edit : drafts.current[id]?.edit ?? DEFAULT_EDIT;
    switchTrack(id, { settings: { ...value.settings }, edit: { ...edit }, name: value.mixName }, automatic || engine.isPlaying());
  }, [queue, repeat, switchTrack, engine, current, drafts]);

  useMediaSession(engine, selected, settings.speed, edit, ready, canNext, canPrevious, nextTrack, notify);

  useEffect(() => { if (player.ended === ended.current) return; ended.current = player.ended; nextTrack(1, true); }, [player.ended, nextTrack, ended]);

  useEffect(() => {
    if (!player.trackId || !player.playing || player.trackId === current.current.selectedId) return;
    const previous = current.current;
    if (previous.selectedId) drafts.current[previous.selectedId] = { settings: previous.settings, edit: previous.edit, name: previous.mixName };
    const nextEdit = engine.getEdit();
    current.current = { ...previous, selectedId: player.trackId, edit: nextEdit };
    shouldPlay.current = false; setEdit(nextEdit); setSelectedId(player.trackId);
  }, [player.trackId, player.playing, engine, current, drafts, shouldPlay, setEdit, setSelectedId]);

  useEffect(() => {
    if (player.crossfading || player.trackId !== selectedId || !ready) return;
    const index = queue.indexOf(selectedId ?? '');
    const nextId = !loop && queue.length && (index < queue.length - 1 || repeat) ? queue[(index + 1) % queue.length] : null;
    const nextEdit = nextId === selectedId ? edit : nextId ? drafts.current[nextId]?.edit ?? DEFAULT_EDIT : DEFAULT_EDIT;
    void engine.prepareNext(nextId, nextEdit, crossfade, tracksById.get(nextId ?? '')?.duration);
  }, [engine, selectedId, player.trackId, player.crossfading, ready, queue, repeat, loop, crossfade, edit, tracksById, drafts]);

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
  }, [engine, ready, dialog, settings.speed, togglePlay, toggleMute, restoreHistory, searchInput]);

  const exportDuration = resolveEdit(edit, player.duration, settings.speed).length + (includeTail && settings.reverb > 0 ? settings.decay + 0.15 : 0);
  const exportSize = Math.ceil(exportDuration * 44100) * 2 * bitDepth / 8 + 44;
  const formatAccept = '.mp3,.wav,.flac,.m4a,.ogg,.aac,.opus,.aif,.aiff,audio/*';

  return { ...state, view, tracksById, selected, trackVersions, ready, activePlaylist, sortedTracks, viewTracks, queueControl, queue, upcomingTracks, canPrevious, canNext, trackHistory, notify, changeDraft, changeMix, changeEdit, restoreHistory, switchTrack, selectTrack, selectVersion, reloadLibrary, importAudio, tryDemo, startOnlineImport, cancelOnlineImport, openImportedPlaylist, favorite, confirmRemove, playlistSaved, addToPlaylist, deletePlaylist, chooseBackup, restoreBackup, submitVersion, submitExport, selectedExists, togglePlay, toggleMute, nextTrack, viewTitle, count, totalSize, viewDuration, exportDuration, exportSize, formatAccept };
}

export type Workspace = ReturnType<typeof useMusicSuite>;

function sortLibrary(tracks: Track[], sort: string) {
  const comparators: Record<string, (a: Track, b: Track) => number> = {
    title: (a, b) => a.title.localeCompare(b.title),
    artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
    duration: (a, b) => a.duration - b.duration,
    recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
  };
  return [...tracks].sort(comparators[sort] ?? comparators.recent);
}

function useLibraryView(state: WorkspaceState) {
  const { tracks, versions, selectedId, player, playlists, playlistId, view: requestedView, libraryLoading, libraryError, sort } = state;
  const tracksById = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);
  const selected = tracksById.get(selectedId ?? '') ?? null;
  const trackVersions = useMemo(() => versions.filter(version => version.trackId === selectedId), [versions, selectedId]);
  const ready = !!selected && !!player.duration && !player.loading;
  const activePlaylist = playlists.find(p => p.id === playlistId) ?? null;
  const view = !libraryLoading && !libraryError && requestedView === 'playlist' && !activePlaylist ? 'library' : requestedView;
  const sortedTracks = useMemo(() => sortLibrary(tracks, sort), [tracks, sort]);
  const viewTracks = useMemo(() => view === 'playlist' ? (activePlaylist?.trackIds.flatMap(id => tracksById.get(id) ?? []) ?? []) : sortedTracks.filter(track => view !== 'favorites' || track.favorite), [view, activePlaylist, tracksById, sortedTracks]);
  const viewTitle = view === 'playlist' ? activePlaylist?.name ?? 'Playlist' : view === 'library' ? 'Your library' : view === 'favorites' ? 'Favorites' : 'Saved versions';
  const count = view === 'versions' ? versions.length : viewTracks.length;
  const totalSize = useMemo(() => tracks.reduce((sum, track) => sum + track.size, 0), [tracks]);
  const viewDuration = useMemo(() => viewTracks.reduce((sum, track) => sum + track.duration, 0), [viewTracks]);
  return { tracksById, selected, trackVersions, ready, activePlaylist, view, sortedTracks, viewTracks, viewTitle, count, totalSize, viewDuration };
}
