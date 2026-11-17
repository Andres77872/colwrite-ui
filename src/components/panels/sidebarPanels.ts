import { BookMarked, BookOpen, FileCode, History, MessageSquareText, Network, SearchCheck, Sparkles, Telescope } from 'lucide-react';
import type { ElementType } from 'react';
import type { ResearchSourceId, SidebarTab, PanelId } from './panelsContextState';

export interface PanelMeta {
  id: PanelId;
  label: string;
  description: string;
  icon: ElementType;
  /** Offered only where paper search is on: the account's Papers switch and a paper source, as the catalog applies them. */
  needsPapers?: true;
}

/**
 * Everything the sidebar can be opened on: its tabs, then each research
 * source (which opens Research on that source), then the JSON inspector.
 * The command palette lists these; the landing page describes some of them.
 */
export const PANELS: readonly PanelMeta[] = [
  {
    id: 'assistant',
    label: 'AI',
    description: 'Ask about this page, draft and revise it with AI.',
    icon: Sparkles,
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Review this page and step through shared comments without changing its text.',
    icon: MessageSquareText,
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Find papers to read and cite without leaving the page.',
    icon: Telescope,
  },
  {
    id: 'papers',
    label: 'Paper search',
    description: 'Search papers in OpenAlex, the arXiv index and Semantic Scholar, follow who cites them, and cite them.',
    icon: Network,
    needsPapers: true,
  },
  {
    id: 'claims',
    label: 'Check a claim',
    description: 'Judge a claim against papers’ passages: supported, partly, contradicted, or not settled without the full text.',
    icon: SearchCheck,
    needsPapers: true,
  },
  {
    id: 'library',
    label: 'Library',
    description: 'Your PDFs: what this page uses, every collection, and search inside them.',
    icon: BookOpen,
  },
  {
    id: 'sources',
    label: 'Sources',
    description: 'What this page cites and keeps — verify, cite, export BibTeX.',
    icon: BookMarked,
  },
  {
    id: 'history',
    label: 'History',
    description: 'Saved versions of this page — see what changed and restore.',
    icon: History,
  },
  {
    id: 'json',
    label: 'Document JSON',
    description: 'Inspect and replace the raw JSON of this page.',
    icon: FileCode,
  },
] as const;

export function panelMeta(id: PanelMeta['id']): PanelMeta {
  const found = PANELS.find((panel) => panel.id === id);
  if (!found) throw new Error(`Unknown panel id: ${id}`);
  return found;
}

export function availablePanels(papersOn: boolean): readonly PanelMeta[] {
  return PANELS.filter((panel) => !panel.needsPapers || papersOn);
}

/** The sidebar's permanent tabs, in strip order. JSON is added on demand. */
export const SIDEBAR_TABS: readonly Exclude<SidebarTab, 'json'>[] = [
  'assistant',
  'research',
  'review',
  'library',
  'sources',
  'history',
];

export const RESEARCH_SOURCE_IDS: readonly ResearchSourceId[] = [
  'papers',
  'claims',
  'pdfs',
];

export interface ResearchSourceMeta {
  id: ResearchSourceId;
  /** Name for the source switcher. */
  label: string;
  /** What the switcher shows when the sidebar is too narrow for `label`. */
  shortLabel: string;
  placeholder: string;
  needsPapers?: true;
}

export const RESEARCH_SOURCES: Record<ResearchSourceId, ResearchSourceMeta> = {
  papers: {
    id: 'papers',
    label: 'Papers',
    shortLabel: 'Papers',
    placeholder: 'Search papers…',
    needsPapers: true,
  },
  claims: {
    id: 'claims',
    label: 'Check a claim',
    shortLabel: 'Claim',
    placeholder: 'A claim to check…',
    needsPapers: true,
  },
  pdfs: {
    id: 'pdfs',
    label: 'Inside my PDFs',
    shortLabel: 'PDFs',
    placeholder: 'Search inside my PDFs…',
  },
};

const TAB_IDS: readonly string[] = [...SIDEBAR_TABS, 'json'];

export const isSidebarTab = (value: unknown): value is SidebarTab =>
  typeof value === 'string' && TAB_IDS.includes(value);

export const isResearchSource = (value: unknown): value is ResearchSourceId =>
  typeof value === 'string' && (RESEARCH_SOURCE_IDS as readonly string[]).includes(value);

/** A tab the sidebar reopens on after a reload; JSON is never restored. */
export const isPersistedTab = (value: unknown): value is Exclude<SidebarTab, 'json'> =>
  typeof value === 'string' && (SIDEBAR_TABS as readonly string[]).includes(value);

/** The tab a panel id opens. */
export function tabForPanel(panel: PanelId): SidebarTab {
  return isResearchSource(panel) ? 'research' : panel;
}
