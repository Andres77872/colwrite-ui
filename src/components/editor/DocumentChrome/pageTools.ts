import { toolMeta } from '@/components/panels/toolsConfig';

/**
 * The right-sidebar tabs the page topbar opens directly, in topbar order,
 * with the sidebar's own labels and icons. The assistant has its own
 * labelled "Ask AI" button beside them.
 */
export const PAGE_TOOLS = (['research', 'sources', 'history'] as const).map(toolMeta);
