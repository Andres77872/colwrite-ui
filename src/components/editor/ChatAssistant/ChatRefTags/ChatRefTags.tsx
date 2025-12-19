import { Fragment, type CSSProperties } from 'react';
import { useEditor } from '../../../../editor';
import type { Block } from '../../../../editor';
import { cn } from '@/lib/utils';

export type ChatRefTag = {
  kind: 'document' | 'block';
  start: number;
  end: number;
  refText: string;
  docId?: string;
  blockId?: string;
  source?: 'this' | 'doc';
};

function labelForBlock(blocks: Block[], blockId: string): string {
  const index = blocks.findIndex(b => b.id === blockId);
  const b = index >= 0 ? blocks[index] : null;
  if (!b) return `Block ${blockId}`;
  if (b.type === 'heading') return `Heading ${(b as any).level ?? ''}`.trim();
  if (b.type === 'divider') return `Divider ${index + 1}`;
  const tmp = document.createElement('div');
  tmp.innerHTML = (b as any).html || '';
  const txt = (tmp.textContent || '').trim();
  return txt ? (txt.length > 60 ? txt.slice(0, 57) + '…' : txt) : `Paragraph ${index + 1}`;
}

function shorten(id: string, max: number = 10): string {
  if (!id) return '';
  if (id.length <= max) return id;
  return id.slice(0, Math.ceil(max / 2)) + '…' + id.slice(-Math.floor(max / 2));
}

function parseRefs(text: string): { parts: Array<string | ChatRefTag> } {
  const parts: Array<string | ChatRefTag> = [];
  if (!text) return { parts: [''] };

  const pattern = /#doc\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)|#this\/([A-Za-z0-9_-]+)|#doc\/([A-Za-z0-9_-]+)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const matchStart = m.index;
    const matchStr = m[0];
    const matchEnd = matchStart + matchStr.length;

    if (matchStart > lastIndex) {
      parts.push(text.slice(lastIndex, matchStart));
    }

    if (m[1] && m[2]) {
      // #doc/<docId>/<blockId>
      const docId = m[1];
      const blockId = m[2];
      parts.push({ kind: 'block', start: matchStart, end: matchEnd, refText: matchStr, docId, blockId, source: 'doc' });
    } else if (m[3]) {
      // #this/<blockId>
      const blockId = m[3];
      parts.push({ kind: 'block', start: matchStart, end: matchEnd, refText: matchStr, blockId, source: 'this' });
    } else if (m[4]) {
      // #doc/<docId>
      const docId = m[4];
      parts.push({ kind: 'document', start: matchStart, end: matchEnd, refText: matchStr, docId });
    }

    lastIndex = matchEnd;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return { parts };
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

export function extractRefSpans(text: string): ChatRefTag[] {
  return parseRefs(text).parts.filter((p): p is ChatRefTag => typeof p !== 'string');
}


