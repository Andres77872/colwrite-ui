import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../contracts';
import * as session from '../session';
import {
  describeLatexExportError,
  dispositionFilename,
  exportDocumentLatex,
} from '../documentExport';

afterEach(() => {
  vi.restoreAllMocks();
});

type Route = (url: string, init?: RequestInit) => Response;

function mockRoutes(route: Route) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(route(String(input), init)));
}

const TEX = '\\documentclass{article}\n\\begin{document}Hello\\end{document}\n';

describe('exportDocumentLatex', () => {
  it('reads the LaTeX body as text, with the cookie, and keeps the server’s file name', async () => {
    const fetchSpy = mockRoutes(
      () =>
        new Response(TEX, {
          status: 200,
          headers: {
            'Content-Type': 'application/x-tex',
            'Content-Disposition': `attachment; filename="Resume.tex"; filename*=UTF-8''R%C3%A9sum%C3%A9.tex`,
          },
        }),
    );

    const result = await exportDocumentLatex('66f0c0ffee');

    expect(result).toEqual({ source: TEX, filename: 'Résumé.tex' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/document\/export\/66f0c0ffee\?format=tex$/);
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('rotates an expired session once and replays the export', async () => {
    let exports = 0;
    mockRoutes((url) => {
      if (url.includes('/auth/refresh')) return new Response('{}', { status: 200 });
      exports += 1;
      return exports === 1 ? new Response('{}', { status: 401 }) : new Response(TEX, { status: 200 });
    });

    const result = await exportDocumentLatex('doc');

    expect(exports).toBe(2);
    expect(result.source).toBe(TEX);
  });

  it('raises the API’s detail as an ApiError and asks for sign-in on 403', async () => {
    const emit = vi.spyOn(session, 'emitRequireLogin').mockImplementation(() => {});
    mockRoutes(() => new Response(JSON.stringify({ detail: 'Document could not be exported' }), { status: 422 }));
    await expect(exportDocumentLatex('doc')).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      message: 'Document could not be exported',
    });
    expect(emit).not.toHaveBeenCalled();

    mockRoutes(() => new Response('{}', { status: 403 }));
    await expect(exportDocumentLatex('doc')).rejects.toBeInstanceOf(ApiError);
    expect(emit).toHaveBeenCalledWith('forbidden');
  });
});

describe('LaTeX export helpers', () => {
  it('reads both forms of Content-Disposition', () => {
    expect(dispositionFilename('attachment; filename="paper.tex"')).toBe('paper.tex');
    expect(dispositionFilename(`attachment; filename="x.tex"; filename*=UTF-8''%E8%AB%96%E6%96%87.tex`)).toBe('論文.tex');
    expect(dispositionFilename(null)).toBeNull();
  });

  it('words the API’s failures for the author', () => {
    expect(describeLatexExportError(new ApiError('Document could not be exported', 422, null))).toContain(
      'Inline code',
    );
    expect(describeLatexExportError(new ApiError('Document content is invalid', 422, null))).toContain(
      'could not read the saved document',
    );
    expect(describeLatexExportError(new ApiError('Document not found', 404, null))).toContain('Save it');
    expect(describeLatexExportError(new TypeError('Failed to fetch'))).toBe(
      'The server could not be reached. Check your connection.',
    );
  });
});
