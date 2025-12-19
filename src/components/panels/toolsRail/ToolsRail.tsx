import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { usePanels, type ToolId } from '../panelsContext';
import { FileCode, Search, ScanSearch, BookOpen, MessageSquare, PanelRight } from 'lucide-react';

/* ----------------------------------------
   Tools Configuration
   ---------------------------------------- */

const tools: Array<{ id: ToolId; icon: React.ElementType; label: string }> = [
  { id: 'json', icon: FileCode, label: 'Document JSON' },
  { id: 'arxiv', icon: Search, label: 'arXiv Search' },
  { id: 'colpali', icon: ScanSearch, label: 'ColPali Search' },
  { id: 'library', icon: BookOpen, label: 'Library' },
  { id: 'chats', icon: MessageSquare, label: 'Chats' },
];

/* ----------------------------------------
   Tools Rail Component
   ---------------------------------------- */

export function ToolsRail() {
  const { activeTool, setTool, isOpen, toggle } = usePanels();

  return (
    <TooltipProvider delayDuration={300}>
      <div 
        className="h-full flex flex-col items-center py-2" 
        role="toolbar" 
        aria-label="Tools panel"
      >
        {/* Panel Toggle - AT TOP */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "w-9 h-9",
                "text-muted-foreground hover:text-foreground hover:bg-muted",
                isOpen && "text-foreground"
              )}
              onClick={toggle}
              aria-label={isOpen ? 'Hide panel' : 'Show panel'}
            >
              <PanelRight className={cn(
                "h-4 w-4 transition-transform duration-200",
                !isOpen && "rotate-180"
              )} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {isOpen ? 'Hide panel' : 'Show panel'}
          </TooltipContent>
        </Tooltip>

        {/* Divider */}
        <div className="w-6 h-px bg-border/50 my-2" />

        {/* Tools */}
        <div className="flex flex-col gap-1">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const isActive = activeTool === tool.id && isOpen;
            
            return (
              <Tooltip key={tool.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "w-9 h-9 relative",
                      "transition-all duration-150",
                      isActive && [
                        "bg-primary/10 text-primary",
                      ],
                      !isActive && "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                    onClick={() => setTool(isActive ? null : tool.id)}
                    aria-label={tool.label}
                    aria-pressed={isActive}
                  >
                    <Icon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {tool.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />
      </div>
    </TooltipProvider>
  );
}
