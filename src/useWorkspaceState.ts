import { useDeferredValue, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { OnlineJob } from '../shared/online.ts';
import { validateQueuePreferences } from '../shared/queue.ts';
import { DEFAULT_EDIT, DEFAULT_MIX, validateEdit, validateMix, type AudioEdit, type MixSettings, type Playlist, type SavedVersion, type Track } from '../shared/types.ts';
import { readLocal } from './api.ts';
import { AudioEngine } from './audio/engine.ts';
import type { ImportProgress, ImportReport } from './components/ImportFeedback.tsx';

export type View = 'library' | 'favorites' | 'versions' | 'playlist';
export type Draft = { settings: MixSettings; edit: AudioEdit; name: string };
export type History = { past: Draft[]; future: Draft[]; group: string; at: number };
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

export function useWorkspaceState() {
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
  const [sort, setSort] = useState(() => readLocal('musicsuite.sort', 'recent'));
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
  const [grid, setGrid] = useState(() => readLocal('musicsuite.grid', true));
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
  useLayoutEffect(() => { current.current = { selectedId, settings, edit, mixName, volume, loop }; }, [selectedId, settings, edit, mixName, volume, loop]);
  return { deferredQuery, session, queuePreferences, engine, player, tracks, setTracks, versions, setVersions, playlists, setPlaylists, selectedId, setSelectedId, settings, setSettings, mixName, setMixName, edit, setEdit, loop, setLoop, shuffle, setShuffle, repeat, setRepeat, crossfade, setCrossfade, sort, setSort, playlistId, setPlaylistId, playlistDialog, setPlaylistDialog, detailsTrack, setDetailsTrack, removePlaylist, setRemovePlaylist, backupFile, setBackupFile, historyTick, setHistoryTick, volume, setVolume, view, setView, query, setQuery, grid, setGrid, queueOpen, setQueueOpen, libraryLoading, setLibraryLoading, libraryError, setLibraryError, importing, setImporting, importProgress, setImportProgress, importReport, setImportReport, inputMode, setInputMode, dragging, setDragging, dialog, setDialog, onlineId, setOnlineId, onlineJob, setOnlineJob, onlineConnectionError, setOnlineConnectionError, removeTrack, setRemoveTrack, removeVersion, setRemoveVersion, busy, setBusy, versionName, setVersionName, bitDepth, setBitDepth, includeTail, setIncludeTail, normalize, setNormalize, exportPhase, setExportPhase, notices, setNotices, fileInput, folderInput, searchInput, backupInput, shouldPlay, restored, dragDepth, importLock, drafts, history, ended, unmutedVolume, current };
}

export type WorkspaceState = ReturnType<typeof useWorkspaceState>;
