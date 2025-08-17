import './toolsAside.css';
import { usePanels } from '../panelsContext';
import { JsonPanel } from '../JsonPanel';

function Placeholder({ title, description }: { title: string; description?: string }) {
  return (
    <div className="placeholder">
      <div className="ph-title">{title}</div>
      {description && <div className="ph-text muted">{description}</div>}
    </div>
  );
}

export function ToolsAside() {
  const { activeTool } = usePanels();

  if (!activeTool) return <div className="tools-aside"><Placeholder title="Select a tool on the right" /></div>;

  return (
    <div className="tools-aside">
      {activeTool === 'json' && <JsonPanel />}
      {activeTool === 'arxiv' && (
        <Placeholder title="arXiv references search" description="Coming soon: search and insert relevant references from arXiv." />
      )}
      {activeTool === 'colpali' && (
        <Placeholder title="ColPali search" description="Coming soon: semantic search with ColPali." />
      )}
      {activeTool === 'library' && (
        <Placeholder title="Library" description="Coming soon: your saved papers and datasets." />
      )}
    </div>
  );
}


