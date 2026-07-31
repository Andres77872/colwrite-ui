import { DocumentFooter, EditorContext } from 'colwrite-ui';

// DocumentFooter is the status bar under the canvas: word and character counts
// lead, with the structural totals (blocks, headings, paragraphs) kept as
// secondary detail. It previously led with the structural trivia, which told a
// writer nothing.
//
// It reads `blocks`, `documentId` and `hasAnyRemoteDocs` from the editor and
// returns null when there is no document and none on the server — that empty
// case is a real state, shown in its own cell.
//
// The literal EditorContext value below is deliberate, not a shortcut: mounting
// the real EditorProvider would seed state with Date.now()/uid(), which churns
// design-sync's render hashes, and would fire a document-list request on mount.
// See .design-sync/NOTES.md.

type Ctx = React.ContextType<typeof EditorContext>;

function withEditor(value: Record<string, unknown>, children: React.ReactNode) {
  return <EditorContext.Provider value={value as unknown as Ctx}>{children}</EditorContext.Provider>;
}

const PARAGRAPH = (id: string, html: string) => ({ id, type: 'paragraph' as const, html });
const HEADING = (id: string, level: 1 | 2 | 3, html: string) => ({
  id,
  type: 'heading' as const,
  level,
  html,
});

const DRAFT = [
  HEADING('h1', 1, 'Attention Is All You Need, Revisited'),
  PARAGRAPH(
    'p1',
    'We revisit the original transformer formulation under modern training budgets and show that the reported scaling behaviour holds only once the learning-rate schedule is decoupled from the batch size.',
  ),
  HEADING('h2', 2, '1. Introduction'),
  PARAGRAPH(
    'p2',
    'Self-attention replaced recurrence as the dominant sequence-modelling primitive largely on throughput grounds rather than sample efficiency.',
  ),
  { id: 'd1', type: 'divider' as const },
  PARAGRAPH('p3', 'Reported exponents are given at matched wall-clock, not matched tokens.'),
];

export function WithADocument() {
  return withEditor(
    { blocks: DRAFT, documentId: 'doc-1', hasAnyRemoteDocs: true },
    <div className="w-[42rem]">
      <DocumentFooter />
    </div>,
  );
}

export function ShortDraft() {
  return withEditor(
    {
      blocks: [HEADING('h1', 1, 'Untitled'), PARAGRAPH('p1', 'One line so far.')],
      documentId: 'doc-2',
      hasAnyRemoteDocs: true,
    },
    <div className="w-[42rem]">
      <DocumentFooter />
    </div>,
  );
}

// There is deliberately no "local draft" cell. `documentId` only gates the
// null-return (no document AND none on the server); it changes nothing the
// footer displays, so such a cell renders identically to WithADocument.

export function EmptyDocument() {
  return withEditor(
    { blocks: [], documentId: 'doc-3', hasAnyRemoteDocs: true },
    <div className="w-[42rem]">
      <DocumentFooter />
    </div>,
  );
}
