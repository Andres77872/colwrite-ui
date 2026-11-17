import { createContext, useContext } from 'react';
import type { AppView } from './viewContextState';

/**
 * The address bar is the app's only navigation state: `?ws=` (the
 * workspace), `?doc=` (the open page) and `?view=settings`. An invitation
 * link adds `?invite=<token>`, which is accepted before a workspace is
 * chosen and then removed.
 */
const VIEW_PARAM = 'view';
const WORKSPACE_PARAM = 'ws';
const DOC_PARAM = 'doc';
const INVITE_PARAM = 'invite';

export type UrlState = { view: AppView; workspaceId: string | null; documentId: string | null };

export function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get(VIEW_PARAM) === 'settings' ? 'settings' : 'editor',
    workspaceId: params.get(WORKSPACE_PARAM) || null,
    documentId: params.get(DOC_PARAM) || null,
  };
}

/** The invitation token an invitation link carries, if this address is one. */
export function readInviteToken(): string | null {
  return new URLSearchParams(window.location.search).get(INVITE_PARAM)?.trim() || null;
}

/** The current address with `changes` applied; a `null` removes the parameter. */
export function urlFor(changes: Partial<UrlState> & { invite?: null }): string {
  const params = new URLSearchParams(window.location.search);
  if (changes.invite === null) params.delete(INVITE_PARAM);
  if (changes.view !== undefined) {
    if (changes.view === 'editor') params.delete(VIEW_PARAM);
    else params.set(VIEW_PARAM, changes.view);
  }
  if (changes.workspaceId !== undefined) {
    if (changes.workspaceId) params.set(WORKSPACE_PARAM, changes.workspaceId);
    else params.delete(WORKSPACE_PARAM);
  }
  if (changes.documentId !== undefined) {
    if (changes.documentId) params.set(DOC_PARAM, changes.documentId);
    else params.delete(DOC_PARAM);
  }
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
}

/** The place a Back or Forward asked for; `epoch` counts those navigations. */
export type HistoryTarget = { workspaceId: string | null; documentId: string | null; epoch: number };

export type DocumentUrlValue = { view: AppView; history: HistoryTarget };

export const DocumentUrlContext = createContext<DocumentUrlValue | null>(null);

/** The last Back or Forward, for the workspace switch above the keyed scope. */
export function useHistoryTarget(): HistoryTarget {
  const url = useContext(DocumentUrlContext);
  if (!url) throw new Error('useHistoryTarget must be used within NavigationProvider');
  return url.history;
}
