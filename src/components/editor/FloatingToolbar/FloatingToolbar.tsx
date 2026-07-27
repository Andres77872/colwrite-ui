import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useEditor } from '@/editor';
import { dispatchAction } from '@/services/actionDispatcher';
import type { AiAction } from '@/config/aiActions';
import { AIActionMenu } from './AIActionMenu/AIActionMenu';
import {
  commitMaterializedCitationSuggestion,
  materializeCitationSuggestionForAction,
} from './citationTags';
import {
  clearChildPlaceholders,
  serializeEditableHtml,
} from '@/components/common/Editable/editableHtml';
import { Bold, Italic, Strikethrough, Underline } from 'lucide-react';

const TOOLBAR_HEIGHT = 44;
const VIEWPORT_MARGIN = 8;
/** Roughly the toolbar's width; used only to keep it inside the viewport. */
const ESTIMATED_WIDTH = 260;

type FormatStateKey = 'bold' | 'italic' | 'underline' | 'strike';

interface FormatButton {
  command: string;
  stateKey: FormatStateKey;
  label: string;
  icon: typeof Bold;
  shortcut?: string;
}

const FORMAT_BUTTONS: readonly FormatButton[] = [
  { command: 'bold', stateKey: 'bold', label: 'Bold', icon: Bold, shortcut: '⌘B' },
  { command: 'italic', stateKey: 'italic', label: 'Italic', icon: Italic, shortcut: '⌘I' },
  { command: 'underline', stateKey: 'underline', label: 'Underline', icon: Underline, shortcut: '⌘U' },
  { command: 'strikeThrough', stateKey: 'strike', label: 'Strikethrough', icon: Strikethrough },
];

type FormatState = Record<FormatStateKey, boolean>;

const EMPTY_STATE: FormatState = { bold: false, italic: false, underline: false, strike: false };

/**
 * The toolbar's selection tracking, formatting and AI-suggestion machinery.
 *
 * It locates the active field by walking up to an element with the `editable`
 * class. That class was never rendered, so until it was added to `Editable`
 * this toolbar could not appear at all and the AI action menu was unreachable.
 */
function useFloatingToolbar() {
  const { exec, refs, updateHtml, addParagraphChild, documentId } = useEditor();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [states, setStates] = useState<FormatState>(EMPTY_STATE);
  const [activeIndex, setActiveIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const slashOpenRef = useRef(false);
  // The last non-collapsed range inside an editable. Keeping it lets menu
  // items run from the keyboard, where opening the menu moves DOM focus away
  // from the text and a live `getSelection()` read is no longer reliable.
  const savedRangeRef = useRef<Range | null>(null);

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

  useEffect(() => {
    const onSelectionChange = () => {
      // Moving focus onto a toolbar button greys the selection out, which used
      // to dismiss the toolbar the moment a keyboard user reached it. While
      // focus is inside the toolbar the selection it acts on is `savedRangeRef`.
      if (toolbarRef.current?.contains(document.activeElement)) return;

      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed || slashOpenRef.current) {
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

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        setVisible(false);
        return;
      }

      savedRangeRef.current = range.cloneRange();

      // Keep the toolbar on screen: flip below the selection when there is no
      // room above, and clamp horizontally so it never runs off either edge.
      const preferredTop = rect.top - TOOLBAR_HEIGHT;
      const top =
        preferredTop < VIEWPORT_MARGIN ? rect.bottom + VIEWPORT_MARGIN : preferredTop;
      const half = ESTIMATED_WIDTH / 2;
      const left = Math.min(
        Math.max(rect.left + rect.width / 2, half + VIEWPORT_MARGIN),
        window.innerWidth - half - VIEWPORT_MARGIN,
      );

      setPos({ top, left });
      try {
        setStates({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          strike: document.queryCommandState('strikeThrough'),
        });
      } catch {
        setStates(EMPTY_STATE);
      }
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

  const onFormat = (command: string) => (event: React.MouseEvent | React.KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    focusSavedRange();
    exec(command);
  };

  const onAi = useCallback(
    async (action: AiAction, language?: string) => {
      const range = savedRangeRef.current;
      if (!range || range.collapsed) return;

      const { el: editable, id: blockId } = findBlockId(range.commonAncestorContainer);
      if (!editable || !blockId) return;

      const selectedText = range.toString();
      if (!selectedText.trim()) return;

      abortRef.current?.abort();

      // Structure: [original (struck through)][generated][accept/reject/stop]
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

      const controls = document.createElement('span');
      controls.className = 'ai-controls';
      controls.contentEditable = 'false';

      const makeControl = (className: string, title: string, glyph: string) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.textContent = glyph;
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

      const acceptBtn = makeControl('ai-accept', 'Accept suggestion', '✓');
      const rejectBtn = makeControl('ai-reject', 'Reject suggestion', '✕');
      const stopBtn = makeControl('ai-stop', 'Stop generating', '■');
      controls.append(acceptBtn, rejectBtn, stopBtn);

      let originalFrag: DocumentFragment;
      try {
        originalFrag = range.extractContents();
      } catch {
        originalFrag = document.createDocumentFragment();
        originalFrag.append(document.createTextNode(selectedText));
      }
      original.append(originalFrag);
      wrapper.append(original, generated, controls);
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

      const setStopMode = () => {
        stopBtn.className = 'ai-stop';
        stopBtn.title = 'Stop generating';
        stopBtn.setAttribute('aria-label', 'Stop generating');
        stopBtn.textContent = '■';
        bindControl(stopBtn, () => {
          stopped = true;
          abortRef.current?.abort();
        });
      };

      const setRegenerateMode = () => {
        stopBtn.className = 'ai-regenerate';
        stopBtn.title = 'Regenerate';
        stopBtn.setAttribute('aria-label', 'Regenerate suggestion');
        stopBtn.textContent = '↻';
        bindControl(stopBtn, () => {
          void runStream();
        });
      };

      const runStream = async () => {
        stopped = false;
        wrapper.setAttribute('data-generating', '1');
        wrapper.removeAttribute('data-error');
        generated.replaceChildren();
        setStopMode();

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          await dispatchAction({
            selectedText,
            action,
            documentId: documentId ?? '',
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
        } catch {
          if (!stopped) wrapper.setAttribute('data-error', '1');
        } finally {
          wrapper.removeAttribute('data-generating');
          setRegenerateMode();
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
        frag.append(...Array.from(generated.childNodes));
        // Accepting an empty generation keeps the original rather than
        // silently deleting the selected text.
        if (!frag.firstChild) frag.append(...Array.from(original.childNodes));
        replaceWith(frag);
      });

      bindControl(rejectBtn, () => {
        stopped = true;
        abortRef.current?.abort();
        const frag = document.createDocumentFragment();
        frag.append(...Array.from(original.childNodes));
        replaceWith(frag);
      });

      await runStream();
    },
    [addParagraphChild, documentId, findBlockId, updateHtml],
  );

  return { visible, pos, states, activeIndex, setActiveIndex, toolbarRef, onFormat, onAi };
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
  const { visible, pos, states, activeIndex, setActiveIndex, toolbarRef, onFormat, onAi } =
    useFloatingToolbar();

  useRovingTabIndex(toolbarRef, visible, activeIndex);

  const onToolbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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

  if (!visible) return null;

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
      {FORMAT_BUTTONS.map(({ command, stateKey, label, icon: Icon, shortcut }) => (
        <button
          key={command}
          type="button"
          className={cn(
            'grid h-7 w-7 place-items-center rounded-sm transition-colors hover:bg-accent',
            states[stateKey] && 'bg-primary/15 text-primary',
          )}
          onClick={onFormat(command)}
          aria-label={shortcut ? `${label} (${shortcut})` : label}
          aria-pressed={states[stateKey]}
          title={shortcut ? `${label} · ${shortcut}` : label}
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
        </button>
      ))}

      <div role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px bg-border" />

      <AIActionMenu onAction={onAi} />
    </div>
  );
}
