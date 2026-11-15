import { useCallback, useMemo, useState } from 'react';
import type { ApplyPolicy, AutoBlockedReason } from '@/editor/types';

/**
 * What Auto is scoped to (D18): the workspace, the open page's session and
 * the chat on screen. A change of any part turns Auto off, and nothing here
 * is ever stored, so a reload starts with it off too.
 */
export type AutoModeScope = {
  /** The workspace being shown. */
  workspace: string;
  /** The open page's session (`documentSessionId`), not its id. */
  page: string;
  /** The chat on screen; `null` for a new one. */
  chat: string | null;
  /**
   * Bumped whenever the author starts or picks a chat, so choosing one always
   * resets Auto, even "New chat" from a new chat.
   */
  chatEpoch: number;
};

export function autoModeScopeKey(scope: AutoModeScope): string {
  return JSON.stringify([scope.workspace, scope.page, scope.chatEpoch, scope.chat]);
}

type AutoState = {
  /** The scope Auto was turned on in. */
  scope: string;
  /**
   * The scope it moves to when the selection catches up: the new chat's id,
   * once the first message has created it (`adoptChat`).
   */
  next: string | null;
  on: boolean;
  /** Why the server gave the latest run `review` although Auto was on. */
  blocked: AutoBlockedReason | null;
};

export type AutoMode = {
  on: boolean;
  blocked: AutoBlockedReason | null;
  /** Only after the author confirmed the warning (`AutoModeDialog`). */
  turnOn: () => void;
  turnOff: () => void;
  /** A new turn starts: the previous run's refusal no longer applies. */
  startTurn: () => void;
  /** The server's effective policy for the run under way (its `status` events). */
  notePolicy: (policy: ApplyPolicy, reason: AutoBlockedReason | null) => void;
  /**
   * The first message of a new chat created it. The author did not change
   * chats, so Auto carries over to the chat's id once the selection moves to
   * it, whichever of the two renders first.
   */
  adoptChat: (chatId: string) => void;
};

const OFF = { next: null, on: false, blocked: null } as const;

/**
 * The composer's Auto switch: off by default, on only for the workspace,
 * page session and chat it was turned on in.
 */
export function useAutoMode(scope: AutoModeScope): AutoMode {
  const key = autoModeScopeKey(scope);
  const [stored, setStored] = useState<AutoState>(() => ({ scope: key, ...OFF }));
  // A new scope turns Auto off before anything renders with it on: the
  // previous page's or chat's Auto never reaches this one. The chat a new
  // chat's first message created is the same chat.
  let state = stored;
  if (stored.next === key) {
    state = { ...stored, scope: key, next: null };
    setStored(state);
  } else if (stored.scope !== key) {
    state = { scope: key, ...OFF };
    setStored(state);
  }

  const inScope = useCallback(
    (update: (current: AutoState) => AutoState) => {
      setStored((current) => (current.scope === key ? update(current) : current));
    },
    [key],
  );

  const turnOn = useCallback(() => inScope((current) => ({ ...current, next: null, on: true, blocked: null })), [inScope]);
  const turnOff = useCallback(() => inScope((current) => ({ ...current, ...OFF })), [inScope]);
  const startTurn = useCallback(
    () => inScope((current) => (current.blocked ? { ...current, blocked: null } : current)),
    [inScope],
  );
  const notePolicy = useCallback(
    (policy: ApplyPolicy, reason: AutoBlockedReason | null) => inScope((current) => {
      const blocked = current.on && policy === 'review' ? reason : null;
      return blocked === current.blocked ? current : { ...current, blocked };
    }),
    [inScope],
  );
  const { workspace, page, chatEpoch } = scope;
  const adoptChat = useCallback(
    (chatId: string) => inScope((current) => (
      // Only from a new chat: a chat the author picked is a different chat.
      scope.chat === null
        ? { ...current, next: autoModeScopeKey({ workspace, page, chatEpoch, chat: chatId }) }
        : current
    )),
    [chatEpoch, inScope, page, scope.chat, workspace],
  );

  return useMemo(
    () => ({ on: state.on, blocked: state.blocked, turnOn, turnOff, startTurn, notePolicy, adoptChat }),
    [adoptChat, notePolicy, startTurn, state.blocked, state.on, turnOff, turnOn],
  );
}

/** What the strip above the composer says while Auto is on. */
export function autoStripMessage(blocked: AutoBlockedReason | null): string {
  switch (blocked) {
    case null:
      return 'Auto is on: edits apply without asking';
    case 'web_research':
      return 'Auto is paused: web research is on for this message';
    case 'policy':
      return 'Auto isn\'t available in this workspace';
    case 'role':
      return 'Viewers can\'t use Auto';
    default:
      return 'Auto is paused for this message';
  }
}
