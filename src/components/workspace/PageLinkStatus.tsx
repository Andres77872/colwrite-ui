import { useState } from 'react';
import { ArrowUpRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { PAGE_UNAVAILABLE, type PageLinkTarget } from '@/actions/usePageLink';
import { WorkspaceIcon } from './WorkspaceIcon';

/**
 * Where a linked page is, said for the author, with Open where it can be
 * opened (M5.UI-2): in this workspace; "This page is in another workspace",
 * which Open switches to; or not available. Shared by a chat reference's
 * popover and a page link's card, so the two read alike.
 */
export function PageLinkStatus({
  target,
  onOpen,
}: {
  target: PageLinkTarget;
  /** Resolves once the page is open (or the switch to its workspace is). */
  onOpen: () => Promise<void>;
}) {
  const [opening, setOpening] = useState(false);
  const open = () => {
    setOpening(true);
    void onOpen().finally(() => setOpening(false));
  };

  switch (target.kind) {
    case 'loading':
      return (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-3.5" />
          Finding this page…
        </p>
      );
    case 'here':
      return (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
            {target.open ? 'This page is open' : 'A page in this workspace'}
          </p>
          {!target.open && (
            <Button size="sm" variant="outline" onClick={open} disabled={opening}>
              {opening ? <Spinner /> : <ArrowUpRight aria-hidden="true" />}
              Open
            </Button>
          )}
        </div>
      );
    case 'elsewhere':
      return (
        <div className="space-y-2" role="status">
          <p className="text-sm font-medium">This page is in another workspace</p>
          <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <WorkspaceIcon workspace={target.workspace} size="sm" />
            <span className="truncate">{target.workspace.name}</span>
          </p>
          <Button size="sm" variant="outline" onClick={open} disabled={opening}>
            {opening ? <Spinner /> : <ArrowUpRight aria-hidden="true" />}
            Open in {target.workspace.name}
          </Button>
        </div>
      );
    case 'failed':
      return (
        <div className="space-y-1" role="status">
          <p className="text-sm font-medium">Could not find this page</p>
          <p className="text-xs text-muted-foreground">The server could not be reached. Check your connection.</p>
        </div>
      );
    case 'unavailable':
      return (
        <div className="space-y-1" role="status">
          <p className="text-sm font-medium">{PAGE_UNAVAILABLE.title}</p>
          <p className="text-xs text-muted-foreground">{PAGE_UNAVAILABLE.description}</p>
        </div>
      );
  }
}
