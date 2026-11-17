import { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InlineError } from '@/components/ui/inline-error';
import { describeApiError } from '@/api/errors';
import { useAssistantCatalog } from '@/components/preferences/assistantCatalogContextState';
import { useAgentEngine } from '@/components/preferences/agentEngineContextState';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useActiveBlock, useDocumentActions, useDocumentSession, usePageReadOnly } from '@/editor';
import { imageAvailabilityQuery, imageGenerationListQuery, proposeImage, type ImageGenerationRequest } from '@/data/imageGenerations';
import { uid } from '@/lib/uid';
import { IMAGE_GENERATION_EVENT, openImageGeneration } from './imageGenerationEvents';
import { ImageGenerationCard } from './ImageGenerationCard';
import { IMAGE_VENUE_CAUTION } from './imageGenerationCopy';

export function ImageGenerationButton({ disabled = false }: { disabled?: boolean }) {
  const { tool } = useAssistantCatalog();
  const { statusOf, requestFor } = useAgentEngine();
  const { activeId } = useActiveBlock();
  const images = tool('image_generate');
  const workspaceId = useWorkspaceId();
  const availability = useQuery({ ...imageAvailabilityQuery(workspaceId, requestFor('chat').engine ?? 'gateway'), enabled: images?.state === 'on' });
  const generator = statusOf(requestFor('chat').engine ?? 'gateway')?.image_generation;
  const reason = images?.state === 'on'
    ? generator?.available === false ? generator.reason ?? 'Image generation is not available.'
      : availability.data?.available ? undefined : availability.data?.reason ?? 'Checking image availability…'
    : images?.reason ?? 'Reading image availability…';
  return <Button type="button" size="icon" variant="ghost" disabled={disabled || !!reason} title={reason ?? 'Generate image…'} aria-label="Generate image…" onClick={() => openImageGeneration(activeId ?? undefined)}><ImagePlus className="h-4 w-4" /></Button>;
}

export function ImageGenerationHost() {
  const [target, setTarget] = useState<{ blockId?: string } | null>(null);
  const readOnly = usePageReadOnly();
  useEffect(() => {
    const open = (event: Event) => {
      if (!readOnly && event instanceof CustomEvent && event.detail && typeof event.detail === 'object') {
        setTarget({ blockId: typeof event.detail.blockId === 'string' ? event.detail.blockId : undefined });
      }
    };
    window.addEventListener(IMAGE_GENERATION_EVENT, open);
    return () => window.removeEventListener(IMAGE_GENERATION_EVENT, open);
  }, [readOnly]);
  if (!target || readOnly) return null;
  return <ImageGenerationDialog blockId={target.blockId} close={() => setTarget(null)} />;
}

function ImageGenerationDialog({ blockId, close }: { blockId?: string; close: () => void }) {
  const workspaceId = useWorkspaceId();
  const { ensureRemoteDocument, flushPendingSave } = useDocumentActions();
  const { requestFor, statusOf } = useAgentEngine();
  const { documentId: savedDocumentId } = useDocumentSession();
  const { tool } = useAssistantCatalog();
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [key] = useState(uid);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const images = tool('image_generate');
  const availability = useQuery({ ...imageAvailabilityQuery(workspaceId, requestFor('chat').engine ?? 'gateway'), enabled: images?.state === 'on' });
  const generator = statusOf(requestFor('chat').engine ?? 'gateway')?.image_generation;
  const reason = images?.state === 'on'
    ? generator?.available === false ? generator.reason ?? 'Image generation is not available.'
      : availability.data?.available ? null : availability.data?.reason ?? 'Checking image availability…'
    : images?.reason ?? 'Reading image availability…';
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>Generate an image</DialogTitle><DialogDescription>Prepare a request first. Nothing is generated or spent until you inspect it and choose Generate.</DialogDescription></DialogHeader>
    {generationId ? <ImageGenerationCard generationId={generationId} targetBlockId={blockId} /> : <form className="grid gap-3" onSubmit={async (event) => {
      event.preventDefault();
      if (busy || reason) return;
      const data = new FormData(event.currentTarget);
      const description = String(data.get('description') ?? '').trim();
      if (!description) return;
      setBusy(true); setError(null);
      try {
        const documentId = await ensureRemoteDocument();
        if (!documentId || !await flushPendingSave()) throw new Error('Save this page before preparing an image request.');
        if (!live.current) return;
        const request = requestFor('chat');
        const purpose = String(data.get('purpose') ?? 'illustration') as ImageGenerationRequest['purpose'];
        const result = await proposeImage(workspaceId, {
          document_id: documentId, engine: request.engine ?? 'gateway', purpose,
          description, style: String(data.get('style') ?? ''), exact_text: String(data.get('exact_text') ?? ''),
          aspect_ratio: '3:2',
        }, key);
        if (live.current) setGenerationId(result.generation_id);
      } catch (failure) {
        if (live.current) setError(describeApiError(failure, 'The image request could not be prepared.'));
      } finally {
        if (live.current) setBusy(false);
      }
    }}>
      <p className="text-xs text-muted-foreground">{IMAGE_VENUE_CAUTION}</p>
      <label className="grid gap-1 text-sm">Purpose<select name="purpose" defaultValue="illustration">
        <option value="illustration">Conceptual illustration</option><option value="graphical_abstract">Graphical abstract</option>
        <option value="cover">Cover</option><option value="schematic">Simple schematic</option><option value="other">Other</option>
      </select></label>
      <label className="grid gap-1 text-sm">What should it show?<textarea name="description" required maxLength={2000} className="min-h-24 rounded-md border border-border bg-background p-2" /></label>
      <label className="grid gap-1 text-sm">Visual style (optional)<Input name="style" maxLength={500} /></label>
      <label className="grid gap-1 text-sm">Exact text in the image (optional)<Input name="exact_text" maxLength={500} /></label>
      {reason && <p className="text-sm text-muted-foreground">{reason}</p>}
      {error && <InlineError title={error} />}
      <Button type="submit" disabled={busy || !!reason}>{busy ? 'Preparing request…' : 'Review exact request'}</Button>
    </form>}
    {savedDocumentId && <>
      <Button variant="ghost" size="sm" onClick={() => setShowHistory((shown) => !shown)}>{showHistory ? 'Hide previous image requests' : 'Previous image requests'}</Button>
      {showHistory && <ImageHistory documentId={savedDocumentId} excludeId={generationId} />}
    </>}
  </DialogContent></Dialog>;
}

function ImageHistory({ documentId, excludeId }: { documentId: string; excludeId: string | null }) {
  const workspaceId = useWorkspaceId();
  const query = useInfiniteQuery(imageGenerationListQuery(workspaceId, documentId));
  if (query.isError) return <InlineError title="Image requests could not be read." onRetry={() => void query.refetch()} />;
  if (!query.data) return <p role="status" className="text-sm">Reading image requests…</p>;
  return <div className="grid gap-2">
    {!query.data.pages.some((page) => page.items.length) && <p className="text-sm text-muted-foreground">No image requests on this page.</p>}
    {query.data.pages.flatMap((page) => page.items).filter((item) => item.generation_id !== excludeId).map((item) => <ImageGenerationCard key={item.generation_id} generationId={item.generation_id} />)}
    {query.hasNextPage && <Button size="sm" variant="ghost" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Reading more…' : 'More image requests'}</Button>}
  </div>;
}
