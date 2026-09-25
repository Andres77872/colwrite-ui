import {
  ChatAssistant,
  ChatSessionsContext,
  ConfirmProvider,
  EditorContext,
  LiteralEditor,
  ProposalsContext,
  ToastProvider,
  TooltipProvider,
} from 'colwrite-ui';

// ChatAssistant is the content of the right sidebar's AI tab: the chat
// switcher, the transcript, and the composer with its context chips and
// reference picker. It owns no window — it fills the column it is given, so
// the card gives it a 420px sidebar-sized column.
//
// The conversation itself is local state seeded empty, so this card shows the
// panel's home before a turn has been sent. A populated transcript is not
// reachable from props — the messages arrive from a live stream — so the pieces
// that render one are covered by their own cards: ChatMarkdown, AgentActivity,
// ChatRefTags and ChatTaggedInput.

type ECtx = React.ContextType<typeof EditorContext>;
type PCtx = React.ContextType<typeof ProposalsContext>;
type SCtx = React.ContextType<typeof ChatSessionsContext>;

const noop = () => {};

const EDITOR = {
  documentId: 'doc-1',
  // Which document the workspace is on, as opposed to the id it is stored
  // under. The panel is keyed on it so that saving a draft — which changes
  // `documentId` — does not read as navigating away and discard the
  // conversation that asked for the save.
  documentSessionId: 'session-1',
  doc: { version: 4, name: 'Attention Is All You Need, Revisited', blocks: [] },
  blocks: [],
  applyPatch: () => ({ applied: 0, failed: 0 }),
  markRecentlyChanged: noop,
  hasPendingEdits: () => false,
  saveRemote: () => Promise.resolve(),
  createRemote: () => Promise.reject(new Error('not reachable from a preview')),
  ensureRemoteDocument: () => Promise.reject(new Error('not reachable from a preview')),
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

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <TooltipProvider>
          <LiteralEditor value={EDITOR as unknown as ECtx}>
            <ProposalsContext.Provider value={PROPOSALS as unknown as PCtx}>
              <ChatSessionsContext.Provider value={SESSIONS as unknown as SCtx}>
                {children}
              </ChatSessionsContext.Provider>
            </ProposalsContext.Provider>
          </LiteralEditor>
        </TooltipProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

export function Docked() {
  return (
    <Frame>
      <div className="h-[40rem] w-[26rem] border-l border-border bg-background">
        <ChatAssistant />
      </div>
    </Frame>
  );
}
