import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, problemCode } from '@/api/errors';
import {
  invalidateWorkspaceList,
  isWorkspaceQuery,
  locateDocument,
  removeWorkspaceQueries,
  setLastWorkspace,
  syncListedWorkspace,
  workspaceKeys,
  workspaceListQuery,
  type Workspace,
  type WorkspaceDetail,
  type WorkspaceList,
} from '@/data/workspaces';
import { readInviteToken, readUrlState, urlFor, useHistoryTarget } from '@/components/layout/navigationState';
import { acceptInvitation, type Acceptance } from '@/data/members';
import { AuthContext } from '@/components/auth/authContextState';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { LAST_WORKSPACE_KEY, readItem, sweepWorkspaceStorage, writeItem } from '@/lib/storageKeys';
import { flushPendingSaves } from '@/lib/pendingSaves';
import { resetModuleState } from '@/lib/moduleState';
import { chooseWorkspace, type WorkspaceChoice } from './chooseWorkspace';
import {
  WORKSPACE_UNAVAILABLE,
  WorkspaceContext,
  type SwitchOptions,
  type WorkspaceContextValue,
} from './workspaceContextState';
import { PendingDocumentContext } from './pendingDocument';
import { WorkspaceIcon } from './WorkspaceIcon';
import { roleWithArticle } from './workspaceAccess';

/**
 * An invitation link (`?invite=`) being taken: it is accepted before the
 * workspace list is read, so the list holds the workspace it joined.
 */
type InviteState =
  | { status: 'none' }
  | { status: 'accepting'; token: string }
  | { status: 'failed'; token: string; error: unknown }
  | { status: 'accepted'; acceptance: Acceptance };

/** The workspace the order of 08 §3.2 falls back to: the server's last one, this browser's, the personal one. */
function fallbackOf(list: WorkspaceList, leaving: string | null): string | null {
  const member = (id: string | null | undefined): id is string =>
    Boolean(id) && id !== leaving && list.items.some((item) => item.id === id);
  return [list.last_workspace_id, readItem(LAST_WORKSPACE_KEY)].find(member)
    ?? list.items.find((item) => item.kind === 'personal' && item.id !== leaving)?.id
    ?? list.items.find((item) => item.id !== leaving)?.id
    ?? null;
}

/**
 * The account's workspaces and the one being shown
 * (`docs/workspace_collection/08` §3.2, §5.1, §5.2).
 *
 * It reads `GET /workspaces`, chooses the workspace in the order of
 * `chooseWorkspace` (a `?doc=` link through the locate route), writes it as
 * `?ws=`, and tells the server, which remembers it for the next sign-in. A
 * link into another of the author's workspaces opens there, saying so
 * ("Opened in ‹workspace›"); a link the account cannot open says that
 * instead. Every time the list loads, what this browser kept for workspaces
 * the account no longer has is swept.
 *
 * A switch saves the open page first, drops the old workspace's queries,
 * resets the module state and remounts `WorkspaceScope`; the caller's
 * address is pushed, so Back returns. Back and Forward into another
 * workspace switch the same way. The workspace being shown leaving the list
 * (deleted, or the account removed from it) switches to the next one.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [invite, setInvite] = useState<InviteState>(() => {
    const token = readInviteToken();
    return token ? { status: 'accepting', token } : { status: 'none' };
  });
  const list = useQuery({ ...workspaceListQuery(), enabled: invite.status === 'none' || invite.status === 'accepted' });

  // The invitation is accepted once per token, even when the effect runs
  // twice: a second accept would answer `already_member`.
  const accepting = useRef<{ token: string; request: Promise<Acceptance> } | null>(null);
  useEffect(() => {
    if (invite.status !== 'accepting') return;
    const { token } = invite;
    if (accepting.current?.token !== token) accepting.current = { token, request: acceptInvitation(token) };
    accepting.current.request.then(
      (acceptance) => {
        // The joined workspace opens: `?ws=` names it for the choice below.
        window.history.replaceState(null, '', urlFor({ invite: null, workspaceId: acceptance.workspace_id, documentId: null }));
        setInvite({ status: 'accepted', acceptance });
      },
      (error: unknown) => setInvite({ status: 'failed', token, error }),
    );
  }, [invite]);

  const skipInvitation = useCallback(() => {
    window.history.replaceState(null, '', urlFor({ invite: null }));
    setInvite({ status: 'none' });
  }, []);
  const retryInvitation = useCallback(() => {
    accepting.current = null;
    setInvite((current) => (current.status === 'failed' ? { status: 'accepting', token: current.token } : current));
  }, []);
  const [choice, setChoice] = useState<WorkspaceChoice | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const choiceRef = useRef<WorkspaceChoice | null>(null);
  const started = useRef(false);
  /** The switch under way: the next one waits for it, so two never interleave. */
  const switching = useRef<Promise<void>>(Promise.resolve());
  /** The workspace being left while its switch runs, which the list may no longer hold. */
  const leaving = useRef<string | null>(null);

  /** Remember the workspace on this device and on the server (fire and forget). */
  const remember = useCallback((workspaceId: string, data: WorkspaceList | undefined) => {
    writeItem(LAST_WORKSPACE_KEY, workspaceId);
    if (data?.last_workspace_id === workspaceId) return;
    void setLastWorkspace(workspaceId).then(
      () => queryClient.setQueryData<WorkspaceList>(workspaceKeys.list(), (current) =>
        current ? { ...current, last_workspace_id: workspaceId } : current),
      () => undefined,
    );
  }, [queryClient]);

  const commit = useCallback((next: WorkspaceChoice) => {
    choiceRef.current = next;
    setChoice(next);
  }, []);

  const nameOf = useCallback((workspaceId: string) =>
    queryClient.getQueryData<WorkspaceList>(workspaceKeys.list())?.items.find((item) => item.id === workspaceId)?.name ?? null,
  [queryClient]);

  // What this browser kept for workspaces the account no longer has goes,
  // every time the list loads. The deleted ones still restorable keep theirs.
  const data = list.data;
  useEffect(() => {
    if (!data) return;
    sweepWorkspaceStorage([...data.items.map((item) => item.id), ...data.deleted.map((item) => item.id)]);
  }, [data]);

  // The first choice, once the list is in.
  useEffect(() => {
    if (!data || started.current) return;
    started.current = true;
    const url = readUrlState();
    void chooseWorkspace(data, url, readItem(LAST_WORKSPACE_KEY), (id) => locateDocument(id))
      .then((chosen) => {
        if (url.workspaceId !== chosen.workspaceId || (chosen.link === 'unavailable' && url.documentId)) {
          window.history.replaceState(null, '', urlFor({ workspaceId: chosen.workspaceId, documentId: chosen.documentId }));
        }
        remember(chosen.workspaceId, data);
        commit(chosen);
        const nameOfChosen = data.items.find((item) => item.id === chosen.workspaceId)?.name;
        if (invite.status === 'accepted' && invite.acceptance.workspace_id === chosen.workspaceId && nameOfChosen) {
          const { status, role } = invite.acceptance;
          toast(status === 'joined'
            ? { title: `You joined ${nameOfChosen}`, description: `You’re ${roleWithArticle(role)} here.`, variant: 'success' }
            : { title: `You’re already in ${nameOfChosen}`, description: `You’re ${roleWithArticle(role)} here.` });
        } else if (chosen.link === 'elsewhere' && nameOfChosen) {
          toast({ title: `Opened in ${nameOfChosen}` });
        }
      })
      .catch((error: unknown) => setFailure(errorMessage(error, 'Could not open your workspace.')));
  }, [commit, data, invite, remember, toast]);

  /** Steps 2, 3, 6, 7 and 8 of the switch; the URL is the caller's. */
  const enter = useCallback((next: WorkspaceChoice): Promise<void> => {
    const run = switching.current.then(async () => {
      const previous = choiceRef.current;
      if (!previous || previous.workspaceId === next.workspaceId) return;
      leaving.current = previous.workspaceId;
      try {
        await flushPendingSaves();
        await removeWorkspaceQueries(queryClient, previous.workspaceId);
        resetModuleState();
        commit(next);
        remember(next.workspaceId, queryClient.getQueryData<WorkspaceList>(workspaceKeys.list()));
      } finally {
        leaving.current = null;
      }
    });
    switching.current = run.catch(() => undefined);
    return run;
  }, [commit, queryClient, remember]);

  const switchWorkspace = useCallback(async (workspaceId: string, options: SwitchOptions = {}) => {
    const previous = choiceRef.current;
    if (!previous || previous.workspaceId === workspaceId) return;
    const documentId = options.documentId ?? null;
    // Pushed, so Back returns to the workspace being left.
    window.history.pushState(null, '', urlFor({ workspaceId, documentId }));
    await enter({ workspaceId, documentId, link: null });
    if (options.reason === 'link') {
      const name = nameOf(workspaceId);
      if (name) toast({ title: `Opened in ${name}` });
    }
  }, [enter, nameOf, toast]);

  // Back or Forward to an address in another workspace. One the account is
  // no longer in stays where it is, and says so.
  const history = useHistoryTarget();
  const handledEpoch = useRef(history.epoch);
  useEffect(() => {
    if (history.epoch === handledEpoch.current) return;
    handledEpoch.current = history.epoch;
    const current = choiceRef.current;
    const target = history.workspaceId;
    if (!current || !target || target === current.workspaceId) return;
    if (!data?.items.some((item) => item.id === target)) {
      window.history.replaceState(null, '', urlFor({ workspaceId: current.workspaceId, documentId: null }));
      toast({ title: WORKSPACE_UNAVAILABLE.title, description: WORKSPACE_UNAVAILABLE.description, variant: 'error' });
      return;
    }
    void enter({ workspaceId: target, documentId: history.documentId, link: null });
  }, [data, enter, history, toast]);

  // A read of the workspace shown answered that it is not there any more:
  // the list reads again, and the effect below moves on.
  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'error') return;
    const current = choiceRef.current;
    if (!current || leaving.current === current.workspaceId) return;
    if (problemCode(event.action.error) !== 'workspace_not_found') return;
    if (!isWorkspaceQuery(current.workspaceId)(event.query)) return;
    void invalidateWorkspaceList(queryClient);
  }), [queryClient]);

  // A read of a workspace is the newest word on the account's role there,
  // its name, icon and members: the list follows it, and with it the
  // switcher and every role check (a demotion made elsewhere arrives so).
  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const detail = event.query.state.data as WorkspaceDetail | undefined;
    const key = event.query.queryKey;
    if (!detail || key.length !== 3 || key[0] !== 'ws' || key[2] !== 'workspace') return;
    syncListedWorkspace(queryClient, detail);
  }), [queryClient]);

  // The workspace being shown left the list: it was deleted (here, in
  // another tab, or by its owner) or the account was removed from it.
  useEffect(() => {
    const current = choiceRef.current;
    if (!data || !current || leaving.current === current.workspaceId) return;
    if (data.items.some((item) => item.id === current.workspaceId)) return;
    const next = fallbackOf(data, current.workspaceId);
    if (!next) return;
    window.history.replaceState(null, '', urlFor({ workspaceId: next, documentId: null }));
    toast({ title: WORKSPACE_UNAVAILABLE.title, description: WORKSPACE_UNAVAILABLE.description, variant: 'error' });
    void enter({ workspaceId: next, documentId: null, link: null });
  }, [data, enter, toast]);

  const refetchList = list.refetch;
  const retry = useCallback(() => {
    setFailure(null);
    started.current = false;
    void refetchList();
  }, [refetchList]);

  /** Leave a link that could not be opened for the workspace the order chose. */
  const dismissUnavailable = useCallback(() => {
    const current = choiceRef.current;
    if (!current) return;
    window.history.replaceState(null, '', urlFor({ workspaceId: current.workspaceId, documentId: null }));
    commit({ ...current, link: null });
  }, [commit]);

  // While a switch away from a workspace that left the list runs, the scope
  // keeps the row it had, so it unmounts only when the next one mounts.
  const [lastShown, setLastShown] = useState<Workspace | null>(null);
  const listed = choice ? data?.items.find((item) => item.id === choice.workspaceId) : undefined;
  if (listed && listed !== lastShown) setLastShown(listed);
  const shown = listed ?? (lastShown?.id === choice?.workspaceId ? lastShown : undefined) ?? undefined;

  if (invite.status === 'failed') {
    return <InvitationProblem error={invite.error} onContinue={skipInvitation} onRetry={retryInvitation} />;
  }

  const error = failure ?? (list.isError ? errorMessage(list.error, 'Could not load your workspaces.') : null);
  if (!data || !choice || !shown) {
    if (error) {
      return (
        <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground" aria-busy="true">
        <Spinner />
      </div>
    );
  }

  if (choice.link === 'unavailable') {
    return <PageUnavailable workspace={shown} onBack={dismissUnavailable} />;
  }

  return (
    <ShownWorkspace
      workspaces={data.items}
      deleted={data.deleted}
      workspace={shown}
      multiWorkspace={data.capabilities.multi_workspace}
      switchWorkspace={switchWorkspace}
      pendingDocumentId={choice.documentId}
    >
      {children}
    </ShownWorkspace>
  );
}

/**
 * An invitation link that could not be used: lapsed, sent to an address the
 * account has not verified, revoked or used, or a request that failed. The
 * app goes on to the account's own workspaces from here.
 */
function InvitationProblem({ error, onContinue, onRetry }: { error: unknown; onContinue: () => void; onRetry: () => void }) {
  const user = useContext(AuthContext)?.user ?? null;
  const code = problemCode(error);
  let title: string;
  let body: ReactNode;
  switch (code) {
    case 'invitation_expired':
      title = 'This invitation has expired';
      body = 'Invitation links work for 7 days. Ask the person who invited you for a new one.';
      break;
    case 'invitation_email_mismatch':
      title = 'This invitation is for another email address';
      body = (
        <>
          It was sent to an address that isn&rsquo;t verified on your account
          {user?.email ? <> (you&rsquo;re signed in as <strong className="font-medium text-foreground">{user.email}</strong>)</> : null}.
          Sign in with the invited address, or add and verify it on your account, then open the link again.
        </>
      );
      break;
    case 'invitation_not_found':
      title = 'This invitation can’t be used';
      body = 'It may have been revoked or used already, or its workspace was deleted. Ask the person who invited you for a new link.';
      break;
    default:
      title = 'Could not accept the invitation';
      body = errorMessage(error, 'The request failed.');
  }
  const retryable = !code || !code.startsWith('invitation_');
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div role="alert" className="max-w-md space-y-1.5">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {retryable && (
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
        <Button variant={retryable ? 'ghost' : 'outline'} onClick={onContinue} autoFocus>
          Continue to your workspaces
        </Button>
      </div>
    </main>
  );
}

/**
 * A `?doc=` link the account cannot open: the page is gone, in the Trash,
 * or in a workspace it is not a member of. The three look the same, so a
 * link says nothing about a workspace the account cannot see.
 */
function PageUnavailable({ workspace, onBack }: { workspace: Workspace; onBack: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="max-w-sm space-y-1.5">
        <h1 className="text-lg font-semibold text-foreground">This page isn&rsquo;t available</h1>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, or you may not have access to the workspace it is in.
        </p>
      </div>
      <Button variant="outline" onClick={onBack} autoFocus>
        <WorkspaceIcon workspace={workspace} size="sm" />
        Back to {workspace.name}
      </Button>
    </main>
  );
}

function ShownWorkspace({
  workspaces,
  deleted,
  workspace,
  multiWorkspace,
  switchWorkspace,
  pendingDocumentId,
  children,
}: WorkspaceContextValue & { pendingDocumentId: string | null; children: ReactNode }) {
  const value = useMemo<WorkspaceContextValue>(
    () => ({ workspaces, deleted, workspace, multiWorkspace, switchWorkspace }),
    [deleted, multiWorkspace, switchWorkspace, workspace, workspaces],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      <PendingDocumentContext.Provider value={pendingDocumentId}>{children}</PendingDocumentContext.Provider>
    </WorkspaceContext.Provider>
  );
}
