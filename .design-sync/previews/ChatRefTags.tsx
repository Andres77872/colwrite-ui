import { ChatRefTags, EditorContext } from 'colwrite-ui';

// ChatRefTags renders a chat message's text with its `#doc/…` references shown
// as chips rather than raw slugs. It is what makes a sent message readable
// after the fact, and it is used on two different surfaces:
//
//   • surface="card"   — the default, on the assistant's own card background
//   • surface="onfill" — on a filled user bubble, where the chip has to sit on
//                        a tinted surface instead of the card
//
// `interactive` turns the chips into buttons (onTagClick / onTagRemove); left
// off they are static text, which is what a sent message wants.
//
// It reads the editor to resolve a reference to a document name, so a literal
// context is supplied — never the real provider (Date.now()/uid() seeding and a
// list request on mount; see .design-sync/NOTES.md).

type Ctx = React.ContextType<typeof EditorContext>;

const noop = () => {};

const EDITOR = {
  documentId: 'doc-1',
  doc: { version: 2, name: 'Attention Is All You Need, Revisited', blocks: [] },
  blocks: [],
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <EditorContext.Provider value={EDITOR as unknown as Ctx}>{children}</EditorContext.Provider>
  );
}

const ONE_REF =
  'Tighten the abstract of #doc/attention-revisited so it names the matched-budget caveat.';
const TWO_REFS =
  'Compare the results table in #doc/attention-revisited with the one in #doc/scaling-notes and tell me where they disagree.';

export function OnACard() {
  return (
    <Frame>
      <div className="max-w-[34rem] rounded-lg border border-border bg-card p-3 text-sm">
        <ChatRefTags text={ONE_REF} />
      </div>
    </Frame>
  );
}

export function OnAFilledBubble() {
  return (
    <Frame>
      <div className="max-w-[34rem] rounded-lg bg-primary p-3 text-sm text-primary-foreground">
        <ChatRefTags text={ONE_REF} surface="onfill" />
      </div>
    </Frame>
  );
}

export function SeveralReferences() {
  return (
    <Frame>
      <div className="max-w-[34rem] rounded-lg border border-border bg-card p-3 text-sm">
        <ChatRefTags text={TWO_REFS} />
      </div>
    </Frame>
  );
}

export function Interactive() {
  return (
    <Frame>
      <div className="max-w-[34rem] rounded-lg border border-border bg-card p-3 text-sm">
        <ChatRefTags text={TWO_REFS} interactive onTagClick={noop} onTagRemove={noop} />
      </div>
    </Frame>
  );
}

export function WithoutAnyReferences() {
  return (
    <Frame>
      <div className="max-w-[34rem] rounded-lg border border-border bg-card p-3 text-sm">
        <ChatRefTags text="Which of these two scaling claims is better supported by the data in section 4?" />
      </div>
    </Frame>
  );
}
