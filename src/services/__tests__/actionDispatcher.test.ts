import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchAction } from '../actionDispatcher';
import { AI_ACTION_REGISTRY, type AiAction, type AiActionConfig } from '../../config/aiActions';
import * as agentChat from '../agentChat';

// ── Mock streamAgentChat ──

vi.mock('../agentChat', () => ({
  streamAgentChat: vi.fn(),
}));

// Prevent the mock from actually calling through
const mockStreamAgentChat = vi.mocked(agentChat.streamAgentChat);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Registry consistency tests ──

describe('AI_ACTION_REGISTRY', () => {
  it('6. registry has exactly 10 entries', () => {
    const keys = Object.keys(AI_ACTION_REGISTRY);
    expect(keys).toHaveLength(10);
  });

  it('7. search-for-references has hidden: false', () => {
    const entry = AI_ACTION_REGISTRY['search-for-references'];
    expect(entry.hidden).toBe(false);
  });

  it('8. all tool-based actions have non-empty toolName', () => {
    const toolActions = Object.values(AI_ACTION_REGISTRY).filter(
      (a: AiActionConfig) => a.dispatch === 'agent_tool',
    );
    expect(toolActions.length).toBeGreaterThan(0);
    for (const action of toolActions) {
      expect(action.toolName).toBeTruthy();
      expect(typeof action.toolName).toBe('string');
      expect(action.toolName!.length).toBeGreaterThan(0);
    }
  });

  it('9. all prompt-based actions have non-empty systemPrompt (except translate)', () => {
    const chatActions = Object.values(AI_ACTION_REGISTRY).filter(
      (a: AiActionConfig) => a.dispatch === 'agent_chat',
    );
    for (const action of chatActions) {
      if (action.id === 'translate') {
        // Translate does NOT have a systemPrompt — message is built in dispatchAction
        expect(action.systemPrompt).toBeUndefined();
      } else {
        expect(action.systemPrompt).toBeTruthy();
        expect(typeof action.systemPrompt).toBe('string');
        expect(action.systemPrompt!.length).toBeGreaterThan(0);
      }
    }
  });
});

// ── Dispatch logic tests ──

describe('dispatchAction', () => {
  const docId = 'doc-123';
  const selectedText = 'Hello world';

  it('1. agent_chat action (improve) calls streamAgentChat with message containing systemPrompt + selectedText', async () => {
    await dispatchAction({
      selectedText,
      action: 'improve',
      documentId: docId,
    });

    expect(mockStreamAgentChat).toHaveBeenCalledTimes(1);
    const { message } = mockStreamAgentChat.mock.calls[0][0];
    expect(message).toContain('Improve the writing quality');
    expect(message).toContain(selectedText);
  });

  it('2. agent_tool action (add-details) names the add_details tool', async () => {
    await dispatchAction({
      selectedText,
      action: 'add-details',
      documentId: docId,
    });

    expect(mockStreamAgentChat).toHaveBeenCalledTimes(1);
    const { message } = mockStreamAgentChat.mock.calls[0][0];
    expect(message).toContain('add_details');
    expect(message).toContain(selectedText);
  });

  it('3. translate without language defaults to es-MX', async () => {
    await dispatchAction({
      selectedText,
      action: 'translate',
      documentId: docId,
    });

    expect(mockStreamAgentChat).toHaveBeenCalledTimes(1);
    const { message } = mockStreamAgentChat.mock.calls[0][0];
    expect(message).toContain('es-MX');
    expect(message).toContain(selectedText);
  });

  it('4. translate with language: "en-US" uses en-US', async () => {
    await dispatchAction({
      selectedText,
      action: 'translate',
      documentId: docId,
      language: 'en-US',
    });

    expect(mockStreamAgentChat).toHaveBeenCalledTimes(1);
    const { message } = mockStreamAgentChat.mock.calls[0][0];
    expect(message).toContain('en-US');
    expect(message).not.toContain('es-MX');
  });

  it('5. unknown action throws error', async () => {
    await expect(
      dispatchAction({
        selectedText,
        action: 'nonexistent' as AiAction,
        documentId: docId,
      }),
    ).rejects.toThrow(/Unknown action/);
  });

  it('passes document_id and handlers to streamAgentChat', async () => {
    const onToken = vi.fn();
    const onStatus = vi.fn();
    const onError = vi.fn();
    const ac = new AbortController();

    await dispatchAction({
      selectedText,
      action: 'grammar',
      documentId: docId,
      onToken,
      onStatus,
      onError,
      signal: ac.signal,
    });

    expect(mockStreamAgentChat).toHaveBeenCalledTimes(1);
    const [params, handlers, opts] = mockStreamAgentChat.mock.calls[0];

    expect(params.document_id).toBe(docId);
    expect(params.message).toContain(selectedText);
    expect(handlers.onToken).toBe(onToken);
    expect(handlers.onStatus).toBe(onStatus);
    expect(handlers.onError).toBe(onError);
    expect(opts?.signal).toBe(ac.signal);
  });

  it('agent_tool action (search-for-references) uses toolName search_citations', async () => {
    await dispatchAction({
      selectedText,
      action: 'search-for-references',
      documentId: docId,
    });

    expect(mockStreamAgentChat).toHaveBeenCalledTimes(1);
    const { message } = mockStreamAgentChat.mock.calls[0][0];
    expect(message).toContain('search_citations');
  });

  it('agent_tool action (more-concise) uses toolName more_concise', async () => {
    await dispatchAction({
      selectedText,
      action: 'more-concise',
      documentId: docId,
    });

    expect(mockStreamAgentChat).toHaveBeenCalledTimes(1);
    const { message } = mockStreamAgentChat.mock.calls[0][0];
    expect(message).toContain('more_concise');
  });
});

describe('dispatchAction — replacement-text contract', () => {
  const selectedText = 'The cat sat on the mat.';
  const docId = 'doc-1';

  beforeEach(() => {
    mockStreamAgentChat.mockClear();
    mockStreamAgentChat.mockResolvedValue({ chatId: null, threadId: null, usage: null });
  });

  it('runs in rewrite mode so the agent cannot edit the document', async () => {
    // The toolbar shows this behind an accept/reject prompt and applies it
    // itself; an agent with doc_edit would write the change regardless.
    await dispatchAction({ selectedText, action: 'improve', documentId: docId });
    expect(mockStreamAgentChat.mock.calls[0][0].mode).toBe('rewrite');
  });

  it('asks every action for replacement text only', async () => {
    // Whatever streams back is spliced into the paragraph verbatim, so a
    // "Here is the improved version:" preamble would land in the document.
    for (const action of ['improve', 'translate', 'add-details', 'search-for-references'] as const) {
      mockStreamAgentChat.mockClear();
      await dispatchAction({ selectedText, action, documentId: docId });
      const { message } = mockStreamAgentChat.mock.calls[0][0];
      expect(message).toContain('replacement text only');
      expect(message).toContain(selectedText);
    }
  });
});
