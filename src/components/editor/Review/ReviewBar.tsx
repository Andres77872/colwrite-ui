import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirmContext';
import { useEditor } from '@/editor';
import { useProposals } from '@/editor/proposalsContextState';
import { describeChange } from '@/editor/proposals';
import { AlertCircle, Check, ChevronDown, ChevronUp, FileText, Sparkles, X } from 'lucide-react';
import { useState } from 'react';

/**
 * Sticky summary of everything the assistant is waiting on.
 *
 * Individual changes are reviewed in place, but a batch can span the whole
 * document — without a count and a way to step through them, an author has no
 * idea whether they have seen all of it.
 */
export function ReviewBar() {
  const { blocks, switchTo } = useEditor();
  const {
    pending,
    pendingCount,
    acceptAll,
    rejectAll,
    focusChange,
    focusedChangeId,
    invites,
    dismissInvite,
    error,
    clearError,
  } = useProposals();
  const [listOpen, setListOpen] = useState(false);
  const confirm = useConfirm();

  const hasInvites = invites.length > 0;
  if (pendingCount === 0 && !hasInvites && !error) return null;

  const step = (delta: 1 | -1) => {
    if (pending.length === 0) return;
    const current = pending.findIndex((c) => c.id === focusedChangeId);
    const next = (current + delta + pending.length) % pending.length;
    focusChange(pending[next].id);
  };

  // Both of these act on every pending change at once and there is no undo,
  // while deleting a single document already asks. Rejecting all was the
  // sharpest edge in the app: one click discarded the whole batch silently.
  const plural = `${pendingCount} change${pendingCount === 1 ? '' : 's'}`;

  const onAcceptAll = async () => {
    const ok = await confirm({
      title: `Accept all ${plural}?`,
      description: 'Every pending suggestion will be applied to the document.',
      confirmLabel: 'Accept all',
    });
    if (ok) acceptAll();
  };

  const onRejectAll = async () => {
    const ok = await confirm({
      title: `Reject all ${plural}?`,
      description: 'Every pending suggestion will be discarded. This cannot be undone.',
      confirmLabel: 'Reject all',
      destructive: true,
    });
    if (ok) rejectAll();
  };

  return (
    // Stickiness belongs to the wrapper in Canvas — see the comment there.
    <div className="border-b border-border bg-card/95 backdrop-blur">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <Button
            size="icon-sm"
            variant="ghost"
            className="h-5 w-5 shrink-0 text-destructive"
            onClick={clearError}
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {invites.map((invite) => (
        <div
          key={invite.id}
          className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 text-xs"
        >
          <FileText aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
          <span className="min-w-0 flex-1">The assistant created a new document.</span>
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              dismissInvite(invite.id);
              switchTo(invite.documentId).catch(() => {
                /* surfaced by the editor's own save/load error banner */
              });
            }}
          >
            Open it
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => dismissInvite(invite.id)}
          >
            Stay here
          </Button>
        </div>
      ))}

      {pendingCount > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm font-medium">
              {pendingCount} suggested {pendingCount === 1 ? 'change' : 'changes'}
            </p>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Review each one in the document.
            </p>

            <div className="ml-auto flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => step(-1)}
                aria-label="Previous change"
                title="Previous change"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => step(1)}
                aria-label="Next change"
                title="Next change"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setListOpen((open) => !open)}
                aria-expanded={listOpen}
              >
                {listOpen ? 'Hide list' : 'List'}
              </Button>
              <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void onAcceptAll()}>
                <Check className="h-3.5 w-3.5" />
                Accept all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => void onRejectAll()}
              >
                <X className="h-3.5 w-3.5" />
                Reject all
              </Button>
            </div>
          </div>

          {listOpen && (
            <ul className="max-h-48 overflow-y-auto border-t border-border/60 px-2 py-1">
              {pending.map((change) => (
                <li key={change.id}>
                  <button
                    type="button"
                    onClick={() => focusChange(change.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs transition-colors hover:bg-accent/40',
                      focusedChangeId === change.id && 'bg-accent/40',
                    )}
                  >
                    <span className="text-muted-foreground">{describeChange(change, blocks)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
