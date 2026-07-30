import {
  ConfirmProvider,
  EditorProvider,
  PanelsContext,
  PanelsProvider,
  Sidebar,
  ToastProvider,
  TooltipProvider,
} from 'colwrite-ui';

// Sidebar reads usePanels(), and the DocumentsMenu it renders reads useEditor(),
// useToast() and useConfirm() — hence the provider stack. The document list is
// fetched from the API, so in an offline capture the list area shows its own
// load/error state; the sidebar chrome (heading + collapse control) is what this
// card is about.
//
// The collapsed cell drives PanelsContext directly: `leftCollapsed` is persisted
// user state that PanelsProvider has no prop to force.

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-96 overflow-hidden rounded-xl border border-border/60 bg-card">
      {children}
    </div>
  );
}

function Stack({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <EditorProvider>
        <ConfirmProvider>
          {/* The desktop collapse control is wrapped in a Tooltip, which throws
              outside a TooltipProvider. */}
          <TooltipProvider>{children}</TooltipProvider>
        </ConfirmProvider>
      </EditorProvider>
    </ToastProvider>
  );
}

export function Expanded() {
  return (
    <Stack>
      <PanelsProvider>
        <div className="w-72">
          <Panel>
            <Sidebar />
          </Panel>
        </div>
      </PanelsProvider>
    </Stack>
  );
}

export function Collapsed() {
  return (
    <Stack>
      <PanelsProvider>
        <PanelsContext.Consumer>
          {(panels) =>
            panels ? (
              <PanelsContext.Provider value={{ ...panels, isDesktop: true, leftCollapsed: true }}>
                <div className="w-14">
                  <Panel>
                    <Sidebar />
                  </Panel>
                </div>
              </PanelsContext.Provider>
            ) : null
          }
        </PanelsContext.Consumer>
      </PanelsProvider>
    </Stack>
  );
}
