import { useCallback } from 'react';
import type { ParagraphChild } from '@/editor';
import { serializeEditableHtml } from '@/components/common/Editable/Editable';
import type { InlineWidgetProps } from '../types';

/**
 * The two operations every inline widget needs, written once.
 *
 * All five widgets used to carry their own copy of "remove the placeholder,
 * drop the child, reserialize the paragraph" — four statements that have to
 * happen in that order, duplicated five times, and the ordering matters: drop
 * the child before the span is gone and the paragraph is briefly invalid.
 *
 * `patch` writes straight through to the document. The widgets used to hold a
 * shadow copy of their own fields in `useState` and flush it on a timer, which
 * meant the rendered widget and the stored child disagreed for as long as the
 * timer ran — and an edit arriving from anywhere else (an accepted agent
 * change, an undo) was overwritten by the stale local copy on the next flush.
 */
export function useInlineChild<TChild extends ParagraphChild>({
  blockId,
  child,
  updateParagraphChild,
  removeParagraphChild,
  updateHtml,
  refs,
}: InlineWidgetProps<TChild>) {
  const patch = useCallback(
    (next: Partial<TChild>) => {
      updateParagraphChild(blockId, child.id, next as Partial<ParagraphChild>);
    },
    [blockId, child.id, updateParagraphChild],
  );

  const remove = useCallback(() => {
    const host = refs.current[blockId];
    // Take the placeholder out of the live DOM first: the contenteditable is
    // the source of truth for html, so serializing before this would write the
    // span straight back in.
    host?.querySelector(`[data-child-id="${child.id}"]`)?.remove();
    removeParagraphChild(blockId, child.id);
    if (host) updateHtml(blockId, serializeEditableHtml(host));
  }, [blockId, child.id, refs, removeParagraphChild, updateHtml]);

  return { patch, remove };
}
