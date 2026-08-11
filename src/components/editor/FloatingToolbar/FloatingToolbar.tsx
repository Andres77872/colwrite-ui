import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useEditor } from '@/editor';
import { dispatchAction } from '@/services/actionDispatcher';
import type { AiAction } from '@/config/aiActions';
import { AIActionMenu } from './AIActionMenu/AIActionMenu';
import {
  commitMaterializedCitationSuggestion,
  materializeCitationSuggestionForAction,
  stripCitationTags,
} from './citationTags';
import {
  clearChildPlaceholders,
  serializeEditableHtml,
} from '@/components/common/Editable/editableHtml';
import { Input } from '@/components/ui/input';
import { Bold, Code, Italic, Link2, Strikethrough } from 'lucide-react';

const TOOLBAR_HEIGHT = 44;
const VIEWPORT_MARGIN = 8;
/** Roughly the toolbar's width; used only until the real size is measured. */
const ESTIMATED_WIDTH = 260;

/**
 * Keep the toolbar on screen: flip below the selection when there is no room
 * above, and clamp horizontally so it never runs off either edge.
 *
 * Before the first layout the size is the estimate above; afterwards the
 * measured size, so the guess is spent on one frame at most.
 */
function positionFor(rect: DOMRect, size: { width: number; height: number }) {
  const preferredTop = rect.top - size.height;
  const top = preferredTop < VIEWPORT_MARGIN ? rect.bottom + VIEWPORT_MARGIN : preferredTop;
  const half = size.width / 2;
  const left = Math.min(
    Math.max(rect.left + rect.width / 2, half + VIEWPORT_MARGIN),
    window.innerWidth - half - VIEWPORT_MARGIN,
  );
  return { top, left };
}

/** `⌘X` on Apple platforms, `Ctrl+X` everywhere else. */
function modKeyLabel(key: string): string {
  const apple =
    typeof navigator !== 'undefined' &&
    /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
  return apple ? `⌘${key}` : `Ctrl+${key}`;
}

type FormatStateKey = 'bold' | 'italic' | 'strike' | 'code';

interface FormatButton {
  command: string;
  stateKey: FormatStateKey;
  label: string;
  icon: typeof Bold;
  shortcut?: string;
}

/**
 * Underline is gone and link and inline code have taken its place.
 *
 * Underline in running prose reads as a link and means nothing in a paper,
 * while link — the most-used inline format in any writing tool — was
 * unreachable: `⌘K` did nothing and the toolbar did not offer it.
 */
const FORMAT_BUTTONS: readonly FormatButton[] = [
  { command: 'bold', stateKey: 'bold', label: 'Bold', icon: Bold, shortcut: modKeyLabel('B') },
  { command: 'italic', stateKey: 'italic', label: 'Italic', icon: Italic, shortcut: modKeyLabel('I') },
  { command: 'strikeThrough', stateKey: 'strike', label: 'Strikethrough', icon: Strikethrough },
  { command: 'code', stateKey: 'code', label: 'Inline code', icon: Code },
];

type FormatState = Record<FormatStateKey, boolean>;

const EMPTY_STATE: FormatState = { bold: false, italic: false, strike: false, code: false };

/** The `<code>` element the selection sits inside, if any. */
function codeAncestor(node: Node | null): HTMLElement | null {
  const element = node?.nodeType === 1 ? (node as HTMLElement) : node?.parentElement;
  return element?.closest('code') ?? null;
}

/** The `<a>` the selection sits inside, if any. */
function linkAncestor(node: Node | null): HTMLAnchorElement | null {
  const element = node?.nodeType === 1 ? (node as HTMLElement) : node?.parentElement;
  return (element?.closest('a') as HTMLAnchorElement | null) ?? null;
}

/**
 * Wrap the selection in `<code>`, or unwrap it when it is already inside one.
 *
 * `document.execCommand` has no inline-code command, so this is done by hand.
 * `surroundContents` throws on a range that partially selects a node, which is
 * ordinary in prose — the fallback extracts and re-inserts instead.
 */
function toggleInlineCode(range: Range): void {
  const existing = codeAncestor(range.commonAncestorContainer);
  if (existing) {
    const parent = existing.parentNode;
    if (!parent) return;
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
    parent.removeChild(existing);
    return;
  }
  const code = document.createElement('code');
  try {
    range.surroundContents(code);
  } catch {
    code.append(range.extractContents());
    range.insertNode(code);
  }
}

/**
 * The toolbar's selection tracking, formatting and AI-suggestion machinery.
 *
 * It locates the active field by walking up to an element with the `editable`
 * class. That class was never rendered, so until it was added to `Editable`
 * this toolbar could not appear at all and the AI action menu was unreachable.
 */
function useFloatingToolbar() {
  const { exec, refs, updateHtml, addParagraphChild, documentId, ensureRemoteDocument } =
    useEditor();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [states, setStates] = useState<FormatState>(EMPTY_STATE);
  const [activeIndex, setActiveIndex] = useState(0);
  /** The href on the current selection, and whether its editor is open. */
  const [linkHref, setLinkHref] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const slashOpenRef = useRef(false);
  // The last non-collapsed range inside an editable. Keeping it lets menu
  // items run from the keyboard, where opening the menu moves DOM focus away
  // from the text and a live `getSelection()` read is no longer reliable.
  const savedRangeRef = useRef<Range | null>(null);
  // The selection rect behind the current position, kept so a measured
  // toolbar size can refine a position computed against the estimates.
  const selectionRectRef = useRef<DOMRect | null>(null);
  const sizeRef = useRef({ width: ESTIMATED_WIDTH, height: TOOLBAR_HEIGHT });
  // Escape hides the toolbar until the selection it acted on is released —
  // restoring that selection would otherwise re-show it in the same gesture.
  const dismissedRef = useRef(false);

  useEffect(() => {
    const onSlashVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ visible: boolean }>).detail;
      slashOpenRef.current = Boolean(detail?.visible);
      if (slashOpenRef.current) setVisible(false);
    };
    window.addEventListener('colwrite:slash-menu-visibility', onSlashVisibility as EventListener);
    return () =>
      window.removeEventListener('colwrite:slash-menu-visibility', onSlashVisibility as EventListener);
  }, []);

  const ownerDocumentId = useRef(documentId);
  useEffect(() => {
    if (ownerDocumentId.current === documentId) return;
    ownerDocumentId.current = documentId;
    savedRangeRef.current = null;
    setVisible(false);
  }, [documentId]);

  useEffect(() => {
    const onSelectionChange = () => {
      // Moving focus onto a toolbar button greys the selection out, which used
      // to dismiss the toolbar the moment a keyboard user reached it. While
      // focus is inside the toolbar the selection it acts on is `savedRangeRef`.
      if (toolbarRef.current?.contains(document.activeElement)) return;

      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed || slashOpenRef.current) {
        // A collapsed selection ends the dismissal: the next one is a fresh
        // selection and gets the toolbar back.
        dismissedRef.current = false;
        setVisible(false);
        return;
      }

      let node: Node | null = selection.anchorNode;
      let editable: HTMLElement | null = null;
      while (node) {
        if (node instanceof HTMLElement && node.classList.contains('editable')) {
          editable = node;
          break;
        }
        node = node.parentNode;
      }
      if (!editable) {
        setVisible(false);
        return;
      }

      if (dismissedRef.current) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        setVisible(false);
        return;
      }

      savedRangeRef.current = range.cloneRange();
      selectionRectRef.current = rect;

      setPos(positionFor(rect, sizeRef.current));
      try {
        setStates({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          strike: document.queryCommandState('strikeThrough'),
          code: codeAncestor(range.commonAncestorContainer) !== null,
        });
      } catch {
        setStates(EMPTY_STATE);
      }
      setLinkHref(linkAncestor(range.commonAncestorContainer)?.getAttribute('href') ?? null);
      setLinkOpen(false);
      setVisible(true);
    };

    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('scroll', onSelectionChange, true);
    window.addEventListener('resize', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', onSelectionChange, true);
      window.removeEventListener('resize', onSelectionChange);
    };
  }, []);

  // Abort any in-flight generation if the toolbar unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // The first position of an opening is computed against the size estimates;
  // measure the rendered toolbar and refine it before the browser paints.
  useLayoutEffect(() => {
    if (!visible) return;
    const el = toolbarRef.current;
    const rect = selectionRectRef.current;
    if (!el || !rect) return;
    const { offsetWidth: width, offsetHeight: height } = el;
    if (width === sizeRef.current.width && height === sizeRef.current.height) return;
    sizeRef.current = { width, height };
    setPos(positionFor(rect, sizeRef.current));
  }, [visible]);

  const findBlockId = useCallback((node: Node | null): { el: HTMLDivElement | null; id: string | null } => {
    let current: Node | null = node;
    while (current) {
      if (current instanceof HTMLElement && current.classList.contains('editable')) break;
      current = current.parentNode;
    }
    const el = (current as HTMLDivElement | null) ?? null;
    if (!el) return { el: null, id: null };
    const entry = Object.entries(refs.current || {}).find(([, dom]) => dom === el);
    return { el, id: entry?.[0] ?? null };
  }, [refs]);

  /**
   * Put the caret back where the user left it before reaching the toolbar.
   *
   * `document.execCommand` acts on whatever the document has selected, so once
   * focus sits on a toolbar button it would apply to nothing. The pointer path
   * never hit this because `mousedown` is prevented; the keyboard path does.
   */
  const focusSavedRange = useCallback(() => {
    const range = savedRangeRef.current;
    if (!range) return;
    const { el } = findBlockId(range.commonAncestorContainer);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    const selection = document.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }, [findBlockId]);

  /**
   * Escape out of the toolbar: hide it and put the selection back.
   *
   * Restoring the saved range fires `selectionchange`, which would re-open the
   * toolbar in the same gesture — the dismissal flag holds it closed until the
   * selection collapses.
   */
  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setVisible(false);
    focusSavedRange();
  }, [focusSavedRange]);

  const onFormat = (command: string) => (event: React.MouseEvent | React.KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    focusSavedRange();
    if (command === 'code') {
      const selection = document.getSelection();
      if (!selection?.rangeCount) return;
      toggleInlineCode(selection.getRangeAt(0));
      commitActiveBlock();
      setStates((prev) => ({ ...prev, code: !prev.code }));
      return;
    }
    exec(command);
  };

  /** Write the block's DOM back to document state after a hand-made edit. */
  const commitActiveBlock = useCallback(() => {
    const { el, id } = findBlockId(document.getSelection()?.anchorNode ?? null);
    if (el && id) updateHtml(id, serializeEditableHtml(el));
  }, [findBlockId, updateHtml]);

  /**
   * Apply, replace or clear the link on the saved selection.
   *
   * `createLink` on a range already inside an `<a>` nests one anchor in
   * another, so an existing link is unwrapped first and then rewritten.
   */
  const applyLink = useCallback(
    (href: string | null) => {
      focusSavedRange();
      const selection = document.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range) return;

      const existing = linkAncestor(range.commonAncestorContainer);
      if (existing) {
        const parent = existing.parentNode;
        if (parent) {
          while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
          parent.removeChild(existing);
        }
      }
      if (href) exec('createLink', href);
      commitActiveBlock();
      setLinkHref(href);
      setLinkOpen(false);
    },
    [commitActiveBlock, exec, focusSavedRange],
  );

  const onAi = useCallback(
    async (action: AiAction, language?: string) => {
      const range = savedRangeRef.current;
      if (!range || range.collapsed) return;

      const { el: editable, id: blockId } = findBlockId(range.commonAncestorContainer);
      if (!editable || !blockId) return;

      const selectedText = range.toString();
      if (!selectedText.trim()) return;

      abortRef.current?.abort();

      // The old and the new stacked, not run together in the line.
      //
      // The original and its streaming replacement used to render adjacent and
      // inline, so a three-sentence rewrite made the paragraph twice as long
      // with the two versions interleaved in reading order — the layout that
      // makes a comparison hardest, for the one task that is nothing but
      // comparison. They are two rows now, carrying the same `diff-remove` /
      // `diff-add` tokens the block-level review already uses.
      const wrapper = document.createElement('span');
      wrapper.className = 'ai-suggest';
      wrapper.setAttribute('data-action', action);
      wrapper.contentEditable = 'true';
      wrapper.setAttribute('data-generating', '1');

      const original = document.createElement('span');
      original.className = 'ai-original';
      original.contentEditable = 'false';

      const generated = document.createElement('span');
      generated.className = 'ai-generated';
      generated.contentEditable = 'true';

      const errorLine = document.createElement('span');
      errorLine.className = 'ai-error';
      errorLine.contentEditable = 'false';
      errorLine.hidden = true;

      const controls = document.createElement('span');
      controls.className = 'ai-controls';
      controls.contentEditable = 'false';

      // Progress used to be a `data-generating` attribute and whatever the
      // stylesheet made of it; failure used to be `data-error` and nothing at
      // all — no message, no cause, no retry label.
      const status = document.createElement('span');
      status.className = 'ai-status';
      const spinner = document.createElement('span');
      spinner.className = 'ai-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      const statusText = document.createElement('span');
      statusText.textContent = 'Writing…';
      status.append(spinner, statusText);
      status.setAttribute('role', 'status');

      /**
       * A control in the same vocabulary as the rest of the app: a labelled
       * button, not a bare glyph. ✓, ✕ and ■ asked the same question the
       * review bar asks — keep this or not — in a second, cheaper-looking
       * language, and the cheap one was the one editing your sentence.
       */
      const makeControl = (className: string, label: string, hint?: string) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `ai-btn ${className}`;
        button.title = hint ? `${label} · ${hint}` : label;
        button.setAttribute('aria-label', button.title);
        button.textContent = label;
        return button;
      };

      /**
       * Wire a suggestion control for pointer *and* keyboard.
       *
       * `mousedown` is only here to stop the caret jumping into the control;
       * the action runs on `click`, which is what Enter and Space produce.
       * These used to carry the action on `mousedown` alone, which meant a
       * suggestion could not be accepted, rejected or stopped without a mouse.
       */
      const bindControl = (button: HTMLButtonElement, run: () => void) => {
        button.onmousedown = (event) => {
          event.preventDefault();
          event.stopPropagation();
        };
        button.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          run();
        };
      };

      const acceptBtn = makeControl('ai-accept', 'Accept', modKeyLabel('↵'));
      const rejectBtn = makeControl('ai-reject', 'Reject', 'Esc');
      // Stop and regenerate are two different things, so they are two
      // different buttons. The stop control used to turn into a ↻ in place,
      // which changes what a control means without moving it.
      const stopBtn = makeControl('ai-stop', 'Stop');
      const regenerateBtn = makeControl('ai-regenerate', 'Try again');
      regenerateBtn.hidden = true;
      controls.append(status, acceptBtn, rejectBtn, stopBtn, regenerateBtn);

      let originalFrag: DocumentFragment;
      try {
        originalFrag = range.extractContents();
      } catch {
        originalFrag = document.createDocumentFragment();
        originalFrag.append(document.createTextNode(selectedText));
      }
      original.append(originalFrag);
      wrapper.append(original, generated, errorLine, controls);
      range.insertNode(wrapper);

      /**
       * Persist the block as if the suggestion were not there.
       *
       * The suggestion UI — struck-through original, streaming text, and the
       * ✓/✕/■ buttons — lives inside the contenteditable, so the raw
       * `innerHTML` contains all of it. Storing that put literal buttons into
       * the saved document (within one frame, via the localStorage effect),
       * and navigating away mid-suggestion made it permanent. Until the user
       * accepts or rejects, the document's committed state is the original.
       */
      const persistPreSuggestion = () => {
        const clone = editable.cloneNode(true) as HTMLDivElement;
        clone.querySelectorAll('.ai-suggest').forEach((node) => {
          const pristine = node.querySelector('.ai-original');
          node.replaceWith(...Array.from(pristine?.childNodes ?? []));
        });
        clearChildPlaceholders(clone);
        updateHtml(blockId, clone.innerHTML);
      };

      persistPreSuggestion();
      setVisible(false);

      let rafPending = false;
      const schedulePersist = () => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          persistPreSuggestion();
        });
      };
      generated.addEventListener('input', schedulePersist);

      let stopped = false;

      bindControl(stopBtn, () => {
        stopped = true;
        abortRef.current?.abort();
      });
      bindControl(regenerateBtn, () => {
        void runStream();
      });

      /** Say what went wrong, in the citation widget's register. */
      const fail = (message: string) => {
        wrapper.setAttribute('data-error', '1');
        errorLine.textContent = message;
        errorLine.hidden = false;
      };

      const runStream = async () => {
        stopped = false;
        wrapper.setAttribute('data-generating', '1');
        wrapper.removeAttribute('data-error');
        errorLine.hidden = true;
        errorLine.textContent = '';
        generated.replaceChildren();
        stopBtn.hidden = false;
        regenerateBtn.hidden = true;

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          // The agent addresses the document by id, and an empty one is not a
          // document the server can find — the rewrite failed with nothing on
          // screen to explain why. Save the draft first, as sending a chat
          // message does.
          const targetDocumentId = documentId ?? (await ensureRemoteDocument());
          if (!targetDocumentId) {
            fail('This draft could not be saved to the server, so the assistant has nothing to work from. Check your connection and try again.');
            return;
          }

          await dispatchAction({
            selectedText,
            action,
            documentId: targetDocumentId,
            signal: controller.signal,
            language,
            onToken: (delta) => {
              if (stopped || !delta) return;
              const last = generated.lastChild;
              if (last && last.nodeType === Node.TEXT_NODE) {
                (last as Text).data += delta;
              } else {
                generated.append(document.createTextNode(delta));
              }
              schedulePersist();
            },
          });
        } catch (error) {
          if (!stopped) {
            const detail = error instanceof Error ? error.message.trim() : '';
            fail(detail ? `The rewrite failed: ${detail}` : 'The rewrite failed before it finished.');
          }
        } finally {
          wrapper.removeAttribute('data-generating');
          stopBtn.hidden = true;
          regenerateBtn.hidden = false;
        }
      };

      const replaceWith = (frag: DocumentFragment) => {
        wrapper.replaceWith(frag);
        // The wrapper is gone by now, but raw innerHTML would still bake the
        // rendered internals of any inline widget into its placeholder span.
        updateHtml(blockId, serializeEditableHtml(editable));
      };

      bindControl(acceptBtn, () => {
        stopped = true;
        abortRef.current?.abort();

        const structured = materializeCitationSuggestionForAction(
          action,
          generated.textContent ?? '',
        );
        if (structured) {
          commitMaterializedCitationSuggestion(
            blockId,
            structured,
            addParagraphChild,
            replaceWith,
          );
          return;
        }

        const frag = document.createDocumentFragment();
        if (action === 'search-for-references') {
          // Nothing readable came back. The generated nodes are plain text, so
          // appending them verbatim would put a literal `<citation … />` into
          // the author's paragraph. Losing the citations is recoverable;
          // markup in the manuscript is what the author has to clean up by
          // hand without knowing where it came from.
          const stripped = stripCitationTags(generated.textContent ?? '').trim();
          if (stripped) frag.append(document.createTextNode(stripped));
        } else {
          frag.append(...Array.from(generated.childNodes));
        }
        // Accepting an empty generation keeps the original rather than
        // silently deleting the selected text.
        if (!frag.firstChild) frag.append(...Array.from(original.childNodes));
        replaceWith(frag);
      });

      const reject = () => {
        stopped = true;
        abortRef.current?.abort();
        const frag = document.createDocumentFragment();
        frag.append(...Array.from(original.childNodes));
        replaceWith(frag);
      };

      bindControl(rejectBtn, reject);

      // The decision was mouse-only: the buttons carried no shortcut, and the
      // surrounding editable deliberately ignores keys inside `.ai-suggest`.
      wrapper.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.stopPropagation();
          acceptBtn.click();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          reject();
        }
      });

      await runStream();
    },
    [addParagraphChild, documentId, ensureRemoteDocument, findBlockId, updateHtml],
  );

  return {
    visible,
    pos,
    states,
    activeIndex,
    setActiveIndex,
    toolbarRef,
    onFormat,
    onAi,
    dismiss,
    linkHref,
    linkOpen,
    setLinkOpen,
    applyLink,
  };
}

/**
 * The link editor, opened from the toolbar's link button or `Mod+K`.
 *
 * It replaces the toolbar row rather than floating beside it: the toolbar is
 * already positioned against the selection, and a second floating surface
 * would need its own clamping against the viewport edges.
 */
function LinkEditor({
  href,
  onApply,
  onCancel,
}: {
  href: string | null;
  onApply: (href: string | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(href ?? '');

  const commit = () => {
    const trimmed = value.trim();
    onApply(trimmed ? trimmed : null);
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        type="url"
        inputMode="url"
        aria-label="Link address"
        placeholder="https://example.com"
        className="h-7 w-56 text-xs"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        // The toolbar prevents mousedown to keep the selection; the field
        // needs the pointer to reach it.
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <Button type="button" variant="ghost" size="sm" className="h-7" onClick={commit}>
        Apply
      </Button>
      {href && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-destructive"
          onClick={() => onApply(null)}
        >
          Remove
        </Button>
      )}
    </div>
  );
}

/**
 * `role="toolbar"` promises one tab stop plus arrow-key navigation. Keeping the
 * roving `tabindex` in the DOM rather than in JSX lets the AI menu's trigger —
 * which this component does not render — join the same rotation.
 */
function useRovingTabIndex(
  toolbarRef: React.RefObject<HTMLDivElement | null>,
  visible: boolean,
  activeIndex: number,
) {
  useEffect(() => {
    if (!visible) return;
    const items = toolbarRef.current?.querySelectorAll<HTMLButtonElement>('button');
    items?.forEach((item, index) => {
      item.tabIndex = index === activeIndex ? 0 : -1;
    });
  }, [toolbarRef, visible, activeIndex]);
}

export function FloatingToolbar() {
  const { loadingDocumentId } = useEditor();
  const {
    visible,
    pos,
    states,
    activeIndex,
    setActiveIndex,
    toolbarRef,
    onFormat,
    onAi,
    dismiss,
    linkHref,
    linkOpen,
    setLinkOpen,
    applyLink,
  } = useFloatingToolbar();

  useRovingTabIndex(toolbarRef, visible && !linkOpen, activeIndex);

  // `⌘K` is the binding every writing tool uses for this and the one the
  // toolbar's own tooltip advertises; it did nothing at all.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }
      event.preventDefault();
      setLinkOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, setLinkOpen]);

  const onToolbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    const items = Array.from(toolbarRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);

    let next: number | null = null;
    if (event.key === 'ArrowRight') next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = current <= 0 ? items.length - 1 : current - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next === null) return;

    event.preventDefault();
    setActiveIndex(next);
    items[next].focus();
  };

  if (!visible || Boolean(loadingDocumentId)) return null;

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Text formatting"
      onKeyDown={onToolbarKeyDown}
      className={cn(
        'floating-toolbar fixed inline-flex -translate-x-1/2 -translate-y-2 items-center gap-1 p-1',
        'rounded-lg border border-border bg-popover shadow-lg z-[var(--z-floating)]',
        'animate-in fade-in-0 zoom-in-95',
      )}
      style={{ top: pos.top, left: pos.left }}
      // Keep the text selection alive while interacting with the toolbar.
      onMouseDown={(event) => event.preventDefault()}
    >
      {linkOpen ? (
        <LinkEditor href={linkHref} onApply={applyLink} onCancel={() => setLinkOpen(false)} />
      ) : (
        <>
          {FORMAT_BUTTONS.map(({ command, stateKey, label, icon: Icon, shortcut }) => (
            <Button
              key={command}
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn('rounded-sm', states[stateKey] && 'bg-primary/15 text-primary')}
              onClick={onFormat(command)}
              aria-label={shortcut ? `${label} (${shortcut})` : label}
              aria-pressed={states[stateKey]}
              title={shortcut ? `${label} · ${shortcut}` : label}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
            </Button>
          ))}

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn('rounded-sm', linkHref && 'bg-primary/15 text-primary')}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setLinkOpen(true);
            }}
            aria-label={`${linkHref ? 'Edit link' : 'Add link'} (${modKeyLabel('K')})`}
            aria-pressed={Boolean(linkHref)}
            title={`${linkHref ? 'Edit link' : 'Add link'} · ${modKeyLabel('K')}`}
          >
            <Link2 aria-hidden="true" className="h-4 w-4" />
          </Button>

          <div role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px bg-border" />

          <AIActionMenu onAction={onAi} />
        </>
      )}
    </div>
  );
}
