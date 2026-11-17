import { createContext, useContext } from 'react';
import type { ReviewComment } from '@/data/reviews';

export type ReviewComments = {
  comments: ReviewComment[];
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  focusedId: string | null;
  focus: (comment: ReviewComment) => void;
  decide: (comment: ReviewComment, status: ReviewComment['status']) => void;
  deciding: string | null;
  decisionError: string | null;
};
export const ReviewCommentsContext = createContext<ReviewComments | null>(null);
export const useReviewComments = () => useContext(ReviewCommentsContext);
