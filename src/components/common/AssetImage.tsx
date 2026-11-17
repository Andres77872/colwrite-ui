import { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { loadAssetBlob, type AssetRendition } from '@/data/assets';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { Spinner } from '@/components/ui/spinner';

/** Authenticated, lazy image loading. No authored URL ever becomes a src. */
export function AssetImage({ assetId, alt, rendition = 'display', className, fitColumn = false }: {
  assetId: string; alt: string; rendition?: AssetRendition; className?: string; fitColumn?: boolean;
}) {
  const workspaceId = useWorkspaceId();
  const host = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<{ key: string; url: string | null } | null>(null);
  const key = `${workspaceId}:${assetId}:${rendition}`;
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    let observer: IntersectionObserver | undefined;
    let started = false;
    const load = () => {
      if (started || controller.signal.aborted) return;
      started = true;
      observer?.disconnect();
      void loadAssetBlob(workspaceId, assetId, controller.signal, rendition).then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage({ key, url });
      }).catch(() => {
        if (!controller.signal.aborted) setImage({ key, url: null });
      });
    };
    if (typeof IntersectionObserver !== 'undefined' && host.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load();
      }, { rootMargin: '200px' });
      observer.observe(host.current);
    } else load();
    return () => {
      controller.abort();
      observer?.disconnect();
      if (url) URL.revokeObjectURL(url);
    };
  }, [workspaceId, assetId, rendition, key]);
  return <span ref={host} className={`${fitColumn ? 'flex w-full' : 'inline-flex'} min-h-8 min-w-8 max-w-full items-center justify-center`}>
    {image?.key !== key
      ? <><Spinner className="size-4 text-muted-foreground" /><span className="sr-only">Loading image</span></>
      : image.url === null
        ? <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><ImageOff aria-hidden="true" className="size-4" />Image unavailable</span>
        : <img src={image.url} alt={alt} className={className} style={fitColumn ? { width: '100%', height: 'auto' } : undefined} onError={() => setImage({ key, url: null })} />}
  </span>;
}
