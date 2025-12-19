import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DocumentsMenu } from '@/components/editor/DocumentsMenu';
import { usePanels } from '@/components/panels/panelsContext';
import { 
  ChevronDown, 
  Home, 
  FileEdit, 
  Settings,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'editor', label: 'Editor', icon: FileEdit },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

/**
 * Sidebar - Left navigation panel with collapsible sections
 * Supports collapsed state with icon-only mode
 */
export function Sidebar() {
  const { leftCollapsed: collapsed, toggleLeftCollapsed } = usePanels();
  const [active, setActive] = useState<string>('editor');
  const [docsOpen, setDocsOpen] = useState<boolean>(true);

  return (
    <TooltipProvider delayDuration={300}>
      <aside className={cn(
        "h-full flex flex-col",
        collapsed && "items-center"
      )}>
        {/* Header */}
        <div className={cn(
          "flex items-center justify-between gap-2 px-3 py-2 border-b border-border/50",
          "flex-shrink-0",
          collapsed && "justify-center px-2"
        )}>
          <div className="flex items-center gap-2.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    "w-7 h-7 rounded-md grid place-items-center",
                    "bg-primary/90 hover:bg-primary",
                    "text-white font-bold text-xs border-none",
                    "transition-all duration-150",
                    collapsed && "cursor-pointer"
                  )}
                  onClick={collapsed ? toggleLeftCollapsed : undefined}
                  aria-label={collapsed ? 'Expand sidebar' : 'ColWrite'}
                >
                  CW
                </button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  Expand sidebar
                </TooltipContent>
              )}
            </Tooltip>
            <div className={cn(
              "overflow-hidden transition-all duration-200",
              collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
            )}>
              <span className="font-medium text-sm text-foreground/90 whitespace-nowrap">Colwrite</span>
            </div>
          </div>
          
          {!collapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={toggleLeftCollapsed}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted"
                  aria-label="Collapse sidebar"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                Collapse sidebar
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-auto p-2 flex flex-col gap-1">
          <nav className="grid gap-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              
              const button = (
                <button
                  key={item.id}
                  className={cn(
                    "flex items-center gap-2.5 px-2.5 py-2 rounded-lg",
                    "text-left transition-all duration-150",
                    "hover:bg-muted",
                    isActive && "bg-primary/10 text-primary",
                    !isActive && "text-foreground/80",
                    collapsed && "justify-center px-2"
                  )}
                  onClick={() => setActive(item.id)}
                  title={collapsed ? item.label : undefined}
                  aria-label={item.label}
                >
                  <Icon className={cn(
                    "h-4 w-4 flex-shrink-0",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )} />
                  <span className={cn(
                    "text-sm transition-all duration-200",
                    collapsed ? "w-0 opacity-0 overflow-hidden" : "w-auto opacity-100"
                  )}>
                    {item.label}
                  </span>
                </button>
              );
              
              if (collapsed) {
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      {button}
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                );
              }
              
              return button;
            })}
          </nav>

          {/* Documents Section */}
          <div className={cn(
            "transition-all duration-200 overflow-hidden",
            collapsed ? "opacity-0 h-0" : "opacity-100"
          )}>
            <Collapsible open={docsOpen} onOpenChange={setDocsOpen}>
              <div className="border-t border-border/50 pt-2 mt-1">
                <CollapsibleTrigger asChild>
                  <button className={cn(
                    "w-full flex items-center justify-between px-2.5 py-2 rounded-lg",
                    "hover:bg-muted transition-colors",
                    "group"
                  )}>
                    <span className="text-sm text-foreground/80">Documents</span>
                    <ChevronDown className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform duration-200",
                      !docsOpen && "-rotate-90"
                    )} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-[accordion-down_200ms_ease-out] data-[state=closed]:animate-[accordion-up_200ms_ease-out]">
                  <div className="pt-1">
                    <DocumentsMenu />
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>
          
          {/* Collapsed expand button */}
          {collapsed && (
            <div className="mt-auto pt-2 border-t border-border">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={toggleLeftCollapsed}
                    className="w-full text-muted-foreground hover:text-foreground"
                    aria-label="Expand sidebar"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  Expand sidebar
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={cn(
          "px-3 py-2 border-t border-border/50",
          "flex-shrink-0",
          collapsed && "px-2"
        )}>
          <p className={cn(
            "text-muted-foreground/60 text-[11px]",
            collapsed && "text-center"
          )}>
            {collapsed ? 'v0.1' : 'v0.1 • UI Preview'}
          </p>
        </div>
      </aside>
    </TooltipProvider>
  );
}
