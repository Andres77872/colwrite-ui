import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { useDocumentId } from '@/editor';
import { useToast } from '@/components/ui/toastContext';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { describeApiError } from '@/api/errors';
import { pdfOfferDismissedKey, readItem, writeItem } from '@/lib/storageKeys';
import { pagePlacementQuery } from '@/data/documents';
import {
  collectionDetailQuery,
  grantStateOf,
  pdfGrantsQuery,
  useCollectionMutations,
} from '@/data/resources';

/**
 * "Use this collection's PDFs on this page" (D12, M3.UI-7).
 *
 * A page's home says where it is listed, not what its assistant reads, so a
 * page in a collection with PDFs does not read them by itself. The composer
 * offers it instead, once per page: accepting adds one ordinary grant on the
 * collection; "Not now" is remembered for this page on this device. It is
 * not offered once the page can read the collection's PDFs.
 */
export function CollectionPdfOffer() {
  const workspaceId = useWorkspaceId();
  const documentId = useDocumentId();
  const { toast } = useToast();
  const { setUsed } = useCollectionMutations(workspaceId);
  const [dismissed, setDismissed] = useState<{ documentId: string | null; value: boolean }>({ documentId: null, value: false });
  const [busy, setBusy] = useState(false);

  const placement = useQuery({ ...pagePlacementQuery(workspaceId, documentId ?? ''), enabled: documentId !== null });
  const homeId = documentId ? (placement.data?.collectionId ?? null) : null;
  const home = useQuery({ ...collectionDetailQuery(workspaceId, homeId ?? 0), enabled: homeId !== null });
  const grants = useQuery({ ...pdfGrantsQuery(workspaceId, documentId ?? ''), enabled: homeId !== null && documentId !== null });

  // Read once per page: what the author said for this page stays said.
  if (dismissed.documentId !== documentId) {
    setDismissed({ documentId, value: documentId ? readItem(pdfOfferDismissedKey(workspaceId, documentId)) !== null : false });
  }

  const collection = home.data;
  if (!documentId || !collection || !grants.data || dismissed.value) return null;
  if (collection.subtree_pdf_count === 0) return null;
  if (grantStateOf(collection.path, grants.data).effective) return null;

  const count = collection.subtree_pdf_count;
  const accept = async () => {
    setBusy(true);
    try {
      await setUsed({ collectionId: collection.id, used: true, documentId });
      toast({ title: `This page now uses ${collection.name}`, variant: 'success' });
    } catch (error) {
      toast({ title: 'Could not use the collection’s PDFs', description: describeApiError(error, 'The server refused it.'), variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => {
    writeItem(pdfOfferDismissedKey(workspaceId, documentId), '1');
    setDismissed({ documentId, value: true });
  };

  return (
    <div
      role="group"
      aria-label="Use this collection’s PDFs on this page"
      className="mx-2 mt-2 flex items-start gap-2 rounded-md bg-tint-blue py-1.5 pl-2 pr-1 text-xs text-tint-blue-fg"
    >
      <BookOpen aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p className="min-w-0 flex-1">
        Use this collection’s PDFs on this page?{' '}
        <span className="opacity-80">
          {collection.name} holds {count.toLocaleString()} PDF{count === 1 ? '' : 's'}; the assistant reads them only if you say so.
        </span>
      </p>
      <span className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void accept()}
          className="inline-flex h-6 items-center rounded px-1.5 font-medium outline-none transition-colors hover:bg-background/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          Use on this page
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={dismiss}
          className="inline-flex h-6 items-center rounded px-1.5 outline-none transition-colors hover:bg-background/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Not now
        </button>
      </span>
    </div>
  );
}
