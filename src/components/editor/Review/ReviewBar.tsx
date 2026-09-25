import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirmContext';
import { useEditor } from '@/editor';
import { useProposals } from '@/editor/proposalsContextState';
import { AlertCircle, FileText, X } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';

/**
 * Notices from the assistant that are not suggestions: a document it created
 * ("Open it" / "Stay here") and a review action that failed.
 *
 * The pending-suggestion count, stepper and Accept all / Reject all used to
 * float here too, pinned over the first lines of the page. They now live in
 * the topbar's "N suggestions" pill (`ReviewPill`), so the page carries one
 * review indicator and nothing covers the text while it is being read.
 */
export function ReviewBar() {
  const { loadingDocumentId, switchTo } = useEditor();
  const { pendingCount, invites, dismissInvite, error, clearError } = useProposals();
  const confirm = useConfirm();

  if (invites.length === 0 && !error) return null;

  const plural = `${pendingCount} change${pendingCount === 1 ? '' : 's'}`;

  /**
   * Open the document the assistant just created.
   *
   * Review state belongs to the document that is open, so leaving this one
   * discards every suggestion still on it. That used to happen on one click
   * with nothing said — the author came back to a document that had quietly
   * dropped the batch they were halfway through.
   */
  const openInvited = async (targetDocumentId: string, inviteId: string) => {
    if (pendingCount > 0) {
      const ok = await confirm({
        title: `Leave ${plural} unreviewed?`,
        description:
          'Opening the new document discards the suggestions waiting on this one. This cannot be undone.',
        confirmLabel: 'Open it anyway',
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      const committed = await switchTo(targetDocumentId);
      if (committed) dismissInvite(inviteId);
    } catch {
      // Reported by the editor's own document-load notice.
    }
  };

  return (
    // Stickiness belongs to the wrapper in Canvas. The strip itself is
    // transparent and lets clicks through: only the pills take space on
    // screen, so the page reads on under them instead of under a band.
    <div className="pointer-events-none flex flex-col items-center gap-1.5 px-4 py-2">
      {error && (
        <div
          role="alert"
          className="pointer-events-auto flex max-w-full items-start gap-2 rounded-lg bg-popover py-1.5 pl-3 pr-1.5 text-sm text-destructive shadow-md"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <Button size="icon-xs" variant="icon" onClick={clearError} aria-label="Dismiss">
            <X />
          </Button>
        </div>
      )}

      {invites.map((invite) => {
        const opening = loadingDocumentId === invite.documentId;
        return (
          <div
            key={invite.id}
            className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-popover py-1 pl-3 pr-1 text-sm shadow-md"
          >
            <FileText aria-hidden="true" className="mr-1 h-4 w-4 shrink-0 text-ai" />
            <span className="min-w-0 flex-1 pr-1">The assistant created a new document.</span>
            <Button
              size="xs"
              className="h-7 px-2 text-sm"
              onClick={() => {
                if (opening) return;
                void openInvited(invite.documentId, invite.id);
              }}
            >
              {opening && <Spinner />}
              {opening ? 'Opening…' : 'Open it'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="font-normal text-muted-foreground"
              onClick={() => dismissInvite(invite.id)}
              disabled={opening}
            >
              Stay here
            </Button>
          </div>
        );
      })}

    </div>
  );
}
