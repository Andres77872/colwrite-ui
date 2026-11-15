import { api, multipartBody, unwrap } from '@/api/client';
import type { BodyChatImagesUploadChatImage, ChatImageItem, ResourceItem } from '@/api/schema';
import { apiUrl } from '@/api/url';
import { uid } from '@/lib/uid';

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

export type ChatImage = ChatImageItem;

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

/** Store an image in the workspace, for a turn to attach. */
export async function uploadChatImage(workspaceId: string, file: File): Promise<ChatAttachment> {
  const body = new FormData();
  body.append('file', file);
  const image = await unwrap(api.POST('/workspaces/{workspace_id}/chat-images', {
    params: { path: { workspace_id: workspaceId }, header: { 'Idempotency-Key': uid() } },
    body: multipartBody<BodyChatImagesUploadChatImage>(body),
  }));
  return { kind: 'image', image_id: image.id, filename: image.filename,
    media_type: image.media_type, size_bytes: image.size_bytes };
}

export function chatImageContentUrl(workspaceId: string, imageId: string): string {
  return apiUrl('/workspaces/{workspace_id}/chat-images/{image_id}/content', {
    path: { workspace_id: workspaceId, image_id: imageId },
  });
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

/** A thumbnail's bytes, through the client, so an expired access cookie is refreshed first. */
export async function loadChatImageBlob(workspaceId: string, imageId: string, signal: AbortSignal): Promise<Blob> {
  return unwrap(api.GET('/workspaces/{workspace_id}/chat-images/{image_id}/content', {
    params: { path: { workspace_id: workspaceId, image_id: imageId } },
    parseAs: 'blob',
    signal,
  }));
}
