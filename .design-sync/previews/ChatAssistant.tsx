import {
  ChatAssistant,
  ChatSessionsContext,
  EditorContext,
  PanelsContext,
  PanelsProvider,
  ProposalsContext,
} from 'colwrite-ui';

// ChatAssistant is the whole assistant panel: the message list, the agent
// activity strip, the composer with its reference picker, and the collapsed
// rail state.
//
// Open/closed is SHELL state, not local state — `assistantOpen` comes from
// PanelsContext so the Mod+J shortcut can toggle it from outside. That is what
// makes both states previewable: PanelsProvider supplies real values (it
// derives from matchMedia and needs nothing else) and the cells override
// `assistantOpen` through the context, the same way the AppShell preview forces
// `isOpen`.
//
// The conversation itself is local state seeded empty, so these cards show the
// panel before a turn has been sent. A populated transcript is not reachable
// from props — the messages arrive from a live stream — so the pieces that
// render one are covered by their own cards: ChatMarkdown, AgentActivity,
// ChatRefTags and ChatTaggedInput.

type ECtx = React.ContextType<typeof EditorContext>;
type PCtx = React.ContextType<typeof ProposalsContext>;
type SCtx = React.ContextType<typeof ChatSessionsContext>;

const noop = () => {};

const EDITOR = {
  documentId: 'doc-1',
  doc: { version: 4, name: 'Attention Is All You Need, Revisited', blocks: [] },
  blocks: [],
  applyPatch: () => ({ applied: 0, failed: 0 }),
  markRecentlyChanged: noop,
  createRemote: () => Promise.reject(new Error('not reachable from a preview')),
  listRemote: () => Promise.resolve({ documents: [], count: 0, page: 1, limit: 20, totalPages: 0, sortBy: 'updated_at', sortOrder: 'desc', status: 'ok', message: '' }),
  switchTo: () => Promise.resolve(),
};

const PROPOSALS = {
  sets: [],
  pending: [],
  pendingCount: 0,
  invites: [],
  receive: () => ({ changes: 0, invited: false }),
  accept: noop,
  reject: noop,
  acceptAll: noop,
  rejectAll: noop,
  ready: () => true,
  focusChange: noop,
  focusedChangeId: null,
  dismissInvite: noop,
  error: null,
  clearError: noop,
};

const SESSIONS = {
  selectedChatId: null,
  selectedThreadId: null,
  setSelectedChatId: noop,
  setSelectedThreadId: noop,
};

function Frame({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <PanelsProvider>
      <PanelsContext.Consumer>
        {(panels) =>
          panels ? (
            <PanelsContext.Provider
              value={{ ...panels, isDesktop: true, assistantOpen: open }}
            >
              <EditorContext.Provider value={EDITOR as unknown as ECtx}>
                <ProposalsContext.Provider value={PROPOSALS as unknown as PCtx}>
                  <ChatSessionsContext.Provider value={SESSIONS as unknown as SCtx}>
                    {children}
                  </ChatSessionsContext.Provider>
                </ProposalsContext.Provider>
              </EditorContext.Provider>
            </PanelsContext.Provider>
          ) : null
        }
      </PanelsContext.Consumer>
    </PanelsProvider>
  );
}

export function Open() {
  return (
    <Frame open>
      <div className="h-[36rem] w-[24rem]">
        <ChatAssistant />
      </div>
    </Frame>
  );
}

export function Collapsed() {
  return (
    <Frame open={false}>
      <div className="h-[36rem] w-[24rem]">
        <ChatAssistant />
      </div>
    </Frame>
  );
}
