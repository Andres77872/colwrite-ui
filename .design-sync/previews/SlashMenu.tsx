import { useEffect, useRef } from 'react';
import { EditorContext, SlashMenu } from 'colwrite-ui';

// SlashMenu is the "/" insert menu: block types, then the inline widgets
// (citation, equation, table, chart, AI passage), filtered as you type.
//
// It opens on a window CustomEvent — `colwrite:open-slash-menu` with a
// `{ blockId }` detail — and then measures the caret inside that block's
// registered editable to position itself. Both halves matter, so each cell
// below registers a real contenteditable in the editor's `refs` map, puts a
// caret in it, and dispatches the event. That is precisely what the editor
// does; nothing here forces the menu's internal `visible` state.
//
// Because the menu is fixed-positioned and portals over the page, these cells
// are one-per-card (cardMode "single" in .design-sync/config.json).

type Ctx = React.ContextType<typeof EditorContext>;

const SLASH_MENU_EVENT = 'colwrite:open-slash-menu';
const noop = () => {};

function Opened({ text, place = 'top' }: { text: string; place?: 'top' | 'bottom' }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    refs.current.p1 = host;

    // Caret at the end of the block, where a "/" would have just been typed.
    const node = host.firstChild;
    if (!node) return;
    const range = document.createRange();
    range.setStart(node, node.textContent?.length ?? 0);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    // One frame later, so the caret rect is measurable.
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent(SLASH_MENU_EVENT, { detail: { blockId: 'p1' } }));
    });
    return () => cancelAnimationFrame(raf);
  }, [text]);

  const editor = {
    refs: { current: refs.current },
    updateHtml: noop,
    addParagraphChild: () => 'new-child',
    documentId: 'doc-1',
    createRemote: () => Promise.reject(new Error('not reachable from a preview')),
    blocks: [{ id: 'p1', type: 'paragraph' as const, html: text }],
  };

  return (
    <EditorContext.Provider value={editor as unknown as Ctx}>
      <div className="w-full p-4">
        {/* Named scale steps only — an arbitrary value like pt-[34rem] is not in
            the prebuilt stylesheet unless some source already used that exact
            string, and silently applies nothing. */}
        {place === 'bottom' && (
          <>
            <div className="h-96" />
            <div className="h-32" />
          </>
        )}
        <div
          ref={hostRef}
          className="editable text-sm leading-relaxed text-muted-foreground outline-none"
          contentEditable
          suppressContentEditableWarning
        >
          {text}
        </div>
        <SlashMenu />
      </div>
    </EditorContext.Provider>
  );
}

export function Open() {
  return <Opened text="/" />;
}

// The menu flips above the caret when there is not enough room below it, and
// clamps to the viewport so it is never partly off-screen. Driving that with a
// caret near the bottom is the only way to see it — there is no prop.
//
// Note there is deliberately no "filtering" cell: the query lives in the menu's
// OWN search field (it is reset to '' on every open), not in the block text, so
// a cell that types "/tab" into the paragraph renders exactly the same list as
// this one. That cell existed and was removed for being a duplicate.
export function FlipsAboveTheCaret() {
  return <Opened text="/" place="bottom" />;
}
