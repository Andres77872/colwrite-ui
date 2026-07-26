import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useEditor } from './editorContextState';
import type { ToolOperation } from './types';
import {
  buildChangeSet,
  isReady,
  pendingChanges,
  type ChangeSet,
  type DocumentInvite,
  type ProposedChange,
} from './proposals';
import { uid } from '../lib/uid';
import { ProposalsContext, type ProposalsContextValue } from './proposalsContextState';
export type { ProposalsContextValue } from './proposalsContextState';

/**
 * Holds the agent's proposed edits until the author decides on them.
 *
 * The assistant does not apply anything. `doc_edit` stages operations
 * server-side and streams them here; the document renders each one in place
 * with accept and reject controls, and only an accept writes to the editor
 * state that autosave persists. That keeps the decision where the author can
 * see its consequences — on the paragraph — instead of behind a summary in a
 * chat bubble.
 */
export function ProposalsProvider({ children }: { children: ReactNode }) {
  const { documentId } = useEditor();
  return (
    <ProposalsState key={documentId ?? 'local'}>
      {children}
    </ProposalsState>
  );
}

function ProposalsState({ children }: { children: ReactNode }) {
  const { applyPatch, adoptServerVersion, markRecentlyChanged } = useEditor();
  const [sets, setSets] = useState<ChangeSet[]>([]);
  const [invites, setInvites] = useState<DocumentInvite[]>([]);
  const [focusedChangeId, setFocusedChangeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const receive = useCallback<ProposalsContextValue['receive']>((action) => {
    const invited = action.actions.some((op) => op.op === 'create_document');
    if (invited) {
      const createOp = action.actions.find(
        (op): op is Extract<ToolOperation, { op: 'create_document' }> =>
          op.op === 'create_document',
      );
      if (createOp) {
        setInvites((prev) =>
          prev.some((i) => i.documentId === createOp.documentId)
            ? prev
            : [...prev, { id: uid(), documentId: createOp.documentId, receivedAt: Date.now() }],
        );
      }
    }

    if (action.status === 'error') {
      setError(action.message || 'The assistant could not prepare that edit.');
    }

    const set = buildChangeSet(action);

    // A server running in `auto` apply mode has already committed; replaying
    // it as a proposal would ask the author to approve something that is
    // already saved, and rejecting it would do nothing.
    if (action.status === 'applied' && set.changes.length > 0) {
      const { desynced, touched } = applyPatch(
        set.changes.map((c) => c.op),
        { persist: false },
      );
      adoptServerVersion(action.version);
      markRecentlyChanged(touched);
      if (desynced.length > 0) {
        setError(
          'Some of the assistant’s changes could not be shown here. Reload the document to see the saved version.',
        );
      }
      return { changes: 0, invited };
    }

    if (set.changes.length === 0) return { changes: 0, invited };

    setSets((prev) => {
      // Some providers number tool calls per request (call_0, call_1…), so the
      // id alone repeats across runs — a second message whose first tool call
      // is also `call_0` would have its changes silently dropped. Only an
      // identical id *and* identical operations is a redelivery.
      const signature = JSON.stringify(set.changes.map((c) => c.op));
      const duplicate = prev.some(
        (existing) =>
          existing.toolCallId === set.toolCallId &&
          JSON.stringify(existing.changes.map((c) => c.op)) === signature,
      );
      return duplicate ? prev : [...prev, set];
    });
    setFocusedChangeId((current) => current ?? set.changes[0].id);

    return { changes: set.changes.length, invited };
  }, [applyPatch, adoptServerVersion, markRecentlyChanged]);

  const settle = useCallback(
    (changeId: string, status: 'accepted' | 'rejected') => {
      const target = pendingChanges(sets).find((c) => c.id === changeId);
      if (!target) return;

      // Rejecting a change discards everything built on top of it in the same
      // batch — those operations reference a block that will now never exist,
      // so offering them would only produce a failed patch.
      const discarded = new Set<string>();
      if (status === 'rejected') {
        const queue = [changeId];
        while (queue.length) {
          const current = queue.pop()!;
          for (const set of sets) {
            for (const c of set.changes) {
              if (c.status === 'pending' && !discarded.has(c.id) && c.dependsOn.includes(current)) {
                discarded.add(c.id);
                queue.push(c.id);
              }
            }
          }
        }
      }

      if (status === 'accepted') {
        const { desynced, touched } = applyPatch([target.op], { persist: true });
        markRecentlyChanged(touched);
        if (desynced.length > 0) {
          setError(
            'That change referred to a part of the document that is no longer there, so it was not applied.',
          );
        }
      }

      setSets((prev) =>
        prev
          .map((set) => ({
            ...set,
            changes: set.changes.map((c) => {
              if (c.id === changeId) return { ...c, status };
              if (discarded.has(c.id)) return { ...c, status: 'rejected' as const };
              return c;
            }),
          }))
          // Drop batches nobody has to look at any more, so the review bar
          // disappears once the last decision is made.
          .filter((set) => set.changes.some((c) => c.status === 'pending')),
      );

      setFocusedChangeId((current) => (current === changeId ? null : current));
    },
    [applyPatch, markRecentlyChanged, sets],
  );

  const accept = useCallback((id: string) => settle(id, 'accepted'), [settle]);
  const reject = useCallback((id: string) => settle(id, 'rejected'), [settle]);

  const acceptAll = useCallback(() => {
    const ops: ToolOperation[] = [];
    // Original authoring order, across batches: a later batch may build on an
    // earlier one, and replaying them out of order puts blocks in the wrong
    // place even though each operation on its own is valid.
    for (const set of sets) {
      for (const change of set.changes) {
        if (change.status === 'pending') ops.push(change.op);
      }
    }
    if (ops.length === 0) return;

    const { desynced, touched } = applyPatch(ops, { persist: true });
    markRecentlyChanged(touched);
    if (desynced.length > 0) {
      setError(
        `${desynced.length} change${desynced.length === 1 ? '' : 's'} could not be applied — the document has moved on since the assistant read it.`,
      );
    }
    setSets([]);
    setFocusedChangeId(null);
  }, [applyPatch, markRecentlyChanged, sets]);

  const rejectAll = useCallback(() => {
    setSets([]);
    setFocusedChangeId(null);
  }, []);

  const focusChange = useCallback((changeId: string) => {
    setFocusedChangeId(changeId);
    // Rendered by the canvas; the frame delay lets a just-mounted card exist.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-change-id="${changeId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  const ready = useCallback((change: ProposedChange) => isReady(change, sets), [sets]);

  const pending = useMemo(() => pendingChanges(sets), [sets]);

  const value = useMemo<ProposalsContextValue>(
    () => ({
      sets,
      pending,
      pendingCount: pending.length,
      invites,
      receive,
      accept,
      reject,
      acceptAll,
      rejectAll,
      ready,
      focusChange,
      focusedChangeId,
      dismissInvite: (inviteId) => setInvites((prev) => prev.filter((i) => i.id !== inviteId)),
      error,
      clearError: () => setError(null),
    }),
    [
      sets,
      pending,
      invites,
      receive,
      accept,
      reject,
      acceptAll,
      rejectAll,
      ready,
      focusChange,
      focusedChangeId,
      error,
    ],
  );

  return <ProposalsContext.Provider value={value}>{children}</ProposalsContext.Provider>;
}
