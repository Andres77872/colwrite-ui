import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useEditor } from '@/editor';
import { useToast } from '@/components/ui/toastContext';
import { errorMessage } from '@/services/contracts';
import { ViewContext, type AppView } from './viewContextState';

/**
 * The address bar is the app's only navigation state.
 *
 * Query parameters rather than paths (`?view=profile`, `?doc=<id>`), for two
 * reasons. A static host serves `/` without any rewrite rule, so a pasted or
 * reloaded link cannot 404 the way `/profile` would unless the deployment is
 * configured for SPA fallback — and nothing in this repo configures one. And
 * the signed-out landing page already owns the fragment for its section
 * anchors (`#editor`, `#research`), which hash routing would collide with.
 *
 * Two surfaces did not justify a router: `react-router` would restructure the
 * provider tree, and the constraint that matters here is the opposite of what a
 * router wants — `ViewProvider` stays innermost so switching surfaces never
 * remounts the editor.
 */
const VIEW_PARAM = 'view';
const DOC_PARAM = 'doc';

function readUrl(): { view: AppView; documentId: string | null } {
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get(VIEW_PARAM) === 'profile' ? 'profile' : 'workspace',
    documentId: params.get(DOC_PARAM),
  };
}

function urlFor(view: AppView, documentId: string | null): string {
  const params = new URLSearchParams(window.location.search);
  if (view === 'workspace') params.delete(VIEW_PARAM);
  else params.set(VIEW_PARAM, view);
  if (documentId) params.set(DOC_PARAM, documentId);
  else params.delete(DOC_PARAM);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

export function ViewProvider({ children }: { children: ReactNode }) {
  const { documentId, switchTo } = useEditor();
  const { toast } = useToast();
  const [view, setViewState] = useState<AppView>(() => readUrl().view);

  // The document asked for by the URL on this load, honoured once. Re-running
  // it on every documentId change would fight the user's own navigation.
  const requestedDocRef = useRef<string | null>(readUrl().documentId);
  useEffect(() => {
    const requested = requestedDocRef.current;
    requestedDocRef.current = null;
    if (!requested || requested === documentId) return;
    void switchTo(requested).catch((caught) => {
      // A link to a document that was deleted, or belongs to someone else. Stay
      // where we are and say so, rather than showing an empty editor that looks
      // like data loss.
      toast({
        title: 'Could not open that document',
        description: errorMessage(caught, 'It may have been deleted.'),
        variant: 'error',
      });
    });
  }, [documentId, switchTo, toast]);

  const setView = useCallback((next: AppView) => {
    setViewState(next);
    window.history.pushState(null, '', urlFor(next, readUrl().documentId));
  }, []);

  // A document switch replaces rather than pushes: opening a document from the
  // profile page is one navigation, not two, and Back should return to the
  // profile rather than to the same page with a different query.
  useEffect(() => {
    const current = readUrl();
    if (current.documentId === (documentId ?? null)) return;
    window.history.replaceState(null, '', urlFor(view, documentId ?? null));
  }, [documentId, view]);

  useEffect(() => {
    const onPopState = () => {
      const next = readUrl();
      setViewState(next.view);
      if (next.documentId && next.documentId !== documentId) {
        void switchTo(next.documentId).catch(() => undefined);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [documentId, switchTo]);

  const value = useMemo(() => ({ view, setView }), [setView, view]);

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}
