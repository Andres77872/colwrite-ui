import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FolderRoot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { uid } from '@/lib/uid';
import { flushPendingSaves } from '@/lib/pendingSaves';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { useWorkspace } from '@/components/workspace/workspaceContextState';
import { useWorkspaceTree } from '@/components/layout/Sidebar/PagesTree/useWorkspaceTree';
import { followJob, useWorkspaceJobs } from '@/actions/trashJobs';
import { useTrash } from '@/actions/useTrash';
import { workspaceProblem } from '@/actions/useWorkspaceActions';
import {
  copyPageToWorkspace,
  removeWorkspaceQueries,
  roleAtLeast,
  type CopyPdfs,
} from '@/data/workspaces';
import { DestinationTree } from './MoveToDialog';

/** The PDFs a copy takes along, in the copy deck's words (08 §6.7, D11). */
const PDF_CHOICES: ReadonlyArray<{ value: CopyPdfs; label: string; hint: string }> = [
  { value: 'none', label: 'No PDFs', hint: 'Only the page.' },
  { value: 'located', label: 'PDFs on this page', hint: 'Each becomes a PDF of the other workspace, on the copy.' },
  {
    value: 'located_and_granted',
    label: 'PDFs on this page and from the collections it uses',
    hint: 'The collections themselves stay here; their PDFs go on the copy.',
  },
];

type Phase =
  | { kind: 'choosing' }
  | { kind: 'copying'; targetId: string; jobKey: string }
  | { kind: 'done'; targetId: string; copyId: string | null }
  | { kind: 'failed'; message: string };

/**
 * "Copy to workspace…" (M5.UI-3, D11): the only way a page crosses into
 * another workspace. The author picks the workspace (one they can edit),
 * where the copy goes in it (its top level or a collection, over that
 * workspace's own tree) and which PDFs go along. History, chats and review
 * notes stay behind, which the dialog says. The page is saved first, so the
 * copy has what is on screen.
 *
 * The copy runs as a job in the target workspace; its progress shows here,
 * then "Open copy" switches to it. Closing the dialog leaves the job running,
 * and a toast offers the copy when it is done. Optionally the original moves
 * to the Trash once the copy is made.
 */
export function CopyToWorkspaceDialog({
  page,
  onOpenChange,
  returnFocusRef,
}: {
  page: { id: string; name: string; collectionId: number | null };
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { workspace, workspaces, switchWorkspace } = useWorkspace();
  const { trashPage } = useTrash();
  const targets = workspaces.filter((item) => item.id !== workspace.id && roleAtLeast(item.role, 'editor'));
  const [targetId, setTargetId] = useState<string | null>(targets[0]?.id ?? null);
  const [collection, setCollection] = useState<{ id: number; name: string } | null>(null);
  const [pdfs, setPdfs] = useState<CopyPdfs>('none');
  const [trashOriginal, setTrashOriginal] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'choosing' });
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((item) => item.id === targetId) ?? null;
  const tree = useWorkspaceTree({ pages: false, workspaceId: targetId ?? workspace.id });
  const pdfsName = useId();
  const workspaceFieldId = useId();
  const trashId = useId();
  const progressJobs = useWorkspaceJobs(phase.kind === 'copying' ? phase.targetId : '');
  const running = phase.kind === 'copying' ? progressJobs.find((item) => item.key === phase.jobKey) : undefined;
  const mounted = useRef(true);

  // The target workspaces' reads are not this workspace's: they go when the dialog does.
  const viewed = useRef(new Set<string>());
  useEffect(() => {
    if (targetId) viewed.current.add(targetId);
  }, [targetId]);
  useEffect(() => {
    mounted.current = true;
    const seen = viewed.current;
    return () => {
      mounted.current = false;
      for (const id of seen) if (id !== workspace.id) void removeWorkspaceQueries(queryClient, id);
    };
  }, [queryClient, workspace.id]);

  const openCopy = (inWorkspace: string, copyId: string | null) => {
    onOpenChange(false);
    void switchWorkspace(inWorkspace, { documentId: copyId, reason: 'link' });
  };

  const start = async () => {
    if (!target || phase.kind === 'copying') return;
    setError(null);
    const into = target;
    const name = page.name;
    try {
      await flushPendingSaves();
      const accepted = await copyPageToWorkspace(
        workspace.id,
        page.id,
        { workspaceId: into.id, collectionId: collection?.id ?? null, includePdfs: pdfs },
        uid(),
      );
      const jobKey = `${accepted.target_workspace_id}:${accepted.job.id}`;
      setPhase({ kind: 'copying', targetId: accepted.target_workspace_id, jobKey });
      followJob(accepted.target_workspace_id, accepted.job, {
        label: `Copying ${name} to ${into.name}`,
        unit: 'items',
        onSettled: (final) => {
          if (final.status === 'failed') {
            if (mounted.current) setPhase({ kind: 'failed', message: final.last_error || 'The server could not finish the copy.' });
            else toast({ title: `Could not copy ${name}`, description: final.last_error ?? undefined, variant: 'error' });
            return;
          }
          const copyId = final.progress?.result?.document_id ?? null;
          if (mounted.current) setPhase({ kind: 'done', targetId: into.id, copyId });
          else {
            toast({
              title: `Copied ${name} to ${into.name}`,
              variant: 'success',
              action: { label: 'Open copy', onSelect: () => void switchWorkspace(into.id, { documentId: copyId, reason: 'link' }) },
            });
          }
          if (trashOriginal) void trashPage({ id: page.id, name: page.name, collectionId: page.collectionId });
        },
      });
    } catch (caught) {
      setError(workspaceProblem(caught, 'Could not copy the page.'));
    }
  };

  const busy = phase.kind === 'copying';
  const progress = running?.job.progress;

  return (
    <Dialog open onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="break-words">Copy {page.name} to another workspace</DialogTitle>
          <DialogDescription>History, chats and review notes are not copied.</DialogDescription>
        </DialogHeader>

        {phase.kind === 'done' ? (
          <div role="status" className="mt-4 flex items-start gap-2 text-sm">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <p>
              Copied to {targets.find((item) => item.id === phase.targetId)?.name ?? 'the other workspace'}.
              {trashOriginal && ' The original is in the Trash.'}
            </p>
          </div>
        ) : targets.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            You have no other workspace you can add pages to. Create one from the workspace menu, then copy the page there.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="space-y-1">
              <label htmlFor={workspaceFieldId} className="text-sm font-medium">Workspace</label>
              <NativeSelect
                id={workspaceFieldId}
                className="w-full"
                value={targetId ?? ''}
                disabled={busy}
                onChange={(event) => {
                  setTargetId(event.target.value);
                  setCollection(null);
                }}
              >
                {targets.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Where in {target?.name ?? 'it'}</p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-1.5">
                <button
                  type="button"
                  aria-pressed={collection === null}
                  disabled={busy}
                  onClick={() => setCollection(null)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                    collection === null ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                  )}
                >
                  <FolderRoot aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  Top level
                </button>
                <DestinationTree
                  tree={tree}
                  selected={collection?.id ?? null}
                  disabledIds={new Set()}
                  home={null}
                  ariaLabel={`Collections in ${target?.name ?? 'the workspace'}`}
                  onSelect={(id, name) => !busy && setCollection({ id, name })}
                />
              </div>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">PDFs</legend>
              {PDF_CHOICES.map((choice) => (
                <div key={choice.value} className="flex items-start gap-2 text-sm">
                  <input
                    id={`${pdfsName}-${choice.value}`}
                    type="radio"
                    name={pdfsName}
                    value={choice.value}
                    checked={pdfs === choice.value}
                    disabled={busy}
                    aria-describedby={`${pdfsName}-${choice.value}-hint`}
                    onChange={() => setPdfs(choice.value)}
                    className="mt-1 accent-[var(--color-primary)]"
                  />
                  <span>
                    <label htmlFor={`${pdfsName}-${choice.value}`} className="cursor-pointer">{choice.label}</label>
                    <span id={`${pdfsName}-${choice.value}-hint`} className="block text-xs text-muted-foreground">{choice.hint}</span>
                  </span>
                </div>
              ))}
            </fieldset>

            <label htmlFor={trashId} className="flex items-center gap-2 text-sm">
              <Checkbox id={trashId} checked={trashOriginal} disabled={busy} onCheckedChange={(checked) => setTrashOriginal(checked === true)} />
              Move the original to Trash once it is copied
            </label>

            <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
              {busy && (
                <span className="flex items-center gap-2">
                  <Spinner className="size-3.5" />
                  Copying…
                  {progress && progress.total > 0 && ` ${Math.min(progress.done, progress.total)} of ${progress.total}`}
                </span>
              )}
            </div>
            {phase.kind === 'failed' && <Alert variant="destructive">Could not copy the page. {phase.message}</Alert>}
            {error && <Alert variant="destructive">{error}</Alert>}
          </div>
        )}

        <DialogFooter className="mt-5">
          {phase.kind === 'done' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={() => openCopy(phase.targetId, phase.copyId)}>Open copy</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {busy ? 'Close' : 'Cancel'}
              </Button>
              {targets.length > 0 && (
                <Button onClick={() => void start()} disabled={!target || busy}>
                  {busy && <Spinner />}
                  {phase.kind === 'failed' ? 'Try again' : 'Copy'}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
