import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowClockwise, ArrowCounterClockwise, CaretDown, Check, FloppyDisk, SlidersHorizontal, Waveform } from '@phosphor-icons/react';
import { DEFAULT_MIX, PRESETS, type AudioEdit, type MixSettings, type SavedVersion, type Track } from '../../shared/types.ts';
import { dbLabel } from '../api.ts';
import { TrimEditor } from './TrimEditor.tsx';

function Slider({ label, value, min, max, step = 1, display, onChange, disabled, hint }: { label: string; value: number; min: number; max: number; step?: number; display: string; onChange: (value: number) => void; disabled: boolean; hint?: string }) {
  const fill = (value - min) / (max - min) * 100;
  return <label className="control-slider"><span className="control-label"><span>{label}</span><output>{display}</output></span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} disabled={disabled} style={{ '--fill': `${fill}%` } as CSSProperties} />
    {hint && <span className="control-hint">{hint}</span>}
  </label>;
}

export function Studio({ track, settings, onChange, onSave, versions, onVersion, mixName, peak, edit, duration, position, loop, onEdit, onLoop, onUndo, onRedo, canUndo, canRedo }: {
  track: Track | null; settings: MixSettings; onChange: (mix: MixSettings, name?: string) => void; onSave: () => void;
  versions: SavedVersion[]; onVersion: (version: SavedVersion) => void; mixName: string; peak: number;
  edit: AudioEdit; duration: number; position: number; loop: boolean; onEdit: (edit: AudioEdit) => void; onLoop: () => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [activeSection, setActiveSection] = useState('effects');
  const controls = useRef<HTMLDivElement>(null);
  const jumpPosition = useRef<number | null>(null);
  function jump(section: string, selector: string) {
    const container = controls.current; const target = container?.querySelector<HTMLElement>(selector);
    if (!container || !target) return;
    if (getComputedStyle(container).display === 'contents') target.scrollIntoView({ block: 'start', behavior: 'instant' });
    else {
      container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top - 5;
      jumpPosition.current = container.scrollTop;
    }
    setActiveSection(section);
  }
  useEffect(() => {
    const container = controls.current; if (!container) return;
    const update = () => {


      if (jumpPosition.current === container.scrollTop) return;
      jumpPosition.current = null;
      const top = container.getBoundingClientRect().top + 50;
      let section = 'effects';
      for (const [name, selector] of [['trim', '.trim-editor'], ['versions', '.studio-versions']]) {
        const target = container.querySelector(selector);
        if (target && target.getBoundingClientRect().top <= top) section = name;
      }
      setActiveSection(section);
    };
    container.addEventListener('scroll', update, { passive: true });
    return () => container.removeEventListener('scroll', update);
  }, [versions.length]);
  const disabled = !track;
  const change = (key: keyof MixSettings, value: number) => onChange({ ...settings, [key]: value });
  const original = JSON.stringify(settings) === JSON.stringify(DEFAULT_MIX);
  return <aside className="studio-panel" aria-label="Sound studio">
    <div className="studio-title"><span className="studio-icon"><SlidersHorizontal size={21} /></span><h2>Sound studio</h2><div className="studio-history"><button className="icon-button small" aria-label="Undo mix change" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}><ArrowCounterClockwise size={16} /></button><button className="icon-button small" aria-label="Redo mix change" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}><ArrowClockwise size={16} /></button></div></div>
    <nav className="studio-jumps" aria-label="Studio sections"><button aria-current={activeSection === 'effects' ? 'location' : undefined} onClick={() => jump('effects', '.preset-control')}>Effects</button><button aria-current={activeSection === 'trim' ? 'location' : undefined} onClick={() => jump('trim', '.trim-editor')}>Trim & fades</button>{versions.length > 0 && <button aria-current={activeSection === 'versions' ? 'location' : undefined} onClick={() => jump('versions', '.studio-versions')}>Versions</button>}</nav>
    <div className="studio-controls" ref={controls}>
    <div className="preset-control"><label htmlFor="preset">Start with a preset</label><div className="select-wrap"><select id="preset" disabled={disabled} value={PRESETS.find(p => JSON.stringify(p.settings) === JSON.stringify(settings))?.name || 'Custom'} onChange={event => {
      const preset = PRESETS.find(p => p.name === event.target.value); if (preset) onChange({ ...preset.settings }, preset.name);
    }}>{PRESETS.map(preset => <option key={preset.name} value={preset.name}>{preset.name}</option>)}<option value="Custom" disabled>Custom mix</option></select><CaretDown size={14} /></div></div>
    <section className="effect-section"><div className="effect-heading"><h3>Playback speed</h3><span className="small-tag">Tape</span></div>
      <Slider label="Speed" value={settings.speed} min={0.5} max={1.5} step={0.01} display={`${settings.speed.toFixed(2)}×`} onChange={value => change('speed', value)} disabled={disabled} />
      <div className="range-endpoints"><span>Slower</span><span>Original</span><span>Faster</span></div>
      <p className="effect-note">Pitch follows speed, just like a record.</p>
    </section>
    <section className="effect-section"><div className="effect-heading"><h3>Reverb</h3><Waveform size={17} /></div>
      <Slider label="Space" value={settings.reverb} min={0} max={1} step={0.01} display={`${Math.round(settings.reverb * 100)}%`} onChange={value => change('reverb', value)} disabled={disabled} />
      <button className="text-button advanced-button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced} disabled={disabled}>Room settings<CaretDown size={12} className={advanced ? 'rotate' : ''} /></button>
      {advanced && <Slider label="Decay" value={settings.decay} min={0.3} max={6} step={0.1} display={`${settings.decay.toFixed(1)} s`} onChange={value => change('decay', value)} disabled={disabled} />}
    </section>
    <section className="effect-section"><div className="effect-heading"><h3>Equalizer</h3><button className="icon-button small" aria-label="Reset equalizer" title="Reset equalizer" disabled={disabled} onClick={() => onChange({ ...settings, bass: 0, mid: 0, treble: 0 })}><ArrowCounterClockwise size={15} /></button></div>
      <div className="eq-sliders">{(['bass', 'mid', 'treble'] as const).map(key => <Slider key={key} label={key === 'bass' ? 'Bass' : key === 'mid' ? 'Mids' : 'Treble'} value={settings[key]} min={-12} max={12} display={dbLabel(settings[key])} onChange={value => change(key, value)} disabled={disabled} />)}</div>
    </section>
    <section className="effect-section output-section"><Slider label="Output gain" value={settings.output} min={-24} max={6} display={dbLabel(settings.output)} onChange={value => change('output', value)} disabled={disabled} />
      <div className="output-meter" aria-label="Audio output level"><div className={peak > 0.98 ? 'meter-hot' : ''} style={{ transform: `scaleX(${Math.min(1, peak)})` }} /></div>
      <span className="meter-caption">{peak > 0.98 ? 'High output · lower the gain' : 'Peak protection enabled'}</span>
    </section>
    <TrimEditor edit={edit} duration={duration} speed={settings.speed} position={position} loop={loop} onChange={onEdit} onLoop={onLoop} />
    {versions.length > 0 && <section className="studio-versions"><h3>Versions of this track <span>{versions.length}</span></h3>{versions.map(version => <button key={version.id} className="version-mini" onClick={() => onVersion(version)}><span>{version.name}</span><span>{version.settings.speed.toFixed(2)}×</span></button>)}</section>}
    </div>
    <div className="studio-save"><div><span className="mix-state"><Check size={13} />{mixName}</span><button className="text-button" disabled={disabled || original} onClick={() => onChange({ ...DEFAULT_MIX }, 'Original')}>Reset all</button></div>
      <button className="button secondary full-width" disabled={disabled} onClick={onSave}><FloppyDisk size={17} />Save version</button>
    </div>
  </aside>;
}
