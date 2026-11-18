import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/ui/inline-error';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { imageGenerationListQuery } from '@/data/imageGenerations';
import { ImageGenerationCard } from './ImageGenerationCard';

export function ImageHistory({ documentId }: { documentId: string }) {
  const workspaceId = useWorkspaceId();
  const [open, setOpen] = useState(false);
  const query = useInfiniteQuery({ ...imageGenerationListQuery(workspaceId, documentId), enabled: open });
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-medium">Image history</summary>
    {open && <div className="mt-2 grid gap-2">
      {query.isError && <InlineError title="Image history could not be read." onRetry={() => void query.refetch()} />}
      {query.isPending && <p role="status" className="text-sm">Reading image history…</p>}
      {query.data && !query.data.pages.some((page) => page.items.length) && <p className="text-sm text-muted-foreground">No image requests on this page.</p>}
      {query.data?.pages.flatMap((page) => page.items).map((item) => <ImageGenerationCard key={item.generation_id} generationId={item.generation_id} />)}
      {query.hasNextPage && <Button size="sm" variant="ghost" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>More images</Button>}
    </div>}
  </details>;
}
