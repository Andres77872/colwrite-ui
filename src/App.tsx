import { useEffect, useRef, useState } from 'react'
import { EditorProvider } from './editor'
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
    <EditorProvider>
      {/* Inside EditorProvider: pending agent changes are applied through the
          editor's own patch path once the author accepts them. */}
      <ProposalsProvider>
        <ChatSessionsProvider>
          <PanelsProvider>
            {/* Innermost, so switching surfaces never remounts the editor:
                the profile page can open a document and land back on it with
                the workspace exactly as it was left. */}
            <ViewProvider>
              <Surface />
            </ViewProvider>
          </PanelsProvider>
        </ChatSessionsProvider>
      </ProposalsProvider>
    </EditorProvider>
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
    setAnnouncement(view === 'profile' ? 'Profile and usage' : 'Editor');
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

  if (view === 'profile') {
    return (
      <>
        <AppShell
          header={
            <ErrorBoundary label="the toolbar">
              <Topbar />
            </ErrorBoundary>
          }
          main={
            <ErrorBoundary label="your profile">
              {/* tabIndex -1 so focus can be moved here on a surface change
                  without making the container a tab stop. */}
              <div ref={regionRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
                <ProfileView />
              </div>
            </ErrorBoundary>
          }
        />
        {chrome}
      </>
    )
  }

  return (
    <>
      <AppShell
        header={
          <ErrorBoundary label="the toolbar">
            <Topbar />
          </ErrorBoundary>
        }
        left={
          <ErrorBoundary label="the sidebar">
            <Sidebar />
          </ErrorBoundary>
        }
        main={<ErrorBoundary label="the editor">
          <div ref={regionRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
            <Canvas />
          </div>
          <ChatAssistant />
          <DocumentFooter />
          <FloatingToolbar />
          <SlashMenu />
        </ErrorBoundary>}
        right={
          <ErrorBoundary label="the tools rail">
            <ToolsRail />
          </ErrorBoundary>
        }
        aside={<ErrorBoundary label="this panel"><ToolsAside /></ErrorBoundary>}
      />
      {chrome}
    </>
  )
}

export default App
