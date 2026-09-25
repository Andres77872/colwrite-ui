import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useEditor } from '@/editor';
import { Skeleton } from '@/components/ui/spinner';
import { DOCUMENT_TRANSITION_START_EVENT } from '@/editor/documentTransition';

const SWITCH_SKELETON_DELAY_MS = 150;

type WorkspaceSnapshot = {
  documentId: string | null;
  scrollTop: number;
  focus: HTMLElement | null;
};

/**
 * One stable busy region around the document-bound workspace.
 *
 * The committed tree never unmounts during a request. It is frozen at once,
 * then covered after a short delay for an in-app switch; hydration that was
 * already pending on first render gets the skeleton immediately.
 */
export function DocumentLoadingBoundary({
  children,
  regionRef,
}: {
  children: React.ReactNode;
  regionRef: RefObject<HTMLDivElement | null>;
}) {
  const { documentId, loadingDocumentId } = useEditor();
  const pending = loadingDocumentId !== null;
  const [skeletonState, setSkeletonState] = useState(() => ({
    documentId: loadingDocumentId,
    visible: pending,
  }));
  if (!pending && skeletonState.documentId !== null) {
    setSkeletonState({ documentId: null, visible: false });
  } else if (pending && skeletonState.documentId !== loadingDocumentId) {
    setSkeletonState({ documentId: loadingDocumentId, visible: false });
  }
  const showSkeleton = pending
    && skeletonState.documentId === loadingDocumentId
    && skeletonState.visible;
  const wasPending = useRef(false);
  const lastCommittedDocumentId = useRef(documentId);
  const snapshot = useRef<WorkspaceSnapshot | null>(null);

  useEffect(() => {
    const capture = () => {
      const region = regionRef.current;
      const canvas = region?.querySelector<HTMLElement>('.canvas') ?? null;
      const active = document.activeElement;
      snapshot.current = {
        documentId,
        scrollTop: canvas?.scrollTop ?? 0,
        focus:
          active instanceof HTMLElement && region?.contains(active)
            ? active
            : null,
      };
    };
    window.addEventListener(DOCUMENT_TRANSITION_START_EVENT, capture);
    return () => window.removeEventListener(DOCUMENT_TRANSITION_START_EVENT, capture);
  }, [documentId, regionRef]);

  useEffect(() => {
    if (!pending || showSkeleton || skeletonState.documentId !== loadingDocumentId) return;
    const timer = window.setTimeout(() => {
      setSkeletonState((current) => (
        current.documentId === loadingDocumentId
          ? { ...current, visible: true }
          : current
      ));
    }, SWITCH_SKELETON_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loadingDocumentId, pending, showSkeleton, skeletonState.documentId]);

  useLayoutEffect(() => {
    const region = regionRef.current;
    const canvas = region?.querySelector<HTMLElement>('.canvas') ?? null;

    if (pending && !wasPending.current && snapshot.current === null) {
      const active = document.activeElement;
      snapshot.current = {
        documentId,
        scrollTop: canvas?.scrollTop ?? 0,
        focus:
          active instanceof HTMLElement && region?.contains(active)
            ? active
            : null,
      };
    }

    if (!pending && wasPending.current) {
      const previous = snapshot.current;
      if (previous && previous.documentId === documentId) {
        // The request failed: reveal the exact committed view the author left.
        if (canvas) canvas.scrollTop = previous.scrollTop;
        if (previous.focus?.isConnected) previous.focus.focus({ preventScroll: true });
      } else {
        // A different body committed. Selection and position belong to the old
        // document and only become invalid at this point.
        document.getSelection()?.removeAllRanges();
        if (canvas) canvas.scrollTop = 0;
      }
      snapshot.current = null;
    } else if (!pending && lastCommittedDocumentId.current !== documentId) {
      // Synchronous commits such as New/Create have no loading id, but the old
      // document's DOM selection and scroll still must not cross identities.
      document.getSelection()?.removeAllRanges();
      if (canvas) canvas.scrollTop = 0;
      snapshot.current = null;
    }

    if (!pending) lastCommittedDocumentId.current = documentId;
    wasPending.current = pending;
  }, [documentId, pending, regionRef]);

  return (
    <div
      ref={regionRef}
      tabIndex={-1}
      className="relative flex min-h-0 flex-1 flex-col outline-none"
      aria-busy={pending}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {pending ? 'Opening document…' : ''}
      </p>
      <div
        inert={pending}
        aria-hidden={showSkeleton || undefined}
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          pending && 'pointer-events-none select-none',
          showSkeleton && 'invisible absolute inset-0 overflow-hidden',
        )}
      >
        {children}
      </div>
      {showSkeleton && <DocumentSkeleton />}
    </div>
  );
}

/**
 * Layout-matched, deterministic placeholder: the page topbar, the 40px page
 * title and a prose silhouette in the same column the page uses — so the
 * text lands where the skeleton was instead of jumping.
 */
export function DocumentSkeleton() {
  const rows = [
    { kind: 'heading', width: '46%' },
    { kind: 'prose', width: '96%' },
    { kind: 'prose', width: '88%' },
    { kind: 'prose', width: '72%' },
    { kind: 'heading', width: '38%' },
    { kind: 'prose', width: '93%' },
    { kind: 'prose', width: '81%' },
    { kind: 'prose', width: '64%' },
  ] as const;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      aria-hidden="true"
      data-testid="document-skeleton"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Skeleton className="size-4" />
        <Skeleton className="h-3.5 w-40 sm:w-56" />
        <div className="ml-auto flex items-center gap-1.5">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="hidden size-6 sm:block" />
          <Skeleton className="hidden size-6 sm:block" />
          <Skeleton className="size-6" />
        </div>
      </div>

      {/* Named like the canvas so the page's container queries size the
          column exactly as they will once the document is in. */}
      <div className="@container/canvas min-h-0 flex-1 overflow-hidden">
        <div className="document-container">
          <div className="page-title">
            <Skeleton className="h-[0.9em] w-3/5 rounded-md" />
          </div>
          <div className="mt-6 space-y-5">
            {rows.map((row, index) => (
              <Skeleton
                key={`${row.kind}-${index}`}
                className={row.kind === 'heading' ? 'h-6' : 'h-4'}
                // Fixed widths keep the document silhouette stable between runs.
                style={{ width: row.width }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
