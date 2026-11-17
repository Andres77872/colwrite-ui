import type { AssistantSnapshot } from '@/api/assistant/agentSessionChat';
import type { ChatTurnOptions } from './chatUtils';
import type { AgentRunOutcome } from '../AgentRun';
import { questionAnswerText } from '@/lib/questionAnswers';
import type { AssistantRunSummary } from '@/api/schema';

function requestTurn(request: NonNullable<AssistantRunSummary['request']>, presetLabel?: string): ChatTurnOptions & { text: string } {
  return {
    text: request.message || presetLabel || request.preset || '',
    preset: request.preset ?? undefined,
    effort: request.effort ?? undefined,
    web: request.web,
    plan_id: request.plan_id ?? undefined,
    plan: request.plan ?? undefined,
    answers: request.answers ?? undefined,
    displayText: !request.message && request.answers
      ? questionAnswerText(undefined, request.answers)
      : !request.message && request.plan_id ? 'Write the approved plan, section by section.' : undefined,
    context: request.context ?? undefined,
    attachments: request.attachments,
  };
}

/** A new turn from the original request. No composer choice widens it. */
export function checkpointTurn(run: AssistantRunSummary, requestId: string, presetLabel?: string): (ChatTurnOptions & { text: string }) | null {
  if (!run.resumable || !run.session_id || !run.request) return null;
  return {
    ...requestTurn(run.request, presetLabel),
    checkpoint: { sessionId: run.session_id, runId: run.id, requestId },
  };
}

/**
 * How a chat turn recovers: from a chat deleted elsewhere, from a run whose
 * ending never arrived, and into a run already under way when the
 * conversation opens.
 */

/**
 * Whether "Try again" may reattach to the run the turn saved. Only a run
 * whose ending never arrived (`INCOMPLETE_STREAM`) is worth it: one the
 * server reported ended (a failed model call, a limit, a stop) replays its
 * saved events, and showed the same error every time.
 */
export function keepsRunLocator(code: string): boolean {
  return code === 'INCOMPLETE_STREAM';
}

/**
 * A chat id can outlive the chat it names: deleted from the chats panel in
 * another tab, or left behind in this browser after its page was removed.
 * The server answers `CHAT_NOT_FOUND` before the run starts, and the turn is
 * sent again once, as a new conversation on the page that is open. A
 * reattached run only observes, so its failure never resets anything.
 */
export function recoversAsNewChat(
  outcome: AgentRunOutcome,
  { resumed, recovered }: { resumed: boolean; recovered: boolean },
): boolean {
  return outcome.status === 'failed' && outcome.code === 'CHAT_NOT_FOUND' && !resumed && !recovered;
}

/** A run already under way, as a turn that observes it: its message, context and attachments, and where it is. */
export function resumedTurn(snapshot: AssistantSnapshot, presetLabel?: string): (ChatTurnOptions & { text: string }) | null {
  if (!snapshot.run) return null;
  return {
    ...requestTurn(snapshot.run.request, presetLabel),
    // From the run's first event: the session's earlier runs are not replayed (F19).
    resume: { sessionId: snapshot.session.id, runId: snapshot.run.id, afterSeq: snapshot.run.after_seq },
  };
}
