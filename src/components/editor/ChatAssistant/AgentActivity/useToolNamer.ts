import { useCallback, useContext } from 'react';
import type { ToolDisplayInfo } from '@/data/assistant';
import { AssistantCatalogContext, NO_CATALOG } from '@/components/preferences/assistantCatalogContextState';
import { toolNaming, type ToolNaming } from './toolMeta';

/**
 * Name a call the way the workspace's catalog names its tool, else as its
 * start event's display does. Outside the catalog's provider (an isolated
 * component) only the display is there to read.
 */
export function useToolNamer(): (tool: string, display?: ToolDisplayInfo | null) => ToolNaming {
  const catalog = useContext(AssistantCatalogContext) ?? NO_CATALOG;
  return useCallback((tool, display) => toolNaming(tool, catalog.tool(tool), display), [catalog]);
}
