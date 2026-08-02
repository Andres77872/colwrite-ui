import { Fragment, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { materializedParts, sanitizeInlineFragment } from '@/export/sanitize';
import { renderLatex } from '@/lib/katex';
import type { Block, ParagraphChild } from '@/editor';
import { diffWords } from '@/lib/diff';
import { BarChart3, Quote, Sigma, Sparkles, Table2 } from 'lucide-react';

/**
 * A block the author has not accepted yet, rendered as the document renders it.
 *
 * The review used to show a proposed block as `blockText()` — tags stripped,
 * every inline widget flattened to a `▦` — at the panel's 13px UI size. So a
 * proposed heading looked like a proposed paragraph, a rewritten sentence
 * carrying a citation looked like a sentence with a glyph in it, and an
 * equation was unreadable. The author was asked to accept prose they had not
 * been shown.
 *
 * The html is run through the export sanitizer rather than `innerHTML`: it is
 * agent output, and it is the one path into the document that never passed
 * through the editor's own serializer.
 */

/** Compact stand-in for an inline widget, sized to sit in a line of prose. */
function WidgetChip({ child }: { child: ParagraphChild }) {
  const chip = (icon: ReactNode, label: string) => (
    <span className="mx-0.5 inline-flex items-baseline gap-1 rounded-sm bg-muted px-1.5 py-px align-baseline text-[0.85em] text-muted-foreground">
      <span aria-hidden="true" className="self-center">{icon}</span>
      {label}
    </span>
  );

  switch (child.type) {
    case 'citation': {
      const keys = child.keys ?? [];
      const label = keys.length ? keys.join('; ') : 'citation';
      return chip(<Quote className="h-3 w-3" />, label);
    }
    case 'equation': {
      const rendered = renderLatex(child.latex, false);
      if (rendered.ok) {
        return (
          <span
            className="katex-host align-baseline"
            // Produced by KaTeX from the latex above, not by the agent.
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        );
      }
      return chip(<Sigma className="h-3 w-3" />, child.latex || 'equation');
    }
    case 'table':
      return chip(<Table2 className="h-3 w-3" />, `table ${child.rows}×${child.cols}`);
    case 'graph':
      return chip(<BarChart3 className="h-3 w-3" />, child.title || `${child.kind} chart`);
    case 'aiBeat':
      return chip(<Sparkles className="h-3 w-3" />, 'AI passage');
  }
}

/** Sanitized inline html plus its widgets, as React nodes. */
function InlineContent({ html, children }: { html: string; children?: ParagraphChild[] }) {
  const parts = useMemo(() => materializedParts(sanitizeInlineFragment(html || '')), [html]);
  const byId = useMemo(() => {
    const map = new Map<string, ParagraphChild>();
    for (const child of children ?? []) map.set(child.id, child);
    return map;
  }, [children]);

  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'html') {
          return (
            <span
              key={index}
              // Sanitized above: tags restricted to an inline allow-list, every
              // attribute dropped except a checked `href`.
              dangerouslySetInnerHTML={{ __html: part.html }}
            />
          );
        }
        const child = byId.get(part.childId);
        if (!child) return null;
        return <WidgetChip key={index} child={child} />;
      })}
    </>
  );
}

/** Typography that matches the real block, so a preview reads as the document. */
function blockClassName(block: Block): string {
  if (block.type === 'heading') {
    return cn(
      'font-semibold leading-tight tracking-tight',
      block.level === 1 && 'text-3xl',
      block.level === 2 && 'text-2xl',
      block.level === 3 && 'text-xl',
    );
  }
  return 'text-md leading-relaxed';
}

export function ProposedBlockView({
  block,
  className,
}: {
  block: Block | null;
  className?: string;
}) {
  if (!block) {
    return (
      <p className="text-md italic leading-relaxed text-muted-foreground">
        The assistant sent a block this editor cannot render.
      </p>
    );
  }

  if (block.type === 'divider') {
    return (
      <div className={cn('py-3', className)}>
        <hr className="h-px border-0 bg-border/60" />
      </div>
    );
  }

  const children = block.type === 'paragraph' ? block.children : undefined;
  const empty = !block.html || !block.html.trim();

  return (
    <div className={cn(blockClassName(block), 'whitespace-pre-wrap break-words', className)}>
      {empty ? (
        <span className="italic text-muted-foreground">Empty block</span>
      ) : (
        <InlineContent html={block.html} children={children} />
      )}
    </div>
  );
}

/**
 * A rewrite, shown as one piece of prose with the edit marked in it.
 *
 * Two paragraphs side by side is the same amount of reading as writing it
 * again. Inline marks are what let the author see the change rather than find
 * it — and when a rewrite touches only markup or a citation, the fallback says
 * so instead of rendering an unchanged-looking diff.
 */
export function ProposedRewriteView({
  before,
  after,
  block,
}: {
  before: string;
  after: string;
  block: Block | null;
}) {
  const segments = useMemo(() => diffWords(before, after), [before, after]);
  const changed = segments.some((segment) => segment.type !== 'equal');

  if (!changed) {
    return (
      <div className="space-y-1">
        <ProposedBlockView block={block} />
        <p className="text-xs text-muted-foreground">
          The wording is unchanged — this rewrite only affects formatting or an inline element.
        </p>
      </div>
    );
  }

  return (
    <p className={cn('text-md leading-relaxed whitespace-pre-wrap break-words')}>
      {segments.map((segment, index) => {
        if (segment.type === 'equal') return <Fragment key={index}>{segment.value}</Fragment>;
        return (
          <span
            key={index}
            className={cn(
              'rounded-sm',
              segment.type === 'insert'
                ? 'bg-diff-add text-diff-add-fg'
                : 'bg-diff-remove text-diff-remove-fg line-through decoration-1',
            )}
          >
            {segment.value}
          </span>
        );
      })}
    </p>
  );
}
