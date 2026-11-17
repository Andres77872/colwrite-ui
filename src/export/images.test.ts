import { afterEach, expect, it, vi } from 'vitest';
import { Blob as NativeBlob } from 'node:buffer';
import { HttpResponse, http, recordRequests, pathOf, server } from '@/__tests__/server';
import { assetFixture, TEST_ASSET_ID } from '@/__tests__/asset';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import type { Doc } from '@/editor/types';
import { documentToMarkdown } from './markdown';
import { markdownImageBundle, placedImageDpi, prepareExportImages, type ExportImages } from './images';
import { storedZip } from './zip';
import { renderStandaloneHtml } from './renderStandaloneHtml';
import { DEFAULT_EXPORT_OPTIONS } from './types';

afterEach(() => vi.unstubAllGlobals());
const doc: Doc = { name: 'Images', blocks: [{
  id: 'image', type: 'image', assetId: TEST_ASSET_ID, alt: 'Blue <rectangle>', caption: 'Pipeline', width: 0.7, origin: { kind: 'upload' },
}] };

function answerAsset() {
  server.use(
    http.get('/workspaces/{workspace_id}/assets/{asset_id}', ({ response }) => response(200).json(assetFixture())),
    http.get('/workspaces/{workspace_id}/assets/{asset_id}/content', ({ response }) => response.untyped(
      new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }),
    )),
  );
}

it('loads originals once per asset, through the authenticated client, and never an authored origin', async () => {
  answerAsset();
  server.use(http.get('/workspaces/{workspace_id}/assets/{asset_id}', ({ response }) => response(200).json(assetFixture({ bytes: 3 }))));
  const sent = recordRequests();
  const images = await prepareExportImages(TEST_WORKSPACE_ID, { blocks: [...doc.blocks, ...doc.blocks.map((block) => ({ ...block, id: 'copy' }))] }, true);
  const image = images.get(TEST_ASSET_ID);
  expect(image?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(image?.dataUrl).toBe('data:image/png;base64,AQID');
  expect(image?.path).toBe(`assets/${TEST_ASSET_ID}.png`);
  expect(sent.map(pathOf)).toEqual([
    `/api/workspaces/${TEST_WORKSPACE_ID}/assets/${TEST_ASSET_ID}`,
    `/api/workspaces/${TEST_WORKSPACE_ID}/assets/${TEST_ASSET_ID}/content?rendition=original`,
  ]);
  expect(sent.every((request) => request.credentials === 'include')).toBe(true);
});

it('refuses mismatching image bytes rather than leaving a broken image out of the export', async () => {
  answerAsset();
  await expect(prepareExportImages(TEST_WORKSPACE_ID, doc, true)).rejects.toThrow('do not match');
});

it('embeds only prepared image data, at original pixel dimensions, with the numbered caption and alt text', () => {
  const images: ExportImages = new Map([[TEST_ASSET_ID, {
    info: assetFixture(), path: `assets/${TEST_ASSET_ID}.png`, bytes: new Uint8Array([1]), dataUrl: 'data:image/png;base64,AQ==',
  }]]);
  const html = renderStandaloneHtml(doc, DEFAULT_EXPORT_OPTIONS, { local_revision: 1, dirty: false }, new Map(), images);
  expect(html).toContain('src="data:image/png;base64,AQ=="');
  expect(html).toContain('width="30" height="20"');
  expect(html).toContain('alt="Blue &lt;rectangle&gt;"');
  expect(html).toContain('Figure 1.');
  expect(html).toContain("img-src data:");
  expect(html).not.toContain('/api/');
  expect(() => renderStandaloneHtml(doc, DEFAULT_EXPORT_OPTIONS, { local_revision: 1, dirty: false })).toThrow('must be embedded');
  const forged = new Map([[TEST_ASSET_ID, { ...images.get(TEST_ASSET_ID)!, dataUrl: 'https://example.com/track' }]]);
  expect(() => renderStandaloneHtml(doc, DEFAULT_EXPORT_OPTIONS, { local_revision: 1, dirty: false }, new Map(), forged)).toThrow('must be embedded');
});

it('makes a Markdown bundle with the original bytes and provenance manifest, not expiring URLs', async () => {
  vi.stubGlobal('Blob', NativeBlob);
  const images: ExportImages = new Map([[TEST_ASSET_ID, {
    info: assetFixture(), path: `assets/${TEST_ASSET_ID}.png`, bytes: new Uint8Array([1, 2, 3]),
  }]]);
  const markdown = documentToMarkdown(doc, { includeTitle: true, includeReferences: false, aiBeat: 'omit',
    imagePaths: new Map([...images].map(([id, image]) => [id, image.path])) });
  expect(markdown).toContain(`![Blue \\<rectangle\\>](assets/${TEST_ASSET_ID}.png)`);
  const bundle = markdownImageBundle(markdown, images);
  const bytes = new Uint8Array(await bundle.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  expect(bundle.type).toBe('application/zip');
  expect(text).toContain('document.md');
  expect(text).toContain('assets.json');
  expect(text).toContain(`assets/${TEST_ASSET_ID}.png`);
  expect(text).toContain(assetFixture().sha256);
  expect(() => documentToMarkdown(doc, { includeTitle: false, includeReferences: false, aiBeat: 'omit' })).toThrow('bundle');
});

it('writes ZIP headers, offsets and a standard CRC, and refuses unsafe or duplicate filenames', async () => {
  vi.stubGlobal('Blob', NativeBlob);
  const bytes = new TextEncoder().encode('123456789');
  const blob = storedZip([{ name: 'assets/test.png', bytes }]);
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  expect(view.getUint32(14, true)).toBe(0xcbf43926);
  const localLength = 30 + new TextEncoder().encode('assets/test.png').length + bytes.length;
  expect(view.getUint32(localLength, true)).toBe(0x02014b50);
  expect(view.getUint32(buffer.byteLength - 6, true)).toBe(localLength);
  for (const name of ['../escape', '/absolute', 'assets/../escape', 'assets\\escape']) {
    expect(() => storedZip([{ name, bytes }])).toThrow('filename');
  }
  expect(() => storedZip([{ name: 'same', bytes }, { name: 'same', bytes }])).toThrow('duplicate');
});

it('warns below 300 dpi at placed column width, not at the thumbnail size', () => {
  expect(placedImageDpi(1536, 1, 'A4', 'portrait')).toBeLessThan(300);
  expect(placedImageDpi(1536, 0.5, 'A4', 'portrait')).toBeGreaterThan(300);
});
