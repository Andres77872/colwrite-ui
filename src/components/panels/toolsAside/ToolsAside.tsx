import './toolsAside.css';
import { usePanels } from '../panelsContext';
import { JsonPanel } from '../JsonPanel';
import { ArxivPanel } from '../ArxivPanel';
import { ColpaliPanel } from '../ColpaliPanel';

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
      {activeTool === 'arxiv' && <ArxivPanel />}
      {activeTool === 'colpali' && <ColpaliPanel />}
      {activeTool === 'library' && (
        <Placeholder title="Library" description="Coming soon: your saved papers and datasets." />
      )}
    </div>
  );
}


