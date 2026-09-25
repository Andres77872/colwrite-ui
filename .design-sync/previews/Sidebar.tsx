import {
  AuthContext,
  ConfirmProvider,
  EditorContext,
  LiteralEditor,
  PanelsProvider,
  Sidebar,
  ToastProvider,
  TooltipProvider,
  ViewContext,
} from 'colwrite-ui';

// Sidebar is the workspace column: the account menu (which replaced the old
// Topbar), Search / Ask AI / New page, the document list (DocumentsMenu), and
// the Library and Settings links. It reads four contexts and throws without
// any of them:
//
//   - `useView` (Settings) and `useAuth` (the account menu). Both are literal
//     values. The real ViewProvider rewrites the address bar on mount and needs
//     a real editor; the real AuthProvider only sets a user after confirming a
//     cached identity against the server, which a static capture cannot reach.
//   - the editor, for the document list and "New page". A literal, as in every
//     editor preview (see .design-sync/NOTES.md): `listRemote` resolves a fixed
//     page, so the list renders documents rather than an offline error.
//   - `usePanels`: the real PanelsProvider, which derives its state from
//     matchMedia and needs nothing else.
//
// DocumentsMenu adds `useToast` and `useConfirm`; the collapse control is a
// Tooltip, which throws outside a TooltipProvider.
//
// There is no collapsed cell. A collapsed sidebar is off-screen now, and
// AppShell slides the same full-width column in as a peek on hover. Sidebar
// itself changes only the hover-revealed chevron's label, so a collapsed cell
// would draw exactly what this one does.

type Ctx = React.ContextType<typeof EditorContext>;
type User = { name: string; email: string; userType?: string | null };

const noop = () => {};
const asyncNoop = () => Promise.resolve();

const DOCUMENTS = [
  {
    id: 'doc-1',
    name: 'Attention Is All You Need, Revisited',
    version: 7,
    tags: ['draft', 'nlp'],
    createdAt: '2024-02-02T10:00:00.000Z',
    updatedAt: '2024-03-14T09:26:00.000Z',
  },
  {
    id: 'doc-2',
    name: 'Scaling notes',
    version: 3,
    tags: ['notes'],
    createdAt: '2024-01-18T14:12:00.000Z',
    updatedAt: '2024-03-11T16:40:00.000Z',
  },
  {
    id: 'doc-3',
    name: 'Related work',
    version: 2,
    tags: [],
    createdAt: '2024-01-09T08:30:00.000Z',
    updatedAt: '2024-02-28T11:05:00.000Z',
  },
];

const EDITOR = {
  documentId: 'doc-1',
  loadingDocumentId: null,
  documentListRevision: 1,
  listRemote: () =>
    Promise.resolve({
      documents: DOCUMENTS,
      count: DOCUMENTS.length,
      page: 1,
      limit: 20,
      totalPages: 1,
      sortBy: 'updated_at',
      sortOrder: 'desc',
      status: 'ok',
      message: '',
    }),
  switchTo: asyncNoop,
  deleteRemote: asyncNoop,
  createAndSwitch: () => Promise.resolve('doc-4'),
};

const auth = {
  status: 'authenticated' as const,
  openAuth: noop,
  closeAuth: noop,
  logout: noop,
  loginWithCredentials: asyncNoop,
};

function Frame({ user }: { user: User }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <LiteralEditor value={EDITOR as unknown as Ctx}>
          <AuthContext.Provider value={{ ...auth, user }}>
            <ViewContext.Provider value={{ view: 'workspace', setView: noop }}>
              <PanelsProvider>
                <TooltipProvider>
                  <div className="h-96 w-60 overflow-hidden rounded-xl border border-border/60 bg-card">
                    <Sidebar onOpenPalette={noop} onShowShortcuts={noop} />
                  </div>
                </TooltipProvider>
              </PanelsProvider>
            </ViewContext.Provider>
          </AuthContext.Provider>
        </LiteralEditor>
      </ConfirmProvider>
    </ToastProvider>
  );
}

export function WithDocuments() {
  return <Frame user={{ name: 'Andrés Lamos', email: 'a.lamos@institute.edu' }} />;
}

// With no display name, the workspace is named from the email's local part,
// and so are the initials ("r.okonkwo" → RO).
export function EmailOnlyAccount() {
  return <Frame user={{ name: '', email: 'r.okonkwo@lab.example' }} />;
}
