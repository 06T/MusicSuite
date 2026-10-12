import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, ListPlus, SpinnerGap, X } from '@phosphor-icons/react';
import type { Playlist, Track } from '../../shared/types.ts';
import { Modal } from './Modal.tsx';
import { Artwork } from './Artwork.tsx';
import { api } from '../api.ts';

export function PlaylistDialog({ playlist, tracks, initialTrack, onClose, onSaved, onError }: {
  playlist: Playlist | null; tracks: Track[]; initialTrack?: string; onClose: () => void;
  onSaved: (playlist: Playlist) => void; onError: (message: string) => void;
}) {
  const [name, setName] = useState(playlist?.name ?? '');
  const [ids, setIds] = useState(playlist?.trackIds ?? (initialTrack ? [initialTrack] : []));
  const [query, setQuery] = useState(''); const [busy, setBusy] = useState(false);
  const move = (index: number, direction: number) => setIds(previous => { const next = [...previous]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try { onSaved(await api<Playlist>(playlist ? `/api/playlists/${playlist.id}` : '/api/playlists', { method: playlist ? 'PUT' : 'POST', body: JSON.stringify({ name, trackIds: ids }) })); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not save your playlist.'); }
    finally { setBusy(false); }
  }
  return <Modal title={playlist ? 'Edit playlist' : 'Create a playlist'} description="Put your tracks in the order you want to hear them." busy={busy} onClose={onClose}>
    <form onSubmit={event => void submit(event)}><label className="field-label" htmlFor="playlist-name">Playlist name</label><input className="text-input" id="playlist-name" required maxLength={80} value={name} onChange={event => setName(event.target.value)} disabled={busy} autoFocus />
      <div className="playlist-ordered" aria-label="Playlist order">{ids.map((id, index) => {
        const track = tracks.find(t => t.id === id); if (!track) return null;
        return <div className="playlist-edit-row" key={id}><span className="track-number">{index + 1}</span><Artwork track={track} /><span className="playlist-track-name">{track.title}</span><button type="button" className="icon-button small" aria-label={`Move ${track.title} up`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></button><button type="button" className="icon-button small" aria-label={`Move ${track.title} down`} disabled={busy || index === ids.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button><button type="button" className="icon-button small" aria-label={`Remove ${track.title} from playlist`} disabled={busy} onClick={() => setIds(previous => previous.filter(item => item !== id))}><X size={14} /></button></div>;
      })}</div>
      <label className="field-label" htmlFor="playlist-search">Add tracks</label><input id="playlist-search" className="text-input" placeholder="Find a track…" value={query} onChange={event => setQuery(event.target.value)} disabled={busy} />
      <div className="playlist-picker">{tracks.filter(track => !ids.includes(track.id) && `${track.title} ${track.artist}`.toLowerCase().includes(query.toLowerCase())).map(track => <button type="button" className="playlist-pick" key={track.id} disabled={busy} onClick={() => setIds(previous => [...previous, track.id])}><Artwork track={track} /><span><strong>{track.title}</strong><small>{track.artist}</small></span><ListPlus size={18} /></button>)}{!tracks.length && <p className="effect-note">Import tracks to fill your playlist.</p>}</div>
      <div className="modal-actions"><span className="dialog-count">{ids.length} tracks</span><button type="button" className="button ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? <SpinnerGap size={17} className="spin" /> : <ListPlus size={17} />}Save playlist</button></div>
    </form>
  </Modal>;
}
