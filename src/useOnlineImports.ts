import { useEffect, useEffectEvent } from 'react';
import { isImportFinished, type OnlineJob } from '../shared/online.ts';
import { api, getLibrary, writeLocal } from './api.ts';
import { providerName } from './onlineLabels.ts';
import type { Draft, WorkspaceState } from './useWorkspaceState.ts';

type Notify = (message: string, error?: boolean) => void;

export function useOnlineImports(state: WorkspaceState, notify: Notify, switchTrack: (id: string, draft?: Draft, autoplay?: boolean) => void) {
  const { setTracks, setVersions, setPlaylists, onlineId, setOnlineId, onlineJob, setOnlineJob, setOnlineConnectionError, current } = state;
  const selectImportedTrack = useEffectEvent((id: string) => switchTrack(id, undefined, false));
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
            if (!current.current.selectedId) { const first = job.track?.id ?? job.playlist?.trackIds[0]; if (first) selectImportedTrack(first); }
          } catch { if (controller.signal.aborted) return; if (isImportFinished(job)) notify('Your audio was imported. Reload MusicSuite to refresh the library.', true); }
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
          if (controller.signal.aborted) return;
          setOnlineJob(null); setOnlineId(null); writeLocal('musicsuite.onlineJob', null); setOnlineConnectionError(message); notify(message, true); return;
        }
        setOnlineConnectionError('Connection interrupted. Reconnecting to your import…');
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1000);
    }
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [onlineId, notify, setOnlineJob, setOnlineConnectionError, setTracks, setVersions, setPlaylists, current, setOnlineId]);
  async function startOnlineImport(url: string, playlist = false) {
    const job = await api<OnlineJob>('/api/link-imports', { method: 'POST', body: JSON.stringify({ url, playlist }) });
    setOnlineJob(job); setOnlineConnectionError(''); setOnlineId(job.id); writeLocal('musicsuite.onlineJob', job.id);
  }
  async function cancelOnlineImport() {
    if (!onlineJob) return;
    const job = await api<OnlineJob>(`/api/link-imports/${onlineJob.id}`, { method: 'DELETE' });
    setOnlineJob(job);

  }


  return { startOnlineImport, cancelOnlineImport };
}
