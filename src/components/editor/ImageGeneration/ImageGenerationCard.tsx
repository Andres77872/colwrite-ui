import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AssetImage } from '@/components/common/AssetImage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InlineError } from '@/components/ui/inline-error';
import { describeApiError } from '@/api/errors';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useActiveBlock, useDocumentSession, useEditorActions, usePageReadOnly } from '@/editor';
import { uid } from '@/lib/uid';
import {
  confirmImage, discardImageRequest, editImageRequest, imageGenerationQuery, proposeImageAgain,
  imageAvailabilityQuery,
  type ImageGenerationInfo, type ImageGenerationEdit,
} from '@/data/imageGenerations';
import { IMAGE_VENUE_CAUTION } from './imageGenerationCopy';
import { AssetPixelSize } from './AssetGenerationDetails';

const ASPECTS: ImageGenerationEdit['aspect_ratio'][] = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'];

export function ImageGenerationCard({ generationId, allowInsert = true }: {
  generationId: string; allowInsert?: boolean;
}) {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const options = imageGenerationQuery(workspaceId, generationId);
  const query = useQuery(options);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nextId, setNextId] = useState<string | null>(null);
  const [inserted, setInserted] = useState(false);
  const sending = useRef(false);
  const actionKey = useRef(uid());
  const readOnly = usePageReadOnly();
  const { documentId } = useDocumentSession();
  const { activeId } = useActiveBlock();
  const { getBlock, getBlockIds, insertBlocksAfter, appendBlockExact } = useEditorActions();
  const info = query.data;
  const availability = useQuery({
    ...imageAvailabilityQuery(workspaceId, info?.engine ?? 'gateway'),
    enabled: info?.status === 'proposed' && info.can_decide && !readOnly,
  });

  async function act(action: () => Promise<unknown>) {
    if (sending.current || readOnly) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: options.queryKey });
      await queryClient.invalidateQueries({ queryKey: imageAvailabilityQuery(workspaceId, info?.engine ?? 'gateway').queryKey });
    } catch (failure) {
      setError(describeApiError(failure, 'The image request could not be completed.'));
    } finally {
      sending.current = false; setBusy(false);
    }
  }
  if (nextId) return <ImageGenerationCard generationId={nextId} allowInsert={allowInsert} />;
  if (!info) return query.isError
    ? <InlineError title="This image request could not be read." onRetry={() => void query.refetch()} retryLabel="Read again" />
    : <p role="status" className="text-sm text-muted-foreground">Reading image request…</p>;
  const canAct = !readOnly && info.can_decide;
  const running = info.status === 'confirmed' || info.status === 'running';
  const proposed = info.status === 'proposed';
  const title = proposed ? 'Image request' : info.status === 'succeeded' ? 'Generated image' : 'Image generation';
  const details = <>
    <p className="whitespace-pre-wrap text-sm">{info.prompt}</p>
    <p className="text-xs text-muted-foreground">{info.provider === 'codex'
      ? 'Codex · Uses your ChatGPT plan’s image allowance.'
      : [info.model, info.quality, info.aspect_ratio, info.estimated_cost != null && `Estimated $${info.estimated_cost.toFixed(3)}`].filter(Boolean).join(' · ')}</p>
  </>;
  return <section className="my-3 grid gap-3 rounded-lg border border-border bg-surface p-3" aria-label={title}>
    <h3 className="text-sm font-semibold">{title}</h3>
    {proposed && <>{details}<p className="text-xs text-muted-foreground">{IMAGE_VENUE_CAUTION}</p></>}
    {editing && canAct && <RequestEditor info={info} busy={busy} close={() => setEditing(false)} save={(body) => act(async () => {
      const edited = await editImageRequest(workspaceId, generationId, body);
      queryClient.setQueryData(options.queryKey, edited);
      actionKey.current = uid();
      setEditing(false);
    })} />}
    {info.status === 'proposed' && canAct && !editing && <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy || !availability.data?.available} onClick={() => void act(() => confirmImage(workspaceId, generationId, info.confirmation_token, actionKey.current))}>Generate</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>Edit request</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => discardImageRequest(workspaceId, generationId))}>Discard</Button>
    </div>}
    {info.status === 'proposed' && canAct && !availability.data?.available && <p role="status" className="text-xs text-muted-foreground">{availability.isError ? 'Image availability could not be checked. Read the request again before generating.' : availability.data?.reason ?? 'Checking image availability…'}</p>}
    {running && <div className="flex items-center gap-3">
      <p role="status" className="text-sm">{info.status === 'confirmed' ? 'Queued for generation…' : 'Generating image… This may take two minutes.'}</p>
      {canAct && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => discardImageRequest(workspaceId, generationId))}>Stop</Button>}
    </div>}
    {info.status === 'succeeded' && info.asset_id && <>
      <AssetImage assetId={info.asset_id} alt={info.arguments.description} className="h-auto max-w-full rounded-md" />
      {allowInsert && canAct && documentId === info.document_id && <form className="grid gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (readOnly || inserted) return;
        const form = new FormData(event.currentTarget);
        const alt = String(form.get('alt') ?? '').trim();
        if (!alt || !info.asset_id) return;
        const anchorId = activeId ?? getBlockIds().at(-1);
        const anchor = anchorId ? getBlock(anchorId) : undefined;
        if (anchor?.locked) { setError('Choose an unlocked insertion point.'); return; }
        const block = {
          id: uid(), type: 'image', assetId: info.asset_id, alt,
          caption: String(form.get('caption') ?? '').trim() || undefined, width: 1,
          origin: { kind: 'generated', generationId },
        } as const;
        if (anchor) insertBlocksAfter(anchor.id, [block]);
        else appendBlockExact(block);
        setInserted(true);
      }}>
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Alt text and caption</summary>
          <label className="mt-2 grid gap-1 text-sm">Alt text<Input name="alt" required maxLength={4000} defaultValue={info.arguments.description} disabled={inserted} /></label>
          <label className="mt-2 grid gap-1 text-sm">Caption<Input name="caption" maxLength={10000} defaultValue="AI-generated conceptual illustration." disabled={inserted} /></label>
        </details>
        <Button type="submit" size="sm" disabled={inserted}>{inserted ? 'Inserted on this page' : 'Insert image'}</Button>
      </form>}
    </>}
    {info.status === 'unknown' && <p role="status" className="text-sm">The generator may have completed and charged. This request will not be retried automatically. Generating again is a new request and may spend again.</p>}
    {(info.status === 'failed' || info.status === 'refused') && <p role="status" className="text-sm">{info.status === 'refused' ? 'The image request was refused. It will not be retried with the same prompt.' : info.error_code === 'image_budget_exhausted' ? 'The image budget or plan allowance is used up.' : 'The image could not be generated. Nothing was inserted.'}</p>}
    {info.status === 'discarded' && <p className="text-sm text-muted-foreground">Image request discarded.</p>}
    {!proposed && <details>
      <summary className="cursor-pointer text-xs text-muted-foreground">Generation details</summary>
      <div className="mt-2 grid gap-2">
        {details}
        {info.asset_id && <AssetPixelSize assetId={info.asset_id} />}
        {info.completed_at && <p className="text-xs text-muted-foreground">{new Date(info.completed_at).toLocaleString()}{info.cost_usd !== null ? ` · $${info.cost_usd.toFixed(4)}` : ''}{info.codex_version ? ` · ${info.codex_version}` : ''}</p>}
      </div>
    </details>}
    {canAct && !info.chat_id && ['succeeded', 'failed', 'unknown'].includes(info.status) && <Button size="sm" variant="ghost" title="Use this exact prompt again" disabled={busy} onClick={() => void act(async () => {
      const next = await proposeImageAgain(workspaceId, info);
      setNextId(next.generation_id);
    })}>Generate again…</Button>}
    {error && <InlineError title={error} onRetry={() => void query.refetch()} retryLabel="Read latest request" />}
  </section>;
}

function RequestEditor({ info, busy, save, close }: {
  info: ImageGenerationInfo; busy: boolean; save: (body: ImageGenerationEdit) => Promise<void>; close: () => void;
}) {
  const [token] = useState(info.confirmation_token);
  return <form className="grid gap-2" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const prompt = String(data.get('prompt') ?? '').trim();
    const aspect = info.engine === 'codex' ? info.aspect_ratio : String(data.get('aspect') ?? '');
    if (prompt && ASPECTS.includes(aspect as ImageGenerationEdit['aspect_ratio'])) void save({
      prompt, aspect_ratio: aspect as ImageGenerationEdit['aspect_ratio'], confirmation_token: token,
    });
  }}>
    <label className="grid gap-1 text-sm">Exact prompt<textarea name="prompt" required maxLength={4000} defaultValue={info.prompt} className="min-h-32 rounded-md border border-border bg-background p-2" /></label>
    <label className="grid gap-1 text-sm">Aspect ratio<select name="aspect" defaultValue={info.aspect_ratio} disabled={info.engine === 'codex'}>{ASPECTS.map((aspect) => <option key={aspect}>{aspect}</option>)}</select></label>
    <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy}>Save request</Button><Button type="button" size="sm" variant="ghost" onClick={close}>Cancel edit</Button></div>
  </form>;
}
