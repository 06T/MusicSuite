import { mkdir, mkdtemp, readFile, writeFile, cp, readdir, rename, stat } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { downloadVerified, sha256 } from './portable-tools.ts';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the Windows x64 package on Windows x64.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, 'scripts/windows/tools.lock.json'), 'utf8'));
const name = `MusicSuite-${pkg.version}-Windows-x64`;
const cache = path.join(root, '.cache/portable-downloads');
const releases = path.join(root, 'releases');
await mkdir(path.join(root, '.cache'), { recursive: true });
await mkdir(releases, { recursive: true });
const working = await mkdtemp(path.join(root, '.cache/portable-build-'));
const stage = path.join(working, name);
await mkdir(stage);

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true, shell: false });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`)));
  });
}
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const ps = (...args) => run('powershell.exe', ['-NoProfile', '-File', ...args]);

console.log('Building MusicSuite for Windows x64…');
await run(process.execPath, [npmCli, 'run', 'build']);
const entries = [['node', lock.node], ['ytdlp', lock.ytdlp], ['ffmpeg', lock.ffmpeg], ...[...lock.sources, ...lock.notices].map(source => [source.name, source])];
const downloads = Object.fromEntries(await Promise.all(entries.map(async ([key, tool]) => [key, await downloadVerified(tool, cache)])));

const nodeExtract = path.join(working, 'node');
const ffmpegExtract = path.join(working, 'ffmpeg');
await ps(path.join(root, 'scripts/windows/archive.ps1'), '-Operation', 'extract', '-Source', downloads.node, '-Destination', nodeExtract);
await ps(path.join(root, 'scripts/windows/archive.ps1'), '-Operation', 'extract', '-Source', downloads.ffmpeg, '-Destination', ffmpegExtract);
const nodeRoot = path.join(nodeExtract, (await readdir(nodeExtract))[0]);
const ffmpegRoot = path.join(ffmpegExtract, (await readdir(ffmpegExtract))[0]);
const runtime = path.join(stage, 'runtime');
const tools = path.join(stage, 'tools');
const licenses = path.join(stage, 'licenses');
const sources = path.join(licenses, 'sources');
for (const directory of [runtime, tools, sources, path.join(licenses, 'yt-dlp'), path.join(licenses, 'FFmpeg')]) await mkdir(directory, { recursive: true });
await cp(path.join(nodeRoot, 'node.exe'), path.join(runtime, 'node.exe'));
await cp(path.join(nodeRoot, 'LICENSE'), path.join(licenses, 'Node-LICENSE.txt'));
await cp(downloads.ytdlp, path.join(tools, 'yt-dlp.exe'));
for (const file of await readdir(path.join(ffmpegRoot, 'bin'))) {
  if (/\.dll$/i.test(file) || ['ffmpeg.exe', 'ffprobe.exe'].includes(file)) await cp(path.join(ffmpegRoot, 'bin', file), path.join(tools, file));
}
await cp(path.join(ffmpegRoot, 'LICENSE.txt'), path.join(licenses, 'FFmpeg/LICENSE.txt'));
for (const source of lock.sources) await cp(downloads[source.name], path.join(sources, source.name));


const ffSourceExtract = path.join(working, 'ff-source');
const recipeExtract = path.join(working, 'ff-recipes');
await mkdir(ffSourceExtract); await mkdir(recipeExtract);
await run('tar.exe', ['-xzf', downloads['FFmpeg-source.tar.gz'], '-C', ffSourceExtract]);
await run('tar.exe', ['-xzf', downloads['FFmpeg-build-recipes.tar.gz'], '-C', recipeExtract]);
const ffSourceRoot = path.join(ffSourceExtract, (await readdir(ffSourceExtract))[0]);
for (const file of ['COPYING.LGPLv3', 'COPYING.GPLv3', 'LICENSE.md']) await cp(path.join(ffSourceRoot, file), path.join(licenses, 'FFmpeg', file));
const recipeRoot = path.join(recipeExtract, (await readdir(recipeExtract))[0]);
const recipeSources = [];
async function scanRecipes(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await scanRecipes(file); continue; }
    if (!entry.name.endsWith('.sh')) continue;
    const text = await readFile(file, 'utf8');
    const variables = Object.fromEntries([...text.matchAll(/^SCRIPT_(REPO|MIRROR|COMMIT|REV)(\d*)="([^"]+)"/gm)].map(match => [match[1] + match[2], match[3]]));
    for (const [key, repository] of Object.entries(variables)) {
      if (!key.startsWith('REPO')) continue;
      const suffix = key.slice(4), revision = variables['COMMIT' + suffix] || variables['REV' + suffix];
      const github = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(repository);
      recipeSources.push({ recipe: path.relative(recipeRoot, file).replaceAll('\\', '/'), repository, revision,
        mirror: variables['MIRROR' + suffix], archive: github && revision ? `https://github.com/${github[1]}/archive/${revision}.tar.gz` : undefined });
    }
  }
}
await scanRecipes(path.join(recipeRoot, 'scripts.d'));
await writeFile(path.join(licenses, 'FFmpeg/upstream-sources.json'), JSON.stringify({
  note: 'Exact source locations from the bundled upstream recipes. This inventory covers all build variants; disabled components are not necessarily in this LGPL Windows build. For non-archive sources, check out the repository at the recorded Git commit or SVN revision. Build scripts and patches are in licenses/sources/FFmpeg-build-recipes.tar.gz.',
  buildCommit: lock.ffmpeg.buildCommit, sources: recipeSources,
}, null, 2) + '\n');
const ffVersion = await promisify(execFile)(path.join(tools, 'ffmpeg.exe'), ['-version'], { windowsHide: true });
await writeFile(path.join(licenses, 'FFmpeg/build-configuration.txt'), ffVersion.stdout);


const sourceExtract = path.join(working, 'yt-source');
await mkdir(sourceExtract);
await run('tar.exe', ['-xzf', downloads['yt-dlp-source.tar.gz'], '-C', sourceExtract]);
await cp(path.join(sourceExtract, 'yt-dlp/LICENSE'), path.join(licenses, 'yt-dlp/LICENSE'));
await cp(downloads['yt-dlp-third-party-notices.txt'], path.join(licenses, 'yt-dlp/THIRD_PARTY_LICENSES.txt'));
await cp(path.join(root, 'scripts/windows/MusicSuiteLauncher.cs'), path.join(sources, 'MusicSuiteLauncher.cs'));

const app = path.join(stage, 'app');
await mkdir(path.join(app, 'scripts'), { recursive: true });
for (const directory of ['server', 'shared', 'dist']) await cp(path.join(root, directory), path.join(app, directory), { recursive: true });
for (const file of ['package.json', 'package-lock.json']) await cp(path.join(root, file), path.join(app, file));
await cp(path.join(root, 'scripts/desktop-host.mjs'), path.join(app, 'scripts/desktop-host.mjs'));
console.log('Installing production dependencies into the package only…');
await run(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], app);

const appPackage = { name: pkg.name, version: pkg.version, private: true, type: 'module', engines: pkg.engines, dependencies: pkg.dependencies };
await writeFile(path.join(app, 'package.json'), JSON.stringify(appPackage, null, 2) + '\n');
await ps(path.join(root, 'scripts/windows/build-launcher.ps1'), '-OutputDirectory', stage);

const dependencyNotices = [];
async function scanDependencies(directory) {
  let folders;
  try { folders = await readdir(directory, { withFileTypes: true }); } catch { return; }
  for (const folder of folders) {
    if (!folder.isDirectory() || folder.name.startsWith('.')) continue;
    const location = path.join(directory, folder.name);
    if (folder.name.startsWith('@')) { await scanDependencies(location); continue; }
    const dependency = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8'));
    dependencyNotices.push({ name: dependency.name, version: dependency.version, license: dependency.license, repository: dependency.repository });
    await scanDependencies(path.join(location, 'node_modules'));
  }
}
await scanDependencies(path.join(app, 'node_modules'));
await writeFile(path.join(licenses, 'dependencies.json'), JSON.stringify(dependencyNotices, null, 2) + '\n');
await writeFile(path.join(stage, 'THIRD_PARTY_NOTICES.txt'), `MusicSuite includes unmodified third-party tools.\n\nNode.js ${lock.node.version}: https://nodejs.org/\nSee licenses/Node-LICENSE.txt for Node and its bundled component licenses.\n\nyt-dlp ${lock.ytdlp.version}: https://github.com/yt-dlp/yt-dlp\nSee licenses/yt-dlp for the project and third-party notices.\nIts source archive and the mutagen/certifi dependency sources are in licenses/sources. Standalone binaries include their own dependencies; their licenses continue to apply.\n\nFFmpeg / ffprobe ${lock.ffmpeg.version}, LGPL v3 shared build:\nhttps://github.com/BtbN/FFmpeg-Builds\nSee licenses/FFmpeg for license texts, the actual build configuration and upstream-sources.json. Exact FFmpeg source and the upstream build recipes/patches are in licenses/sources. The source inventory identifies upstream library repositories at their pinned revisions, with direct archives where available; individual dependencies retain their own licenses. Binaries and DLLs remain replaceable in tools/ and may be modified or replaced as allowed by their licenses.\n\nJavaScript dependencies, including fonts/icons, retain their original source and license files in app/node_modules. See licenses/dependencies.json for their inventory.\n`);
await writeFile(path.join(stage, 'Read me.txt'), `MUSICSUITE ${pkg.version}\n\n1. Extract the entire ZIP into a folder.\n2. Double-click MusicSuite.exe. Your browser opens automatically.\n3. Import music or paste a YouTube / SoundCloud link.\n\nNode.js, yt-dlp, FFmpeg and ffprobe are already included. No installation, administrator access, npm commands, or PATH changes are needed.\n\nMusicSuite keeps running when you close its browser tab. Use the MusicSuite icon in the Windows notification area to reopen the app, open your library folder, or Quit. Windows may put the icon under the hidden-icons arrow.\n\nYour library is saved in:\n%LOCALAPPDATA%\\MusicSuite\\Library\n\nTo update: Quit MusicSuite, extract the new ZIP into a new folder, and open its MusicSuite.exe. Your library remains in the same place. Your library is not included in this download.\n\nThe app opens at http://127.0.0.1:3333 and only accepts local connections. Internet is needed for online downloads, not for your saved songs.\n\nRequirements: Windows 10 22H2 or Windows 11, x64, and a modern browser.\n\nIf it does not start: check that you extracted the whole folder and that no other app is using port 3333. Details are saved in launcher.log inside your library folder. This release is unsigned.\n\nImport content you own or have permission to use.\nThird-party licenses and source references are included; see THIRD_PARTY_NOTICES.txt.\n`);

const files = {};
async function inventory(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await inventory(path.join(directory, entry.name), `${relative}/`);
    else files[relative] = sha256(await readFile(path.join(directory, entry.name)));
  }
}
await inventory(stage);
await writeFile(path.join(stage, 'release-manifest.json'), JSON.stringify({ app: 'MusicSuite', version: pkg.version, platform: 'win32-x64', createdAt: new Date().toISOString(), tools: lock, files }, null, 2) + '\n');
const zip = path.join(working, `${name}.zip`);
console.log('Compressing the ready-to-run ZIP…');
await ps(path.join(root, 'scripts/windows/archive.ps1'), '-Operation', 'create', '-Source', stage, '-Destination', zip);
const destination = path.join(releases, `${name}.zip`);
await rename(zip, destination);
const digest = sha256(await readFile(destination));
await writeFile(`${destination}.sha256`, `${digest}  ${name}.zip\n`);
await writeFile(path.join(root, '.cache/portable-build.json'), JSON.stringify({ stage, zip: destination, sha256: digest, size: (await stat(destination)).size }, null, 2));
console.log(`Ready: ${destination}\nSHA-256: ${digest}`);
