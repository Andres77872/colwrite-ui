import { uid } from '@/lib/uid';
import type { ToolRun } from './AgentActivity';

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
  userMessageId: string;
  assistantMessageId: string;
};

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
