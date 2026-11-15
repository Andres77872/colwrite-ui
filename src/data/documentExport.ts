import { api, unwrapWithHeaders } from '@/api/client';
import { ApiError, problemCode } from '@/api/errors';

/**
 * `GET /workspaces/{w}/documents/{d}/export?format=tex` — the server's LaTeX export.
 *
 * It renders the document as last saved, not what is on screen, so callers
 * save first. The body is UTF-8 LaTeX source (`application/x-tex`), read as
 * text; the file name is in `Content-Disposition`.
 *
 * Contract: ColWrite-api `docs/document.md#latex-and-pdf-document-export`.
 */
export type LatexExport = {
  source: string;
  /** From `Content-Disposition` (the UTF-8 `filename*` form first). */
  filename: string | null;
};

/** The server's own file name, when it sent one. */
export function dispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      /* fall through to the ASCII form */
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  return plain?.[1]?.trim() || null;
}

export async function exportDocumentLatex(
  workspaceId: string,
  documentId: string,
  init: { signal?: AbortSignal } = {},
): Promise<LatexExport> {
  const { data, headers } = await unwrapWithHeaders(api.GET('/workspaces/{workspace_id}/documents/{document_id}/export', {
    params: { path: { workspace_id: workspaceId, document_id: documentId }, query: { format: 'tex' } },
    parseAs: 'text',
    signal: init.signal,
  }));
  return { source: data, filename: dispositionFilename(headers.get('Content-Disposition')) };
}

/** What a failed LaTeX export means for the author, by the API's problem codes. */
export function describeLatexExportError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (problemCode(error)) {
      case 'document_not_found':
        return 'The server has no saved copy of this page yet. Save it and try again.';
      case 'schema_unsupported':
        return 'This page was saved in a newer format than the LaTeX export understands.';
      case 'document_validation_failed':
        return 'The server could not read the saved page, so it could not be exported.';
      case 'export_failed':
        return 'The LaTeX export cannot render part of this page. Inline code, strikethrough, highlighted or small text, and some equations are not supported there yet. Remove them, or export Markdown or HTML instead.';
    }
    if (error.status === 401 || error.status === 403) return 'Sign in again to export from the server.';
    if (error.status >= 500) return 'The server could not export the page just now.';
    return error.message || 'The LaTeX export failed.';
  }
  if (error instanceof DOMException && error.name === 'AbortError') return 'The export was cancelled.';
  return 'The server could not be reached. Check your connection.';
}
