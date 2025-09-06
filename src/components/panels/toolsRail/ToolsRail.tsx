import './toolsRail.css';
import { usePanels } from '../panelsContext';

export function ToolsRail() {
  const { activeTool, setTool } = usePanels();
  const btn = (id: any, label: string, icon: string) => (
    <button
      key={id}
      className={`tr-item${activeTool === id ? ' active' : ''}`}
      onClick={() => setTool(activeTool === id ? null : id)}
      title={label}
      aria-label={label}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );

  return (
    <div className="tools-rail" role="toolbar" aria-label="Right tools">
      <div className="tr-header">
        <div className="tr-logo">CW</div>
      </div>
      <div className="tr-list">
        {btn('json', 'Document JSON', '🧾')}
        {btn('arxiv', 'arXiv references search', '🧭')}
        {btn('colpali', 'ColPali search', '🔎')}
        {btn('library', 'Library', '📚')}
        {btn('chats', 'Document chats', '💬')}
      </div>
      <div className="tr-footer"><span className="muted">v0.1</span></div>
    </div>
  );
}


