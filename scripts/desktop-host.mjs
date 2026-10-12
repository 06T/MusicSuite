import path from 'node:path';
import { writeFileSync, renameSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { server, shutdown } from '../server/index.ts';


const directory = process.env.MUSICSUITE_DATA_DIR;
if (!directory) throw new Error('The desktop launcher must choose a library directory.');
const statusFile = path.join(directory, 'desktop-status.json');
let state = 'starting';
let url;
function record(next) {
  state = next;
  const temporary = `${statusFile}.tmp`;
  writeFileSync(temporary, JSON.stringify({ app: 'MusicSuite', state, pid: process.pid, url, directory, runtime: process.execPath, updatedAt: new Date().toISOString() }));
  renameSync(temporary, statusFile);
}
record('starting');
function ready() {
  url = `http://127.0.0.1:${server.address().port}`;
  record('ready');
}
if (server.listening) ready(); else server.once('listening', ready);
function stop() {
  if (state === 'closing' || state === 'stopped') return;
  record('closing');
  void shutdown();
}
const commands = createInterface({ input: process.stdin });
commands.on('line', line => { if (line.trim() === 'quit') stop(); });
commands.once('close', stop);
process.once('exit', code => {
  try { record(code === 0 ? 'stopped' : 'failed'); } catch { /* Startup errors remain in the launcher log. */ }
});
