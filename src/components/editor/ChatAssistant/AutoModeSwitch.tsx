import { useId } from 'react';
import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AutoBlockedReason } from '@/editor/types';
import { autoStripMessage } from './useAutoMode';

/**
 * The composer's Auto toggle (D18, 14 §3.7). Off, it asks first: pressing it
 * opens the warning (`onRequestOn`), and only Turn on Auto there turns it on.
 * On, it is amber with a filled dot and reads "Auto on", so the state is not
 * carried by colour alone; pressing it turns Auto off at once. A switch
 * reached by Tab, with no single-key shortcut.
 */
export function AutoModeSwitch({
  on,
  unavailable = null,
  onRequestOn,
  onTurnOff,
}: {
  on: boolean;
  /**
   * Why Auto cannot be used here, known before sending, so the switch says
   * so in advance: the workspace's policy switched it off, or the account is
   * a viewer (D18).
   */
  unavailable?: 'policy' | 'role' | null;
  onRequestOn: () => void;
  onTurnOff: () => void;
}) {
  const reasonId = useId();
  if (unavailable) {
    // A disabled button gets no pointer events: the tooltip hangs off a
    // wrapper, and the same reason is the switch's description.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={false}
              disabled
              aria-describedby={reasonId}
              className="inline-flex h-7 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground opacity-50"
            >
              <span aria-hidden="true" className="size-2 rounded-full border border-current" />
              Auto
            </button>
            <span id={reasonId} className="sr-only">{autoStripMessage(unavailable)}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{autoStripMessage(unavailable)}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => (on ? onTurnOff() : onRequestOn())}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium outline-none transition-colors duration-120 focus-visible:ring-2 focus-visible:ring-ring',
            on
              ? 'bg-warning/15 text-warning hover:bg-warning/25'
              : 'text-muted-foreground hover:bg-hover hover:text-foreground',
          )}
        >
          <span
            aria-hidden="true"
            className={cn('size-2 rounded-full border border-current', on && 'bg-current')}
          />
          Auto
          {on && <span aria-hidden="true">on</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {on ? 'Turn off Auto' : "Apply the assistant's edits without asking"}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The strip above the input while Auto is on: what it does, or why the
 * server paused it for this message, and Turn off.
 */
export function AutoModeStrip({
  blocked,
  onTurnOff,
}: {
  blocked: AutoBlockedReason | null;
  onTurnOff: () => void;
}) {
  return (
    <div
      role="status"
      className="mx-2 mt-2 flex items-center gap-2 rounded-md bg-warning/10 py-1 pl-2 pr-1 text-xs text-warning"
    >
      <Zap aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{autoStripMessage(blocked)}</span>
      <button
        type="button"
        onClick={onTurnOff}
        className="inline-flex h-6 shrink-0 items-center rounded px-1.5 font-medium outline-none transition-colors hover:bg-warning/15 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Turn off
      </button>
    </div>
  );
}
