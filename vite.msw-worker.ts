import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';

const WORKER_PATH = '/mockServiceWorker.js';
const workerUrl = new URL('./node_modules/msw/lib/mockServiceWorker.js', import.meta.url);

/**
 * Serves MSW's service worker at the site root on the dev server only, for the
 * dev preview (`dev-preview.html`, `src/dev/preview.ts`). It is read from the
 * installed `msw`, so it always matches the library's version, and it is never
 * part of a production build.
 */
export function mswWorkerPlugin(): Plugin {
  return {
    name: 'colwrite-msw-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(WORKER_PATH, async (_request, response) => {
        response.setHeader('Content-Type', 'text/javascript');
        response.setHeader('Cache-Control', 'no-store');
        response.end(await readFile(workerUrl, 'utf8'));
      });
    },
  };
}
