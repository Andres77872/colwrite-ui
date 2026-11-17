import { panelMeta } from '@/components/panels/sidebarPanels';

/**
 * The right-sidebar tabs the page topbar opens directly, in topbar order,
 * with the sidebar's own labels and icons. The assistant has its own
 * labelled "Ask AI" button beside them.
 */
export const PAGE_PANELS = (['research', 'sources', 'history'] as const).map(panelMeta);
