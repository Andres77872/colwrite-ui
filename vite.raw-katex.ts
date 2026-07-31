import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';

const publicId = 'virtual:colwrite-katex-css';
const resolvedId = '\0virtual:colwrite-katex-css';
const stylesheetUrl = new URL(
  './node_modules/katex/dist/katex.min.css',
  import.meta.url,
);

/** Load KaTeX CSS verbatim before Vite rewrites its font URLs. */
export function rawKatexCssPlugin(): Plugin {
  return {
    name: 'colwrite-raw-katex-css',
    enforce: 'pre',
    resolveId(id) {
      return id === publicId ? resolvedId : null;
    },
    async load(id) {
      if (id !== resolvedId) return null;
      const css = await readFile(stylesheetUrl, 'utf8');
      return `export default ${JSON.stringify(css)};`;
    },
  };
}
