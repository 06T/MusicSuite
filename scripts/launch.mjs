import { spawn } from 'node:child_process';

const port = Number(process.env.PORT || 3333);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a port between 1 and 65535.');
const url = `http://127.0.0.1:${port}`;

async function isReady() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(750) });
    const result = await response.json();
    return result.app === 'MusicSuite' && result.status === 'ok';
  } catch { return false; }
}

function openBrowser() {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const browser = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  browser.on('error', () => console.log(`Open ${url} in your browser.`)); browser.unref();
}

if (await isReady()) {
  openBrowser();
  console.log(`MusicSuite is already running at ${url}.`);
} else {
  await import('../server/index.ts');
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await isReady()) { openBrowser(); break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log('Keep this window open while listening. Press Ctrl+C to close MusicSuite.');
}
