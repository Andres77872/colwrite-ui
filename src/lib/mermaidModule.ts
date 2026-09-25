import type { Mermaid } from 'mermaid';

/**
 * The one place Mermaid is imported — a seam, not an abstraction.
 *
 * In the app, Vite splits this dynamic import into its own chunk, loaded the
 * first time a diagram is drawn. The design-system bundle cannot do that:
 * esbuild inlines dynamic imports into its IIFE, which would put all of
 * Mermaid (~13 MB unminified) into every rendered design. The catalog build
 * (`.design-sync/build-ds-pkg.mjs`) therefore pins this module, by its `@/`
 * alias, to a copy that loads the same pinned version from a CDN at runtime.
 * Import it only as `@/lib/mermaidModule`, or that pin stops applying.
 */
export async function importMermaid(): Promise<Mermaid> {
  return (await import('mermaid')).default;
}
