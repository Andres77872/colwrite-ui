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
    <div
      className="relative inline-block"
      ref={rootRef}
      onMouseDown={(e) => {
        /* Keep selection */
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1.5 font-semibold hover:bg-elev disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        title="AI Actions"
        onMouseDown={handleToggleMouseDown}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        aria-disabled={disabled}
      >
        ✨ AI
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-[200] mt-1.5 min-w-[220px] rounded-md border border-border bg-popover p-1.5 shadow-[var(--shadow-md)] flex flex-col"
          role="menu"
        >
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left hover:bg-elev"
            onMouseDown={call('search-for-references')}
          >
            <span className="inline-flex w-[18px] justify-center">🔎</span>
            <span className="flex-1">Search for references</span>
          </button>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left hover:bg-elev"
            onMouseDown={call('add-details')}
          >
            <span className="inline-flex w-[18px] justify-center">➕</span>
            <span className="flex-1">Add details</span>
          </button>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left hover:bg-elev"
            onMouseDown={call('more-concise')}
          >
            <span className="inline-flex w-[18px] justify-center">➖</span>
            <span className="flex-1">More concise</span>
          </button>
        </div>
      )}
    </div>
  );
}
