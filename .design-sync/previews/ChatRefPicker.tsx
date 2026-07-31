import { useEffect, useRef } from 'react';
import { ChatRefPicker, EditorContext } from 'colwrite-ui';

// ChatRefPicker is the "#" document picker in the chat composer. It is
// imperative by design: the composer owns the text, and tells the picker when
// to open via a ref handle (`openAt(anchorIndex)`), because the trigger is a
// caret position rather than a click.
//
// That handle is also what makes it previewable — a cell calls `openAt` in an
// effect, which is exactly what the composer does. Nothing here fakes the open
// state; the real component is driven through its real entry point.
//
// The list itself comes from `listRemote` on the editor context, so each cell
// resolves that call with a fixed page. Timestamps are fixed ISO strings so the
// render stays deterministic across syncs.

type Ctx = React.ContextType<typeof EditorContext>;

const noop = () => {};

const DOCUMENTS = [
  {
    id: 'doc-1',
    name: 'Attention Is All You Need, Revisited',
    version: 7,
    tags: ['draft'],
    createdAt: '2024-02-02T10:00:00.000Z',
    updatedAt: '2024-03-14T09:26:00.000Z',
  },
  {
    id: 'doc-2',
    name: 'Scaling notes',
    version: 3,
    tags: [],
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

function Picker({ input, documents }: { input: string; documents: typeof DOCUMENTS }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<{ openAt: (index: number, opts?: { editing?: boolean }) => void } | null>(
    null,
  );

  // Open it the way the composer does, once the host is measurable.
  useEffect(() => {
    pickerRef.current?.openAt(input.length);
  }, [input.length]);

  const editor = {
    documentId: 'doc-1',
    listRemote: () => Promise.resolve(page(documents)),
  };

  return (
    <EditorContext.Provider value={editor as unknown as Ctx}>
      {/* The list is `absolute bottom-full`, so it needs a POSITIONED ancestor
          wrapping the composer — without one it resolves against the root and
          lands at a negative top, off the card entirely. The assistant panel
          wraps its composer exactly this way. The top padding is what gives the
          list somewhere to open into. It is a SPACER DIV rather than padding
          because the SAFELIST emits `pt-*` only up to pt-24 while `h-*` goes to
          h-96 — pt-80 is simply absent from the stylesheet and does nothing. */}
      <div className="w-[34rem]">
        <div className="h-80" />
        <div className="relative">
          <div ref={hostRef} className="rounded-lg border border-border bg-card p-2 text-sm">
            {input || <span className="text-muted-foreground">Ask for an edit, or #mention…</span>}
          </div>
          <ChatRefPicker
            ref={pickerRef as never}
            getHost={() => hostRef.current}
            input={input}
            setInput={noop}
            setCaretIndex={noop}
          />
        </div>
      </div>
    </EditorContext.Provider>
  );
}

// One cell, deliberately. The picker opens on a two-option root menu — "this"
// (the current document) and "documents" (everything else) — and the actual
// document list is a SECOND level reached by choosing "documents", which no
// static capture can do. So:
//   • a "no documents" cell is pixel-identical to this one, because the root
//     menu does not depend on how many documents exist;
//   • a "filtering" cell renders nothing, because a query that matches neither
//     root option closes the picker.
// Both existed and were removed rather than shipped as duplicates.
export function Open() {
  return <Picker input="Compare the results in #" documents={DOCUMENTS} />;
}
