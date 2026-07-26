import { AI_ACTION_REGISTRY, type AiAction } from '../config/aiActions';
import { streamAgentChat } from './agentChat';
import type { SSEEventHandlers } from './streamParser';

// ── Types ──

export type DispatchActionParams = {
  selectedText: string;
  action: AiAction;
  documentId: string;
  signal?: AbortSignal;
  onToken?: (content: string) => void;
  onStatus?: (status: string, detail: string) => void;
  onError?: (errorCode: string, message: string) => void;
  /** Only used for the translate action — defaults to 'es-MX' */
  language?: string;
};

// ── Dispatcher ──

/**
 * Dispatch an AI action based on the action registry configuration.
 *
 * For `agent_chat` actions:
 *   - translate: message = "Translate the following text to {language}: {selectedText}"
 *     (language defaults to 'es-MX')
 *   - others: message = "{systemPrompt}\n\n{selectedText}"
 *
 * For `agent_tool` actions:
 *   - message = "Apply the tool {toolName} on the following text: {selectedText}"
 */
export async function dispatchAction(
  params: DispatchActionParams,
): Promise<void> {
  const { selectedText, action, documentId, signal, onToken, onStatus, onError, language } =
    params;

  const config = AI_ACTION_REGISTRY[action];
  if (!config) {
    throw new Error(`Unknown action: "${action}". Not found in AI_ACTION_REGISTRY.`);
  }

  // Build the SSE handlers from what the caller provided
  const handlers: SSEEventHandlers = {};
  if (onToken) handlers.onToken = onToken;
  if (onStatus) handlers.onStatus = onStatus;
  if (onError) handlers.onError = onError;

  // Whatever the agent streams back is spliced straight into the document in
  // place of the selection, so every branch has to end with an instruction to
  // return the replacement text and nothing else — a preamble like "Here is
  // the improved version:" would be written into the user's paragraph.
  const REPLACEMENT_ONLY =
    'Reply with the replacement text only — no preamble, no explanation, no quotes, no markdown fences.';

  let instruction: string;

  if (config.dispatch === 'agent_chat') {
    if (action === 'translate') {
      const targetLang = language ?? config.defaultLanguage ?? 'es-MX';
      instruction = `Translate the following text to ${targetLang}.`;
    } else {
      instruction = config.systemPrompt ?? '';
    }
  } else {
    // agent_tool — name the tool so the agent routes through it, but the
    // user still only ever sees the resulting text.
    const toolName = config.toolName ?? action;
    instruction = `Use the ${toolName} tool on the following text.`;
  }

  const message = `${instruction}\n${REPLACEMENT_ONLY}\n\n${selectedText}`;

  await streamAgentChat(
    // 'rewrite' withholds the document tools server-side. The caller shows
    // this result behind an accept/reject prompt and applies it itself; the
    // agent editing the stored document in parallel meant the user's "reject"
    // did not actually reject anything.
    { message, document_id: documentId, mode: 'rewrite' },
    handlers,
    { signal },
  );
}
