import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useDocumentActions, useDocumentSession } from '@/editor';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { ViewContext, type AppView } from './viewContextState';
import { DocumentUrlContext, readUrlState, urlFor, type HistoryTarget } from './navigationState';

/**
 * The address bar is the app's only navigation state.
 *
 * Query parameters rather than paths (`?ws=<id>`, `?doc=<id>`,
 * `?view=settings`), for two reasons. A static host serves `/` without any
 * rewrite rule, so a pasted or reloaded link cannot 404 the way `/settings`
 * would unless the deployment is configured for SPA fallback, and nothing in
 * this repo configures one. And the signed-out landing page owns the
 * fragment for its section anchors (`#editor`, `#research`), which hash
 * routing would collide with.
 *
 * `NavigationProvider` sits above every provider that holds workspace or
 * page state, so Back and Forward keep working when that state is remounted.
 * It knows only the URL. `WorkspaceProvider` follows a Back or Forward into
 * another workspace; `DocumentUrlSync`, inside the editor, opens the page the
 * URL asks for within the workspace and writes the open page into the URL.
 */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<AppView>(() => readUrlState().view);
  const [history, setHistory] = useState<HistoryTarget>(() => {
    const { workspaceId, documentId } = readUrlState();
    return { workspaceId, documentId, epoch: 0 };
  });

  const setView = useCallback((next: AppView) => {
    setViewState(next);
    window.history.pushState(null, '', urlFor({ view: next }));
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const next = readUrlState();
      setViewState(next.view);
      setHistory((current) => ({ workspaceId: next.workspaceId, documentId: next.documentId, epoch: current.epoch + 1 }));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const viewValue = useMemo(() => ({ view, setView }), [setView, view]);
  const urlValue = useMemo(() => ({ view, history }), [history, view]);

  return (
    <ViewContext.Provider value={viewValue}>
      <DocumentUrlContext.Provider value={urlValue}>{children}</DocumentUrlContext.Provider>
    </ViewContext.Provider>
  );
}

/**
 * Keeps `?doc=` and the open page in step, from inside the editor. The URL
 * names the workspace this scope shows (`WorkspaceProvider` wrote it).
 *
 * A page switch replaces rather than pushes: opening a page from Settings is
 * one navigation, not two, and Back returns to Settings rather than to the
 * same view with a different query.
 */
export function DocumentUrlSync() {
  const url = useContext(DocumentUrlContext);
  if (!url) throw new Error('DocumentUrlSync must be used within NavigationProvider');
  const workspaceId = useWorkspaceId();
  const { documentId, loadingDocumentId } = useDocumentSession();
  const { switchTo } = useDocumentActions();
  const { history } = url;
  // Set while a Back or Forward is opening its page. The editor's loading
  // state can start and clear within one render, so the URL is checked again
  // once the switch has settled, not only when that state changes.
  const historySwitch = useRef(false);
  const [settled, setSettled] = useState(0);

  useEffect(() => {
    // Keep the requested URL in place until its body commits. On failure the
    // check after the switch settles restores the still-committed id.
    if (loadingDocumentId !== null || historySwitch.current) return;
    const current = readUrlState();
    // The URL already names the next workspace while this scope is leaving.
    if (current.workspaceId !== null && current.workspaceId !== workspaceId) return;
    if (current.workspaceId === workspaceId && current.documentId === (documentId ?? null)) return;
    window.history.replaceState(null, '', urlFor({ workspaceId, documentId: documentId ?? null }));
  }, [documentId, loadingDocumentId, workspaceId, settled]);

  // Only a Back or Forward opens a page from here; the page in the URL at
  // startup is the editor's own first load.
  const handledEpoch = useRef(history.epoch);
  useEffect(() => {
    if (history.epoch === handledEpoch.current) return;
    handledEpoch.current = history.epoch;
    // Another workspace: `WorkspaceProvider` switches, and this scope goes.
    if (history.workspaceId !== null && history.workspaceId !== workspaceId) return;
    if (!history.documentId || history.documentId === documentId) return;
    historySwitch.current = true;
    void switchTo(history.documentId, { source: 'history' })
      .catch(() => undefined)
      .finally(() => {
        historySwitch.current = false;
        setSettled((count) => count + 1);
      });
  }, [documentId, history, switchTo, workspaceId]);

  return null;
}
