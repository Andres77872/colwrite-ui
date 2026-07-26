import * as React from 'react';
import { cn } from '@/lib/utils';

/* ============================================
   RESIZE HANDLE

   This module previously also exported ResizablePanelGroup, ResizablePanel
   and CollapsiblePanel — ~300 lines that nothing imported, duplicating the
   layout logic AppShell already owns. Only the handle is real.
   ============================================ */

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  /** Announced to assistive tech, e.g. "Resize sidebar". */
  label: string;
  className?: string;
}

/** Pixels moved per arrow-key press; Shift multiplies this. */
const KEYBOARD_STEP = 16;

/**
 * ResizeHandle — draggable (and keyboard-operable) panel divider.
 *
 * Exposed as a `separator` so it is reachable by keyboard: pointer-only
 * resizing left the panel widths entirely unavailable to anyone not using
 * a mouse.
 */
export function ResizeHandle({ direction, onResize, label, className }: ResizeHandleProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const startPos = React.useRef(0);
  const onResizeRef = React.useRef(onResize);

  React.useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  const isHorizontal = direction === 'horizontal';

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Ignore secondary buttons so a right-click never starts a drag.
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      setIsDragging(true);
      startPos.current = isHorizontal ? event.clientX : event.clientY;
      document.body.classList.add('resizing');

      const handleMove = (moveEvent: PointerEvent) => {
        const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
        const delta = currentPos - startPos.current;
        if (delta === 0) return;
        startPos.current = currentPos;
        onResizeRef.current(delta);
      };

      const handleUp = () => {
        setIsDragging(false);
        document.body.classList.remove('resizing');
        target.removeEventListener('pointermove', handleMove);
        target.removeEventListener('pointerup', handleUp);
        target.removeEventListener('pointercancel', handleUp);
      };

      target.addEventListener('pointermove', handleMove);
      target.addEventListener('pointerup', handleUp);
      target.addEventListener('pointercancel', handleUp);
    },
    [isHorizontal],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      const decreaseKey = isHorizontal ? 'ArrowLeft' : 'ArrowUp';
      const increaseKey = isHorizontal ? 'ArrowRight' : 'ArrowDown';
      if (event.key !== decreaseKey && event.key !== increaseKey) return;
      event.preventDefault();
      const step = KEYBOARD_STEP * (event.shiftKey ? 4 : 1);
      onResizeRef.current(event.key === increaseKey ? step : -step);
    },
    [isHorizontal],
  );

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      tabIndex={0}
      className={cn(
        'group/handle relative flex flex-shrink-0 select-none items-center justify-center rounded-sm',
        isHorizontal ? 'w-3 cursor-col-resize' : 'h-3 cursor-row-resize',
        className,
      )}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      style={{ touchAction: 'none' }}
    >
      <div
        className={cn(
          'rounded-full bg-border transition-all duration-150',
          'group-hover/handle:bg-primary/60 group-focus-visible/handle:bg-primary',
          isHorizontal
            ? ['h-8 w-1', 'group-hover/handle:h-12', isDragging && 'h-16 bg-primary']
            : ['h-1 w-8', 'group-hover/handle:w-12', isDragging && 'w-16 bg-primary'],
        )}
      />
    </div>
  );
}

/* ----------------------------------------
   Panel header
   ---------------------------------------- */

interface PanelHeaderProps {
  title: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * PanelHeader — the title bar shared by every docked panel, so the sidebar,
 * tools aside and any future panel keep identical height and rhythm.
 */
export function PanelHeader({ title, icon, actions, className }: PanelHeaderProps) {
  return (
    <div
      className={cn(
        'flex h-11 flex-shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="flex-shrink-0 text-primary/70">{icon}</span>}
        <h2 className="truncate text-sm font-medium text-foreground/90">{title}</h2>
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  );
}
