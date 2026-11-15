import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { describeApiError, problemCode } from '@/api/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useTrash, type CollectionToTrash } from '@/actions/useTrash';
import { collectionDetailQuery, type CollectionTrashPreview } from '@/data/resources';
import { trashPreviewSentence } from './trashCopy';

const CHANGED = 'This collection changed since you opened this. Check what it holds now, then move it to Trash again.';

/**
 * "Move to Trash" for a collection (08 §6.5): what it takes with it, read
 * from the server before anything is sent, and one button to confirm. No
 * typed name, because the Trash gives it back. The counts go back with the
 * request; when the collection holds something else by then
 * (`preview_changed`), or was changed (`stale_collection`), the new counts
 * are shown and the author confirms again.
 */
export function CollectionTrashDialog({
  collection,
  onOpenChange,
  onTrashed,
  returnFocusRef,
}: {
  collection: CollectionToTrash;
  onOpenChange: (open: boolean) => void;
  /** After the server took it: the caller moves away from it. */
  onTrashed?: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { previewCollection, trashCollection } = useTrash();
  const [preview, setPreview] = useState<CollectionTrashPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    previewCollection(collection.id, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setPreview(value);
        requestAnimationFrame(() => confirmRef.current?.focus());
      },
      (caught: unknown) => {
        if (!controller.signal.aborted) setLoadError(describeApiError(caught, 'Could not see what it holds.'));
      },
    );
    return () => controller.abort();
  }, [collection.id, previewCollection]);

  const confirm = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      await trashCollection(collection, preview);
      onTrashed?.();
      onOpenChange(false);
      return;
    } catch (caught) {
      const code = problemCode(caught);
      if (code === 'preview_changed' || code === 'stale_collection') {
        try {
          // The collection's ETag and its counts, as they are now.
          await queryClient.fetchQuery({ ...collectionDetailQuery(workspaceId, collection.id), staleTime: 0 });
          setPreview(await previewCollection(collection.id));
          setChanged(true);
        } catch (again) {
          setError(describeApiError(again, 'Could not see what it holds now.'));
        }
      } else {
        setError(describeApiError(caught, 'Could not move it to Trash.'));
      }
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (confirmRef.current ?? cancelRef.current)?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="break-words">Move {collection.name} to Trash?</DialogTitle>
          <DialogDescription aria-live="polite">
            {preview ? trashPreviewSentence(collection.name, preview) : loadError ? '' : 'Checking what it holds…'}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-3 space-y-3 empty:hidden">
          {!preview && !loadError && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-hidden="true">
              <Spinner /> Checking what it holds…
            </p>
          )}
          {changed && <Alert variant="warning">{CHANGED}</Alert>}
          {(loadError ?? error) && <Alert variant="destructive">{loadError ?? error}</Alert>}
        </div>
        <DialogFooter className="mt-5">
          <Button ref={cancelRef} variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button ref={confirmRef} disabled={!preview || busy} onClick={() => void confirm()}>
            {busy ? <Spinner /> : <Trash2 aria-hidden="true" />}
            Move to Trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
