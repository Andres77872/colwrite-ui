import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BLOCK_TYPES, blockTypeLabel, useEditor, type Block } from '@/editor';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  MoreHorizontal,
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
    <div className="px-2 py-1.5">
      <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <DropdownMenuRadioGroup
        role="group"
        aria-label={label}
        className="flex gap-1"
        value={String(value)}
        onValueChange={(next) => onChange(Number(next) as T)}
      >
        {options.map((option) => (
          <DropdownMenuRadioItem
            key={option}
            value={String(option)}
            onSelect={(event) => event.preventDefault()}
            className={cn(
              'h-7 flex-1 justify-center border px-0 text-xs font-medium',
              'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
              'data-[state=unchecked]:border-border',
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
function canCollapse(type: Block['type']): boolean {
  return type === 'heading' || type === 'paragraph';
}

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
      className={cn(
        // In the gutter, tucked against the text column, on the same line as
        // the controls — which take this space back on hover. The options menu
        // names every one of these states in words while it is open.
        'pointer-events-none absolute left-0 top-1 flex h-6 w-[var(--doc-gutter)] items-center justify-end gap-0.5 pr-1.5',
        'transition-opacity group-hover:opacity-0',
      )}
    >
      {marks.map(({ key, icon: Icon, label, className }) => (
        <Icon key={key} role="img" aria-label={label} className={cn('h-3 w-3', className)} />
      ))}
    </span>
  );
}

/**
 * BlockControls — the gutter affordances for one block.
 *
 * The two menus were previously hand-built portals: no menu semantics, no
 * arrow-key navigation, no focus return, and a `z-[9999]` that placed them
 * above modal dialogs. They are Radix menus now, so all of that comes for
 * free and they respect the app's z-index scale.
 */
export function BlockControls({ id }: { id: string }) {
  const {
    addBlockAfter,
    addBlockBefore,
    removeBlock,
    moveBlock,
    toggleAiHidden,
    toggleLocked,
    toggleCollapsed,
    blocks,
    setParagraphColumns,
    setHeadingLevel,
    refs,
    openMenuBlockId,
    openMenuType,
    setBlockMenu,
  } = useEditor();

  const block = blocks.find((b) => b.id === id);
  const blockIndex = blocks.findIndex((b) => b.id === id);

  const isOptionsOpen = openMenuBlockId === id && openMenuType === 'options';

  const setOpen = useCallback(
    (type: 'add' | 'options') => (open: boolean) => setBlockMenu(open ? id : null, open ? type : null),
    [id, setBlockMenu],
  );

  const handleAddBlock = useCallback(
    (where: 'before' | 'after', type: Block['type']) => {
      const newId = where === 'after' ? addBlockAfter(id, type) : addBlockBefore(id, type);
      queueMicrotask(() => refs.current[newId]?.focus());
    },
    [id, addBlockAfter, addBlockBefore, refs],
  );

  if (!block) return null;

  const label = blockTypeLabel(block.type);

  return (
    <>
      <BlockMarks block={block} />
      <div
        className={cn(
          // Sized from the gutter token rather than laid out freely: the group
          // is 54px of buttons and the gutter used to be 40px, so the drag
          // handle sat 14px into the text column and stole the click that was
          // meant to place the caret. Constraining it here means the two can
          // never disagree again, whatever the token is set to.
          'absolute left-0 top-1 flex w-[var(--doc-gutter)] items-center justify-center gap-0.5',
          // Hidden until hover, but always reachable by keyboard.
          'opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100',
          isOptionsOpen && 'opacity-100',
        )}
      >
        {/* The drag handle, and nothing else.

            It used to be the options menu's trigger as well, which is why
            drag-to-reorder did not work at all: Radix opens a menu on
            `pointerdown` and calls `preventDefault()` while doing it, and
            preventing the default of pointerdown is exactly what stops the
            browser from starting a native drag. Pressing the handle opened the
            menu and killed the drag in the same event. They are two controls
            now — one gesture each. */}
        <button
          type="button"
          className={cn(
            // Hand-rolled rather than Button: icon-xs would shrink the 16px
            // glyph to 14px. The ring is the standard one it lacks.
            'flex h-6 w-6 cursor-grab items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label={`Drag to reorder this ${label.toLowerCase()}`}
          title="Drag to reorder"
          draggable
          onMouseDown={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', id);
            event.dataTransfer.setData('application/x-block-id', id);
            event.dataTransfer.effectAllowed = 'move';
            setBlockMenu(null, null);
          }}
        >
          <GripVertical aria-hidden="true" className="h-4 w-4" />
        </button>

        <DropdownMenu open={isOptionsOpen} onOpenChange={setOpen('options')}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isOptionsOpen && 'bg-accent text-foreground',
              )}
              aria-label={`${label} options`}
              title="Block options"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="right" align="start" className="w-56">
            {/* Insert moved in here when the standalone "+" gave up its slot to
                the drag handle. Insert above was reachable nowhere before, so
                nothing could be placed in front of a document's first block. */}
            <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Insert below
            </DropdownMenuLabel>
            {BLOCK_TYPES.map(({ type, label: typeLabel, icon: Icon }) => (
              <DropdownMenuItem key={`after-${type}`} onSelect={() => handleAddBlock('after', type)}>
                <Icon aria-hidden="true" className="text-muted-foreground" />
                {typeLabel}
              </DropdownMenuItem>
            ))}
            <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Insert above
            </DropdownMenuLabel>
            {BLOCK_TYPES.map(({ type, label: typeLabel, icon: Icon }) => (
              <DropdownMenuItem key={`before-${type}`} onSelect={() => handleAddBlock('before', type)}>
                <Icon aria-hidden="true" className="text-muted-foreground" />
                {typeLabel}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />

            <DropdownMenuLabel>
              {label}
              {block.type === 'heading' && ` ${block.level ?? 2}`}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {block.type === 'paragraph' && (
              <>
                <SegmentedChoice
                  label="Columns"
                  options={COLUMN_OPTIONS}
                  value={(block.columns ?? 1) as (typeof COLUMN_OPTIONS)[number]}
                  format={(n) => String(n)}
                  onChange={(n) => setParagraphColumns(id, n)}
                />
                <DropdownMenuSeparator />
              </>
            )}

            {block.type === 'heading' && (
              <>
                <SegmentedChoice
                  label="Level"
                  options={HEADING_LEVELS}
                  value={(block.level ?? 2) as (typeof HEADING_LEVELS)[number]}
                  format={(n) => `H${n}`}
                  onChange={(n) => setHeadingLevel(id, n)}
                />
                <DropdownMenuSeparator />
              </>
            )}

            <DropdownMenuGroup>
              {/* Drag reorder is pointer-only; these are the same move for the
                  keyboard. Disabled at the edges, where there is nowhere to go. */}
              <DropdownMenuItem disabled={blockIndex <= 0} onSelect={() => moveBlock(id, -1)}>
                <ArrowUp />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={blockIndex < 0 || blockIndex >= blocks.length - 1}
                onSelect={() => moveBlock(id, 1)}
              >
                <ArrowDown />
                Move down
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toggleAiHidden(id)}>
                {block.aiHidden ? <Eye /> : <EyeOff />}
                {block.aiHidden ? 'Show to assistant' : 'Hide from assistant'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toggleLocked(id)}>
                {block.locked ? <Unlock /> : <Lock />}
                {block.locked ? 'Unlock block' : 'Lock block'}
              </DropdownMenuItem>
              {/* Only where there is something to hide: a divider collapsed
                  into a chip is taller than the rule it replaces. */}
              {canCollapse(block.type) && (
                <DropdownMenuItem onSelect={() => toggleCollapsed(id)}>
                  {block.collapsed ? <ChevronDown /> : <ChevronRight />}
                  {block.collapsed ? 'Expand' : 'Collapse'}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={() => removeBlock(id)}
            >
              <Trash2 />
              Delete block
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
