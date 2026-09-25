import { useCallback, useId, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { ArrowUp, FileClock, FileText, Hash, Square, TextSelect, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEditor } from '@/editor';
import { refLabel } from './ChatRefTags/refTags';
import type { RefPart } from './ChatTaggedInput/refParts';
import { ChatRefPicker, type ChatRefPickerHandle } from './ChatRefPicker';
import { ChatTaggedInput, type ChatTaggedInputHandle } from './ChatTaggedInput';
import { EngineSwitcher } from './EngineSwitcher';

/** The composer refuses more than this, and warns as it approaches. */
export const MAX_MESSAGE_LENGTH = 2000;

export type ComposerAttachment = {
  attached: boolean;
  /** "Doc title", or "Not saved yet" for a draft. */
  label: string;
  /** The sentence that says which document every edit goes to. */
  hint: string;
};

/**
 * Where the author writes to the assistant.
 *
 * Context sits above the text as chips — the page the conversation acts on,
 * and the selection that goes along unless it is removed — so what is sent is
 * visible before it is sent. The row below holds the reference picker on the
 * left and one round send button (a square stop while a reply runs) on the
 * right. Keyboard hints live in tooltips and in the field's description, not
 * in a line of small print.
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming,
  attachment,
  selection,
  onDismissSelection,
  inputRef,
  pickerRef,
}: {
  value: string;
  onChange: Dispatch<SetStateAction<string>>;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  attachment: ComposerAttachment;
  selection: string | null;
  onDismissSelection: () => void;
  inputRef: RefObject<ChatTaggedInputHandle | null>;
  pickerRef: RefObject<ChatRefPickerHandle | null>;
}) {
  const hintId = useId();
  const { blocks } = useEditor();
  const labelForRef = useCallback((part: RefPart) => refLabel(part, blocks), [blocks]);
  const overLimit = value.length > MAX_MESSAGE_LENGTH;
  const nearLimit = value.length > MAX_MESSAGE_LENGTH * 0.8;

  /** Start a reference from the button: a `#` at the end, and the picker. */
  const startReference = () => {
    const needsSpace = value.length > 0 && !/\s$/.test(value);
    const next = `${value}${needsSpace ? ' ' : ''}#`;
    onChange(next);
    pickerRef.current?.openAt(next.length - 1);
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(next.length, next.length);
  };

  return (
    <div
      className={cn(
        'relative rounded-xl bg-background shadow-xs ring-1 ring-inset ring-border-strong transition-shadow duration-120',
        'focus-within:ring-primary/60',
        overLimit && 'ring-destructive focus-within:ring-destructive',
      )}
    >
      {/* One row: the page chip gives way to a selection rather than pushing
          it onto a second line and making the composer taller. */}
      <div className="flex min-w-0 items-center gap-1 px-2 pt-2">
        {/* The page the conversation acts on. Not removable: it is where the
            chat is kept, not an option on this message. */}
        <span
          title={attachment.hint}
          className={cn(
            'inline-flex h-6 min-w-0 items-center gap-1 rounded-md bg-subtle px-1.5 text-xs text-muted-foreground',
            selection ? 'max-w-[36%] flex-none' : 'max-w-full',
          )}
        >
          {attachment.attached ? (
            <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <FileClock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">{attachment.label}</span>
        </span>

        {selection && (
          <span
            className="inline-flex h-6 min-w-0 shrink items-center gap-1 rounded-md bg-selection/60 pl-1.5 pr-0.5 text-xs text-foreground"
            title={selection}
          >
            <TextSelect aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 font-medium">Selection</span>
            <span className="min-w-0 truncate text-muted-foreground">“{selection}”</span>
            <button
              type="button"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Don't send the selection with this message"
              onClick={onDismissSelection}
            >
              <X aria-hidden="true" className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>

      <ChatTaggedInput
        ref={inputRef}
        value={value}
        onChange={onChange}
        onSubmit={onSend}
        placeholder="Ask AI anything… # to reference a block"
        aria-describedby={hintId}
        onTriggerPicker={(anchor) => pickerRef.current?.openAt(anchor)}
        onEditRef={(start) => pickerRef.current?.openAt(start, { editing: true })}
        onRemoveRef={() => pickerRef.current?.close()}
        isPickerOpen={() => pickerRef.current?.isOpen() ?? false}
        maxLength={MAX_MESSAGE_LENGTH}
        labelForRef={labelForRef}
      />
      <p id={hintId} className="sr-only">
        Enter sends. Shift+Enter starts a new line. Type # to reference a block or another document.
      </p>

      <div className="flex items-center gap-1 px-2 pb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={startReference}
              aria-label="Reference a block or document"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-120 hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Hash aria-hidden="true" className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Reference a block or document · #</TooltipContent>
        </Tooltip>

        {/* Local servers only: which engine answers (gateway, Claude Code,
            Codex). Locked while a reply runs; it applies to the next one. */}
        <EngineSwitcher disabled={isStreaming} />

        <span className="flex-1" />

        {nearLimit && (
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              overLimit ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {value.length}/{MAX_MESSAGE_LENGTH}
          </span>
        )}

        {isStreaming ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <Square aria-hidden="true" className="h-3 w-3 fill-current" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Stop · Esc</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onSend}
                disabled={!value.trim() || overLimit}
                aria-label="Send message"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary-strong text-primary-foreground outline-none transition-colors hover:bg-primary-strong/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:bg-active disabled:text-placeholder"
              >
                <ArrowUp aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Send · Enter</TooltipContent>
          </Tooltip>
        )}
      </div>

      <ChatRefPicker
        ref={pickerRef}
        getHost={() => inputRef.current?.getHost() ?? null}
        input={value}
        setInput={onChange}
        setCaretIndex={(index) => inputRef.current?.setSelectionRange(index, index)}
      />
    </div>
  );
}
