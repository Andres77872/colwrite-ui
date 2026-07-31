import { ConfirmProvider, DocumentHeader, EditorContext, ToastProvider } from 'colwrite-ui';

// DocumentHeader is the document's own chrome above the canvas: the editable
// title, the save state, and the destructive/new-document actions.
//
// It needs three contexts, and all three are here for a reason:
//   • EditorContext — a literal value, never the real EditorProvider, because
//     that provider seeds state with Date.now()/uid() (churns render hashes)
//     and fires a document-list request on mount. See .design-sync/NOTES.md.
//   • ToastProvider / ConfirmProvider — the real ones. `useConfirm` and
//     `useToast` throw outside them, and both are side-effect-free until a
//     handler fires.
//
// `lastSavedAt` renders through toLocaleTimeString, so a FIXED epoch is
// deterministic — a relative "N minutes ago" formatter would not be, and would
// churn this component's render hash on every sync.

type Ctx = React.ContextType<typeof EditorContext>;

// 2024-03-14T09:26:00Z — fixed so the rendered clock time is stable.
const SAVED_AT = 1710408360000;

const noop = () => {};
const asyncNoop = () => Promise.resolve();

const DOC = {
  version: 3,
  name: 'Attention Is All You Need, Revisited',
  blocks: [],
};

const BASE = {
  doc: DOC,
  setDocName: noop,
  saveRemote: asyncNoop,
  deleteRemote: asyncNoop,
  newLocal: noop,
  documentId: 'doc-1',
  lastSavedAt: SAVED_AT,
  isAutoSaving: false,
  lastSaveSource: 'auto' as const,
  saveError: null,
};

function Frame({ value, children }: { value: Record<string, unknown>; children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <EditorContext.Provider value={value as unknown as Ctx}>
          <div className="w-[46rem]">{children}</div>
        </EditorContext.Provider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

export function Saved() {
  return (
    <Frame value={BASE}>
      <DocumentHeader />
    </Frame>
  );
}

export function AutoSaving() {
  return (
    <Frame value={{ ...BASE, isAutoSaving: true }}>
      <DocumentHeader />
    </Frame>
  );
}

export function SavedManually() {
  return (
    <Frame value={{ ...BASE, lastSaveSource: 'manual' }}>
      <DocumentHeader />
    </Frame>
  );
}

export function SaveFailed() {
  return (
    <Frame
      value={{
        ...BASE,
        saveError: 'Could not reach the server — your work is kept locally.',
      }}
    >
      <DocumentHeader />
    </Frame>
  );
}

export function LocalDraft() {
  return (
    <Frame
      value={{
        ...BASE,
        doc: { version: 1, name: 'Untitled', blocks: [] },
        documentId: null,
        lastSavedAt: null,
        lastSaveSource: null,
      }}
    >
      <DocumentHeader />
    </Frame>
  );
}
