import { useCallback, useEffect, useMemo, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { TableAlign, TableChild } from '@/editor';
import type { InlineWidgetProps } from '../types';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineFigureShell, InlineSettings, SettingsCheck, SettingsRow, useInlineChild } from '../shared';
import {
  insertColumn,
  insertRow,
  mergeAt,
  normalizeGrid,
  parseClipboardTable,
  removeColumn,
  removeRow,
} from './tableGrid';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Check,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';

/**
 * Type-guard wrapper. It declares no hooks, so returning early here is safe;
 * the guard used to sit above the content component's hooks, which meant a
 * child whose type changed in place rendered fewer hooks than the previous
 * pass and crashed React.
 */
export function TableInline({ child, ...rest }: InlineWidgetProps) {
  if (child.type !== 'table') return null;
  return <TableInlineContent child={child} {...rest} />;
}

const ALIGN_CLASS: Record<TableAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

/** Grow a cell to fit its wrapped content. */
function autoSize(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/* ----------------------------------------
   Widget
   ---------------------------------------- */

function TableInlineContent(props: InlineWidgetProps<TableChild>) {
  const { child } = props;
  const { patch, remove } = useInlineChild(props);
  const cellRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // The grid is derived from the stored child on every render rather than
  // mirrored into local state. The old widget kept a private copy and flushed
  // it on a timer, so an agent edit that landed mid-typing was silently
  // overwritten by the stale copy on the next flush.
  const grid = useMemo(
    () => normalizeGrid(child.data, child.rows, child.cols),
    [child.data, child.rows, child.cols],
  );
  const rows = grid.length;
  const cols = grid[0]?.length ?? 1;
  const header = child.header !== false;
  const align = child.align ?? [];

  /** Write a new grid back, keeping `rows`/`cols` in step with the data. */
  const commit = useCallback(
    (next: string[][], nextAlign?: TableAlign[]) => {
      patch({
        data: next,
        rows: next.length,
        cols: next[0]?.length ?? 1,
        ...(nextAlign ? { align: nextAlign } : {}),
      });
    },
    [patch],
  );

  const setCell = (r: number, c: number, value: string) => {
    const next = grid.map((row) => row.slice());
    next[r][c] = value;
    commit(next);
  };

  const focusCell = (r: number, c: number) => {
    requestAnimationFrame(() => {
      const el = cellRefs.current[`${r}-${c}`];
      el?.focus();
      el?.select();
    });
  };

  const addRowAt = (at: number) => {
    commit(insertRow(grid, at));
    focusCell(at, 0);
  };

  const addColumnAt = (at: number) => {
    const nextAlign = align.slice();
    nextAlign.splice(at, 0, 'left');
    commit(insertColumn(grid, at), nextAlign);
    focusCell(0, at);
  };

  const deleteRowAt = (at: number) => {
    commit(removeRow(grid, at));
    focusCell(Math.max(0, at - 1), 0);
  };

  const deleteColumnAt = (at: number) => {
    const nextAlign = align.slice();
    nextAlign.splice(at, 1);
    commit(removeColumn(grid, at), nextAlign);
    focusCell(0, Math.max(0, at - 1));
  };

  const setAlign = (column: number, value: TableAlign) => {
    const next = Array.from({ length: cols }, (_, index) => align[index] ?? 'left');
    next[column] = value;
    patch({ align: next });
  };

  const onCellKeyDown = (r: number, c: number) => (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const input = event.currentTarget;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd =
      input.selectionStart === input.value.length && input.selectionEnd === input.value.length;

    // Tab walks the grid and, at the last cell, grows it — the behaviour every
    // spreadsheet has, and the only way to build a table without reaching for
    // the toolbar between every row.
    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) {
        if (c > 0) focusCell(r, c - 1);
        else if (r > 0) focusCell(r - 1, cols - 1);
        return;
      }
      if (c + 1 < cols) focusCell(r, c + 1);
      else if (r + 1 < rows) focusCell(r + 1, 0);
      else {
        commit(insertRow(grid, rows));
        focusCell(rows, 0);
      }
      return;
    }

    // Shift/Alt+Enter puts a line break in the cell; plain Enter moves down.
    if (event.key === 'Enter') {
      if (event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (r + 1 < rows) focusCell(r + 1, c);
      else {
        commit(insertRow(grid, rows));
        focusCell(rows, c);
      }
      return;
    }

    if (event.key === 'ArrowRight' && atEnd && c + 1 < cols) {
      event.preventDefault();
      focusCell(r, c + 1);
      return;
    }
    if (event.key === 'ArrowLeft' && atStart && c > 0) {
      event.preventDefault();
      focusCell(r, c - 1);
      return;
    }
    if (event.key === 'ArrowDown' && !input.value.includes('\n') && r + 1 < rows) {
      event.preventDefault();
      focusCell(r + 1, c);
      return;
    }
    if (event.key === 'ArrowUp' && !input.value.includes('\n') && r > 0) {
      event.preventDefault();
      focusCell(r - 1, c);
    }
  };

  const onCellPaste = (r: number, c: number) => (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text/plain');
    const pasted = parseClipboardTable(text);
    if (!pasted) return;
    event.preventDefault();
    commit(mergeAt(grid, pasted, r, c));
  };

  // A table just inserted from "/" starts with the caret in its first cell,
  // not in the paragraph around it. Only an empty table, and only while the
  // author is writing in the paragraph that holds it — a document that
  // merely loads with an empty table leaves focus alone.
  const tableRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const host = tableRef.current?.closest('.editable');
    const empty = grid.every((row) => row.every((value) => value === ''));
    if (!empty || !host || document.activeElement !== host) return;
    focusCell(0, 0);
    // Mount only: this is about how the table arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bodyRows = header ? grid.slice(1) : grid;
  const bodyOffset = header ? 1 : 0;

  const cell = (r: number, c: number, isHeader: boolean) => (
    <textarea
      ref={(el) => {
        cellRefs.current[`${r}-${c}`] = el;
        // Cells wrap, so their height has to follow their content. `rows={1}`
        // alone would leave a long cell scrolling inside a one-line box.
        autoSize(el);
      }}
      rows={1}
      value={grid[r][c]}
      onChange={(event) => {
        autoSize(event.currentTarget);
        setCell(r, c, event.target.value);
      }}
      onKeyDown={onCellKeyDown(r, c)}
      onPaste={onCellPaste(r, c)}
      aria-label={isHeader ? `Column ${c + 1} heading` : `Row ${r + 1}, column ${c + 1}`}
      // An empty heading row says what it is for.
      placeholder={isHeader ? `Column ${c + 1}` : undefined}
      className={cn(
        'block w-full resize-none overflow-hidden border-0 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:font-normal placeholder:text-placeholder',
        'min-w-[6rem] focus:bg-primary/5',
        isHeader && 'font-semibold',
        ALIGN_CLASS[align[c] ?? 'left'],
      )}
    />
  );

  /** One cell with its options button, which floats in its corner on hover. */
  const cellWithMenu = (r: number, c: number, isHeader: boolean) => (
    <>
      {cell(r, c, isHeader)}
      <CellMenu
        label={isHeader ? `Column ${c + 1} heading options` : `Row ${r + 1}, column ${c + 1} options`}
        align={align[c] ?? 'left'}
        canDeleteRow={!(isHeader && header) && rows > (header ? 2 : 1)}
        canDeleteColumn={cols > 1}
        onInsertAbove={isHeader && header ? undefined : () => addRowAt(r)}
        onInsertBelow={() => addRowAt(r + 1)}
        onInsertLeft={() => addColumnAt(c)}
        onInsertRight={() => addColumnAt(c + 1)}
        onDeleteRow={() => deleteRowAt(r)}
        onDeleteColumn={() => deleteColumnAt(c)}
        onAlign={(value) => setAlign(c, value)}
      />
    </>
  );

  return (
    <InlineFigureShell
      label="Table"
      onRemove={remove}
      controls={
        <>
          <InlineSettings label="Table settings">
            <SettingsRow label="Header row">
              <SettingsCheck
                id={`header-${child.id}`}
                label="Treat the first row as column headings"
                checked={header}
                onChange={(checked) => patch({ header: checked })}
              />
            </SettingsRow>
            <SettingsRow label="Caption" htmlFor={`caption-${child.id}`}>
              <Input
                id={`caption-${child.id}`}
                type="text"
                value={child.caption ?? ''}
                placeholder="Table 1. Results by condition."
                onChange={(event) => patch({ caption: event.target.value })}
                className="h-8 px-2"
              />
            </SettingsRow>
            <p className="mt-2 text-xs text-muted-foreground">
              {rows} × {cols}. Tab moves between cells and adds a row at the end. Shift+Enter
              starts a new line inside a cell. Paste spreadsheet or CSV data to fill the table.
            </p>
          </InlineSettings>
        </>
      }
      caption={child.caption || undefined}
      // Clear of the add-row strip under the table.
      captionClassName="mt-6"
    >
      <span ref={tableRef} className="group/table relative block">
      <span className="block overflow-x-auto">
        <table className="w-full border-collapse">
          {header && (
            <thead>
              <tr>
                {grid[0].map((_, c) => (
                  <th key={c} className="group/cell relative border border-border bg-subtle p-0 align-top">
                    {cellWithMenu(0, c, true)}
                  </th>
                ))}
              </tr>
            </thead>
          )}

          <tbody>
            {bodyRows.map((row, index) => {
              const r = index + bodyOffset;
              return (
                <tr key={r}>
                  {row.map((_, c) => (
                    <td key={c} className="group/cell relative border border-border p-0 align-top">
                      {cellWithMenu(r, c, false)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </span>
      {/* Notion's edge bars: a "+" strip under the last row and beside the
          last column, shown while the table is hovered or being edited. */}
      <EdgeBar edge="bottom" label="Add a row" onClick={() => addRowAt(rows)} />
      <EdgeBar edge="right" label="Add a column" onClick={() => addColumnAt(cols)} />
      </span>
    </InlineFigureShell>
  );
}

/* ----------------------------------------
   Cell options

   Row and column handles used to live in a gutter column and a strip above
   the table that kept their space while invisible, insetting the grid and
   leaving empty bands at rest. One small button in the hovered (or focused)
   cell's corner reaches the same actions for that cell's row and column
   without taking any room.
   ---------------------------------------- */

function CellMenu({
  label,
  align,
  canDeleteRow,
  canDeleteColumn,
  onInsertAbove,
  onInsertBelow,
  onInsertLeft,
  onInsertRight,
  onDeleteRow,
  onDeleteColumn,
  onAlign,
}: {
  label: string;
  align: TableAlign;
  canDeleteRow: boolean;
  canDeleteColumn: boolean;
  /** Absent for the header row, which nothing can be inserted above. */
  onInsertAbove?: () => void;
  onInsertBelow: () => void;
  onInsertLeft: () => void;
  onInsertRight: () => void;
  onDeleteRow: () => void;
  onDeleteColumn: () => void;
  onAlign: (value: TableAlign) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-sm bg-popover text-muted-foreground shadow-sm transition-opacity hover:text-foreground',
            'opacity-0 group-hover/cell:opacity-100 group-focus-within/cell:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label={label}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {onInsertAbove && (
          <DropdownMenuItem onSelect={onInsertAbove}>
            <ArrowUpToLine aria-hidden="true" />
            Insert row above
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onInsertBelow}>
          <ArrowDownToLine aria-hidden="true" />
          Insert row below
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onInsertLeft}>
          <ArrowLeftToLine aria-hidden="true" />
          Insert column left
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onInsertRight}>
          <ArrowRightToLine aria-hidden="true" />
          Insert column right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {(
          [
            ['left', AlignLeft, 'Align left'],
            ['center', AlignCenter, 'Align centre'],
            ['right', AlignRight, 'Align right'],
          ] as const
        ).map(([value, Icon, itemLabel]) => (
          <DropdownMenuItem key={value} onSelect={() => onAlign(value)}>
            <Icon aria-hidden="true" />
            {itemLabel}
            {align === value && <Check aria-hidden="true" className="ml-auto" />}
          </DropdownMenuItem>
        ))}
        {(canDeleteRow || canDeleteColumn) && <DropdownMenuSeparator />}
        {canDeleteRow && (
          <DropdownMenuItem destructive onSelect={onDeleteRow}>
            <Trash2 aria-hidden="true" />
            Delete row
          </DropdownMenuItem>
        )}
        {canDeleteColumn && (
          <DropdownMenuItem destructive onSelect={onDeleteColumn}>
            <Trash2 aria-hidden="true" />
            Delete column
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A thin "+" strip along the table's bottom or right edge. */
function EdgeBar({ edge, label, onClick }: { edge: 'bottom' | 'right'; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'absolute flex items-center justify-center rounded-sm bg-subtle text-muted-foreground transition-[opacity,background-color] duration-150',
        'opacity-0 hover:bg-active hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'group-hover/table:opacity-100 group-focus-within/table:opacity-100',
        edge === 'bottom' ? 'inset-x-0 top-full mt-1 h-4' : 'inset-y-0 left-full ml-1 w-4',
      )}
    >
      <Plus aria-hidden="true" className="h-3 w-3" />
    </button>
  );
}
