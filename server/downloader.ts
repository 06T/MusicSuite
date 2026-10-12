import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImportTools, Provider } from '../shared/online.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundled = path.join(root, '.tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
export const downloaderPath = () => process.env.MUSICSUITE_YTDLP || (existsSync(bundled) ? bundled : 'yt-dlp');
const portable = () => process.env.MUSICSUITE_PORTABLE === '1';
const toolSetup = () => portable() ? 'Extract the complete Windows ZIP again, or update to a newer MusicSuite release.' : 'Run npm run setup:imports and check FFmpeg.';
const downloaderUpdate = () => portable() ? 'update to a newer MusicSuite Windows ZIP' : 'update the downloader with npm run setup:imports';

export type RunOptions = { signal?: AbortSignal; timeout?: number; cwd?: string; onLine?: (line: string) => void };
export function runCommand(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error('Import cancelled.'));
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let pending = ''; let errors = ''; let failure: string | undefined; let settled = false;
    const stop = (message: string) => {
      if (failure || settled) return;
      failure = message;
      if (child.pid && process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
        killer.on('error', () => child.kill()); killer.on('close', code => { if (code !== 0) child.kill(); });
      } else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); } }
    };
    const abort = () => stop('Import cancelled.');
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => stop('The source took too long to respond. Try again later.'), options.timeout ?? 180000);
    const cleanup = () => { settled = true; clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      if (!options.onLine) { output += data; if (output.length > 4 * 1024 * 1024) stop('The source returned too much metadata.'); return; }
      pending += data;
      if (pending.length > 1024 * 1024) { stop('Unexpected downloader output.'); return; }
      const lines = pending.split(/\r?\n/); pending = lines.pop() ?? '';
      for (const line of lines) options.onLine(line);
    });
    child.stderr.on('data', (data: string) => { errors = (errors + data).slice(-16000); });
    child.on('error', () => { cleanup(); reject(new Error(`The local downloader could not start. ${toolSetup()}`)); });
    child.on('close', code => {
      cleanup(); if (pending && options.onLine) options.onLine(pending);
      if (failure) reject(new Error(failure));
      else if (code !== 0) reject(new Error(friendlyDownloadError(errors)));
      else resolve(output);
    });
  });
}

export function friendlyDownloadError(message: string) {
  if (/DRM|protected content/i.test(message)) return 'This track is protected and cannot be imported. Choose an accessible public track.';
  if (/private|sign in|login|age.restricted|members.only|premium|confirm.*bot/i.test(message)) return 'This source requires sign-in or is restricted. Choose a public track accessible without an account.';
  if (/not available|unavailable|removed|copyright|404|geo.restrict|not.*country/i.test(message)) return 'This track is unavailable from this computer. Try another public link.';
  if (/too large|larger than|max.filesize/i.test(message)) return 'This audio exceeds the 100 MB import limit.';
  if (/unsupported url|no suitable extractor/i.test(message)) return 'Choose a public YouTube video or playlist, or a SoundCloud track or set.';
  if (/ffmpeg|ffprobe|postprocess/i.test(message)) return portable() ? 'Audio conversion failed. Extract the complete Windows ZIP again, including the tools folder, then retry.' : 'Audio conversion failed. Check that FFmpeg and ffprobe are installed, then retry.';
  return `The source could not be downloaded. Try again, or ${downloaderUpdate()}.`;
}

let cachedTools: { at: number; value: Promise<ImportTools> } | undefined;
export async function checkImportTools(): Promise<ImportTools> {
  if (cachedTools && Date.now() - cachedTools.at < 15000) return cachedTools.value;
  const value = (async () => {
    const [downloader, ffmpeg, ffprobe] = await Promise.allSettled([
      runCommand(downloaderPath(), ['--ignore-config', '--version'], { timeout: 15000 }),
      runCommand(process.env.MUSICSUITE_FFMPEG || 'ffmpeg', ['-version'], { timeout: 15000 }),
      runCommand(process.env.MUSICSUITE_FFPROBE || 'ffprobe', ['-version'], { timeout: 15000 }),
    ]);
    const version = downloader.status === 'fulfilled' ? downloader.value.trim() : null;
    const audioTools = ffmpeg.status === 'fulfilled' && ffprobe.status === 'fulfilled';
    const current = !!version && /^\d{4}\.\d{2}\.\d{2}/.test(version) && version.slice(0, 10) >= '2025.11.12';
    return { ready: current && audioTools, downloader: version, ffmpeg: audioTools, ...(!current ? { message: portable() ? toolSetup() : 'Install or update the MusicSuite downloader: npm run setup:imports' } : !audioTools ? { message: portable() ? toolSetup() : 'Install FFmpeg and ffprobe and make them available on PATH.' } : {}) };
  })();
  cachedTools = { at: Date.now(), value }; return value;
}

export function baseArguments(provider: Provider, playlist = false) {
  return ['--ignore-config', '--no-plugin-dirs', playlist ? '--yes-playlist' : '--no-playlist', '--no-warnings', '--no-cache-dir', '--no-js-runtimes', '--js-runtimes', `node:${process.execPath}`, '--use-extractors', provider === 'youtube' ? (playlist ? 'youtube:tab,youtube' : 'youtube') : (playlist ? 'soundcloud:set,soundcloud' : 'soundcloud'), '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '2', '--no-colors', ...(process.env.MUSICSUITE_FFMPEG ? ['--ffmpeg-location', process.env.MUSICSUITE_FFMPEG] : [])];
}
