import { useCallback } from 'react';
import { type AudioEdit, type MixSettings } from '../shared/types.ts';
import type { Draft, WorkspaceState } from './useWorkspaceState.ts';


export function useMixHistory(state: WorkspaceState) {
  const { setSettings, setMixName, setEdit, setHistoryTick, history, current } = state;
  const applyDraft = useCallback((draft: Draft) => {
    current.current = { ...current.current, settings: draft.settings, edit: draft.edit, mixName: draft.name };
    setSettings({ ...draft.settings }); setEdit({ ...draft.edit }); setMixName(draft.name);
  }, [current, setSettings, setEdit, setMixName]);

  const changeDraft = useCallback((next: Draft, group = '') => {
    const value = current.current; if (!value.selectedId) return;
    const previous = { settings: { ...value.settings }, edit: { ...value.edit }, name: value.mixName };
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    const stack = history.current[value.selectedId] ?? { past: [], future: [], group: '', at: 0 };
    if (!group || group !== stack.group || Date.now() - stack.at > 600 || stack.future.length) stack.past.push(previous);
    stack.past = stack.past.slice(-60); stack.future = []; stack.group = group; stack.at = Date.now();
    history.current[value.selectedId] = stack; applyDraft(next); setHistoryTick(tick => tick + 1);
  }, [applyDraft, current, history, setHistoryTick]);

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
  }, [applyDraft, current, history, setHistoryTick]);


  return { applyDraft, changeDraft, changeMix, changeEdit, restoreHistory };
}
