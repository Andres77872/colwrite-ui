import { expect, it } from 'vitest';
import { HttpResponse, http, multipartFields, problem, recordRequests, server } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { chatImageContentUrl, loadChatImageBlob, uploadChatImage } from '../chatAttachments';

const WS = TEST_WORKSPACE_ID;

it('uploads images as cookie-authenticated multipart and returns canonical metadata', async () => {
  const image = { id: 'image-1', filename: 'chart.png', media_type: 'image/png', size_bytes: 3 } as const;
  const sent = recordRequests();
  server.use(http.post('/workspaces/{workspace_id}/chat-images', ({ response }) => response(201).json(image)));
  const file = new File(['png'], 'chart.png', { type: 'image/png' });

  expect(await uploadChatImage(WS, file)).toEqual({ kind: 'image', image_id: 'image-1', filename: 'chart.png', media_type: 'image/png', size_bytes: 3 });
  const [request] = sent;
  expect(new URL(request!.url).pathname).toBe(`/api/workspaces/${WS}/chat-images`);
  expect(request?.credentials).toBe('include');
  expect(request?.headers.get('Idempotency-Key')).toBeTruthy();
  // The browser writes the multipart boundary itself.
  expect(request?.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
  expect(Object.keys(await multipartFields(request!))).toEqual(['file']);
});

it('refreshes an expired image cookie through the shared refresh and retries with cancellation', async () => {
  const sent = recordRequests();
  let reads = 0;
  server.use(http.get('/workspaces/{workspace_id}/chat-images/{image_id}/content', ({ response }) => {
    reads += 1;
    return reads === 1
      ? problem('unauthorized', 'Missing session token')
      : response.untyped(new HttpResponse('png', { headers: { 'Content-Type': 'image/png' } }));
  }));
  const controller = new AbortController();

  const blob = await loadChatImageBlob(WS, 'image-1', controller.signal);

  expect(sent.map((request) => new URL(request.url).pathname)).toEqual([
    `/api/workspaces/${WS}/chat-images/image-1/content`,
    '/api/auth/refresh',
    `/api/workspaces/${WS}/chat-images/image-1/content`,
  ]);
  const retried = sent[2];
  expect(retried?.credentials).toBe('include');
  controller.abort();
  expect(retried?.signal.aborted).toBe(true);
  expect(blob.type).toBe('image/png');
});

it('does not expose failed image responses as image blobs', async () => {
  await expect(loadChatImageBlob(WS, 'gone', new AbortController().signal)).rejects.toMatchObject({ status: 404 });
});

it('links an image by its workspace and its encoded id', () => {
  expect(chatImageContentUrl(WS, 'a/b')).toBe(`/api/workspaces/${WS}/chat-images/a%2Fb/content`);
});
