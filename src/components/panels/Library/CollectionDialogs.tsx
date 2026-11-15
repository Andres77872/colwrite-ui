import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { errorMessage } from '@/api/errors';
import {
  MAX_COLLECTION_DESCRIPTION,
  MAX_COLLECTION_NAME,
  type CollectionRef,
} from '@/data/resources';
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
  collection?: CollectionRef | null;
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
      setError(errorMessage(caught, `Could not ${mode === 'create' ? 'create' : 'update'} the collection`));
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
            <DialogTitle>{mode === 'create' ? 'New collection' : 'Edit collection'}</DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? parentName
                  ? `Add a collection inside ${parentName}.`
                  : 'Add a top-level collection.'
                : 'Change the collection name or description.'}
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
              {mode === 'create' ? 'Create collection' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
