import { useCallback, useMemo, useState } from 'react';
import { reconcileOrder, reconcileShuffle, reorderUpcoming, upcomingQueue, type QueuePreferences } from '../shared/queue.ts';
import type { Track } from '../shared/types.ts';

export function useListeningQueue(tracks: Track[], context: string, shuffle: boolean, repeat: boolean, selectedId: string | null, loading: boolean, initial: QueuePreferences) {
  const ids = useMemo(() => tracks.map(track => track.id), [tracks]);
  const key = useMemo(() => JSON.stringify([context, shuffle, ids]), [context, shuffle, ids]);
  const [state, setState] = useState({ key: '', context, shuffle: initial.shuffle, ids: initial.order, excluded: initial.excluded, custom: initial.custom });

  if (!loading && state.key !== key) {
    const sameContext = state.context === context;
    const excluded = sameContext ? state.excluded : [];
    const removed = new Set(excluded);
    const available = ids.filter(id => !removed.has(id));
    const sameMode = sameContext && state.shuffle === shuffle;
    const custom = sameMode && state.custom;
    const previous = sameMode ? state.ids : [];
    const order = shuffle ? reconcileShuffle(previous, available, selectedId) : custom ? reconcileOrder(previous, available) : available;
    setState({ key, context, shuffle, ids: order, excluded, custom });
  }
  const upcoming = useMemo(() => upcomingQueue(state.ids, selectedId, repeat), [state.ids, selectedId, repeat]);
  const place = useCallback((id: string, targetId: string, after = false) => setState(previous => {
    const ids = reorderUpcoming(previous.ids, selectedId, repeat, id, targetId, after);
    return ids === previous.ids ? previous : { ...previous, ids, custom: true };
  }), [selectedId, repeat]);
  const move = useCallback((id: string, direction: -1 | 1) => setState(previous => {
    const upcoming = upcomingQueue(previous.ids, selectedId, repeat);
    const index = upcoming.indexOf(id); const target = index + direction;
    if (index < 0 || target < 0 || target >= upcoming.length) return previous;
    return { ...previous, ids: reorderUpcoming(previous.ids, selectedId, repeat, id, upcoming[target], direction > 0), custom: true };
  }), [selectedId, repeat]);
  const remove = useCallback((id: string) => setState(previous => {
    if (id === selectedId || !upcomingQueue(previous.ids, selectedId, repeat).includes(id)) return previous;
    return { ...previous, ids: previous.ids.filter(item => item !== id), excluded: [...previous.excluded, id] };
  }), [selectedId, repeat]);
  const reset = useCallback(() => setState(previous => ({ ...previous, key: '', ids: [], excluded: [], custom: false })), []);
  return { ...state, upcoming, place, move, remove, reset };
}
