import { useEffect } from 'react';
import { resolveEdit, type Track, type AudioEdit } from '../shared/types.ts';
import type { AudioEngine } from './audio/engine.ts';

/** Feature-detected integration with browser, keyboard and headset media controls. */
export function useMediaSession(engine: AudioEngine, track: Track | null, speed: number, edit: AudioEdit, ready: boolean, canNext: boolean, canPrevious: boolean, next: (direction: number) => void, onError: (message: string, error: boolean) => void) {
  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = track ? new MediaMetadata({ title: track.title, artist: track.artist, album: track.album,
      artwork: track.hasArtwork ? [{ src: new URL(`/api/tracks/${track.id}/artwork?v=${track.artworkRevision}`, location.origin).href }] : [],
    }) : null;
  }, [track?.id, track?.title, track?.artist, track?.album, track?.hasArtwork, track?.artworkRevision]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const seek = (position: number) => void engine.seek(position).catch(error => onError(error.message, true));
    const actions: Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>> = {
      play: ready ? () => void engine.play().catch(error => onError(error.message, true)) : null,
      pause: ready ? () => engine.pause() : null,
      nexttrack: canNext && ready ? () => next(1) : null,
      previoustrack: canPrevious && ready ? () => next(-1) : null,
      seekbackward: ready ? details => seek(engine.position() - (details.seekOffset ?? 5) * speed) : null,
      seekforward: ready ? details => seek(engine.position() + (details.seekOffset ?? 5) * speed) : null,
      seekto: ready ? details => { if (typeof details.seekTime === 'number') seek(resolveEdit(engine.getEdit(), engine.getSnapshot().duration).start + details.seekTime); } : null,
      stop: ready ? () => { engine.pause(); seek(resolveEdit(engine.getEdit(), engine.getSnapshot().duration).start); } : null,
    };
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try { session.setActionHandler(action, handler); } catch { /* Some browsers support only a subset of actions. */ }
    };
    for (const [action, handler] of Object.entries(actions)) set(action as MediaSessionAction, handler!);
    return () => { for (const action of Object.keys(actions)) set(action as MediaSessionAction, null); };
  }, [engine, speed, ready, canNext, canPrevious, next, onError]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    let lastPosition = -Infinity; let lastTrack: string | null = null; let lastPlaying = false;
    const sync = () => {
      const state = engine.getSnapshot();
      const playbackState = state.duration && !state.loading ? state.playing ? 'playing' : 'paused' : 'none';
      if (session.playbackState !== playbackState) session.playbackState = playbackState;
      const changed = lastTrack !== state.trackId || lastPlaying !== state.playing;
      if (!changed && Math.abs(state.position - lastPosition) < 1) return;
      lastTrack = state.trackId; lastPlaying = state.playing; lastPosition = state.position;
      if (typeof session.setPositionState !== 'function') return;
      try {
        if (!state.duration || state.loading) { session.setPositionState(); return; }
        const range = resolveEdit(engine.getEdit(), state.duration);
        session.setPositionState({ duration: range.end - range.start, playbackRate: speed, position: Math.max(0, Math.min(range.end - range.start, state.position - range.start)) });
      } catch { /* Playback remains available when position reporting is unsupported. */ }
    };
    sync(); const unsubscribe = engine.subscribe(sync);
    return () => {
      unsubscribe(); session.playbackState = 'none';
      try { session.setPositionState?.(); } catch { /* Unsupported position reporting. */ }
    };
  }, [engine, speed, ready, edit]);
}
