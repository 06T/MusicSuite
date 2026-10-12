import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function downloadVerified(tool: { url: string; sha256: string; name?: string }, directory: string, fetcher: (url: string, options?: RequestInit) => Promise<Response> = fetch) {
  if (!/^[a-f\d]{64}$/i.test(tool.sha256)) throw new Error('A pinned SHA-256 checksum is required.');
  const url = new URL(tool.url);
  if (url.protocol !== 'https:') throw new Error('Tools must download over HTTPS.');
  const name = tool.name ?? path.posix.basename(url.pathname);
  if (!name || path.basename(name) !== name || /[\\/]/.test(name)) throw new Error('Invalid tool archive name.');
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, name);
  try { if (sha256(await readFile(target)) === tool.sha256) return target; } catch {}
  console.log(`Downloading ${name}…`);
  const response = await fetcher(tool.url, { headers: { 'User-Agent': 'MusicSuite-portable-builder' }, signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${name}. Preserve the pinned cache or update tools.lock.json from the upstream release.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== tool.sha256) throw new Error(`Checksum verification failed: ${name}. Nothing was installed.`);
  await writeFile(`${target}.partial`, bytes);
  await rename(`${target}.partial`, target);
  return target;
}
