import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BLOCK_TYPES, blockTypeLabel, useEditor, type Block } from '@/editor';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';

/** Column and heading-level choices rendered as a segmented control. */
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
      <div role="group" aria-label={label} className="flex gap-1">
        {options.map((option) => {
          const isActive = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={isActive}
              className={cn(
                'h-7 flex-1 rounded-sm border text-xs font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-accent',
              )}
              onClick={() => onChange(option)}
            >
              {format(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const COLUMN_OPTIONS = [1, 2, 3, 4] as const;
const HEADING_LEVELS = [1, 2, 3] as const;

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
    removeBlock,
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

  const isAddOpen = openMenuBlockId === id && openMenuType === 'add';
  const isOptionsOpen = openMenuBlockId === id && openMenuType === 'options';
  const hasMenuOpen = isAddOpen || isOptionsOpen;

  const setOpen = useCallback(
    (type: 'add' | 'options') => (open: boolean) => setBlockMenu(open ? id : null, open ? type : null),
    [id, setBlockMenu],
  );

  const handleAddBlock = useCallback(
    (type: Block['type']) => {
      const newId = addBlockAfter(id, type);
      queueMicrotask(() => refs.current[newId]?.focus());
    },
    [id, addBlockAfter, refs],
  );

  if (!block) return null;

  const label = blockTypeLabel(block.type);

  return (
    <div
      className={cn(
        'absolute left-0 top-1 flex items-center gap-0.5 pl-1',
        // Hidden until hover, but always reachable by keyboard.
        'opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100',
        hasMenuOpen && 'opacity-100',
      )}
    >
      <DropdownMenu open={isAddOpen} onOpenChange={setOpen('add')}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              isAddOpen && 'bg-accent text-foreground',
            )}
            aria-label={`Insert a block after this ${label.toLowerCase()}`}
            title="Insert block below"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-44">
          <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Insert below
          </DropdownMenuLabel>
          {BLOCK_TYPES.map(({ type, label: typeLabel, icon: Icon }) => (
            <DropdownMenuItem key={type} onSelect={() => handleAddBlock(type)}>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {typeLabel}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu open={isOptionsOpen} onOpenChange={setOpen('options')}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-6 w-6 cursor-grab items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing',
              isOptionsOpen && 'bg-accent text-foreground',
            )}
            aria-label={`${label} options — drag to reorder`}
            title="Drag to reorder · click for options"
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
        </DropdownMenuTrigger>

        <DropdownMenuContent side="right" align="start" className="w-56">
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
            <DropdownMenuItem onSelect={() => toggleAiHidden(id)}>
              {block.aiHidden ? <Eye /> : <EyeOff />}
              {block.aiHidden ? 'Show to assistant' : 'Hide from assistant'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toggleLocked(id)}>
              {block.locked ? <Unlock /> : <Lock />}
              {block.locked ? 'Unlock block' : 'Lock block'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toggleCollapsed(id)}>
              {block.collapsed ? <ChevronDown /> : <ChevronRight />}
              {block.collapsed ? 'Expand' : 'Collapse'}
            </DropdownMenuItem>
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
  );
}
