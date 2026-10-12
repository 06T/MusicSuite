import { memo, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { ArrowCounterClockwise, ArrowDown, ArrowUp, CaretDown, DotsSixVertical, List, Repeat, X } from '@phosphor-icons/react';
import type { Track } from '../../shared/types.ts';
import { formatTime } from '../api.ts';
import { Artwork } from './Artwork.tsx';

const DRAG_TYPE = 'application/x-musicsuite-queue';

export const UpNext = memo(function UpNext({ tracks, current, playing, collection, expanded, modified, repeat, loop, onExpandedChange, onMove, onPlace, onRemove, onReset }: {
  tracks: Track[]; current: Track; playing: boolean; collection: string; expanded: boolean; modified: boolean; repeat: boolean; loop: boolean;
  onExpandedChange: (open: boolean) => void; onMove: (id: string, direction: -1 | 1) => void;
  onPlace: (id: string, target: string, after: boolean) => void; onRemove: (id: string) => void; onReset: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const nextFocus = useRef<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  useLayoutEffect(() => {
    if (nextFocus.current === null) return;
    const id = nextFocus.current; nextFocus.current = null;
    const row = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-queue-track]') ?? []).find(row => row.dataset.queueTrack === id);
    (row?.querySelector<HTMLButtonElement>('[data-queue-remove]') ?? root.current?.querySelector<HTMLButtonElement>('.up-next-toggle'))?.focus({ preventScroll: true });
  }, [tracks]);
  const finishDrag = () => { setDragged(null); setTarget(null); };
  const dropPosition = (event: DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(); return event.clientY > rect.top + rect.height / 2;
  };
  return <section className={`up-next ${expanded ? 'is-open' : ''}`} aria-label="Up Next" ref={root}>
    <div className="up-next-header">
      <button className="up-next-toggle" aria-label="Up Next" aria-description={`${tracks.length} upcoming ${tracks.length === 1 ? 'song' : 'songs'}`} aria-expanded={expanded} aria-controls="up-next-content" onClick={() => onExpandedChange(!expanded)}>
        <List size={18} /><strong>Up Next</strong><span className="count-badge">{tracks.length}</span><CaretDown className="up-next-chevron" size={14} />
      </button>
      {expanded && modified && <button className="queue-reset" onClick={() => { onReset(); setAnnouncement('Queue restored from your collection.'); }} aria-label="Reset queue" title="Restore songs and order from this collection"><ArrowCounterClockwise size={14} /><span>Reset queue</span></button>}
    </div>
    {expanded && <div id="up-next-content">
      <div className="queue-current"><Artwork track={current} /><div><span>{playing ? 'Playing now' : 'Current track'}</span><strong title={current.title}>{current.title}</strong></div><span className="queue-current-tag">{playing ? 'Playing' : 'Paused'}</span></div>
      <div className="queue-context"><span title={collection}>From {collection}</span>{repeat && <span><Repeat size={12} />Queue repeats</span>}</div>
      {loop && <p className="queue-loop-note">Selection loop is on. Upcoming songs wait until you turn it off.</p>}
      {tracks.length ? <ol className="queue-list" aria-label="Upcoming songs">{tracks.map((track, index) => <li key={track.id} data-queue-track={track.id} className={`queue-row ${dragged === track.id ? 'is-dragging' : ''} ${target?.id === track.id ? target.after ? 'drop-after' : 'drop-before' : ''}`}
        onDragOver={event => {
          if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
          event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
          const after = dropPosition(event);
          setTarget(previous => previous?.id === track.id && previous.after === after ? previous : { id: track.id, after });
        }}
        onDrop={event => {
          if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
          event.preventDefault(); event.stopPropagation();
          const id = event.dataTransfer.getData(DRAG_TYPE);
          onPlace(id, track.id, dropPosition(event)); finishDrag(); setAnnouncement('Upcoming songs reordered.');
        }}>
        <button className="queue-grip" draggable aria-label={`Drag ${track.title} to reorder`} title="Drag to reorder, or use the arrow buttons"
          onDragStart={event => { event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(DRAG_TYPE, track.id); setDragged(track.id); }} onDragEnd={finishDrag}><DotsSixVertical size={17} /></button>
        <span className="queue-number" aria-hidden="true">{index + 1}</span><Artwork track={track} />
        <div className="queue-track-copy"><strong title={track.title}>{track.title}</strong><span title={track.artist}>{track.artist}</span></div>
        <span className="queue-time" title="Original track duration">{formatTime(track.duration)}</span>
        <div className="queue-row-actions">
          <button className="icon-button" aria-label={`Move ${track.title} up in queue`} disabled={index === 0} onClick={() => { onMove(track.id, -1); setAnnouncement(`${track.title} moved to position ${index}.`); }}><ArrowUp size={15} /></button>
          <button className="icon-button" aria-label={`Move ${track.title} down in queue`} disabled={index === tracks.length - 1} onClick={() => { onMove(track.id, 1); setAnnouncement(`${track.title} moved to position ${index + 2}.`); }}><ArrowDown size={15} /></button>
          <button className="icon-button queue-remove" data-queue-remove aria-label={`Remove ${track.title} from queue`} title="Remove from queue" onClick={() => { nextFocus.current = tracks[index + 1]?.id ?? tracks[index - 1]?.id ?? ''; onRemove(track.id); setAnnouncement(`${track.title} removed from the queue. Still in your library.`); }}><X size={16} /></button>
        </div>
      </li>)}</ol> : <div className="queue-empty"><List size={23} /><strong>{repeat ? 'This song will repeat.' : 'Nothing else lined up.'}</strong><p>{modified ? 'Reset the queue to bring your songs back.' : 'Choose another collection to keep listening.'}</p></div>}
      {tracks.length > 0 && <p className="queue-footnote"><span className="queue-drag-copy">Drag or use the arrows to reorder.</span><span className="queue-touch-copy">Use the arrows to reorder.</span> Removed songs stay in your library.</p>}
    </div>}
    <span className="sr-only" role="status">{announcement}</span>
  </section>;
});
