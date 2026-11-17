import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDocumentActions, useDocumentStatus, usePageReadOnly } from '@/editor';
import { History, TriangleAlert } from 'lucide-react';

/** The answers are 44px tall on touch: a wrong tap here opens or overwrites a version. */
const ANSWER = 'pointer-coarse:h-11 pointer-coarse:px-3.5';

/**
 * The two moments when saving needs the author: the server holds a newer
 * version of this document, or edits of it never reached the server.
 *
 * Both used to be dead ends. A refused save said "Reload to get the current
 * version" and then retried the same save for ever; edits that failed to save
 * before a switch were overwritten the next time the document loaded. The bar
 * sits under the top bar, stays until it is answered, and neither of its
 * answers destroys text: the version that loses stays in History or on this
 * device.
 */
export function SaveRecoveryBar() {
  const { saveConflict, unsavedDraftAt, inTrash } = useDocumentStatus();
  const { resolveSaveConflict, restoreKeptDraft, discardKeptDraft } = useDocumentActions();
  const [busy, setBusy] = useState<'mine' | 'theirs' | null>(null);
  const readOnly = usePageReadOnly();

  // A page in the Trash takes no save; its own bar comes first. A read-only
  // page takes none either: kept edits wait on this device for an open that
  // can edit (`ViewOnlyBar` says so).
  if (inTrash || readOnly) return null;

  if (saveConflict) {
    const choose = (keep: 'mine' | 'theirs') => {
      setBusy(keep);
      void resolveSaveConflict(keep).finally(() => setBusy(null));
    };
    return (
      <div
        role="alert"
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-tint-yellow px-4 py-2 text-sm text-tint-yellow-fg"
      >
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 basis-64">
          <strong className="font-medium">This page was changed somewhere else.</strong>{' '}
          Your latest edits are not saved yet. Whichever version you keep, the other is not lost:
          yours stays on this device, theirs stays in History.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" className={ANSWER} disabled={busy !== null} onClick={() => choose('theirs')}>
            {busy === 'theirs' ? 'Opening…' : 'Open the newer version'}
          </Button>
          <Button size="sm" variant="outline" className={ANSWER} disabled={busy !== null} onClick={() => choose('mine')}>
            {busy === 'mine' ? 'Saving…' : 'Keep my version'}
          </Button>
        </div>
      </div>
    );
  }

  if (unsavedDraftAt !== null) {
    return (
      <div
        role="status"
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-tint-blue px-4 py-2 text-sm text-tint-blue-fg"
      >
        <History aria-hidden="true" className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 basis-64">
          <strong className="font-medium">Edits from {keptAt(unsavedDraftAt)} were never saved.</strong>{' '}
          They are kept on this device. Bringing them back replaces the page, and Undo reverses it.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" className={ANSWER} onClick={() => restoreKeptDraft()}>
            Bring them back
          </Button>
          <Button size="sm" variant="ghost" className={ANSWER} onClick={discardKeptDraft}>
            Discard
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

/** "14:32" for today, "3 Nov, 14:32" for another day. */
function keptAt(time: number): string {
  const date = new Date(time);
  const clock = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return clock;
  return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${clock}`;
}
