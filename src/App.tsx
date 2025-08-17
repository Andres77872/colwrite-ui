import { useState } from 'react'
import { EditorProvider } from './editor'
import { AppShell } from './components/layout/AppShell'
// Header actions moved into DocumentHeader within Canvas
import { Canvas } from './components/editor/Canvas'
import { ChatAssistant } from './components/editor/ChatAssistant'
import { DocumentFooter } from './components/editor/DocumentChrome'
import { FloatingToolbar } from './components/editor/FloatingToolbar/FloatingToolbar'
import { SlashMenu } from './components/editor/SlashMenu'
import { PanelsProvider, ToolsRail, ToolsAside } from './components/panels'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'

function App() {
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false)
  return (
    <EditorProvider>
      <PanelsProvider>
        <AppShell
          header={<Topbar />}
          left={<Sidebar collapsed={leftCollapsed} onToggle={() => setLeftCollapsed(v => !v)} />}
          main={<>
            <Canvas />
            <ChatAssistant />
            <DocumentFooter />
            <FloatingToolbar />
            <SlashMenu />
          </>}
          right={<ToolsRail />}
          aside={<ToolsAside />}
          leftCollapsed={leftCollapsed}
        />
      </PanelsProvider>
    </EditorProvider>
  )
}

export default App
