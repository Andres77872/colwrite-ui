import { ConfirmProvider, DocumentsMenu, EditorContext, ToastProvider } from 'colwrite-ui';

// DocumentsMenu is the document list: search, sort, paging, open, create and
// delete. Everything it shows comes from `listRemote`, which is an editor
// context field — so a preview drives the real component through its real
// contract by resolving that call with a fixed page of documents, rather than
// faking the markup.
//
// Timestamps are fixed ISO strings so the rendered dates are stable; a relative
// formatter would churn this component's render hash on every sync.
//
// ToastProvider / ConfirmProvider are the real ones (useToast and useConfirm
// throw without them). EditorContext is a literal, as everywhere in this
// directory — see .design-sync/NOTES.md.

type Ctx = React.ContextType<typeof EditorContext>;

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
  {
    id: 'doc-4',
    name: 'Reviewer response — NeurIPS',
    version: 12,
    tags: ['review'],
    createdAt: '2023-11-22T09:00:00.000Z',
    updatedAt: '2024-02-14T13:15:00.000Z',
  },
];

const page = (documents: typeof DOCUMENTS) => ({
  documents,
  count: documents.length,
  page: 1,
  limit: 20,
  totalPages: 1,
  sortBy: 'updated_at',
  sortOrder: 'desc',
  status: 'ok',
  message: '',
});

const BASE = {
  switchTo: asyncNoop,
  createAndSwitch: () => Promise.resolve('doc-5'),
  deleteRemote: asyncNoop,
  documentId: 'doc-1',
  documentListRevision: 1,
  listRemote: () => Promise.resolve(page(DOCUMENTS)),
};

function Frame({ value, children }: { value?: Record<string, unknown>; children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <EditorContext.Provider value={{ ...BASE, ...value } as unknown as Ctx}>
          <div className="w-[26rem]">{children}</div>
        </EditorContext.Provider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

export function WithDocuments() {
  return (
    <Frame>
      <DocumentsMenu />
    </Frame>
  );
}

export function NoDocumentsYet() {
  return (
    <Frame value={{ listRemote: () => Promise.resolve(page([])), documentId: null }}>
      <DocumentsMenu />
    </Frame>
  );
}

export function Loading() {
  return (
    <Frame value={{ listRemote: () => new Promise(noop) }}>
      <DocumentsMenu />
    </Frame>
  );
}

export function ListUnavailable() {
  return (
    <Frame value={{ listRemote: () => Promise.reject(new Error('Could not reach the server.')) }}>
      <DocumentsMenu />
    </Frame>
  );
}
