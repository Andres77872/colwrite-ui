import { useEffect, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyToClipboard, type ClipboardContent } from '@/lib/clipboard';
import { modifierLabel } from '@/components/layout/Shortcuts/shortcuts';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Hidden until the turn is hovered or holds focus, and always shown on
 * screens with no hover to reveal it. The element brings its own transition.
 */
export const REVEAL_ON_HOVER =
  'opacity-0 focus-within:opacity-100 group-hover/message:opacity-100 [@media(hover:none)]:opacity-100';

/** A quiet icon button under a turn, named for screen readers and in a tooltip. */
export function ActionButton({
  label,
  tooltip,
  onClick,
  children,
}: {
  label: string;
  tooltip?: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-120 hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Copy, confirmed by a check that lasts long enough to see and by a polite
 * announcement (the button keeps its name, which a screen reader would not
 * reliably re-read). A copy the browser refuses says so beside the button,
 * with the way that always works: select the text and copy it.
 */
export function CopyButton({
  label,
  read,
  className,
}: {
  label: string;
  /** What to copy, read at the moment of the click. */
  read: () => ClipboardContent;
  className?: string;
}) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), state === 'copied' ? 1600 : 6000);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    setState((await copyToClipboard(read())) ? 'copied' : 'failed');
  };

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <ActionButton label={label} tooltip={state === 'copied' ? 'Copied' : label} onClick={() => void copy()}>
        {state === 'copied' ? (
          <Check aria-hidden="true" className="h-4 w-4 text-success" />
        ) : (
          <Copy aria-hidden="true" className="h-4 w-4" />
        )}
      </ActionButton>
      {/* Always in the page, so the announcement is heard when it fills. */}
      <span role="status" className={state === 'failed' ? 'text-xs text-muted-foreground' : 'sr-only'}>
        {state === 'copied'
          ? 'Copied'
          : state === 'failed'
            ? `Couldn’t copy. Select the text and press ${modifierLabel()}+C.`
            : ''}
      </span>
    </span>
  );
}
