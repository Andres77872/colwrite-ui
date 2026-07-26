import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useEditor } from '@/editor';
import { aiBeatItem } from './items/aiBeat';
import { tableItem } from './items/table';
import { citationItem } from './items/citation';
import { displayEquationItem, equationItem } from './items/equation';
import { graphItem } from './items/graph';
import { serializeEditableHtml } from '../../common/Editable/Editable';
import type { SlashContext, SlashItem } from './types';
import { Search, SearchX } from 'lucide-react';

export const SLASH_MENU_EVENT = 'colwrite:open-slash-menu';
export const SLASH_MENU_VISIBILITY_EVENT = 'colwrite:slash-menu-visibility';

const MENU_WIDTH = 288;
const MENU_MAX_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;

let slashMenuOpen = false;
export function isSlashMenuOpen(): boolean {
  return slashMenuOpen;
}

type OpenDetail = { blockId: string };

function rangeBelongsTo(range: Range, editable: HTMLDivElement): boolean {
  return (
    range.startContainer.isConnected &&
    range.endContainer.isConnected &&
    editable.contains(range.startContainer) &&
    editable.contains(range.endContainer)
  );
}

function emitVisibility(visible: boolean) {
  window.dispatchEvent(
    new CustomEvent<{ visible: boolean }>(SLASH_MENU_VISIBILITY_EVENT, { detail: { visible } }),
  );
}

export function openSlashMenu(blockId: string) {
  window.dispatchEvent(new CustomEvent<OpenDetail>(SLASH_MENU_EVENT, { detail: { blockId } }));
  emitVisibility(true);
}

const GROUPS = [
  { id: 'basic', label: 'Basic blocks' },
  { id: 'actions', label: 'AI actions' },
  { id: 'insert', label: 'Insert' },
] as const;

const ITEMS: readonly SlashItem[] = [
  aiBeatItem,
  tableItem,
  graphItem,
  citationItem,
  equationItem,
  displayEquationItem,
];

export function SlashMenu() {
  const { refs, updateHtml, addParagraphChild, documentId, createRemote, blocks } = useEditor();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [blockId, setBlockId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const insertionRangeRef = useRef<Range | null>(null);
  const listboxId = useId();

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ITEMS;
    // An empty result set shows the empty state rather than silently falling
    // back to the full list, which made typos look like a broken filter.
    return ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) || (item.desc ?? '').toLowerCase().includes(q),
    );
  }, [query]);

  const zeroRect = (rect: DOMRect | undefined | null) =>
    !rect || (rect.width === 0 && rect.height === 0);

  const rectFromNode = (node: Node | null): DOMRect | null => {
    if (!node) return null;
    try {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const direct = el.getBoundingClientRect();
        if (!zeroRect(direct)) return direct;
        const range = document.createRange();
        range.selectNodeContents(el);
        const fromContents = range.getBoundingClientRect();
        return zeroRect(fromContents) ? null : fromContents;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        const range = document.createRange();
        range.selectNode(node);
        const rect = range.getBoundingClientRect();
        return zeroRect(rect) ? null : rect;
      }
    } catch {
      /* detached nodes have no geometry */
    }
    return null;
  };

  const restoreRange = useCallback(
    (id: string, range: Range) => {
      const editable = refs.current[id];
      if (!editable || !rangeBelongsTo(range, editable)) return;

      // Editable's focus handler moves programmatic focus to the end, so focus
      // first and then restore the exact range that opened the command menu.
      editable.focus({ preventScroll: true });
      const selection = document.getSelection();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
    },
    [refs],
  );

  const openAtCaret = useCallback(
    (id: string) => {
      // A later open must never reuse the bookmark from an earlier paragraph.
      insertionRangeRef.current = null;

      const editable = refs.current[id];
      const selection = document.getSelection();
      if (!editable || !selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      if (!rangeBelongsTo(range, editable)) return;

      let rect =
        (range.getClientRects()[0] as DOMRect | undefined) ?? range.getBoundingClientRect();
      if (zeroRect(rect)) {
        const start = range.startContainer;
        rect =
          rectFromNode(start) ??
          rectFromNode(start.previousSibling) ??
          rectFromNode(start.nextSibling) ??
          rect;
      }
      if (zeroRect(rect)) return;

      // Keep the insertion point before the search field takes focus. Firefox
      // moves document Selection to <body> when an input is focused, and other
      // browsers are not required to preserve a contenteditable selection.
      insertionRangeRef.current = range.cloneRange();

      // Flip above the caret when there is not enough room below, and clamp to
      // the viewport so the menu is never partly off-screen near the edges.
      const spaceBelow = window.innerHeight - rect.bottom;
      const top =
        spaceBelow < MENU_MAX_HEIGHT + VIEWPORT_MARGIN
          ? Math.max(VIEWPORT_MARGIN, rect.top - MENU_MAX_HEIGHT - VIEWPORT_MARGIN)
          : rect.bottom + VIEWPORT_MARGIN;
      const left = Math.min(rect.left, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN);

      setPos({ top, left: Math.max(VIEWPORT_MARGIN, left) });
      setBlockId(id);
      setQuery('');
      setActiveIndex(0);
      setVisible(true);
      queueMicrotask(() => inputRef.current?.focus());
    },
    [refs],
  );

  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<OpenDetail>).detail?.blockId;
      if (!id) return;
      const target = blocks.find((b) => b.id === id);
      if (target?.type !== 'paragraph') return;
      openAtCaret(id);
    };
    window.addEventListener(SLASH_MENU_EVENT, onOpen as EventListener);
    return () => window.removeEventListener(SLASH_MENU_EVENT, onOpen as EventListener);
  }, [blocks, openAtCaret]);

  useEffect(() => {
    slashMenuOpen = visible;
    emitVisibility(visible);
  }, [visible]);

  // Clamp the highlight when filtering shrinks the list under it.
  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filteredItems.length - 1)));
  }, [filteredItems.length]);

  const buildContext = useCallback(
    (insertionRange: Range): SlashContext => ({
      blockId: blockId!,
      insertionRange,
      refs,
      updateHtml: (id) => updateHtml(id, serializeEditableHtml(refs.current[id]!)),
      addParagraphChild,
      documentId,
      createRemote,
    }),
    [blockId, refs, updateHtml, addParagraphChild, documentId, createRemote],
  );

  const handleSelect = useCallback(
    (item: SlashItem) => {
      const insertionRange = insertionRangeRef.current?.cloneRange();
      insertionRangeRef.current = null;
      setVisible(false);
      if (!insertionRange || !blockId) return;
      item.onSelect(buildContext(insertionRange));
    },
    [blockId, buildContext],
  );

  useEffect(() => {
    if (!visible || !listRef.current) return;
    listRef.current.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, visible]);

  useEffect(() => {
    if (!visible) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (rootRef.current?.contains(target ?? null)) return;
      if (target?.closest('.floating-toolbar')) return;
      insertionRangeRef.current = null;
      setVisible(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          {
            const range = insertionRangeRef.current?.cloneRange();
            insertionRangeRef.current = null;
            setVisible(false);
            if (blockId && range) queueMicrotask(() => restoreRange(blockId, range));
          }
          break;
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex((i) => (filteredItems.length ? (i + 1) % filteredItems.length : 0));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex((i) =>
            filteredItems.length ? (i - 1 + filteredItems.length) % filteredItems.length : 0,
          );
          break;
        case 'Home':
          event.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setActiveIndex(Math.max(0, filteredItems.length - 1));
          break;
        case 'Enter': {
          event.preventDefault();
          const item = filteredItems[activeIndex];
          if (item) handleSelect(item);
          break;
        }
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [visible, filteredItems, activeIndex, handleSelect, blockId, restoreRange]);

  useEffect(
    () => () => {
      insertionRangeRef.current = null;
    },
    [],
  );

  if (!visible) return null;

  const activeItemId = filteredItems[activeIndex]
    ? `${listboxId}-${filteredItems[activeIndex].id}`
    : undefined;

  return (
    <div
      ref={rootRef}
      className={cn(
        'slash-menu fixed w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-xl',
        'animate-in fade-in-0 zoom-in-95 z-[var(--z-popover)]',
      )}
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-border bg-card/50 px-3 py-2.5">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-activedescendant={activeItemId}
          aria-autocomplete="list"
          aria-label="Search commands"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder="Search commands…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          // Navigation keys are owned by the document-level handler above.
          onKeyDown={(event) => {
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
            }
          }}
        />
      </div>

      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label="Commands"
        className="overflow-y-auto overscroll-contain p-1"
        style={{ maxHeight: MENU_MAX_HEIGHT }}
      >
        {GROUPS.map((group) => {
          const groupItems = filteredItems.filter((item) => (item.group ?? 'other') === group.id);
          if (groupItems.length === 0) return null;

          return (
            <div key={group.id} role="group" aria-label={group.label} className="py-1">
              <div className="px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </div>

              {groupItems.map((item) => {
                const index = filteredItems.indexOf(item);
                const isActive = index === activeIndex;

                return (
                  <div
                    key={item.id}
                    id={`${listboxId}-${item.id}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    className={cn(
                      'flex w-full cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-75',
                      isActive ? 'bg-accent' : 'hover:bg-accent/50',
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      handleSelect(item);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-base"
                    >
                      {item.icon || '•'}
                    </span>
                    <span className="min-w-0 flex-1 py-0.5">
                      <span className="block text-sm font-medium">{item.label}</span>
                      {item.desc && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.desc}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}

        {filteredItems.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
            <SearchX aria-hidden="true" className="h-4 w-4 text-muted-foreground/70" />
            <p className="text-sm text-muted-foreground">No commands match “{query.trim()}”</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border bg-card/30 px-3 py-2 text-2xs text-muted-foreground">
        <span>
          <kbd className="rounded-sm bg-secondary px-1 py-0.5">↑↓</kbd> Navigate
        </span>
        <span>
          <kbd className="rounded-sm bg-secondary px-1 py-0.5">↵</kbd> Select
        </span>
        <span>
          <kbd className="rounded-sm bg-secondary px-1 py-0.5">Esc</kbd> Close
        </span>
      </div>
    </div>
  );
}
