import { buildUrl, ensureRefreshed, getRefreshGeneration } from './api';
import { ApiError, isUnknownRecord } from './contracts';
import { emitRequireLogin } from './session';

/**
 * `GET /document/export/{document_id}?format=tex` — the server's LaTeX export.
 *
 * It renders the document as last saved, not what is on screen, so callers
 * save first. The body is UTF-8 LaTeX source (`application/x-tex`), which the
 * JSON helpers in `api.ts` cannot carry: they parse every body as JSON and
 * drop anything else. This request therefore reads the text itself, with the
 * same cookie credentials and the same refresh-once-on-401 rule.
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
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      /* fall through to the ASCII form */
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  return plain?.[1]?.trim() || null;
}

function errorFrom(response: Response, text: string): ApiError {
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  const detail = isUnknownRecord(data) && typeof data.detail === 'string' ? data.detail : null;
  return new ApiError(detail ?? response.statusText, response.status, data);
}

export async function exportDocumentLatex(
  documentId: string,
  init: { signal?: AbortSignal } = {},
): Promise<LatexExport> {
  const path = `/document/export/${encodeURIComponent(documentId)}?format=tex`;
  const url = buildUrl(path);
  const request: RequestInit = { method: 'GET', credentials: 'include', signal: init.signal };

  const generation = getRefreshGeneration();
  let response = await fetch(url, request);
  // The access cookie is short-lived; rotate once and replay, as api.ts does.
  if (response.status === 401 && (await ensureRefreshed(generation))) {
    response = await fetch(url, request);
  }

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      emitRequireLogin(response.status === 403 ? 'forbidden' : 'expired');
    }
    throw errorFrom(response, text);
  }
  return { source: text, filename: dispositionFilename(response.headers.get('Content-Disposition')) };
}

/** What a failed LaTeX export means for the author, by the API's statuses. */
export function describeLatexExportError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'The server has no saved copy of this document yet. Save it and try again.';
    if (error.status === 409) return 'This document was saved in a newer format than the LaTeX export understands.';
    if (error.status === 422) {
      return error.message === 'Document content is invalid'
        ? 'The server could not read the saved document, so it could not be exported.'
        : 'The LaTeX export cannot render part of this document. Inline code, strikethrough, highlighted or small text, and some equations are not supported there yet. Remove them, or export Markdown or HTML instead.';
    }
    if (error.status === 401 || error.status === 403) return 'Sign in again to export from the server.';
    if (error.status >= 500) return 'The server could not export the document just now.';
    return error.message || 'The LaTeX export failed.';
  }
  if (error instanceof DOMException && error.name === 'AbortError') return 'The export was cancelled.';
  return 'The server could not be reached. Check your connection.';
}
