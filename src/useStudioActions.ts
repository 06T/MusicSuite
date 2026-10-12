import type { FormEvent } from 'react';
import { type Track } from '../shared/types.ts';
import { saveVersion } from './api.ts';
import { exportAudio } from './audio/export.ts';
import type { WorkspaceState } from './useWorkspaceState.ts';

type Notify = (message: string, error?: boolean) => void;

export function useStudioActions(state: WorkspaceState, notify: Notify, selected: Track | null) {
  const { engine, setTracks, setVersions, settings, mixName, setMixName, edit, setDialog, setBusy, versionName, bitDepth, includeTail, normalize, setExportPhase } = state;
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


  return { submitVersion, submitExport };
}
