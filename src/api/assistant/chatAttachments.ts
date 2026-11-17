import type { ImageAttachment, ResourceAttachment, ResourceItem } from '@/api/schema';
import { MAX_IMAGE_UPLOAD_BYTES, uploadAsset } from '@/data/assets';

export const MAX_CHAT_ATTACHMENTS = 8;
export const CHAT_FILE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf';

export type ChatAttachmentRef = ImageAttachment | ResourceAttachment;

/** Metadata is resolved by the API; only references are sent with a turn. */
export type ChatAttachment = ChatAttachmentRef & {
  filename?: string;
  media_type?: string;
  size_bytes?: number;
};

export function attachmentRef(attachment: ChatAttachment): ChatAttachmentRef {
  return attachment.kind === 'image'
    ? { kind: 'image', asset_id: attachment.asset_id }
    : { kind: 'resource', resource_id: attachment.resource_id };
}

export function attachmentKey(attachment: ChatAttachmentRef): string {
  return attachment.kind === 'image' ? `image:${attachment.asset_id}` : `resource:${attachment.resource_id}`;
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
  const image = await uploadAsset(workspaceId, file);
  return { kind: 'image', asset_id: image.asset_id, filename: image.filename,
    media_type: image.media_type, size_bytes: image.bytes };
}

export function chatFileError(file: File): string | null {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return null;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    return 'Choose a PDF, PNG, JPEG, WebP, or GIF file.';
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) return 'Images must be 25 MB or smaller.';
  return null;
}

/** File pickers on some platforms omit MIME; the API still validates bytes. */
export function withChatFileType(file: File): File {
  if (file.type) return file;
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  const types: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  return types[extension] ? new File([file], file.name, { type: types[extension], lastModified: file.lastModified }) : file;
}
