// styles migrated to Tailwind (see src/styles/tailwind.css)
import { usePanels } from '../panelsContext';

export function ToolsRail() {
  const { activeTool, setTool } = usePanels();
  const btn = (id: any, label: string, icon: string) => (
    <button
      key={id}
      className={[
        'w-8', 'h-8', 'rounded-sm', 'grid', 'place-items-center',
        'border', 'border-transparent', 'bg-transparent',
        'hover:bg-elev', 'hover:border-border',
        activeTool === id ? 'bg-[rgba(59,130,246,0.08)] border-accent' : '',
      ].join(' ')}
      onClick={() => setTool(activeTool === id ? null : id)}
      title={label}
      aria-label={label}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );

  return (
    <div className="h-full flex flex-col items-center gap-3" role="toolbar" aria-label="Right tools">
      <div className="py-2">
        <div
          className="w-7 h-7 rounded-sm grid place-items-center text-white font-bold"
          style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-ink))' }}
        >
          CW
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {btn('json', 'Document JSON', '🧾')}
        {btn('arxiv', 'arXiv references search', '🧭')}
        {btn('colpali', 'ColPali search', '🔎')}
        {btn('library', 'Library', '📚')}
      </div>
      <div className="mt-auto py-2 text-[11px]"><span className="text-muted-foreground">v0.1</span></div>
    </div>
  );
}


