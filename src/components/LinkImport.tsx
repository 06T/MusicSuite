import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowSquareOut, CheckCircle, LinkSimple, List, Play, SoundcloudLogo, SpinnerGap, YoutubeLogo } from '@phosphor-icons/react';
import { MAX_PLAYLIST_TRACKS, isImportFinished, parseAudioLink, videoHasPlaylist, type ImportTools, type OnlineItem, type OnlineJob } from '../../shared/online.ts';
import type { Playlist, Track } from '../../shared/types.ts';
import { api, formatTime } from '../api.ts';
import { Artwork } from './Artwork.tsx';
import { Modal } from './Modal.tsx';

export const providerName = (provider: string) => provider === 'youtube' ? 'YouTube' : 'SoundCloud';
const labels: Record<OnlineJob['state'], string> = { queued: 'Waiting to import', checking: 'Reading the link', downloading: 'Downloading audio', processing: 'Preparing your audio', saving: 'Adding to your library', cancelling: 'Stopping the import', complete: 'Ready in your library', failed: 'Could not finish this import', cancelled: 'Import cancelled' };
const itemLabels: Record<OnlineItem['state'], string> = { pending: 'Waiting', checking: 'Checking', downloading: 'Downloading', processing: 'Preparing', saving: 'Saving', added: 'Added', duplicate: 'Already in library', failed: 'Skipped', cancelled: 'Not imported' };

export function OnlineImportStatus({ job, onOpen }: { job: OnlineJob; onOpen: () => void }) {
  if (isImportFinished(job)) return null;
  return <button className="online-import-status" onClick={onOpen}><SpinnerGap size={18} className="spin" /><span><strong>{labels[job.state]}{job.collection ? ` · ${job.collection.processed} of ${job.collection.total} tracks` : ''}</strong><small>{job.collection?.title ?? job.preview?.title ?? providerName(job.provider)} · Click to view import</small></span>{job.progress !== null && <span className="online-percent">{job.progress}%</span>}</button>;
}

export function LinkImport({ job, connectionError, onStart, onCancel, onClose, onOpenTrack, onOpenPlaylist }: {
  job: OnlineJob | null; connectionError: string; onStart: (url: string, playlist: boolean) => Promise<void>; onCancel: () => Promise<void>; onClose: () => void; onOpenTrack: (track: Track) => void; onOpenPlaylist: (playlist: Playlist) => void;
}) {
  const [url, setUrl] = useState(''); const [tools, setTools] = useState<ImportTools | null>(null);
  const [wholePlaylist, setWholePlaylist] = useState(false);
  const [toolError, setToolError] = useState(''); const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const active = !!job && !isImportFinished(job);
  const source = (() => { try { return parseAudioLink(url, wholePlaylist); } catch { return null; } })();
  const collection = job?.collection;
  const currentItem = collection?.items.find(item => ['checking', 'downloading', 'processing', 'saving'].includes(item.state));
  useEffect(() => { let alive = true; void api<ImportTools>('/api/import-tools').then(value => { if (alive) setTools(value); }).catch(error => { if (alive) setToolError(error.message); }); return () => { alive = false; }; }, []);
  useEffect(() => { if (!active) input.current?.focus({ preventScroll: true }); }, [active]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    try { parseAudioLink(url, wholePlaylist); setSubmitting(true); await onStart(url, wholePlaylist); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not start the import.'); }
    finally { setSubmitting(false); }
  }
  async function cancel() { setSubmitting(true); try { await onCancel(); } catch (error) { setError(error instanceof Error ? error.message : 'Could not cancel the import.'); } finally { setSubmitting(false); } }
  return <Modal title="Bring a link to life" description="Tracks and playlists, in your listening room." onClose={onClose}>
    <div className="source-platforms"><span><YoutubeLogo size={20} weight="fill" />YouTube</span><span><SoundcloudLogo size={23} weight="fill" />SoundCloud</span><span className="source-local"><CheckCircle size={13} />Saved locally</span></div>
    {job && <div className={`link-job ${job.state === 'failed' ? 'failed' : ''}`}>
      <div className="link-job-heading">{job.track ? <Artwork track={job.track} /> : <span className="link-job-icon">{job.kind === 'playlist' ? <List size={25} /> : job.provider === 'youtube' ? <YoutubeLogo size={25} /> : <SoundcloudLogo size={28} />}</span>}<div><strong>{collection?.title ?? job.track?.title ?? job.preview?.title ?? providerName(job.provider)}</strong><span>{collection ? `${collection.artist} · ${collection.total} tracks` : <>{job.track?.artist ?? job.preview?.artist ?? 'A new place for your sound'}{job.preview ? ` · ${formatTime(job.preview.duration)}` : ''}</>}</span></div></div>
      <p className="link-job-state" role="status">{active && <SpinnerGap size={15} className="spin" />}{job.duplicate ? 'This track is already in your library.' : labels[job.state]}{job.progress !== null && active && <span>{job.progress}%</span>}</p>
      {active && <div className={`import-progress ${job.progress === null ? 'indeterminate' : ''}`} role="progressbar" aria-label="Link import progress" {...(job.progress !== null ? { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': job.progress } : {})}><span style={{ transform: job.progress === null ? undefined : `scaleX(${job.progress / 100})` }} /></div>}
      {collection && <>
        {active && currentItem && <div className="collection-current"><span>Track {currentItem.index} of {collection.total}</span><strong>{currentItem.title}</strong><small>{itemLabels[currentItem.state]}{currentItem.progress !== null ? ` · ${currentItem.progress}%` : ''}</small></div>}
        <div className="collection-summary" aria-label="Playlist import summary"><span><strong>{collection.added}</strong>Added</span><span><strong>{collection.duplicates}</strong>In library</span><span className={collection.failed ? 'has-skipped' : ''}><strong>{collection.failed}</strong>Skipped</span></div>
        <details className="collection-details"><summary>Track details <span>{collection.processed} of {collection.total} finished</span></summary><ol className="collection-items">{collection.items.map(item => <li key={item.index} className={`collection-item ${item.state}`}><span className="collection-index">{['added', 'duplicate'].includes(item.state) ? <CheckCircle size={14} /> : item.index}</span><div><strong>{item.title}</strong>{item.error && <p>{item.error}</p>}</div><span className="collection-item-state">{itemLabels[item.state]}</span></li>)}</ol></details>
        {job.state === 'cancelled' && <p className="collection-note">Completed tracks stay in your library{job.playlist ? ' and playlist' : ''}. Import the same link to continue; existing tracks are reused.</p>}
        {!active && collection.failed > 0 && <p className="collection-note">Skipped tracks are listed in Track details. You can import this link again to retry them.</p>}
      </>}
      {job.error && <p className="inline-error" role="alert">{job.error}</p>}
      {job.track && <div className="link-result-actions"><button className="text-button" onClick={() => { onOpenTrack(job.track!); onClose(); }}><Play size={14} weight="fill" />Open track</button><a className="text-button" href={job.track.source?.url ?? job.url} target="_blank" rel="noreferrer">View source<ArrowSquareOut size={13} /></a></div>}
      {!active && job.playlist && <div className="link-result-actions"><button className="text-button" onClick={() => { onOpenPlaylist(job.playlist!); onClose(); }}><List size={15} />Open playlist</button><a className="text-button" href={job.url} target="_blank" rel="noreferrer">View source<ArrowSquareOut size={13} /></a></div>}
    </div>}
    {connectionError && <p className="inline-error" role="alert">{connectionError}</p>}
    {!active && <details className="link-import-more" open={collection ? undefined : true} onToggle={event => { if (collection && event.currentTarget.open) input.current?.focus({ preventScroll: true }); }}>
      <summary hidden={!collection}>Import another link</summary>
      <form onSubmit={event => void submit(event)}>
      <label className="field-label" htmlFor="audio-link">Track or playlist link</label><div className={`link-input-wrap ${source ? 'valid' : ''}`}><LinkSimple size={18} /><input ref={input} id="audio-link" className="text-input" type="url" placeholder="Paste a YouTube or SoundCloud link" value={url} onChange={event => { setUrl(event.target.value); setWholePlaylist(false); setError(''); }} maxLength={2048} required autoFocus /></div>
      <div className="link-input-hint"><span>{source ? `${providerName(source.provider)} ${source.kind === 'playlist' ? 'playlist' : 'link'} recognized` : `Tracks or playlists · up to ${MAX_PLAYLIST_TRACKS} tracks`}</span><span>20 min · 100 MB per track</span></div>
      {videoHasPlaylist(url) && <label className="playlist-import-option"><input type="checkbox" checked={wholePlaylist} onChange={event => { setWholePlaylist(event.target.checked); setError(''); }} /><span>Import the entire playlist<small>Leave off to import just this video.</small></span></label>}
      {source?.kind === 'playlist' && <p className="collection-note"><List size={14} />Saved as a local playlist, in source order. Up to {MAX_PLAYLIST_TRACKS} tracks; existing tracks are reused.</p>}
      {(!tools && !toolError) && <p className="tool-status" role="status"><SpinnerGap size={13} className="spin" />Checking import tools…</p>}
      {(toolError || tools?.message) && <p className="inline-error" role="alert">{toolError || tools?.message}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <p className="link-permission-note">Import audio you own or have permission to use. Available track details and artwork come with it.</p>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Close</button><button className="button primary" disabled={submitting || !url.trim() || !tools?.ready}>{submitting ? <SpinnerGap size={17} className="spin" /> : source?.kind === 'playlist' ? <List size={17} /> : <LinkSimple size={17} />}{source?.kind === 'playlist' ? 'Import playlist' : 'Import audio'}</button></div>
      </form>
    </details>}
    {active && <><p className="link-permission-note">Keep listening while this imports. Closing this window keeps it running.{job.kind === 'playlist' ? ' Cancelling keeps completed tracks.' : ''}</p>{error && <p className="inline-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button ghost" disabled={submitting || job.state === 'saving' || job.state === 'cancelling'} onClick={() => void cancel()}>Cancel import</button><button className="button secondary" onClick={onClose}>Keep listening</button></div></>}
  </Modal>;
}
