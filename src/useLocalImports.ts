import { mapConcurrent } from '../shared/async.ts';
import { type Track } from '../shared/types.ts';
import { api, getLibrary, uploadFiles } from './api.ts';
import type { ImportReport } from './components/ImportFeedback.tsx';
import { IMPORT_BATCH_SIZE, MAX_AUDIO_BYTES, isAudioFile, type DroppedAudio } from './importAudio.ts';
import type { Draft, WorkspaceState } from './useWorkspaceState.ts';

type Notify = (message: string, error?: boolean) => void;

export function useLocalImports(state: WorkspaceState, notify: Notify, switchTrack: (id: string, draft?: Draft, autoplay?: boolean) => void) {
  const { setTracks, setVersions, setPlaylists, setView, importing, setImporting, setImportProgress, setImportReport, fileInput, folderInput, importLock, current } = state;
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
      const offsets = Array.from({ length: Math.ceil(files.length / IMPORT_BATCH_SIZE) }, (_, index) => index * IMPORT_BATCH_SIZE);
      let transportFailed = false;

      await mapConcurrent(offsets, 1, async offset => {
        if (transportFailed) return;
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
          transportFailed = true;
        }
      });
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


  return { importAudio, tryDemo };
}
