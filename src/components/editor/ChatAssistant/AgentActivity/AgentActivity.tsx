import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import {
  BookMarked,
  Check,
  ChevronRight,
  FilePlus2,
  FileSearch,
  PenLine,
  Scissors,
  Sparkles,
  TriangleAlert,
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
  add_details: { label: 'Expanded a passage', running: 'Expanding a passage', icon: Wand2 },
  more_concise: { label: 'Condensed a passage', running: 'Condensing a passage', icon: Scissors },
  aibeat: { label: 'Ran an instruction', running: 'Running your instruction', icon: Sparkles },
};

function metaFor(tool: string) {
  return (
    TOOL_META[tool] ?? {
      label: tool.replace(/_/g, ' '),
      running: `Running ${tool.replace(/_/g, ' ')}`,
      icon: Wand2,
    }
  );
}

function formatDuration(ms?: number): string | null {
  if (!ms || ms < 50) return null;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * What the agent did on this turn, in the order it did it.
 *
 * Collapsed to a single line once the turn finishes: the detail matters while
 * you are waiting, and becomes noise once the answer is there.
 */
export function AgentActivity({ runs, live }: { runs: ToolRun[]; live: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (runs.length === 0) return null;

  const open = live || expanded;
  const failed = runs.filter((run) => run.state === 'error').length;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="min-w-0 flex-1 truncate">
          {live
            ? metaFor(runs[runs.length - 1].tool).running + '…'
            : `${runs.length} ${runs.length === 1 ? 'step' : 'steps'}`}
        </span>
        {failed > 0 && (
          <span className="shrink-0 text-destructive">
            {failed} failed
          </span>
        )}
      </button>

      {open && (
        <ol className="space-y-1 border-t border-border/60 px-2.5 py-1.5">
          {runs.map((run) => {
            const meta = metaFor(run.tool);
            const Icon = meta.icon;
            const duration = formatDuration(run.durationMs);
            return (
              <li key={run.id} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0">
                  {run.state === 'running' ? (
                    <Spinner className="h-3 w-3" />
                  ) : run.state === 'error' ? (
                    <TriangleAlert aria-hidden="true" className="h-3 w-3 text-destructive" />
                  ) : (
                    <Check aria-hidden="true" className="h-3 w-3 text-[var(--color-diff-add-fg)]" />
                  )}
                </span>
                <Icon aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className={cn(run.state === 'error' ? 'text-destructive' : 'text-foreground')}>
                    {run.state === 'running' ? meta.running : meta.label}
                  </span>
                  {run.detail && (
                    <span className="block text-muted-foreground">{run.detail}</span>
                  )}
                </span>
                {duration && <span className="shrink-0 text-muted-foreground">{duration}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
