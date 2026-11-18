import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type ComposerWeb = { on: boolean; onChange: (on: boolean) => void };

/** Offered only when the catalog permits Web; never changes the account switch. */
export function WebSwitch({ web, disabled }: { web: ComposerWeb; disabled: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="switch"
          aria-label="Web search"
          aria-checked={web.on}
          disabled={disabled}
          onClick={() => web.onChange(!web.on)}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            web.on ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
          )}
        >
          <Globe aria-hidden="true" className="h-3 w-3" />
          Web <span aria-hidden="true">{web.on ? 'on' : 'off'}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>Allow the assistant to search and read public web pages. Paper search has its own setting.</TooltipContent>
    </Tooltip>
  );
}
