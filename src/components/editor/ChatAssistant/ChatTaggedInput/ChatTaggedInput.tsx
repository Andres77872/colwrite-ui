import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { cn } from '@/lib/utils';
import { parseRefParts, type RefPart } from './refParts';
import {
  indexOfSelection,
  positionOfIndex,
  renderInto,
  spliceText,
  textOf,
} from './domText';

type SelectionRange = { start: number; end: number };

export type ChatTaggedInputHandle = {
  focus: () => void;
  getHost: () => HTMLDivElement | null;
  setSelectionRange: (start: number, end: number) => void;
  getSelectionRange: () => SelectionRange | null;
};

type ChatTaggedInputProps = {
  value: string;
  onChange: (next: string) => void;
  /** Enter — the message is ready to go. */
  onSubmit?: () => void;
  /** Clipboard image files go through the composer's attachment upload flow. */
  onPasteImages?: (files: File[]) => void;
  placeholder?: string;
  disabled?: boolean;
  onTriggerPicker?: (anchorIndex: number) => void;
  onEditRef?: (start: number, refText: string) => void;
  onRemoveRef?: (start: number, refText: string) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** What a reference chip says. Defaults to its kind and a shortened id. */
  labelForRef?: (part: RefPart) => string;
  /**
   * Whether the reference picker owns the keyboard right now. Enter belongs to
   * the highlighted option then, not to the message.
   */
  isPickerOpen?: () => boolean;
  maxLength?: number;
  className?: string;
  'aria-describedby'?: string;
};

function shorten(id: string, max = 10): string {
  if (!id) return '';
  if (id.length <= max) return id;
  return id.slice(0, Math.ceil(max / 2)) + '…' + id.slice(-Math.floor(max / 2));
}

/**
 * ChatTaggedInput — the message composer.
 *
 * A `contenteditable` rather than a `textarea` because a `#doc/…` reference is
 * shown as a chip the caret steps over in one press, which no plain text field
 * can do. Everything else about it behaves like a text field: Enter sends,
 * Shift+Enter opens a line, and the value is a string.
 */
export const ChatTaggedInput = forwardRef<ChatTaggedInputHandle, ChatTaggedInputProps>(
  function ChatTaggedInput(
    {
      value,
      onChange,
      onSubmit,
      onPasteImages,
      placeholder,
      disabled,
      onTriggerPicker,
      onEditRef,
      onRemoveRef,
      onKeyDown,
      labelForRef,
      isPickerOpen,
      maxLength = 2000,
      className,
      'aria-describedby': describedBy,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const pendingCaretRef = useRef<SelectionRange | null>(null);
    // What the DOM was last rendered from. Typing already produces the right
    // DOM, so re-rendering it would only fight the caret.
    const renderedRef = useRef<string | null>(null);
    // An IME candidate window is open: the DOM is mid-edit and Enter belongs
    // to the candidate list, not to us.
    const composingRef = useRef(false);

    const [empty, setEmpty] = useState(!value);

    const getCaretRange = useCallback((): SelectionRange | null => {
      const root = hostRef.current;
      if (!root) return null;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return null;

      const range = selection.getRangeAt(0);
      const start = indexOfSelection(root, range.startContainer, range.startOffset);
      if (start === null) return null;
      const end = range.collapsed
        ? start
        : indexOfSelection(root, range.endContainer, range.endOffset) ?? start;
      return { start: Math.min(start, end), end: Math.max(start, end) };
    }, []);

    const setCaretRange = useCallback((start: number, end: number = start) => {
      const root = hostRef.current;
      if (!root) return;
      const selection = window.getSelection();
      if (!selection) return;

      try {
        const from = positionOfIndex(root, start);
        const to = end === start ? from : positionOfIndex(root, end);
        const range = document.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        /* caret restore is best-effort */
      }
    }, []);

    /** Move the caret once the render that makes the position meaningful lands. */
    const caretTo = useCallback(
      (start: number, end: number = start) => {
        pendingCaretRef.current = { start, end };
        requestAnimationFrame(() => {
          const caret = pendingCaretRef.current;
          if (!caret) return;
          pendingCaretRef.current = null;
          setCaretRange(caret.start, caret.end);
        });
      },
      [setCaretRange],
    );

    /** Replace the current selection with `text`, respecting the limit. */
    const insertText = useCallback(
      (text: string) => {
        const selection = getCaretRange() ?? { start: value.length, end: value.length };
        const next = spliceText(value, selection, text, maxLength);
        onChange(next.value);
        caretTo(next.caret);
      },
      [caretTo, getCaretRange, maxLength, onChange, value],
    );

    const handleInput = useCallback(() => {
      const root = hostRef.current;
      if (!root || composingRef.current) return;

      const text = textOf(root);
      const caret = getCaretRange();

      if (text.length > maxLength) {
        // Refuse the overflow rather than letting the DOM and the model
        // disagree about what will be sent.
        const kept = text.slice(0, maxLength);
        renderedRef.current = null;
        onChange(kept);
        caretTo(Math.min(caret?.start ?? kept.length, kept.length));
        return;
      }

      // The DOM is already showing exactly this, so leave it alone: rebuilding
      // it here is what used to make the caret jump on every keystroke.
      renderedRef.current = text;
      onChange(text);
      setEmpty(text.length === 0);

      // A '#' that was just typed opens the picker. Only on the edit that
      // wrote it: this used to run on every keyup, so the arrow keys and Enter
      // meant for the open picker reopened it at its root instead.
      if (caret && text.length === value.length + 1 && text[caret.start - 1] === '#') {
        onTriggerPicker?.(caret.start - 1);
      }
    }, [caretTo, getCaretRange, maxLength, onChange, onTriggerPicker, value]);

    const handleKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;

        // `keyCode === 229` is the pre-composition event some IMEs still send.
        const composing = composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229;

        if (event.key === 'Enter') {
          if (composing || isPickerOpen?.()) return;
          if (event.shiftKey) {
            // Own the line break instead of letting the browser choose between
            // a `<br>`, a `<div>` and a `<p>` — the model is a string.
            event.preventDefault();
            insertText('\n');
            return;
          }
          event.preventDefault();
          onSubmit?.();
          return;
        }

        // A chip is one thing; Backspace beside it removes all of it, rather
        // than leaving `#doc/abc123/blo` behind as ordinary text.
        if (event.key === 'Backspace' && !composing) {
          const caret = getCaretRange();
          if (!caret || caret.start !== caret.end || caret.start === 0) return;
          const chip = parseRefParts(value).find(
            (part) => typeof part !== 'string' && part.end === caret.start,
          );
          if (typeof chip === 'string' || !chip) return;
          event.preventDefault();
          onChange(value.slice(0, chip.start) + value.slice(chip.end));
          onRemoveRef?.(chip.start, chip.refText);
          caretTo(chip.start);
        }
      },
      [caretTo, getCaretRange, insertText, isPickerOpen, onChange, onKeyDown, onRemoveRef, onSubmit, value],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => hostRef.current?.focus(),
        getHost: () => hostRef.current,
        setSelectionRange: caretTo,
        getSelectionRange: getCaretRange,
      }),
      [caretTo, getCaretRange],
    );

    // Render the model into the host whenever the two have diverged — a chip
    // was inserted, a message was sent, a conversation was loaded.
    useEffect(() => {
      const root = hostRef.current;
      if (!root) return;
      setEmpty(value.length === 0);
      if (renderedRef.current === value || composingRef.current) return;

      const nodes = parseRefParts(value).map((part) => {
        if (typeof part === 'string') return part;

        const chip = document.createElement('span');
        chip.className = cn('ref-chip', part.kind === 'document' ? 'ref-chip--doc' : 'ref-chip--block');
        chip.setAttribute('contenteditable', 'false');
        chip.dataset.refText = part.refText;
        chip.dataset.start = String(part.start);
        chip.title =
          part.kind === 'document' ? `Document ${part.docId}` : `Block ${part.blockId ?? ''}`;

        const label = document.createElement('span');
        label.className = 'ref-chip-label';
        label.textContent = labelForRef
          ? labelForRef(part)
          : part.kind === 'document'
            ? `Doc ${shorten(part.docId ?? '')}`
            : `Block ${shorten(part.blockId ?? '')}`;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ref-chip-remove';
        remove.tabIndex = -1;
        remove.setAttribute('aria-label', `Remove reference ${part.refText}`);
        remove.textContent = '×';
        remove.addEventListener('mousedown', (event) => event.preventDefault());
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          onChange(value.slice(0, part.start) + value.slice(part.end));
          onRemoveRef?.(part.start, part.refText);
          caretTo(part.start);
        });

        chip.addEventListener('mousedown', (event) => event.preventDefault());
        chip.addEventListener('click', () => onEditRef?.(part.start, part.refText));
        chip.append(label, remove);
        return chip;
      });

      renderInto(root, nodes);
      renderedRef.current = value;

      // Only steer the caret when something asked for it. Stealing it on every
      // sync would drag focus into the composer from wherever the author is.
      const caret = pendingCaretRef.current;
      if (caret) {
        pendingCaretRef.current = null;
        setCaretRange(caret.start, caret.end);
      }
    }, [caretTo, labelForRef, onChange, onEditRef, onRemoveRef, setCaretRange, value]);

    return (
      <div
        ref={hostRef}
        className={cn(
          'chat-composer-input max-h-[12rem] min-h-[2.75rem] w-full overflow-y-auto whitespace-pre-wrap break-words',
          'px-3 py-1.5 text-[14.5px] leading-[1.6] outline-none',
          'text-foreground caret-primary',
          disabled && 'pointer-events-none opacity-60',
          className,
        )}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        // `role="textbox"` already announces "edit"; the placeholder alone is
        // the accessible name.
        aria-label={placeholder || 'Message'}
        aria-describedby={describedBy}
        data-placeholder={placeholder ?? ''}
        data-empty={empty || undefined}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          handleInput();
        }}
        onPaste={(event) => {
          event.preventDefault();
          if (disabled) return;
          const clipboard = event.clipboardData;
          // Prefer items: browsers can expose the same image in both lists.
          const images = Array.from(clipboard.items ?? [])
            .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null);
          const files = images.length ? images : Array.from(clipboard.files ?? [])
            .filter((file) => file.type.startsWith('image/'));
          if (files.length) onPasteImages?.(files);
          // Keep any accompanying text, but never paste HTML into the editor.
          // Image-only pastes must not delete the current text selection.
          const text = clipboard.getData('text/plain');
          if (text) insertText(text);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const text = event.dataTransfer?.getData('text/plain');
          if (text) insertText(text);
        }}
      />
    );
  },
);
