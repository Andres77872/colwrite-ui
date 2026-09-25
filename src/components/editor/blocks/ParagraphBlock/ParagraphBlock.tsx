import type { ParagraphBlock as P, ParagraphChild, ParagraphVariant } from '../../../../editor';
import { Editable } from '../../../common/Editable';
import { hideFigureGaps, startsWithFigure } from '../../../common/Editable/editableHtml';
import { memo, useEffect, useLayoutEffect, useMemo, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { numberLabel, useEditorActions } from '../../../../editor';
import { createPortal } from 'react-dom';
import { AiBeatInline, TableInline, CitationInline, EquationInline, GraphInline } from './Inlines';
import type { AiBeatWidgetProps } from './Inlines/types';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Lightbulb } from 'lucide-react';

const PLACEHOLDERS: Record<ParagraphVariant, string> = {
  bullet: 'List',
  numbered: 'List',
  todo: 'To-do',
  quote: 'Empty quote',
  callout: 'Type something…',
};

const PARAGRAPH_PLACEHOLDER = "Write, press 'space' for AI, '/' for commands…";

/** Bullets cycle by depth, as in most outliners, so nesting reads at a glance. */
const BULLETS = ['•', '◦', '▪'];

/** The marker column of a list item, one line box tall so it sits on the first line. */
function ListMarker({ block, listNumber }: { block: P; listNumber?: number }) {
  const { setChecked } = useEditorActions();
  const depth = block.indent ?? 0;
  let mark: ReactNode;
  if (block.variant === 'todo') {
    mark = (
      <Checkbox
        checked={block.checked === true}
        disabled={block.locked === true}
        aria-label={block.checked ? 'Mark as not done' : 'Mark as done'}
        className="h-4 w-4 rounded-xs border-[1.5px] border-icon-tertiary data-[state=checked]:border-primary-strong"
        onCheckedChange={(value) => setChecked(block.id, value === true)}
        // Keep the caret where it is: a click on the box is not a click into
        // the text beside it.
        onMouseDown={(event) => event.preventDefault()}
      />
    );
  } else if (block.variant === 'numbered') {
    mark = <span className="tabular-nums">{numberLabel(listNumber ?? 1, depth)}</span>;
  } else {
    mark = <span className="text-[1.25em] leading-none">{BULLETS[depth % BULLETS.length]}</span>;
  }
  return (
    <span
      contentEditable={false}
      aria-hidden={block.variant === 'todo' ? undefined : true}
      className={cn(
        'list-marker flex h-[1.5em] min-w-6 shrink-0 select-none items-center justify-center',
        block.variant === 'numbered' && 'justify-end pr-1.5 tabular-nums',
        block.variant === 'todo' && 'mr-0.5',
      )}
    >
      {mark}
    </span>
  );
}

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

export const ParagraphBlock = memo(function ParagraphBlock({
  block,
  documentId,
  listNumber,
}: {
  block: P;
  documentId: string | null;
  /** Position within its numbered run; only read for numbered items. */
  listNumber?: number;
}) {
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

  // Once the widgets have rendered into their placeholders, the space after
  // a table or chart must not indent the line below it.
  useLayoutEffect(() => {
    const host = refs.current[block.id];
    if (!host) return;
    if (mounts.length > 0) hideFigureGaps(host);
    host.toggleAttribute('data-leading-figure', mounts.length > 0 && startsWithFigure(host));
  }, [mounts, refs, block.id]);

  const variant = block.variant;
  const isList = variant === 'bullet' || variant === 'numbered' || variant === 'todo';
  // Columns are a body-text layout; a list item or quote is one column.
  const columns = variant ? 1 : Math.max(1, Math.min(6, Math.floor(block.columns || 1)));
  const editableStyle = useMemo(() => ({
    columnCount: columns,
    columnGap: columns > 1 ? '2rem' : undefined,
    columnRule: columns > 1 ? '1px solid var(--color-border)' : undefined,
  } as CSSProperties), [columns]);

  const editable = (
    <Editable
      id={block.id}
      html={block.html}
      locked={block.locked === true}
      ariaLabel={variant === 'todo' ? 'To-do item' : isList ? 'List item' : variant === 'quote' ? 'Quote' : variant === 'callout' ? 'Callout' : 'Paragraph'}
      placeholder={variant ? PLACEHOLDERS[variant] : PARAGRAPH_PLACEHOLDER}
      placeholderWhen={variant ? 'always' : 'focus'}
      style={editableStyle}
      slashEnabled
      // Size and leading come from the row (globals.css), so the handle and
      // the list marker line up with the first line of text.
      className={cn(
        variant === 'todo' && block.checked && 'text-muted-foreground line-through decoration-muted-foreground/60',
      )}
    />
  );

  let body: ReactNode = editable;
  if (isList) {
    body = (
      <div className="flex w-full items-start" style={{ paddingLeft: `${(block.indent ?? 0) * 1.5}em` }}>
        <ListMarker block={block} listNumber={listNumber} />
        <div className="min-w-0 flex-1">{editable}</div>
      </div>
    );
  } else if (variant === 'quote') {
    body = <div className="border-l-[3px] border-current pl-3.5">{editable}</div>;
  } else if (variant === 'callout') {
    body = (
      // Notion's default callout: no fill, a hairline and a 10px radius, so it
      // sets text apart without reading as a card on the page.
      <div className="callout flex w-full items-start gap-2 rounded-[10px] py-3 pl-3 pr-4 shadow-[inset_0_0_0_1px_var(--color-border)]">
        <span contentEditable={false} className="flex h-[1.5em] w-6 shrink-0 select-none items-center justify-center">
          <Lightbulb aria-hidden="true" className="h-5 w-5 text-tint-yellow-fg" />
        </span>
        <div className="min-w-0 flex-1">{editable}</div>
      </div>
    );
  }

  return (
    <div
      className={cn('paragraph-block w-full', columns > 1 && 'multi-column')}
      data-variant={variant}
    >
      {body}
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
