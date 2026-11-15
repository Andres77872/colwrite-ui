import { act, cleanup, screen } from '@testing-library/react';
import { renderHookWithQueryClient as renderHook } from '@/__tests__/queryClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { HttpResponse, http, multipartFields, problem, server } from '@/__tests__/server';
import { makeResource } from '@/data/__tests__/resourceFixtures';

import { sameUploadTarget, uploadLabel, useUploadPdfs, type PdfUploadTarget } from './useUploadPdfs';

const stored = (resource: ReturnType<typeof makeResource>) => HttpResponse.json(resource, { status: 201 });
const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;
const pdf = (name: string) => new File(['%PDF-1.7'], name, { type: 'application/pdf' });

function setup(target: PdfUploadTarget, ensurePage = vi.fn(async () => 'doc-1' as string | null)) {
  const hook = renderHook(({ to }: { to: PdfUploadTarget }) => useUploadPdfs(to, { ensurePage }), {
    wrapper,
    initialProps: { to: target },
  });
  return { ...hook, ensurePage };
}

/**
 * The form fields of each upload, without the file part: under jsdom a file
 * loses its name on the way into a `Request`.
 */
let uploads: Record<string, string>[];
/** The server's answers to the uploads, in order; a stored PDF once they run out. */
let answers: Array<() => Response>;

beforeEach(() => {
  uploads = [];
  answers = [];
  server.use(http.post('/workspaces/{workspace_id}/resources', async ({ request, response }) => {
    const { file: _file, ...fields } = await multipartFields(request);
    uploads.push(fields);
    return response.untyped(answers.shift()?.() ?? stored(makeResource()));
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useUploadPdfs', () => {
  it('names the destination in the copy deck’s words', () => {
    expect(uploadLabel({ kind: 'page' })).toBe('Upload to: this page');
    expect(uploadLabel({ kind: 'unfiled' })).toBe('Upload to: Unfiled');
    expect(uploadLabel({ kind: 'collection', collectionId: 2, name: 'Chapter 2' })).toBe('Upload to: Chapter 2');
    expect(sameUploadTarget({ kind: 'collection', collectionId: 2, name: 'A' }, { kind: 'collection', collectionId: 2, name: 'B' })).toBe(true);
    expect(sameUploadTarget({ kind: 'page' }, { kind: 'unfiled' })).toBe(false);
  });

  it('uploads into a collection or Unfiled without touching the page', async () => {
    const { result, ensurePage, rerender } = setup({ kind: 'collection', collectionId: 7, name: 'Methods' });
    const first = pdf('a.pdf');
    await act(async () => {
      await result.current.upload([first]);
    });
    expect(uploads).toEqual([{ location: 'collection', collection_id: '7' }]);

    rerender({ to: { kind: 'unfiled' } });
    const second = pdf('b.pdf');
    await act(async () => {
      await result.current.upload([second]);
    });
    expect(uploads.at(-1)).toEqual({ location: 'unfiled' });
    expect(ensurePage).not.toHaveBeenCalled();
    expect(await screen.findByText('Uploaded 1 PDF to Unfiled')).toBeTruthy();
  });

  it('saves the page first when uploading to it, once for the whole selection', async () => {
    const ensurePage = vi.fn(async () => 'doc-new' as string | null);
    const { result } = setup({ kind: 'page' }, ensurePage);
    const files = [pdf('a.pdf'), pdf('b.pdf')];

    let outcome!: Awaited<ReturnType<typeof result.current.upload>>;
    await act(async () => {
      outcome = await result.current.upload(files);
    });

    expect(ensurePage).toHaveBeenCalledTimes(1);
    expect(uploads).toEqual([
      { location: 'document', document_id: 'doc-new' },
      { location: 'document', document_id: 'doc-new' },
    ]);
    expect(outcome.stored).toHaveLength(2);
    expect(await screen.findByText('Uploaded 2 PDFs to this page')).toBeTruthy();
  });

  it('skips what is not a PDF and reports each rejected PDF', async () => {
    answers = [
      () => stored(makeResource({ filename: 'good.pdf' })),
      () => problem('upload_not_pdf', 'Choose a PDF'),
    ];
    const { result } = setup({ kind: 'unfiled' });

    let outcome!: Awaited<ReturnType<typeof result.current.upload>>;
    await act(async () => {
      outcome = await result.current.upload([pdf('good.pdf'), pdf('bad.pdf'), new File(['x'], 'notes.txt')]);
    });

    expect(uploads).toHaveLength(2);
    expect(outcome.stored.map((item) => item.filename)).toEqual(['good.pdf']);
    expect(outcome.failures).toEqual([expect.stringContaining('bad.pdf')]);
    expect(await screen.findByText('Skipped 1 file')).toBeTruthy();
    expect(await screen.findByText('1 PDF rejected')).toBeTruthy();
  });

  it('uploads one PDF for a caller that shows its own state, and throws when the page cannot be saved', async () => {
    const ensurePage = vi.fn(async () => null as string | null);
    const { result } = setup({ kind: 'page' }, ensurePage);

    await act(async () => {
      await expect(result.current.uploadOne(pdf('a.pdf'))).rejects.toThrow(/could not be saved/);
    });
    expect(uploads).toEqual([]);
    expect(result.current.uploading).toBe(false);
  });
});
