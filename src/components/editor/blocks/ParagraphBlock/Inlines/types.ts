import type { MutableRefObject } from 'react';
import type { ParagraphChild } from '@/editor';

/**
 * Props shared by every inline paragraph widget.
 *
 * The same six-field object literal was written out in all five widget files;
 * `TChild` narrows `child` for the inner component once its type guard has run.
 */
export interface InlineWidgetProps<TChild extends ParagraphChild = ParagraphChild> {
  blockId: string;
  child: TChild;
  updateParagraphChild: (blockId: string, childId: string, next: Partial<ParagraphChild>) => void;
  removeParagraphChild: (blockId: string, childId: string) => void;
  updateHtml: (id: string, html: string) => void;
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
}

/** AiBeat additionally needs the document it streams against to exist. */
export interface AiBeatWidgetProps<TChild extends ParagraphChild = ParagraphChild>
  extends InlineWidgetProps<TChild> {
  documentId: string | null;
  ensureRemoteDocument: () => Promise<string | null>;
  waitForReady: (options?: {
    timeoutMs?: number;
    save?: boolean;
    signal?: AbortSignal;
  }) => Promise<{ ready: boolean; status: string }>;
}
