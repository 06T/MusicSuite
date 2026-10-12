import { Scissors, ArrowCounterClockwise } from '@phosphor-icons/react';
import { DEFAULT_EDIT, resolveEdit, type AudioEdit } from '../../shared/types.ts';
import { formatTime } from '../api.ts';

export function TrimEditor({ edit, duration, speed, position, loop, onChange, onLoop }: {
  edit: AudioEdit; duration: number; speed: number; position: number; loop: boolean;
  onChange: (edit: AudioEdit) => void; onLoop: () => void;
}) {
  const range = resolveEdit(edit, duration, speed);
  const update = (key: 'start' | 'end', value: number) => {
    if (!Number.isFinite(value)) return;
    onChange({ ...edit, [key]: Math.max(key === 'start' ? 0 : range.start + 0.05, Math.min(key === 'start' ? range.end - 0.05 : duration, value)) });
  };
  return <section className="effect-section trim-editor">
    <div className="effect-heading"><h3><Scissors size={16} />Trim & fades</h3><button className="icon-button small" aria-label="Reset trim and fades" disabled={!duration || JSON.stringify(edit) === JSON.stringify(DEFAULT_EDIT)} onClick={() => onChange({ ...DEFAULT_EDIT })}><ArrowCounterClockwise size={15} /></button></div>
    <div className="trim-fields">{(['start', 'end'] as const).map(key => <label key={key}><span>{key === 'start' ? 'Start' : 'End'} <small>sec</small></span><input type="number" aria-label={`Trim ${key}`} min={key === 'start' ? 0 : range.start + 0.05} max={key === 'start' ? Math.max(0, range.end - 0.05) : duration} step="0.01" disabled={!duration} value={Number(range[key].toFixed(2))} onChange={event => update(key, event.target.valueAsNumber)} /></label>)}</div>
    <div className="trim-markers"><button className="text-button" disabled={!duration || position >= range.end - 0.05} onClick={() => update('start', Number(position.toFixed(2)))}>Set start here</button><button className="text-button" disabled={!duration || position <= range.start + 0.05} onClick={() => update('end', Number(position.toFixed(2)))}>Set end here</button></div>
    <div className="fade-fields">{(['fadeIn', 'fadeOut'] as const).map(key => <label key={key}><span>{key === 'fadeIn' ? 'Fade in' : 'Fade out'}</span><div><input aria-label={key === 'fadeIn' ? 'Fade in seconds' : 'Fade out seconds'} type="number" min={0} max={Math.min(30, range.length / 2)} step="0.1" value={Number(range[key].toFixed(2))} disabled={!duration} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) onChange({ ...edit, [key]: Math.max(0, Math.min(30, range.length / 2, value)) }); }} /><span>s</span></div></label>)}</div>
    <div className="trim-footer"><span>{formatTime(range.length)} in your mix</span><button className={`loop-button ${loop ? 'active' : ''}`} aria-pressed={loop} onClick={onLoop} disabled={!duration}>Loop selection</button></div>
  </section>;
}
