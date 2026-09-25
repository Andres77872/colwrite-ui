/**
 * One look for every floating menu.
 *
 * The Radix menus below use these, and so do the hand-built ones (slash menu,
 * selection toolbar, Ask AI suggestions) that cannot be a `DropdownMenu`
 * because they follow the caret rather than a trigger. Keeping the recipe in
 * one place is what makes a menu opened from the gutter, the toolbar and the
 * page "…" read as the same component.
 */

/** Popover surface: no border — the layered shadow carries its own 1px ring.
    Forced colors drop shadows, so there it gets a real (system-coloured) border. */
export const menuSurface =
  'rounded-lg bg-popover p-1.5 text-popover-foreground shadow-lg outline-none forced-colors:border';

/** A 32px row (it grows for a second line): 14px label, 16px muted icon,
    hover/keyboard fill. */
export const menuItem =
  'relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors duration-120 hover:bg-hover focus:bg-hover data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&>svg]:text-muted-foreground';

/** Destructive row: red label and icon, same hover as any other row. */
export const menuItemDestructive = 'text-destructive [&>svg]:text-destructive';

/** Group heading above a run of items. */
export const menuLabel = 'px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground';

export const menuSeparator = '-mx-1.5 my-1.5 h-px bg-divider';

/** Right-aligned keyboard hint inside a row. */
export const menuShortcut = 'ml-auto pl-4 text-xs tracking-wide text-muted-foreground';

/** Open/close motion shared by every Radix floating surface. */
export const floatingMotion =
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2';
