import type { CslCite, CslRendering } from './engine';
import type { CitationStyle, CslItem } from '../types';

/* ----------------------------------------
   The citation processor, loaded on first need

   citeproc-js and the vendored CSL styles and locales are about 2 MB of
   code and XML, so they are a chunk of their own (`./engine`), loaded the
   first time something renders a citation: a page with citations, the
   reference list, the style picker, an export, a copied answer. Until it is
   here, the bibliography is written in a neutral form (`buildBibliography`)
   and says so (`ready: false`); `useCitationProcessor` re-renders when it
   arrives. A chunk that failed to load is asked for again next time.
   ---------------------------------------- */

type Processor = { renderCitations: (style: CitationStyle, items: ReadonlyMap<string, CslItem>, cites: readonly CslCite[]) => CslRendering };

let processor: Processor | null = null;
let loading: Promise<Processor> | null = null;
const listeners = new Set<() => void>();

/** Load the processor (once); resolves when citations can be rendered in their style. */
export function loadCitationProcessor(): Promise<void> {
  loading ??= import('./engine').then(
    (module) => {
      processor = module;
      for (const listener of listeners) listener();
      return module;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading.then(() => undefined);
}

/** Ask for the processor without waiting; a failure leaves the neutral form. */
export function requestCitationProcessor(): void {
  if (!processor) loadCitationProcessor().catch(() => undefined);
}

/** The processor, or `null` until it has loaded. */
export function citationProcessor(): Processor | null {
  return processor;
}

export function isCitationProcessorReady(): boolean {
  return processor !== null;
}

export function subscribeCitationProcessor(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
