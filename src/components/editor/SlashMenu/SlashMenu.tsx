import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { menuItem, menuLabel, menuSurface } from '@/components/ui/menuStyles';
import { blankBlockOfKind, useEditorActions, useEditorState } from '@/editor';
import { uid } from '@/lib/uid';
import { aiBeatItem } from './items/aiBeat';
import { askAiItem } from './items/askAi';
import { basicBlockItems } from './items/blocks';
import { tableItem } from './items/table';
import { citationItem } from './items/citation';
import { displayEquationItem, equationItem } from './items/equation';
import { graphItem } from './items/graph';
import { openInlineEditor } from './items/editInline';
import { serializeEditableHtml } from '../../common/Editable/editableHtml';
import { isEditableEmpty, restoreCaretOffset } from '../../common/Editable/caret';
import type { SlashContext, SlashItem } from './types';
import { Dot } from 'lucide-react';
import { SLASH_MENU_EVENT, emitSlashMenuVisibility } from './slashMenuEvents';

/** Notion's width; narrower screens get the viewport less its margins. */
const MENU_WIDTH = 324;
/** The list's ceiling: `min(448px, 45vh)`, but never so short it shows two rows. */
const LIST_MAX_HEIGHT = () => Math.min(448, Math.max(260, window.innerHeight * 0.45));
/** Footer height, for deciding whether the menu fits below the caret. */
const FOOTER_HEIGHT = 33;
/** Enough for about five rows: less than this below the caret, and it opens above. */
const MIN_LIST_HEIGHT = 260;
const VIEWPORT_MARGIN = 8;
/** Space between the caret line and the menu. */
const CARET_GAP = 6;
/** Characters past the last match after which the menu gives up and closes. */
const GIVE_UP_AFTER = 4;
const MAX_QUERY = 40;

type OpenDetail = { blockId: string };

/** Where the typed "/" sits: its text node and offset. */
type Trigger = { blockId: string; node: Text; offset: number };

const GROUPS = [
  { id: 'ai', label: 'AI' },
  { id: 'basic', label: 'Basic blocks' },
  { id: 'insert', label: 'Insert' },
] as const;

/** The scientific inserts lead their group: they are what a paper reaches for. */
const ITEMS: readonly SlashItem[] = [
  askAiItem,
  ...basicBlockItems,
  equationItem,
  displayEquationItem,
  citationItem,
  tableItem,
  graphItem,
  aiBeatItem,
];

/**
 * Where the menu sits: under the caret line, or — when the list would not fit
 * there — above it, pinned by its bottom edge so a short filtered list stays
 * next to the caret instead of floating a full menu-height away.
 */
type Placement = { left: number; top?: number; bottom?: number; maxHeight: number };

/**
 * How well an item answers `query`: a label that starts with it beats one
 * that merely contains it, which beats a keyword or description hit. Zero is
 * no match.
 */
function score(item: SlashItem, query: string): number {
  const label = item.label.toLowerCase();
  if (label.startsWith(query)) return 4;
  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 3;
  if ((item.keywords ?? []).some((keyword) => keyword.startsWith(query))) return 2;
  if (label.includes(query)) return 2;
  if ((item.keywords ?? []).some((keyword) => keyword.includes(query))) return 1;
  if ((item.desc ?? '').toLowerCase().includes(query)) return 1;
  return 0;
}

function rectOfTrigger(trigger: Trigger): DOMRect | null {
  try {
    const range = document.createRange();
    range.setStart(trigger.node, trigger.offset);
    range.setEnd(trigger.node, Math.min(trigger.node.data.length, trigger.offset + 1));
    const rect = (range.getClientRects()[0] as DOMRect | undefined) ?? range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) return null;
    return rect;
  } catch {
    return null;
  }
}

/**
 * The "/" command menu.
 *
 * The slash is typed into the text like any other character, and the menu
 * filters on what follows it — `/h2`, `/todo`, `/cite` — the way Notion's
 * does. Focus never leaves the paragraph: the list is announced through
 * `aria-activedescendant` on the editable, the arrow keys, Enter and Tab
 * drive it, and Escape closes it leaving the text as typed. Choosing an item
 * removes the `/query` and runs the command in its place.
 */
export function SlashMenu() {
  const { documentId, loadingDocumentId } = useEditorState();
  const {
    refs,
    updateHtml,
    addParagraphChild,
    removeParagraphChild,
    getBlock,
    setBlockKind,
    insertBlocksAfter,
    createRemote,
  } = useEditorActions();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<Placement>({ top: 0, left: 0, maxHeight: 320 });
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<Trigger | null>(null);
  /** Query length at the last moment something matched. */
  const lastMatchLength = useRef(0);
  const listboxId = useId();
  const ownerDocumentId = useRef(documentId);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ITEMS;
    return ITEMS.map((item) => ({ item, rank: score(item, q) }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .map((entry) => entry.item);
  }, [query]);

  // With a query the list is one ranked run; without one it reads by group.
  const ordered = useMemo(() => {
    if (query.trim()) return results;
    return GROUPS.flatMap((group) => results.filter((item) => item.group === group.id));
  }, [query, results]);

  const close = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger) {
      const editable = refs.current[trigger.blockId];
      editable?.removeAttribute('aria-activedescendant');
      editable?.removeAttribute('aria-controls');
    }
    triggerRef.current = null;
    setVisible(false);
  }, [refs]);

  useEffect(() => {
    if (ownerDocumentId.current === documentId) return;
    ownerDocumentId.current = documentId;
    close();
  }, [documentId, close]);

  const place = useCallback((trigger: Trigger) => {
    const rect = rectOfTrigger(trigger);
    if (!rect) return false;
    // Below the caret, shortened if need be, as long as a useful run of rows
    // fits there; above it only when the caret is near the bottom. Clamped to the viewport so the
    // menu is never partly off-screen near the edges.
    const wanted = LIST_MAX_HEIGHT();
    const below = window.innerHeight - rect.bottom - CARET_GAP - VIEWPORT_MARGIN - FOOTER_HEIGHT;
    const above = rect.top - CARET_GAP - VIEWPORT_MARGIN - FOOTER_HEIGHT;
    const width = Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN));
    if (below >= Math.min(wanted, MIN_LIST_HEIGHT) || below >= above) {
      setPos({ left, top: rect.bottom + CARET_GAP, maxHeight: Math.min(wanted, below) });
    } else {
      setPos({ left, bottom: window.innerHeight - rect.top + CARET_GAP, maxHeight: Math.min(wanted, above) });
    }
    return true;
  }, []);

  /** Read the query back from the text after the slash; close if it broke. */
  const sync = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const selection = document.getSelection();
    const { node, offset } = trigger;
    const intact = node.isConnected && node.data.charAt(offset) === '/';
    const caretInRun =
      !!selection &&
      selection.rangeCount > 0 &&
      selection.isCollapsed &&
      selection.anchorNode === node &&
      selection.anchorOffset > offset;
    if (!intact || !caretInRun) {
      close();
      return;
    }
    const next = node.data.slice(offset + 1, selection.anchorOffset);
    // A space straight after the slash, a new line or a runaway query means
    // the author was typing prose, not a command.
    if (/^\s/.test(next) || next.includes('\n') || next.length > MAX_QUERY) {
      close();
      return;
    }
    setQuery((previous) => {
      if (previous !== next) setActiveIndex(0);
      return next;
    });
  }, [close]);

  const openAtCaret = useCallback(
    (blockId: string) => {
      const editable = refs.current[blockId];
      const selection = document.getSelection();
      if (!editable || !selection || selection.rangeCount === 0) return;
      const { anchorNode, anchorOffset } = selection;
      if (!anchorNode || anchorNode.nodeType !== Node.TEXT_NODE || !editable.contains(anchorNode)) return;
      const node = anchorNode as Text;
      if (anchorOffset < 1 || node.data.charAt(anchorOffset - 1) !== '/') return;
      const trigger: Trigger = { blockId, node, offset: anchorOffset - 1 };
      if (!place(trigger)) return;
      triggerRef.current = trigger;
      lastMatchLength.current = 0;
      editable.setAttribute('aria-controls', listboxId);
      setQuery('');
      setActiveIndex(0);
      setVisible(true);
    },
    [listboxId, place, refs],
  );

  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<OpenDetail>).detail?.blockId;
      if (!id) return;
      if (getBlock(id)?.type !== 'paragraph') return;
      openAtCaret(id);
    };
    window.addEventListener(SLASH_MENU_EVENT, onOpen as EventListener);
    return () => window.removeEventListener(SLASH_MENU_EVENT, onOpen as EventListener);
  }, [getBlock, openAtCaret]);

  useEffect(() => {
    emitSlashMenuVisibility(visible);
  }, [visible]);

  // Give up on a query that has stopped matching anything for a while: the
  // author is writing "/" as text ("either/or", a path).
  useEffect(() => {
    if (!visible) return;
    if (ordered.length > 0) {
      lastMatchLength.current = query.length;
      return;
    }
    if (query.length - lastMatchLength.current >= GIVE_UP_AFTER) close();
  }, [visible, ordered.length, query, close]);

  // Keep the editable's active descendant pointing at the highlighted option.
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!visible || !trigger) return;
    const editable = refs.current[trigger.blockId];
    const active = ordered[activeIndex];
    if (active) editable?.setAttribute('aria-activedescendant', `${listboxId}-${active.id}`);
    else editable?.removeAttribute('aria-activedescendant');
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [visible, ordered, activeIndex, listboxId, refs]);

  const buildContext = useCallback(
    (blockId: string, insertionRange: Range): SlashContext => ({
      blockId,
      insertionRange,
      refs,
      updateHtml: (id) => {
        const el = refs.current[id];
        if (el) updateHtml(id, serializeEditableHtml(el));
      },
      addParagraphChild,
      editInline: (childId, isEmpty) =>
        openInlineEditor({
          blockId,
          childId,
          isEmpty,
          refs,
          getBlock,
          removeParagraphChild,
          updateHtml,
        }),
      applyKind: (kind) => {
        const editable = refs.current[blockId];
        const html = editable ? serializeEditableHtml(editable) : '';
        // The command was typed on an otherwise blank line: that line becomes
        // the block. With text beside the command, the block goes below.
        if (editable && isEditableEmpty(editable)) {
          setBlockKind(blockId, kind, { html });
          if (kind === 'divider') {
            const [next] = insertBlocksAfter(blockId, [blankBlockOfKind(uid(), 'text')]);
            return next ?? blockId;
          }
          return blockId;
        }
        if (editable) updateHtml(blockId, html);
        const [inserted] = insertBlocksAfter(blockId, [blankBlockOfKind(uid(), kind)]);
        return inserted ?? blockId;
      },
      focusBlock: (id) =>
        requestAnimationFrame(() => {
          const target = refs.current[id];
          if (!target) return;
          target.focus();
          restoreCaretOffset(target, Number.MAX_SAFE_INTEGER);
        }),
      documentId,
      createRemote: () => createRemote(),
    }),
    [
      refs,
      updateHtml,
      addParagraphChild,
      removeParagraphChild,
      getBlock,
      setBlockKind,
      insertBlocksAfter,
      documentId,
      createRemote,
    ],
  );

  const handleSelect = useCallback(
    (item: SlashItem) => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const selection = document.getSelection();
      const end =
        selection && selection.anchorNode === trigger.node
          ? Math.max(trigger.offset + 1, selection.anchorOffset)
          : trigger.offset + 1 + query.length;
      close();
      if (!trigger.node.isConnected) return;
      // Remove the typed "/query"; the command acts where it stood.
      const range = document.createRange();
      range.setStart(trigger.node, trigger.offset);
      range.setEnd(trigger.node, Math.min(trigger.node.data.length, end));
      range.deleteContents();
      range.collapse(true);
      const editable = refs.current[trigger.blockId];
      if (editable) {
        editable.focus({ preventScroll: true });
        const live = document.getSelection();
        live?.removeAllRanges();
        live?.addRange(range.cloneRange());
      }
      void item.onSelect(buildContext(trigger.blockId, range));
    },
    [buildContext, close, query.length, refs],
  );

  useEffect(() => {
    if (!visible) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (rootRef.current?.contains(target ?? null)) return;
      close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          close();
          break;
        case 'ArrowDown':
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex((i) => (ordered.length ? (i + 1) % ordered.length : 0));
          break;
        case 'ArrowUp':
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex((i) => (ordered.length ? (i - 1 + ordered.length) % ordered.length : 0));
          break;
        case 'Enter':
        case 'Tab': {
          const item = ordered[activeIndex];
          if (!item) {
            // Nothing to choose: let Enter be Enter.
            close();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          handleSelect(item);
          break;
        }
      }
    };

    const onInput = () => queueMicrotask(sync);
    const onSelectionChange = () => sync();

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keyup', onInput, true);
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keyup', onInput, true);
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('resize', close);
    };
  }, [visible, ordered, activeIndex, handleSelect, close, sync]);

  useEffect(() => () => { triggerRef.current = null; }, []);

  if (!visible || Boolean(loadingDocumentId)) return null;

  const grouped = !query.trim();
  const sections = grouped
    ? GROUPS.map((group) => ({ ...group, items: ordered.filter((item) => item.group === group.id) }))
    : [{ id: 'results', label: 'Results', items: ordered }];

  return (
    <div
      ref={rootRef}
      className={cn(
        'slash-menu fixed flex w-[324px] max-w-[calc(100vw-16px)] flex-col overflow-hidden',
        menuSurface,
        'p-0 animate-in fade-in-0 zoom-in-95 duration-100 z-[var(--z-popover)]',
      )}
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
      // Keep the caret in the paragraph: a click on the menu is a choice,
      // not a move of focus.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label="Commands"
        className="overflow-y-auto overscroll-contain p-1.5"
        style={{ maxHeight: pos.maxHeight }}
      >
        {sections.map((section) => {
          if (section.items.length === 0) return null;
          return (
            <div key={section.id} role="group" aria-label={section.label}>
              {/* A ranked run of matches needs no heading: the typed query is it. */}
              {grouped && <div className={cn(menuLabel, 'first:pt-1')}>{section.label}</div>}
              {section.items.map((item) => {
                const index = ordered.indexOf(item);
                const isActive = index === activeIndex;
                return (
                  <div
                    key={item.id}
                    id={`${listboxId}-${item.id}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    data-highlighted={isActive ? '' : undefined}
                    // The pointer moves the highlight, so hover itself paints nothing:
                    // two lit rows would disagree about what Enter picks.
                    className={cn(menuItem, 'gap-2.5 py-1 hover:bg-transparent')}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      handleSelect(item);
                    }}
                    onMouseMove={() => {
                      if (!isActive) setActiveIndex(index);
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background',
                        item.ai ? 'text-ai' : 'text-foreground/80',
                      )}
                    >
                      {item.icon ? <item.icon className="!size-5" /> : <Dot className="!size-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm leading-5">{item.label}</span>
                      {item.desc && (
                        <span className="block truncate text-xs leading-4 text-muted-foreground">{item.desc}</span>
                      )}
                    </span>
                    {item.hint && (
                      <span className="shrink-0 pl-2 font-mono text-xs text-muted-foreground">{item.hint}</span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {ordered.length === 0 && (
          <div role="presentation" className="px-2 py-2">
            <p className="text-sm text-muted-foreground">No results for “{query.trim()}”</p>
            {/* The only line that says what to type instead, so it is text,
                not a placeholder-grey hint (that was 2.8:1 on white). */}
            <p className="mt-0.5 text-xs text-muted-foreground">
              Try heading, list, to-do, quote, code, table, citation or equation.
            </p>
          </div>
        )}
      </div>

      <div
        aria-hidden="true"
        className="flex h-[33px] shrink-0 items-center gap-3 border-t border-border px-3 text-xs text-muted-foreground"
      >
        <span className="min-w-0 truncate">
          {query ? <>Filtering “/{query}”</> : 'Type to filter'}
        </span>
        {/* Key hints mean nothing on a touch screen; there the footer is
            just "Type to filter". */}
        <span className="ml-auto flex shrink-0 items-center gap-3 pointer-coarse:hidden">
          <span>↑↓ to navigate</span>
          <span>esc to close</span>
        </span>
      </div>
    </div>
  );
}
