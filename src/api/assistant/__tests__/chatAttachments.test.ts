import { expect, it } from 'vitest';
import { HttpResponse, http, multipartFields, problem, recordRequests, server } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { uploadChatImage } from '../chatAttachments';
import { assetContentUrl, loadAssetBlob } from '@/data/assets';
import { assetFixture, TEST_ASSET_ID } from '@/__tests__/asset';

const WS = TEST_WORKSPACE_ID;

it('uploads images as cookie-authenticated multipart and returns canonical metadata', async () => {
  const image = assetFixture({ bytes: 3 });
  const sent = recordRequests();
  server.use(http.post('/workspaces/{workspace_id}/assets', ({ response }) => response(201).json(image)));
  const file = new File(['png'], 'chart.png', { type: 'image/png' });

  expect(await uploadChatImage(WS, file)).toEqual({ kind: 'image', asset_id: TEST_ASSET_ID, filename: 'chart.png', media_type: 'image/png', size_bytes: 3 });
  const [request] = sent;
  expect(new URL(request!.url).pathname).toBe(`/api/workspaces/${WS}/assets`);
  expect(request?.credentials).toBe('include');
  expect(request?.headers.get('Idempotency-Key')).toBeTruthy();
  // The browser writes the multipart boundary itself.
  expect(request?.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
  expect(Object.keys(await multipartFields(request!))).toEqual(['file']);
});

it('refreshes an expired image cookie through the shared refresh and retries with cancellation', async () => {
  const sent = recordRequests();
  let reads = 0;
  server.use(http.get('/workspaces/{workspace_id}/assets/{asset_id}/content', ({ response }) => {
    reads += 1;
    return reads === 1
      ? problem('unauthorized', 'Missing session token')
      : response.untyped(new HttpResponse('png', { headers: { 'Content-Type': 'image/png' } }));
  }));
  const controller = new AbortController();

  const blob = await loadAssetBlob(WS, TEST_ASSET_ID, controller.signal, 'thumbnail');

  expect(sent.map((request) => new URL(request.url).pathname)).toEqual([
    `/api/workspaces/${WS}/assets/${TEST_ASSET_ID}/content`,
    '/api/auth/refresh',
    `/api/workspaces/${WS}/assets/${TEST_ASSET_ID}/content`,
  ]);
  const retried = sent[2];
  expect(retried?.credentials).toBe('include');
  expect(new URL(retried!.url).searchParams.get('rendition')).toBe('thumbnail');
  controller.abort();
  expect(retried?.signal.aborted).toBe(true);
  expect(blob.type).toBe('image/png');
});

it('does not expose failed image responses as image blobs', async () => {
  await expect(loadAssetBlob(WS, TEST_ASSET_ID, new AbortController().signal)).rejects.toMatchObject({ status: 404 });
});

it('links an image by its workspace and its encoded id', () => {
  expect(assetContentUrl(WS, 'a/b')).toBe(`/api/workspaces/${WS}/assets/a%2Fb/content`);
});
