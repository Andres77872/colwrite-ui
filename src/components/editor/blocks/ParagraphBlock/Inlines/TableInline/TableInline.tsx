import { useCallback, useMemo, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { TableAlign, TableChild } from '@/editor';
import type { InlineWidgetProps } from '../types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
  MoreHorizontal,
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
      className={cn(
        'block w-full resize-none overflow-hidden border-0 bg-transparent px-2 py-1.5 text-sm outline-none',
        'min-w-[6rem] focus:bg-primary/5',
        isHeader && 'font-medium',
        ALIGN_CLASS[align[c] ?? 'left'],
      )}
    />
  );

  return (
    <InlineFigureShell
      label="Table"
      onRemove={remove}
      controls={
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
          <p className="mt-2 text-[11px] text-muted-foreground">
            Tab moves between cells and adds a row at the end. Shift+Enter starts a new line inside
            a cell. Paste spreadsheet or CSV data to fill the table.
          </p>
        </InlineSettings>
      }
      caption={
        child.caption ? (
          <span className="block border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
            {child.caption}
          </span>
        ) : undefined
      }
    >
      <span className="block overflow-x-auto">
        <table className="w-full border-collapse">
          <colgroup>
            {/* Handles live in a real gutter column rather than floating
                outside the table: negative offsets were clipped the moment the
                table became wide enough to scroll. */}
            <col style={{ width: '1.25rem' }} />
            {Array.from({ length: cols }, (_, c) => (
              <col key={c} />
            ))}
          </colgroup>

          {/* Column handles: a thin strip that only appears on hover, so a
              finished table reads as a table rather than as a control panel. */}
          <thead>
            <tr className="opacity-0 transition-opacity group-hover/figure:opacity-100 group-focus-within/figure:opacity-100">
              <th className="h-5 p-0" aria-hidden="true" />
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} className="h-5 p-0">
                  <ColumnMenu
                    index={c}
                    align={align[c] ?? 'left'}
                    canDelete={cols > 1}
                    onInsertLeft={() => addColumnAt(c)}
                    onInsertRight={() => addColumnAt(c + 1)}
                    onDelete={() => deleteColumnAt(c)}
                    onAlign={(value) => setAlign(c, value)}
                  />
                </th>
              ))}
            </tr>
            {header && (
              <tr className="group/row">
                <th className="p-0 align-middle">
                  <RowMenu
                    label="Header row options"
                    canDelete={false}
                    onInsertAbove={() => addRowAt(0)}
                    onInsertBelow={() => addRowAt(1)}
                    onDelete={() => deleteRowAt(0)}
                  />
                </th>
                {grid[0].map((_, c) => (
                  <th key={c} className="border border-border bg-muted/40 p-0 align-top">
                    {cell(0, c, true)}
                  </th>
                ))}
              </tr>
            )}
          </thead>

          <tbody>
            {bodyRows.map((row, index) => {
              const r = index + bodyOffset;
              return (
                <tr key={r} className="group/row">
                  <td className="p-0 align-middle">
                    <RowMenu
                      label={`Row ${r + 1} options`}
                      canDelete={rows > (header ? 2 : 1)}
                      onInsertAbove={() => addRowAt(r)}
                      onInsertBelow={() => addRowAt(r + 1)}
                      onDelete={() => deleteRowAt(r)}
                    />
                  </td>
                  {row.map((_, c) => (
                    <td key={c} className="border border-border p-0 align-top">
                      {cell(r, c, false)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </span>

      <span className="flex items-center gap-1 border-t border-border/60 px-2 py-1 opacity-0 transition-opacity group-hover/figure:opacity-100 group-focus-within/figure:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
          onClick={() => addRowAt(rows)}
        >
          <ArrowDownToLine className="h-3 w-3" />
          Row
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
          onClick={() => addColumnAt(cols)}
        >
          <ArrowRightToLine className="h-3 w-3" />
          Column
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {rows} × {cols}
        </span>
      </span>
    </InlineFigureShell>
  );
}

/* ----------------------------------------
   Row and column handles
   ---------------------------------------- */

function ColumnMenu({
  index,
  align,
  canDelete,
  onInsertLeft,
  onInsertRight,
  onDelete,
  onAlign,
}: {
  index: number;
  align: TableAlign;
  canDelete: boolean;
  onInsertLeft: () => void;
  onInsertRight: () => void;
  onDelete: () => void;
  onAlign: (value: TableAlign) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-5 w-full items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          aria-label={`Column ${index + 1} options`}
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem onSelect={onInsertLeft}>
          <ArrowLeftToLine aria-hidden="true" className="text-muted-foreground" />
          Insert column left
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onInsertRight}>
          <ArrowRightToLine aria-hidden="true" className="text-muted-foreground" />
          Insert column right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {(
          [
            ['left', AlignLeft, 'Align left'],
            ['center', AlignCenter, 'Align centre'],
            ['right', AlignRight, 'Align right'],
          ] as const
        ).map(([value, Icon, label]) => (
          <DropdownMenuItem key={value} onSelect={() => onAlign(value)}>
            <Icon aria-hidden="true" className={align === value ? 'text-primary' : 'text-muted-foreground'} />
            {label}
          </DropdownMenuItem>
        ))}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} className="text-destructive">
              <Trash2 aria-hidden="true" />
              Delete column
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowMenu({
  label,
  canDelete,
  onInsertAbove,
  onInsertBelow,
  onDelete,
}: {
  label: string;
  canDelete: boolean;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // In the gutter column, so it never overlaps a cell's own text and
          // cannot be clipped when the table scrolls sideways.
          className="flex h-full w-full items-center justify-center rounded-sm py-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/row:opacity-100 focus-visible:opacity-100"
          aria-label={label}
        >
          <MoreHorizontal className="h-3 w-3 rotate-90" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuItem onSelect={onInsertAbove}>
          <ArrowUpToLine aria-hidden="true" className="text-muted-foreground" />
          Insert row above
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onInsertBelow}>
          <ArrowDownToLine aria-hidden="true" className="text-muted-foreground" />
          Insert row below
        </DropdownMenuItem>
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} className="text-destructive">
              <Trash2 aria-hidden="true" />
              Delete row
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
