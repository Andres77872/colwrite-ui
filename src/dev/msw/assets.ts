import { PREVIEW_USER_ID, chatsOf, fixtures, type StoredAsset, type WireBlock } from './fixtures';
import { imageHeader, mockSha256 } from './assetBytes';

export const validAssetId = (id: string) => /^ast-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);

export class MockAssetError extends Error {
  readonly code: 'asset_type_unsupported' | 'asset_too_large' | 'asset_not_found' | 'idempotency_key_reused' | 'invalid_request';
  constructor(code: MockAssetError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export async function storeAsset(workspaceId: string, key: string, file: Blob, filename: string): Promise<StoredAsset> {
  if (file.size > 25 * 1024 * 1024) throw new MockAssetError('asset_too_large', 'Images must be 25 MB or smaller.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = imageHeader(bytes);
  if (!header || header.media_type !== file.type) throw new MockAssetError('asset_type_unsupported', 'Choose a valid PNG, JPEG, WebP or GIF with its matching media type.');
  if (!header.width || !header.height || header.width * header.height > 25_000_000) throw new MockAssetError('asset_too_large', 'Image exceeds the pixel limit.');
  const digest = mockSha256(bytes);
  const action = mockSha256(new TextEncoder().encode(`colwrite/asset-upload/v1\0${workspaceId}\0${PREVIEW_USER_ID}\0${key}`));
  const variant = ((parseInt(action.slice(16, 17), 16) & 3) | 8).toString(16);
  const id = `ast-${action.slice(0, 8)}-${action.slice(8, 12)}-4${action.slice(13, 16)}-${variant}${action.slice(17, 20)}-${action.slice(20, 32)}`;
  const basename = filename.replace(/\\/g, '/').split('/').at(-1) ?? '';
  const name = [...basename].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127 && !'"<>'.includes(char)).join('').trim().slice(0, 200) || 'image';
  const requestHash = JSON.stringify([digest, name, file.type]);
  const existing = fixtures.assets.get(id);
  if (existing) {
    if (existing.requestHash !== requestHash) throw new MockAssetError('idempotency_key_reused', 'This action key was used for a different image.');
    if (!existing.file) throw new MockAssetError('asset_not_found', 'This asset action was purged. Upload again with a new action.');
    return existing;
  }
  const stored: StoredAsset = {
    asset: { asset_id: id, workspace_id: workspaceId, kind: 'upload', filename: name, ...header, bytes: file.size,
      sha256: digest, generation_id: null, generation: null, created_by: PREVIEW_USER_ID, created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') },
    file, pending: true, requestHash, references: [],
  };
  fixtures.assets.set(id, stored);
  return stored;
}

export function readableAsset(workspaceId: string, assetId: string): StoredAsset | null {
  const stored = fixtures.assets.get(assetId);
  if (!stored?.file || stored.asset.workspace_id !== workspaceId) return null;
  if (stored.pending && stored.asset.created_by === PREVIEW_USER_ID) return stored;
  return stored.references.some((ref) => {
    const doc = fixtures.documents.get(ref.documentId);
    return doc?.workspace_id === workspaceId && !doc.deleted_at
      && (ref.kind === 'document'
        ? doc.blocks.some((block) => block.type === 'image' && block.assetId === assetId)
          || [...(fixtures.histories.get(doc._id)?.contents.values() ?? [])].some((content) =>
            content.blocks?.some((block) => block.type === 'image' && block.assetId === assetId))
        : ref.createdBy === PREVIEW_USER_ID && chatsOf(doc._id).some((chat) => chat.id === ref.referenceId));
  }) ? stored : null;
}

export function prepareImageBlocks(workspaceId: string, blocks: WireBlock[]): WireBlock[] {
  return blocks.map((block) => {
    if (block.type !== 'image') return block;
    if (!validAssetId(block.assetId) || !block.alt?.trim() || block.alt.length > 4000
      || (block.width !== undefined && (!Number.isFinite(block.width) || block.width < 0.2 || block.width > 1))) {
      throw new MockAssetError('invalid_request', 'The image needs a workspace asset, alt text and a width from 0.2 to 1.');
    }
    const stored = readableAsset(workspaceId, block.assetId);
    if (!stored) throw new MockAssetError('asset_not_found', 'The image is not available in this workspace.');
    const origin = stored.asset.kind === 'generated'
      ? { kind: 'generated' as const, generationId: stored.asset.generation_id! }
      : { kind: 'upload' as const };
    return { ...block, width: block.width ?? 1, origin };
  });
}

export function linkPageAssets(workspaceId: string, documentId: string, blocks: WireBlock[]): void {
  for (const block of blocks) {
    if (block.type !== 'image') continue;
    const stored = fixtures.assets.get(block.assetId);
    if (!stored || stored.asset.workspace_id !== workspaceId) throw new MockAssetError('asset_not_found', 'Image not found.');
    stored.pending = false;
    if (!stored.references.some((ref) => ref.kind === 'document' && ref.referenceId === documentId)) {
      stored.references.push({ kind: 'document', referenceId: documentId, documentId, createdBy: PREVIEW_USER_ID });
    }
  }
}

export function linkChatAssets(workspaceId: string, documentId: string, chatId: string, ids: string[]): void {
  for (const id of ids) {
    const stored = readableAsset(workspaceId, id);
    if (!stored) throw new MockAssetError('asset_not_found', 'An attached image is unavailable.');
    stored.pending = false;
    if (!stored.references.some((ref) => ref.kind === 'chat' && ref.referenceId === chatId)) {
      stored.references.push({ kind: 'chat', referenceId: chatId, documentId, createdBy: PREVIEW_USER_ID });
    }
  }
}

export function detachChatAssets(workspaceId: string, chatId: string): void {
  for (const stored of fixtures.assets.values()) {
    if (stored.asset.workspace_id !== workspaceId) continue;
    stored.references = stored.references.filter((ref) => ref.kind !== 'chat' || ref.referenceId !== chatId);
    if (!stored.pending && !stored.references.length) stored.file = null;
  }
}
