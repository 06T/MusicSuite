export const THEMES = [
  { id: 'studio', name: 'Studio', description: 'Slate & powder blue', background: '#171c25', accent: '#acd0ed', colorScheme: 'dark' },
  { id: 'midnight', name: 'Midnight', description: 'Deep blue & cool mint', background: '#0d1626', accent: '#a1e4da', colorScheme: 'dark' },
  { id: 'ivory', name: 'Ivory', description: 'Warm paper & terracotta', background: '#f4f0e8', accent: '#995038', colorScheme: 'light' },
  { id: 'forest', name: 'Forest', description: 'Pine & soft sage', background: '#18221e', accent: '#c6d5a9', colorScheme: 'dark' },
  { id: 'mono', name: 'Mono', description: 'Graphite & silver', background: '#161616', accent: '#deded9', colorScheme: 'dark' },
] as const;

export type ThemeId = typeof THEMES[number]['id'];
export const DEFAULT_THEME: ThemeId = 'mono';
export const THEME_KEY = 'musicsuite.theme';
export const MAX_CUSTOM_THEMES = 24;
export type CustomTheme = { id: string; name: string; background: string; accent: string };
export type AppearancePreferences = { selected: string; themes: CustomTheme[] };
export type CustomPalette = { colorScheme: 'dark' | 'light'; tokens: Record<string, string> };
export function validateTheme(value: unknown): ThemeId {
  return THEMES.some(theme => theme.id === value) ? value as ThemeId : DEFAULT_THEME;
}

export function normalizeColor(value: string): string | null {
  const match = value.trim().match(/^#?([a-f\d]{3}|[a-f\d]{6})$/i);
  if (!match) return null;
  const hex = match[1].toLowerCase();
  return `#${hex.length === 3 ? [...hex].map(char => char + char).join('') : hex}`;
}


export function validateAppearance(value: unknown, presets: readonly { id: string }[], defaultId: string, limit: number): AppearancePreferences {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const themes: CustomTheme[] = [];
  if (Array.isArray(record.themes)) for (const candidate of record.themes) {
    if (themes.length >= limit) break;
    if (!candidate || typeof candidate !== 'object') continue;
    const { id, name, background, accent } = candidate;
    if (typeof id !== 'string' || !/^custom:[a-z\d-]{1,64}$/i.test(id) || themes.some(theme => theme.id === id)) continue;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) continue;
    if (typeof background !== 'string' || !/^#[a-f\d]{6}$/i.test(background) || typeof accent !== 'string' || !/^#[a-f\d]{6}$/i.test(accent)) continue;
    themes.push({ id, name: name.trim(), background: background.toLowerCase(), accent: accent.toLowerCase() });
  }
  const selected = typeof value === 'string' ? value : record.selected;
  return { selected: typeof selected === 'string' && (presets.some(theme => theme.id === selected) || themes.some(theme => theme.id === selected)) ? selected : defaultId, themes };
}


export function createCustomPalette(background: string, accent: string): CustomPalette {
  const rgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const mix = (a: string, b: string, amount: number) => {
    const second = rgb(b);
    return `#${rgb(a).map((channel, i) => Math.round(channel * (1 - amount) + second[i] * amount).toString(16).padStart(2, '0')).join('')}`;
  };
  const luminance = (hex: string) => {
    const channels = rgb(hex).map(channel => { const n = channel / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  };
  const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const dark = contrast(background, '#ffffff') >= contrast(background, '#000000');
  const text = dark ? '#ffffff' : '#000000';
  const opposite = dark ? '#000000' : '#ffffff';
  const surface = (amount: number) => {
    const candidate = mix(background, text, amount);
    return contrast(candidate, text) >= 5 ? candidate : mix(background, opposite, amount);
  };
  const tokens: Record<string, string> = {
    '--bg': background, '--sidebar': mix(background, opposite, .18), '--panel': surface(.05), '--surface': surface(.09),
    '--studio': surface(.025), '--queue': surface(.035), '--modal': surface(.055), '--deck-start': surface(.065), '--deck-end': surface(.02),
    '--error-surface': surface(.04), '--text': text,
  };
  const backgrounds = Object.values(tokens).slice(0, -1);
  const readable = (color: string) => {
    for (let step = 0; step <= 40; step++) {
      const candidate = mix(color, text, step / 40);
      if (backgrounds.every(bg => contrast(candidate, bg) >= 4.5)) return candidate;
    }
    return text;
  };
  const accentInk = contrast(accent, '#ffffff') >= contrast(accent, '#000000') ? '#ffffff' : '#000000';
  return { colorScheme: dark ? 'dark' : 'light', tokens: {
    ...tokens, '--accent': accent, '--accent-text': readable(accent), '--accent-ink': accentInk,
    '--accent-hover': mix(accent, accentInk === '#000000' ? '#ffffff' : '#000000', .08),
    '--muted': readable(mix(background, text, .6)), '--waveform': mix(background, text, .35), '--range-track': mix(background, text, .2),
    '--success': readable(dark ? '#a6cab8' : '#456650'), '--danger': readable(dark ? '#edbdc5' : '#a34254'), '--warning': readable(dark ? '#edc799' : '#85551b'),
    '--line': mix(background, text, .14),
  } };
}


export function applyThemeToDocument(active: { id: string; background: string }, palette: CustomPalette | null, tokenNames: string[]) {
  const root = document.documentElement;
  root.dataset.theme = palette ? 'custom' : active.id;
  root.dataset.themeId = active.id;
  for (const name of tokenNames) root.style.removeProperty(name);
  if (palette) for (const [name, value] of Object.entries(palette.tokens)) root.style.setProperty(name, value);
  root.style.colorScheme = palette?.colorScheme ?? '';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', active.background);
}
