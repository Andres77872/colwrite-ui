import { EditorProvider } from './editor'
import { AppShell } from './components/layout/AppShell'
import { Toolbar } from './components/editor/Toolbar'
import { Canvas } from './components/editor/Canvas'
import { FloatingToolbar } from './components/editor/FloatingToolbar/FloatingToolbar'
import { SlashMenu } from './components/editor/SlashMenu'
import { JsonPanel } from './components/panels/JsonPanel'
import { DocumentsMenu } from './components/editor/DocumentsMenu'

function App() {
  return (
    <EditorProvider>
      <AppShell
        header={<Toolbar />}
        left={<DocumentsMenu />}
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
