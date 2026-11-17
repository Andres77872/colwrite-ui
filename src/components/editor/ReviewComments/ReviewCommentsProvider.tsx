import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDocumentId, useEditorDoc } from '@/editor';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useWorkspaceAccess } from '@/components/workspace/workspaceAccess';
import { decideReviewComment, reviewCommentsQuery, reviewKeys, type ReviewComment } from '@/data/reviews';
import { clearHighlight, setHighlight } from '@/lib/highlights';
import { revealElement } from '@/lib/reveal';
import { commentIsOutdated, exactQuoteRange } from './quote';
import { ReviewCommentsContext } from './reviewCommentsContext';

const HIGHLIGHT = 'review-comment';

export function ReviewCommentsProvider({ children }: { children: ReactNode }) {
  const workspaceId = useWorkspaceId();
  const documentId = useDocumentId();
  const { blocks } = useEditorDoc();
  const { canEdit } = useWorkspaceAccess();
  const client = useQueryClient();
  const query = useInfiniteQuery({ ...reviewCommentsQuery(workspaceId, documentId ?? ''), enabled: Boolean(documentId) });
  const { isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const comments = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const [selection, setSelection] = useState<{ documentId: string; commentId: string } | null>(null);
  const focusedId = selection?.documentId === documentId ? selection.commentId : null;
  const focused = comments.find((comment) => comment.comment_id === focusedId);
  const { mutate, isPending: deciding, variables, error: decisionError } = useMutation({
    mutationFn: ({ comment, status }: { comment: ReviewComment; status: ReviewComment['status'] }) => {
      if (!canEdit || !documentId) throw new Error('Viewers can read comments, but cannot resolve or dismiss them.');
      return decideReviewComment(workspaceId, documentId, comment.comment_id, status);
    },
    onSuccess: (comment) => client.invalidateQueries({ queryKey: reviewKeys.comments(workspaceId, comment.document_id) }),
  });
  const decide = useCallback((comment: ReviewComment, status: ReviewComment['status']) => {
    if (canEdit) mutate({ comment, status });
  }, [canEdit, mutate]);
  const focus = useCallback((comment: ReviewComment) => {
    if (comment.document_id !== documentId || !documentId) return;
    setSelection({ documentId, commentId: comment.comment_id });
    const row = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(comment.block_id)}"]`);
    if (row) {
      row.tabIndex = -1;
      revealElement(row);
      row.focus({ preventScroll: true });
    }
  }, [documentId]);

  useEffect(() => {
    clearHighlight(HIGHLIGHT);
    if (!focused || commentIsOutdated(focused, blocks)) return;
    const row = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(focused.block_id)}"]`);
    const host = row?.querySelector<HTMLElement>('.editable') ?? row?.querySelector<HTMLElement>('.block-content');
    if (host) {
      const range = exactQuoteRange(host, focused.quote);
      if (range) setHighlight(HIGHLIGHT, range);
    }
    return () => clearHighlight(HIGHLIGHT);
  }, [focused, blocks]);

  const value = useMemo(() => ({
    comments, loading: isPending, error: isError, hasMore: hasNextPage,
    loadingMore: isFetchingNextPage, loadMore: () => { void fetchNextPage(); },
    focusedId, focus, decide, deciding: deciding && variables.comment.document_id === documentId ? variables.comment.comment_id : null,
    decisionError: decisionError && variables?.comment.document_id === documentId ? 'This comment could not be updated. Try again.' : null,
  }), [comments, isPending, isError, hasNextPage, isFetchingNextPage, fetchNextPage,
    focusedId, focus, decide, deciding, variables, decisionError, documentId]);
  return <ReviewCommentsContext.Provider value={value}>{children}</ReviewCommentsContext.Provider>;
}
