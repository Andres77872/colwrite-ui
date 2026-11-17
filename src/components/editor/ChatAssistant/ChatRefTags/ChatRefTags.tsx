import { Fragment, useState, type CSSProperties } from 'react';
import { useEditorDoc } from '../../../../editor';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useOpenPageLink, usePageLinkTarget } from '@/actions/usePageLink';
import { PageLinkStatus } from '@/components/workspace/PageLinkStatus';
import { parseRefs, refLabel, type ChatRefTag } from './refTags';

/**
 * A sent message, with its `#this/…` and `#doc/…` references shown as chips.
 * A chip naming a page is a button: it says where that page is, opening it
 * in place or, for a page of another workspace, in that workspace
 * ("This page is in another workspace"), so a reference never opens another
 * workspace's page here (M5.UI-2).
 */
export function ChatRefTags({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { blocks } = useEditorDoc();
  const { parts } = parseRefs(text);

  return (
    <span className={cn('ref-tags', className)} style={{ whiteSpace: 'pre-wrap', ...style }}>
      {parts.map((p, idx) => {
        if (typeof p === 'string') {
          return <Fragment key={idx}>{p}</Fragment>;
        }
        const isDoc = p.kind === 'document';
        const title = isDoc
          ? `Page: ${p.docId}`
          : p.source === 'this'
            ? `Block on this page: ${p.blockId}`
            : `Block ${p.blockId} on page ${p.docId}`;
        const label = refLabel(p, blocks);

        if (p.docId) return <PageRefChip key={idx} reference={p} label={label} title={title} />;

        // One chip class shared with the composer: a reference has to look the
        // same being written as it does once sent.
        return (
          <span
            key={idx}
            className={cn('ref-chip mx-0.5 cursor-default', isDoc ? 'ref-chip--doc' : 'ref-chip--block')}
            title={title}
          >
            <span className="ref-chip-label">{label}</span>
          </span>
        );
      })}
    </span>
  );
}

/** A reference to a page (or a block of one): where it is, read when its popover opens. */
function PageRefChip({ reference, label, title }: { reference: ChatRefTag; label: string; title: string }) {
  const documentId = reference.docId ?? '';
  const [open, setOpen] = useState(false);
  const target = usePageLinkTarget(documentId, open);
  const openLink = useOpenPageLink();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn('ref-chip mx-0.5', reference.kind === 'document' ? 'ref-chip--doc' : 'ref-chip--block')}
          title={title}
          aria-haspopup="dialog"
        >
          <span className="ref-chip-label">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <PageLinkStatus
          target={target}
          onOpen={async () => {
            await openLink(documentId);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
