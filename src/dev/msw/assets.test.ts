import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer';
import { api, multipartBody, unwrap } from '@/api/client';
import type { BodyAssetsUploadAsset } from '@/api/schema';
import { getAsset, loadAssetBlob, uploadAsset } from '@/data/assets';
import { getDocument, saveDocument } from '@/data/documents';
import { copyPageToWorkspace } from '@/data/workspaces';
import { exportDocumentLatex } from '@/data/documentExport';
import { deleteChat } from '@/data/chats';
import { assetFixture, imageFile } from '@/__tests__/asset';
import { itemAt } from '@/lib/itemAt';
import { mockSha256 } from './assetBytes';
import { linkChatAssets } from './assets';
import { FIXTURE_DOCUMENT_ID, LAB_WORKSPACE_ID, OWNED_WORKSPACE_ID, PERSONAL_WORKSPACE_ID, PREVIEW_USER_ID, chatsOf, fixtures, purgeRoot } from './fixtures';

const WS = PERSONAL_WORKSPACE_ID, DOC = FIXTURE_DOCUMENT_ID;

// jsdom's File cannot round-trip through Node's Request (see multipartFields
// in the test server). Exercise actual binary handlers with one native realm,
// rather than teaching the mock or production client to accept broken bytes.
let NativeFormData: typeof FormData;
beforeAll(async () => {
  const form = await new Request('http://localhost/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '',
  }).formData();
  NativeFormData = form.constructor as typeof FormData;
});
beforeEach(() => {
  vi.stubGlobal('FormData', NativeFormData);
  vi.stubGlobal('Blob', NativeBlob);
  vi.stubGlobal('File', NativeFile);
});
afterEach(() => vi.unstubAllGlobals());

async function keyedUpload(key: string, filename = 'chart.png') {
  const body = new FormData();
  body.append('file', imageFile(filename));
  return unwrap(api.POST('/workspaces/{workspace_id}/assets', {
    params: { path: { workspace_id: WS }, header: { 'Idempotency-Key': key } },
    body: multipartBody<BodyAssetsUploadAsset>(body),
  }));
}

it('uses actual SHA-256 in the preview without requiring a secure context', () => {
  expect(mockSha256(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(mockSha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

it('uploads through the real asset helper and reads scoped metadata and image bytes', async () => {
  const info = await uploadAsset(WS, imageFile());
  expect(info).toMatchObject({
    kind: 'upload', filename: 'chart.png', width: 30, height: 20, bytes: 92,
    sha256: assetFixture().sha256, workspace_id: WS, created_by: PREVIEW_USER_ID, generation_id: null,
  });
  expect(info.asset_id).toMatch(/^ast-[0-9a-f-]{36}$/);
  expect(await getAsset(WS, info.asset_id)).toEqual(info);
  const controller = new AbortController();
  const bytes = await loadAssetBlob(WS, info.asset_id, controller.signal, 'thumbnail');
  expect(bytes.type).toBe('image/png');
  expect(bytes.size).toBe(92); // The mock serves the original; the API tests separate derivatives.
});

it('replays the exact action, refuses changed metadata and does not resurrect a purged action', async () => {
  const first = await keyedUpload('same-action');
  expect(await keyedUpload('same-action')).toEqual(first);
  expect(fixtures.assets.size).toBe(1);
  await expect(keyedUpload('same-action', 'renamed.png')).rejects.toMatchObject({ status: 409, data: { code: 'idempotency_key_reused' } });
  const chat = itemAt(chatsOf(DOC), 0);
  linkChatAssets(WS, DOC, chat.id, [first.asset_id]);
  await deleteChat(WS, DOC, chat.id);
  await expect(getAsset(WS, first.asset_id)).rejects.toMatchObject({ status: 404 });
  await expect(keyedUpload('same-action')).rejects.toMatchObject({ status: 404 });
});

it('keeps private uploads and other members’ chat references private, sharing only explicit live-page use', async () => {
  const info = await uploadAsset(WS, imageFile());
  const stored = fixtures.assets.get(info.asset_id)!;
  stored.asset.created_by = 'another-member';
  await expect(getAsset(WS, info.asset_id)).rejects.toMatchObject({ status: 404 });
  const chat = itemAt(chatsOf(DOC), 0);
  stored.pending = false;
  stored.references.push({ kind: 'chat', referenceId: chat.id, documentId: DOC, createdBy: 'another-member' });
  await expect(getAsset(WS, info.asset_id)).rejects.toMatchObject({ status: 404 });
  stored.references.push({ kind: 'document', referenceId: DOC, documentId: DOC, createdBy: 'another-member' });
  const doc = fixtures.documents.get(DOC)!;
  doc.blocks.push({ id: 'image', type: 'image', assetId: info.asset_id, alt: 'Blue rectangle', width: 0.7, origin: { kind: 'upload' }, aiHidden: false, locked: false, collapsed: false });
  expect((await getAsset(WS, info.asset_id)).asset_id).toBe(info.asset_id);
  doc.deleted_at = '2026-11-16T12:00:00Z';
  await expect(getAsset(WS, info.asset_id)).rejects.toMatchObject({ status: 404 });
});

it('retains the same asset across two chats and removes the bytes only with the last reference', async () => {
  const info = await uploadAsset(WS, imageFile());
  const [first, second] = chatsOf(DOC);
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  linkChatAssets(WS, DOC, first!.id, [info.asset_id]);
  linkChatAssets(WS, DOC, second!.id, [info.asset_id]);
  await deleteChat(WS, DOC, first!.id);
  expect((await getAsset(WS, info.asset_id)).asset_id).toBe(info.asset_id);
  expect(fixtures.assets.get(info.asset_id)?.references).toHaveLength(1);
  await deleteChat(WS, DOC, second!.id);
  expect(fixtures.assets.get(info.asset_id)?.file).toBeNull();
});

it('page purge removes its private chat references but preserves an asset still used by another page', async () => {
  const info = await uploadAsset(WS, imageFile());
  const chat = itemAt(chatsOf(DOC), 0);
  linkChatAssets(WS, DOC, chat.id, [info.asset_id]);
  const otherPage = itemAt([...fixtures.documents.values()].filter((doc) => doc.workspace_id === WS && doc._id !== DOC && !doc.deleted_at), 0);
  const stored = fixtures.assets.get(info.asset_id)!;
  stored.references.push({ kind: 'document', referenceId: otherPage._id, documentId: otherPage._id, createdBy: PREVIEW_USER_ID });
  otherPage.blocks.push({ id: 'image', type: 'image', assetId: info.asset_id, alt: 'Blue rectangle', width: 0.7, origin: { kind: 'upload' }, aiHidden: false, locked: false, collapsed: false });
  purgeRoot({ kind: 'document', id: DOC });
  expect((await getAsset(WS, info.asset_id)).asset_id).toBe(info.asset_id);
  expect(stored.references).toHaveLength(1);
  purgeRoot({ kind: 'document', id: otherPage._id });
  expect(stored.file).toBeNull();
});

it('saves server-derived image origin, retains image history and exports the original in a real ZIP', async () => {
  const asset = await uploadAsset(WS, imageFile());
  const opened = await getDocument(WS, DOC);
  await saveDocument(WS, DOC, { ...opened.doc, blocks: [...opened.doc.blocks, {
    id: 'image', type: 'image', assetId: asset.asset_id, alt: 'Blue rectangle', width: 0.7,
    origin: { kind: 'generated', generationId: 'gen-00000000-0000-4000-8000-000000000003' },
  }] }, opened.etag);
  const saved = await getDocument(WS, DOC);
  expect(saved.doc.blocks.find((block) => block.id === 'image')).toMatchObject({ origin: { kind: 'upload' } });
  const exported = await exportDocumentLatex(WS, DOC);
  const bytes = new Uint8Array(await exported.blob.arrayBuffer());
  expect(exported.blob.type).toBe('application/zip');
  expect(bytes.slice(0, 4)).toEqual(new Uint8Array([80, 75, 3, 4]));
  expect(new TextDecoder().decode(bytes)).toContain(`assets/${asset.asset_id}.png`);
  expect(new TextDecoder().decode(bytes)).toContain(asset.sha256);
  await saveDocument(WS, DOC, { ...saved.doc, blocks: saved.doc.blocks.filter((block) => block.id !== 'image') }, saved.etag);
  expect((await getAsset(WS, asset.asset_id)).asset_id).toBe(asset.asset_id);
});

it('refuses a valid asset id from another workspace before changing the page', async () => {
  const foreign = await uploadAsset(LAB_WORKSPACE_ID, imageFile());
  const opened = await getDocument(WS, DOC);
  await expect(saveDocument(WS, DOC, { ...opened.doc, blocks: [{
    id: 'foreign-image', type: 'image', assetId: foreign.asset_id, alt: 'Foreign image', width: 0.7, origin: { kind: 'upload' },
  }] }, opened.etag)).rejects.toMatchObject({ status: 404, data: { code: 'asset_not_found' } });
  expect((await getDocument(WS, DOC)).etag).toBe(opened.etag);
});

it('copies an image to an independent workspace asset and keeps the copy after source purge', async () => {
  const asset = await uploadAsset(WS, imageFile());
  const opened = await getDocument(WS, DOC);
  await saveDocument(WS, DOC, { ...opened.doc, blocks: [{
    id: 'image', type: 'image', assetId: asset.asset_id, alt: 'Blue rectangle', width: 0.7, origin: { kind: 'upload' },
  }] }, opened.etag);
  const target = { workspaceId: OWNED_WORKSPACE_ID, collectionId: null, includePdfs: 'none' as const };
  const accepted = await copyPageToWorkspace(WS, DOC, target, 'copy-image');
  const job = fixtures.jobs.get(accepted.job.id)!;
  const copyId = job.result!.document_id!;
  const copied = await getDocument(OWNED_WORKSPACE_ID, copyId);
  const image = copied.doc.blocks.find((block) => block.type === 'image');
  expect(image?.type).toBe('image');
  if (image?.type !== 'image') throw new Error('Image missing from copy');
  expect(image.assetId).not.toBe(asset.asset_id);
  expect((await getAsset(OWNED_WORKSPACE_ID, image.assetId)).sha256).toBe(asset.sha256);
  expect((await copyPageToWorkspace(WS, DOC, target, 'copy-image')).job.id).toBe(accepted.job.id);
  purgeRoot({ kind: 'document', id: DOC });
  expect((await getAsset(OWNED_WORKSPACE_ID, image.assetId)).asset_id).toBe(image.assetId);
  expect(fixtures.assets.get(asset.asset_id)?.file).toBeNull();
});
