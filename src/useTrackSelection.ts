import { useCallback } from 'react';
import { DEFAULT_EDIT, DEFAULT_MIX, type SavedVersion, type Track } from '../shared/types.ts';
import type { Draft, WorkspaceState } from './useWorkspaceState.ts';

type Notify = (message: string, error?: boolean) => void;

export function useTrackSelection(state: WorkspaceState, notify: Notify, changeDraft: (draft: Draft, group?: string) => void) {
  const { engine, setSelectedId, setSettings, setMixName, setEdit, shouldPlay, drafts, current } = state;
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
  }, [changeDraft, engine, notify, current, drafts, setSettings, setEdit, setMixName, shouldPlay, setSelectedId]);
  const selectTrack = useCallback((track: Track) => switchTrack(track.id), [switchTrack]);
  const selectVersion = useCallback((version: SavedVersion) => switchTrack(version.trackId, { settings: version.settings, edit: version.edit, name: version.name }), [switchTrack]);


  return { switchTrack, selectTrack, selectVersion };
}
