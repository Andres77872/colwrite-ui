import { useContext, useRef, useState } from 'react';
import { AlertTriangle, Cpu, RefreshCw, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentEngine } from '@/components/preferences/agentEngineContextState';
import { engineBadge, engineName } from '@/components/preferences/agentEngineCopy';
import { ViewContext } from '@/components/layout/viewContextState';
import { requestSettingsPane } from '@/components/profile/settingsPane';
import { AGENT_ENGINE_IDS, isAgentEngineId, type AgentEngineId } from '@/services/agentEngines';

const SHORT_NAMES: Record<AgentEngineId, string> = {
  legacy: 'Gateway',
  claude: 'Claude Code',
  codex: 'Codex',
};

/**
 * Which engine answers in this chat, switchable from the composer.
 *
 * Only a local API offers a choice (Claude Code, Codex); everywhere else this
 * renders nothing and the gateway answers, exactly as before. An engine that
 * cannot run yet stays visible with its reason instead of being swapped for
 * another one behind the author's back.
 */
export function EngineSwitcher({ disabled = false }: { disabled?: boolean }) {
  const { selectable, prefs, statusOf, setChatEngine, check, checking } = useAgentEngine();
  const view = useContext(ViewContext);
  // As in the page menu: the tooltip must not sit over the open menu, nor
  // pop back up when focus returns to the trigger as the menu closes.
  const [menuOpen, setMenuOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const menuClosedAt = useRef(0);
  const onMenuOpenChange = (next: boolean) => {
    if (!next) menuClosedAt.current = Date.now();
    setTooltipOpen(false);
    setMenuOpen(next);
  };
  const onTooltipOpenChange = (next: boolean) =>
    setTooltipOpen(next && !menuOpen && Date.now() - menuClosedAt.current > 400);

  if (!selectable) return null;

  const current = prefs.chat;
  const status = statusOf(current);
  const ready = status?.available === true;

  const openSettings = () => {
    requestSettingsPane('ai');
    view?.setView('profile');
  };

  return (
    <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
      <Tooltip open={tooltipOpen} onOpenChange={onTooltipOpenChange}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              aria-label={`Assistant engine: ${engineName(current, status)}${ready ? '' : ' (not ready)'}`}
              className={cn(
                'inline-flex h-7 max-w-40 items-center gap-1 rounded-md px-1.5 text-xs outline-none transition-colors duration-120 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
                ready ? 'text-muted-foreground hover:text-foreground' : 'text-tint-yellow-fg',
              )}
            >
              {ready ? (
                <Cpu aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{SHORT_NAMES[current]}</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          {ready ? `Answered by ${engineName(current, status)}` : status?.message ?? 'Checking the engine…'}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Assistant engine</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => {
            if (isAgentEngineId(value)) setChatEngine(value);
          }}
        >
          {AGENT_ENGINE_IDS.map((engine) => {
            const engineStatus = statusOf(engine);
            const available = engineStatus?.available === true;
            return (
              <DropdownMenuRadioItem
                key={engine}
                value={engine}
                indicator
                disabled={!available && engine !== current}
              >
                <span className="truncate">{engineName(engine, engineStatus)}</span>
                {!available && (
                  <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                    {engineBadge(engineStatus).label}
                  </span>
                )}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {current !== 'legacy' && (
          <DropdownMenuItem
            disabled={checking === current}
            onSelect={(event) => {
              // Stay open: the new state shows right here.
              event.preventDefault();
              void check(current);
            }}
          >
            <RefreshCw aria-hidden="true" />
            {checking === current ? 'Checking…' : `Check ${engineName(current, status)} again`}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={openSettings} disabled={!view}>
          <Settings2 aria-hidden="true" />
          Engine settings…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
