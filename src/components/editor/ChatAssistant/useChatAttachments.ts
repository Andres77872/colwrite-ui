import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { uid } from '@/lib/uid';
import { describeApiError } from '@/services/contracts';
import { uploadResource, type ResourceItem } from '@/services/resources';
import {
  attachmentKey, chatFileError, MAX_CHAT_ATTACHMENTS, resourceAttachment, uploadChatImage, withChatFileType,
  type ChatAttachment,
} from '@/services/chatAttachments';

export type PendingChatAttachment = {
  id: string;
  filename: string;
  state: 'uploading' | 'ready' | 'error';
  attachment?: ChatAttachment;
  file?: File;
  error?: string;
};

/** A synchronous reservation prevents concurrent file selections exceeding the cap. */
export function useChatAttachments(chatId: string | null) {
  const [items, setItems] = useState<PendingChatAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<PendingChatAttachment[]>([]);
  const generation = useRef(0);
  const mounted = useRef(true);
  const replace = useCallback((next: PendingChatAttachment[]) => {
    current.current = next;
    setItems(next);
  }, []);
  const clear = useCallback(() => {
    generation.current += 1;
    replace([]);
    setError(null);
  }, [replace]);

  useLayoutEffect(() => { clear(); }, [chatId, clear]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  const upload = async (item: PendingChatAttachment, epoch: number) => {
    if (!item.file) return;
    try {
      const file = withChatFileType(item.file);
      const validation = chatFileError(file);
      if (validation) throw new Error(validation);
      const attachment = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
        ? resourceAttachment(await uploadResource(file))
        : await uploadChatImage(file);
      if (!mounted.current || epoch !== generation.current) return;
      if (current.current.some((entry) => entry.id !== item.id && entry.attachment
        && attachmentKey(entry.attachment) === attachmentKey(attachment))) {
        replace(current.current.filter((entry) => entry.id !== item.id));
      } else {
        replace(current.current.map((entry) => entry.id === item.id
          ? { id: item.id, filename: attachment.filename || file.name, state: 'ready', attachment }
          : entry));
      }
    } catch (cause) {
      if (!mounted.current || epoch !== generation.current) return;
      replace(current.current.map((entry) => entry.id === item.id
        ? { ...entry, state: 'error', error: describeApiError(cause, 'Could not upload this file.') }
        : entry));
    }
  };

  return {
    items, error, clear,
    blocked: items.some((item) => item.state !== 'ready'),
    attachments: items.flatMap((item) => item.attachment ? [item.attachment] : []),
    remove: (id: string) => { replace(current.current.filter((item) => item.id !== id)); setError(null); },
    addFiles: (files: File[]) => {
      const available = MAX_CHAT_ATTACHMENTS - current.current.length;
      const accepted = files.slice(0, available);
      setError(files.length > available ? `Attach up to ${MAX_CHAT_ATTACHMENTS} files per message.` : null);
      const pending = accepted.map((file): PendingChatAttachment => ({ id: uid(), filename: file.name, file, state: 'uploading' }));
      replace([...current.current, ...pending]);
      for (const item of pending) void upload(item, generation.current);
    },
    retry: (id: string) => {
      const item = current.current.find((entry) => entry.id === id);
      if (!item?.file || item.state !== 'error') return;
      replace(current.current.map((entry) => entry.id === id ? { ...entry, state: 'uploading', error: undefined } : entry));
      void upload(item, generation.current);
    },
    addResource: (resource: ResourceItem) => {
      const attachment = resourceAttachment(resource);
      if (current.current.some((item) => item.attachment && attachmentKey(item.attachment) === attachmentKey(attachment))) return;
      if (current.current.length >= MAX_CHAT_ATTACHMENTS) {
        setError(`Attach up to ${MAX_CHAT_ATTACHMENTS} files per message.`);
        return;
      }
      replace([...current.current, { id: uid(), filename: resource.filename, state: 'ready', attachment }]);
      setError(null);
    },
  };
}

export type ChatAttachmentDraft = ReturnType<typeof useChatAttachments>;
