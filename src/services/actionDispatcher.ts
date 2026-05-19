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

  let message: string;

  if (config.dispatch === 'agent_chat') {
    if (action === 'translate') {
      const targetLang = language ?? config.defaultLanguage ?? 'es-MX';
      message = `Translate the following text to ${targetLang}: ${selectedText}`;
    } else {
      message = `${config.systemPrompt}\n\n${selectedText}`;
    }
  } else {
    // agent_tool
    const toolName = config.toolName ?? action;
    message = `Apply the tool ${toolName} on the following text: ${selectedText}`;
  }

  await streamAgentChat(
    { message, document_id: documentId },
    handlers,
    { signal },
  );
}
