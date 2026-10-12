import { applyThemeToDocument, createCustomPalette, DEFAULT_THEME, MAX_CUSTOM_THEMES, THEMES, THEME_KEY, validateAppearance } from './themes.ts';



export function themeBootstrapScript() {
  return `(() => {
    const presets = ${JSON.stringify(THEMES)};
    const validate = (${validateAppearance.toString()});
    const palette = (${createCustomPalette.toString()});
    const apply = (${applyThemeToDocument.toString()});
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(${JSON.stringify(THEME_KEY)}) || 'null'); } catch {}
    const state = validate(stored, presets, ${JSON.stringify(DEFAULT_THEME)}, ${MAX_CUSTOM_THEMES});
    const custom = state.themes.find(theme => theme.id === state.selected);
    const active = custom || presets.find(theme => theme.id === state.selected);
    apply(active, custom ? palette(custom.background, custom.accent) : null, Object.keys(palette('#161616', '#deded9').tokens));
  })();`;
}
