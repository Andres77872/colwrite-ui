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
import { useView } from './components/layout/viewContextState'
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
    return <LandingPage />
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
 * The signed-in surface: the editor workspace, or the account dashboard.
 *
 * The profile view drops the sidebar, tools rail, and tools panel — they all
 * act on the open document, and none of them has anything to say about an
 * account page. The topbar stays, because it is the way back.
 */
function Surface() {
  const { view } = useView();

  if (view === 'profile') {
    return (
      <AppShell
        header={<Topbar />}
        main={<ErrorBoundary label="your profile"><ProfileView /></ErrorBoundary>}
      />
    )
  }

  return (
    <AppShell
      header={<Topbar />}
      left={<Sidebar />}
      main={<ErrorBoundary label="the editor">
        <Canvas />
        <ChatAssistant />
        <DocumentFooter />
        <FloatingToolbar />
        <SlashMenu />
      </ErrorBoundary>}
      right={<ToolsRail />}
      aside={<ErrorBoundary label="this panel"><ToolsAside /></ErrorBoundary>}
    />
  )
}

export default App
