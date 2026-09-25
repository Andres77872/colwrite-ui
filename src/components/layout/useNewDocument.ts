import { useCallback, useState } from 'react';
import { DEFAULT_DOCUMENT_TITLE, focusPageTitle, useEditor } from '@/editor';
import { useToast } from '@/components/ui/toastContext';

/**
 * The one "New page" action.
 *
 * There used to be three with two meanings: the sidebar created a document
 * on the server, while the header and the palette reset the editor to a local
 * draft — which dropped any edit still inside the five-second autosave window.
 * `createAndSwitch` flushes pending edits of the open document before it
 * creates the next one, so every entry point now gets that guarantee.
 */
export function useNewDocument() {
  const { createAndSwitch, loadingDocumentId } = useEditor();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);

  const createDocument = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      await createAndSwitch({ version: 1, name: DEFAULT_DOCUMENT_TITLE, blocks: [] });
      // Keyboard-first, as in Notion: the caret waits in the new page's
      // title. The title mounts with the new document, a frame or two after
      // the switch commits, so try for a few frames.
      focusTitleSoon();
    } catch (error) {
      toast({
        title: 'Could not create document',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setCreating(false);
    }
  }, [createAndSwitch, creating, toast]);

  return {
    createDocument,
    creating,
    /** A switch in flight owns the editor; creating would race it. */
    disabled: creating || Boolean(loadingDocumentId),
  };
}

function focusTitleSoon(attempts = 10) {
  requestAnimationFrame(() => {
    if (focusPageTitle()) return;
    if (attempts > 1) focusTitleSoon(attempts - 1);
  });
}
