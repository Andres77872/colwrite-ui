/**
 * How a tool call is named to a writer, and how long it took. The names,
 * running labels, icons and detail lines are the server's: each tool's row
 * of the assistant catalog, or, for a tool the catalog does not list, the
 * display its `tool_call_start` carried. Split out of the component so the
 * activity list and the assistant's status line name a call the same way.
 */
import {
  BookMarked,
  BookOpen,
  FilePlus2,
  FileSearch,
  Globe,
  Image,
  Library,
  ListOrdered,
  MessageCircleQuestion,
  MessageSquareText,
  PenLine,
  Wand2,
  Network,
  SearchCheck,
  type LucideIcon,
} from 'lucide-react';
import type { ErrorCode } from '@/api/schema';
import { fillDetailTemplate, type ToolDisplayInfo } from '@/data/assistant';
import { isUnknownRecord } from '@/lib/json';

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
  /** How its start event named it, for a tool the catalog does not list. */
  display?: ToolDisplayInfo | null;
  durationMs?: number;
  /** Why the call failed, in the server's words. Set when state is 'error'. */
  error?: string;
  /** The failure's registry code (`timeout`, `invalid_request`, `workspace_policy`, …). */
  errorType?: string;
  /** The complete parsed input, when it fit the wire budget. */
  args?: Record<string, unknown>;
  /** Capped JSON rendering of the input — always present once known. */
  argsPreview?: string;
  /**
   * What the tool returned, as the server projects it for the author: counts,
   * flags and safe labels, never content. A failure's is
   * `{"content_redacted": true, "status": "error", "code": …}`.
   */
  outputPreview?: string;
  /** Full size of the tool's result. */
  outputChars?: number;
  /** The result was over the tool's limit and was fitted under it: still a success. */
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
 * The catalog's icon keys, as this client draws them. A key it has no icon
 * for is drawn as a generic tool, and the row still says what it did.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  'book-marked': BookMarked,
  'book-open': BookOpen,
  'file-plus': FilePlus2,
  'file-search': FileSearch,
  globe: Globe,
  image: Image,
  library: Library,
  'list-ordered': ListOrdered,
  'message-question': MessageCircleQuestion,
  'message-square': MessageSquareText,
  network: Network,
  'pen-line': PenLine,
  'search-check': SearchCheck,
};

export function toolIcon(key: string | undefined): LucideIcon {
  return (key && Object.hasOwn(ICONS, key) ? ICONS[key] : undefined) ?? Wand2;
}

/**
 * How a call is named: its label, its running label, its icon, its detail
 * templates and the words for the values of their enum placeholders.
 */
export type ToolNaming = {
  label: string;
  runningLabel: string;
  icon: LucideIcon;
  detailTemplates: readonly string[];
  valueLabels: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

/**
 * A call's naming, from the catalog's row for its tool, else from its start
 * event's display. A tool neither names (a record of a tool this server no
 * longer has) reads as its id, so the row still says something true.
 */
export function toolNaming(tool: string, catalogRow: ToolDisplayInfo | undefined, display?: ToolDisplayInfo | null): ToolNaming {
  const source = catalogRow ?? display ?? null;
  if (source) {
    return {
      label: source.label,
      runningLabel: source.running_label,
      icon: toolIcon(source.icon),
      detailTemplates: source.detail_templates,
      valueLabels: source.value_labels,
    };
  }
  const words = tool.replace(/_/g, ' ');
  return { label: words, runningLabel: `Running ${words}`, icon: Wand2, detailTemplates: [], valueLabels: {} };
}

/** One line about what the call did, from its naming's templates and its arguments, once known. */
export function toolDetail(naming: ToolNaming, args: Record<string, unknown> | undefined): string | undefined {
  return fillDetailTemplate(naming.detailTemplates, args, naming.valueLabels);
}

export function formatDuration(ms?: number): string | null {
  if (!ms || ms < 50) return null;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * What kind of failure each code is, in words a writer recognises. A failed
 * call's `error_type` is always a registry code
 * (`ColWrite-api/docs/assistant-events.md#tool_call_end`); the table is
 * keyed by the contract's codes, so a renamed one fails the build.
 */
const FAILURE_LEADS: Partial<Record<ErrorCode, string>> = {
  // The tool executor's own.
  timeout: 'Took too long and was stopped',
  tool_cancelled: 'Cancelled before it finished',
  // Arguments the tool does not accept, cut-off JSON, or a tool the run does not have.
  invalid_request: 'The assistant wrote an invalid request',
  repeated_call: 'The same call had already failed twice, so it was not run again',
  internal_error: 'The tool ran into an error',
  // The run's web calls, its research workers, or (on a local CLI engine) its tool calls.
  budget_exhausted: 'This reply used up its allowance for this kind of step',
  // A local CLI engine: the run stopped before the call ran.
  run_stopped: 'The run stopped before this step ran',
  // A research worker (`delegate`).
  worker_failed: 'The research worker could not finish',
  // An outside research service.
  provider_rate_limited: 'The research service is busy',
  provider_unavailable: 'The research service is unavailable',
  provider_failed: 'The research service could not answer',
  provider_invalid_input: 'The research service did not accept the request',
  paper_not_found: 'No paper source knows that identifier',
  // `cite_sources` refused the whole call (the citation pipeline, 09 §4).
  source_not_found: 'That source is not in this conversation and no registry knows it',
  source_mismatch: 'The identifier names a different work than the one meant',
  source_retracted: 'The work has been retracted, so it was not cited',
  // `claim_check`'s judge and a focused `web_read`'s extractor are model calls.
  claim_check_failed: 'The claim could not be judged just now',
  web_focus_failed: 'The page could not be read for what was asked',
  // A deep run with no approved plan: it proposes one before it writes (TD5).
  plan_required: 'Needs an approved plan before it writes to the page',
  plan_not_found: 'That plan is no longer open',
  stale_plan: 'The plan was edited since; the newer version is the one that counts',
  // The workspace's policy turned the tool off during the run (M5).
  workspace_policy: 'Switched off in this workspace',
  // The account was removed from the workspace during the run, or the
  // workspace was deleted: the tool did not run (M6).
  no_workspace_context: 'This workspace is no longer available',
  // The run's page left the workspace (the Trash, a purge) during the run.
  no_document_context: 'This page is no longer available',
  // `doc_create` after the run read a PDF, a paper, a web page or a
  // worker's report: a new page is saved unseen, so the server refuses it.
  untrusted_content: 'The assistant read outside material in this run, so it can propose changes but not create pages. Start a new message to create one',
};

/**
 * What kind of failure this was. The server's own message follows it
 * verbatim — this is the lead, not a replacement. A code this client has no
 * words for is just "Failed".
 */
export function failureLead(errorType?: string | null): string {
  return (errorType && Object.hasOwn(FAILURE_LEADS, errorType) ? FAILURE_LEADS[errorType as ErrorCode] : undefined) ?? 'Failed';
}

/**
 * Whether a call's output preview is the projection of a failure
 * (`{"content_redacted": true, "status": "error", "code": …}`): it holds
 * nothing but the code, which the row already names.
 */
export function isFailurePreview(preview: string | undefined): boolean {
  if (!preview) return false;
  try {
    const parsed: unknown = JSON.parse(preview);
    return isUnknownRecord(parsed) && parsed.content_redacted === true && parsed.status === 'error';
  } catch {
    return false;
  }
}

/** "12.4k" for token counts — precise below a thousand, compact above. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1)}k`;
}
