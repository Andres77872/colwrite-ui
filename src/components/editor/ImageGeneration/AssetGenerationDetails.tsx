import { useQuery } from '@tanstack/react-query';
import { assetInfoQuery } from '@/data/assets';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { InlineError } from '@/components/ui/inline-error';
import { IMAGE_VENUE_CAUTION } from './imageGenerationCopy';

/** Reads immutable, portable provenance from the authorized asset, not the
 * source workspace's attempt row. Copies keep it after the source is purged. */
export function AssetGenerationDetails({ assetId }: { assetId: string }) {
  const workspaceId = useWorkspaceId();
  const query = useQuery(assetInfoQuery(workspaceId, assetId));
  if (query.isError) return <InlineError title="The image details could not be read." onRetry={() => void query.refetch()} />;
  if (!query.data) return <p role="status">Reading image details…</p>;
  const generation = query.data.generation;
  if (!generation) return <InlineError title="This image has no generation record." />;
  return <div className="grid gap-3 text-sm">
    <p>{query.data.width} × {query.data.height} pixels · {generation.provider === 'codex' ? `Codex · ${generation.codex_version ?? 'version not reported'} · default image settings` : `${generation.model} · ${generation.quality} · ${generation.aspect_ratio}`}</p>
    <p>Generated {new Date(generation.completed_at).toLocaleString()}{generation.cost_usd !== null ? ` · $${generation.cost_usd.toFixed(4)}` : ' · Cost not reported'}</p>
    <p className="whitespace-pre-wrap">{generation.prompt}</p>
    <p className="text-xs text-muted-foreground">{IMAGE_VENUE_CAUTION}</p>
  </div>;
}

export function AssetPixelSize({ assetId }: { assetId: string }) {
  const workspaceId = useWorkspaceId();
  const query = useQuery(assetInfoQuery(workspaceId, assetId));
  return query.data ? <p className="text-xs text-muted-foreground">{query.data.width} × {query.data.height} pixels</p> : null;
}
