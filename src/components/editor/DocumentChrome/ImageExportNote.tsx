import { useQueries } from '@tanstack/react-query';
import { getAsset } from '@/data/assets';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useEditorDoc } from '@/editor';
import { placedImageDpi } from '@/export/images';
import type { ExportOrientation, ExportPageSize } from '@/export/types';

export function ImageExportNote({ page, orientation }: { page: ExportPageSize; orientation: ExportOrientation }) {
  const workspaceId = useWorkspaceId();
  const { doc } = useEditorDoc();
  const blocks = doc.blocks.filter((block) => block.type === 'image');
  const ids = [...new Set(blocks.map((block) => block.assetId))];
  const results = useQueries({ queries: ids.map((id) => ({
    queryKey: ['ws', workspaceId, 'assets', id],
    queryFn: () => getAsset(workspaceId, id),
    staleTime: Infinity,
  })) });
  if (!blocks.length) return null;
  const info = new Map(results.flatMap((result) => result.data ? [[result.data.asset_id, result.data] as const] : []));
  const low = blocks.flatMap((block) => {
    const asset = info.get(block.assetId);
    const dpi = asset ? placedImageDpi(asset.width, block.width ?? 1, page, orientation) : null;
    return dpi !== null && dpi < 300 ? [{ block, dpi }] : [];
  });
  return <div className="grid gap-1 text-xs text-muted-foreground" aria-label="Image export details">
    <p>Original image files are included. Markdown and LaTeX with images download as a ZIP.</p>
    {results.some((result) => result.isPending) && <p>Checking image resolution…</p>}
    {results.some((result) => result.isError) && <p>Image resolution could not be checked. The export will still verify each original.</p>}
    {low.map(({ block, dpi }) => <p key={block.id}>“{block.alt}”: about {Math.round(dpi)} dpi at its placed width; 300 dpi is recommended for print.</p>)}
  </div>;
}
