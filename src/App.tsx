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
import { ChatSessionsProvider } from './components/chat/ChatSessionsContext'
import { useAuth } from './components/auth/authContextState'
import { LandingPage } from './components/landing'
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
          </PanelsProvider>
        </ChatSessionsProvider>
      </ProposalsProvider>
    </EditorProvider>
  )
}

export default App
