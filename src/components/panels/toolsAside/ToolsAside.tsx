import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PanelHeader } from '@/components/ui/resizable-panel';
import { usePanels } from '../panelsContextState';
import { toolMeta } from '../toolsConfig';
import { JsonPanel } from '../JsonPanel';
import { ArxivPanel } from '../ArxivPanel';
import { SemanticScholarPanel } from '../SemanticScholarPanel';
import { ColpaliPanel } from '../ColpaliPanel';
import { LibraryPanel } from '../LibraryPanel';
import { ChatsPanel } from '../ChatsPanel';
import { HistoryPanel } from '../HistoryPanel';
import { useAgentTools } from '@/components/preferences';
import { PanelRight, X } from 'lucide-react';

const PANEL_BY_TOOL = {
  json: JsonPanel,
  arxiv: ArxivPanel,
  'semantic-scholar': SemanticScholarPanel,
  colpali: ColpaliPanel,
  library: LibraryPanel,
  chats: ChatsPanel,
  history: HistoryPanel,
} as const;

/**
 * ToolsAside — hosts whichever tool the rail has selected.
 */
export function ToolsAside() {
  const { activeTool, close } = usePanels();
  const { isSourceEnabled } = useAgentTools();

  if (!activeTool) {
    return (
      <EmptyState
        icon={PanelRight}
        title="No tool selected"
        description="Pick a tool from the rail to open it here."
        className="h-full"
      />
    );
  }

  const meta = toolMeta(activeTool);
  if (meta.sourceId && !isSourceEnabled(meta.sourceId)) {
    return (
      <EmptyState
        icon={meta.icon}
        title={`${meta.label} is disabled`}
        description="Enable this paper source in Profile → Agent tools before using it."
        className="h-full"
      />
    );
  }
  const Panel = PANEL_BY_TOOL[activeTool];
  const Icon = meta.icon;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PanelHeader
        title={meta.label}
        icon={<Icon aria-hidden="true" className="h-4 w-4" />}
        actions={
          <Button variant="ghost" size="icon-sm" onClick={close} aria-label={`Close ${meta.label}`}>
            <X aria-hidden="true" className="h-4 w-4" />
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <Panel />
      </div>
    </div>
  );
}
