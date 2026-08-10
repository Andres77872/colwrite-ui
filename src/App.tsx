import { useEffect, useRef, useState } from 'react'
import { EditorProvider, useEditor } from './editor'
import { ProposalsProvider } from './editor/ProposalsContext'
import { AppShell } from './components/layout/AppShell'
import { Canvas } from './components/editor/Canvas'
import { ChatAssistant } from './components/editor/ChatAssistant'
import { DocumentFooter } from './components/editor/DocumentChrome'
import { FloatingToolbar } from './components/editor/FloatingToolbar'
import { SlashMenu } from './components/editor/SlashMenu'
import { PanelsProvider, ToolsRail, ToolsAside } from './components/panels'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { ViewProvider } from './components/layout/ViewContext'
import { useDocumentTitle, useUnsavedGuard } from './components/layout/useAppChrome'
import { useView, type AppView } from './components/layout/viewContextState'
import { ShortcutsDialog, useAppShortcuts } from './components/layout/Shortcuts'
import { ChatSessionsProvider } from './components/chat/ChatSessionsContext'
import { useAuth } from './components/auth/authContextState'
import { LandingPage } from './components/landing'
import { ProfileView } from './components/profile'
import { Spinner } from './components/ui/spinner'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { AgentToolsProvider } from './components/preferences'
import { DocumentLoadingBoundary } from './components/editor/DocumentLoading'
import { useToast } from './components/ui/toastContext'

function App() {
  const { user, status } = useAuth();

  // Confirming a cached session against the server. Showing the landing page
  // here would flash marketing copy at someone who is already signed in.
  if (status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    )
  }

  if (!user) {
    return (
      <ErrorBoundary label="this page">
        <LandingPage />
      </ErrorBoundary>
    )
  }

  return (
    <AgentToolsProvider key={`${user.email}\u0000${user.name}`}>
      <EditorProvider>
        {/* Navigation must outlive every document-scoped provider. In particular,
            it needs to update ?doc= after a switch without being remounted by
            that same switch and re-reading the previous URL. */}
        <ViewProvider>
          {/* Pending agent changes are applied through the editor's own patch path
              once the author accepts them. These providers reset their tagged
              document state without remounting the workspace. */}
          <ProposalsProvider>
            <ChatSessionsProvider>
              <PanelsProvider>
                <Surface />
              </PanelsProvider>
            </ChatSessionsProvider>
          </ProposalsProvider>
        </ViewProvider>
      </EditorProvider>
    </AgentToolsProvider>
  )
}

/**
 * Move focus to the new surface and say which one it is.
 *
 * Switching between the editor and the account page left focus wherever it
 * happened to be — usually on a menu item that no longer existed — and
 * announced nothing, so a screen reader gave no sign the page had changed. The
 * mobile drawers get this for free from Radix; the desktop surfaces did not.
 */
function useSurfaceChange(view: AppView) {
  const regionRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setAnnouncement(view === 'profile' ? 'Profile and preferences' : 'Editor');
    regionRef.current?.focus();
  }, [view]);

  return { regionRef, announcement };
}

/**
 * The signed-in surface: the editor workspace, or the account dashboard.
 *
 * The profile view drops the sidebar, tools rail, and tools panel — they all
 * act on the open document, and none of them has anything to say about an
 * account page. The topbar stays, because it is the way back.
 */
function Surface() {
  const { view } = useView();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { regionRef, announcement } = useSurfaceChange(view);

  useDocumentTitle(view);
  useUnsavedGuard();
  useAppShortcuts({ onShowHelp: () => setShortcutsOpen(true) });

  const chrome = (
    <>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {/* One region for the whole app. Focus lands on the surface container
          below; this is what says where it landed. */}
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </>
  );

  return (
    <>
      <DocumentLoadNotice />
      {view === 'profile' ? (
        <AppShell
          header={
            <ErrorBoundary label="the toolbar">
              <Topbar onOpenShortcuts={() => setShortcutsOpen(true)} />
            </ErrorBoundary>
          }
          main={
            <ErrorBoundary label="your profile">
              <div ref={regionRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
                <ProfileView />
              </div>
            </ErrorBoundary>
          }
        />
      ) : (
        <AppShell
          header={
            <ErrorBoundary label="the toolbar">
              <Topbar onOpenShortcuts={() => setShortcutsOpen(true)} />
            </ErrorBoundary>
          }
          left={
            <ErrorBoundary label="the sidebar">
              <Sidebar />
            </ErrorBoundary>
          }
          main={
            <ErrorBoundary label="the editor">
              <DocumentLoadingBoundary regionRef={regionRef}>
                <Canvas />
                <ChatAssistant />
                <DocumentFooter />
                <FloatingToolbar />
                <SlashMenu />
              </DocumentLoadingBoundary>
            </ErrorBoundary>
          }
          right={
            <ErrorBoundary label="the tools rail">
              <ToolsRail />
            </ErrorBoundary>
          }
          aside={<ErrorBoundary label="this panel"><DocumentToolBoundary><ToolsAside /></DocumentToolBoundary></ErrorBoundary>}
        />
      )}
      {chrome}
    </>
  )
}

function DocumentLoadNotice() {
  const { documentLoadNotice, clearDocumentLoadNotice } = useEditor();
  const { toast } = useToast();
  const announced = useRef<number | null>(null);

  useEffect(() => {
    if (!documentLoadNotice || announced.current === documentLoadNotice.id) return;
    announced.current = documentLoadNotice.id;
    toast({
      title: documentLoadNotice.title,
      description: documentLoadNotice.description,
      variant: 'error',
    });
    clearDocumentLoadNotice();
  }, [clearDocumentLoadNotice, documentLoadNotice, toast]);

  return null;
}

function DocumentToolBoundary({ children }: { children: React.ReactNode }) {
  const { loadingDocumentId } = useEditor();
  const pending = Boolean(loadingDocumentId);
  return (
    <div
      className="flex h-full flex-col"
      inert={pending}
      aria-disabled={pending || undefined}
      aria-busy={pending}
    >
      {children}
    </div>
  );
}

export default App
