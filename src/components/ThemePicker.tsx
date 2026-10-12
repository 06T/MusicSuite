import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Check, Palette, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { applyThemeToDocument, createCustomPalette, DEFAULT_THEME, MAX_CUSTOM_THEMES, normalizeColor, THEMES, THEME_KEY, validateAppearance, type AppearancePreferences, type CustomTheme } from '../../shared/themes.ts';
import { readLocal } from '../api.ts';
import { Modal } from './Modal.tsx';

const readAppearance = () => validateAppearance(readLocal(THEME_KEY, null), THEMES, DEFAULT_THEME, MAX_CUSTOM_THEMES);
const tokenNames = Object.keys(createCustomPalette('#161616', '#deded9').tokens);
type ThemeDraft = CustomTheme & { backgroundHex: string; accentHex: string };

function ThemePreview({ background, accent, surface }: { background: string; accent?: string; surface?: string }) {
  return <span className="theme-preview" aria-hidden="true" style={{ '--preview-bg': background, ...(accent ? { '--preview-accent': accent, '--preview-surface': surface, '--preview-radius': '2px' } : {}) } as CSSProperties}>
    <span className="preview-sidebar"><i /><i /><i /></span>
    <span className="preview-main"><span className="preview-deck"><i className="preview-disc" /><span><i /><i /><i /></span></span><span className="preview-covers"><i /><i /><i /></span></span>
    <span className="preview-studio"><i /><i /><i /></span>
  </span>;
}

export const ThemePicker = memo(function ThemePicker() {
  const [preferences, setPreferences] = useState<AppearancePreferences>(readAppearance);
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<ThemeDraft | null>(null);
  const [removed, setRemoved] = useState<{ theme: CustomTheme; index: number; selected: boolean } | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLFieldSetElement>(null);
  const returnToChoice = useRef(false);
  const chosen = preferences.themes.find(item => item.id === preferences.selected) ?? THEMES.find(item => item.id === preferences.selected)!;
  const active = editor ?? chosen;
  const custom = !!editor || active.id.startsWith('custom:');
  const palette = useMemo(() => custom ? createCustomPalette(active.background, active.accent) : null, [custom, active.background, active.accent]);
  const savedPalettes = useMemo(() => new Map(preferences.themes.map(theme => [theme.id, createCustomPalette(theme.background, theme.accent)])), [preferences.themes]);

  useLayoutEffect(() => {
    applyThemeToDocument({ id: active.id, background: active.background }, palette, tokenNames);
  }, [active.id, active.background, palette]);

  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === THEME_KEY || event.key === null) setPreferences(readAppearance()); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    if (editor) nameInput.current?.focus();
    else if (returnToChoice.current) { gallery.current?.querySelector<HTMLInputElement>('input:checked')?.focus(); returnToChoice.current = false; }
  }, [!!editor]);

  function persist(next: AppearancePreferences) {
    try { localStorage.setItem(THEME_KEY, JSON.stringify(next)); }
    catch { setError('Could not save to this browser. Free some browser storage and try again.'); return false; }
    setPreferences(next); setError(''); return true;
  }
  function select(id: string) {
    const next = { ...preferences, selected: id };
    if (!persist(next)) setPreferences(next);
    setStatus('');
  }
  function startEditor(theme?: CustomTheme) {
    const base = theme ?? { id: '', name: '', background: chosen.background, accent: chosen.accent };
    setEditor({ ...base, backgroundHex: base.background, accentHex: base.accent });
    setStatus(''); setError(''); returnToChoice.current = true;
  }
  function close() { setEditor(null); setOpen(false); setError(''); returnToChoice.current = false; }
  function changeColor(key: 'background' | 'accent', hex: string) {
    setEditor(previous => previous ? { ...previous, [`${key}Hex`]: hex, ...(normalizeColor(hex) ? { [key]: normalizeColor(hex)! } : {}) } : null);
    setError('');
  }
  const validColors = !!editor && !!normalizeColor(editor.backgroundHex) && !!normalizeColor(editor.accentHex);
  function save(event: FormEvent) {
    event.preventDefault(); if (!editor || !validColors) return;
    const name = editor.name.trim();
    if (!name) { setError('Give your theme a name.'); return; }
    if ([...THEMES, ...preferences.themes].some(item => item.id !== editor.id && item.name.toLowerCase() === name.toLowerCase())) { setError('That name is already used. Choose another.'); return; }
    if (!editor.id && preferences.themes.length >= MAX_CUSTOM_THEMES) { setError(`You can save ${MAX_CUSTOM_THEMES} themes. Edit an existing one to make room.`); return; }
    const saved: CustomTheme = { id: editor.id || `custom:${crypto.randomUUID()}`, name, background: editor.background, accent: editor.accent };
    const themes = preferences.themes.some(item => item.id === saved.id) ? preferences.themes.map(item => item.id === saved.id ? saved : item) : [...preferences.themes, saved];
    if (!persist({ selected: saved.id, themes })) return;
    setStatus(`“${name}” saved.`); setEditor(null);
  }
  function remove(theme: CustomTheme) {
    const selected = preferences.selected === theme.id;
    if (!persist({ selected: selected ? DEFAULT_THEME : preferences.selected, themes: preferences.themes.filter(item => item.id !== theme.id) })) return;
    setRemoved({ theme, index: preferences.themes.findIndex(item => item.id === theme.id), selected });
    setStatus(`“${theme.name}” deleted.`);
    requestAnimationFrame(() => gallery.current?.querySelector<HTMLInputElement>('input:checked')?.focus());
  }
  function undoRemoval() {
    if (!removed) return;
    if (preferences.themes.length >= MAX_CUSTOM_THEMES) { setError('Delete another custom theme to make room.'); return; }
    const themes = preferences.themes.filter(item => item.id !== removed.theme.id);
    themes.splice(Math.min(removed.index, themes.length), 0, removed.theme);
    if (!persist({ selected: removed.selected && preferences.selected === DEFAULT_THEME ? removed.theme.id : preferences.selected, themes })) return;
    setStatus(`“${removed.theme.name}” restored.`); setRemoved(null);
  }

  return <>
    <button className="button secondary appearance-trigger" aria-label="Appearance" title={`Appearance · ${chosen.name}`} aria-haspopup="dialog" onClick={() => { setOpen(true); setError(''); }}>
      <Palette size={18} /><span>{chosen.name}</span>
    </button>
    {open && <Modal title={editor ? editor.id ? 'Edit theme' : 'Create theme' : 'Appearance'} description={editor ? 'Choose your colors. Text and controls adapt for readability.' : 'Pick a style, or make the listening room your own.'} onClose={close}>
      {editor ? <form className="custom-theme-editor" onSubmit={save}>
        <label className="details-field"><span className="field-label">Theme name</span><input ref={nameInput} className="text-input" aria-label="Theme name" value={editor.name} maxLength={40} placeholder="e.g. Violet hour" required onChange={event => { setEditor({ ...editor, name: event.target.value }); setError(''); }} /></label>
        <div className="custom-color-fields">{(['background', 'accent'] as const).map(key => <div key={key} className="custom-color-field">
          <span className="field-label">{key === 'background' ? 'Background' : 'Accent'}</span>
          <div><input type="color" aria-label={`${key === 'background' ? 'Background' : 'Accent'} color`} value={editor[key]} onClick={() => changeColor(key, editor[key])} onChange={event => changeColor(key, event.target.value)} /><input className="text-input" aria-label={`${key === 'background' ? 'Background' : 'Accent'} hex`} value={editor[`${key}Hex`]} maxLength={7} spellCheck={false} autoComplete="off" aria-invalid={!normalizeColor(editor[`${key}Hex`])} onChange={event => changeColor(key, event.target.value)} /></div>
          {!normalizeColor(editor[`${key}Hex`]) && <small className="color-input-error">Use a 3- or 6-digit hex color.</small>}
        </div>)}</div>
        <div className="custom-preview-card"><ThemePreview background={editor.background} accent={editor.accent} surface={palette!.tokens['--surface']} /><span>Live preview</span></div>
        <div className="custom-theme-feedback" aria-live="polite">{error && <p className="inline-error" role="alert">{error}</p>}</div>
        <div className="modal-actions"><button type="button" className="button secondary" onClick={() => { setEditor(null); setError(''); }}>Cancel</button><button className="button primary" type="submit" disabled={!editor.name.trim() || !validColors}>{editor.id ? 'Save changes' : 'Save theme'}</button></div>
      </form> : <>
        <fieldset ref={gallery} className="theme-gallery"><legend className="sr-only">Theme</legend><div className="theme-options">
          {THEMES.map(item => <label key={item.id} className={`theme-option ${preferences.selected === item.id ? 'is-selected' : ''}`} data-preview={item.id}>
            <input type="radio" name="theme" value={item.id} checked={preferences.selected === item.id} onChange={() => select(item.id)} aria-label={item.name} />
            <ThemePreview background={item.background} />
            <span className="theme-option-copy"><strong>{item.name}{item.id === DEFAULT_THEME && <small>Default</small>}</strong><span>{item.description}</span></span>
            <span className="theme-check" aria-hidden="true"><Check size={13} weight="bold" /></span>
          </label>)}
        </div>
        <div className="custom-themes-heading"><h3>Your themes <span>{preferences.themes.length || ''}</span></h3><button type="button" className="text-button" disabled={preferences.themes.length >= MAX_CUSTOM_THEMES} onClick={() => startEditor()}><Plus size={14} />Create theme</button></div>
        {preferences.themes.length ? <div className="theme-options custom-theme-options">{preferences.themes.map(item => <div key={item.id} className="custom-theme-tile">
          <label className={`theme-option ${preferences.selected === item.id ? 'is-selected' : ''}`}>
            <input type="radio" name="theme" value={item.id} checked={preferences.selected === item.id} onChange={() => select(item.id)} aria-label={item.name} />
            <ThemePreview background={item.background} accent={item.accent} surface={savedPalettes.get(item.id)!.tokens['--surface']} />
            <span className="theme-option-copy"><strong title={item.name}>{item.name}</strong><span>{item.background} · {item.accent}</span></span>
            <span className="theme-check" aria-hidden="true"><Check size={13} weight="bold" /></span>
          </label><div className="custom-theme-actions"><button className="text-button" aria-label={`Edit ${item.name} theme`} onClick={() => startEditor(item)}><PencilSimple size={13} />Edit</button><button className="icon-button small" aria-label={`Delete ${item.name} theme`} onClick={() => remove(item)}><Trash size={14} /></button></div>
        </div>)}</div> : <p className="custom-themes-empty">Your colors, saved for your next listening session.</p>}
        </fieldset>
        <div className="custom-theme-feedback" aria-live="polite">{error ? <p className="inline-error" role="alert">{error}</p> : <span>{status}</span>}{removed && <button className="text-button" onClick={undoRemoval}>Undo delete</button>}</div>
        <div className="theme-picker-footer"><button className="text-button" disabled={preferences.selected === DEFAULT_THEME} onClick={() => select(DEFAULT_THEME)}>Reset to Mono</button><span role="status" className="sr-only">{chosen.name} theme selected</span><button className="button primary" onClick={close}>Done</button></div>
        <p className="theme-save-note">Themes are saved on this browser.</p>
      </>}
    </Modal>}
  </>;
});
