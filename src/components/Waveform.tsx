import { useMemo, type CSSProperties } from 'react';
import { formatTime } from '../api.ts';
import { resolveEdit, type AudioEdit } from '../../shared/types.ts';

export function Waveform({ buffer, position, speed, onSeek, disabled, edit }: { buffer: AudioBuffer | null; position: number; speed: number; onSeek: (position: number) => void; disabled: boolean; edit: AudioEdit }) {
  const peaks = useMemo(() => {
    if (!buffer) return [];
    const data = buffer.getChannelData(0);
    const count = 160;
    const step = Math.max(1, Math.floor(data.length / count));
    const values = Array.from({ length: count }, (_, index) => {
      let peak = 0;
      for (let i = index * step; i < Math.min(data.length, (index + 1) * step); i += Math.max(1, Math.floor(step / 100))) peak = Math.max(peak, Math.abs(data[i]));
      return peak;
    });
    const maximum = Math.max(...values, 0.001);
    return values.map(value => Math.max(0.04, value / maximum));
  }, [buffer]);
  const duration = buffer?.duration ?? 0;
  const progress = duration ? position / duration * 100 : 0;
  const range = resolveEdit(edit, duration);
  return <div className="waveform-block">
    <div className={`waveform ${!buffer ? 'waveform-empty' : ''}`} style={{ '--progress': `${progress}%` } as CSSProperties}>
      <div className="waveform-bars" aria-hidden="true">{peaks.map((peak, index) => <span key={index} style={{ height: `${peak * 100}%` }} className={index / peaks.length * 100 < progress ? 'played' : ''} />)}</div>
      {buffer && <span className="playhead" aria-hidden="true" />}
      {!!duration && (range.start > 0 || range.end < duration) && <><span className="trim-shade trim-before" style={{ width: `${range.start / duration * 100}%` }} /><span className="trim-shade trim-after" style={{ width: `${(duration - range.end) / duration * 100}%` }} /><span className="trim-line" style={{ left: `${range.start / duration * 100}%` }} /><span className="trim-line" style={{ left: `${range.end / duration * 100}%` }} /></>}
      <input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(position, duration)} onChange={event => onSeek(Number(event.target.value))} disabled={disabled || !buffer} aria-label="Playback position" aria-valuetext={`${formatTime(position / speed)} of ${formatTime(duration / speed)}`} />
      {!buffer && <span className="waveform-hint">Your sound starts here</span>}
    </div>
    <div className="time-labels"><span>{formatTime((position - range.start) / speed)}</span>{(range.start > 0 || range.end < duration) && <span>Selection {formatTime(range.start)} – {formatTime(range.end)}</span>}<span>{formatTime((range.end - range.start) / speed)}</span></div>
  </div>;
}
