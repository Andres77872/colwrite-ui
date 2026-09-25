import { BookMarked, FileCode, FileSearch, History, Network, ScanSearch, Search, Sparkles, Telescope } from 'lucide-react';
import type { ElementType } from 'react';
import type { ResearchSourceId, SidebarTab, ToolId } from './panelsContextState';

export type PaperSourceId = 'arxiv' | 'semantic_scholar';

export interface ToolMeta {
  id: Exclude<ToolId, 'chats'>;
  label: string;
  description: string;
  icon: ElementType;
  /** Account paper source that must be enabled before this is exposed. */
  sourceId?: PaperSourceId;
}

/**
 * Everything the sidebar can be opened on: its tabs, then each research
 * source (which opens Research on that source), then the JSON inspector.
 * The command palette lists these; the landing page describes some of them.
 */
export const TOOLS: readonly ToolMeta[] = [
  {
    id: 'assistant',
    label: 'AI',
    description: 'Ask about this document, draft and revise it with AI.',
    icon: Sparkles,
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Find papers to read and cite without leaving the document.',
    icon: Telescope,
  },
  {
    id: 'arxiv',
    label: 'Search arXiv',
    description: 'Search academic papers by keyword.',
    icon: Search,
    sourceId: 'arxiv',
  },
  {
    id: 'semantic-scholar',
    label: 'Semantic Scholar',
    description: 'Search papers, explore their citation graph and check a claim.',
    icon: Network,
    sourceId: 'semantic_scholar',
  },
  {
    id: 'colpali',
    label: 'Search pages',
    description: 'Find the exact pages of arXiv papers that answer a question.',
    icon: ScanSearch,
    sourceId: 'arxiv',
  },
  {
    id: 'library',
    label: 'My PDFs',
    description: 'Your uploaded PDFs — search inside them, upload and organise.',
    icon: FileSearch,
  },
  {
    id: 'sources',
    label: 'Sources',
    description: 'What this document cites and keeps — verify, cite, export BibTeX.',
    icon: BookMarked,
  },
  {
    id: 'history',
    label: 'History',
    description: 'Saved versions of this document — see what changed and restore.',
    icon: History,
  },
  {
    id: 'json',
    label: 'Document JSON',
    description: 'Inspect and replace the raw document structure.',
    icon: FileCode,
  },
] as const;

export function toolMeta(id: ToolMeta['id']): ToolMeta {
  const found = TOOLS.find((tool) => tool.id === id);
  if (!found) throw new Error(`Unknown tool id: ${id}`);
  return found;
}

export function toolsForEnabledSources(
  isEnabled: (sourceId: PaperSourceId) => boolean,
): readonly ToolMeta[] {
  return TOOLS.filter((tool) => !tool.sourceId || isEnabled(tool.sourceId));
}

/** The sidebar's permanent tabs, in strip order. JSON is added on demand. */
export const SIDEBAR_TABS: readonly Exclude<SidebarTab, 'json'>[] = [
  'assistant',
  'research',
  'sources',
  'history',
];

export const RESEARCH_SOURCE_IDS: readonly ResearchSourceId[] = [
  'arxiv',
  'semantic-scholar',
  'colpali',
  'library',
];

export interface ResearchSourceMeta {
  id: ResearchSourceId;
  /** Name for the source switcher. */
  label: string;
  /** What the switcher shows when the sidebar is too narrow for `label`. */
  shortLabel: string;
  placeholder: string;
  sourceId?: PaperSourceId;
}

export const RESEARCH_SOURCES: Record<ResearchSourceId, ResearchSourceMeta> = {
  arxiv: {
    id: 'arxiv',
    label: 'arXiv',
    shortLabel: 'arXiv',
    placeholder: 'Search arXiv papers…',
    sourceId: 'arxiv',
  },
  'semantic-scholar': {
    id: 'semantic-scholar',
    label: 'Semantic Scholar',
    shortLabel: 'Scholar',
    placeholder: 'Search Semantic Scholar…',
    sourceId: 'semantic_scholar',
  },
  colpali: {
    id: 'colpali',
    label: 'Pages',
    shortLabel: 'Pages',
    placeholder: 'Find pages that answer a question…',
    sourceId: 'arxiv',
  },
  library: {
    id: 'library',
    label: 'My PDFs',
    shortLabel: 'PDFs',
    placeholder: 'Search inside your PDFs…',
  },
};

const TAB_IDS: readonly string[] = [...SIDEBAR_TABS, 'json'];

export const isSidebarTab = (value: unknown): value is SidebarTab =>
  typeof value === 'string' && TAB_IDS.includes(value);

export const isResearchSource = (value: unknown): value is ResearchSourceId =>
  typeof value === 'string' && (RESEARCH_SOURCE_IDS as readonly string[]).includes(value);

export const isToolId = (value: unknown): value is ToolId =>
  isSidebarTab(value) || isResearchSource(value) || value === 'chats';

/** The tab a tool id opens. */
export function tabForTool(tool: ToolId): SidebarTab {
  if (isResearchSource(tool)) return 'research';
  if (tool === 'chats') return 'assistant';
  return tool;
}
