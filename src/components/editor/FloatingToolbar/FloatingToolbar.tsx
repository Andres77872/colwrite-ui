import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useEditor } from '@/editor';
import { dispatchAction } from '@/services/actionDispatcher';
import type { AiAction } from '@/config/aiActions';
import { AIActionMenu } from './AIActionMenu/AIActionMenu';
import {
  clearChildPlaceholders,
  serializeEditableHtml,
} from '@/components/common/Editable/Editable';
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
 * FloatingToolbar — appears over a text selection with formatting and AI actions.
 *
 * It locates the active field by walking up to an element with the `editable`
 * class. That class was never rendered, so until it was added to `Editable`
 * this toolbar could not appear at all and the AI action menu was unreachable.
 */
export function FloatingToolbar() {
  const { exec, refs, updateHtml, documentId } = useEditor();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [states, setStates] = useState<FormatState>(EMPTY_STATE);
  const abortRef = useRef<AbortController | null>(null);
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

  const onFormat = (command: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    exec(command);
  };

  const findBlockId = (node: Node | null): { el: HTMLDivElement | null; id: string | null } => {
    let current: Node | null = node;
    while (current) {
      if (current instanceof HTMLElement && current.classList.contains('editable')) break;
      current = current.parentNode;
    }
    const el = (current as HTMLDivElement | null) ?? null;
    if (!el) return { el: null, id: null };
    const entry = Object.entries(refs.current || {}).find(([, dom]) => dom === el);
    return { el, id: entry?.[0] ?? null };
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
        stopBtn.onmousedown = (event) => {
          event.preventDefault();
          event.stopPropagation();
          stopped = true;
          abortRef.current?.abort();
        };
      };

      const setRegenerateMode = () => {
        stopBtn.className = 'ai-regenerate';
        stopBtn.title = 'Regenerate';
        stopBtn.setAttribute('aria-label', 'Regenerate suggestion');
        stopBtn.textContent = '↻';
        stopBtn.onmousedown = (event) => {
          event.preventDefault();
          event.stopPropagation();
          void runStream();
        };
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

      acceptBtn.onmousedown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        stopped = true;
        abortRef.current?.abort();
        const frag = document.createDocumentFragment();
        frag.append(...Array.from(generated.childNodes));
        // Accepting an empty generation keeps the original rather than
        // silently deleting the selected text.
        if (!frag.firstChild) frag.append(...Array.from(original.childNodes));
        replaceWith(frag);
      };

      rejectBtn.onmousedown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        stopped = true;
        abortRef.current?.abort();
        const frag = document.createDocumentFragment();
        frag.append(...Array.from(original.childNodes));
        replaceWith(frag);
      };

      await runStream();
    },
    [documentId, refs, updateHtml],
  );

  if (!visible) return null;

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
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
          onMouseDown={onFormat(command)}
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
