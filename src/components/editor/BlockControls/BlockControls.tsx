import { memo, useCallback, useEffect, useMemo, useRef, useState, type ElementType, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { lastInputWasPointer } from '@/lib/inputModality';
import { focusQuietly } from '@/components/ui/quietFocus';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { editedLabel } from '@/components/layout/editedLabel';
import {
  BLOCK_KINDS,
  TURN_INTO_KINDS,
  blankBlockOfKind,
  htmlToText,
  kindLabel,
  kindOf,
  useEditor,
  useEditorActions,
  type Block,
  type BlockKindId,
} from '@/editor';
import { blocksToMarkdown } from '@/editor/markdown';
import { uid } from '@/lib/uid';
import { useToast } from '@/components/ui/toastContext';
import { openAskAi } from '../AskAi/askAiEvents';
import { openSlashMenu } from '../SlashMenu/slashMenuEvents';
import { blockLink } from './blockLink';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Copy,
  CornerDownRight,
  CornerUpRight,
  Eye,
  EyeOff,
  GripVertical,
  Link2,
  Lock,
  MoreHorizontal,
  Plus,
  Repeat2,
  Sparkles,
  Trash2,
  Unlock,
} from 'lucide-react';

/**
 * Column and heading-level choices rendered as a segmented control.
 *
 * These are menu radio items, not raw buttons: the menu roves focus over its
 * own items and preventDefaults Tab, so anything else inside it is unreachable
 * by keyboard. Preventing the select default keeps the menu open between
 * picks, as the buttons behaved before.
 */
function SegmentedChoice<T extends number>({
  label,
  options,
  value,
  format,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  format: (option: T) => string;
  onChange: (option: T) => void;
}) {
  return (
    <div className="px-2 pb-1 pt-1.5">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <DropdownMenuRadioGroup
        role="group"
        aria-label={label}
        className="flex gap-0.5 rounded-md bg-subtle p-0.5"
        value={String(value)}
        onValueChange={(next) => onChange(Number(next) as T)}
      >
        {options.map((option) => (
          <DropdownMenuRadioItem
            key={option}
            value={String(option)}
            onSelect={(event) => event.preventDefault()}
            className={cn(
              'min-h-6 flex-1 justify-center px-0 py-0.5 text-xs font-medium text-muted-foreground',
              'data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm',
            )}
          >
            {format(option)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </div>
  );
}

const COLUMN_OPTIONS = [1, 2, 3, 4] as const;
const HEADING_LEVELS = [1, 2, 3] as const;

/** Only blocks with something to hide can be collapsed. */
function canCollapse(block: Block): boolean {
  return block.type !== 'divider';
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/**
 * The author's own decisions about a block, as gutter marks.
 *
 * These used to be washes of colour on the row itself, competing with the
 * caret tint, the hover tint and the assistant's diff tints for the same
 * channel — and `locked` was written as `isLocked && !isAiHidden`, so a block
 * that was both showed only one of them. A mark per decision reads at a glance
 * down the left edge, survives a block in three states at once, and leaves
 * tint to mean one thing.
 */
function BlockMarks({ block }: { block: Block }) {
  const marks = [
    block.locked === true && {
      key: 'locked',
      icon: Lock,
      label: 'Locked — the assistant cannot change this block, and it is not editable',
      className: 'text-block-locked',
    },
    block.aiHidden === true && {
      key: 'hidden',
      icon: EyeOff,
      label: 'Hidden from the assistant',
      className: 'text-block-hidden',
    },
    block.collapsed === true && {
      key: 'collapsed',
      icon: ChevronRight,
      label: 'Collapsed',
      className: 'text-muted-foreground',
    },
  ].filter((mark): mark is Exclude<typeof mark, false> => mark !== false);

  if (marks.length === 0) return null;

  return (
    <span
      // In the gutter, tucked against the text column, on the first line —
      // the controls take this space back on hover (globals.css). The options
      // menu names every one of these states in words while it is open.
      className="block-marks pointer-events-none flex h-6 items-center gap-0.5 pr-2 transition-opacity"
    >
      {marks.map(({ key, icon: Icon, label, className }) => (
        <Icon key={key} role="img" aria-label={label} className={cn('h-3.5 w-3.5', className)} />
      ))}
    </span>
  );
}

/**
 * BlockControls — the gutter affordances for one block, Notion-style.
 *
 * `+` adds a line below and opens the command menu on it (Alt-click adds it
 * above). `⋮⋮` is the block handle: press and drag to move the block, click
 * to open the block menu — Ask AI, Turn into, Duplicate, Copy link, Move,
 * Insert, the author's flags and Delete.
 *
 * The handle opens its menu on *click*, not on pointerdown: Radix's own
 * trigger opens on pointerdown and preventDefaults it, which is exactly what
 * stops the browser from starting a native drag. The menu is therefore
 * controlled and anchored to an inert trigger beside the handle.
 */
export const BlockControls = memo(function BlockControls({
  block,
  isFirst,
  isLast,
  menuOpen,
}: {
  block: Block;
  isFirst: boolean;
  isLast: boolean;
  /** Whether this block's menu is the open one (state lives in the editor). */
  menuOpen: boolean;
}) {
  const {
    duplicateBlock,
    insertBlocksAfter,
    insertBlockBeforeExact,
    moveBlock,
    refs,
    removeBlock,
    selectBlocks,
    setBlockKind,
    setBlockMenu,
    setHeadingLevel,
    setParagraphColumns,
    toggleAiHidden,
    toggleCollapsed,
    toggleLocked,
  } = useEditorActions();
  const { toast } = useToast();
  const id = block.id;
  const label = kindLabel(block);
  const current = kindOf(block);
  const locked = block.locked === true;
  const draggedRef = useRef(false);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  // Set when the menu closes because of a click or focus elsewhere: that
  // target keeps focus instead of the handle.
  const closedOutsideRef = useRef(false);
  const [menuSide, setMenuSide] = useState<'left' | 'right'>('left');

  const setOpen = useCallback(
    (open: boolean) => setBlockMenu(open ? id : null, open ? 'options' : null),
    [id, setBlockMenu],
  );

  const focusBlock = useCallback((target: string, end = true) => {
    requestAnimationFrame(() => {
      const el = refs.current[target];
      if (!el) return;
      el.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(!end);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }, [refs]);

  const insert = useCallback(
    (where: 'before' | 'after', kind: BlockKindId, withMenu = false) => {
      const fresh = blankBlockOfKind(uid(), kind);
      if (where === 'after') insertBlocksAfter(id, [fresh]);
      else insertBlockBeforeExact(id, fresh);
      requestAnimationFrame(() => {
        const el = refs.current[fresh.id];
        if (!el) return;
        el.focus();
        if (!withMenu) return;
        // "+" behaves as if "/" had been typed on the new line.
        el.textContent = '/';
        const range = document.createRange();
        range.setStart(el.firstChild ?? el, 1);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
        openSlashMenu(fresh.id);
      });
    },
    [id, insertBlocksAfter, insertBlockBeforeExact, refs],
  );

  const copyText = useCallback(
    async (text: string, what: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast({ title: `${what} copied` });
      } catch {
        toast({ title: `Could not copy the ${what.toLowerCase()}`, variant: 'error' });
      }
    },
    [toast],
  );

  const alt = MOD === '⌘' ? '⌥' : 'Alt-';

  /**
   * Every command as data, so the search field can filter them. The menu
   * renders the groups when the query is empty and a flat list of matches
   * when it is not — the way Notion's block menu narrows as you type.
   */
  const actions = useMemo<MenuAction[]>(() => {
    const list: MenuAction[] = [
      { id: 'duplicate', group: 'edit', label: 'Duplicate', icon: Copy, shortcut: `${MOD}D`, onSelect: () => duplicateBlock(id) },
      { id: 'link', group: 'edit', label: 'Copy link to block', icon: Link2, onSelect: () => void copyText(blockLink(id), 'Link to block') },
      { id: 'up', group: 'move', label: 'Move up', icon: ArrowUp, shortcut: `${MOD}⇧↑`, disabled: isFirst || locked, onSelect: () => moveBlock(id, -1) },
      { id: 'down', group: 'move', label: 'Move down', icon: ArrowDown, shortcut: `${MOD}⇧↓`, disabled: isLast || locked, onSelect: () => moveBlock(id, 1) },
      { id: 'ai', group: 'ai', label: 'Ask AI', icon: Sparkles, shortcut: `${MOD}J`, disabled: locked, className: 'text-ai [&>svg]:text-ai', onSelect: () => openAskAi({ blockId: id }) },
      { id: 'hide', group: 'flags', label: block.aiHidden ? 'Show to assistant' : 'Hide from assistant', icon: block.aiHidden ? Eye : EyeOff, keywords: 'ai private', onSelect: () => toggleAiHidden(id) },
      { id: 'lock', group: 'flags', label: block.locked ? 'Unlock block' : 'Lock block', icon: block.locked ? Unlock : Lock, keywords: 'protect', onSelect: () => toggleLocked(id) },
      { id: 'markdown', group: 'more', label: 'Copy as Markdown', icon: ClipboardCopy, keywords: 'md', onSelect: () => void copyText(blocksToMarkdown([block]), 'Markdown') },
    ];
    if (canCollapse(block)) {
      list.push({ id: 'collapse', group: 'more', label: block.collapsed ? 'Expand' : 'Collapse', icon: block.collapsed ? ChevronDown : ChevronRight, keywords: 'fold', onSelect: () => toggleCollapsed(id) });
    }
    list.push({ id: 'delete', group: 'delete', label: 'Delete', icon: Trash2, shortcut: 'Del', disabled: locked, destructive: true, keywords: 'remove', onSelect: () => removeBlock(id) });
    return list;
  }, [block, copyText, duplicateBlock, id, isFirst, isLast, locked, moveBlock, removeBlock, toggleAiHidden, toggleCollapsed, toggleLocked]);

  const [query, setQuery] = useState('');
  const [handleTip, setHandleTip] = useState(false);
  // Closing the menu hands focus back to the handle; that focus must not pop
  // the handle's tooltip up in place of the menu that just closed.
  const menuClosedAt = useRef(-Infinity);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // The search field takes the keyboard as the menu opens, as in Notion; it
  // starts empty every time.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (menuOpen) searchRef.current?.focus();
      else setQuery('');
    });
    return () => cancelAnimationFrame(frame);
  }, [menuOpen]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    const turnInto: MenuAction[] =
      block.type === 'divider' || locked
        ? []
        : TURN_INTO_KINDS.filter((kind) => kind.id !== current).map((kind) => ({
            id: `turn-${kind.id}`,
            group: 'turn',
            label: `Turn into ${kind.label}`,
            icon: kind.icon,
            onSelect: () => {
              setBlockKind(id, kind.id);
              focusBlock(id);
            },
          }));
    return [...actions, ...turnInto].filter((action) =>
      `${action.label} ${action.keywords ?? ''}`.toLowerCase().includes(needle),
    );
  }, [actions, block.type, current, focusBlock, id, locked, query, setBlockKind]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const items = () =>
      Array.from(
        contentRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])') ?? [],
      );
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items()[0]?.focus();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (query.trim()) items()[0]?.click();
      return;
    }
    // Escape closes the menu; every other key is typing, not the menu's
    // type-to-select.
    if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
  };

  const renderAction = (action: MenuAction) => (
    <DropdownMenuItem
      key={action.id}
      disabled={action.disabled}
      destructive={action.destructive}
      className={action.className}
      onSelect={action.onSelect}
    >
      <action.icon />
      {action.label}
      {action.shortcut && <DropdownMenuShortcut>{action.shortcut}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  );
  const group = (name: MenuAction['group']) => actions.filter((action) => action.group === name).map(renderAction);

  return (
    <>
      <BlockMarks block={block} />
      <TooltipProvider delayDuration={300} skipDelayDuration={200}>
      <div
        // Positioned and revealed by globals.css: outside the text box, on
        // the first line of the block, on row hover or keyboard focus.
        className="block-controls flex items-center gap-px pr-1"
        data-open={menuOpen || undefined}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                'block-add flex h-6 w-6 items-center justify-center rounded-sm text-icon-tertiary transition-colors hover:bg-hover hover:text-muted-foreground',
                // A phone has 20px of margin: the handle alone.
                '@max-[600px]/canvas:hidden',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              aria-label="Add a block below"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => insert(event.altKey ? 'before' : 'after', 'text', true)}
            >
              <Plus aria-hidden="true" className="h-[18px] w-[18px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <HandleTip first="Click to add below" second={`${alt}click to add above`} />
          </TooltipContent>
        </Tooltip>

        <DropdownMenu open={menuOpen} onOpenChange={setOpen} modal={false}>
          {/* Inert anchor for positioning; the handle below opens the menu. */}
          <DropdownMenuTrigger asChild disabled>
            <span aria-hidden="true" className="pointer-events-none absolute right-1 top-0 h-6 w-[18px]" tabIndex={-1} />
          </DropdownMenuTrigger>
          <Tooltip
            open={handleTip && !menuOpen}
            onOpenChange={(open) => {
              if (open && performance.now() - menuClosedAt.current < 400) return;
              setHandleTip(open);
            }}
          >
            <TooltipTrigger asChild>
              <button
                ref={handleRef}
                type="button"
                className={cn(
                  'flex h-6 w-[18px] items-center justify-center rounded-sm text-icon-tertiary transition-colors hover:bg-hover hover:text-muted-foreground',
                  locked ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  menuOpen && 'bg-hover text-muted-foreground',
                )}
                aria-label={
                  locked
                    ? `${label} block, locked: click for options`
                    : `${label} block: drag to move, click for options`
                }
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                // A locked block stays put, as Move up/down and ⌘⇧↑/↓ already
                // make it.
                draggable={!locked}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  draggedRef.current = false;
                }}
                onDragStart={(event) => {
                  draggedRef.current = true;
                  event.dataTransfer.setData('text/plain', id);
                  event.dataTransfer.setData('application/x-block-id', id);
                  event.dataTransfer.effectAllowed = 'move';
                  setBlockMenu(null, null);
                }}
                onClick={(event) => {
                  if (draggedRef.current) return;
                  // Shift+click selects the block instead, joining a selection.
                  if (event.shiftKey) {
                    selectBlocks([id]);
                    return;
                  }
                  setMenuSide(event.clientX < 260 ? 'right' : 'left');
                  setOpen(!menuOpen);
                }}
              >
                <GripVertical aria-hidden="true" className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <HandleTip first={locked ? 'Locked in place' : 'Drag to move'} second="Click to open menu" />
            </TooltipContent>
          </Tooltip>

          <DropdownMenuContent
            ref={contentRef}
            side={menuSide}
            align="start"
            sideOffset={6}
            // Never flush against the window edge, and scrolls rather than
            // running off a short screen.
            collisionPadding={8}
            className="flex max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 flex-col p-0"
            onInteractOutside={() => {
              closedOutsideRef.current = true;
            }}
            // The Radix trigger is the inert positioning span above, which is
            // aria-hidden and does nothing on Enter; returning focus there
            // stranded keyboard users. Close to the visible handle instead,
            // unless an action (or an outside click) already moved focus on.
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              menuClosedAt.current = performance.now();
              const outside = closedOutsideRef.current;
              closedOutsideRef.current = false;
              if (outside) return;
              const active = document.activeElement;
              if (active && active !== document.body && active.isConnected) return;
              const handle = handleRef.current;
              if (!handle?.isConnected) return;
              if (lastInputWasPointer()) focusQuietly(handle);
              else handle.focus({ preventScroll: true });
            }}
          >
            <div className="shrink-0 p-1.5 pb-1">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search actions…"
                aria-label="Search actions"
                autoComplete="off"
                spellCheck={false}
                className="h-7 w-full rounded-md bg-subtle px-2 text-sm text-foreground shadow-[inset_0_0_0_1px_var(--color-border)] outline-none placeholder:text-placeholder focus-visible:shadow-[inset_0_0_0_1px_var(--color-ring)]"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1">
              {matches ? (
                matches.length > 0 ? (
                  matches.map(renderAction)
                ) : (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">No matching actions</p>
                )
              ) : (
                <>
                  <DropdownMenuGroup>
                    {block.type !== 'divider' && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger disabled={locked}>
                          <Repeat2 />
                          Turn into
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-56">
                          {TURN_INTO_KINDS.map((kind) => (
                            <DropdownMenuItem
                              key={kind.id}
                              onSelect={() => {
                                setBlockKind(id, kind.id);
                                focusBlock(id);
                              }}
                            >
                              <kind.icon />
                              {kind.label}
                              {current === kind.id && <Check aria-hidden="true" className="ml-auto" />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    {group('edit')}
                  </DropdownMenuGroup>

                  <DropdownMenuSeparator />

                  <DropdownMenuGroup>
                    {/* Drag reorder is pointer-only; these are the same move for the
                        keyboard. Disabled at the edges, where there is nowhere to go. */}
                    {group('move')}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <CornerDownRight />
                        Insert below
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-56">
                        {BLOCK_KINDS.map((kind) => (
                          <DropdownMenuItem key={`after-${kind.id}`} onSelect={() => insert('after', kind.id)}>
                            <kind.icon />
                            {kind.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuGroup>

                  <DropdownMenuSeparator />
                  {group('ai')}

                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    {group('flags')}
                    {/* Set once in a while — insert above (⌥-click on + does the
                        same), Markdown, collapse, columns or level (Turn into
                        also sets the level): behind one row, so the menu
                        stays short enough for a laptop screen. */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <MoreHorizontal />
                        More
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-56">
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <CornerUpRight />
                            Insert above
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-56">
                            {BLOCK_KINDS.map((kind) => (
                              <DropdownMenuItem key={`before-${kind.id}`} onSelect={() => insert('before', kind.id)}>
                                <kind.icon />
                                {kind.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        {group('more')}
                        {block.type === 'paragraph' && !block.variant && (
                          <>
                            <DropdownMenuSeparator />
                            <SegmentedChoice
                              label="Columns"
                              options={COLUMN_OPTIONS}
                              value={(block.columns ?? 1) as (typeof COLUMN_OPTIONS)[number]}
                              format={(n) => String(n)}
                              onChange={(n) => setParagraphColumns(id, n)}
                            />
                          </>
                        )}

                        {block.type === 'heading' && (
                          <>
                            <DropdownMenuSeparator />
                            <SegmentedChoice
                              label="Level"
                              options={HEADING_LEVELS}
                              value={(block.level ?? 2) as (typeof HEADING_LEVELS)[number]}
                              format={(n) => `H${n}`}
                              onChange={(n) => setHeadingLevel(id, n)}
                            />
                          </>
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuGroup>

                  <DropdownMenuSeparator />
                  {group('delete')}
                </>
              )}
            </div>

            <MenuFooter block={block} label={label} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </TooltipProvider>
    </>
  );
});

type MenuAction = {
  id: string;
  group: 'edit' | 'move' | 'ai' | 'flags' | 'more' | 'delete' | 'turn';
  label: string;
  icon: ElementType;
  shortcut?: string;
  disabled?: boolean;
  destructive?: boolean;
  className?: string;
  /** Extra words the search matches on. */
  keywords?: string;
  onSelect: () => void;
};

/** Two lines in a handle tooltip: what a click does, then the second gesture, muted. */
function HandleTip({ first, second }: { first: string; second: string }) {
  return (
    <span className="block text-center leading-snug">
      <span className="block">{first}</span>
      <span className="block font-normal text-tooltip-foreground/60">{second}</span>
    </span>
  );
}

/**
 * The menu's muted footer: which block this is, how long, and when the page
 * was last edited. Mounted only while the menu is open, so subscribing to
 * the editor state here costs nothing while writing.
 */
function MenuFooter({ block, label }: { block: Block; label: string }) {
  const { lastSavedAt } = useEditor();
  const text = block.type === 'code' ? block.text : 'html' in block ? htmlToText(block.html) : '';
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const edited = editedLabel(lastSavedAt);
  return (
    <div className="shrink-0 border-t border-divider px-3.5 py-2 text-xs leading-4 text-muted-foreground">
      <span className="block truncate">
        {label}
        {block.type !== 'divider' && ` · ${words} ${words === 1 ? 'word' : 'words'}`}
      </span>
      {edited && <span className="block truncate">Page {edited.charAt(0).toLowerCase()}{edited.slice(1)}</span>}
    </div>
  );
}
