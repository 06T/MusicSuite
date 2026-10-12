import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { Library } from './library.ts';
import { createApp } from './app.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const library = await Library.open(path.resolve(process.env.MUSICSUITE_DATA_DIR || path.join(root, 'data')));
const app = createApp(library);
export const server = createHttpServer(app);
let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
const development = process.argv.includes('--dev');
if (development) {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: { middlewareMode: true, ws: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = path.join(root, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error('Build MusicSuite first with npm run build, or use npm run dev.');
    library.close(); process.exit(1);
  }
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
const port = Number(process.env.PORT || 3333);
server.listen(port, '127.0.0.1', () => console.log(`\n  MusicSuite is ready at http://127.0.0.1:${port}\n  Library: ${library.directory}\n`));
server.on('error', error => { console.error(error.message); library.close(); process.exit(1); });
let closing = false;
export async function shutdown() {
  if (closing) return;
  closing = true;
  await app.locals.onlineImports.shutdown();
  await vite?.close();
  server.close(() => { library.close(); process.exit(0); });
  server.closeIdleConnections();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown());
