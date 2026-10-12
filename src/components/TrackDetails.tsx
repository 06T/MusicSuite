import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowSquareOut, ImageSquare, SpinnerGap } from '@phosphor-icons/react';
import type { Track } from '../../shared/types.ts';
import { Modal } from './Modal.tsx';
import { Artwork } from './Artwork.tsx';
import { api } from '../api.ts';

export function TrackDetails({ track, onClose, onSaved, onError }: { track: Track; onClose: () => void; onSaved: (track: Track) => void; onError: (message: string) => void }) {
  const [title, setTitle] = useState(track.title); const [artist, setArtist] = useState(track.artist); const [album, setAlbum] = useState(track.album);
  const [cover, setCover] = useState<File | null>(null); const [removeCover, setRemoveCover] = useState(false); const [preview, setPreview] = useState(''); const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!cover) { setPreview(''); return; } const url = URL.createObjectURL(cover); setPreview(url); return () => URL.revokeObjectURL(url); }, [cover]);
  async function chooseCover(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { onError('Choose a PNG, JPEG, or WebP cover under 10 MB.'); return; }
    try { const bitmap = await createImageBitmap(file); bitmap.close(); setCover(file); setRemoveCover(false); }
    catch { onError('This image could not be read. Choose another cover.'); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      let updated = await api<Track>(`/api/tracks/${track.id}`, { method: 'PATCH', body: JSON.stringify({ title, artist, album }) });

      onSaved(updated);
      if (cover) { const form = new FormData(); form.append('artwork', cover); updated = await api<Track>(`/api/tracks/${track.id}/artwork`, { method: 'POST', body: form }); }
      else if (removeCover) updated = await api<Track>(`/api/tracks/${track.id}/artwork`, { method: 'DELETE' });
      onSaved(updated); onClose();
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not save your track details.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Track details" description="Make your library feel like your collection." busy={busy} onClose={onClose}><form onSubmit={event => void submit(event)}>
    <div className="cover-editor"><div className="cover-preview">{preview ? <img src={preview} alt="New cover preview" /> : <Artwork track={removeCover ? { ...track, hasArtwork: false } : track} />}</div><div><button type="button" className="button secondary" disabled={busy} onClick={() => fileInput.current?.click()}><ImageSquare size={17} />Choose cover art</button><p>PNG, JPEG, or WebP · Up to 10 MB</p><button type="button" className="text-button" disabled={busy || (!cover && !track.hasArtwork) || removeCover} onClick={() => { setCover(null); setRemoveCover(true); }}>Use generated artwork</button></div></div>
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Cover art file" className="hidden-input" onChange={event => void chooseCover(event.target.files?.[0])} />
    {track.source && <a className="track-source" href={track.source.url} target="_blank" rel="noreferrer">Imported from {track.source.provider === 'youtube' ? 'YouTube' : 'SoundCloud'}<ArrowSquareOut size={14} /></a>}
    {[['Title', title, setTitle], ['Artist', artist, setArtist], ['Album', album, setAlbum]].map(([label, value, setter]) => <label className="details-field" key={label as string}><span className="field-label">{label as string}</span><input className="text-input" value={value as string} onChange={event => (setter as (value: string) => void)(event.target.value)} maxLength={300} required disabled={busy} /></label>)}
    <p className="effect-note">These details apply inside MusicSuite. Your original audio stays untouched.</p><div className="modal-actions"><button type="button" className="button ghost" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy || !title.trim() || !artist.trim() || !album.trim()}>{busy && <SpinnerGap size={17} className="spin" />}Save details</button></div>
  </form></Modal>;
}
