import { useCallback, useEffect } from 'react';
import { DEFAULT_EDIT, DEFAULT_MIX } from '../shared/types.ts';
import { getLibrary } from './api.ts';
import type { WorkspaceState } from './useWorkspaceState.ts';


export function useLibraryLoading(state: WorkspaceState) {
  const { setTracks, setVersions, setPlaylists, setSelectedId, setSettings, setMixName, setEdit, setLibraryLoading, setLibraryError, drafts, current } = state;
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
  }, [setLibraryLoading, setLibraryError, setTracks, setVersions, setPlaylists, current, setSelectedId, drafts, setSettings, setEdit, setMixName]);

  useEffect(() => { void reloadLibrary(); }, [reloadLibrary]);

  return { reloadLibrary };
}
