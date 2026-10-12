import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Track } from '../../shared/types.ts';

function colorIndex(id: string) {
  let hash = 0; for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 5;
}

export const Artwork = memo(function Artwork({ track, className = '' }: { track?: Track | null; className?: string }) {
  const [failedId, setFailedId] = useState<string | null>(null);
  return <span className={`artwork art-${track ? colorIndex(track.id) : 0} ${className}`}>
    {track?.hasArtwork && failedId !== `${track.id}-${track.artworkRevision}`
      ? <img src={`/api/tracks/${track.id}/artwork?v=${track.artworkRevision}`} alt={`${track.album} artwork`} loading="lazy" onError={() => setFailedId(`${track.id}-${track.artworkRevision}`)} />
      : <span className="fallback-art" aria-label={track ? 'Generated artwork' : 'MusicSuite artwork'}><span className="art-orbit" /><span className="art-sun" /><span className="art-horizon" /></span>}
  </span>;
});

export const Disc = memo(function Disc({ track, playing, speed }: { track?: Track | null; playing: boolean; speed: number }) {
  const discRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);
  useEffect(() => {
    const element = discRef.current;
    if (!element) return;
    const animation = element.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 12000, iterations: Infinity, easing: 'linear' });
    animation.pause(); animationRef.current = animation;
    return () => { animation.cancel(); animationRef.current = null; };
  }, []);
  useLayoutEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      const animation = animationRef.current;
      if (!animation) return;
      animation.updatePlaybackRate(speed);
      if (playing && !preference.matches) animation.play();
      else {
        const position = animation.currentTime ?? 0;
        animation.pause(); animation.currentTime = position;
      }
    };
    sync(); preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, [playing, speed]);
  return <div className={`turntable ${playing ? 'is-playing' : ''}`} aria-label={playing ? 'Record playing' : 'Record paused'}>
    <div className="disc-shadow" />
    <div className="vinyl-disc" ref={discRef} data-testid="vinyl-disc">
      <div className="vinyl-grooves" /><div className="vinyl-reflection" />
      <div className="record-label"><Artwork track={track} /><span className="label-ring" /></div>
    </div>
    <div className="spindle"><span /></div>
  </div>;
});
