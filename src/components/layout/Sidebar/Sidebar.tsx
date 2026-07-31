import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DocumentsMenu } from '@/components/editor/DocumentsMenu';
import { usePanels } from '@/components/panels/panelsContextState';
import { FileText, PanelLeft, PanelLeftClose } from 'lucide-react';

/**
 * Sidebar — the document workspace.
 *
 * It previously opened with a second copy of the topbar's brand lockup and a
 * Dashboard/Editor/Settings nav where every item was inert: clicking only
 * moved a highlight. Both are gone; the sidebar now shows the one thing it
 * actually drives, the document list.
 */
export function Sidebar() {
  const { leftCollapsed, toggleLeftCollapsed, isDesktop, setMobileNavOpen } = usePanels();

  // The mobile drawer is already narrow and dismissible, so it always shows
  // the full list regardless of the persisted desktop collapse state.
  const collapsed = isDesktop && leftCollapsed;

  return (
    <div className={cn('flex h-full flex-col', collapsed && 'items-center')}>
      <div
        className={cn(
          'flex h-11 flex-shrink-0 items-center border-b border-border/50',
          collapsed ? 'justify-center px-2' : 'justify-between px-3',
        )}
      >
        {!collapsed && (
          <h2 className="truncate text-sm font-medium text-foreground/90">Documents</h2>
        )}

        {isDesktop ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleLeftCollapsed}
                className="text-muted-foreground hover:text-foreground"
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!collapsed}
              >
                {collapsed ? (
                  <PanelLeft className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMobileNavOpen(false)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close navigation"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      {collapsed ? (
        <div className="flex flex-1 flex-col items-center gap-1 py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleLeftCollapsed}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Show documents"
              >
                <FileText className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Documents</TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <DocumentsMenu
            onDocumentCommitted={() => {
              if (!isDesktop) setMobileNavOpen(false);
            }}
          />
        </div>
      )}

      <div
        className={cn(
          'flex-shrink-0 border-t border-border/50 py-2',
          collapsed ? 'px-2 text-center' : 'px-3',
        )}
      >
        <p className="text-2xs text-muted-foreground/60">
          {collapsed ? 'v0.1' : 'v0.1 · alpha'}
        </p>
      </div>
    </div>
  );
}
