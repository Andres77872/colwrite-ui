import { useEffect, useMemo, useState, useRef, type MutableRefObject, type ChangeEvent, type MouseEvent } from 'react';
import type { ParagraphChild } from '../../../../editor';
import { serializeEditableHtml } from '../../../common/Editable/Editable';

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
  const [caption, setCaption] = useState(child.caption || '');
  const [header, setHeader] = useState(!!child.header);
  const initializedRef = useRef(false);

  // Initialize on child identity change
  useEffect(() => {
    setRows(child.rows);
    setCols(child.cols);
    setData(normalizeData(child.data, child.rows, child.cols));
    setCaption(child.caption || '');
    setHeader(!!child.header);
    initializedRef.current = true;
  }, [child.id]);

  // Persist changes (debounced)
  useEffect(() => {
    if (!initializedRef.current) return;
    const id = window.setTimeout(() => {
      updateParagraphChild(blockId, child.id, { rows, cols, data, caption, header } as any);
    }, 60);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols, data, caption, header]);

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

  return (
    <span className="table-inline" contentEditable={false as any} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="table-toolbar">
        <button type="button" className="tbtn" title="Add column" onMouseDown={(e) => { e.preventDefault(); setCols(c => c + 1); }}>+ Col</button>
        <button type="button" className="tbtn" title="Remove column" onMouseDown={(e) => { e.preventDefault(); setCols(c => Math.max(1, c - 1)); }}>− Col</button>
        <button type="button" className="tbtn" title="Add row" onMouseDown={(e) => { e.preventDefault(); setRows(r => r + 1); }}>+ Row</button>
        <button type="button" className="tbtn" title="Remove row" onMouseDown={(e) => { e.preventDefault(); setRows(r => Math.max(1, r - 1)); }}>− Row</button>
        <label className="topt"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Header</label>
        <button type="button" className="tbtn danger" title="Remove table" onMouseDown={onRemove}>×</button>
      </div>
      <div className="table-wrap">
        <table>
          {header && (
            <thead>
              <tr>
                {grid[0].map((_, c) => (
                  <th key={`h-${c}`}>
                    <input value={grid[0][c]} onChange={onCellInput(0, c)} placeholder={`H${c + 1}`} />
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {grid.map((row, r) => (
              (!header || r > 0) && (
                <tr key={`r-${r}`}>
                  {row.map((_, c) => (
                    <td key={`c-${r}-${c}`}>
                      <input value={grid[r][c]} onChange={onCellInput(r, c)} placeholder={header ? `R${r}${c + 1}` : `R${r + 1}${c + 1}`} />
                    </td>
                  ))}
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
      <input className="table-caption" placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} />
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


