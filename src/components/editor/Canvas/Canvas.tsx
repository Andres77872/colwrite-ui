import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { BrandMark, APP_NAME, APP_TAGLINE } from '@/components/common/Brand';
import {
  figureNumbers,
  htmlToText,
  isDiagramBlock,
  isFigureBlock,
  kindLabel,
  kindOf,
  listNumbers,
  useEditor,
  type Block,
  type Doc,
} from '@/editor';
import { usePageSettings } from '@/editor/pageSettings';
import { uid } from '@/lib/uid';
import { BlockControls } from '../BlockControls';
import { ParagraphBlock } from '../blocks/ParagraphBlock';
import { HeadingBlock } from '../blocks/HeadingBlock';
import { DividerBlock } from '../blocks/DividerBlock';
import { CodeBlock } from '../blocks/CodeBlock';
import { DiagramBlock } from '../blocks/DiagramBlock';
import { FigureBlock } from '../blocks/FigureBlock';
import { figureMeta } from '@/lib/figure/compile';
import { useBlockSelection } from './useBlockSelection';
import { useBlockDrag } from './useBlockDrag';
import { ReorderMotion } from './ReorderMotion';
import { AskAiPanel, useAskAiTarget } from '../AskAi';
import { DocumentOutline } from '../Outline';
import { ChangeCard, ReviewBar } from '../Review';
import { ReferencesSection, useRememberCaret } from '../References';
import { useProposals } from '@/editor/proposalsContextState';
import { documentChanges, projectDocument } from '@/editor/proposals';
import { PageTitle } from './PageTitle';
import { BlankPageActions } from './BlankPageActions';
import { ChevronRight, Sparkles } from 'lucide-react';

/** A figure's caption; a starter has none to number, but its draft still says what it is. */
function figurePreview(source: string): string {
  const meta = figureMeta(source);
  return meta.caption ?? meta.draft ?? '';
}

/** Plain-text preview of a collapsed block's content. */
function previewText(block: Block, maxChars = 60): string {
  const raw =
    block.type === 'code'
      ? isFigureBlock(block)
        ? figurePreview(block.text)
        : block.text
      : 'html' in block
        ? block.html.replace(/<[^>]*>/g, '')
        : '';
  const text = raw.replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/** A paragraph with nothing in it: what a new page starts with. */
function isBlankParagraph(block: Block): boolean {
  return (
    block.type === 'paragraph' &&
    !block.variant &&
    !block.children?.length &&
    htmlToText(block.html).trim() === ''
  );
}

/* ----------------------------------------
   First-run screen
   ---------------------------------------- */

function WelcomeScreen({
  creating,
  onCreateIntro,
  onCreateBlank,
}: {
  creating: boolean;
  onCreateIntro: () => void;
  onCreateBlank: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[calc(var(--doc-measure)+40px)] px-5 pb-12 pt-24">
      <BrandMark size="lg" />
      <h1 className="mt-6 text-4xl font-bold tracking-[-0.02em]">Welcome to {APP_NAME}</h1>
      <p className="mt-1 text-md text-muted-foreground">{APP_TAGLINE}</p>

      <p className="mt-8 text-md">
        Create your first document to get started. ColWrite pairs a clean writing canvas with an
        AI assistant and quick insert commands.
      </p>

      <ul className="mt-4 space-y-2 text-md">
        {[
          'Block-based editor with “/” commands',
          'Inline assistant for outlines, rewrites and summaries',
          'Citations, equations and simple graphs',
          'Autosave with versioned remote storage',
        ].map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <Sparkles aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-ai" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex flex-wrap gap-2">
        <Button onClick={onCreateIntro} disabled={creating}>
          {creating && <Spinner />}
          {creating ? 'Creating…' : 'Create your first document'}
        </Button>
        <Button variant="ghost" onClick={onCreateBlank} disabled={creating}>
          Start blank
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------
   Canvas
   ---------------------------------------- */

export function Canvas() {
  const {
    blocks,
    activeId,
    setActive,
    reorderBlock,
    addBlockAtStart,
    refs,
    updateHtml,
    documentId,
    createRemote,
    setFromJSON,
    toggleCollapsed,
    hasAnyRemoteDocs,
    recentlyChanged,
    selectedBlockIds,
    insertBlocksAfter,
    openMenuBlockId,
    openMenuType,
    markRecentlyChanged,
  } = useEditor();
  const { extendTo } = useBlockSelection();
  useRememberCaret();
  const askAi = useAskAiTarget();
  const aiTargets = useMemo(() => new Set(askAi.target?.blockIds ?? []), [askAi.target]);

  // A "Copy link to block" URL (`#block-<id>`) opens scrolled to that block,
  // briefly highlighted — once per document, not on every edit.
  const linkedBlockHandled = useRef<string | null>(null);
  const hasBlocks = blocks.length > 0;
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#block-') || !hasBlocks) return;
    const target = decodeURIComponent(hash.slice('#block-'.length));
    const key = `${documentId ?? 'local'}:${target}`;
    if (linkedBlockHandled.current === key) return;
    linkedBlockHandled.current = key;
    requestAnimationFrame(() => {
      const row = containerRef.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(target)}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'center' });
      markRecentlyChanged([target]);
    });
  }, [documentId, hasBlocks, markRecentlyChanged]);
  const selected = useMemo(() => new Set(selectedBlockIds), [selectedBlockIds]);
  const numbers = useMemo(() => listNumbers(blocks), [blocks]);
  const figures = useMemo(() => figureNumbers(blocks, (source) => figureMeta(source).caption), [blocks]);
  const { sets } = useProposals();
  const { toast } = useToast();

  // The document with every pending change folded into it at the position it
  // would take. One projection drives the whole canvas, so what the author
  // reads top to bottom is what `Accept all` produces — including chained
  // inserts, which used to pile up at the bottom of the page claiming their
  // block had been deleted.
  //
  // The canvas re-renders for reasons that change none of the inputs — the
  // creating spinner, selection — so each projection is memoized on what it
  // actually reads instead of being recomputed on every render.
  const docLevelChanges = useMemo(() => documentChanges(sets), [sets]);
  const { rows, orphans } = useMemo(() => projectDocument(blocks, sets), [blocks, sets]);
  const blockIndex = useMemo(
    () => new Map(blocks.map((block, index) => [block.id, index])),
    [blocks],
  );
  const order = useMemo(() => blocks.map((block) => block.id).join('\n'), [blocks]);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Drag-and-drop measures `.block-row` elements, which proposals are not, so
  // the drop line keeps indexing the real block list. It is driven outside
  // React: a drag re-renders nothing.
  const { lineRef: dropLineRef, landedRef, handlers: dragHandlers } = useBlockDrag({
    containerRef,
    blocks,
    reorderBlock,
  });

  const showWelcome = hasAnyRemoteDocs === false && !documentId;
  const isCheckingDocs = hasAnyRemoteDocs === null && !documentId;
  const isEmpty = blocks.length === 0;
  // A page with nothing written on it yet: no blocks, or the one empty line a
  // new document starts with.
  const isBlank = isEmpty || (blocks.length === 1 && isBlankParagraph(blocks[0]));
  const pageSettings = usePageSettings();

  const focusBlock = (id: string) => queueMicrotask(() => refs.current[id]?.focus());

  /** Enter or ↓ in the title: into the first block, creating one if needed. */
  const continueFromTitle = () => {
    const first = blocks[0];
    focusBlock(first && first.type !== 'divider' ? first.id : addBlockAtStart('paragraph'));
  };

  /** A click below the last block: into a trailing empty line. */
  const continueAtEnd = () => {
    const last = blocks[blocks.length - 1];
    if (!last) {
      focusBlock(addBlockAtStart('paragraph'));
      return;
    }
    if (isBlankParagraph(last) && !last.locked) {
      focusBlock(last.id);
      return;
    }
    const [id] = insertBlocksAfter(last.id, [
      { id: uid(), type: 'paragraph', html: '', children: [], columns: 1 },
    ]);
    if (id) focusBlock(id);
  };

  const buildIntroDoc = (): Doc => ({
    version: 1,
    name: 'Welcome to ColWrite',
    blocks: [
      { id: uid(), type: 'heading', level: 2, html: 'Welcome to ColWrite' },
      {
        id: uid(),
        type: 'paragraph',
        html: 'This is your workspace. Press “/” to insert headings, equations, citations and more. Select text to format it or hand it to the assistant.',
        children: [],
        columns: 1,
      },
      { id: uid(), type: 'divider' },
      { id: uid(), type: 'heading', level: 3, html: 'Quick things you can do' },
      {
        id: uid(),
        type: 'paragraph',
        html: 'Ask the assistant for outlines, rewrites and summaries. Insert citations and equations inline. Organise with headings and dividers.',
        children: [],
        columns: 1,
      },
    ],
  });

  /**
   * The welcome screen is the first thing a new account sees, and this used to
   * be the one mutation path in the app with no `catch`: a failed
   * `createRemote` rejected into nothing, so both buttons spun briefly and then
   * did nothing at all. The document still exists locally, so say so rather
   * than implying the work was lost.
   */
  const createDocument = async (next: Doc) => {
    setCreating(true);
    try {
      setFromJSON(JSON.stringify(next));
      await createRemote(next);
    } catch (error) {
      toast({
        title: 'Created locally, but the server did not accept it',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setCreating(false);
    }
  };

  if (isCheckingDocs) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center" aria-busy="true">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Preparing your workspace…
        </p>
      </div>
    );
  }

  if (showWelcome) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WelcomeScreen
          creating={creating}
          onCreateIntro={() => void createDocument(buildIntroDoc())}
          onCreateBlank={() =>
            void createDocument({ version: 1, name: 'Untitled document', blocks: [] })
          }
        />
      </div>
    );
  }

  return (
    <div
      className="canvas flex min-h-0 flex-1 flex-col overflow-y-auto outline-none"
      ref={containerRef}
      // Only a tab stop while empty, where the canvas itself accepts typing to
      // create the first block. A permanently focusable scroll container would
      // add a meaningless stop to every keyboard pass over the page.
      tabIndex={isEmpty ? 0 : -1}
      onMouseDown={(event) => {
        if (!isEmpty) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, a, input, [contenteditable]')) return;
        event.currentTarget.focus();
      }}
      onKeyDown={(event) => {
        // Only keys aimed at the page itself: the title and the blank-page
        // buttons handle their own.
        if (event.target !== event.currentTarget) return;
        if (!isEmpty || event.ctrlKey || event.metaKey || event.altKey) return;

        if (event.key === 'Enter') {
          event.preventDefault();
          focusBlock(addBlockAtStart('paragraph'));
          return;
        }
        // Typing anywhere on an empty canvas starts the first paragraph with
        // that character, the way a blank page in a word processor behaves.
        if (event.key.length !== 1) return;
        event.preventDefault();
        const initial = event.key;
        const id = addBlockAtStart('paragraph');
        queueMicrotask(() => {
          const el = refs.current[id];
          if (!el) return;
          el.textContent = initial;
          updateHtml(id, el.innerHTML);
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          el.focus();
        });
      }}
      {...dragHandlers}
    >
      {/* The review bar pins to the top of the page while there is
          something to review; the page's own chrome is the topbar above
          the canvas. */}
      <div className="sticky top-0 z-[var(--z-chrome)]">
        <ReviewBar />
      </div>

      <div
        className="document-container flex flex-1 flex-col"
        data-full-width={pageSettings.fullWidth || undefined}
        data-small-text={pageSettings.smallText || undefined}
      >
        {/* Block selection is otherwise silent: Esc lifts the caret out of
            the text and nothing a screen reader hears says what happened. */}
        <p role="status" aria-live="polite" className="sr-only">
          {selected.size === 0
            ? ''
            : `${selected.size} ${selected.size === 1 ? 'block' : 'blocks'} selected. Esc to deselect.`}
        </p>
        <PageTitle onContinue={continueFromTitle} pageKey={documentId} blank={isBlank} />
        {isBlank && <BlankPageActions blankId={blocks[0]?.id ?? null} />}

        {docLevelChanges.map((change) => (
          <ChangeCard key={change.id} change={change} />
        ))}

        {!isEmpty && (
            <div className="blocks-container relative">
              {rows.map((row) => {
                // Inserts are rows of their own, already sitting where the
                // block would land.
                if (row.kind === 'insert') {
                  return <ChangeCard key={row.change.id} change={row.change} />;
                }

                const block = row.block;
                const index = blockIndex.get(block.id) ?? 0;
                const isCollapsed = block.collapsed === true;
                // Rewrites, deletions and moves are about this block, so they
                // read below it, next to the text they would change.
                const onBlock = row.changes;
                const pendingDelete = onBlock.some((change) => change.kind === 'delete');
                const pendingRewrite = onBlock.some((change) => change.kind === 'replace');

                return (
                  <Fragment key={block.id}>
                    <div
                      className={cn(
                        'block-row group',
                        // Two channels, in this precedence. There is no hover
                        // or caret tint: hover only reveals the handle, and the
                        // caret is its own indicator, so the page stays calm.
                        //
                        // 1. MARKS — the author's own decisions about the block
                        //    (locked, hidden, collapsed) are drawn in the
                        //    gutter by `BlockControls`, so they can co-occur.
                        //
                        // 2. DIFF TREATMENT — what the assistant wants to do,
                        //    on the text itself, never a box around the row: a
                        //    deletion strikes the real text through and a
                        //    rewrite steps back so the replacement below reads
                        //    as the new version. The suggestion rows under the
                        //    block carry the rail that ties them to it.
                        //
                        // Selection and the Ask AI target are data attributes
                        // styled in globals.css.
                        pendingDelete && 'text-muted-foreground line-through decoration-diff-remove-border/70',
                        // Stepped back, not faded out: the author compares exactly this
                        // text, equations included, against the suggestion.
                        pendingRewrite && !pendingDelete && 'opacity-75',
                        recentlyChanged.has(block.id) && 'bg-diff-add',
                      )}
                      data-kind={kindOf(block)}
                      // A nested list item's handle follows its indent, so it
                      // reads as belonging to that item, not to its parent.
                      style={
                        block.type === 'paragraph' && (block.indent ?? 0) > 0
                          ? ({ '--row-indent': `${(block.indent ?? 0) * 1.5}em` } as CSSProperties)
                          : undefined
                      }
                      data-active={block.id === activeId || undefined}
                      data-block-id={block.id}
                      data-selected={selected.has(block.id) || undefined}
                      data-ai-target={(aiTargets.has(block.id) && askAi.target?.kind !== 'selection' && askAi.target?.kind !== 'empty') || undefined}
                      aria-selected={selected.size > 0 ? selected.has(block.id) : undefined}
                      // A selected block holds focus itself (see useBlockSelection).
                      tabIndex={selected.has(block.id) ? -1 : undefined}
                      onMouseDown={(event) => {
                        // Shift+click extends a block selection instead of
                        // placing the caret.
                        if (event.shiftKey && selected.size > 0) {
                          event.preventDefault();
                          extendTo(block.id);
                        }
                      }}
                      onClick={() => setActive(block.id)}
                    >
                      <BlockControls
                        block={block}
                        isFirst={index === 0}
                        isLast={index === blocks.length - 1}
                        menuOpen={openMenuBlockId === block.id && openMenuType === 'options'}
                      />

                      <div className="block-content w-full">
                        {isCollapsed ? (
                          <button
                            type="button"
                            // Collapsed rows looked clickable but had no handler,
                            // so a collapsed block could only be reopened through
                            // the gutter menu.
                            onClick={() => toggleCollapsed(block.id)}
                            aria-expanded={false}
                            className="-ml-1 inline-flex max-w-full items-center gap-1.5 rounded-md px-1 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">
                              {previewText(block) || kindLabel(block)}
                            </span>
                          </button>
                        ) : (
                          <>
                            {block.type === 'paragraph' && (
                              <ParagraphBlock
                                block={block}
                                documentId={documentId}
                                listNumber={numbers.get(block.id)}
                              />
                            )}
                            {block.type === 'heading' && <HeadingBlock block={block} />}
                            {block.type === 'divider' && <DividerBlock />}
                            {block.type === 'code' &&
                              (isDiagramBlock(block) ? (
                                <DiagramBlock block={block} />
                              ) : isFigureBlock(block) ? (
                                <FigureBlock block={block} number={figures.get(block.id)} />
                              ) : (
                                <CodeBlock block={block} />
                              ))}
                          </>
                        )}
                      </div>
                    </div>
                    {onBlock.map((change) => (
                      <ChangeCard key={change.id} change={change} />
                    ))}
                    {askAi.target?.anchorId === block.id && (
                      <AskAiPanel key={askAi.target.key} target={askAi.target} onClose={askAi.close} />
                    )}
                  </Fragment>
                );
              })}
              {/* Where a dragged block would land (see useBlockDrag). */}
              <div ref={dropLineRef} aria-hidden="true" className="block-drop-line" hidden />
              <ReorderMotion order={order} containerRef={containerRef} landedRef={landedRef} />
            </div>
        )}

        {/* Only genuine orphans reach here — a change whose block is in neither
            the document nor the batch. They are labelled, because a suggestion
            appearing under the last paragraph with no explanation is exactly
            what made the review look unsorted. */}
        {orphans.length > 0 && (
          <section
            aria-label="Suggestions with no place in the document"
            className="mt-6 border-t border-border/60 pt-3"
          >
            <p className="mb-1 text-xs text-muted-foreground">
              {orphans.length === 1 ? 'This suggestion refers' : 'These suggestions refer'} to a block
              that is no longer in the document.
            </p>
            {orphans.map((change) => (
              <ChangeCard key={change.id} change={change} />
            ))}
          </section>
        )}

        {/* Below the last block, where a paper's bibliography sits. It
            renders nothing until something is cited. */}
        <ReferencesSection />

        {/* The rest of the page is somewhere to keep writing: a click below
            the last block puts the caret in a trailing empty line, creating
            one if the page does not end with one. A block dragged over it
            goes to the end, and it leaves room for the last line to be
            written mid-screen. */}
        <div
          aria-hidden="true"
          className="relative min-h-[30vh] flex-1 cursor-text"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            continueAtEnd();
          }}
        />
      </div>

      {/* After the page in the DOM, first on screen (see DocumentOutline). */}
      <DocumentOutline blocks={blocks} scrollRef={containerRef} fullWidth={pageSettings.fullWidth} />
    </div>
  );
}
