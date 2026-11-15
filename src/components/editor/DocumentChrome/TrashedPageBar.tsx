import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDocumentId, useDocumentStatus, useEditorDoc, usePageReadOnly } from '@/editor';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { restoreRefusal, useTrash } from '@/actions/useTrash';
import { collectionKeys, type CollectionDetail } from '@/data/resources';
import { purgeLabel } from '@/components/collections/trashCopy';

/** The answer is 44px tall on touch, as the save-recovery bar's are. */
const ANSWER = 'pointer-coarse:h-11 pointer-coarse:px-3.5';

/**
 * "This page is in the Trash" (08 §6.5): the open page was moved there, here,
 * from another tab or with its collection. Saving stops until it is back;
 * the bar stays until it is, and Restore brings back what took it there: the
 * page, or its collection with everything in it. Edits made meanwhile wait,
 * and are saved once it is restored.
 */
export function TrashedPageBar() {
  const { inTrash } = useDocumentStatus();
  const documentId = useDocumentId();
  const { doc } = useEditorDoc();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { restore } = useTrash();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A viewer restores nothing (D6).
  const readOnly = usePageReadOnly();

  if (!inTrash || !documentId) return null;
  const { trashRoot } = inTrash;
  const withCollection = trashRoot.kind === 'collection';
  const collectionName = withCollection
    ? queryClient.getQueryData<CollectionDetail>(collectionKeys.detail(workspaceId, Number(trashRoot.id)))?.name ?? null
    : null;
  const purge = purgeLabel(inTrash.purgeAfter);

  const onRestore = async () => {
    setBusy(true);
    setError(null);
    try {
      await restore(withCollection
        ? { kind: 'collection', id: trashRoot.id, name: collectionName ?? 'the collection' }
        : { kind: 'document', id: documentId, name: doc.name ?? '' });
    } catch (caught) {
      setError(restoreRefusal(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-tint-red px-4 py-2 text-sm text-tint-red-fg"
    >
      <Trash2 aria-hidden="true" className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 basis-64">
        <strong className="font-medium">This page is in the Trash.</strong>{' '}
        {withCollection
          ? `It went there with ${collectionName ?? 'its collection'}. `
          : ''}
        {readOnly ? 'An editor can restore it from the Trash.' : 'Changes are not saved until it is restored.'}{purge ? ` ${purge}.` : ''}
        {error && <span className="mt-1 block">{error}</span>}
      </p>
      {!readOnly && (
        <Button size="sm" variant="outline" className={ANSWER} disabled={busy} onClick={() => void onRestore()}>
          {busy ? 'Restoring…' : withCollection ? `Restore ${collectionName ?? 'the collection'}` : 'Restore'}
        </Button>
      )}
    </div>
  );
}
