/**
 * The record a reply is stored with, kept from its run's events as the API
 * keeps it (`ColWrite-api/src/agent/notebook/turn_record.py`): each tool call
 * as its events showed it, the sources its `evidence` events sent (the
 * latest entry of each handle) and the passages they named, the task list as the turn
 * left it, each worker's last status, the change sets and pages, the claim
 * checks (at most 50), the plan and question card the turn left, from
 * `done` the models, usage and cost, and from the run's ledger its cost
 * ceiling and the limit it answered at. It holds nothing an event does not
 * show: arguments are the redacted projection, and no output preview.
 */
import type { AssistantEvent, EvidencePassage, EvidenceSource, RecordToolCall, ReplyRecord, SkillData } from '@/api/schema';

export type ReplyStatus = ReplyRecord['status'];

const MAX_TOOL_CALLS = 300;
const MAX_SOURCES = 200;
const MAX_PASSAGES = 2_000;
const MAX_CLAIMS = 50;
const MAX_ARGUMENTS_CHARS = 2_000;

/** A worker's calls are `<worker id>:<call id>`. */
function workerOf(toolCallId: string): string | null {
  const at = toolCallId.indexOf(':');
  return at > 0 ? toolCallId.slice(0, at) : null;
}

function bounded(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return JSON.stringify(value).length <= MAX_ARGUMENTS_CHARS ? (value as Record<string, unknown>) : null;
}

export class TurnRecord {
  private readonly calls = new Map<string, RecordToolCall>();
  private readonly sources = new Map<string, EvidenceSource>();
  private readonly passages = new Map<string, EvidencePassage>();
  private tasks: ReplyRecord['tasks'] = [];
  private readonly workers = new Map<string, ReplyRecord['workers'][number]>();
  private readonly skills = new Map<string, SkillData>();
  private instructions: ReplyRecord['instructions'] = [];
  private readonly changeSets: ReplyRecord['change_sets'] = [];
  private readonly createdPages: ReplyRecord['created_pages'] = [];
  private readonly claims: ReplyRecord['claims'] = [];
  private plan: ReplyRecord['plan'] = null;
  private question: ReplyRecord['question'] = null;
  private artifacts: ReplyRecord['artifacts'] = [];
  private error: ReplyRecord['error'] = null;
  private done: Pick<ReplyRecord, 'models' | 'usage' | 'cost'> | null = null;
  /** The streamed answer as it stands: what the author read. */
  text = '';

  observe(item: AssistantEvent): void {
    switch (item.event) {
      case 'token':
        this.text += item.data.content;
        return;
      case 'tool_call_start':
        this.call(item.data);
        return;
      case 'tool_call_args': {
        const call = this.call(item.data);
        if (call) call.arguments = bounded(item.data.arguments);
        return;
      }
      case 'tool_call_end': {
        const call = this.call(item.data);
        if (!call) return;
        const data = item.data;
        Object.assign(call, {
          arguments: call.arguments ?? bounded(data.arguments),
          duration_ms: Math.trunc(data.duration_ms || 0),
          is_error: data.is_error,
          error: data.error,
          error_type: data.error_type,
          output_chars: data.output_chars,
          output_truncated: data.output_truncated,
          finished: true,
        });
        return;
      }
      case 'tool_action': {
        const data = item.data;
        if (data.status === 'proposed' && data.change_set_id) {
          this.changeSets.push({
            tool_call_id: data.tool_call_id, tool: data.tool, change_set_id: data.change_set_id,
            document_id: data.document_id, apply_policy: data.apply_policy, auto_blocked_reason: data.auto_blocked_reason,
          });
        } else if (data.status === 'applied') {
          this.createdPages.push({
            tool_call_id: data.tool_call_id, document_id: data.document_id,
            workspace_id: data.workspace_id, collection_id: data.collection_id,
          });
        }
        return;
      }
      case 'evidence':
        for (const source of item.data.sources) {
          // A source sent again replaces the earlier entry.
          if (this.sources.has(source.handle) || this.sources.size < MAX_SOURCES) this.sources.set(source.handle, source);
        }
        // A passage is the same excerpt however often it is named: the first entry stays.
        for (const passage of item.data.passages) {
          if (!this.passages.has(passage.id) && this.passages.size < MAX_PASSAGES) this.passages.set(passage.id, passage);
        }
        return;
      case 'claim':
        if (this.claims.length < MAX_CLAIMS) this.claims.push(item.data);
        return;
      case 'plan':
        this.plan = item.data;
        return;
      case 'question':
        this.question = item.data;
        return;
      case 'artifact':
        this.artifacts = [...this.artifacts.filter((artifact) => artifact.generation_id !== item.data.generation_id), item.data].slice(-20);
        return;
      case 'todo':
        this.tasks = [...item.data.items];
        return;
      case 'subagent':
        this.workers.set(item.data.id, { ...item.data });
        return;
      case 'skill':
        this.skills.set(`${item.data.id}:${item.data.resource ?? ''}`, item.data);
        return;
      case 'instructions':
        this.instructions = item.data.items;
        return;
      case 'error':
        this.error = { code: item.data.error_code || 'STREAM_ERROR', message: item.data.message };
        return;
      case 'done':
        this.done = { models: item.data.models, usage: item.data.usage, cost: item.data.cost };
        return;
      default:
        return;
    }
  }

  private call(data: { tool: string; tool_call_id: string }): RecordToolCall | null {
    const existing = this.calls.get(data.tool_call_id);
    if (existing) return existing;
    if (this.calls.size >= MAX_TOOL_CALLS) return null;
    const call: RecordToolCall = {
      tool_call_id: data.tool_call_id, tool: data.tool || 'unknown_tool', worker_id: workerOf(data.tool_call_id),
      arguments: null, duration_ms: null, is_error: false, error: null, error_type: null,
      output_chars: 0, output_truncated: false, finished: false,
    };
    this.calls.set(data.tool_call_id, call);
    return call;
  }

  /** The turn did something the author saw besides its text. */
  get hasActivity(): boolean {
    return this.calls.size > 0 || this.workers.size > 0 || this.changeSets.length > 0 || this.createdPages.length > 0;
  }

  /** The record as it stands, with what the run's ledger kept (`RunLedger.recorded`). */
  snapshot(status: ReplyStatus, ledger: Pick<ReplyRecord, 'cost_limit' | 'limit_reached'>): ReplyRecord {
    return structuredClone({
      kind: 'reply',
      status,
      tool_calls: [...this.calls.values()],
      sources: [...this.sources.values()],
      passages: [...this.passages.values()],
      tasks: this.tasks,
      workers: [...this.workers.values()],
      skills: [...this.skills.values()],
      instructions: this.instructions,
      change_sets: this.changeSets,
      created_pages: this.createdPages,
      claims: this.claims,
      plan: this.plan,
      question: this.question,
      artifacts: this.artifacts,
      models: this.done?.models ?? [],
      usage: this.done?.usage ?? { prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0 },
      cost: this.done?.cost ?? null,
      cost_limit: ledger.cost_limit,
      limit_reached: ledger.limit_reached,
      error: status === 'failed' ? this.error : null,
    });
  }
}
