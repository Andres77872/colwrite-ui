/**
 * How each tool the agent can call is described to a writer, and how long a
 * call took. Split out of the component so both the activity list and the
 * assistant's status line name a tool the same way.
 */
import {
  BookMarked,
  BookOpen,
  FilePlus2,
  FileSearch,
  Library,
  PenLine,
  Scissors,
  Sparkles,
  Wand2,
  Network,
  SearchCheck,
} from 'lucide-react';

export type ToolRunState = 'running' | 'done' | 'error';

export type ToolRun = {
  id: string;
  tool: string;
  state: ToolRunState;
  durationMs?: number;
  /** One line about what the call actually did, once it is known. */
  detail?: string;
};

/**
 * How each tool is described to a writer.
 *
 * "Running doc_edit…" tells someone who is writing a paper nothing. What they
 * need to know is whether the assistant is reading their document, searching
 * for sources, or preparing an edit they will have to review.
 */
const TOOL_META: Record<string, { label: string; running: string; icon: typeof Wand2 }> = {
  doc_read: { label: 'Read the document', running: 'Reading your document', icon: FileSearch },
  doc_edit: { label: 'Prepared changes', running: 'Drafting changes', icon: PenLine },
  doc_create: { label: 'Created a document', running: 'Creating a document', icon: FilePlus2 },
  search_citations: { label: 'Searched for sources', running: 'Searching for sources', icon: BookMarked },
  semantic_scholar_search: {
    label: 'Searched Semantic Scholar',
    running: 'Searching Semantic Scholar',
    icon: Network,
  },
  semantic_scholar_paper: {
    label: 'Inspected a paper',
    running: 'Inspecting paper metadata',
    icon: FileSearch,
  },
  semantic_scholar_graph: {
    label: 'Explored the citation graph',
    running: 'Exploring the citation graph',
    icon: Network,
  },
  semantic_scholar_recommendations: {
    label: 'Found related papers',
    running: 'Finding related papers',
    icon: BookMarked,
  },
  semantic_scholar_snippets: {
    label: 'Inspected source excerpts',
    running: 'Searching source excerpts',
    icon: SearchCheck,
  },
  validate_claim: {
    label: 'Assessed a claim',
    running: 'Assessing evidence for the claim',
    icon: SearchCheck,
  },
  // The author's own PDFs. Worth naming as "your PDFs" rather than "the
  // library": a writer who sees "Searched the library" has no way to tell a
  // search of their own uploads from one of the citation databases above.
  resource_ls: {
    label: 'Listed your PDFs',
    running: 'Checking which of your PDFs it can read',
    icon: Library,
  },
  resource_read: {
    label: 'Read one of your PDFs',
    running: 'Reading one of your PDFs',
    icon: BookOpen,
  },
  resource_search: {
    label: 'Searched your PDFs',
    running: 'Searching your PDFs',
    icon: SearchCheck,
  },
  add_details: { label: 'Expanded a passage', running: 'Expanding a passage', icon: Wand2 },
  more_concise: { label: 'Condensed a passage', running: 'Condensing a passage', icon: Scissors },
  aibeat: { label: 'Ran an instruction', running: 'Running your instruction', icon: Sparkles },
};

/** What to call a tool while it is running, in words a writer recognises. */
export function toolRunningLabel(tool: string): string {
  return metaFor(tool).running;
}

export function metaFor(tool: string) {
  return (
    TOOL_META[tool] ?? {
      label: tool.replace(/_/g, ' '),
      running: `Running ${tool.replace(/_/g, ' ')}`,
      icon: Wand2,
    }
  );
}

export function formatDuration(ms?: number): string | null {
  if (!ms || ms < 50) return null;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

