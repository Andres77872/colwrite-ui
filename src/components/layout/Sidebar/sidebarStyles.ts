/**
 * One row recipe for everything in the sidebar — quick actions, documents,
 * the bottom links — so they share a height, an inset and a hover.
 *
 * 30px rows at 14px, 18px muted icons. Coarse pointers get 36px, because the
 * same component is the phone drawer.
 */
export const sidebarRow =
  'flex h-[30px] w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground transition-colors duration-150 hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 pointer-coarse:h-9 [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-muted-foreground';

/** The row the author is on. */
export const sidebarRowActive = 'bg-active font-medium text-foreground hover:bg-active';

/** 20px icon buttons revealed on a row or section header's hover. */
export const sidebarHoverAction =
  'grid size-5 shrink-0 place-items-center rounded-xs text-muted-foreground transition-[opacity,background-color] hover:bg-active hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-active data-[state=open]:opacity-100 pointer-coarse:size-7 pointer-coarse:opacity-100 [&_svg]:size-4';
