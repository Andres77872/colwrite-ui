import { useCallback, useMemo, useState } from 'react';
import type { ApplyPolicy, AutoBlockedReason } from '@/editor/types';
import { conversationScopeKey, type ConversationScope } from './conversationScope';

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
export function useAutoMode(scope: ConversationScope): AutoMode {
  const key = conversationScopeKey(scope);
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
        ? { ...current, next: conversationScopeKey({ workspace, page, chatEpoch, chat: chatId }) }
        : current
    )),
    [chatEpoch, inScope, page, scope.chat, workspace],
  );

  return useMemo(
    () => ({ on: state.on, blocked: state.blocked, turnOn, turnOff, startTurn, notePolicy, adoptChat }),
    [adoptChat, notePolicy, startTurn, state.blocked, state.on, turnOff, turnOn],
  );
}

/**
 * What the strip above the composer says while Auto is on. The server can
 * pause Auto partway through a reply (`policy`, `untrusted_content`); its
 * next `status` says so, and the strip changes with it.
 */
export function autoStripMessage(blocked: AutoBlockedReason | null): string {
  switch (blocked) {
    case null:
      return 'Auto is on: edits apply without asking';
    case 'policy':
      return 'Auto isn\'t available in this workspace';
    case 'role':
      return 'Viewers can\'t use Auto';
    case 'untrusted_content':
      return 'Auto paused: this reply read outside material, so its changes wait for your review';
  }
}

/**
 * Under a reply whose changes waited although Auto was on: why. Kept with
 * the reply, since the strip speaks only for the message under way.
 */
export function autoPausedNote(reason: AutoBlockedReason): string {
  switch (reason) {
    case 'policy':
      return 'Auto paused: this workspace switched Auto off, so this reply\'s changes wait for your review';
    case 'role':
      return 'Auto paused: your role in this workspace doesn\'t allow it, so this reply\'s changes wait for review';
    case 'untrusted_content':
      return 'Auto paused: this reply read outside material, so its changes wait for your review';
  }
}
