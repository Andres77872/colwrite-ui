export const IMAGE_UPLOAD_EVENT = 'colwrite:image-upload';
export type ImageUploadTarget = { blockId: string; where: 'before' | 'after'; replaceBlank: boolean };

export function openImageUpload(blockId: string, where: 'before' | 'after' = 'after', replaceBlank = true): void {
  window.dispatchEvent(new CustomEvent<ImageUploadTarget>(IMAGE_UPLOAD_EVENT, { detail: { blockId, where, replaceBlank } }));
}
