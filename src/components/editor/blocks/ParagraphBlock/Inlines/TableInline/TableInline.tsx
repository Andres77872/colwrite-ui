import { useEffect, useMemo, useState, useRef, type MutableRefObject, type ChangeEvent, type MouseEvent, type KeyboardEvent } from 'react';
import type { ParagraphChild } from '../../../../../../editor';
import { serializeEditableHtml } from '../../../../../../components/common/Editable/Editable';

export function TableInline({
  blockId,
  child,
  updateParagraphChild,
  removeParagraphChild,
  updateHtml,
  refs,
}: {
  blockId: string;
  child: ParagraphChild;
  updateParagraphChild: (blockId: string, childId: string, next: Partial<ParagraphChild>) => void;
  removeParagraphChild: (blockId: string, childId: string) => void;
  updateHtml: (id: string, html: string) => void;
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
}) {
  if (child.type !== 'table') return null;

  const [rows, setRows] = useState(child.rows);
  const [cols, setCols] = useState(child.cols);
  const [data, setData] = useState<string[][]>(() => normalizeData(child.data, child.rows, child.cols));
  const [header, setHeader] = useState(!!child.header);
  const initializedRef = useRef(false);
  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Initialize on child identity change
  useEffect(() => {
    setRows(child.rows);
    setCols(child.cols);
    setData(normalizeData(child.data, child.rows, child.cols));
    setHeader(!!child.header);
    initializedRef.current = true;
  }, [child.id]);

  // Persist changes (debounced)
  useEffect(() => {
    if (!initializedRef.current) return;
    const id = window.setTimeout(() => {
      updateParagraphChild(blockId, child.id, { rows, cols, data, header } as any);
    }, 60);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols, data, header]);

  // Keep grid shaped when rows/cols change
  useEffect(() => {
    setData(prev => normalizeData(prev, rows, cols));
  }, [rows, cols]);

  const onCellInput = (r: number, c: number) => (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setData(prev => {
      const next = prev.map(row => row.slice());
      if (!next[r]) next[r] = [];
      next[r][c] = value;
      return next;
    });
  };

  const onRemove = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const host = refs.current[blockId];
    const el = host?.querySelector(`[data-child-id="${child.id}"]`);
    el?.parentNode?.removeChild(el as any);
    removeParagraphChild(blockId, child.id);
    const editable = refs.current[blockId];
    if (editable) updateHtml(blockId, serializeEditableHtml(editable));
  };

  const grid = useMemo(() => data, [data, rows, cols]);

  const setCellRef = (r: number, c: number) => (el: HTMLInputElement | null) => {
    cellRefs.current[`${r}-${c}`] = el;
  };

  const focusCell = (r: number, c: number) => {
    const key = `${r}-${c}`;
    const el = cellRefs.current[key];
    if (el) {
      el.focus();
      el.select();
    }
  };

  const onCellKeyDown = (r: number, c: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const caretStart = input.selectionStart ?? 0;
    const caretEnd = input.selectionEnd ?? 0;
    const atStart = caretStart === 0 && caretEnd === 0;
    const atEnd = caretStart === input.value.length && caretEnd === input.value.length;

    if (e.key === 'ArrowRight' && atEnd) {
      e.preventDefault();
      if (c + 1 < cols) focusCell(r, c + 1);
      else if (r + 1 < rows) focusCell(r + 1, 0);
      return;
    }
    if (e.key === 'ArrowLeft' && atStart) {
      e.preventDefault();
      if (c - 1 >= 0) focusCell(r, c - 1);
      else if (r - 1 >= 0) focusCell(r - 1, cols - 1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (r + 1 < rows) focusCell(r + 1, c);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (r - 1 >= 0) focusCell(r - 1, c);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const isShift = e.shiftKey;
      if (e.key === 'Tab' && isShift) {
        if (c - 1 >= 0) focusCell(r, c - 1);
        else if (r - 1 >= 0) focusCell(r - 1, cols - 1);
        return;
      }
      if (r + 1 < rows) focusCell(r + 1, c);
      else {
        setRows(prev => prev + 1);
        window.setTimeout(() => focusCell(r + 1, c), 0);
      }
      return;
    }
  };

  return (
    <span className="table-inline relative inline-flex flex-col gap-2 bg-elev p-2 pb-2.5 rounded-[var(--radius-sm)] shadow-[inset_0_0_0_1px_var(--color-border)]" contentEditable={false as any} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <span className="text-[var(--color-muted-foreground)] text-xs">Cols: {cols}</span>
        <button type="button" className="border border-border bg-card px-1.5 py-0.5 rounded cursor-pointer" title="Add column" onMouseDown={(e) => { e.preventDefault(); setCols(c => c + 1); }}>+ Col</button>
        <button type="button" className="border border-border bg-card px-1.5 py-0.5 rounded cursor-pointer" title="Remove column" onMouseDown={(e) => { e.preventDefault(); setCols(c => Math.max(1, c - 1)); }}>− Col</button>
        <span className="text-[var(--color-muted-foreground)] text-xs">Rows: {rows}</span>
        <button type="button" className="border border-border bg-card px-1.5 py-0.5 rounded cursor-pointer" title="Add row" onMouseDown={(e) => { e.preventDefault(); setRows(r => r + 1); }}>+ Row</button>
        <button type="button" className="border border-border bg-card px-1.5 py-0.5 rounded cursor-pointer" title="Remove row" onMouseDown={(e) => { e.preventDefault(); setRows(r => Math.max(1, r - 1)); }}>− Row</button>
        <label className="inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Header</label>
        <button type="button" className="border border-danger bg-card px-1.5 py-0.5 rounded cursor-pointer text-danger" title="Remove table" onMouseDown={onRemove}>×</button>
      </div>
      <div className="overflow-auto max-w-[70vw] rounded-[6px] shadow-sm">
        <table className="border-collapse bg-card text-sm">
          {header && (
            <thead>
              <tr>
                {grid[0].map((_, c) => (
                  <th key={`h-${c}`} className="sticky top-0 bg-card border border-border p-0 z-[1]">
                    <input className="border-0 px-2.5 py-2 w-[140px] outline-none font-bold bg-transparent focus:ring-inset focus:ring-2 focus:ring-accent rounded-[2px]" ref={setCellRef(0, c)} value={grid[0][c]} onChange={onCellInput(0, c)} onKeyDown={onCellKeyDown(0, c)} placeholder={`H${c + 1}`} />
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {grid.map((row, r) => (
              (!header || r > 0) && (
                <tr key={`r-${r}`} className="odd:bg-[var(--color-muted)]">
                  {row.map((_, c) => (
                    <td key={`c-${r}-${c}`} className="border border-border p-0">
                      <input className="border-0 px-2.5 py-2 w-[140px] outline-none focus:ring-inset focus:ring-2 focus:ring-accent rounded-[2px]" ref={setCellRef(r, c)} value={grid[r][c]} onChange={onCellInput(r, c)} onKeyDown={onCellKeyDown(r, c)} placeholder={header ? `R${r}${c + 1}` : `R${r + 1}${c + 1}`} />
                    </td>
                  ))}
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </span>
  );
}

function normalizeData(data: string[][], rows: number, cols: number): string[][] {
  const out: string[][] = [];
  const rr = Math.max(1, rows);
  const cc = Math.max(1, cols);
  for (let r = 0; r < rr; r++) {
    const row: string[] = [];
    for (let c = 0; c < cc; c++) {
      row.push((data?.[r]?.[c] ?? ''));
    }
    out.push(row);
  }
  return out;
}




