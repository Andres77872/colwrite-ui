import { MessageSquareText } from 'lucide-react';
import { usePanels } from '@/components/panels/panelsContextState';
import { useReviewComments } from './reviewCommentsContext';

export function CommentMarker({ blockId }: { blockId: string }) {
  const review = useReviewComments();
  const comments = review?.comments.filter((comment) => comment.block_id === blockId && comment.status === 'open') ?? [];
  const first = comments[0];
  return first ? <Marker count={comments.length} onFocus={() => review?.focus(first)} /> : null;
}

function Marker({ count, onFocus }: { count: number; onFocus: () => void }) {
  const panels = usePanels();
  return (
    <button type="button" className="absolute -right-7 top-1 inline-flex min-h-6 min-w-6 items-center justify-center gap-0.5 rounded-sm text-xs text-muted-foreground hover:bg-hover hover:text-foreground print:hidden"
      aria-label={`${count} review ${count === 1 ? 'comment' : 'comments'}`}
      title="Review comments"
      onClick={(event) => { event.stopPropagation(); panels.openSidebar('review'); onFocus(); }}>
      <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
      {count > 1 && <span>{count}</span>}
    </button>
  );
}
