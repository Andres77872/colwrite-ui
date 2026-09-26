import { buildUrl, ensureRefreshed, getRefreshGeneration, post } from './api';
import { ApiError } from './contracts';
import type { ResourceItem } from './resources';

export const MAX_CHAT_ATTACHMENTS = 8;
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
export const CHAT_FILE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf';

export type ChatAttachmentRef =
  | { kind: 'image'; image_id: string }
  | { kind: 'resource'; resource_id: number };

/** Metadata is resolved by the API; only references are sent with a turn. */
export type ChatAttachment = ChatAttachmentRef & {
  filename?: string;
  media_type?: string;
  size_bytes?: number;
};

export type ChatImage = { id: string; filename: string; media_type: string; size_bytes: number };

export function attachmentRef(attachment: ChatAttachment): ChatAttachmentRef {
  return attachment.kind === 'image'
    ? { kind: 'image', image_id: attachment.image_id }
    : { kind: 'resource', resource_id: attachment.resource_id };
}

export function attachmentKey(attachment: ChatAttachmentRef): string {
  return attachment.kind === 'image' ? `image:${attachment.image_id}` : `resource:${attachment.resource_id}`;
}

export function attachmentName(attachment: ChatAttachment): string {
  return attachment.filename || (attachment.kind === 'image' ? 'Image attachment' : 'PDF attachment');
}

export function resourceAttachment(resource: ResourceItem): ChatAttachment {
  return { kind: 'resource', resource_id: resource.id, filename: resource.filename,
    media_type: resource.content_type, size_bytes: resource.byte_size };
}

export async function uploadChatImage(file: File): Promise<ChatAttachment> {
  const body = new FormData();
  body.append('file', file);
  const { image } = await post<{ image: ChatImage }>('/users/me/chat-images', body);
  return { kind: 'image', image_id: image.id, filename: image.filename,
    media_type: image.media_type, size_bytes: image.size_bytes };
}

export function chatImageContentUrl(imageId: string): string {
  return buildUrl(`/users/me/chat-images/${encodeURIComponent(imageId)}/content`);
}

export function chatFileError(file: File): string | null {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return null;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    return 'Choose a PDF, PNG, JPEG, WebP, or GIF file.';
  }
  if (file.size > MAX_CHAT_IMAGE_BYTES) return 'Images must be 10 MB or smaller.';
  return null;
}

/** File pickers on some platforms omit MIME; the API still validates bytes. */
export function withChatFileType(file: File): File {
  if (file.type) return file;
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  const types: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  return types[extension] ? new File([file], file.name, { type: types[extension], lastModified: file.lastModified }) : file;
}

/** Thumbnails use the shared serialized refresh path when the access cookie expires. */
export async function loadChatImageBlob(imageId: string, signal: AbortSignal): Promise<Blob> {
  const observedGeneration = getRefreshGeneration();
  const fetchImage = () => fetch(chatImageContentUrl(imageId), { credentials: 'include', signal });
  let response = await fetchImage();
  if (response.status === 401 && !signal.aborted && await ensureRefreshed(observedGeneration)) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    response = await fetchImage();
  }
  if (!response.ok) throw new ApiError('Image preview unavailable.', response.status, null);
  return response.blob();
}
