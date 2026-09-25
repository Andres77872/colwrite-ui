import { useEffect, useLayoutEffect, useRef } from 'react';
import { focusPageTitle, useDocumentTitle } from '@/editor';

function isCaretAtEnd(el: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setStart(selection.anchorNode ?? el, selection.anchorOffset);
  return range.toString().length === 0;
}

/**
 * The document's name as the first line of the page, the way Notion shows
 * it: a 40px bold line in the text column, "Untitled" while it has none.
 *
 * It renames through the same `useDocumentTitle` the topbar breadcrumb reads,
 * and commits on blur or Enter rather than per keystroke, so a rename is one
 * save and one history entry. Enter and ↓ at the end continue into the first
 * block, as if the title were the line above it.
 */
export function PageTitle({
  onContinue,
  pageKey,
  blank = false,
}: {
  onContinue: () => void;
  /** Identifies the open page; a change means another page was opened. */
  pageKey?: string | null;
  /** Whether nothing has been written on the page yet. */
  blank?: boolean;
}) {
  const { draftTitle, rename } = useDocumentTitle();
  const fieldRef = useRef<HTMLSpanElement | null>(null);

  // A new page starts with the caret in its title, as in Notion: "New page"
  // (sidebar, ⌘K, the page menu, "Start blank") used to leave focus on the
  // body, so the first words typed went nowhere. Only an untitled, empty
  // page, and only when focus is not already in something else being typed.
  const untitledBlank = blank && draftTitle === '';
  // Armed when another page opens, for a moment: a page whose content is
  // deleted later must not pull the caret up into its title.
  const armedUntil = useRef(0);
  useEffect(() => {
    armedUntil.current = Date.now() + 1500;
  }, [pageKey]);
  useEffect(() => {
    if (!untitledBlank || Date.now() > armedUntil.current) return;
    const frame = requestAnimationFrame(() => {
      armedUntil.current = 0;
      const field = fieldRef.current;
      const active = document.activeElement as HTMLElement | null;
      if (!field || active === field) return;
      const typingElsewhere =
        active &&
        active !== document.body &&
        (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (typingElsewhere || active?.closest('[role="dialog"]')) return;
      focusPageTitle();
    });
    return () => cancelAnimationFrame(frame);
  }, [pageKey, untitledBlank]);

  // Uncontrolled while focused, so a rename arriving from elsewhere (the
  // agent's update_meta, another tab) never moves the caret mid-word.
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el || document.activeElement === el) return;
    if (el.textContent !== draftTitle) el.textContent = draftTitle;
    el.toggleAttribute('data-empty', draftTitle === '');
  }, [draftTitle]);

  return (
    <h1 className="page-title">
      <span
        ref={fieldRef}
        data-page-title=""
        className="page-title-field block min-h-[1.2em] whitespace-pre-wrap break-words outline-none"
        role="textbox"
        aria-label="Page title"
        aria-multiline="false"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck
        data-placeholder="Untitled"
        onInput={(event) => {
          const el = event.currentTarget;
          el.toggleAttribute('data-empty', (el.textContent ?? '') === '');
        }}
        onPaste={(event) => {
          // One line: a pasted paragraph becomes a title, not a title plus a
          // stray block of line breaks.
          event.preventDefault();
          const text = event.clipboardData.getData('text/plain').replace(/\s+/g, ' ');
          document.execCommand('insertText', false, text);
        }}
        onKeyDown={(event) => {
          const el = event.currentTarget;
          if (event.key === 'Escape') {
            event.preventDefault();
            el.textContent = draftTitle;
            el.toggleAttribute('data-empty', draftTitle === '');
            el.blur();
            return;
          }
          const continues =
            (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) ||
            (event.key === 'ArrowDown' && isCaretAtEnd(el));
          if (!continues) return;
          event.preventDefault();
          // Blurring commits; committing here as well would save twice.
          el.blur();
          onContinue();
        }}
        onBlur={(event) => void rename(event.currentTarget.textContent ?? '')}
      />
    </h1>
  );
}
