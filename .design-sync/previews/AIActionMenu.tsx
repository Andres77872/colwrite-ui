import { AgentToolsContext, AIActionMenu, agentToolsAllEnabled } from 'colwrite-ui';

// AIActionMenu is the AI half of the selection toolbar: the actions that can be
// run against the current text selection, grouped edit / reference / transform,
// with Translate opening a submenu of languages.
//
// Items fire through Radix's `onSelect`, so they work from the keyboard as well
// as the mouse — which is safe only because the toolbar keeps the selection
// range in a ref: opening the menu moves DOM focus off the text.
//
// CAPTURE NOTE: the underlying DropdownMenu is uncontrolled here — the
// component takes `disabled` and `onAction` and forwards no `open` — so these
// cards show the trigger at rest. The menu's own vocabulary (groups, items,
// submenu) is visible in the DropdownMenu* component cards.
//
// It calls useAgentTools() to filter its `agent_tool` actions and throws
// without that context, so every cell supplies the literal all-enabled value.

const noop = () => {};

function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <AgentToolsContext.Provider value={agentToolsAllEnabled}>
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-md">
        {children}
      </div>
    </AgentToolsContext.Provider>
  );
}

// Both cells host the trigger in the toolbar it lives in. Rendered bare it is a
// ~20px icon button on an empty card, and enabled-vs-disabled is then a subtle
// opacity change on a speck — indistinguishable at card size. In the toolbar the
// difference reads.

export function InTheSelectionToolbar() {
  return (
    <Toolbar>
      <span className="px-2 text-sm font-semibold">B</span>
      <span className="px-2 text-sm italic">I</span>
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
      <AIActionMenu onAction={noop} />
    </Toolbar>
  );
}

export function DisabledWithNoSelection() {
  return (
    <Toolbar>
      <span className="px-2 text-sm font-semibold opacity-50">B</span>
      <span className="px-2 text-sm italic opacity-50">I</span>
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
      <AIActionMenu disabled onAction={noop} />
    </Toolbar>
  );
}
