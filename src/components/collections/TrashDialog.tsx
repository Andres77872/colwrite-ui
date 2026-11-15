import { useRef, useState, type ElementType } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Folder, Paperclip, RotateCcw, Trash2 } from 'lucide-react';
import { describeApiError, problemCode } from '@/api/errors';
import { formatBytes } from '@/lib/text';
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
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/inline-error';
import { Input } from '@/components/ui/input';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Spinner } from '@/components/ui/spinner';
import { relativeTime } from '@/components/layout/relativeTime';
import { displayTitle } from '@/components/layout/displayTitle';
import { useWorkspace } from '@/components/workspace/workspaceContextState';
import { useWorkspaceAccess } from '@/components/workspace/workspaceAccess';
import { memberName, membersQuery } from '@/data/members';
import { meQuery } from '@/data/userProfile';
import { restoreRefusal, useTrash } from '@/actions/useTrash';
import { followJob } from '@/actions/trashJobs';
import {
  deleteForever,
  emptyTrash,
  invalidateAfterTrash,
  listTrash,
  trashItemsOf,
  trashKeys,
  trashListQuery,
  type TrashItem,
} from '@/data/trash';
import { JobProgress } from './JobProgress';
import { contentsOf, purgeContents, purgeLabel, RETENTION_DAYS } from './trashCopy';

const PAGE_SIZE = 50;

const KIND_ICON: Record<TrashItem['kind'], ElementType> = { collection: Folder, document: FileText, resource: Paperclip };

const keyOf = (item: Pick<TrashItem, 'kind' | 'id'>) => `${item.kind}:${item.id}`;
const nameOf = (item: TrashItem) => (item.kind === 'document' ? displayTitle(item.name) : item.name);

/** Where it was: "in Thesis › Chapter 2", or the top level. */
function placeOf(item: TrashItem): string {
  if (item.original_path.length > 0) return `in ${item.original_path.map((step) => step.name).join(' › ')}`;
  return item.kind === 'resource' ? 'Unfiled or on a page' : 'Top level';
}

/** What deleting it forever removes. */
function removes(item: TrashItem): string {
  if (item.kind === 'collection' && item.counts) {
    const size = item.counts.pdf_bytes > 0 ? ` (${formatBytes(item.counts.pdf_bytes)} of PDFs)` : '';
    return `${purgeContents(nameOf(item), item.counts)}${size}`;
  }
  if (item.kind === 'document') return `${nameOf(item)}, with its history and its chats. Its PDFs move to Unfiled`;
  return `${nameOf(item)} and its text`;
}

type Confirming = { kind: 'item'; item: TrashItem } | { kind: 'empty' };

/**
 * The Trash (08 §6.6): what was moved there, newest first, each with where
 * it was, when it went and when it is deleted for good, and for a collection
 * what it holds. In a shared workspace each item says who moved it there,
 * from the member list. Restore brings an item back: an editor's own, or
 * anyone's for an admin; a viewer restores nothing. An admin can also delete
 * one forever, or empty the Trash, after typing its name. Work the server
 * finishes later shows its progress at the top.
 */
export function TrashDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { workspace } = useWorkspace();
  const workspaceId = workspace.id;
  const { canEdit, isAdmin: admin } = useWorkspaceAccess();
  const shared = workspace.kind === 'shared';
  const me = useQuery({ ...meQuery(), enabled: open && canEdit }).data?.identity.user_id ?? null;
  const members = useQuery({ ...membersQuery(workspaceId), enabled: open && shared }).data;
  /** "by you", "by Marie Curie", or "by a former member" for someone no longer here. */
  const movedBy = (userId: string | null | undefined): string | null => {
    if (!shared || !userId) return null;
    if (userId === me) return 'by you';
    const member = members?.find((row) => row.user_id === userId);
    if (member) return `by ${memberName(member)}`;
    return members ? 'by a former member' : null;
  };
  const mayRestore = (item: TrashItem) => admin || (canEdit && (!shared || item.trashed_by === me));
  const queryClient = useQueryClient();
  const { restore } = useTrash();
  const list = useInfiniteQuery({ ...trashListQuery(workspaceId, PAGE_SIZE), enabled: open });
  const items = trashItemsOf(list.data);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const emptyRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const refresh = () => invalidateAfterTrash(queryClient, workspaceId);

  const onRestore = async (item: TrashItem) => {
    const key = keyOf(item);
    setBusy(key);
    setRowError(null);
    try {
      await restore({ kind: item.kind, id: item.id, name: nameOf(item), originalPath: item.original_path });
    } catch (error) {
      setRowError({ key, message: restoreRefusal(error) });
      if (problemCode(error) === 'not_in_trash') void refresh();
    } finally {
      setBusy(null);
    }
  };

  const focusList = () => listRef.current?.querySelector<HTMLElement>('button')?.focus();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(80vh,640px)] max-w-lg flex-col">
          <DialogHeader>
            <DialogTitle>Trash</DialogTitle>
            <DialogDescription>
              Pages, collections and PDFs stay here for {RETENTION_DAYS} days, then they are deleted for good.
            </DialogDescription>
          </DialogHeader>
          <JobProgress workspaceId={workspaceId} className="mt-2 space-y-1" />
          {!canEdit && (
            <p className="mt-2 text-xs text-muted-foreground">You’re a viewer here, so you can see what is in the Trash but not restore it.</p>
          )}
          <div className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1">
            {list.isPending ? (
              <ListSkeleton />
            ) : list.isError && items.length === 0 ? (
              <InlineError
                title="Could not load the Trash"
                detail={describeApiError(list.error, 'The request failed.')}
                onRetry={() => void list.refetch()}
              />
            ) : items.length === 0 ? (
              <EmptyState icon={Trash2} title="The Trash is empty" description="What you move to Trash waits here, so it can be restored." />
            ) : (
              <ul ref={listRef} aria-label="In the Trash" className="space-y-1">
                {items.map((item) => {
                  const key = keyOf(item);
                  const Icon = KIND_ICON[item.kind];
                  const name = nameOf(item);
                  const contents = item.kind === 'collection' && item.counts ? contentsOf(item.counts) : [];
                  const meta = [
                    placeOf(item),
                    contents.length > 0 ? contents.join(' · ') : null,
                    ['moved', movedBy(item.trashed_by), relativeTime(item.trashed_at)].filter(Boolean).join(' '),
                  ].filter(Boolean).join(' · ');
                  const restorable = mayRestore(item);
                  return (
                    <li key={key} className="rounded-md px-2 py-1.5 hover:bg-hover">
                      <div className="flex items-start gap-2">
                        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" title={name}>{name}</p>
                          <p className="break-words text-xs text-muted-foreground">{meta}</p>
                          <p className="text-xs text-muted-foreground">{purgeLabel(item.purge_after)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy !== null || !restorable}
                              aria-label={`Restore ${name}`}
                              aria-description={restorable ? undefined : 'Only an admin, or the person who moved it here, can restore it.'}
                              title={restorable ? undefined : 'Only an admin, or the person who moved it here, can restore it.'}
                              onClick={() => void onRestore(item)}
                            >
                              {busy === key ? <Spinner /> : <RotateCcw aria-hidden="true" />}
                              Restore
                            </Button>
                          )}
                          {admin && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={busy !== null}
                              aria-label={`Delete ${name} forever`}
                              onClick={() => setConfirming({ kind: 'item', item })}
                            >
                              Delete forever…
                            </Button>
                          )}
                        </div>
                      </div>
                      {rowError?.key === key && (
                        <p role="alert" className="mt-1 pl-6 text-xs text-destructive">{rowError.message}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {list.hasNextPage && (
              <Button variant="ghost" size="sm" className="mt-1 w-full" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage && <Spinner />}
                {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </Button>
            )}
          </div>
          {admin && items.length > 0 && (
            <DialogFooter className="mt-4">
              <Button ref={emptyRef} variant="destructive" onClick={() => setConfirming({ kind: 'empty' })}>
                <Trash2 aria-hidden="true" />
                Empty Trash…
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {confirming && (
        <PermanentDeleteDialog
          confirming={confirming}
          workspaceId={workspaceId}
          workspaceName={workspace.name}
          onClose={() => {
            setConfirming(null);
            requestAnimationFrame(focusList);
          }}
          onAccepted={() => void refresh()}
        />
      )}
    </>
  );
}

/**
 * "Delete forever" and "Empty Trash": the one destructive confirmation in
 * the app. It says what goes, from the server's counts, and asks for the
 * name. A collection sends those counts back; when it holds something else
 * now (`preview_changed`) the new counts are shown, and the name is typed
 * again.
 */
function PermanentDeleteDialog({
  confirming,
  workspaceId,
  workspaceName,
  onClose,
  onAccepted,
}: {
  confirming: Confirming;
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
  onAccepted: () => void;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState(confirming);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const name = target.kind === 'item' ? nameOf(target.item) : workspaceName;
  const matches = typed.trim() === name.trim();
  const title = target.kind === 'item' ? `Permanently delete ${name}?` : 'Empty the Trash?';
  const body = target.kind === 'item'
    ? `This removes ${removes(target.item)}. It can't be undone.`
    : 'This permanently deletes everything in the Trash. It can’t be undone.';

  const submit = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (target.kind === 'item') {
        const job = await deleteForever(workspaceId, target.item);
        followJob(workspaceId, job, { label: `Deleting ${name} forever`, unit: 'items', onSettled: onAccepted });
      } else {
        const job = await emptyTrash(workspaceId);
        followJob(workspaceId, job, { label: 'Emptying the Trash', unit: 'items', onSettled: onAccepted });
      }
      onAccepted();
      onClose();
      return;
    } catch (caught) {
      if (target.kind === 'item' && problemCode(caught) === 'preview_changed') {
        try {
          // The root as the Trash shows it now.
          const fresh = await findRoot(workspaceId, target.item);
          if (fresh) {
            setTarget({ kind: 'item', item: fresh });
            setTyped('');
            setNotice('It holds something else now. Check what goes, then type its name again.');
          } else {
            setError('It is not in the Trash any more.');
          }
          void queryClient.invalidateQueries({ queryKey: trashKeys.all(workspaceId) });
        } catch (again) {
          setError(describeApiError(again, 'Could not read the Trash again.'));
        }
      } else {
        setError(describeApiError(caught, 'Could not delete it.'));
      }
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <DialogContent
        className="max-w-md"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="break-words">{title}</DialogTitle>
          <DialogDescription aria-live="polite">{body}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          {notice && <Alert variant="warning">{notice}</Alert>}
          <label className="block space-y-1 text-sm font-medium">
            <span>
              Type <strong className="break-words">{name}</strong> to confirm
            </span>
            <Input
              value={typed}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
              }}
            />
          </label>
          {error && <Alert variant="destructive">{error}</Alert>}
        </div>
        <DialogFooter className="mt-5">
          <Button ref={cancelRef} variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!matches || busy} onClick={() => void submit()}>
            {busy && <Spinner />}
            {target.kind === 'item' ? 'Delete forever' : 'Empty Trash'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A trash root as the Trash lists it now, reading on until it is found. */
async function findRoot(workspaceId: string, item: Pick<TrashItem, 'kind' | 'id'>): Promise<TrashItem | null> {
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const response = await listTrash(workspaceId, { limit: 100, cursor });
    const found = response.items.find((candidate) => candidate.kind === item.kind && candidate.id === item.id);
    if (found) return found;
    cursor = response.next_cursor;
    if (!cursor) return null;
  }
  return null;
}
