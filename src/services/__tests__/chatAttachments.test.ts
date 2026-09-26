import { afterEach, expect, it, vi } from 'vitest';
import * as api from '../api';
import { loadChatImageBlob, uploadChatImage } from '../chatAttachments';

afterEach(() => vi.restoreAllMocks());
it('uploads images as cookie-authenticated multipart and returns canonical metadata', async () => {
  const image = { id: 'image-1', filename: 'chart.png', media_type: 'image/png', size_bytes: 3 };
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ image }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
  const file = new File(['png'], 'chart.png', { type: 'image/png' });
  expect(await uploadChatImage(file)).toEqual({ kind: 'image', image_id: 'image-1', filename: 'chart.png', media_type: 'image/png', size_bytes: 3 });
  const [url, init] = request.mock.calls[0];
  expect(url).toMatch(/\/users\/me\/chat-images$/);
  expect(init?.credentials).toBe('include');
  expect(init?.body).toBeInstanceOf(FormData);
  expect((init?.body as FormData).get('file')).toBe(file);
  expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
});


it('refreshes an expired image cookie through the shared refresh and retries with cancellation', async () => {
  vi.spyOn(api, 'getRefreshGeneration').mockReturnValue('generation-7');
  const refresh = vi.spyOn(api, 'ensureRefreshed').mockResolvedValue(true);
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response('png', { headers: { 'Content-Type': 'image/png' } }));
  const controller = new AbortController();
  const blob = await loadChatImageBlob('image-1', controller.signal);
  expect(refresh).toHaveBeenCalledWith('generation-7');
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][1]).toMatchObject({ credentials: 'include', signal: controller.signal });
  expect(blob.type).toBe('image/png');
});

it('does not expose failed image responses as image blobs', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not found', { status: 404 }));
  await expect(loadChatImageBlob('gone', new AbortController().signal)).rejects.toMatchObject({ status: 404 });
});
