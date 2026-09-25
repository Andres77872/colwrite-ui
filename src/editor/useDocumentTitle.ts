import { useCallback } from 'react';
import { useToast } from '@/components/ui/toastContext';
import { useEditor } from './editorContextState';

/** The name a document gets when it has none. Lists and exports show it. */
export const DEFAULT_DOCUMENT_TITLE = 'Untitled document';

/**
 * Selector for the in-page title, so chrome elsewhere (the topbar breadcrumb)
 * can move focus into it without holding a ref.
 */
export const PAGE_TITLE_SELECTOR = '[data-page-title]';

export type DocumentTitle = {
  /** What to show: the document's name, or the default when it has none. */
  title: string;
  /**
   * What an editable title should hold: empty while the document still
   * carries the default name, so the field shows its "Untitled" placeholder.
   */
  draftTitle: string;
  /** True while the document has no name of its own. */
  isUntitled: boolean;
  /**
   * Rename the document and save it. A blank name falls back to the default;
   * an unchanged one is a no-op. A failed save keeps the local rename and
   * says so in a toast, so callers do not handle errors.
   */
  rename: (next: string) => Promise<void>;
  /** Move the caret into the in-page title. Returns false when none is mounted. */
  focusPageTitle: () => boolean;
};

/**
 * The document title's single source of truth, shared by the in-page title
 * and the topbar breadcrumb.
 */
export function useDocumentTitle(): DocumentTitle {
  const { doc, setDocName, saveRemote } = useEditor();
  const { toast } = useToast();

  const name = doc.name?.trim() ?? '';
  const isUntitled = !name || name === DEFAULT_DOCUMENT_TITLE;
  const title = name || DEFAULT_DOCUMENT_TITLE;

  const rename = useCallback(
    async (next: string) => {
      const normalized = next.replace(/\s+/g, ' ').trim() || DEFAULT_DOCUMENT_TITLE;
      if (normalized === title) return;
      setDocName(normalized);
      try {
        // Pass the new name explicitly: `doc` in this closure still holds the
        // previous title when the save fires.
        await saveRemote({ ...doc, name: normalized });
      } catch (error) {
        toast({
          title: 'Renamed locally, but the save failed',
          description: error instanceof Error ? error.message : undefined,
          variant: 'error',
        });
      }
    },
    [doc, saveRemote, setDocName, title, toast],
  );

  return { title, draftTitle: isUntitled ? '' : title, isUntitled, rename, focusPageTitle };
}

export function focusPageTitle(): boolean {
  const el = document.querySelector<HTMLElement>(PAGE_TITLE_SELECTOR);
  if (!el) return false;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  el.scrollIntoView({ block: 'nearest' });
  return true;
}
