import { Fragment, type CSSProperties } from 'react';
import { useEditor } from '../../../../editor';
import { cn } from '@/lib/utils';
import { parseRefs, refLabel } from './refTags';

/** A sent message, with its `#this/…` and `#doc/…` references shown as chips. */
export function ChatRefTags({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { blocks } = useEditor();
  const { parts } = parseRefs(text);

  return (
    <span className={cn('ref-tags', className)} style={{ whiteSpace: 'pre-wrap', ...style }}>
      {parts.map((p, idx) => {
        if (typeof p === 'string') {
          return <Fragment key={idx}>{p}</Fragment>;
        }
        const isDoc = p.kind === 'document';
        const title = isDoc
          ? `Document: ${p.docId}`
          : p.source === 'this'
            ? `Block in this doc: ${p.blockId}`
            : `Block ${p.blockId} in Document ${p.docId}`;

        // One chip class shared with the composer: a reference has to look the
        // same being written as it does once sent.
        return (
          <span
            key={idx}
            className={cn('ref-chip mx-0.5 cursor-default', isDoc ? 'ref-chip--doc' : 'ref-chip--block')}
            title={title}
          >
            <span className="ref-chip-label">{refLabel(p, blocks)}</span>
          </span>
        );
      })}
    </span>
  );
}
