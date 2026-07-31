import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePanels } from '../panelsContextState';
import { toolsForEnabledSources } from '../toolsConfig';
import { useAgentTools } from '@/components/preferences';
import { PanelRight } from 'lucide-react';

/**
 * ToolsRail — the always-visible strip that selects which tool panel shows.
 *
 * Rendered as a toolbar so screen readers announce it as one control group,
 * which also obliges it to behave like one: a single tab stop with arrow-key
 * navigation between the controls. It previously declared `role="toolbar"`
 * while leaving every button its own tab stop and arrows inert, so the
 * announced pattern and the actual keyboard behaviour disagreed. That arrow
 * navigation is also why switching tools needs no numeric shortcut.
 */
export function ToolsRail() {
  const { activeTool, setTool, isOpen, toggle, isDesktop } = usePanels();
  const { isSourceEnabled } = useAgentTools();
  const tools = useMemo(
    () => toolsForEnabledSources(isSourceEnabled),
    [isSourceEnabled],
  );

  // The toggle occupies slot 0; enabled tools follow in registry order.
  const count = tools.length + 1;
  const [focusIndex, setFocusIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const effectiveFocusIndex = Math.min(focusIndex, count - 1);

  // Slots are read out of the DOM in the key handler rather than tracked in a
  // ref map: the map had to be populated from ref callbacks built during
  // render, and the buttons are already uniquely marked for the query.
  const focusSlot = (index: number) => {
    const clamped = Math.min(count - 1, Math.max(0, index));
    setFocusIndex(clamped);
    containerRef.current
      ?.querySelectorAll<HTMLButtonElement>('[data-rail-slot]')
      .item(clamped)
      ?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusSlot(effectiveFocusIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusSlot(effectiveFocusIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusSlot(0);
        break;
      case 'End':
        event.preventDefault();
        focusSlot(count - 1);
        break;
    }
  };

  const slotProps = (index: number) => ({
    'data-rail-slot': index,
    tabIndex: index === effectiveFocusIndex ? 0 : -1,
    onFocus: () => setFocusIndex(index),
  });

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col items-center py-2"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            {...slotProps(0)}
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
        {tools.map((tool, index) => {
          const Icon = tool.icon;
          const isActive = activeTool === tool.id && isOpen;

          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  {...slotProps(index + 1)}
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
  );
}
