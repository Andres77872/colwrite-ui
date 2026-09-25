import { useEffect, useRef } from 'react';
import { AgentToolsContext, EditorContext, FloatingToolbar, LiteralEditor, agentToolsAllEnabled } from 'colwrite-ui';

// FloatingToolbar is the selection toolbar: Ask AI | Turn into | B I U S code
// link | Cite | ⋯. It appears only while there is a non-collapsed
// selection inside an element carrying the `editable` class — that class is
// how it finds the active field, and until it was added to Editable the
// toolbar could not appear at all.
//
// So the only honest way to preview it is to make a real selection. Each cell
// renders a contenteditable paragraph, registers it in the editor's `refs` map
// the way the canvas does, and then selects a range inside it in an effect.
// The toolbar's own visibility logic runs untouched — nothing here forces
// `visible`, which is internal state with no prop.
//
// The toolbar positions itself from the selection rect, so each cell reserves
// vertical room above the text for it to land in.
//
// Its Cite and Ask AI entries read useAgentTools(), so the literal
// all-enabled value is supplied alongside the editor one.

type Ctx = React.ContextType<typeof EditorContext>;

const noop = () => {};

function Selected({ text, select }: { text: string; select: 'all' | 'phrase' }) {
  const hostRef = useRef<HTMLParagraphElement | null>(null);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const host = hostRef.current;
    const node = host?.firstChild;
    if (!host || !node) return;
    refs.current.p1 = host as unknown as HTMLDivElement;

    const range = document.createRange();
    if (select === 'all') {
      range.selectNodeContents(host);
    } else {
      const offset = text.indexOf('learning-rate schedule');
      range.setStart(node, offset);
      range.setEnd(node, offset + 'learning-rate schedule'.length);
    }
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [text, select]);

  // The selection's block, as the editor holds it: the toolbar looks it up
  // with `getBlock` to label Turn into ("Text") and to decide whether Cite
  // applies (paragraphs only, not locked).
  const block = { id: 'p1', type: 'paragraph' as const, html: text, children: [], columns: 1 };
  const editor = {
    exec: noop,
    // The ref object itself: the effect above fills it after render.
    refs,
    updateHtml: noop,
    addParagraphChild: () => 'new-child',
    getBlock: (id: string) => (id === block.id ? block : undefined),
    setBlockKind: noop,
    documentId: 'doc-1',
    // A document switch in flight hides the toolbar; none is.
    loadingDocumentId: null,
  };

  return (
    <LiteralEditor value={editor as unknown as Ctx}>
      <AgentToolsContext.Provider value={agentToolsAllEnabled}>
        <div className="relative min-h-[13rem] w-[40rem] pt-24">
          <p
            ref={hostRef}
            className="editable text-sm leading-relaxed text-muted-foreground outline-none"
            contentEditable
            suppressContentEditableWarning
          >
            {text}
          </p>
          <FloatingToolbar />
        </div>
      </AgentToolsContext.Provider>
    </LiteralEditor>
  );
}

const SENTENCE =
  'We show that the reported scaling behaviour holds only once the learning-rate schedule is decoupled from the batch size.';

export function OverAPhrase() {
  return <Selected text={SENTENCE} select="phrase" />;
}

export function OverAWholeParagraph() {
  return <Selected text={SENTENCE} select="all" />;
}
