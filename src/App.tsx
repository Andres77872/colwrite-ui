import { useEffect, useRef, useState } from 'react'
import { EditorProvider, useEditor } from './editor'
import { ProposalsProvider } from './editor/ProposalsContext'
import { AppShell } from './components/layout/AppShell'
import { Canvas } from './components/editor/Canvas'
import { PageTopbar } from './components/editor/DocumentChrome'
import { FloatingToolbar } from './components/editor/FloatingToolbar'
import { SlashMenu } from './components/editor/SlashMenu'
import { PanelsProvider, ToolsAside } from './components/panels'
import { Sidebar } from './components/layout/Sidebar'
import { ViewProvider } from './components/layout/ViewContext'
import { useDocumentTitle, useUnsavedGuard } from './components/layout/useAppChrome'
import { useView } from './components/layout/viewContextState'
import { ShortcutsDialog, useAppShortcuts } from './components/layout/Shortcuts'
import { CommandPalette } from './components/layout/CommandPalette'
import { ChatSessionsProvider } from './components/chat/ChatSessionsContext'
import { useAuth } from './components/auth/authContextState'
import { LandingPage } from './components/landing'
import { SettingsDialog } from './components/profile'
import { Spinner } from './components/ui/spinner'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { AgentEngineProvider, AgentToolsProvider } from './components/preferences'
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
      {/* The engines a local API offers (Claude Code, Codex) and which one each
          surface uses; a deployed API offers only the gateway. */}
      <AgentEngineProvider>
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
      </AgentEngineProvider>
    </AgentToolsProvider>
  )
}

/**
 * The signed-in surface: the workspace, always, with Settings as a dialog
 * over it when the URL says `?view=profile`.
 *
 * Frame: the sidebar on the left, the page (its topbar, then the canvas) in
 * the middle, and the right sidebar — the assistant and the page tools —
 * docked on the right when it is open.
 */
function Surface() {
  const { view, setView } = useView();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);

  useDocumentTitle(view);
  useUnsavedGuard();
  useAppShortcuts({
    onShowHelp: () => setShortcutsOpen(true),
    onOpenPalette: () => setPaletteOpen(true),
  });

  return (
    <>
      <DocumentLoadNotice />
      <AppShell
        left={
          <ErrorBoundary label="the sidebar">
            <Sidebar
              onOpenPalette={() => setPaletteOpen(true)}
              onShowShortcuts={() => setShortcutsOpen(true)}
            />
          </ErrorBoundary>
        }
        main={
          <ErrorBoundary label="the editor">
            <DocumentLoadingBoundary regionRef={regionRef}>
              <PageTopbar />
              <Canvas />
              <FloatingToolbar />
              <SlashMenu />
            </DocumentLoadingBoundary>
          </ErrorBoundary>
        }
        aside={
          <ErrorBoundary label="this panel">
            <DocumentToolBoundary>
              <ToolsAside />
            </DocumentToolBoundary>
          </ErrorBoundary>
        }
      />
      <ErrorBoundary label="settings">
        <SettingsDialog
          open={view === 'profile'}
          onOpenChange={(open) => setView(open ? 'profile' : 'workspace')}
        />
      </ErrorBoundary>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
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
