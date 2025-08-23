// styles migrated to Tailwind (see src/styles/tailwind.css)
import { usePanels } from '../panelsContext';
import { JsonPanel } from '../JsonPanel';
import { ArxivPanel } from '../ArxivPanel';
import { ColpaliPanel } from '../ColpaliPanel';

function Placeholder({ title, description }: { title: string; description?: string }) {
  return (
    <div className="grid place-items-center gap-[6px] p-3 text-center h-full">
      <div className="font-semibold">{title}</div>
      {description && <div className="text-sm muted">{description}</div>}
    </div>
  );
}

export function ToolsAside() {
  const { activeTool } = usePanels();

  if (!activeTool) return <div className="h-full flex flex-col"><Placeholder title="Select a tool on the right" /></div>;

  return (
    <div className="h-full flex flex-col">
      {activeTool === 'json' && <JsonPanel />}
      {activeTool === 'arxiv' && <ArxivPanel />}
      {activeTool === 'colpali' && <ColpaliPanel />}
      {activeTool === 'library' && (
        <Placeholder title="Library" description="Coming soon: your saved papers and datasets." />
      )}
    </div>
  );
}


