import { cn } from '@/lib/utils';
import type { DragMode } from './useChatWindow';

/* ----------------------------------------
   Window edges
   ---------------------------------------- */

const EDGE_CLASS: Record<Exclude<DragMode, 'move'>, string> = {
  n: 'inset-x-3 top-0 h-1.5 cursor-ns-resize',
  s: 'inset-x-3 bottom-0 h-1.5 cursor-ns-resize',
  w: 'inset-y-3 left-0 w-1.5 cursor-ew-resize',
  e: 'inset-y-3 right-0 w-1.5 cursor-ew-resize',
  nw: 'left-0 top-0 h-3 w-3 cursor-nwse-resize',
  ne: 'right-0 top-0 h-3 w-3 cursor-nesw-resize',
  sw: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize',
  se: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize',
};

/**
 * The eight grab zones around the window.
 *
 * Only the top-left corner takes focus. Eight tab stops for one operation
 * would bury the composer at the bottom of the panel's tab order, and one
 * handle that resizes in both axes covers everything the other seven do.
 */
export function ResizeHandles({
  onBegin,
  onNudge,
  rect,
}: {
  onBegin: (event: React.PointerEvent, mode: DragMode) => void;
  onNudge: (mode: DragMode, event: React.KeyboardEvent) => boolean;
  rect: { width: number; height: number };
}) {
  return (
    <>
      {(Object.keys(EDGE_CLASS) as Array<Exclude<DragMode, 'move'>>).map((edge) => {
        const keyboard = edge === 'nw';
        return (
          <div
            key={edge}
            data-resize={edge}
            onPointerDown={(event) => onBegin(event, edge)}
            onKeyDown={
              keyboard
                ? (event) => {
                    if (onNudge(edge, event)) event.preventDefault();
                  }
                : undefined
            }
            {...(keyboard
              ? {
                  role: 'separator' as const,
                  tabIndex: 0,
                  'aria-label':
                    'Resize assistant. Left and up arrows enlarge it; right and down arrows shrink it.',
                  'aria-valuetext': `${Math.round(rect.width)} by ${Math.round(rect.height)} pixels`,
                }
              : { 'aria-hidden': true })}
            style={{ touchAction: 'none' }}
            className={cn(
              // Invisible until the pointer is on it, then a hairline in the
              // accent colour — the same reveal the shell's panel dividers
              // use. A permanently drawn frame around a floating window is
              // noise; the resize cursor is what actually announces it.
              'absolute z-10 rounded-full transition-colors hover:bg-primary/60',
              EDGE_CLASS[edge],
              keyboard &&
                'focus-visible:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          />
        );
      })}
    </>
  );
}
