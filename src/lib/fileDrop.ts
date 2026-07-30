/**
 * Shared vocabulary for file drop zones.
 *
 * There are two of them — the library panel's and the account dashboard's —
 * and they drifted: the dashboard checked neither that the drag actually
 * carried files nor whether the pointer had really left the zone, so its
 * highlight flickered whenever the pointer crossed a child node and it lit up
 * for a text selection drag. Both now share these guards, and the PDF filter
 * that used to exist only on the library side.
 */

/** The `accept` string for a PDF file input. Both zones must agree. */
export const PDF_ACCEPT = 'application/pdf,.pdf';

/**
 * Whether a drag carries files at all.
 *
 * `types` is the only thing readable during dragover — `files` is empty until
 * drop in most browsers — so check the type list first and treat a populated
 * `files` list as a fallback for the drop event itself.
 */
export function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types ?? []);
  return types.includes('Files') || dataTransfer.files.length > 0;
}

/**
 * Whether a dragleave means the pointer truly left the zone.
 *
 * dragleave fires every time the pointer crosses into a descendant, so without
 * this the highlight strobes as the pointer moves over the zone's own text and
 * button.
 */
export function pointerLeftElement(
  currentTarget: Element,
  relatedTarget: EventTarget | null,
): boolean {
  return !currentTarget.contains(relatedTarget as Node | null);
}

/** A PDF by declared type or, when the browser offers none, by extension. */
export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/**
 * Split a selection into the PDFs worth uploading and a count of the rest.
 *
 * Filtering client-side is not a substitute for the server's validation — it
 * rejects anything that is not a real PDF regardless of what the browser
 * labelled it — but it means dropping a folder of mixed files reports one
 * clear "these were skipped" instead of a row of server rejections.
 */
export function partitionPdfs(files: FileList | File[] | null): {
  pdfs: File[];
  skipped: number;
} {
  const chosen = Array.from(files ?? []);
  const pdfs = chosen.filter(isPdf);
  return { pdfs, skipped: chosen.length - pdfs.length };
}

/** One plural-correct message for the skipped files, or null when none were. */
export function skippedNonPdfMessage(skipped: number): { title: string; description: string } | null {
  if (skipped <= 0) return null;
  return {
    title: `Skipped ${skipped} file${skipped === 1 ? '' : 's'}`,
    description: 'Only PDFs can be added to your library.',
  };
}
