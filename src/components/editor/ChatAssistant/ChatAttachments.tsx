import { useEffect, useRef, useState } from 'react';
import { Check, FileText, ImageOff, Library, LoaderCircle, Paperclip, RotateCcw, Upload, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { describeApiError } from '@/services/contracts';
import { listResources, resourceContentUrl, type ResourceItem } from '@/services/resources';
import {
  attachmentKey, attachmentName, CHAT_FILE_ACCEPT, chatImageContentUrl, loadChatImageBlob, MAX_CHAT_ATTACHMENTS,
  type ChatAttachment,
} from '@/services/chatAttachments';
import type { ChatAttachmentDraft } from './useChatAttachments';

function ImagePreview({ imageId, name, small = false }: { imageId: string; name: string; small?: boolean }) {
  const host = useRef<HTMLSpanElement>(null);
  const [preview, setPreview] = useState<{ imageId: string; url: string | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let observer: IntersectionObserver | undefined;
    let started = false;
    const load = () => {
      if (started || controller.signal.aborted) return;
      started = true;
      observer?.disconnect();
      void loadChatImageBlob(imageId, controller.signal).then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ imageId, url: objectUrl });
      }).catch(() => {
        if (!controller.signal.aborted) setPreview({ imageId, url: null });
      });
    };
    // Native image lazy-loading does not defer fetch-to-blob. Observe the
    // placeholder so opening a long chat does not download every original.
    if (typeof IntersectionObserver !== 'undefined' && host.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load();
      }, { rootMargin: '200px' });
      observer.observe(host.current);
    } else load();
    return () => { controller.abort(); observer?.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [imageId]);
  return <span ref={host} className="inline-flex min-h-4 min-w-4 max-w-full">
    {preview?.imageId !== imageId ? <LoaderCircle aria-label="Loading image preview" className="size-4 animate-spin text-muted-foreground" />
      : preview.url === null
        ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><ImageOff aria-hidden="true" className="size-4" />{!small && 'Preview unavailable'}</span>
        : <img src={preview.url} alt={name} onError={() => setPreview({ imageId, url: null })}
          className={small ? 'size-8 shrink-0 rounded object-cover' : 'max-h-36 max-w-full rounded object-contain'} />}
  </span>;
}

export function MessageAttachments({ attachments }: { attachments?: ChatAttachment[] }) {
  if (!attachments?.length) return null;
  return <ul aria-label="Message attachments" className="mb-2 flex flex-wrap gap-2 whitespace-normal">
    {attachments.map((item) => <li key={attachmentKey(item)} className="min-w-0 max-w-full">
      <a href={item.kind === 'image' ? chatImageContentUrl(item.image_id) : resourceContentUrl(item.resource_id)}
        target="_blank" rel="noopener noreferrer" className="flex max-w-full flex-col gap-1 rounded-lg border border-border bg-background p-1.5 text-xs hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {item.kind === 'image'
          ? <ImagePreview imageId={item.image_id} name={attachmentName(item)} />
          : <FileText aria-hidden="true" className="h-5 w-5 text-muted-foreground" />}
        <span className="max-w-48 truncate">{attachmentName(item)}</span>
      </a>
    </li>)}
  </ul>;
}

export function DraftAttachments({ draft }: { draft: ChatAttachmentDraft }) {
  if (!draft.items.length && !draft.error) return null;
  return <div className="px-2 pt-2">
    <ul aria-label="Files to send" className="flex flex-col gap-1.5">
      {draft.items.map((item) => <li key={item.id} className="rounded-md border border-border bg-subtle/40 px-2 py-1.5">
        <div className="flex items-center gap-2 text-xs">
          {item.state === 'uploading' ? <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin" />
            : item.attachment?.kind === 'image' ? <ImagePreview imageId={item.attachment.image_id} name="" small />
              : <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate" title={item.filename}>{item.filename}</span>
          {item.state === 'uploading' && <span role="status" className="text-muted-foreground">Uploading…</span>}
          {item.state === 'error' && <button type="button" onClick={() => draft.retry(item.id)} aria-label={`Retry uploading ${item.filename}`} className="rounded p-1 hover:bg-hover"><RotateCcw className="size-3.5" /></button>}
          <button type="button" onClick={() => draft.remove(item.id)} aria-label={`Remove ${item.filename}`} className="rounded p-1 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"><X aria-hidden="true" className="size-3.5" /></button>
        </div>
        {item.error && <p role="alert" className="mt-1 text-xs text-destructive">{item.error}</p>}
      </li>)}
    </ul>
    {draft.error && <p role="alert" className="mt-1 text-xs text-destructive">{draft.error}</p>}
  </div>;
}

const PAGE_SIZE = 20;

export function ChatAttachmentPicker({ draft, disabled }: { draft: ChatAttachmentDraft; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState(false);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = draft.items.length >= MAX_CHAT_ATTACHMENTS;
  const load = async (nextOffset: number) => {
    const epoch = ++generation.current;
    setLoading(true); setError(null);
    try {
      const page = await listResources({ scope: 'library', limit: PAGE_SIZE, offset: nextOffset });
      if (epoch !== generation.current) return;
      const pdfs = page.resources.filter((item) => item.content_type === 'application/pdf' || /\.pdf$/i.test(item.filename));
      setResources((current) => nextOffset ? [...current, ...pdfs.filter((item) => !current.some((old) => old.id === item.id))] : pdfs);
      setOffset(nextOffset + page.resources.length);
      setMore(page.resources.length === PAGE_SIZE);
    } catch (cause) {
      if (epoch === generation.current) setError(describeApiError(cause, 'Could not load your library.'));
    } finally { if (epoch === generation.current) setLoading(false); }
  };
  return <>
    <input ref={input} type="file" multiple accept={CHAT_FILE_ACCEPT} aria-label="Upload images or PDFs" className="sr-only" tabIndex={-1}
      disabled={disabled || full} onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        draft.addFiles(files);
      }} />
    <Popover open={open} onOpenChange={(value) => { setOpen(value); if (!value) { generation.current += 1; setLibrary(false); setLoading(false); } }}>
      <PopoverTrigger asChild><button type="button" disabled={disabled} aria-label="Attach images or PDFs"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
        <Paperclip aria-hidden="true" className="size-4" />
      </button></PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 max-w-[calc(100vw-2rem)] p-2">
        <p className="px-2 py-1 text-xs font-medium">Attach files <span className="font-normal text-muted-foreground">{draft.items.length}/{MAX_CHAT_ATTACHMENTS}</span></p>
        <button type="button" disabled={full} onClick={() => { input.current?.click(); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-hover disabled:opacity-40">
          <Upload aria-hidden="true" className="size-4" /> Upload images or PDFs
        </button>
        <button type="button" onClick={() => { setLibrary(true); setResources([]); setOffset(0); void load(0); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-hover">
          <Library aria-hidden="true" className="size-4" /> Choose PDF from library
        </button>
        <p className="px-2 py-1 text-xs text-muted-foreground">New PDFs are saved to your library. Images: PNG, JPEG, WebP or GIF, up to 10 MB each.</p>
        {library && <div className="mt-2 border-t border-border pt-2">
          <p className="px-2 pb-1 text-xs font-medium">Your PDFs</p>
          <ul aria-label="Library PDFs" className="max-h-56 overflow-y-auto">
            {resources.map((resource) => {
              const selected = draft.attachments.some((item) => item.kind === 'resource' && item.resource_id === resource.id);
              return <li key={resource.id}><button type="button" disabled={selected || full} onClick={() => draft.addResource(resource)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-hover disabled:opacity-50">
                {selected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : <FileText aria-hidden="true" className="size-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate" title={resource.filename}>{resource.title || resource.filename}</span>
                {selected && <span className="sr-only">Attached</span>}
              </button></li>;
            })}
          </ul>
          {loading && <p role="status" className="px-2 py-2 text-xs text-muted-foreground">Loading PDFs…</p>}
          {!loading && !error && !resources.length && <p className="px-2 py-2 text-xs text-muted-foreground">No PDFs yet. Upload a PDF to add it to your library.</p>}
          {error && <div className="px-2 py-1 text-xs"><p role="alert" className="text-destructive">{error}</p><button type="button" onClick={() => void load(offset)} className="mt-1 underline">Try again</button></div>}
          {more && !loading && !error && <button type="button" onClick={() => void load(offset)} className="w-full rounded px-2 py-2 text-xs hover:bg-hover">Load more PDFs</button>}
        </div>}
      </PopoverContent>
    </Popover>
  </>;
}
