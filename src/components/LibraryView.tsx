import { memo, useMemo } from 'react';
import { Heart, MusicNotes, Play, Trash } from '@phosphor-icons/react';
import type { SavedVersion, Track } from '../../shared/types.ts';
import { Artwork } from './Artwork.tsx';
import { formatTime } from '../api.ts';

export const LibraryView = memo(function LibraryView({ tracks, versions, selectedId, view, grid, query, onSelect, onFavorite, onRemove, onVersion, onDeleteVersion }: {
  tracks: Track[]; versions: SavedVersion[]; selectedId: string | null; view: string; grid: boolean; query: string;
  onSelect: (track: Track) => void; onFavorite: (track: Track) => void; onRemove: (track: Track) => void;
  onVersion: (version: SavedVersion) => void; onDeleteVersion: (version: SavedVersion) => void;
}) {
  const tracksById = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);
  const normalizedQuery = query.toLowerCase().trim();
  const matches = (track: Track) => !normalizedQuery || [track.title, track.artist, track.album].some(value => value.toLowerCase().includes(normalizedQuery));
  const filtered = view === 'versions' ? [] : tracks.filter(track => matches(track) && (view !== 'favorites' || track.favorite));
  if (view === 'versions') {
    const shown = versions.filter(version => { const track = tracksById.get(version.trackId); return track && (matches(track) || version.name.toLowerCase().includes(normalizedQuery)); });
    return shown.length ? <div className="version-list">{shown.map(version => {
      const track = tracksById.get(version.trackId)!;
      return <div className="saved-version-row" key={version.id}><Artwork track={track} /><button className="version-main" onClick={() => onVersion(version)}><strong>{version.name}</strong><span>{track.title} · {track.artist}</span></button><span className="version-details">{version.settings.speed.toFixed(2)}× <span>{Math.round(version.settings.reverb * 100)}% reverb</span></span><button className="icon-button" aria-label={`Delete version ${version.name}`} onClick={() => onDeleteVersion(version)}><Trash size={17} /></button></div>;
    })}</div> : <div className="empty-small"><MusicNotes size={30} /><h3>{query ? 'No matching versions' : 'A new way to hear a favorite'}</h3><p>{query ? 'Try another search.' : 'Adjust a track in the studio and save your first version.'}</p></div>;
  }
  if (!filtered.length) return <div className="empty-small"><Heart size={30} /><h3>{query ? 'No matching tracks' : view === 'playlist' ? 'A playlist waiting for your music' : 'Keep your favorites close'}</h3><p>{query ? 'Try a different title, artist, or album.' : view === 'playlist' ? 'Edit this playlist to add tracks and choose their order.' : 'Tap the heart on a track to find it here.'}</p></div>;
  if (grid) return <div className="track-grid">{filtered.map(track => <article key={track.id} className={`track-card ${selectedId === track.id ? 'selected' : ''}`}>
    <button className="cover-button" onClick={() => onSelect(track)} aria-label={`Open ${track.title}`}><Artwork track={track} /><span className="cover-play"><Play weight="fill" size={23} /></span></button>
    <div className="card-meta"><button className="track-title-button" title={`${track.title} · ${track.artist}`} onClick={() => onSelect(track)}><strong>{track.title}</strong><span>{track.artist}</span></button><button className={`icon-button small favorite ${track.favorite ? 'active' : ''}`} aria-label={`${track.favorite ? 'Unfavorite' : 'Favorite'} ${track.title}`} aria-pressed={track.favorite} onClick={() => onFavorite(track)}><Heart weight={track.favorite ? 'fill' : 'regular'} size={18} /></button></div>
    <div className="card-bottom"><span>{track.format} <span>· {formatTime(track.duration)}</span></span><button className="icon-button small remove-button" aria-label={`Remove ${track.title}`} onClick={() => onRemove(track)}><Trash size={14} /></button></div>
  </article>)}</div>;
  return <div className="track-list"><div className="track-list-header"><span>Track</span><span>Album</span><span>Time</span><span /></div>{filtered.map(track => <div className={`track-row ${track.id === selectedId ? 'selected' : ''}`} key={track.id}>
    <button className="row-track" onClick={() => onSelect(track)}><Artwork track={track} /><span><strong>{track.title}</strong><span>{track.artist}</span></span></button><span className="row-album">{track.album}</span><span className="row-time">{formatTime(track.duration)}</span><div className="row-actions"><button className={`icon-button small favorite ${track.favorite ? 'active' : ''}`} aria-label={`${track.favorite ? 'Unfavorite' : 'Favorite'} ${track.title}`} aria-pressed={track.favorite} onClick={() => onFavorite(track)}><Heart weight={track.favorite ? 'fill' : 'regular'} size={18} /></button><button className="icon-button small" aria-label={`Remove ${track.title}`} onClick={() => onRemove(track)}><Trash size={15} /></button></div>
  </div>)}</div>;
});
