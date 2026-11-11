import { useEffect } from 'react';
import { useEditor } from '@/editor';
import { useToast } from '@/components/ui/toastContext';
import { isFileDrag, unplaceableFileMessage } from '@/lib/fileDrop';
import { APP_NAME } from '@/components/common/Brand';
import type { AppView } from './viewContextState';
import { displayTitle } from './displayTitle';

/**
 * Keep the tab title describing what is on screen.
 *
 * It was the static string from index.html, so a window of ColWrite tabs was
 * indistinguishable — and the document you were editing, the one thing that
 * differs between them, was the part not shown.
 */
export function useDocumentTitle(view: AppView) {
  const { doc } = useEditor();
  // "Untitled", as the sidebar and breadcrumb call a page with no name.
  const name = doc ? displayTitle(doc.name) : '';

  useEffect(() => {
    if (view === 'profile') {
      document.title = `Settings — ${APP_NAME}`;
      return;
    }
    document.title = name ? `${name} — ${APP_NAME}` : APP_NAME;
  }, [name, view]);
}

/**
 * Warn before closing with an edit still queued.
 *
 * Autosave is debounced by five seconds and there was no guard at all, so
 * closing the tab mid-debounce dropped the last edit silently.
 */
export function useUnsavedGuard() {
  const { hasPendingEdits } = useEditor();

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasPendingEdits()) return;
      // Both forms: `preventDefault` is the standard, `returnValue` is what
      // some browsers still check.
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasPendingEdits]);
}

/**
 * Catch a file dropped where nothing takes files.
 *
 * The browser's own answer to such a drop is to open the file in the tab,
 * which closes the document mid-sentence. The drop zones (library, assistant
 * composer) handle their own drops and stop them before they get here; any
 * other file drop is refused, with a line saying where the file can go.
 */
export function useStrayFileDropGuard() {
  const { toast } = useToast();

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (event.defaultPrevented || !isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    const onDrop = (event: DragEvent) => {
      if (event.defaultPrevented || !isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      toast({ ...unplaceableFileMessage(event.dataTransfer?.files ?? null), variant: 'warning' });
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [toast]);
}
