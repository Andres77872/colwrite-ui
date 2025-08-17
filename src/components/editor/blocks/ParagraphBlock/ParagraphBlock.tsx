import './ParagraphBlock.css';
import type { ParagraphBlock as P } from '../../../../editor';
import { Editable } from '../../../common/Editable';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useEditor } from '../../../../editor';
import { createPortal } from 'react-dom';
import { AiBeatInline } from './AiBeatInline.tsx';
import { TableInline } from './TableInline';

export function ParagraphBlock({ block }: { block: P }) {
  const { refs, updateParagraphChild, removeParagraphChild, updateHtml, documentId, createRemote, activeId, setParagraphColumns } = useEditor();
  const [mounts, setMounts] = useState<Array<{ id: string; el: HTMLElement }>>([]);
  const colsMenuRef = useRef<HTMLDivElement | null>(null);
  const [colsOpen, setColsOpen] = useState(false);
  // Reserved for future stabilization if we need to diff placeholder sets more aggressively
  // const prevIdsKeyRef = useRef<string>('');

  // Mount child components referenced inside HTML placeholders.
  // Also re-mount automatically whenever the Editable DOM subtree mutates
  // (e.g., when the caret leaves and Editable restores sanitized HTML).
  useEffect(() => {
    const host = refs.current[block.id];
    if (!host) return;

    const mountIntoPlaceholders = () => {
      const placeholders = Array.from(host.querySelectorAll<HTMLElement>('[data-child-id]'));
      const next: Array<{ id: string; el: HTMLElement }> = [];
      for (const el of placeholders) {
        const childId = el.getAttribute('data-child-id') || '';
        if (!childId) continue;
        const child = (block.children || []).find(c => c.id === childId);
        if (!child) continue;
        next.push({ id: childId, el });
      }
      setMounts(next);
    };

    // Initial mount
    mountIntoPlaceholders();

    // Observe any DOM changes that could replace placeholders
    const observer = new MutationObserver((records) => {
      // Recompute mounts only when placeholders are added/removed or their data-child-id changes
      let relevant = false;
      for (const rec of records) {
        if (rec.type === 'attributes') {
          const t = rec.target as HTMLElement;
          if (t && t.hasAttribute && t.hasAttribute('data-child-id')) { relevant = true; break; }
        }
        const nodes = [...Array.from(rec.addedNodes), ...Array.from(rec.removedNodes)];
        if (nodes.some(n => (n as HTMLElement)?.nodeType === 1 && (n as HTMLElement).hasAttribute?.('data-child-id'))) { relevant = true; break; }
      }
      if (relevant) mountIntoPlaceholders();
    });
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-child-id'] });

    return () => {
      observer.disconnect();
      // Do not call setState in cleanup to avoid re-render loops while dependencies change
    };
  }, [block.id, block.children, refs]);

  // Close columns popover on outside click or Escape
  useEffect(() => {
    if (!colsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!colsMenuRef.current) return;
      const target = e.target as Node | null;
      if (target && colsMenuRef.current.contains(target)) return;
      setColsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setColsOpen(false); };
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [colsOpen]);

  const columns = Math.max(1, Math.min(6, Math.floor(block.columns || 1)));
  const editableStyle = useMemo(() => ({
    columnCount: columns,
    columnGap: columns > 1 ? 24 : undefined,
    columnRule: columns > 1 ? '1px solid var(--color-border)' : undefined,
  } as CSSProperties), [columns]);

  return (
    <>
      {activeId === block.id && (
        <div className="cols-ui" ref={colsMenuRef}>
          <button
            className="cols-trigger"
            type="button"
            title="Set columns"
            onMouseDown={(e) => { e.preventDefault(); }}
            onClick={(e) => { e.preventDefault(); setColsOpen(v => !v); }}
          >
            Columns: {columns} ▾
          </button>
          {colsOpen && (
            <div className="cols-pop" onMouseDown={(e) => e.preventDefault()}>
              <div className="segmented" role="menu" aria-label="Columns options">
                {[1,2,3,4].map(n => (
                  <button
                    role="menuitemradio"
                    aria-checked={n === columns}
                    key={n}
                    className={["seg-btn", n === columns ? "active" : ""].filter(Boolean).join(" ")}
                    type="button"
                    title={`${n} column${n>1?'s':''}`}
                    onClick={() => { setParagraphColumns(block.id, n); setColsOpen(false); }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <Editable className="paragraph-block" id={block.id} html={block.html} placeholder="Type to write…" style={editableStyle} />
      {mounts.map(({ id, el }) => {
        const child = (block.children || []).find(c => c.id === id);
        if (!child) return null;
        return createPortal(
          child.type === 'aiBeat' ? (
            <AiBeatInline
              blockId={block.id}
              child={child}
              updateParagraphChild={updateParagraphChild}
              removeParagraphChild={removeParagraphChild}
              updateHtml={updateHtml}
              refs={refs}
              documentId={documentId}
              createRemote={createRemote}
            />
          ) : (
            <TableInline
              blockId={block.id}
              child={child}
              updateParagraphChild={updateParagraphChild}
              removeParagraphChild={removeParagraphChild}
              updateHtml={updateHtml}
              refs={refs}
            />
          ),
          el,
          id,
        );
      })}
    </>
  );
}
