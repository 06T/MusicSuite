export type LibraryView = 'library' | 'favorites' | 'versions' | 'playlist';
export type QueuePreferences = { view: LibraryView; playlistId: string | null; shuffle: boolean; repeat: boolean; order: string[]; excluded: string[]; custom: boolean };

export function validateQueuePreferences(value: unknown): QueuePreferences {
  const stored = value && typeof value === 'object' ? value as Partial<QueuePreferences> : {};
  const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string').slice(0, 10000))] : [];
  return {
    view: ['library', 'favorites', 'versions', 'playlist'].includes(stored.view ?? '') ? stored.view! : 'library',
    playlistId: typeof stored.playlistId === 'string' ? stored.playlistId : null,
    shuffle: stored.shuffle === true, repeat: stored.repeat === true,
    order: ids(stored.order), excluded: ids(stored.excluded), custom: stored.custom === true,
  };
}

export function upcomingQueue(order: string[], selectedId: string | null, repeat: boolean): string[] {
  const index = order.indexOf(selectedId ?? '');
  if (index < 0) return order;
  return repeat ? [...order.slice(index + 1), ...order.slice(0, index)] : order.slice(index + 1);
}

export function reconcileOrder(previous: string[], ids: string[]): string[] {
  const available = new Set(ids);
  const retained = previous.filter(id => available.has(id));
  const existing = new Set(retained);
  return [...retained, ...ids.filter(id => !existing.has(id))];
}

/** Only the upcoming portion changes. Current audio and playback history stay intact. */
export function reorderUpcoming(order: string[], selectedId: string | null, repeat: boolean, id: string, targetId: string, after = false): string[] {
  const upcoming = upcomingQueue(order, selectedId, repeat);
  if (id === targetId || !upcoming.includes(id) || !upcoming.includes(targetId)) return order;
  const moved = upcoming.filter(item => item !== id);
  moved.splice(moved.indexOf(targetId) + (after ? 1 : 0), 0, id);
  if (moved.every((item, i) => item === upcoming[i])) return order;
  const index = order.indexOf(selectedId ?? '');
  return index < 0 ? moved : repeat ? [selectedId!, ...moved] : [...order.slice(0, index + 1), ...moved];
}

/** Keep an established shuffle stable when metadata or collection membership changes. */
export function reconcileShuffle(previous: string[], ids: string[], selectedId: string | null, random = Math.random): string[] {
  const available = new Set(ids);
  const retained = previous.filter(id => available.has(id));
  const existing = new Set(retained);
  const added = ids.filter(id => !existing.has(id));
  for (let i = added.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [added[i], added[j]] = [added[j], added[i]];
  }
  if (!previous.length && selectedId && available.has(selectedId)) {
    return [selectedId, ...added.filter(id => id !== selectedId)];
  }
  return [...retained, ...added];
}
