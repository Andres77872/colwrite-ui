import 'katex/dist/katex.min.css'
import { useEffect, useRef, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createAppQueryClient } from './api/query'
import { flushAssistantSettingsWrites, stopAssistantSettingsWrites } from './data/assistant'
import { registerPendingSave } from './lib/pendingSaves'
import { EditorProvider, useDocumentActions, useDocumentSession, useDocumentStatus } from './editor'
import { ProposalsProvider } from './editor/ProposalsContext'
import { ReferenceHealthProvider } from './components/editor/References/ReferenceHealthProvider'
import { ReviewCommentsProvider } from './components/editor/ReviewComments/ReviewCommentsProvider'
import { AppShell } from './components/layout/AppShell'
import { Canvas } from './components/editor/Canvas'
import { PageTopbar } from './components/editor/DocumentChrome'
import { FloatingToolbar } from './components/editor/FloatingToolbar'
import { SlashMenu } from './components/editor/SlashMenu'
import { FindCitationsHost } from './components/editor/FindCitations'
import { PanelsProvider, PanelsAside } from './components/panels'
import { Sidebar } from './components/layout/Sidebar'
import { DocumentUrlSync, NavigationProvider } from './components/layout/NavigationContext'
import { useDocumentTitle, useStrayFileDropGuard, useUnsavedGuard } from './components/layout/useAppChrome'
import { useView } from './components/layout/viewContextState'
import { ShortcutsDialog, useAppShortcuts } from './components/layout/Shortcuts'
import { CommandPalette } from './components/layout/CommandPalette'
import { ChatSessionsProvider } from './components/chat/ChatSessionsContext'
import { SettingsDialog } from './components/profile'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { AgentEngineProvider, AssistantCatalogProvider } from './components/preferences'
import { DocumentLoadingBoundary } from './components/editor/DocumentLoading'
import { useToast } from './components/ui/toastContext'
import { WorkspaceProvider } from './components/workspace/WorkspaceProvider'
import { WorkspaceScope } from './components/workspace/WorkspaceScope'
import { TrashDialog } from './components/collections/TrashDialog'

export default function SignedInWorkspace() {
  // The account's server data sits at the top, in one query cache per signed-in
  // account, where every workspace's queries name their workspace. Navigation
  // (the URL) sits above the workspace, so Back and Forward survive a switch;
  // the panel layout belongs to this device. Everything
  // inside `WorkspaceScope` belongs to one workspace and remounts when it
  // changes (`docs/workspace_collection/08` §5.1).
  return (
    <AccountQueries>
    <NavigationProvider>
      <WorkspaceProvider>
        {/* The engines a local API offers (Claude Code, Codex) and which one each
            surface uses; a deployed API offers only the gateway. */}
        <AgentEngineProvider>
          <PanelsProvider>
            <WorkspaceScope>
              <AssistantCatalogProvider>
                <EditorProvider>
                  <DocumentUrlSync />
                  {/* Pending agent changes are applied through the editor's own patch
                      path once the author accepts them. These providers reset their
                      tagged page state without remounting the scope. */}
                  <ProposalsProvider>
                    {/* The page's last reference audit, and "Check references". */}
                    <ReferenceHealthProvider>
                      <ChatSessionsProvider>
                        <ReviewCommentsProvider><Surface /></ReviewCommentsProvider>
                      </ChatSessionsProvider>
                    </ReferenceHealthProvider>
                  </ProposalsProvider>
                </EditorProvider>
              </AssistantCatalogProvider>
            </WorkspaceScope>
          </PanelsProvider>
        </AgentEngineProvider>
      </WorkspaceProvider>
    </NavigationProvider>
    </AccountQueries>
  )
}

/**
 * One query cache for the signed-in account. Signing out unmounts it with
 * everything it read, so the next account starts from an empty cache.
 */
function AccountQueries({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createAppQueryClient);
  useEffect(() => registerPendingSave({
    flush: () => flushAssistantSettingsWrites(queryClient),
    end: () => stopAssistantSettingsWrites(queryClient),
  }), [queryClient]);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/**
 * The signed-in surface: the workspace, always, with Settings as a dialog
 * over it when the URL says `?view=settings`.
 *
 * Frame: the sidebar on the left, the page (its topbar, then the canvas) in
 * the middle, and the right sidebar — the assistant and the page tools —
 * docked on the right when it is open.
 */
function Surface() {
  const { view, setView } = useView();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);

  useDocumentTitle(view);
  useUnsavedGuard();
  useStrayFileDropGuard();
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
              onOpenTrash={() => setTrashOpen(true)}
            />
          </ErrorBoundary>
        }
        main={
          <ErrorBoundary label="the editor">
            <DocumentLoadingBoundary regionRef={regionRef}>
              <PageTopbar />
              <Canvas />
              <FloatingToolbar />
              <FindCitationsHost />
              <SlashMenu />
            </DocumentLoadingBoundary>
          </ErrorBoundary>
        }
        aside={
          <ErrorBoundary label="this panel">
            <DocumentToolBoundary>
              <PanelsAside />
            </DocumentToolBoundary>
          </ErrorBoundary>
        }
      />
      <ErrorBoundary label="settings">
        <SettingsDialog
          open={view === 'settings'}
          onOpenChange={(open) => setView(open ? 'settings' : 'editor')}
        />
      </ErrorBoundary>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onOpenTrash={() => setTrashOpen(true)}
      />
      <ErrorBoundary label="the Trash">
        <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} />
      </ErrorBoundary>
    </>
  )
}

function DocumentLoadNotice() {
  const { documentLoadNotice } = useDocumentStatus();
  const { clearDocumentLoadNotice } = useDocumentActions();
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
  const { loadingDocumentId } = useDocumentSession();
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
