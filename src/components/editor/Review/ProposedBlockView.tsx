import { Fragment, createContext, useContext, useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { materializedParts, sanitizeInlineFragment } from '@/export/sanitize';
import { renderLatex } from '@/lib/katex';
import type { Block, ParagraphChild } from '@/editor/types';
import { isDiagramBlock, isFigureBlock } from '@/editor/blockKinds';
import { MermaidDiagram } from '@/components/common/MermaidDiagram';
import { StructuredFigure } from '@/components/common/StructuredFigure';
import { citationLabel, type Bibliography } from '@/editor/citations';
import { useBibliography } from '@/editor/bibliographyContextState';
import { diffWords } from '@/lib/diff';
import { BarChart3, Sigma, Sparkles, Table2 } from 'lucide-react';
import { InlineTrigger } from '../blocks/ParagraphBlock/Inlines/shared/InlineShell';
import { createWidgetTable, diffPieces, diffableText, edgeIsSpace } from './diffText';

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

/**
 * The bibliography a preview numbers its citations against: the document's,
 * or — when the preview adds a citation — the document as it would be with
 * the preview in it (see `previewBibliography`).
 */
const PreviewBibliographyContext = createContext<Bibliography | null>(null);

function usePreviewBibliography(): Bibliography {
  const own = useBibliography();
  return useContext(PreviewBibliographyContext) ?? own;
}

function WithBibliography({ value, children }: { value?: Bibliography | null; children: ReactNode }) {
  if (!value) return <>{children}</>;
  return <PreviewBibliographyContext.Provider value={value}>{children}</PreviewBibliographyContext.Provider>;
}

/**
 * Strike inline widgets the way removed words are struck.
 *
 * `text-decoration` does not reach into atomic inlines — KaTeX's boxes, the
 * citation button, a widget chip — so a removed equation used to read as a
 * faded but kept part of the sentence. Each widget in a preview carries
 * `diff-widget`; inside a removal it gets a 1px rule through its middle in
 * the removal colour, and takes that colour itself (a citation is otherwise
 * link blue), matching the words around it.
 */
export const STRIKE_WIDGETS =
  "[&_.diff-widget]:relative [&_.diff-widget]:after:pointer-events-none [&_.diff-widget]:after:absolute [&_.diff-widget]:after:inset-x-0 [&_.diff-widget]:after:top-[55%] [&_.diff-widget]:after:h-px [&_.diff-widget]:after:bg-current [&_.diff-widget]:after:content-[''] [&_.diff-widget]:text-inherit";

/** Who and what a citation names, for its hover text. */
function describeCitation(child: Extract<ParagraphChild, { type: 'citation' }>): string {
  const keys = child.keys ?? [];
  const described = keys.map((key) => {
    const source = child.sources?.find((candidate) => candidate.key === key);
    if (!source?.title) return key;
    const surname = source.authors?.split(/,|;| and /)[0]?.trim().split(/\s+/).pop();
    const who = [surname, source.year].filter(Boolean).join(' ');
    return who ? `${who} — ${source.title}` : source.title;
  });
  return described.length ? described.join('; ') : 'Citation';
}

/**
 * A citation as the page prints it: the page's own `InlineTrigger` in its
 * citation look, so "[1]" reads the same in a preview as once inserted — not
 * the boxed "❝ Fedus 2021 — Switch Transformers" chip it used to be. The
 * work it names is in the hover text. Not a tab stop: there is nothing to
 * edit in a preview.
 */
function CitationMark({ child }: { child: Extract<ParagraphChild, { type: 'citation' }> }) {
  const bibliography = usePreviewBibliography();
  const description = describeCitation(child);
  return (
    <InlineTrigger
      look="citation"
      tabIndex={-1}
      title={description}
      aria-label={`Citation: ${description}`}
      className="diff-widget cursor-default"
      onMouseDown={(event) => event.preventDefault()}
    >
      {citationLabel(child, bibliography)}
    </InlineTrigger>
  );
}

/** An inline widget in a preview or a diff, drawn the way the page draws it. */
export function WidgetChip({ child }: { child: ParagraphChild }) {
  const chip = (icon: ReactNode, label: string) => (
    <span className="diff-widget mx-0.5 inline-flex items-baseline gap-1 rounded-sm bg-subtle px-1.5 py-px align-baseline text-[0.85em] text-muted-foreground">
      <span aria-hidden="true" className="self-center">{icon}</span>
      {label}
    </span>
  );

  switch (child.type) {
    case 'citation':
      return <CitationMark child={child} />;
    case 'equation': {
      const rendered = renderLatex(child.latex, false);
      if (rendered.ok) {
        return (
          <span
            className="katex-host diff-widget align-baseline"
            role="img"
            aria-label={`Equation: ${child.latex}`}
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
  bibliography,
}: {
  block: Block | null;
  className?: string;
  /** Numbers the citations the preview adds; defaults to the document's. */
  bibliography?: Bibliography | null;
}) {
  return (
    <WithBibliography value={bibliography}>
      <ProposedBlockBody block={block} className={className} />
    </WithBibliography>
  );
}

function ProposedBlockBody({ block, className }: { block: Block | null; className?: string }) {
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
        <hr className="h-px border-0 bg-border" />
      </div>
    );
  }

  if (block.type === 'code' && isDiagramBlock(block)) {
    return <ProposedDiagram source={block.text} className={className} />;
  }

  if (block.type === 'code' && isFigureBlock(block)) {
    return <ProposedFigure source={block.text} className={className} />;
  }

  if (block.type === 'code') {
    return (
      <pre
        className={cn(
          'overflow-x-auto rounded-lg bg-code-bg px-4 py-3 font-mono text-sm leading-relaxed [tab-size:4]',
          className,
        )}
      >
        {block.text || <span className="italic text-muted-foreground">Empty code block</span>}
      </pre>
    );
  }

  const children = block.type === 'paragraph' ? block.children : undefined;
  const empty = !block.html || !block.html.trim();
  return (
    <TextBlockFrame block={block} className={className}>
      {empty ? (
        <span className="italic text-muted-foreground">Empty block</span>
      ) : (
        <InlineContent html={block.html} children={children} />
      )}
    </TextBlockFrame>
  );
}

/**
 * A proposed diagram, drawn — the author reviews the picture, not only the
 * Mermaid source that produces it.
 */
function ProposedDiagram({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-background px-3 py-3', className)}>
      {source.trim() ? (
        <MermaidDiagram source={source} label="Proposed diagram" />
      ) : (
        <p className="text-center text-sm italic text-muted-foreground">Empty diagram</p>
      )}
    </div>
  );
}

/**
 * A proposed structured figure, drawn with its caption — the author reviews
 * the figure the spec produces, and any error in it, before accepting.
 */
function ProposedFigure({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-background px-3 py-3', className)}>
      {source.trim() ? (
        <StructuredFigure source={source} label="Proposed figure" />
      ) : (
        <p className="text-center text-sm italic text-muted-foreground">Empty figure</p>
      )}
    </div>
  );
}

/**
 * A text block's outer shape — heading size, list marker, quote rule, callout
 * box — around whatever its content is: the proposed text, or the diff.
 */
function TextBlockFrame({
  block,
  className,
  children: content,
}: {
  block: Block | null;
  className?: string;
  children: ReactNode;
}) {
  const variant = block?.type === 'paragraph' ? block.variant : undefined;
  const typography = block ? blockClassName(block) : 'text-md leading-relaxed';

  if (block?.type === 'paragraph' && (variant === 'bullet' || variant === 'numbered' || variant === 'todo')) {
    const indent = block.indent ?? 0;
    const checked = block.checked === true;
    return (
      <div
        className={cn(typography, 'flex items-baseline gap-2 whitespace-pre-wrap break-words', className)}
        style={{ paddingLeft: `${indent * 1.5}rem` }}
      >
        <span aria-hidden="true" className="w-4 shrink-0 text-center text-muted-foreground">
          {variant === 'bullet' ? '•' : variant === 'numbered' ? '1.' : checked ? '☑' : '☐'}
        </span>
        <span className={cn('min-w-0', checked && 'text-muted-foreground line-through')}>{content}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        typography,
        'whitespace-pre-wrap break-words',
        variant === 'quote' && 'border-l-[3px] border-current pl-3.5',
        variant === 'callout' && 'rounded-lg border border-border px-3 py-3',
        className,
      )}
    >
      {content}
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
 *
 * `before` and `after` are blocks when the caller has them: their equations
 * and citations then diff as words and render as the page renders them. A
 * plain string is diffed as-is.
 */
export function ProposedRewriteView({
  before,
  after,
  block,
  bibliography,
}: {
  before: string | Block | null;
  after: string | Block | null;
  block: Block | null;
  bibliography?: Bibliography | null;
}) {
  const { segments, table } = useMemo(() => {
    const widgets = createWidgetTable();
    const text = (side: string | Block | null) =>
      typeof side === 'string' ? side : diffableText(side, widgets);
    const beforeText = text(before);
    const afterText = text(after);
    return { segments: diffWords(beforeText, afterText), table: widgets };
  }, [before, after]);
  const changed = segments.some((segment) => segment.type !== 'equal');

  if (!changed) {
    return (
      <div className="space-y-1">
        <ProposedBlockView block={block} bibliography={bibliography} />
        <p className="text-xs text-muted-foreground">
          The wording is unchanged — this rewrite only affects formatting or an inline element.
        </p>
      </div>
    );
  }

  const render = (value: string) =>
    diffPieces(value, table).map((piece, index) =>
      piece.kind === 'text' ? (
        <Fragment key={index}>{piece.text}</Fragment>
      ) : (
        <WidgetChip key={index} child={piece.child} />
      ),
    );

  return (
    <WithBibliography value={bibliography}>
      <TextBlockFrame block={block?.type === 'code' || block?.type === 'divider' ? null : block}>
        {segments.map((segment, index) => {
          if (segment.type === 'equal') return <Fragment key={index}>{render(segment.value)}</Fragment>;
          // Removed and added runs that meet with no space between them read as
          // one word ("showdemonstrate"). A thin space keeps them apart without
          // changing the text either side of the edit.
          const previous = segments[index - 1];
          const gap =
            previous &&
            previous.type !== 'equal' &&
            !edgeIsSpace(previous.value, 'end') &&
            !edgeIsSpace(segment.value, 'start');
          // del/ins, not bare spans: colour alone reads as "weWe show" — old and
          // new concatenated — to anything that does not see the paint.
          const Tag = segment.type === 'insert' ? 'ins' : 'del';
          return (
            <Fragment key={index}>
              {gap && <span aria-hidden="true">{'\u2009'}</span>}
              <Tag
                className={cn(
                  'rounded-xs no-underline',
                  segment.type === 'insert'
                    ? 'bg-diff-add text-diff-add-fg'
                    : cn('bg-diff-remove text-diff-remove-fg line-through decoration-1', STRIKE_WIDGETS),
                )}
              >
                {render(segment.value)}
              </Tag>
            </Fragment>
          );
        })}
      </TextBlockFrame>
      {/* A diagram's source diff says what changed; the drawing says what it
          now looks like. */}
      {block?.type === 'code' && isDiagramBlock(block) && (
        <ProposedDiagram source={block.text} className="mt-2" />
      )}
      {block?.type === 'code' && isFigureBlock(block) && <ProposedFigure source={block.text} className="mt-2" />}
    </WithBibliography>
  );
}
