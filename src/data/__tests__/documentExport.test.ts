import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import * as session from '@/api/authEvents';
import { HttpResponse, http, pathOf, problem, recordRequests, server } from '@/__tests__/server';
import {
  describeLatexExportError,
  dispositionFilename,
  exportDocumentLatex,
} from '../documentExport';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';

afterEach(() => {
  vi.restoreAllMocks();
});

const TEX = '\\documentclass{article}\n\\begin{document}Hello\\end{document}\n';
const tex = (headers: Record<string, string> = {}) =>
  new HttpResponse(TEX, { status: 200, headers: { 'Content-Type': 'application/x-tex', ...headers } });

describe('exportDocumentLatex', () => {
  it('reads the LaTeX body as binary, with the cookie, and keeps the server’s file name', async () => {
    const sent = recordRequests();
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/export', ({ response }) => response.untyped(tex({
      'Content-Disposition': `attachment; filename="Resume.tex"; filename*=UTF-8''R%C3%A9sum%C3%A9.tex`,
    }))));

    const result = await exportDocumentLatex(TEST_WORKSPACE_ID, '66f0c0ffee');

    expect(result.filename).toBe('Résumé.tex');
    expect(result.blob.type).toBe('application/x-tex');
    expect(await result.blob.text()).toBe(TEX);
    expect(pathOf(sent[0])).toBe(`/api/workspaces/${TEST_WORKSPACE_ID}/documents/66f0c0ffee/export?format=tex`);
    expect(sent[0]?.credentials).toBe('include');
  });

  it('rotates an expired session once and replays the export', async () => {
    let exports = 0;
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/export', ({ response }) => {
      exports += 1;
      return exports === 1 ? problem('unauthorized', 'Missing session token') : response.untyped(tex());
    }));

    const result = await exportDocumentLatex(TEST_WORKSPACE_ID, 'doc');

    expect(exports).toBe(2);
    expect(await result.blob.text()).toBe(TEX);
  });

  it('raises the API’s detail as an ApiError and asks for sign-in on 403', async () => {
    const emit = vi.spyOn(session, 'emitRequireLogin').mockImplementation(() => {});
    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/export', () => problem('export_failed', 'Document could not be exported')));
    await expect(exportDocumentLatex(TEST_WORKSPACE_ID, 'doc')).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      message: 'Document could not be exported',
    });
    expect(emit).not.toHaveBeenCalled();

    server.use(http.get('/workspaces/{workspace_id}/documents/{document_id}/export', () => problem('forbidden')));
    await expect(exportDocumentLatex(TEST_WORKSPACE_ID, 'doc')).rejects.toBeInstanceOf(ApiError);
    expect(emit).toHaveBeenCalledWith('forbidden');
  });
});

describe('LaTeX export helpers', () => {
  it('reads both forms of Content-Disposition', () => {
    expect(dispositionFilename('attachment; filename="paper.tex"')).toBe('paper.tex');
    expect(dispositionFilename(`attachment; filename="x.tex"; filename*=UTF-8''%E8%AB%96%E6%96%87.tex`)).toBe('論文.tex');
    expect(dispositionFilename(null)).toBeNull();
  });

  it('words the API’s failures for the author, by their codes', () => {
    const failure = (code: string, status: number) => new ApiError(code, status, { code, retryable: false });
    expect(describeLatexExportError(failure('export_failed', 422))).toContain('Inline code');
    expect(describeLatexExportError(failure('document_validation_failed', 422))).toContain('could not read the saved page');
    expect(describeLatexExportError(failure('document_not_found', 404))).toContain('Save it');
    expect(describeLatexExportError(failure('schema_unsupported', 409))).toContain('newer format');
    expect(describeLatexExportError(failure('export_unavailable', 503))).toBe('The server could not export the page just now.');
    expect(describeLatexExportError(new TypeError('Failed to fetch'))).toBe(
      'The server could not be reached. Check your connection.',
    );
  });
});
