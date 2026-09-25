import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { uid } from '@/lib/uid';
import { sanitizeEditableHtml } from '@/export/sanitize';
import {
  isListItem,
  kindOf,
  markdownPrefixKind,
  useActiveBlock,
  useEditorActions,
  type BlockKindId,
} from '../../../editor';
import { useLayoutEffect, useRef } from 'react';
import { openSlashMenu, isSlashMenuOpen } from '../../editor/SlashMenu/slashMenuEvents';
import { openAskAi } from '../../editor/AskAi/askAiEvents';
import { normalizeEditableHtml, serializeEditableHtml } from './editableHtml';
import { BLOCKS_MIME, pasteAsBlocks } from './pasteBlocks';
import { isMod, turnIntoKind } from './blockKeys';
import {
  captureCaretOffset,
  caretLineInfo,
  deleteBeforeCaret,
  isEditableEmpty,
  placeCaretAtLine,
  restoreCaretOffset,
  textBeforeCaret,
} from './caret';

/**
 * Whether a node sits inside an inline widget rather than in the prose.
 *
 * Every widget is rendered into its `data-child-id` placeholder, so that
 * attribute identifies all of them — present and future. This used to be a
 * hand-maintained list of five class names (`.table-inline`, `.graph-inline`,
 * …), which silently stopped matching the moment a widget's markup was
 * reworked: the paragraph then treated typing inside a table cell as typing in
 * the document, so "/" opened the command menu and Backspace in an empty cell
 * deleted the whole block.
 */
function isInsideWidget(node: Node | null | undefined): boolean {
  if (!node) return false;
  const element = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  return !!element?.closest?.('[data-child-id]');
}

/**
 * Whether "/" at the caret would start a token or sit inside one.
 *
 * The command menu only takes the key at a word boundary (start of the block
 * or after whitespace): mid-word a slash is literal text — DOIs
 * (`10.1000/xyz`), URLs, "and/or" — and a menu that eats it makes those
 * untypable.
 */
function caretAtWordBoundary(el: HTMLElement): boolean {
  const offset = captureCaretOffset(el);
  if (offset === null) return false;
  if (offset === 0) return true;
  return /\s/.test(el.textContent?.charAt(offset - 1) ?? '');
}

/** A whole-line markdown token that converts as soon as it is complete. */
const INSTANT_MARKDOWN: Record<string, BlockKindId> = {
  '---': 'divider',
  '***': 'divider',
  '```': 'code',
};

export function Editable({
  id,
  html,
  placeholder,
  placeholderWhen = 'always',
  ariaLabel,
  className,
  style,
  slashEnabled = false,
  locked = false,
}: {
  id: string;
  html: string;
  placeholder?: string;
  /**
   * `focus` shows the placeholder only on the line being written — the
   * "Type '/' for commands" hint belongs to the caret, not to every blank
   * paragraph on the page. Headings and list items keep theirs always, since
   * an empty heading with no hint is invisible.
   */
  placeholderWhen?: 'always' | 'focus';
  /** Accessible name for the document field, such as "Paragraph". */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  slashEnabled?: boolean;
  /**
   * Whether the block is locked against editing.
   *
   * "Lock block" wrote a flag that was read in exactly one place — the row's
   * class list — so a locked block still typed normally. An affordance that
   * says a block is protected and does not protect it is worse than not
   * offering it, so the flag gates the contenteditable itself. The element
   * stays focusable so arrow-key navigation still crosses the block and its
   * text can still be selected and copied.
   */
  locked?: boolean;
}) {
  // Actions plus the active-block context: the full state value changes on
  // every keystroke anywhere in the document, and subscribing to it made every
  // editable re-render on every edit. Block order is read at keydown time via
  // `getBlockIds` instead of a `blocks` subscription for the same reason.
  const {
    addBlockAfter,
    duplicateBlock,
    getBlock,
    getBlockIds,
    indentBlock,
    insertBlockBeforeExact,
    mergeWithPrevious,
    moveBlock,
    removeBlock,
    selectBlocks,
    setBlockKind,
    setChecked,
    splitBlock,
    updateHtml,
    insertBlocksAfter,
    refs,
    registerEditable,
  } = useEditorActions();
  const { activeId, setActive } = useActiveBlock();
  const pointerDownRef = useRef(false);
  const editableRef = useRef<HTMLDivElement | null>(null);
  const prevHtmlRef = useRef(html || '');
  /** True between compositionstart and compositionend (IME input). */
  const composingRef = useRef(false);
  /** A "/" typed at a word boundary: open the menu once it is in the DOM. */
  const slashPendingRef = useRef(false);

  /** Nearest block in `dir` that has an editable element, if any. */
  const neighbourBlock = (dir: -1 | 1): string | null => {
    const ids = getBlockIds();
    for (let j = ids.indexOf(id) + dir; j >= 0 && j < ids.length; j += dir) {
      if (refs.current[ids[j]]) return ids[j];
    }
    return null;
  };

  /**
   * Focus a block and place the caret once React has rendered it.
   *
   * A conversion can swap the element (paragraph → heading remounts the
   * editable), so the lookup happens after the frame, not before.
   */
  const focusLater = (targetId: string, place: (el: HTMLElement) => void) => {
    requestAnimationFrame(() => {
      const target = refs.current[targetId];
      if (!target) return;
      target.focus({ preventScroll: false });
      place(target);
    });
  };

  const syncEmpty = (el: HTMLElement) => {
    el.toggleAttribute('data-empty', isEditableEmpty(el));
  };

  const commit = (el: HTMLDivElement) => {
    const serialized = serializeEditableHtml(el);
    syncEmpty(el);
    if (el.getAttribute('data-serialized') !== serialized) {
      el.setAttribute('data-serialized', serialized);
      updateHtml(id, serialized);
    }
    return serialized;
  };

  /** Convert this block, rewriting its html in the same undo step. */
  const convert = (el: HTMLDivElement, kind: BlockKindId, remountExpected: boolean) => {
    const html = serializeEditableHtml(el);
    el.setAttribute('data-serialized', html);
    syncEmpty(el);
    setBlockKind(id, kind, { html });
    if (kind === 'divider') {
      const nextId = addBlockAfter(id, 'paragraph');
      focusLater(nextId, (target) => restoreCaretOffset(target, 0));
      return;
    }
    if (remountExpected) focusLater(id, (target) => restoreCaretOffset(target, 0));
  };

  // Keep DOM content in sync only when NOT actively editing this block.
  // When becoming active (focus), ensure content is restored if a re-render replaced the node.
  useLayoutEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    const next = html || '';
    if (activeId !== id) {
      // Rewrite only when the markup really differs. The live DOM of a
      // paragraph with a citation or an equation always differs from `html`
      // by the widgets' rendered insides, so comparing raw innerHTML rewrote
      // it every time any block gained or lost focus. That detached every
      // node a saved Range pointed at: the selection toolbar's link field
      // then linked nothing, and "Cite at cursor" landed at the start of the
      // block.
      if (el.innerHTML !== next && serializeEditableHtml(el) !== normalizeEditableHtml(next)) {
        el.innerHTML = next;
      }
    } else {
      // State that moved without this editable — an accepted agent change, a
      // restore, an undo — must not wait for blur: the next keystroke would
      // serialize this stale DOM back over the new state. Detect it against
      // the last html this editable itself committed, and rebase.
      const movedExternally =
        prevHtmlRef.current !== next && el.getAttribute('data-serialized') !== next;
      if (movedExternally) {
        const caret = captureCaretOffset(el);
        el.innerHTML = next;
        el.setAttribute('data-serialized', next);
        if (caret !== null) restoreCaretOffset(el, caret);
      }
      // Active: if DOM got replaced and is empty, restore from state.
      if (!el.innerHTML && next) el.innerHTML = next;
      // If selection is not inside this element (e.g., after re-render), move caret to end.
      const sel = window.getSelection();
      const within = !!sel && sel.rangeCount > 0 && el.contains(sel.anchorNode);
      if (!within) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      }
    }
    syncEmpty(el);
    prevHtmlRef.current = next;
  }, [html, activeId, id]);

  return (
    <div
      className={cn(
        // `editable` is the hook FloatingToolbar walks the DOM for to decide
        // whether a selection is inside a block. Without it the format and
        // AI-action toolbar never appears.
        "editable",
        // No focus outline: a box drawn around body text reads as an error
        // state while writing. The caret is the affordance, as on paper.
        "min-h-[1.5em] w-full outline-none whitespace-pre-wrap break-words",
        locked && "cursor-default",
        className
      )}
      ref={(element) => {
        editableRef.current = element;
        registerEditable(id, element);
      }}
      contentEditable={!locked}
      // A contenteditable div has inconsistent implicit semantics across
      // browser/assistive-technology pairs. Expose the editing contract
      // explicitly so every prose block is discoverable as a document field.
      role="textbox"
      aria-label={ariaLabel ?? placeholder ?? 'Document text'}
      aria-multiline="true"
      // A non-editable div is not in the tab order, and `refs.current[id].focus()`
      // on one does nothing — which would strand arrow-key navigation on the
      // block before a locked one.
      tabIndex={locked ? 0 : undefined}
      aria-readonly={locked || undefined}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      data-placeholder-when={placeholderWhen}
      onMouseDown={() => { pointerDownRef.current = true; }}
      onFocus={(e) => {
        setActive(id);
        // Focus that started inside a widget belongs to that widget: moving
        // the caret here would pull it back out mid-keystroke.
        if (isInsideWidget(e.target as HTMLElement)) return;
        const el = e.currentTarget as HTMLDivElement;
        if (!el.innerHTML && (html ?? '') !== '') {
          el.innerHTML = html || '';
        }
        // When focus was initiated by a pointer (mouse/touch), preserve the browser's caret
        // placement instead of forcing it to the end. Reset the flag after this tick.
        if (pointerDownRef.current) {
          queueMicrotask(() => { pointerDownRef.current = false; });
          return;
        }
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      }}
      onClick={() => setActive(id)}
      onBlur={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        const row = el.closest('[data-block-id]') as HTMLElement | null;
        const explicitNext = (e.relatedTarget as HTMLElement | null) || null;
        const canvas = el.closest('.canvas') as HTMLElement | null;
        // If the slash menu is open, do not clear active block when focus appears to move elsewhere
        if (isSlashMenuOpen()) return;
        // Focus moved within the same block row (e.g., controls) → keep active
        if (row && explicitNext && row.contains(explicitNext)) return;
        // Defer to allow focus to settle (e.relatedTarget can be null on mousedown)
        queueMicrotask(() => {
          const next = document.activeElement as HTMLElement | null;
          if (isSlashMenuOpen()) return;
          // If focus remains inside the same row, keep active
          if (row && next && row.contains(next)) return;
          // If focus moved elsewhere but still inside the editor canvas, do not clear here.
          // The destination will set active via its own focus handler.
          if (canvas && next && canvas.contains(next)) return;
          setActive(null);
        });
      }}
      onInput={(e) => {
        // IME composition commits on compositionend, not per update: an
        // intermediate commit re-renders the block mid-composition and can
        // drop the in-flight text.
        if (composingRef.current) return;
        const target = e.currentTarget as HTMLDivElement;
        // `---` and ``` convert the moment they are complete, as in Notion:
        // there is no text after them worth waiting for.
        const block = getBlock(id);
        const instant = INSTANT_MARKDOWN[(target.textContent ?? '').trim()];
        if (instant && block?.type === 'paragraph' && !block.variant && !target.querySelector('[data-child-id]')) {
          target.innerHTML = '';
          convert(target, instant, true);
          return;
        }
        commit(target);
        if (slashPendingRef.current) {
          slashPendingRef.current = false;
          openSlashMenu(id);
        }
      }}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        commit(e.currentTarget as HTMLDivElement);
      }}
      onPaste={(e) => {
        // Widget interiors (table cells, …) run their own paste handling.
        const selection = window.getSelection();
        if (isInsideWidget(selection?.anchorNode) || isInsideWidget(e.target as Node)) return;
        if (locked) { e.preventDefault(); return; }
        // Browser-default paste would drop arbitrary clipboard HTML into the
        // DOM; `onInput` would then serialize it into document state and it
        // would round-trip to storage as stored XSS. Placeholder spans are
        // dropped as well: their children don't travel with a copy, so a
        // pasted `data-child-id` span would render as an empty ghost widget.
        e.preventDefault();
        const html = e.clipboardData.getData('text/html');
        const text = e.clipboardData.getData('text/plain');
        // Several lines of structured text — a markdown list, headings,
        // paragraphs copied from elsewhere — become blocks of their own, the
        // way they were written, instead of one paragraph full of line breaks.
        const el = e.currentTarget as HTMLDivElement;
        const blocksJson = e.clipboardData.getData(BLOCKS_MIME);
        if (pasteAsBlocks({ el, blockId: id, html, text, blocksJson, getBlock, splitBlock, insertBlocksAfter, commit, focusLater })) {
          return;
        }
        if (html) {
          document.execCommand(
            'insertHTML',
            false,
            sanitizeEditableHtml(html, { placeholders: 'drop' }),
          );
          return;
        }
        if (text) document.execCommand('insertText', false, text);
      }}
      onKeyDown={(e) => {
        // Typing inside a widget is that widget's business — the paragraph
        // must not steal '/' for the command menu or Backspace for deletion.
        const selection = window.getSelection();
        if (
          isInsideWidget(selection?.anchorNode) ||
          isInsideWidget(document.activeElement) ||
          isInsideWidget(e.target as Node)
        ) {
          return;
        }
        const el = e.currentTarget as HTMLDivElement;
        // IME composition keydowns are not commands: Chrome masks most as
        // 'Process', but Firefox/Safari leak Backspace/Enter — which used to
        // delete or split the block mid-composition.
        if (e.nativeEvent.isComposing || composingRef.current) return;
        // The command menu owns navigation keys while it is open.
        if (isSlashMenuOpen() && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) return;

        // Block selection: Esc lifts the caret out of the text and selects
        // the whole block, the entry point to moving, duplicating or
        // deleting blocks from the keyboard.
        if (e.key === 'Escape' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          selectBlocks([id]);
          el.blur();
          return;
        }
        // Mod+A on a block whose text is already all selected (or empty)
        // widens to every block in the document.
        if (isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
          const all = (el.textContent ?? '').length;
          const selected = selection?.toString().length ?? 0;
          if (all === 0 || selected >= all) {
            e.preventDefault();
            selectBlocks(getBlockIds());
            el.blur();
          }
          return;
        }

        // A selection spanning two editables would make the browser do DOM
        // surgery across two React-tracked roots; collapse it into this block
        // before an editing key acts on it.
        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (
            !el.contains(range.commonAncestorContainer) &&
            (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' || e.key.length === 1)
          ) {
            e.preventDefault();
            selection.collapseToStart();
            return;
          }
        }

        // Block-level shortcuts that do not change text work on locked
        // blocks too, except those that would convert or move them.
        if (isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          duplicateBlock(id);
          return;
        }
        if (isMod(e) && e.shiftKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          if (locked) return;
          const caret = captureCaretOffset(el) ?? 0;
          moveBlock(id, e.key === 'ArrowUp' ? -1 : 1);
          focusLater(id, (target) => restoreCaretOffset(target, caret));
          return;
        }
        const turnInto = isMod(e) && e.altKey && !e.shiftKey ? turnIntoKind(e) : undefined;
        if (turnInto) {
          e.preventDefault();
          if (locked) return;
          const kind = turnInto;
          const block = getBlock(id);
          if (!block || kindOf(block) === kind) return;
          const headingSwitch = (block.type === 'heading') !== (kind === 'h1' || kind === 'h2' || kind === 'h3');
          convert(el, kind, headingSwitch || kind === 'code');
          return;
        }
        // Mod+J asks the assistant about the selection, or at the caret.
        if (isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
          e.preventDefault();
          e.stopPropagation();
          openAskAi({ blockId: id });
          return;
        }

        // Nothing that mutates a locked block applies to it. Arrow keys fall
        // through to the navigation handler below, which only moves the caret.
        if (locked && !e.key.startsWith('Arrow')) return;

        const block = getBlock(id);
        const isParagraph = block?.type === 'paragraph';
        const variant = isParagraph ? block.variant : undefined;

        // Space on an empty text line opens the assistant prompt there.
        if (
          e.key === ' ' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
          isParagraph && !variant && isEditableEmpty(el)
        ) {
          e.preventDefault();
          openAskAi({ blockId: id });
          return;
        }

        // Markdown at the start of a line: `# `, `- `, `1. `, `[] `, `> `.
        if (
          e.key === ' ' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
          selection?.isCollapsed && isParagraph
        ) {
          const before = textBeforeCaret(el);
          const kind = before === null ? null : markdownPrefixKind(before);
          if (kind && block && kindOf(block) !== kind) {
            e.preventDefault();
            deleteBeforeCaret(el);
            convert(el, kind, kind === 'h1' || kind === 'h2' || kind === 'h3');
            if (kind === 'todo' && /x/i.test(before ?? '')) setChecked(id, true);
            return;
          }
        }

        if (slashEnabled && e.key === '/' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // The "/" is typed like any other character; the menu opens once it
          // is in the text and filters on what follows it. Mid-word it is a
          // literal slash and no menu opens.
          slashPendingRef.current = caretAtWordBoundary(el);
          return;
        }

        if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && block && isListItem(block)) {
          // Tab nests a list item under the one above; Shift+Tab lifts it.
          // Consumed even when the item cannot move, so focus stays in the
          // document rather than jumping to the next control.
          e.preventDefault();
          indentBlock(id, e.shiftKey ? -1 : 1);
          return;
        }

        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          if (!selection || selection.rangeCount === 0) return;
          // Enter on an empty list item, quote or callout leaves it, the way
          // an outline does: a nested item steps out one level first.
          if (variant && isEditableEmpty(el)) {
            if (block && isListItem(block) && (block.type === 'paragraph' && (block.indent ?? 0) > 0)) {
              indentBlock(id, -1);
            } else {
              convert(el, 'text', false);
            }
            return;
          }
          // Enter at the very start of a non-empty block opens a line above
          // and leaves this block — its type, its widgets — where it is. A
          // split here would have left an empty heading behind and moved the
          // heading's words into a paragraph.
          if (selection.isCollapsed && captureCaretOffset(el) === 0 && !isEditableEmpty(el) && block) {
            const above = block.type === 'paragraph' && isListItem(block)
              ? { ...block, id: uid(), html: '', children: [], ...(block.variant === 'todo' ? { checked: false } : {}) }
              : { id: uid(), type: 'paragraph' as const, html: '', children: [], columns: 1 };
            insertBlockBeforeExact(id, above);
            return;
          }
          // Split the block at the caret; the text after it moves into a new
          // block below — the same list kind for a list item, body text
          // otherwise. Ctrl+Enter below keeps the old "empty block after"
          // behavior.
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const afterRange = document.createRange();
          afterRange.setStart(range.endContainer, range.endOffset);
          afterRange.setEnd(el, el.childNodes.length);
          const holder = document.createElement('div');
          holder.appendChild(afterRange.extractContents());
          const afterHtml = serializeEditableHtml(holder);
          const beforeHtml = serializeEditableHtml(el);
          // The live DOM already shows exactly the before half.
          el.setAttribute('data-serialized', beforeHtml);
          syncEmpty(el);
          const newId = splitBlock(id, beforeHtml, afterHtml);
          focusLater(newId, (target) => restoreCaretOffset(target, 0));
          return;
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey) {
          e.preventDefault();
          const newId = addBlockAfter(id, 'paragraph');
          focusLater(newId, (target) => restoreCaretOffset(target, 0));
          return;
        }
        if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const atStart = selection?.isCollapsed && captureCaretOffset(el) === 0;
          // A list item, quote or callout — or a heading — turns back into
          // body text first; only then does Backspace merge or delete.
          if (atStart && block && (variant || block.type === 'heading')) {
            e.preventDefault();
            convert(el, 'text', block.type === 'heading');
            return;
          }
          if (isEditableEmpty(el)) {
            e.preventDefault();
            // The caret goes to the end of the block above; deleting the line
            // used to leave focus nowhere.
            const prevId = neighbourBlock(-1);
            removeBlock(id);
            if (prevId) focusLater(prevId, (target) => restoreCaretOffset(target, Number.MAX_SAFE_INTEGER));
            return;
          }
          // At the very start of a non-empty block, Backspace merges the
          // block into the one above instead of doing nothing.
          if (atStart) {
            e.preventDefault();
            const merged = mergeWithPrevious(id);
            if (merged && merged.targetId !== id) {
              focusLater(merged.targetId, (target) => restoreCaretOffset(target, merged.caretOffset));
            }
          }
          return;
        }
        if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.altKey && selection?.isCollapsed) {
          // Forward delete at the end pulls the next block up into this one.
          const offset = captureCaretOffset(el);
          if (offset !== null && offset === (el.textContent?.length ?? 0)) {
            const nextId = neighbourBlock(1);
            const next = nextId ? getBlock(nextId) : undefined;
            if (nextId && next && !next.locked && (next.type === 'paragraph' || next.type === 'heading')) {
              e.preventDefault();
              const merged = mergeWithPrevious(nextId);
              if (merged) focusLater(merged.targetId, (target) => restoreCaretOffset(target, merged.caretOffset));
            }
          }
          return;
        }
        // Arrow keys cross block boundaries at the edges of the text: Left and
        // Right at the first and last character, Up and Down on the first and
        // last visual line, keeping the column.
        if (
          (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowDown') &&
          !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
          selection?.isCollapsed
        ) {
          const offset = captureCaretOffset(el);
          const textLength = el.textContent?.length ?? 0;
          const line = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? caretLineInfo(el) : null;
          const leaveUp =
            e.key === 'ArrowLeft' ? offset === 0 : e.key === 'ArrowUp' && (line ? line.onFirstLine : offset === 0);
          const leaveDown =
            e.key === 'ArrowRight'
              ? offset === textLength
              : e.key === 'ArrowDown' && (line ? line.onLastLine : offset === textLength);
          if (leaveUp) {
            const prevId = neighbourBlock(-1);
            const target = prevId ? refs.current[prevId] : null;
            if (target) {
              e.preventDefault();
              target.focus();
              if (e.key === 'ArrowUp' && line) placeCaretAtLine(target, 'last', line.x);
              else restoreCaretOffset(target, target.textContent?.length ?? 0);
            }
          } else if (leaveDown) {
            const nextId = neighbourBlock(1);
            const target = nextId ? refs.current[nextId] : null;
            if (target) {
              e.preventDefault();
              target.focus();
              if (e.key === 'ArrowDown' && line) placeCaretAtLine(target, 'first', line.x);
              else restoreCaretOffset(target, 0);
            }
          }
        }
      }}
      style={style}
      /* Initial content is set via useLayoutEffect to avoid caret resets */
    />
  );
}
