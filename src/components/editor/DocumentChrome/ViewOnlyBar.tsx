import { Eye } from 'lucide-react';
import { useDocumentSession, useDocumentStatus } from '@/editor';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkspace } from '@/components/workspace/workspaceContextState';

/**
 * "View only" in the topbar, where the save state sits for someone who can
 * edit (M6.UI-2): a viewer's page is never saved, so there is no save state
 * to show. In words and with an icon, so it is not colour alone.
 */
export function ViewOnlyBadge() {
  const { workspace } = useWorkspace();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-subtle px-1.5 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`View only. You’re a viewer in ${workspace.name}: you can read this page and ask the assistant about it, but not edit it.`}
        >
          <Eye aria-hidden="true" className="size-3.5" />
          <span className="max-sm:sr-only">View only</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        You’re a viewer in {workspace.name}: you can read and ask the assistant, but not edit.
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The page turned read-only while it held edits the server never got (a
 * demotion to viewer, read on the next workspace read or from a refused
 * save): they are kept on this device, and the bar says so. They come back
 * the next time the page opens for someone who can edit.
 */
export function ViewOnlyBar() {
  const { readOnly } = useDocumentSession();
  const { editsKeptReadOnly } = useDocumentStatus();
  if (!readOnly || !editsKeptReadOnly) return null;
  return (
    <div role="status" className="flex shrink-0 items-start gap-2 bg-tint-yellow px-4 py-2 text-sm text-tint-yellow-fg">
      <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        <strong className="font-medium">You can only view this page now.</strong>{' '}
        Your role in this workspace changed, so the edits you hadn’t saved yet were not sent. They are kept on this device and offered back when you can edit here again.
      </p>
    </div>
  );
}
