import { mkdir, writeFile, rename, chmod, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.tools');
const asset = process.platform === 'win32' ? process.arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe'
  : process.platform === 'darwin' ? 'yt-dlp_macos' : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
const headers = { 'User-Agent': 'MusicSuite-local-setup', Accept: 'application/vnd.github+json' };
async function fetchChecked(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Downloader setup failed (${response.status}). Try again later.`);
  return response;
}
const release = await (await fetchChecked('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest')).json();
const binary = release.assets.find(item => item.name === asset);
const checksums = release.assets.find(item => item.name === 'SHA2-256SUMS');
if (!binary || !checksums) throw new Error('No supported downloader release was found for this computer.');
const manifest = await (await fetchChecked(checksums.browser_download_url)).text();
const expected = manifest.split('\n').find(line => line.trim().split(/\s+/)[1]?.replace(/^\*/, '') === asset)?.split(/\s+/)[0];
if (!expected || !/^[a-f\d]{64}$/i.test(expected)) throw new Error('The release checksum is missing.');
console.log(`Downloading yt-dlp ${release.tag_name} for ${process.platform}/${process.arch}…`);
const bytes = Buffer.from(await (await fetchChecked(binary.browser_download_url)).arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Downloader checksum verification failed.');
await mkdir(directory, { recursive: true });
const destination = path.join(directory, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const temporary = `${destination}.download`;
try { await writeFile(temporary, bytes); if (process.platform !== 'win32') await chmod(temporary, 0o755); await rename(temporary, destination); }
finally { await rm(temporary, { force: true }); }
await writeFile(path.join(directory, 'yt-dlp-release.json'), JSON.stringify({ version: release.tag_name, sha256: expected, source: binary.browser_download_url }, null, 2));
console.log('Verified and installed the MusicSuite downloader in .tools. FFmpeg and ffprobe must also be available on PATH.');
