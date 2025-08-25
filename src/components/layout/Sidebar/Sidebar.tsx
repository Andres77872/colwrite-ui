import { useState } from 'react';
import { DocumentsMenu } from '../../editor/DocumentsMenu';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { 
  Home, 
  FileText, 
  Settings, 
  ChevronLeft, 
  ChevronDown, 
  ChevronRight 
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function Sidebar({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const [active, setActive] = useState<string>('editor');
  const [docsOpen, setDocsOpen] = useState<boolean>(true);

  const go = (id: string) => () => setActive(id);

  const navItems = [
    { id: 'dashboard', icon: Home, label: 'Dashboard' },
    { id: 'editor', icon: FileText, label: 'Editor' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <aside className={cn(
      "h-full flex flex-col bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
      collapsed && "w-14"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "w-8 h-8 rounded-md bg-gradient-to-br from-primary to-primary/80 text-primary-foreground font-bold shadow-sm",
              collapsed && "cursor-pointer"
            )}
            onClick={collapsed ? onToggle : undefined}
            aria-label={collapsed ? 'Expand sidebar' : undefined}
          >
            CW
          </Button>
          {!collapsed && (
            <div className="font-semibold text-foreground tracking-tight">ColWrite</div>
          )}
        </div>
        {!collapsed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="w-8 h-8"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-auto p-3 space-y-2">
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            
            return (
              <Button
                key={item.id}
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                onClick={go(item.id)}
                className={cn(
                  "w-full justify-start gap-3 h-9",
                  isActive && "bg-accent text-accent-foreground font-medium",
                  collapsed && "justify-center px-0"
                )}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Button>
            );
          })}
        </nav>

        {/* Documents Section */}
        {!collapsed && (
          <>
            <Separator className="my-4" />
            <div className="space-y-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDocsOpen(v => !v)}
                className="w-full justify-between h-8 px-2 font-medium"
              >
                <span>Documents</span>
                {docsOpen ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </Button>
              {docsOpen && (
                <div className="pl-2">
                  <DocumentsMenu />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2">
          {!collapsed ? (
            <>
              <Badge variant="secondary" className="text-xs">
                v0.1.0
              </Badge>
              <span className="text-xs text-muted-foreground">Preview</span>
            </>
          ) : (
            <Badge variant="secondary" className="text-xs w-full justify-center">
              v0.1
            </Badge>
          )}
        </div>
      </div>
    </aside>
  );
}


