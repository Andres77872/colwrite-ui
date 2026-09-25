import { uid } from '@/lib/uid';
import type { ToolRun } from './AgentActivity';
import type { AgentTodo, AgentWorker, AgentSource } from '@/services/streamParser';
import type { AgentChatContext } from '@/services/agentChat';
import type { EditorFocus } from '@/components/editor/References';
import { extractRefSpans } from './ChatRefTags/refTags';

export type ChatMessage = {
  id: string;
  role: string;
  content: string;
  /** Tools the agent ran while producing this reply, in order. */
  runs: ToolRun[];
  /**
   * The changes this reply put up for review, by id.
   *
   * Ids rather than a count, because the button under the reply jumps to them:
   * it used to jump to `pending[0]`, so with two replies open for review the
   * second one sent the author to the first one's paragraph.
   */
  proposedIds: string[];
  /** Changes a server in auto-apply mode had already written when this ran. */
  applied: number;
  /** Token usage the server reported for this reply, once it completed. */
  usage?: { promptTokens: number; completionTokens: number };
  /**
   * Sources the assistant's research tools returned while writing this
   * reply. Claims in the reply point at them as `[S3]`; the list under the
   * reply offers to cite or save each one.
   */
  sources?: AgentSource[];
  todos?: AgentTodo[];
  workers?: AgentWorker[];
  /**
   * What the model reasoned while it worked, as the engine streamed it (a
   * gateway model's thinking, Claude Code's thinking blocks, Codex's
   * summaries). Shown folded above the answer; never part of it, and not
   * saved with the conversation.
   */
  reasoning?: string;
  /** Time spent reasoning in finished stretches, measured in this browser. */
  thinkingMs?: number;
  /** When the stretch of reasoning under way began; unset between them. */
  thinkingSince?: number;
};

/**
 * What the author reads when something breaks, split from what a bug report
 * needs. `message` is always writeable prose; `detail` carries the technical
 * cause (code, raw body) in a quieter voice; `retryable` gates the
 * "Try again" button to failures where resending the same message can help.
 */
export type ChatError = {
  message: string;
  detail?: string;
  retryable?: boolean;
};

/** The transcript rows a failed turn owns, so retry removes exactly those. */
export type LastExchange = {
  text: string;
  /** Sent again as it was: a retry is about the same place in the text. */
  context?: AgentChatContext;
  userMessageId: string;
  assistantMessageId: string;
  run?: import('@/services/agentSessionChat').ResumeAgentRun;
};

/** The server keeps at most this many referenced blocks. */
const MAX_CONTEXT_BLOCK_IDS = 20;

/**
 * What the assistant should know about where the author is working: the
 * caret's block, the selection, and the blocks the message references as
 * `#this/<id>`. Undefined when there is nothing to say.
 */
export function agentContext(text: string, focus: EditorFocus | null): AgentChatContext | undefined {
  const referenced = [
    ...new Set(
      extractRefSpans(text)
        .filter((ref) => ref.kind === 'block' && ref.source === 'this' && ref.blockId)
        .map((ref) => ref.blockId as string),
    ),
  ].slice(0, MAX_CONTEXT_BLOCK_IDS);
  const context: AgentChatContext = {};
  if (focus) {
    context.block_id = focus.blockId;
    if (focus.selection) context.selection = { block_id: focus.blockId, text: focus.selection };
  }
  if (referenced.length) context.block_ids = referenced;
  return Object.keys(context).length ? context : undefined;
}

export function friendlyStreamError(code: string, message: string): ChatError {
  switch (code) {
    case 'AGENT_BUDGET_EXCEEDED':
      return {
        message:
          'The assistant hit its work limit for this reply and stopped early. What it produced so far is above — ask again to continue.',
        detail: message || code,
        retryable: true,
      };
    case 'DOCUMENT_NOT_FOUND':
      return {
        message: 'The assistant could not find this document on the server.',
        detail: message || code,
        retryable: false,
      };
    // The local Claude Code / Codex engines. The server's message says what
    // to do (which login command to run, for instance); repeating the same
    // request cannot help until the author has done it.
    case 'ENGINE_AUTH_REQUIRED':
    case 'ENGINE_LOCAL_ONLY':
    case 'ENGINE_NOT_INSTALLED':
    case 'ENGINE_INVALID_MODEL':
    case 'ENGINE_UNSAFE_TOOLS':
      return {
        message: `${message || 'The selected agent engine cannot run.'} You can switch engines from the menu next to the # button, or in Settings → AI & tools.`,
        detail: code,
        retryable: false,
      };
    case 'ENGINE_RATE_LIMITED':
      return {
        message: message || 'The selected engine reached its plan’s usage limit.',
        detail: code,
        retryable: true,
      };
    default:
      return {
        // The server writes these messages for people now; an empty one is a
        // dropped payload, not a sentence to show.
        message: message || 'The assistant hit an unexpected error while replying.',
        detail: code || undefined,
        retryable: true,
      };
  }
}

export function emptyMessage(role: string, content = ''): ChatMessage {
  return { id: uid(), role, content, runs: [], proposedIds: [], applied: 0 };
}

function boundedArgument(value: unknown, limit = 120): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

export function toolRunDetail(tool: string, args: Record<string, unknown>): string | undefined {
  if (tool === 'semantic_scholar_search') {
    const query = boundedArgument(args.query);
    return query ? `Query: “${query}”` : undefined;
  }
  if (tool === 'semantic_scholar_paper') {
    const paperId = boundedArgument(args.paper_id);
    return paperId ? `Paper: ${paperId}` : undefined;
  }
  if (tool === 'semantic_scholar_graph') {
    const paperId = boundedArgument(args.paper_id, 80);
    const direction = boundedArgument(args.direction, 20);
    return [direction && `Direction: ${direction}`, paperId && `paper ${paperId}`]
      .filter(Boolean)
      .join(' · ') || undefined;
  }
  if (tool === 'semantic_scholar_recommendations') {
    const paperId = boundedArgument(args.paper_id);
    return paperId ? `Seed paper: ${paperId}` : undefined;
  }
  if (tool === 'semantic_scholar_snippets') {
    const query = boundedArgument(args.query);
    return query ? `Evidence query: “${query}”` : undefined;
  }
  if (tool === 'validate_claim') {
    const claim = boundedArgument(args.claim);
    return claim ? `Claim: “${claim}”` : undefined;
  }
  if (tool === 'search_citations') {
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    return text ? `Checked a ${text.length.toLocaleString()}-character passage` : undefined;
  }
  return undefined;
}
