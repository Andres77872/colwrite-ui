import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { menuSurface } from '@/components/ui/menuStyles';

/**
 * A menu that drops from a selection-toolbar button.
 *
 * Hand-built rather than a Radix `DropdownMenu` on purpose. Radix portals its
 * content into `<body>` and moves focus there on open; the paragraph blurs,
 * the editor re-renders the block's DOM, and the Range the toolbar is holding
 * is left pointing at detached text nodes. That is how the old "Quick AI
 * edits" dropdown ended up running every item on nothing. Rendered inside
 * the toolbar, with `mousedown` prevented by the toolbar root, a pointer
 * choice never moves focus off the text at all.
 *
 * Keyboard: the arrow keys move between items, Escape closes and hands focus
 * back to the trigger, Tab leaves.
 */
export function ToolbarMenu({
  label,
  align,
  above,
  autoFocus,
  onClose,
  className,
  children,
}: {
  label: string;
  /** Which edge of the toolbar the menu lines up with. */
  align: { left: number } | 'end';
  /** Open upwards: the toolbar sits too low for the menu to fit below it. */
  above: boolean;
  /** Put focus on the first item — the menu was opened from the keyboard. */
  autoFocus: boolean;
  onClose: (returnFocus: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [autoFocus]);

  // A click anywhere else closes it; the toolbar's own buttons toggle it.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (ref.current?.contains(target)) return;
      if ((target as HTMLElement | null)?.closest?.('[aria-haspopup="menu"]')) return;
      onClose(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [onClose]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      // Left and right belong to the toolbar's roving focus, not to a menu.
      event.stopPropagation();
      return;
    }
    if (next === null || items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    items[next].focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        menuSurface,
        'absolute max-h-[min(480px,60vh)] w-56 overflow-y-auto animate-in fade-in-0 zoom-in-95 duration-100',
        above ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        align === 'end' && 'right-0',
        className,
      )}
      style={align === 'end' ? undefined : { left: align.left }}
    >
      {children}
    </div>
  );
}
