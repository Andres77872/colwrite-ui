import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { matchOffsets } from '@/lib/text';

/**
 * Render text with every occurrence of `needle` marked.
 *
 * Built by splitting rather than by injecting HTML: the text is a third party's
 * document, and the one thing that must never happen to it on the way to the
 * screen is being parsed as markup.
 *
 * Non-matching runs are emitted as bare strings rather than wrapped in
 * `<span>`. A 20 000-character window with a common term used to produce one
 * element per gap — thousands of nodes for a pane that only needed the marks to
 * be elements.
 */
export function Highlighted({
  text,
  needle,
  activeIndex = -1,
}: {
  text: string;
  needle: string;
  /** Which match is the current one, for the caller's prev/next stepping. */
  activeIndex?: number;
}) {
  const term = needle.trim();
  const offsets = matchOffsets(text, term);
  if (offsets.length === 0) return <>{text}</>;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  offsets.forEach((at, index) => {
    if (at > cursor) nodes.push(text.slice(cursor, at));
    const active = index === activeIndex;
    nodes.push(
      <mark
        key={at}
        {...(active ? { 'data-active-match': 'true' } : {})}
        className={cn(
          'rounded-sm px-0.5 text-foreground',
          active ? 'bg-warning ring-1 ring-warning' : 'bg-warning/40',
        )}
      >
        {text.slice(at, at + term.length)}
      </mark>,
    );
    cursor = at + term.length;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <>{nodes}</>;
}
