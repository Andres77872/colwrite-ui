import './ParagraphBlock.css';
import type { ParagraphBlock as P } from '../../../../editor';
import { Editable } from '../../../common/Editable';
import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useEditor } from '../../../../editor';
import { createPortal } from 'react-dom';
import { AiBeatInline } from './AiBeatInline.tsx';
import { TableInline } from './TableInline';

export const ParagraphBlock = memo(function ParagraphBlock({ block }: { block: P }) {
  const { refs, updateParagraphChild, removeParagraphChild, updateHtml, documentId, createRemote } = useEditor();
  const [mounts, setMounts] = useState<Array<{ id: string; el: HTMLElement }>>([]);
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

  const columns = Math.max(1, Math.min(6, Math.floor(block.columns || 1)));
  const editableStyle = useMemo(() => ({
    columnCount: columns,
    columnGap: columns > 1 ? 24 : undefined,
    columnRule: columns > 1 ? '1px solid var(--color-border)' : undefined,
  } as CSSProperties), [columns]);

  return (
    <>
      <Editable className="paragraph-block" id={block.id} html={block.html} placeholder="Type to write…" style={editableStyle} />
      {mounts.map(({ id, el }: { id: string; el: HTMLElement }) => {
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
});
