import { useCallback, useState } from 'react';
import type { CatalogEffort } from '@/api/schema';
import { conversationScopeKey, type ConversationScope } from './conversationScope';

type Effort = CatalogEffort['id'];
type ProfileEfforts = { efforts: CatalogEffort[]; defaultEffort: Effort } | undefined;
type Choices = { scope: string; next: string | null; effort: Effort | null; web: boolean };

/** The catalog supplies the tiers and default; the choice lives only in this conversation. */
export function useRunChoices(scope: ConversationScope, profile: ProfileEfforts, webAvailable = false, preferredEffort?: Effort) {
  const key = conversationScopeKey(scope);
  const [stored, setStored] = useState<Choices>(() => ({ scope: key, next: null, effort: null, web: false }));
  let state = stored;
  if (stored.next === key) {
    state = { ...stored, scope: key, next: null };
    setStored(state);
  } else if (stored.scope !== key) {
    state = { scope: key, next: null, effort: null, web: false };
    setStored(state);
  }
  if (profile && state.effort && !profile.efforts.some((row) => row.id === state.effort)) {
    state = { ...state, effort: null };
    setStored(state);
  }
  if (!webAvailable && state.web) {
    state = { ...state, web: false };
    setStored(state);
  }
  const requested = state.effort ?? preferredEffort;
  const effort = profile?.efforts.find((row) => row.id === requested)?.id ?? profile?.defaultEffort;
  const setEffort = useCallback((id: Effort) => {
    if (!profile?.efforts.some((row) => row.id === id)) return;
    setStored((current) => current.scope === key ? { ...current, effort: id } : current);
  }, [key, profile]);
  const setWeb = useCallback((web: boolean) => {
    if (web && !webAvailable) return;
    setStored((current) => current.scope === key ? { ...current, web } : current);
  }, [key, webAvailable]);
  const { workspace, page, chat, chatEpoch } = scope;
  const adoptChat = useCallback((chatId: string) => {
    if (chat !== null) return;
    setStored((current) => current.scope === key
      ? { ...current, next: conversationScopeKey({ workspace, page, chatEpoch, chat: chatId }) }
      : current);
  }, [chat, chatEpoch, key, page, workspace]);
  return { effort, efforts: profile?.efforts ?? [], setEffort, web: state.web, setWeb, adoptChat };
}
