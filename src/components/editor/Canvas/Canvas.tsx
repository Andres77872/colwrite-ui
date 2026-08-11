import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { BrandMark, APP_NAME, APP_TAGLINE } from '@/components/common/Brand';
import { BLOCK_TYPES, blockTypeLabel, useEditor, type Block, type Doc } from '@/editor';
import { uid } from '@/lib/uid';
import { DocumentHeader } from '../DocumentChrome';
import { BlockControls } from '../BlockControls';
import { ParagraphBlock } from '../blocks/ParagraphBlock';
import { HeadingBlock } from '../blocks/HeadingBlock';
import { DividerBlock } from '../blocks/DividerBlock';
import { ChangeCard, ReviewBar } from '../Review';
import { ReferencesSection } from '../References';
import { useProposals } from '@/editor/proposalsContextState';
import { documentChanges, projectDocument } from '@/editor/proposals';
import { ChevronRight, FileText, Plus, Sparkles } from 'lucide-react';

const BLOCK_DRAG_TYPE = 'application/x-block-id';

/** Plain-text preview of a collapsed block's content. */
function previewText(block: Block, maxChars = 60): string {
  const html = 'html' in block ? block.html : '';
  const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/* ----------------------------------------
   Bottom "add a block" affordance
   ---------------------------------------- */

function AddBlockBar({
  onAdd,
  isDropTarget,
  onDragOver,
}: {
  onAdd: (type: Block['type']) => void;
  isDropTarget: boolean;
  onDragOver: (event: DragEvent) => void;
}) {
  return (
    <div
      className={cn(
        'relative py-4',
        // Drop indicator for appending past the last block.
        isDropTarget &&
          "before:absolute before:inset-x-0 before:top-2 before:h-0.5 before:rounded-full before:bg-primary before:content-['']",
      )}
      style={{ paddingLeft: 'var(--doc-gutter)' }}
      onDragOver={onDragOver}
    >
      {/* Radix supplies the keyboard handling, focus return and outside-click
          dismissal that the previous hand-rolled menu attempted with a
          `useState` initialiser that never cleaned up its listener. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Plus className="h-4 w-4" />
            Add a block
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {BLOCK_TYPES.map(({ type, label, icon: Icon }) => (
            <DropdownMenuItem key={type} onSelect={() => onAdd(type)}>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
    <div className="flex justify-center px-4 pb-4 pt-12">
      <div className="w-full max-w-[42rem] rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <BrandMark size="lg" />
          <div>
            <p className="text-xl font-semibold">{APP_NAME}</p>
            <p className="text-sm text-muted-foreground">{APP_TAGLINE}</p>
          </div>
        </div>

        <p className="mt-5 text-md leading-relaxed">
          Create your first document to get started. ColWrite pairs a clean writing canvas with an
          AI assistant and quick insert commands.
        </p>

        <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
          {[
            'Block-based editor with “/” commands',
            'Inline assistant for outlines, rewrites and summaries',
            'Citations, equations and simple graphs',
            'Autosave with versioned remote storage',
          ].map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <Sparkles aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={onCreateIntro} disabled={creating}>
            {creating && <Spinner />}
            {creating ? 'Creating…' : 'Create your first document'}
          </Button>
          <Button variant="outline" onClick={onCreateBlank} disabled={creating}>
            Start blank
          </Button>
        </div>
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
    addBlockAfter,
    refs,
    updateHtml,
    documentId,
    createRemote,
    setFromJSON,
    toggleCollapsed,
    hasAnyRemoteDocs,
    recentlyChanged,
  } = useEditor();
  const { sets } = useProposals();
  const { toast } = useToast();

  // The document with every pending change folded into it at the position it
  // would take. One projection drives the whole canvas, so what the author
  // reads top to bottom is what `Accept all` produces — including chained
  // inserts, which used to pile up at the bottom of the page claiming their
  // block had been deleted.
  //
  // The canvas re-renders for reasons that change none of the inputs — drag
  // indicators, the creating spinner — so each projection is memoized on what
  // it actually reads instead of being recomputed on every render.
  const docLevelChanges = useMemo(() => documentChanges(sets), [sets]);
  const { rows, orphans } = useMemo(() => projectDocument(blocks, sets), [blocks, sets]);
  // Drag-and-drop measures `.block-row` elements, which proposals are not, so
  // the drop indicator keeps indexing the real block list.
  const blockIndex = useMemo(
    () => new Map(blocks.map((block, index) => [block.id, index])),
    [blocks],
  );
  // Blocks an addition is attached to. Without this a stack of proposed
  // paragraphs has no visible relationship to the paragraph it was written
  // against, which is the last place the review still read as a separate layer.
  const anchoring = useMemo(
    () =>
      new Set(
        rows.flatMap((row) =>
          row.kind === 'insert' && row.change.anchorBlockId ? [row.change.anchorBlockId] : [],
        ),
      ),
    [rows],
  );

  // A single insertion index drives every drop indicator. The previous version
  // also tracked `overId`/`overPos` and rendered a second indicator from them,
  // so two lines could appear at once during a drag.
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const showWelcome = hasAnyRemoteDocs === false && !documentId;
  const isCheckingDocs = hasAnyRemoteDocs === null && !documentId;
  const isEmpty = blocks.length === 0;

  const clearDnd = useCallback(() => setInsertIndex(null), [setInsertIndex]);

  const isBlockDrag = (event: DragEvent) =>
    Array.from(event.dataTransfer.types || []).includes(BLOCK_DRAG_TYPE);

  const updateIndicatorFromPoint = useCallback((y: number) => {
    const root = containerRef.current;
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLDivElement>('.block-row'));
    if (rows.length === 0) return;

    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (y < rect.top) {
        setInsertIndex(i);
        return;
      }
      if (y <= rect.bottom) {
        setInsertIndex(y < rect.top + rect.height / 2 ? i : i + 1);
        return;
      }
    }
    setInsertIndex(rows.length);
  }, [setInsertIndex]);

  const focusBlock = (id: string) => queueMicrotask(() => refs.current[id]?.focus());

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
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
      onDragEnd={clearDnd}
      onDragLeave={(event) => {
        // Only clear when the pointer actually leaves the canvas, not when it
        // crosses between child rows.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearDnd();
      }}
      onDragOverCapture={(event) => {
        if (!isBlockDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        updateIndicatorFromPoint(event.clientY);
      }}
      onDropCapture={(event) => {
        // Only block drags are intercepted here — swallowing any other
        // payload kills native drag-to-move for selected text. `types`
        // identifies the drag even where `getData` is still empty mid-drag.
        if (!isBlockDrag(event)) return;
        event.preventDefault();
        const fromId =
          event.dataTransfer.getData(BLOCK_DRAG_TYPE) || event.dataTransfer.getData('text/plain');
        if (fromId && insertIndex !== null) {
          const fromIndex = blocks.findIndex((b) => b.id === fromId);
          if (fromIndex !== -1) {
            // Removing the dragged block first shifts every later target down one.
            const targetIndex = fromIndex < insertIndex ? insertIndex - 1 : insertIndex;
            if (fromIndex !== targetIndex) reorderBlock(fromId, targetIndex);
          }
        }
        clearDnd();
      }}
    >
      {/* Full-bleed chrome, matching the status footer, with the writing
          surface below it held to a comfortable measure.

          One sticky wrapper, not two sticky siblings: both pinned to `top: 0`
          independently, so the review bar landed on top of the title, save
          status and Delete whenever there were changes to review. Stacking them
          in a single stop also survives the header wrapping onto two lines,
          which a hardcoded `top` offset would not. */}
      <div className="sticky top-0 z-[var(--z-chrome)]">
        <DocumentHeader />
        <ReviewBar />
      </div>

      <div className="document-container mx-auto w-full max-w-[var(--doc-measure)] flex-1 px-4">
        {docLevelChanges.map((change) => (
          <ChangeCard key={change.id} change={change} />
        ))}

        {isEmpty ? (
          <EmptyState
            size="page"
            icon={FileText}
            title="Start writing"
            description="Add your first block to begin, or press “/” inside a paragraph to open the command menu."
            action={
              <>
                <Button
                  onClick={() => {
                    const id = addBlockAtStart('paragraph');
                    focusBlock(id);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  New text block
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const id = addBlockAtStart('heading');
                    focusBlock(id);
                  }}
                >
                  Add heading
                </Button>
              </>
            }
          />
        ) : (
          <>
            <div className="blocks-container space-y-0.5 py-4">
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
                const hasProposal = onBlock.length > 0 || anchoring.has(block.id);

                return (
                  <Fragment key={block.id}>
                    {insertIndex === index && (
                      <div
                        aria-hidden="true"
                        className="my-1 h-0.5 rounded-full bg-primary"
                        style={{ marginLeft: 'var(--doc-gutter)' }}
                      />
                    )}
                    <div
                      className={cn(
                        'block-row group relative rounded-sm py-1 pr-2 transition-colors duration-75',
                        // Three channels, one per kind of state, in this
                        // precedence. A row used to be able to carry ten
                        // overlapping washes — hover, active, focused,
                        // collapsed, hidden, locked and four proposal states —
                        // several of which combined, two of which sat five
                        // percent apart on the same hue, and one of which
                        // silently suppressed another.
                        //
                        // 1. TINT — where the caret is, and nothing else.
                        //    Hover stays a step below it: it is a pointer
                        //    affordance for the gutter controls, not state.
                        'hover:bg-accent/15',
                        block.id === activeId && 'bg-primary/10',
                        // 2. GUTTER MARKS — the author's own decisions about
                        //    the block (locked, hidden, collapsed) are drawn by
                        //    `BlockControls`, so they can co-occur and none of
                        //    them has to outbid a tint to be seen.
                        //
                        // 3. DIFF TREATMENT — what the assistant wants to do,
                        //    on the text itself. A deletion strikes the real
                        //    text through and a rewrite steps back so the
                        //    replacement below reads as the new version.
                        hasProposal && 'ring-1 ring-primary/25',
                        pendingDelete && 'bg-diff-remove/20 ring-diff-remove-border/40 line-through decoration-diff-remove-border/70',
                        pendingRewrite && !pendingDelete && 'opacity-60',
                        recentlyChanged.has(block.id) && 'bg-diff-add',
                      )}
                      style={{ paddingLeft: 'var(--doc-gutter)' }}
                      data-block-id={block.id}
                      onClick={() => setActive(block.id)}
                    >
                      <BlockControls id={block.id} />

                      <div className="block-content min-h-[1.5rem] w-full">
                        {isCollapsed ? (
                          <button
                            type="button"
                            // Collapsed rows looked clickable but had no handler,
                            // so a collapsed block could only be reopened through
                            // the gutter menu.
                            onClick={() => toggleCollapsed(block.id)}
                            aria-expanded={false}
                            className="inline-flex max-w-full items-center gap-2 rounded-sm border border-border/50 bg-card/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0" />
                            <span className="font-medium text-foreground/80">
                              {blockTypeLabel(block.type)}
                            </span>
                            <span className="truncate opacity-60">{previewText(block)}</span>
                          </button>
                        ) : (
                          <>
                            {block.type === 'paragraph' && <ParagraphBlock block={block} documentId={documentId} />}
                            {block.type === 'heading' && <HeadingBlock block={block} />}
                            {block.type === 'divider' && <DividerBlock />}
                          </>
                        )}
                      </div>
                    </div>
                    {onBlock.map((change) => (
                      <ChangeCard key={change.id} change={change} />
                    ))}
                  </Fragment>
                );
              })}
            </div>

            <AddBlockBar
              isDropTarget={insertIndex === blocks.length}
              onAdd={(type) => {
                const id = addBlockAfter(blocks[blocks.length - 1].id, type);
                focusBlock(id);
              }}
              onDragOver={(event) => {
                if (!isBlockDrag(event)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setInsertIndex(blocks.length);
              }}
            />
          </>
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
            <p className="mb-1 text-xs text-muted-foreground" style={{ paddingLeft: 'var(--doc-gutter)' }}>
              {orphans.length === 1 ? 'This suggestion refers' : 'These suggestions refer'} to a block
              that is no longer in the document.
            </p>
            {orphans.map((change) => (
              <ChangeCard key={change.id} change={change} />
            ))}
          </section>
        )}

        {/* Below the last block and the add-block affordance, where a paper's
            bibliography sits. It renders nothing until something is cited. */}
        <ReferencesSection />


        {/* Trailing space so the last block can scroll clear of the footer. */}
        <div aria-hidden="true" className="h-32" />
      </div>
    </div>
  );
}
