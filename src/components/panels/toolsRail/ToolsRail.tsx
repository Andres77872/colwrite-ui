import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { usePanels } from '../panelsContextState';
import { TOOLS } from '../toolsConfig';
import { PanelRight } from 'lucide-react';

/**
 * ToolsRail — the always-visible strip that selects which tool panel shows.
 * Rendered as a toolbar so screen readers announce it as one control group.
 */
export function ToolsRail() {
  const { activeTool, setTool, isOpen, toggle, isDesktop } = usePanels();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col items-center py-2" role="toolbar" aria-label="Tools" aria-orientation="vertical">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                'h-9 w-9 text-muted-foreground hover:bg-accent hover:text-foreground',
                isOpen && 'text-foreground',
              )}
              onClick={toggle}
              aria-label={isOpen ? 'Hide tools panel' : 'Show tools panel'}
              aria-expanded={isOpen}
            >
              <PanelRight
                aria-hidden="true"
                className={cn('h-4 w-4 transition-transform duration-200', !isOpen && 'rotate-180')}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{isOpen ? 'Hide tools panel' : 'Show tools panel'}</TooltipContent>
        </Tooltip>

        <div className="my-2 h-px w-6 bg-border/50" role="presentation" />

        <div className="flex flex-col gap-1">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            const isActive = activeTool === tool.id && isOpen;

            return (
              <Tooltip key={tool.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      'relative h-9 w-9 transition-colors duration-150',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                    // On desktop the rail toggles the panel; on mobile the panel is an
                    // overlay, so re-tapping the active tool should close it too.
                    onClick={() => setTool(isActive && isDesktop ? null : tool.id)}
                    aria-label={tool.label}
                    aria-pressed={isActive}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute -left-1 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary"
                      />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">{tool.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
