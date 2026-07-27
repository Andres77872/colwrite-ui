import { BookOpen, FileCode, MessageSquare, Network, ScanSearch, Search } from 'lucide-react';
import type { ElementType } from 'react';
import type { ToolId } from './panelsContextState';

export interface ToolMeta {
  id: ToolId;
  label: string;
  description: string;
  icon: ElementType;
}

/**
 * The tool registry.
 *
 * The rail and the aside each kept their own copy of this list — same ids,
 * same icons, but the labels had already drifted apart. One source now.
 */
export const TOOLS: readonly ToolMeta[] = [
  {
    id: 'json',
    label: 'Document JSON',
    description: 'Inspect and replace the raw document structure.',
    icon: FileCode,
  },
  {
    id: 'arxiv',
    label: 'arXiv Search',
    description: 'Search academic papers by keyword.',
    icon: Search,
  },
  {
    id: 'semantic-scholar',
    label: 'Semantic Scholar',
    description: 'Search papers and explore their citation graph.',
    icon: Network,
  },
  {
    id: 'colpali',
    label: 'ColPali Search',
    description: 'Find relevant pages by visual and semantic similarity.',
    icon: ScanSearch,
  },
  {
    id: 'library',
    label: 'Library',
    description: 'PDFs you have added to this session.',
    icon: BookOpen,
  },
  {
    id: 'chats',
    label: 'Chats',
    description: 'Assistant conversations about this document.',
    icon: MessageSquare,
  },
] as const;

export function toolMeta(id: ToolId): ToolMeta {
  const found = TOOLS.find((tool) => tool.id === id);
  if (!found) throw new Error(`Unknown tool id: ${id}`);
  return found;
}
