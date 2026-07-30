import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { formatBytes } from '@/lib/text';
import { errorMessage } from '@/services/contracts';
import {
  MAX_COLLECTION_DESCRIPTION,
  MAX_COLLECTION_NAME,
  type CollectionDeletePreview,
  type CollectionItem,
} from '@/services/resources';
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
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

function restoreFocus(event: Event, returnFocusRef?: RefObject<HTMLElement | null>) {
  if (!returnFocusRef?.current) return;
  event.preventDefault();
  returnFocusRef.current.focus();
}

function samePreview(
  left: CollectionDeletePreview,
  right: CollectionDeletePreview,
): boolean {
  return (
    left.collection_count === right.collection_count &&
    left.membership_count === right.membership_count &&
    left.resource_count === right.resource_count &&
    left.resource_bytes === right.resource_bytes
  );
}

export function CollectionEditorDialog({
  open,
  mode,
  collection,
  parentName,
  onOpenChange,
  onSave,
  returnFocusRef,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  collection?: CollectionItem | null;
  parentName?: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (values: { name: string; description: string | null }) => Promise<void>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [name, setName] = useState(() =>
    mode === 'edit' ? (collection?.name ?? '') : '',
  );
  const [description, setDescription] = useState(() =>
    mode === 'edit' ? (collection?.description ?? '') : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  /**
   * A counter, but only once it matters.
   *
   * `maxLength` alone means typing simply stops with no explanation, which
   * reads as a broken keyboard. Showing the count from character one would be
   * noise on a field whose usual value is two words.
   */
  const counter = (value: string, max: number) =>
    value.length >= max * 0.8 ? `${value.length} / ${max}` : null;

  const nameCount = counter(name, MAX_COLLECTION_NAME);
  const descriptionCount = counter(description, MAX_COLLECTION_DESCRIPTION);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: trimmed, description: description.trim() || null });
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught, `Could not ${mode === 'create' ? 'create' : 'update'} the folder`));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent
        className="max-w-md"
        showCloseButton={!saving}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => restoreFocus(event, returnFocusRef)}
      >
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'Create folder' : 'Edit folder'}</DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? parentName
                  ? `Add a folder inside ${parentName}.`
                  : 'Add a top-level folder.'
                : 'Change the folder name or description.'}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <label className="block space-y-1 text-sm font-medium">
              <span className="flex items-baseline justify-between gap-2">
                Name
                {nameCount && (
                  <span className="text-2xs font-normal tabular-nums text-muted-foreground">
                    {nameCount}
                  </span>
                )}
              </span>
              <Input
                ref={nameRef}
                value={name}
                maxLength={MAX_COLLECTION_NAME}
                required
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              <span className="flex items-baseline justify-between gap-2">
                Description
                {descriptionCount && (
                  <span className="text-2xs font-normal tabular-nums text-muted-foreground">
                    {descriptionCount}
                  </span>
                )}
              </span>
              <Textarea
                value={description}
                maxLength={MAX_COLLECTION_DESCRIPTION}
                disabled={saving}
                placeholder="Optional"
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            {error && <Alert variant="destructive">{error}</Alert>}
          </div>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Spinner />}
              {mode === 'create' ? 'Create folder' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CollectionDeleteDialog({
  open,
  collection,
  onOpenChange,
  onPreview,
  onDelete,
  returnFocusRef,
}: {
  open: boolean;
  collection: CollectionItem | null;
  onOpenChange: (open: boolean) => void;
  onPreview: (collectionId: number) => Promise<CollectionDeletePreview>;
  onDelete: (
    collectionId: number,
    expected: CollectionDeletePreview,
  ) => Promise<void>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [preview, setPreview] = useState<CollectionDeletePreview | null>(null);
  const [typedName, setTypedName] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !collection) return;
    let current = true;
    void onPreview(collection.id)
      .then((value) => {
        if (current) setPreview(value);
      })
      .catch((caught) => {
        if (current) setError(errorMessage(caught, 'Could not preview this deletion'));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [collection, onPreview, open]);

  if (!collection) return null;
  // Trimmed: a pasted name usually arrives with a trailing space, and matching
  // it strictly left the Delete button disabled with nothing saying why.
  const exactMatch = typedName.trim() === collection.name.trim();
  const mismatch = typedName.trim().length > 0 && !exactMatch;

  const remove = async () => {
    if (!exactMatch || !preview || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(collection.id, preview);
      onOpenChange(false);
    } catch (caught) {
      try {
        const refreshed = await onPreview(collection.id);
        if (!samePreview(preview, refreshed)) {
          setPreview(refreshed);
          setTypedName('');
          setError(
            'The folder contents changed after this preview. Review the updated counts and type the folder name again.',
          );
        } else {
          setError(errorMessage(caught, 'Could not delete this folder'));
        }
      } catch {
        setError(errorMessage(caught, 'Could not delete this folder'));
      }
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent
        className="max-w-md"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => restoreFocus(event, returnFocusRef)}
      >
        <DialogHeader>
          {/* Folder names run to 191 characters; without wrapping, a long one
              pushed the dialog apart. */}
          <DialogTitle className="break-words">
            Delete {collection.name} permanently?
          </DialogTitle>
          <DialogDescription>
            This deletes the folder and everything filed anywhere inside it.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner /> Loading exact deletion counts…
            </p>
          )}
          {preview && (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <dt>Folders</dt>
              <dd className="font-semibold tabular-nums">{preview.collection_count.toLocaleString()}</dd>
              <dt>PDFs</dt>
              <dd className="font-semibold tabular-nums">{preview.resource_count.toLocaleString()}</dd>
              <dt>Document memberships</dt>
              <dd className="font-semibold tabular-nums">{preview.membership_count.toLocaleString()}</dd>
              <dt>Stored size</dt>
              {/* The human size only. Printing both that and the raw byte count
                  made the reader pick which number to believe. */}
              <dd className="font-semibold tabular-nums">
                {formatBytes(preview.resource_bytes)}
              </dd>
            </dl>
          )}
          <Alert variant="destructive">
            The PDFs and their extracted text are permanently deleted. This cannot be undone.
          </Alert>
          <label className="block space-y-1 text-sm font-medium">
            <span>
              Type <strong>{collection.name}</strong> to confirm
            </span>
            <Input
              value={typedName}
              autoComplete="off"
              disabled={deleting || !preview}
              onChange={(event) => setTypedName(event.target.value)}
              aria-label={`Type ${collection.name} to confirm deletion`}
              aria-invalid={mismatch || undefined}
              aria-describedby={mismatch ? 'delete-name-mismatch' : undefined}
            />
            {mismatch && (
              <span
                id="delete-name-mismatch"
                className="block text-2xs font-normal text-muted-foreground"
              >
                That does not match the folder name yet.
              </span>
            )}
          </label>
          {error && <Alert variant="destructive">{error}</Alert>}
        </div>

        <DialogFooter className="mt-5">
          <Button ref={cancelRef} variant="outline" disabled={deleting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!preview || !exactMatch || deleting} onClick={() => void remove()}>
            {deleting && <Spinner />}
            Delete folder and contents
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
