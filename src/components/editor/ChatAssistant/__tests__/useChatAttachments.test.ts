import { itemAt } from '@/lib/itemAt';
import { act, cleanup, renderHook as renderBareHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import { createTestQueryClient } from '@/__tests__/queryClient';
import { TestWorkspace } from '@/__tests__/workspace';
import { useChatAttachments } from '../useChatAttachments';
import * as images from '@/api/assistant/chatAttachments';
import { http, multipartFields, server } from '@/__tests__/server';
import { makeResource, onPage } from '@/data/__tests__/resourceFixtures';
import type { ResourceItem } from '@/data/resources';

/** The upload goes through `useUploadPdfs`, which reports through toasts and marks the Library's lists stale. */
function renderHook<Result, Props>(callback: (props: Props) => Result, options: { initialProps?: Props } = {}) {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient },
      createElement(TestWorkspace, null, createElement(ToastProvider, null, children)));
  return renderBareHook(callback, { ...options, wrapper });
}

/**
 * The server's PDF routes: each upload's form fields (its file as
 * `file:<content type>`), answered with `stored`, and each move's resource id.
 */
function mockResources(stored: ResourceItem = makeResource()) {
  const uploads: Record<string, string>[] = [];
  const moves: string[] = [];
  server.use(
    http.post('/workspaces/{workspace_id}/resources', async ({ request, response }) => {
      uploads.push(await multipartFields(request));
      return response(201).json(stored);
    }),
    http.put('/workspaces/{workspace_id}/resources/{resource_id}/location', ({ params, response }) => {
      moves.push(params.resource_id);
      return response(200).json(stored);
    }),
  );
  return { uploads, moves };
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => cleanup());
const ensurePage = vi.fn(async () => 'doc-1' as string | null);
const image = { kind: 'image' as const, image_id: 'image-1', filename: 'chart.png', media_type: 'image/png', size_bytes: 3 };

describe('chat attachment draft', () => {
  it('saves a page that has no id before uploading a PDF to it, and says so when it cannot', async () => {
    const { uploads } = mockResources();
    const failing = vi.fn(async () => null);
    const { result } = renderHook(() => useChatAttachments(null, failing));
    act(() => result.current.addFiles([new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' })]));
    await waitFor(() => expect(result.current.items[0]?.state).toBe('error'));
    expect(failing).toHaveBeenCalledTimes(1);
    expect(uploads).toEqual([]);
    expect(result.current.items[0]?.error).toMatch(/could not be saved/);
  });

  it('uploads PDFs onto the open page without moving or attaching existing resources', async () => {
    const { uploads, moves } = mockResources();
    const { result } = renderHook(() => useChatAttachments(null, ensurePage));
    act(() => result.current.addFiles([new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' })]));
    expect(result.current.blocked).toBe(true);
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    expect(uploads).toEqual([{ file: 'file:application/pdf', location: 'document', document_id: 'doc-1' }]);
    expect(result.current.items[0]?.onPage).toBe(true);
    // The picker says where a PDF goes before it is chosen.
    expect(result.current.pdfLabel).toBe('Upload to: this page');
    act(() => result.current.addResource(makeResource({ id: 42, location: onPage('other-doc') })));
    expect(result.current.attachments).toHaveLength(2);
    expect(moves).toEqual([]);
    expect(result.current.blocked).toBe(false);
  });

  it('reserves concurrent upload slots and rejects extra selections', async () => {
    vi.spyOn(images, 'uploadChatImage').mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChatAttachments(null, ensurePage));
    const files = Array.from({ length: 6 }, (_, index) => new File(['png'], `${index}.png`, { type: 'image/png' }));
    act(() => { result.current.addFiles(files); result.current.addFiles(files); });
    expect(result.current.items).toHaveLength(8);
    expect(images.uploadChatImage).toHaveBeenCalledTimes(8);
    expect(result.current.error).toMatch(/8 files/);
  });

  it('does not resurrect a removed upload when its request completes', async () => {
    let finish!: (value: images.ChatAttachment) => void;
    vi.spyOn(images, 'uploadChatImage').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useChatAttachments(null, ensurePage));
    act(() => result.current.addFiles([new File(['png'], 'chart.png', { type: 'image/png' })]));
    act(() => result.current.remove(itemAt(result.current.items, 0).id));
    await act(async () => finish(image));
    expect(result.current.items).toHaveLength(0);
  });

  it('discards old uploads across chat switches and leaves new selections intact', async () => {
    let finish!: (value: images.ChatAttachment) => void;
    vi.spyOn(images, 'uploadChatImage').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(({ chatId }) => useChatAttachments(chatId, ensurePage), { initialProps: { chatId: 'chat-a' } });
    act(() => result.current.addFiles([new File(['png'], 'chart.png', { type: 'image/png' })]));
    rerender({ chatId: 'chat-b' });
    act(() => result.current.addResource(makeResource({ id: 7 })));
    await act(async () => finish(image));
    expect(result.current.attachments).toEqual([images.resourceAttachment(makeResource({ id: 7 }))]);
  });

  it('keeps a failed upload visible and retries only that file', async () => {
    vi.spyOn(images, 'uploadChatImage').mockRejectedValueOnce(new Error('Upload unavailable')).mockResolvedValueOnce(image);
    const { result } = renderHook(() => useChatAttachments(null, ensurePage));
    act(() => result.current.addFiles([new File(['png'], 'chart.png', { type: 'image/png' })]));
    await waitFor(() => expect(result.current.items[0]?.state).toBe('error'));
    expect(result.current.blocked).toBe(true);
    expect(result.current.items[0]?.error).toBe('Upload unavailable');
    act(() => result.current.retry(itemAt(result.current.items, 0).id));
    await waitFor(() => expect(result.current.attachments).toEqual([image]));
    expect(result.current.blocked).toBe(false);
  });

  it('rejects oversize or unsupported images without uploading them', async () => {
    const upload = vi.spyOn(images, 'uploadChatImage');
    const { result } = renderHook(() => useChatAttachments(null, ensurePage));
    act(() => result.current.addFiles([
      new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' }),
      new File([new Uint8Array(images.MAX_CHAT_IMAGE_BYTES + 1)], 'large.png', { type: 'image/png' }),
    ]));
    expect(result.current.items.every((item) => item.state === 'error')).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it('normalizes missing PDF MIME and deduplicates selected library PDFs', async () => {
    const { uploads } = mockResources(makeResource({ id: 4 }));
    const { result } = renderHook(() => useChatAttachments(null, ensurePage));
    act(() => result.current.addFiles([new File(['%PDF'], 'paper.PDF')]));
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    expect(uploads[0]?.file).toBe('file:application/pdf');
    act(() => { result.current.addResource(makeResource({ id: 4 })); result.current.addResource(makeResource({ id: 4 })); });
    expect(result.current.items).toHaveLength(1);
  });
});


it('deduplicates an upload that resolves to an already selected library resource', async () => {
  const resource = makeResource({ id: 4 });
  mockResources(resource);
  const { result } = renderHook(() => useChatAttachments(null, ensurePage));
  act(() => {
    result.current.addFiles([new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' })]);
    result.current.addResource(resource);
  });
  await waitFor(() => expect(result.current.blocked).toBe(false));
  expect(result.current.attachments).toEqual([images.resourceAttachment(resource)]);
});
