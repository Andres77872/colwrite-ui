import type { ParagraphBlock as P, ParagraphChild } from '../../../../editor';
import { Editable } from '../../../common/Editable';
import { memo, useEffect, useMemo, useState, type ComponentType, type CSSProperties } from 'react';
import { useEditorActions } from '../../../../editor';
import { createPortal } from 'react-dom';
import { AiBeatInline, TableInline, CitationInline, EquationInline, GraphInline } from './Inlines';
import type { AiBeatWidgetProps } from './Inlines/types';
import { cn } from '@/lib/utils';

/**
 * One registry instead of a per-widget portal branch: the six wiring props are
 * identical for every widget, and AI Beat's two extras ride along in
 * AiBeatWidgetProps, which every widget accepts and the others ignore.
 * A future widget (footnote, xref, var) is one line here, not a new branch.
 */
const INLINE_WIDGETS: Record<ParagraphChild['type'], ComponentType<AiBeatWidgetProps>> = {
  aiBeat: AiBeatInline,
  table: TableInline,
  citation: CitationInline,
  equation: EquationInline,
  graph: GraphInline,
};

export const ParagraphBlock = memo(function ParagraphBlock({ block, documentId }: { block: P; documentId: string | null }) {
  // Actions only: the merged context changes identity on every keystroke,
  // which re-rendered every paragraph on every edit anywhere in the document.
  // `documentId` arrives as a prop from Canvas — it changes on navigation,
  // not per keystroke, so the memo still holds while typing.
  const { refs, updateParagraphChild, removeParagraphChild, updateHtml, ensureRemoteDocument } = useEditorActions();
  const [mounts, setMounts] = useState<Array<{ id: string; el: HTMLElement }>>([]);

  // Mount child components referenced inside HTML placeholders.
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

    mountIntoPlaceholders();

    const observer = new MutationObserver((records) => {
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

    return () => observer.disconnect();
  }, [block.id, block.children, refs]);

  const columns = Math.max(1, Math.min(6, Math.floor(block.columns || 1)));
  const editableStyle = useMemo(() => ({
    columnCount: columns,
    columnGap: columns > 1 ? '2rem' : undefined,
    columnRule: columns > 1 ? '1px solid var(--color-border)' : undefined,
  } as CSSProperties), [columns]);

  return (
    <div className={cn("paragraph-block w-full", columns > 1 && "multi-column")}>
      <Editable
        id={block.id}
        html={block.html}
        locked={block.locked === true}
        ariaLabel="Paragraph"
        placeholder="Type something, or press '/' for commands…"
        style={editableStyle}
        slashEnabled
        className="text-md leading-relaxed"
      />
      {mounts.map(({ id, el }: { id: string; el: HTMLElement }) => {
        const child = (block.children || []).find(c => c.id === id);
        if (!child) return null;
        const Widget = INLINE_WIDGETS[child.type];
        // A child type with no component renders as `undefined`, which throws
        // and unmounts the whole canvas rather than the one widget. Documents
        // written before the child contract was enforced still hold these.
        if (!Widget) return null;
        return createPortal(
          <Widget
            blockId={block.id}
            child={child}
            updateParagraphChild={updateParagraphChild}
            removeParagraphChild={removeParagraphChild}
            updateHtml={updateHtml}
            refs={refs}
            documentId={documentId}
            ensureRemoteDocument={ensureRemoteDocument}
          />,
          el,
          id,
        );
      })}
    </div>
  );
});
