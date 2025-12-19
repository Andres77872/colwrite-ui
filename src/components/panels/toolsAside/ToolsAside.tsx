import { cn } from '@/lib/utils';
import { usePanels, type ToolId } from '../panelsContext';
import { JsonPanel } from '../JsonPanel';
import { ArxivPanel } from '../ArxivPanel';
import { ColpaliPanel } from '../ColpaliPanel';
import { LibraryPanel } from '../LibraryPanel';
import { ChatsPanel } from '../ChatsPanel/ChatsPanel';
import { 
  FileCode, 
  Search, 
  ScanSearch, 
  BookOpen, 
  MessageSquare,
  PanelRightClose,
  X,
} from 'lucide-react';

/* ----------------------------------------
   Panel Configuration
   ---------------------------------------- */

const panelConfig: Record<ToolId, { 
  title: string; 
  icon: React.ElementType;
  description: string;
}> = {
  json: { 
    title: 'Document JSON', 
    icon: FileCode,
    description: 'View and edit document structure',
  },
  arxiv: { 
    title: 'arXiv Search', 
    icon: Search,
    description: 'Search academic papers',
  },
  colpali: { 
    title: 'ColPali Search', 
    icon: ScanSearch,
    description: 'Visual document search',
  },
  library: { 
    title: 'Library', 
    icon: BookOpen,
    description: 'Your document library',
  },
  chats: { 
    title: 'Chats', 
    icon: MessageSquare,
    description: 'AI conversations about this document',
  },
};

/* ----------------------------------------
   Placeholder Component
   ---------------------------------------- */

function Placeholder({ title, description }: { title: string; description?: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
      <div className={cn(
        "w-12 h-12 rounded-xl grid place-items-center",
        "bg-muted/30 border border-border/50",
      )}>
        <PanelRightClose className="w-5 h-5 text-muted-foreground/60" />
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground/80">{title}</div>
        {description && (
          <p className="text-xs text-muted-foreground max-w-[180px]">{description}</p>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------
   Tools Aside Component
   ---------------------------------------- */

export function ToolsAside() {
  const { activeTool, close } = usePanels();

  if (!activeTool) {
    return (
      <Placeholder 
        title="Select a tool" 
        description="Choose a tool from the rail" 
      />
    );
  }

  const config = panelConfig[activeTool];
  const Icon = config.icon;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Panel Header - Minimal design matching sidebar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 text-primary/70 flex-shrink-0" />
          <span className="font-medium text-sm text-foreground/90 truncate">{config.title}</span>
        </div>
        <button
          onClick={close}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      {/* Panel Content */}
      <div className="flex-1 overflow-auto p-3">
        {activeTool === 'json' && <JsonPanel />}
        {activeTool === 'arxiv' && <ArxivPanel />}
        {activeTool === 'colpali' && <ColpaliPanel />}
        {activeTool === 'library' && <LibraryPanel />}
        {activeTool === 'chats' && <ChatsPanel />}
      </div>
    </div>
  );
}
