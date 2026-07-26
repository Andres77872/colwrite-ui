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
  className,
  style,
}: {
  text: string;
  interactive?: boolean;
  onTagClick?: (start: number, refText: string) => void;
  onTagRemove?: (start: number, refText: string) => void;
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

        const content = (
          <span 
            className={cn(
              "inline-flex items-center gap-0.5 mx-0.5",
              isDoc ? "bg-blue-100 text-blue-800" : "bg-violet-100 text-violet-800",
              "px-1.5 py-0.5 rounded text-xs",
              interactive && "cursor-pointer hover:opacity-80"
            )}
            title={title}
            onMouseDown={interactive ? (e) => e.preventDefault() : undefined}
            onClick={interactive ? () => onTagClick?.(p.start, p.refText) : undefined}
          >
            <span className="flex items-center gap-1">
              <span aria-hidden>{isDoc ? '📄' : '🔖'}</span>
              <span>{label}</span>
            </span>
            {interactive && (
              <button
                type="button"
                className="ml-1 hover:text-destructive transition-colors"
                aria-label="Remove reference"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); onTagRemove?.(p.start, p.refText); }}
                title="Remove"
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
