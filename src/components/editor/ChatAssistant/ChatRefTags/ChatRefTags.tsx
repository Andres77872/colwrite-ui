import { Fragment, type CSSProperties } from 'react';
import { useEditor } from '../../../../editor';
import type { Block } from '../../../../editor';
import { cn } from '@/lib/utils';
import { parseRefs } from './refTags';

function labelForBlock(blocks: Block[], blockId: string): string {
  const index = blocks.findIndex(b => b.id === blockId);
  const b = index >= 0 ? blocks[index] : null;
  if (!b) return `Block ${blockId}`;
  if (b.type === 'heading') return `Heading ${b.level}`;
  if (b.type === 'divider') return `Divider ${index + 1}`;
  const tmp = document.createElement('div');
  tmp.innerHTML = b.html || '';
  const txt = (tmp.textContent || '').trim();
  return txt ? (txt.length > 60 ? txt.slice(0, 57) + '…' : txt) : `Paragraph ${index + 1}`;
}

function shorten(id: string, max: number = 10): string {
  if (!id) return '';
  if (id.length <= max) return id;
  return id.slice(0, Math.ceil(max / 2)) + '…' + id.slice(-Math.floor(max / 2));
}

export function ChatRefTags({
  text,
  interactive = false,
  onTagClick,
  onTagRemove,
  /** `onfill` for a chip sitting on a filled bubble rather than on the card. */
  surface = 'card',
  className,
  style,
}: {
  text: string;
  interactive?: boolean;
  onTagClick?: (start: number, refText: string) => void;
  onTagRemove?: (start: number, refText: string) => void;
  surface?: 'card' | 'onfill';
  className?: string;
  style?: CSSProperties;
}) {
  const { blocks } = useEditor();
  const { parts } = parseRefs(text);

  return (
    <span className={cn("ref-tags", className)} style={{ whiteSpace: 'pre-wrap', ...style }}>
      {parts.map((p, idx) => {
        if (typeof p === 'string') {
          return <Fragment key={idx}>{p}</Fragment>;
        }
        const isDoc = p.kind === 'document';
        const label = isDoc
          ? `Doc ${shorten(p.docId || '')}`
          : (p.source === 'this'
              ? `Block: ${labelForBlock(blocks, p.blockId || '')}`
              : `Block ${shorten(p.blockId || '')} · Doc ${shorten(p.docId || '')}`);
        const title = isDoc
          ? `Document: ${p.docId}`
          : (p.source === 'this'
              ? `Block in this doc: ${p.blockId}`
              : `Block ${p.blockId} in Document ${p.docId}`);

        // One chip class shared with the composer: a reference has to look the
        // same being written as it does once sent. The old hard-coded
        // `bg-blue-100` pair was a light-theme swatch on a dark-only app, and
        // sat unreadable on the filled bubble it was rendered into.
        const content = (
          <span
            className={cn(
              'ref-chip mx-0.5',
              surface === 'onfill'
                ? 'ref-chip--onfill'
                : isDoc
                  ? 'ref-chip--doc'
                  : 'ref-chip--block',
              !interactive && 'cursor-default',
            )}
            title={title}
            onMouseDown={interactive ? (e) => e.preventDefault() : undefined}
            onClick={interactive ? () => onTagClick?.(p.start, p.refText) : undefined}
          >
            <span className="ref-chip-label">{label}</span>
            {interactive && (
              <button
                type="button"
                className="ref-chip-remove"
                aria-label={`Remove reference ${p.refText}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); onTagRemove?.(p.start, p.refText); }}
              >
                ×
              </button>
            )}
          </span>
        );
        return <Fragment key={idx}>{content}</Fragment>;
      })}
    </span>
  );
}
