import { useCallback, useMemo, useState } from 'react';
import { readJson, seenRunsKey, writeJson } from '@/lib/storageKeys';
import type { AssistantRun } from '@/data/assistantRuns';

function readSeen(workspaceId: string): string[] {
  const stored = readJson(seenRunsKey(workspaceId));
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string').slice(-200) : [];
}

/** Reading a stored reply or watching it finish clears its marker on this device. */
export function useRunInbox(workspaceId: string, runs: readonly AssistantRun[]) {
  const [state, setState] = useState(() => ({ workspaceId, ids: readSeen(workspaceId) }));
  const ids = state.workspaceId === workspaceId ? state.ids : readSeen(workspaceId);
  const seen = useMemo(() => new Set(ids), [ids]);
  const markSeen = useCallback((read: readonly string[]) => {
    if (!read.length) return;
    setState((previous) => {
      const held = previous.workspaceId === workspaceId ? previous.ids : readSeen(workspaceId);
      const next = [...new Set([...held, ...read])].slice(-200);
      if (next.length === held.length && next.every((id, index) => id === held[index])) return previous;
      return { workspaceId, ids: next };
    });
    writeJson(seenRunsKey(workspaceId), [...new Set([...readSeen(workspaceId), ...read])].slice(-200));
  }, [workspaceId]);
  const unreadChats = useMemo(() => new Set(runs
    .filter((run) => run.status === 'completed' && run.chat_id && !seen.has(run.id))
    .map((run) => run.chat_id as string)), [runs, seen]);
  return { unreadChats, markSeen, seen };
}
