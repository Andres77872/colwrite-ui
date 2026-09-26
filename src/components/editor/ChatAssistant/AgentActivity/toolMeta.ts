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
  Globe,
  Library,
  PenLine,
  Scissors,
  Sparkles,
  Wand2,
  Network,
  SearchCheck,
} from 'lucide-react';

/**
 * `interrupted` — the stream ended (stopped, dropped, or errored) before this
 * call reported a result. Not a success and not the tool's failure; rendering
 * it as either lied about what happened.
 */
export type ToolRunState = 'running' | 'done' | 'error' | 'interrupted';

export type ToolRun = {
  id: string;
  tool: string;
  state: ToolRunState;
  durationMs?: number;
  /** One line about what the call actually did, once it is known. */
  detail?: string;
  /** Why the call failed, in the server's words. Set when state is 'error'. */
  error?: string;
  /** The failure's class, e.g. 'TimeoutError' or 'ContentTruncated'. */
  errorType?: string;
  /** The complete parsed input, when it fit the wire budget. */
  args?: Record<string, unknown>;
  /** Capped JSON rendering of the input — always present once known. */
  argsPreview?: string;
  /** Bounded slice of what the tool returned. */
  outputPreview?: string;
  /** Full size of the tool's output before any bounding. */
  outputChars?: number;
  /** The server cut the output at its size limit before the model saw it. */
  outputTruncated?: boolean;
  /** When this browser heard the call start, for a live elapsed counter. */
  startedAt?: number;
  /**
   * How much of its input the model has written so far, while it is still
   * writing it (a long edit takes a while). Dropped once the input is known.
   */
  argumentsChars?: number;
};

/**
 * How each tool is described to a writer.
 *
 * "Running doc_edit…" tells someone who is writing a paper nothing. What they
 * need to know is whether the assistant is reading their document, searching
 * for sources, or preparing an edit they will have to review.
 */
const TOOL_META: Record<string, { label: string; running: string; icon: typeof Wand2 }> = {
  skill_read: { label: 'Read writing guidance', running: 'Reading relevant guidance', icon: BookOpen },
  todo_read: { label: 'Checked task progress', running: 'Checking task progress', icon: SearchCheck },
  todo_write: { label: 'Updated task progress', running: 'Updating task progress', icon: SearchCheck },
  delegate_research: { label: 'Delegated research', running: 'Running focused research', icon: Network },
  doc_read: { label: 'Read the document', running: 'Reading your document', icon: FileSearch },
  doc_edit: { label: 'Prepared changes', running: 'Drafting changes', icon: PenLine },
  doc_create: { label: 'Created a document', running: 'Creating a document', icon: FilePlus2 },
  cite_sources: { label: 'Prepared citations', running: 'Adding citations', icon: BookMarked },
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
  attachment_read: {
    label: 'Read an attached PDF',
    running: 'Reading your attached PDF',
    icon: BookOpen,
  },
  resource_search: {
    label: 'Searched your PDFs',
    running: 'Searching your PDFs',
    icon: SearchCheck,
  },
  resource_retrieve: {
    label: 'Retrieved relevant PDF passages',
    running: 'Finding relevant passages in your PDFs',
    icon: SearchCheck,
  },
  // The public web. Named apart from the scholarly databases above so the
  // author can tell a web page from a paper at a glance.
  web_search: { label: 'Searched the web', running: 'Searching the web', icon: Globe },
  web_read: { label: 'Read a web page', running: 'Reading a web page', icon: Globe },
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

/**
 * What kind of failure this was, in words a writer recognises. The server's
 * own message follows it verbatim — this is the lead, not a replacement.
 */
export function failureLead(errorType?: string): string {
  switch (errorType) {
    case 'TimeoutError':
      return 'Took too long and was stopped';
    case 'ContentTruncated':
      return 'Returned more than the assistant could take in';
    case 'MalformedArgumentsError':
      return 'The assistant wrote an invalid request';
    case 'UnknownToolError':
      return 'This tool is not available';
    default:
      return 'Failed';
  }
}

/** "12.4k" for token counts — precise below a thousand, compact above. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1)}k`;
}
