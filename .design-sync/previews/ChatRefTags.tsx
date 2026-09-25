import { ChatRefTags, EditorContext, LiteralEditor } from 'colwrite-ui';

// ChatRefTags renders a sent chat message's text with its `#doc/…` and
// `#this/…` references shown as chips rather than raw slugs. It sits in the
// user's muted bubble, so that is the surface these cards use.
//
// It reads the editor to resolve a reference to a document name, so a literal
// context is supplied — never the real provider (Date.now()/uid() seeding and a
// list request on mount; see .design-sync/NOTES.md).

type Ctx = React.ContextType<typeof EditorContext>;

const EDITOR = {
  documentId: 'doc-1',
  doc: { version: 2, name: 'Attention Is All You Need, Revisited', blocks: [] },
  blocks: [],
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <LiteralEditor value={EDITOR as unknown as Ctx}>{children}</LiteralEditor>
  );
}

const ONE_REF =
  'Tighten the abstract of #doc/attention-revisited so it names the matched-budget caveat.';
const TWO_REFS =
  'Compare the results table in #doc/attention-revisited with the one in #doc/scaling-notes and tell me where they disagree.';

export function InAMessage() {
  return (
    <Frame>
      <div className="max-w-[34rem] rounded-xl bg-subtle px-3 py-2 text-sm">
        <ChatRefTags text={ONE_REF} />
      </div>
    </Frame>
  );
}

export function SeveralReferences() {
  return (
    <Frame>
      <div className="max-w-[34rem] rounded-xl bg-subtle px-3 py-2 text-sm">
        <ChatRefTags text={TWO_REFS} />
      </div>
    </Frame>
  );
}

export function WithoutAnyReferences() {
  return (
    <Frame>
      <div className="max-w-[34rem] rounded-xl bg-subtle px-3 py-2 text-sm">
        <ChatRefTags text="Which of these two scaling claims is better supported by the data in section 4?" />
      </div>
    </Frame>
  );
}
