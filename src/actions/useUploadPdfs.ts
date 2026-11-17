import { useCallback, useState } from 'react';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useToast } from '@/components/ui/toastContext';
import { partitionPdfs, skippedNonPdfMessage } from '@/lib/fileDrop';
import { describeApiError } from '@/api/errors';
import {
  useUploadResource,
  type ResourceAttachmentTarget,
  type ResourceItem,
} from '@/data/resources';

/**
 * Where an upload lands. The open page is a destination of its own: it is
 * saved first when it has never been saved, so it has an id to hold the PDF.
 */
export type PdfUploadTarget =
  | { kind: 'page' }
  | { kind: 'collection'; collectionId: number; name: string }
  | { kind: 'unfiled' };

export type PdfUploadOutcome = { stored: ResourceItem[]; failures: string[] };

/** The destination in the copy deck's words: "this page", "Chapter 2", "Unfiled". */
export function uploadPlace(target: PdfUploadTarget): string {
  switch (target.kind) {
    case 'page':
      return 'this page';
    case 'collection':
      return target.name;
    case 'unfiled':
      return 'Unfiled';
  }
}

/** The label every upload control shows before anything is uploaded. */
export function uploadLabel(target: PdfUploadTarget): string {
  return `Upload to: ${uploadPlace(target)}`;
}

/** Whether two targets name the same destination. */
export function sameUploadTarget(a: PdfUploadTarget, b: PdfUploadTarget): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'collection' || (b.kind === 'collection' && a.collectionId === b.collectionId);
}

const UNSAVED_PAGE_MESSAGE = 'This page could not be saved, so the PDF has nowhere to go. Try again.';

/**
 * The one way a PDF is uploaded: the Library and the chat composer both call
 * this, so every upload says where it goes before it goes there, and an upload
 * to a page that was never saved saves the page first.
 *
 * `upload` takes a selection or a drop, skips what is not a PDF and reports the
 * outcome in toasts. `uploadOne` is for a caller that shows each file's state
 * itself (the chat composer): it reports nothing and throws on failure.
 */
export function useUploadPdfs(
  target: PdfUploadTarget,
  { ensurePage }: { ensurePage: () => Promise<string | null> },
) {
  const { toast } = useToast();
  const uploadResource = useUploadResource(useWorkspaceId()).mutateAsync;
  const [inFlight, setInFlight] = useState(0);
  const kind = target.kind;
  const collectionId = target.kind === 'collection' ? target.collectionId : null;

  /** The API's attachment target; the page is saved first when it has no id. */
  const resolve = useCallback(async (): Promise<ResourceAttachmentTarget | null> => {
    if (kind === 'collection') return { collectionId };
    if (kind === 'unfiled') return {};
    const documentId = await ensurePage();
    return documentId ? { documentId } : null;
  }, [collectionId, ensurePage, kind]);

  const uploadOne = useCallback(
    async (file: File): Promise<ResourceItem> => {
      setInFlight((count) => count + 1);
      try {
        const where = await resolve();
        if (!where) throw new Error(UNSAVED_PAGE_MESSAGE);
        return await uploadResource({ file, target: where });
      } finally {
        setInFlight((count) => count - 1);
      }
    },
    [resolve, uploadResource],
  );

  const place = uploadPlace(target);
  const upload = useCallback(
    async (files: FileList | File[] | null): Promise<PdfUploadOutcome> => {
      const { pdfs, skipped } = partitionPdfs(files);
      const skippedMessage = skippedNonPdfMessage(skipped);
      if (skippedMessage) toast({ ...skippedMessage, variant: 'warning' });
      if (pdfs.length === 0) return { stored: [], failures: [] };

      setInFlight((count) => count + 1);
      const stored: ResourceItem[] = [];
      const failures: string[] = [];
      try {
        const where = await resolve();
        if (!where) {
          toast({ title: 'Could not upload to this page', description: UNSAVED_PAGE_MESSAGE, variant: 'error' });
          return { stored, failures: pdfs.map((file) => `${file.name}: ${UNSAVED_PAGE_MESSAGE}`) };
        }
        for (const file of pdfs) {
          try {
            stored.push(await uploadResource({ file, target: where }));
          } catch (error) {
            failures.push(`${file.name}: ${describeApiError(error, 'Upload failed')}`);
          }
        }
      } finally {
        setInFlight((count) => count - 1);
      }

      if (stored.length > 0) {
        toast({
          title: `Uploaded ${stored.length} PDF${stored.length === 1 ? '' : 's'} to ${place}`,
          description: 'Converting to text now.',
          variant: 'success',
        });
      }
      if (failures.length > 0) {
        toast({
          title: `${failures.length} PDF${failures.length === 1 ? '' : 's'} rejected`,
          description: failures.join(' · '),
          variant: 'error',
        });
      }
      return { stored, failures };
    },
    [place, resolve, toast, uploadResource],
  );

  return {
    target,
    place,
    label: uploadLabel(target),
    uploading: inFlight > 0,
    upload,
    uploadOne,
  };
}

export type PdfUploads = ReturnType<typeof useUploadPdfs>;
