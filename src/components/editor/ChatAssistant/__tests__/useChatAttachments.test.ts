import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatAttachments } from '../useChatAttachments';
import * as images from '@/services/chatAttachments';
import * as resources from '@/services/resources';
import { makeResource } from '@/services/__tests__/resourceFixtures';

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => cleanup());
const image = { kind: 'image' as const, image_id: 'image-1', filename: 'chart.png', media_type: 'image/png', size_bytes: 3 };

describe('chat attachment draft', () => {
  it('uploads PDFs into the library without moving or attaching existing resources', async () => {
    const upload = vi.spyOn(resources, 'uploadResource').mockResolvedValue(makeResource());
    const move = vi.spyOn(resources, 'attachResource');
    const { result } = renderHook(() => useChatAttachments(null));
    const file = new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' });
    act(() => result.current.addFiles([file]));
    expect(result.current.blocked).toBe(true);
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    expect(upload).toHaveBeenCalledWith(file);
    act(() => result.current.addResource(makeResource({ id: 42, document_id: 'other-doc' })));
    expect(result.current.attachments).toHaveLength(2);
    expect(move).not.toHaveBeenCalled();
    expect(result.current.blocked).toBe(false);
  });

  it('reserves concurrent upload slots and rejects extra selections', async () => {
    vi.spyOn(images, 'uploadChatImage').mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useChatAttachments(null));
    const files = Array.from({ length: 6 }, (_, index) => new File(['png'], `${index}.png`, { type: 'image/png' }));
    act(() => { result.current.addFiles(files); result.current.addFiles(files); });
    expect(result.current.items).toHaveLength(8);
    expect(images.uploadChatImage).toHaveBeenCalledTimes(8);
    expect(result.current.error).toMatch(/8 files/);
  });

  it('does not resurrect a removed upload when its request completes', async () => {
    let finish!: (value: images.ChatAttachment) => void;
    vi.spyOn(images, 'uploadChatImage').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useChatAttachments(null));
    act(() => result.current.addFiles([new File(['png'], 'chart.png', { type: 'image/png' })]));
    act(() => result.current.remove(result.current.items[0].id));
    await act(async () => finish(image));
    expect(result.current.items).toHaveLength(0);
  });

  it('discards old uploads across chat switches and leaves new selections intact', async () => {
    let finish!: (value: images.ChatAttachment) => void;
    vi.spyOn(images, 'uploadChatImage').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(({ chatId }) => useChatAttachments(chatId), { initialProps: { chatId: 'chat-a' } });
    act(() => result.current.addFiles([new File(['png'], 'chart.png', { type: 'image/png' })]));
    rerender({ chatId: 'chat-b' });
    act(() => result.current.addResource(makeResource({ id: 7 })));
    await act(async () => finish(image));
    expect(result.current.attachments).toEqual([images.resourceAttachment(makeResource({ id: 7 }))]);
  });

  it('keeps a failed upload visible and retries only that file', async () => {
    vi.spyOn(images, 'uploadChatImage').mockRejectedValueOnce(new Error('Upload unavailable')).mockResolvedValueOnce(image);
    const { result } = renderHook(() => useChatAttachments(null));
    act(() => result.current.addFiles([new File(['png'], 'chart.png', { type: 'image/png' })]));
    await waitFor(() => expect(result.current.items[0].state).toBe('error'));
    expect(result.current.blocked).toBe(true);
    expect(result.current.items[0].error).toBe('Upload unavailable');
    act(() => result.current.retry(result.current.items[0].id));
    await waitFor(() => expect(result.current.attachments).toEqual([image]));
    expect(result.current.blocked).toBe(false);
  });

  it('rejects oversize or unsupported images without uploading them', async () => {
    const upload = vi.spyOn(images, 'uploadChatImage');
    const { result } = renderHook(() => useChatAttachments(null));
    act(() => result.current.addFiles([
      new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' }),
      new File([new Uint8Array(images.MAX_CHAT_IMAGE_BYTES + 1)], 'large.png', { type: 'image/png' }),
    ]));
    expect(result.current.items.every((item) => item.state === 'error')).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it('normalizes missing PDF MIME and deduplicates selected library PDFs', async () => {
    const upload = vi.spyOn(resources, 'uploadResource').mockResolvedValue(makeResource({ id: 4 }));
    const { result } = renderHook(() => useChatAttachments(null));
    act(() => result.current.addFiles([new File(['%PDF'], 'paper.PDF')]));
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));
    expect(upload.mock.calls[0][0].type).toBe('application/pdf');
    act(() => { result.current.addResource(makeResource({ id: 4 })); result.current.addResource(makeResource({ id: 4 })); });
    expect(result.current.items).toHaveLength(1);
  });
});


it('deduplicates an upload that resolves to an already selected library resource', async () => {
  const resource = makeResource({ id: 4 });
  vi.spyOn(resources, 'uploadResource').mockResolvedValue(resource);
  const { result } = renderHook(() => useChatAttachments(null));
  act(() => {
    result.current.addFiles([new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' })]);
    result.current.addResource(resource);
  });
  await waitFor(() => expect(result.current.blocked).toBe(false));
  expect(result.current.attachments).toEqual([images.resourceAttachment(resource)]);
});
