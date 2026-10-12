import { useCallback } from 'react';
import { DEFAULT_EDIT, DEFAULT_MIX, type Playlist, type Track } from '../shared/types.ts';
import { api, favoriteTrack, getLibrary } from './api.ts';
import type { WorkspaceState } from './useWorkspaceState.ts';

type Notify = (message: string, error?: boolean) => void;

export function useLibraryActions(state: WorkspaceState, notify: Notify, selected: Track | null, reloadLibrary: () => Promise<void>) {
  const { engine, tracks, setTracks, setVersions, setPlaylists, selectedId, setSelectedId, setSettings, mixName, setMixName, setEdit, playlistId, setPlaylistId, setPlaylistDialog, removePlaylist, setRemovePlaylist, backupFile, setBackupFile, setView, setQuery, setDialog, removeTrack, setRemoveTrack, removeVersion, setRemoveVersion, setBusy, backupInput, drafts, history } = state;
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
  }, [notify, setTracks]);

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


  return { openImportedPlaylist, favorite, confirmRemove, playlistSaved, addToPlaylist, deletePlaylist, chooseBackup, restoreBackup };
}
