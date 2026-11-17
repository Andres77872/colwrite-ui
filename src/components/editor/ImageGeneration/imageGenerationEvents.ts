export const IMAGE_GENERATION_EVENT = 'colwrite:image-generation';
export function openImageGeneration(blockId?: string) {
  window.dispatchEvent(new CustomEvent(IMAGE_GENERATION_EVENT, { detail: { blockId } }));
}
