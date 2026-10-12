export interface MixSettings {
  speed: number;
  reverb: number;
  decay: number;
  bass: number;
  mid: number;
  treble: number;
  output: number;
}

export const DEFAULT_MIX: MixSettings = {
  speed: 1, reverb: 0, decay: 2.5, bass: 0, mid: 0, treble: 0, output: 0,
};

export const MIX_LIMITS: Record<keyof MixSettings, readonly [number, number]> = {
  speed: [0.5, 1.5], reverb: [0, 1], decay: [0.3, 6],
  bass: [-12, 12], mid: [-12, 12], treble: [-12, 12], output: [-24, 6],
};

export function validateMix(value: unknown): MixSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Mix settings are missing.');
  const mix = value as Record<string, unknown>;
  const result = { ...DEFAULT_MIX };
  for (const key of Object.keys(MIX_LIMITS) as (keyof MixSettings)[]) {
    const number = mix[key];
    const [min, max] = MIX_LIMITS[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) {
      throw new Error(`Invalid ${key} setting.`);
    }
    result[key] = number;
  }
  return result;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  format: string;
  size: number;
  hasArtwork: boolean;
  favorite: boolean;
  createdAt: string;
  versionCount: number;
  artworkRevision: number;
  source?: import('./online.ts').Source;
}

export interface AudioEdit { start: number; end: number | null; fadeIn: number; fadeOut: number }
export const DEFAULT_EDIT: AudioEdit = { start: 0, end: null, fadeIn: 0, fadeOut: 0 };

export function validateEdit(value: unknown = DEFAULT_EDIT): AudioEdit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid trim settings.');
  const edit = value as Record<string, unknown>;
  for (const key of ['start', 'fadeIn', 'fadeOut'] as const) {
    if (typeof edit[key] !== 'number' || !Number.isFinite(edit[key]) || edit[key] < 0 || edit[key] > (key === 'start' ? 1200 : 30)) throw new Error(`Invalid ${key} setting.`);
  }
  if (edit.end !== null && (typeof edit.end !== 'number' || !Number.isFinite(edit.end) || edit.end > 1200 || edit.end <= (edit.start as number) + 0.049)) throw new Error('The trim end must follow the start.');
  return { start: edit.start as number, end: edit.end as number | null, fadeIn: edit.fadeIn as number, fadeOut: edit.fadeOut as number };
}

export function resolveEdit(edit: AudioEdit, duration: number, speed = 1) {
  const end = Math.max(0, Math.min(duration, edit.end ?? duration));
  const start = Math.max(0, Math.min(edit.start, Math.max(0, end - 0.05)));
  const length = (end - start) / speed;
  return { start, end, length, fadeIn: Math.min(edit.fadeIn, length / 2), fadeOut: Math.min(edit.fadeOut, length / 2) };
}

export interface Playlist { id: string; name: string; trackIds: string[]; createdAt: string; source?: import('./online.ts').Source }
export interface WorkspaceBackup {
  app: 'MusicSuite'; format: 1; createdAt: string;
  tracks: { hash: string; title: string; artist: string; album: string; favorite: boolean; versions: { name: string; settings: MixSettings; edit: AudioEdit }[] }[];
  playlists: { name: string; hashes: string[] }[];
}

export interface SavedVersion {
  id: string;
  trackId: string;
  name: string;
  settings: MixSettings;
  edit: AudioEdit;
  createdAt: string;
}

export const PRESETS: { name: string; description: string; settings: MixSettings }[] = [
  { name: 'Original', description: 'The untouched recording', settings: DEFAULT_MIX },
  { name: 'Slow & spacious', description: 'A little slower, a little dreamier', settings: { ...DEFAULT_MIX, speed: 0.85, reverb: 0.28, decay: 3.6, treble: -2, output: -2 } },
  { name: 'Warm vinyl', description: 'Soft highs and a fuller low end', settings: { ...DEFAULT_MIX, bass: 3, mid: 1, treble: -3, reverb: 0.08, decay: 1.2, output: -3 } },
  { name: 'After hours', description: 'Low tempo, deep space', settings: { ...DEFAULT_MIX, speed: 0.75, reverb: 0.4, decay: 4.5, bass: 2, treble: -4, output: -4 } },
];
