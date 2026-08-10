import { forwardRef, useCallback, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { stopEditorEvents } from './stopEditorEvents';
import { GripVertical, Settings2, Trash2 } from 'lucide-react';

/* ----------------------------------------
   Shared chrome for inline widgets

   One visual language for everything embedded in a paragraph:
   - in-flow widgets (citation, inline equation) render as an InlinePill
   - block widgets (table, figure, display equation, AI passage) render in a
     bordered shell whose controls surface on hover/focus
   - editing happens in an InlinePopover with one footer (Remove / Done)
   ---------------------------------------- */

/**
 * The in-flow trigger every text-level widget shares.
 *
 * Citation used to tint itself with a chart-series colour and Equation with
 * the block-locked amber — two borrowed tokens, two meanings of "clickable",
 * and neither matched the rest of the app, which reserves one accent for
 * interactive constructs: primary. Errors are the only other tone.
 */
export const InlinePill = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'default' | 'error' }
>(function InlinePill({ tone = 'default', className, type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center rounded-sm px-1 py-0.5 text-sm transition-colors',
        tone === 'error'
          ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
          : 'bg-primary/10 text-primary hover:bg-primary/20',
        className,
      )}
      {...props}
    />
  );
});

/**
 * The popover every widget edits through.
 *
 * Wires the three things each widget used to do by hand — and occasionally
 * forgot: stop the surrounding contenteditable from seeing popover events,
 * move focus into the panel on open (and back to the trigger on close), and
 * hand children a `close` for the Done button.
 *
 * Open-focus used to be suppressed so the document caret would not move, but
 * these triggers live in contentEditable=false islands — there is no caret to
 * preserve, and suppressing it left the portalled panel unreachable by Tab.
 *
 * `closeAndLeave` is the same close for an action that has already sent focus
 * somewhere else on purpose — a citation jumping to its reference entry. The
 * ordinary close returns focus to the trigger, which for those actions undoes
 * the navigation the moment the exit animation finishes.
 */
export function InlinePopover({
  align = 'start',
  trigger,
  contentClassName,
  children,
}: {
  align?: 'start' | 'center' | 'end';
  trigger: ReactNode;
  contentClassName?: string;
  children: (close: () => void, closeAndLeave: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // State rather than a ref: it is set in the same batch as `open`, so the
  // panel re-renders with the matching `onCloseAutoFocus` before it unmounts.
  const [restoreFocus, setRestoreFocus] = useState(true);
  const close = useCallback(() => setOpen(false), []);
  const closeAndLeave = useCallback(() => {
    setRestoreFocus(false);
    setOpen(false);
  }, []);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setRestoreFocus(true);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={contentClassName}
        // The paragraph underneath is contenteditable; without this the first
        // keystroke in a field lands in the document instead.
        // Radix's default open-focus moves to the first field; that is what
        // makes the portalled panel reachable from the keyboard, so it stays.
        onCloseAutoFocus={(event) => {
          if (!restoreFocus) event.preventDefault();
        }}
        {...stopEditorEvents}
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
    <div className="mt-3 flex justify-end gap-2 border-t border-border/60 pt-2.5">
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
 * Controls live in a header that only materialises on hover or focus. The old
 * version pinned a permanently visible strip of grey buttons above every
 * table, so a document with three tables read as a form, not as a paper.
 */
export function InlineFigureShell({
  label,
  children,
  caption,
  controls,
  onRemove,
  className,
}: {
  label: string;
  children: ReactNode;
  caption?: ReactNode;
  controls?: ReactNode;
  onRemove: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-figure group/figure relative my-3 block', className)}
      role="group"
      aria-label={label}
      contentEditable={false}
      {...stopEditorEvents}
    >
      <span className="block overflow-hidden rounded-lg border border-border bg-card transition-colors focus-within:border-primary/50 group-hover/figure:border-border/80">
        <span
          className={cn(
            'flex items-center gap-1 border-b border-border/60 bg-muted/40 px-2 py-1',
            'opacity-0 transition-opacity group-hover/figure:opacity-100 group-focus-within/figure:opacity-100',
          )}
        >
          <GripVertical aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className="ml-auto flex items-center gap-0.5">
            {controls}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${label.toLowerCase()}`}
              title={`Remove ${label.toLowerCase()}`}
              onClick={onRemove}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </span>
        </span>

        <span className="block">{children}</span>

        {caption}
      </span>
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
  triggerClassName,
}: {
  label: string;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  triggerClassName?: string;
}) {
  return (
    <InlinePopover
      align={align}
      contentClassName="w-80 p-3"
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn('text-muted-foreground hover:text-foreground', triggerClassName)}
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

const SETTINGS_CAPTION =
  'mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground';

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
