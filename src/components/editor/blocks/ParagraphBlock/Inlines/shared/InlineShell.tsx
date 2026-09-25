import { forwardRef, useCallback, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { stopEditorEvents } from './stopEditorEvents';
import { placeCaretAfterWidget } from './caretAfterWidget';
import { Settings2, Trash2 } from 'lucide-react';

/* ----------------------------------------
   Shared chrome for inline widgets

   One visual language for everything embedded in a paragraph:
   - in-flow widgets (citation, inline equation) render as an InlineTrigger
   - block widgets (table, figure) render as a bare figure whose controls
     float in on hover/focus
   - editing happens in an InlinePopover with one footer (Remove / Done)
   ---------------------------------------- */

/**
 * The in-flow trigger every text-level widget shares.
 *
 * Both looks read as part of the sentence rather than as buttons sitting in
 * it: no fill at rest, the text's own size. A citation is a bracketed
 * reference in the link colour that underlines on hover — grey read as
 * disabled — and previews its source in a hover card; maths is set in
 * the text colour and only shows it is editable on hover. Errors are the one
 * state that keeps a fill, because they need fixing.
 */
export const InlineTrigger = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { look: 'citation' | 'math'; tone?: 'default' | 'error' }
>(function InlineTrigger({ look, tone = 'default', className, type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline rounded-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        tone === 'error'
          ? 'bg-destructive/15 px-0.5 text-destructive hover:bg-destructive/25'
          : look === 'citation'
            ? 'px-px text-[0.9em] text-link underline-offset-[3px] decoration-current/40 hover:underline'
            : 'px-0.5 text-foreground hover:bg-hover',
        className,
      )}
      {...props}
    />
  );
});

const TABBABLE_IN_PANEL =
  'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * How the panel was dismissed, which decides where focus goes next.
 * - `caret`: Done, Enter, Esc, or clicking the chip again → back into the
 *   text, right after the widget.
 * - `trigger`: Tab past the last field or Shift+Tab before the first → the
 *   chip, so keyboard traversal continues from where the panel sits.
 * - `leave`: an action that already moved focus on purpose.
 * - `outside`: a click or focus elsewhere; that target keeps focus.
 */
type CloseIntent = 'caret' | 'trigger' | 'leave' | 'outside';

/**
 * The popover every widget edits through.
 *
 * Wires the things each widget used to do by hand — and occasionally forgot:
 * stop the surrounding contenteditable from seeing popover events, move focus
 * into the panel on open, send it somewhere sensible on close, and hand
 * children a `close` for the Done button.
 *
 * Open-focus used to be suppressed so the document caret would not move, but
 * these triggers live in contentEditable=false islands — there is no caret to
 * preserve, and suppressing it left the portalled panel unreachable by Tab.
 *
 * Closing with Done, Enter or Esc puts the caret back in the text just after
 * the widget. Returning focus to the chip instead left a focus ring on it and
 * swallowed the next keystroke. Only Tab/Shift+Tab off the panel's edge goes
 * back to the chip, because that is keyboard navigation, not writing.
 *
 * `closeAndLeave` is the same close for an action that has already sent focus
 * somewhere else on purpose — a citation jumping to its reference entry.
 */
export function InlinePopover({
  align = 'start',
  trigger,
  contentClassName,
  children,
  onOpenChange,
  returnFocus = 'caret',
}: {
  align?: 'start' | 'center' | 'end';
  trigger: ReactNode;
  contentClassName?: string;
  children: (close: () => void, closeAndLeave: () => void) => ReactNode;
  /** Told whenever the panel opens or closes (a hover card steps aside). */
  onOpenChange?: (open: boolean) => void;
  /**
   * Where Done/Enter/Esc send focus. `caret` (in-flow chips) returns to the
   * text after the widget; `trigger` (a button in a figure's toolbar)
   * returns to the button, as a menu would.
   */
  returnFocus?: 'caret' | 'trigger';
}) {
  const [open, setOpenState] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // State rather than a ref: it is set in the same batch as `open`, so the
  // panel re-renders with the matching `onCloseAutoFocus` before it unmounts.
  const [intent, setIntent] = useState<CloseIntent>('caret');
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const closeWith = useCallback(
    (next: CloseIntent) => {
      setIntent(next);
      setOpen(false);
    },
    [setOpen],
  );
  const close = useCallback(() => closeWith('caret'), [closeWith]);
  const closeAndLeave = useCallback(() => closeWith('leave'), [closeWith]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Radix reports Esc, outside interaction and the chip's own toggle
        // here; the handlers below have already recorded which it was.
        if (next) setIntent('caret');
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild ref={triggerRef}>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={contentClassName}
        // Radix's default open-focus moves to the first field; that is what
        // makes the portalled panel reachable from the keyboard, so it stays.
        onEscapeKeyDown={() => setIntent('caret')}
        onInteractOutside={(event) => {
          const target = event.target as Node | null;
          // A click on the chip is Radix's toggle, not an outside click.
          if (target && triggerRef.current?.contains(target)) return;
          setIntent('outside');
        }}
        onCloseAutoFocus={(event) => {
          if (intent === 'trigger' || (intent === 'caret' && returnFocus === 'trigger')) return; // Radix focuses the trigger.
          event.preventDefault();
          if (intent !== 'caret') return;
          if (!placeCaretAfterWidget(triggerRef.current)) {
            triggerRef.current?.focus({ preventScroll: true });
          }
        }}
        {...stopEditorEvents}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key !== 'Tab' || event.defaultPrevented) return;
          const fields = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE_IN_PANEL),
          ).filter((el) => el.offsetParent !== null || el === document.activeElement);
          if (fields.length === 0) return;
          const edge = event.shiftKey ? fields[0] : fields[fields.length - 1];
          if (document.activeElement !== edge) return;
          // Off the panel's edge: the portal sits at the end of <body>, so
          // the browser would carry focus out of the page. Close and continue
          // from the chip instead.
          event.preventDefault();
          closeWith('trigger');
        }}
      >
        {children(close, closeAndLeave)}
      </PopoverContent>
    </Popover>
  );
}

/** The one popover footer — destructive action left of the safe close. */
export function SettingsFooter({
  onRemove,
  onDone,
  removeLabel = 'Remove',
}: {
  onRemove: () => void;
  onDone: () => void;
  removeLabel?: string;
}) {
  return (
    <div className="mt-3 flex justify-end gap-2 border-t border-border pt-2.5">
      <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>
        {removeLabel}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

/** A labelled Checkbox row inside a settings popover. */
export function SettingsCheck({
  id,
  label,
  checked,
  disabled,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn('flex items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-50')}
      title={hint}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {label}
    </label>
  );
}

/* ----------------------------------------
   Block-level widgets (table, figure)
   ---------------------------------------- */

/**
 * Block-level frame for the widgets that occupy their own line — tables and
 * figures.
 *
 * At rest there is no frame at all: the table's own hairlines or the chart,
 * and its caption beneath, the way a figure sits in a paper. Everything that
 * edits it — the kind label, settings, remove — is a small floating toolbar
 * just above the figure's top-right corner that appears on hover or keyboard
 * focus and takes no space, so nothing reserves an empty band.
 */
export function InlineFigureShell({
  label,
  children,
  caption,
  controls,
  onRemove,
  className,
  captionClassName,
}: {
  label: string;
  children: ReactNode;
  caption?: ReactNode;
  controls?: ReactNode;
  onRemove: () => void;
  className?: string;
  captionClassName?: string;
}) {
  return (
    <span
      className={cn(
        'inline-figure group/figure relative my-4 block',
        // A block that opens with the figure has no empty band above it, so
        // the block handle sits beside the figure's top edge.
        '[[data-leading-figure]>[data-child-id]:first-child>&]:mt-1',
        className,
      )}
      role="group"
      aria-label={label}
      contentEditable={false}
      {...stopEditorEvents}
    >
      <span
        className={cn(
          // Above the figure, never over it: sitting on the corner it hid
          // the top-right cells of a table while they were being edited.
          'absolute bottom-full right-0 z-[var(--z-base)] mb-1 flex items-center gap-0.5 rounded-md bg-popover p-0.5 text-sm shadow-md',
          'opacity-0 transition-opacity duration-150 group-hover/figure:opacity-100 group-focus-within/figure:opacity-100',
          // Never unreachable by keyboard: focus inside brings it back, but an
          // invisible button must not be clickable in the meantime.
          'pointer-events-none group-hover/figure:pointer-events-auto group-focus-within/figure:pointer-events-auto',
        )}
      >
        <span className="px-1.5 text-xs font-medium text-muted-foreground">{label}</span>
        {controls}
        <Button
          type="button"
          variant="icon"
          size="icon-xs"
          className="hover:text-destructive"
          aria-label={`Remove ${label.toLowerCase()}`}
          title={`Remove ${label.toLowerCase()}`}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </span>

      <span className="block">{children}</span>

      {caption && (
        <span className={cn('mt-2 block text-center text-sm text-muted-foreground', captionClassName)}>{caption}</span>
      )}
    </span>
  );
}

/**
 * Settings popover for a block-level widget, opened from the shell header.
 *
 * Radix portals this out of the paragraph, which is what fixes the long-
 * standing clipping: the hand-rolled `absolute` panels were children of an
 * `overflow-x-auto` table wrapper and a scrolling canvas, so a settings panel
 * near the right or bottom edge was simply cut off.
 */
export function InlineSettings({
  label,
  children,
  align = 'start',
}: {
  label: string;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <InlinePopover
      align={align}
      contentClassName="w-80 p-3"
      returnFocus="trigger"
      trigger={
        <Button
          type="button"
          variant="icon"
          size="icon-xs"
          aria-label={label}
          title={label}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      }
    >
      {() => children}
    </InlinePopover>
  );
}

const SETTINGS_CAPTION = 'mb-1 block text-xs font-medium text-muted-foreground';

/**
 * A labelled row inside a settings popover.
 *
 * With `htmlFor` the caption is a genuine `<label>` for one control. Without it
 * the row groups several controls — or none — and the caption becomes a group
 * name instead. It used to render `<label htmlFor={undefined}>` as a *sibling*
 * of the children either way, which associates with nothing: most rows here
 * ended up with a caption that assistive tech never tied to anything.
 */
export function SettingsRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  const captionId = useId();
  const hintNode = hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null;

  if (htmlFor) {
    return (
      <div className="mb-2 last:mb-0">
        <label htmlFor={htmlFor} className={SETTINGS_CAPTION}>
          {label}
        </label>
        {children}
        {hintNode}
      </div>
    );
  }

  return (
    <div role="group" aria-labelledby={captionId} className="mb-2 last:mb-0">
      <span id={captionId} className={SETTINGS_CAPTION}>
        {label}
      </span>
      {children}
      {hintNode}
    </div>
  );
}
