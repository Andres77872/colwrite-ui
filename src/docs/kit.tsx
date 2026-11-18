import type { ReactNode } from 'react';
import { ArrowUpRight, Info, TriangleAlert } from 'lucide-react';
import { examples, exampleUrl, type ExampleId } from '../examples/catalog';

// The building blocks of a docs page. Rendered inside the Vite config
// process (vite.docs.ts): relative imports only, never `@/`.

/** The page's facts at a glance: where the feature is, who may use it, what it needs. */
export function Facts({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="docs-facts">
      {rows.map(([term, detail]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A point the reader should not miss. */
export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  const Icon = tone === 'warning' ? TriangleAlert : Info;
  return (
    <aside className="docs-note" data-tone={tone}>
      <Icon aria-hidden="true" />
      <div>{children}</div>
    </aside>
  );
}

/**
 * A live example of what a page can hold, drawn by the editor's own block.
 * Examples follow the site's dark appearance whatever the device's theme.
 */
export function Example({ id }: { id: ExampleId }) {
  const { title, action, height } = examples[id];
  const url = `${exampleUrl(id)}&theme=dark`;
  return (
    <figure className="docs-example">
      <iframe data-colwrite-example="" src={url} title={`Example: ${title}`} height={height} loading="lazy" />
      <figcaption>
        <span>
          <strong>Try it:</strong> {action}
        </span>
        <a href={url} target="_blank" rel="noreferrer">
          Open on its own <ArrowUpRight aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </figcaption>
    </figure>
  );
}
