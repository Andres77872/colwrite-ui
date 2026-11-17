import { getAsset, loadAssetBlob, type AssetInfo } from '@/data/assets';
import type { Doc } from '@/editor/types';
import { storedZip } from './zip';

export type ExportImage = {
  info: AssetInfo;
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
  dataUrl?: string;
};
export type ExportImages = ReadonlyMap<string, ExportImage>;
const EXTENSIONS: Record<string, string | undefined> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
};
export const MAX_IMAGE_EXPORT_BYTES = 250 * 1024 * 1024;
const ASSET_ID = /^ast-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function dataUrl(bytes: Uint8Array, mediaType: string): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return `data:${mediaType};base64,${btoa(chunks.join(''))}`;
}

/** Originals only, from the authenticated API. Failure never omits an image. */
export async function prepareExportImages(workspaceId: string, doc: Doc, embed: boolean): Promise<ExportImages> {
  const images = new Map<string, ExportImage>();
  let total = 0;
  for (const block of doc.blocks) {
    if (block.type !== 'image' || images.has(block.assetId)) continue;
    if (!ASSET_ID.test(block.assetId)) throw new Error('The page contains an invalid image asset.');
    const info = await getAsset(workspaceId, block.assetId);
    const extension = EXTENSIONS[info.media_type];
    total += info.bytes;
    if (!extension || info.workspace_id !== workspaceId || info.asset_id !== block.assetId
      || info.bytes < 1 || total > MAX_IMAGE_EXPORT_BYTES) throw new Error('The image export is invalid or exceeds 250 MiB.');
    const blob = await loadAssetBlob(workspaceId, block.assetId, new AbortController().signal, 'original');
    if (blob.size !== info.bytes || blob.type !== info.media_type) throw new Error('The image bytes do not match their metadata.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    images.set(block.assetId, {
      info, path: `assets/${block.assetId}.${extension}`, bytes,
      ...(embed ? { dataUrl: dataUrl(bytes, info.media_type) } : {}),
    });
  }
  return images;
}

export function markdownImageBundle(markdown: string, images: ExportImages): Blob {
  const encoder = new TextEncoder();
  return storedZip([
    { name: 'document.md', bytes: encoder.encode(markdown) },
    { name: 'assets.json', bytes: encoder.encode(JSON.stringify([...images.values()].map((image) => ({ ...image.info, file: image.path })), null, 2)) },
    ...[...images.values()].map((image) => ({ name: image.path, bytes: image.bytes })),
  ]);
}

export function placedImageDpi(pixels: number, width: number, page: 'A4' | 'Letter', orientation: 'portrait' | 'landscape'): number {
  const mm = page === 'A4' ? (orientation === 'portrait' ? 210 : 297) : (orientation === 'portrait' ? 215.9 : 279.4);
  return pixels / (((mm - 50.8) / 25.4) * width);
}
