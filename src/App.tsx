import { EditorProvider } from './editor'
import { AppShell } from './components/layout/AppShell'
// Header actions moved into DocumentHeader within Canvas
import { Canvas } from './components/editor/Canvas'
import { FloatingToolbar } from './components/editor/FloatingToolbar/FloatingToolbar'
import { SlashMenu } from './components/editor/SlashMenu'
import { JsonPanel } from './components/panels/JsonPanel'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'

function App() {
  return (
    <EditorProvider>
      <AppShell
        header={<Topbar />}
        left={<Sidebar />}
        main={<>
          <Canvas />
          <FloatingToolbar />
          <SlashMenu />
        </>}
        aside={<JsonPanel />}
      />
    </EditorProvider>
  )
}

export default App
