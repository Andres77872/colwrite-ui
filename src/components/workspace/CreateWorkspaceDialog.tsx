import { useId, useRef, useState, type FormEvent, type RefObject } from 'react';
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
import { useWorkspaceActions, workspaceProblem } from '@/actions/useWorkspaceActions';
import { WORKSPACE_NAME_MAX } from '@/data/workspaces';
import { uid } from '@/lib/uid';
import { WorkspaceIcon } from './WorkspaceIcon';
import { WorkspaceIconPicker } from './WorkspaceIconPicker';
import { tintToken } from './workspaceIcon';

/**
 * "New workspace…": a name and an icon. It creates the workspace, switches
 * to it, and the empty workspace says how to start. One `Idempotency-Key`
 * per opening, so a retry after a dropped answer makes one workspace. A
 * refusal, such as the 20-workspace limit, is said in the dialog.
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { create } = useWorkspaceActions();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(tintToken('blue'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => uid());
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const iconLabelId = useId();
  const trimmed = name.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await create({ name: trimmed, icon }, key);
      onOpenChange(false);
    } catch (caught) {
      setError(workspaceProblem(caught, 'Could not create the workspace.'));
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
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
      >
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              A workspace keeps its own pages, collections, PDFs and chats. Nothing in it is shared with your other workspaces.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1">
              <label htmlFor={nameId} className="text-sm font-medium">Name</label>
              <div className="flex items-center gap-2">
                <WorkspaceIcon workspace={{ name: trimmed || 'Workspace', icon }} size="lg" />
                <Input
                  id={nameId}
                  ref={nameRef}
                  value={name}
                  maxLength={WORKSPACE_NAME_MAX}
                  required
                  disabled={saving}
                  placeholder="Thesis, Lab notes…"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <p id={iconLabelId} className="text-sm font-medium">Icon</p>
              <WorkspaceIconPicker name={trimmed} value={icon} onChange={setIcon} disabled={saving} labelledBy={iconLabelId} />
            </div>
            {error && <Alert variant="destructive">{error}</Alert>}
          </div>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed || saving}>
              {saving && <Spinner />}
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
