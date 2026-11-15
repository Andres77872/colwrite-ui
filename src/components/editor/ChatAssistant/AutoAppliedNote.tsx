import { Zap } from 'lucide-react';
import type { AutoAppliedSet } from '@/editor/proposalsContextState';

function changes(count: number): string {
  return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

const linkButton =
  'rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Under a reply from an Auto turn, one line per change set the editor
 * applied (D18): "Applied 3 changes · Undo · Review". Undo takes the set back
 * as one step, while it is still the newest one; Review shows it in the page.
 * What the set left for the author follows: "2 changes need your review".
 */
export function AutoAppliedNote({
  sets,
  onUndo,
  onReview,
}: {
  sets: readonly AutoAppliedSet[];
  onUndo: (id: string) => void;
  onReview: (id: string) => void;
}) {
  if (sets.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-[13px] text-muted-foreground" aria-label="Changes Auto applied">
      {sets.map((set) => (
        <li key={set.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <Zap aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-warning" />
          {set.undone ? (
            <span>Undid {changes(set.applied)}</span>
          ) : (
            <>
              <span>Applied {changes(set.applied)}</span>
              {set.canUndo && (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    className={linkButton}
                    aria-label={`Undo the ${changes(set.applied)} Auto applied`}
                    onClick={() => onUndo(set.id)}
                  >
                    Undo
                  </button>
                </>
              )}
              <span aria-hidden="true">·</span>
              <button
                type="button"
                className={linkButton}
                aria-label={`Review the ${changes(set.applied)} Auto applied`}
                onClick={() => onReview(set.id)}
              >
                Review
              </button>
            </>
          )}
          {set.heldIds.length > 0 && (
            <span className="basis-full pl-5">
              {changes(set.heldIds.length)} {set.heldIds.length === 1 ? 'needs' : 'need'} your review
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
