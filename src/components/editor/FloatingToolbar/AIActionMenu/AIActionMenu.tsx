import './AIActionMenu.css';
import { useEffect, useRef, useState } from 'react';
import type { AiAction } from '../../../../services';

export function AIActionMenu({ onAction, disabled = false }: { onAction: (action: AiAction, e: React.MouseEvent) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') setOpen(false);
    };
    const onDocMouseDown = (e: MouseEvent) => {
      if (!open) return;
      const target = e.target as Node | null;
      if (rootRef.current && target && rootRef.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocMouseDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocMouseDown);
    };
  }, [open]);

  // Close the dropdown when disabled becomes true
  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const handleToggleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setOpen(v => !v);
  };

  const call = (action: AiAction) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    onAction(action, e);
    setOpen(false);
  };

  return (
    <div className="ai-menu" ref={rootRef} onMouseDown={(e) => { /* Keep selection */ e.preventDefault(); e.stopPropagation(); }}>
      <button className="ai-toggle" title="AI Actions" onMouseDown={handleToggleMouseDown} aria-haspopup="menu" aria-expanded={open} disabled={disabled} aria-disabled={disabled}>
        ✨ AI
      </button>
      {open && (
        <div className="ai-list" role="menu">
          <button role="menuitem" className="ai-item" onMouseDown={call('search-for-references')}>
            <span className="ai-icn">🔎</span>
            <span className="ai-label">Search for references</span>
          </button>
          <button role="menuitem" className="ai-item" onMouseDown={call('add-details')}>
            <span className="ai-icn">➕</span>
            <span className="ai-label">Add details</span>
          </button>
          <button role="menuitem" className="ai-item" onMouseDown={call('more-concise')}>
            <span className="ai-icn">➖</span>
            <span className="ai-label">More concise</span>
          </button>
        </div>
      )}
    </div>
  );
}
