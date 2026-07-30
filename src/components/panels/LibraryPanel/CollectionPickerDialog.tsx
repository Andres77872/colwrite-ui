import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { FileText, FolderRoot, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/services/contracts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { CollectionTree } from './CollectionTree';
import type { CollectionTreeController } from './useCollectionTree';

export type CollectionPickerTarget =
  | { kind: 'collection'; collectionId: number }
  | { kind: 'unfiled' }
  | { kind: 'document'; documentId: string }
  | { kind: 'root' };

function keyOf(target: CollectionPickerTarget | null): string | null {
  if (!target) return null;
  return target.kind === 'collection' ? `collection:${target.collectionId}` : target.kind;
}

/** One recipe for the destination options; there used to be three copies. */
const optionClass = (selected: boolean) =>
  cn(
    'flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors',
    selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent',
  );

/**
 * The folder being moved, plus every loaded descendant.
 *
 * Moving a folder into itself or into its own subtree is impossible, and the
 * only feedback used to be a server round-trip that failed. Offering it at all
 * was the bug; the dialog copy explaining that the server rejects cycles was
 * the symptom.
 */
function subtreeIds(
  controller: CollectionTreeController,
  rootId: number,
): ReadonlySet<number> {
  const ids = new Set<number>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const child of controller.childrenOf(current)) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

export function CollectionPickerDialog({
  open,
  mode,
  subjectName,
  subjectCollectionId,
  controller,
  documentId,
  initialTarget,
  onOpenChange,
  onMove,
  returnFocusRef,
}: {
  open: boolean;
  mode: 'resource' | 'collection';
  subjectName: string;
  /** The folder being moved, when moving a folder. Excluded from destinations. */
  subjectCollectionId?: number;
  controller: CollectionTreeController;
  documentId?: string | null;
  initialTarget?: CollectionPickerTarget | null;
  onOpenChange: (open: boolean) => void;
  onMove: (target: CollectionPickerTarget) => Promise<void>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [target, setTarget] = useState<CollectionPickerTarget | null>(
    () => initialTarget ?? (mode === 'collection' ? { kind: 'root' } : { kind: 'unfiled' }),
  );
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  const disabledIds = useMemo(
    () =>
      subjectCollectionId === undefined
        ? undefined
        : subtreeIds(controller, subjectCollectionId),
    [controller, subjectCollectionId],
  );

  const choose = (next: CollectionPickerTarget) => {
    setTarget(next);
    setError(null);
  };

  const move = async () => {
    if (!target || moving) return;
    setMoving(true);
    setError(null);
    try {
      await onMove(target);
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught, `Could not move ${subjectName}`));
      setMoving(false);
    }
  };

  const selectedCollection = target?.kind === 'collection' ? target.collectionId : null;
  const selectedKey = keyOf(target);

  const options: Array<{
    key: string;
    label: string;
    icon: typeof Inbox;
    target: CollectionPickerTarget;
  }> =
    mode === 'collection'
      ? [{ key: 'root', label: 'Top-level folders', icon: FolderRoot, target: { kind: 'root' } }]
      : [
          { key: 'unfiled', label: 'Unfiled', icon: Inbox, target: { kind: 'unfiled' } },
          ...(documentId
            ? [
                {
                  key: 'document',
                  label: 'Current document',
                  icon: FileText,
                  target: { kind: 'document' as const, documentId },
                },
              ]
            : []),
        ];

  // A radiogroup is a single tab stop whose members are reached with the arrow
  // keys, and arrowing to a radio selects it. Each of these used to be its own
  // tab stop with arrows doing nothing, which is the pattern a screen reader
  // was being promised and not given.
  const focusOption = (index: number) => {
    const next = options[(index + options.length) % options.length];
    if (!next) return;
    choose(next.target);
    groupRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      .item((index + options.length) % options.length)
      ?.focus();
  };

  const onGroupKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        focusOption(index + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        focusOption(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusOption(0);
        break;
      case 'End':
        event.preventDefault();
        focusOption(options.length - 1);
        break;
    }
  };

  // Which option owns the group's single tab stop: the selected one, or the
  // first when the choice currently lives in the folder tree below.
  const activeOptionIndex = Math.max(
    0,
    options.findIndex((option) => option.key === selectedKey),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !moving && onOpenChange(next)}>
      <DialogContent
        className="max-w-md"
        showCloseButton={!moving}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="break-words">Move {subjectName}</DialogTitle>
          <DialogDescription>
            {mode === 'collection'
              ? 'Choose the folder to move this into. Its own subfolders are not available.'
              : 'Choose a folder, Unfiled, or the current document.'}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-2">
          <div
            ref={groupRef}
            role="radiogroup"
            aria-label="Move destination"
            className="space-y-1"
          >
            {options.map((option, index) => {
              const Icon = option.icon;
              const selected = selectedKey === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={index === activeOptionIndex ? 0 : -1}
                  className={optionClass(selected)}
                  onClick={() => choose(option.target)}
                  onKeyDown={(event) => onGroupKeyDown(event, index)}
                >
                  <Icon aria-hidden="true" className="h-4 w-4" />
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-border p-1.5">
            <p className="px-2 pb-1 pt-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Folders
            </p>
            <CollectionTree
              controller={controller}
              selected={selectedCollection}
              showUnfiled={false}
              draggable={false}
              disabledIds={disabledIds}
              ariaLabel="Choose a destination folder"
              onSelectCollection={(collectionId) => choose({ kind: 'collection', collectionId })}
            />
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
        </div>

        <DialogFooter className="mt-5">
          <Button type="button" variant="outline" disabled={moving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!target || moving} onClick={() => void move()}>
            {moving && <Spinner />}
            Move here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
