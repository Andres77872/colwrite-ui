import { EditorProvider } from './editor'
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
import { useAuth } from './components/auth/AuthContext'
import { LandingPage } from './components/auth/LandingPage'

function App() {
  const { user } = useAuth();
  
  if (!user) {
    return <LandingPage />
  }
  
  return (
    <EditorProvider>
      <ChatSessionsProvider>
        <PanelsProvider>
          <AppShell
            header={<Topbar />}
            left={<Sidebar />}
            main={<>
              <Canvas />
              <ChatAssistant />
              <DocumentFooter />
              <FloatingToolbar />
              <SlashMenu />
            </>}
            right={<ToolsRail />}
            aside={<ToolsAside />}
          />
        </PanelsProvider>
      </ChatSessionsProvider>
    </EditorProvider>
  )
}

export default App
