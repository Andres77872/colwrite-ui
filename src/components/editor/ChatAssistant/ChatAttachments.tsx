import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, FileText, ImageOff, LoaderCircle, Paperclip, RotateCcw, Upload, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { describeApiError } from '@/api/errors';
import { useInfiniteQuery } from '@tanstack/react-query';
import { resourceContentUrl, resourceListQuery, resourcesOf } from '@/data/resources';
import { assetContentUrl, loadAssetBlob } from '@/data/assets';
import {
  attachmentKey, attachmentName, CHAT_FILE_ACCEPT, MAX_CHAT_ATTACHMENTS,
  type ChatAttachment,
} from '@/api/assistant/chatAttachments';
import type { ChatAttachmentDraft } from './useChatAttachments';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Spinner } from '@/components/ui/spinner';
import { InlineError } from '@/components/ui/inline-error';
import { EmptyState } from '@/components/ui/empty-state';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';

function ImagePreview({ assetId, name, small = false }: { assetId: string; name: string; small?: boolean }) {
  const host = useRef<HTMLSpanElement>(null);
  const workspaceId = useWorkspaceId();
  const [preview, setPreview] = useState<{ workspaceId: string; assetId: string; url: string | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let observer: IntersectionObserver | undefined;
    let started = false;
    const load = () => {
      if (started || controller.signal.aborted) return;
      started = true;
      observer?.disconnect();
      void loadAssetBlob(workspaceId, assetId, controller.signal, 'thumbnail').then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ workspaceId, assetId, url: objectUrl });
      }).catch(() => {
        if (!controller.signal.aborted) setPreview({ workspaceId, assetId, url: null });
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
  }, [assetId, workspaceId]);
  return <span ref={host} className="inline-flex min-h-4 min-w-4 max-w-full">
    {/* A bare svg's aria-label is read by few screen readers: the words go in text. */}
    {preview?.workspaceId !== workspaceId || preview.assetId !== assetId ? <span className="inline-flex"><Spinner className="size-4 text-muted-foreground" /><span className="sr-only">Loading image preview</span></span>
      : preview.url === null
        ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><ImageOff aria-hidden="true" className="size-4" />{!small && 'Preview unavailable'}</span>
        : <img src={preview.url} alt={name} onError={() => setPreview({ workspaceId, assetId, url: null })}
          className={small ? 'size-8 shrink-0 rounded object-cover' : 'max-h-36 max-w-full rounded object-contain'} />}
  </span>;
}

export function MessageAttachments({ attachments }: { attachments?: ChatAttachment[] }) {
  const workspaceId = useWorkspaceId();
  if (!attachments?.length) return null;
  return <ul aria-label="Message attachments" className="mb-2 flex flex-wrap gap-2 whitespace-normal">
    {attachments.map((item) => <li key={attachmentKey(item)} className="min-w-0 max-w-full">
      <a href={item.kind === 'image' ? assetContentUrl(workspaceId, item.asset_id) : resourceContentUrl(workspaceId, item.resource_id)}
        target="_blank" rel="noopener noreferrer" className="flex max-w-full flex-col gap-1 rounded-lg border border-border bg-background p-1.5 text-xs hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {item.kind === 'image'
          ? <ImagePreview assetId={item.asset_id} name={attachmentName(item)} />
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
            : item.attachment?.kind === 'image' ? <ImagePreview assetId={item.attachment.asset_id} name="" small />
              : <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate" title={item.filename}>{item.filename}</span>
          {item.state === 'uploading' && <span role="status" className="text-muted-foreground">Uploading…</span>}
          {item.state === 'ready' && item.onPage && <span className="shrink-0 text-muted-foreground">on this page</span>}
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

const LIBRARY_PDFS = { scope: 'library' } as const;

export function ChatAttachmentPicker({ draft, disabled, canUpload = true }: { draft: ChatAttachmentDraft; disabled: boolean; canUpload?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState(false);
  const workspaceId = useWorkspaceId();
  const pdfs = useInfiniteQuery({ ...resourceListQuery(workspaceId, LIBRARY_PDFS, PAGE_SIZE), enabled: open && library });
  const resources = resourcesOf(pdfs.data).filter(
    (item) => item.content_type === 'application/pdf' || /\.pdf$/i.test(item.filename),
  );
  const loading = library && pdfs.isFetching;
  const error = library && pdfs.isError ? describeApiError(pdfs.error, 'Could not load your Library.') : null;
  const more = pdfs.hasNextPage;
  const retry = () => void (pdfs.isFetchNextPageError ? pdfs.fetchNextPage() : pdfs.refetch());
  const full = draft.items.length >= MAX_CHAT_ATTACHMENTS;
  return <>
    <input ref={input} type="file" multiple accept={CHAT_FILE_ACCEPT} aria-label="Upload images or PDFs" className="sr-only" tabIndex={-1}
      disabled={disabled || full || !canUpload} onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        draft.addFiles(files);
      }} />
    <Popover open={open} onOpenChange={(value) => { setOpen(value); if (!value) setLibrary(false); }}>
      <PopoverTrigger asChild><button type="button" disabled={disabled} aria-label="Attach images or PDFs"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
        <Paperclip aria-hidden="true" className="size-4" />
      </button></PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 max-w-[calc(100vw-2rem)] p-2">
        <p className="px-2 py-1 text-xs font-medium">Attach files <span className="font-normal text-muted-foreground">{draft.items.length}/{MAX_CHAT_ATTACHMENTS}</span></p>
        <button type="button" disabled={full || !canUpload} onClick={() => { input.current?.click(); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-hover disabled:opacity-40">
          <Upload aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0">
            <span className="block">Upload images or PDFs</span>
            <span className="block text-2xs text-muted-foreground">{canUpload ? `PDFs · ${draft.pdfLabel}` : 'Viewers can’t upload files here'}</span>
          </span>
        </button>
        <button type="button" onClick={() => setLibrary(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-hover">
          <BookOpen aria-hidden="true" className="size-4" /> Choose a PDF from the Library
        </button>
        <p className="px-2 py-1 text-xs text-muted-foreground">PDFs are kept in your Library. Images: PNG, JPEG, WebP or GIF, up to 10 MB each.</p>
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
          {loading && <div role="status"><span className="sr-only">Loading PDFs…</span><ListSkeleton dense rows={3} /></div>}
          {!loading && !error && !resources.length && <EmptyState size="inline" title="No PDFs yet" description="Upload a PDF to add it to your Library." />}
          {error && <InlineError title="Could not load your Library" detail={error} onRetry={retry} retryLabel="Try again" />}
          {more && !loading && !error && <button type="button" onClick={() => void pdfs.fetchNextPage()} className="w-full rounded px-2 py-2 text-xs hover:bg-hover">Load more PDFs</button>}
        </div>}
      </PopoverContent>
    </Popover>
  </>;
}
