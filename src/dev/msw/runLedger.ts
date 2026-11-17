/**
 * A run's ledger, as `done` reports it at the end, kept from the run's
 * events the way the API keeps its own (`ColWrite-api/src/agent/run/ledger.py`,
 * `docs/assistant-events.md#done`): each counter's use and limit, the cost
 * against the run's ceiling, the first limit the run reached, the trust
 * labels its tool results carried, and the writes of its own records that
 * failed.
 *
 * The limits are the run's effort tier's (`runtime_limits.py`, listed in
 * the catalog's `efforts`): a chat run is `standard` unless it names a tier,
 * an inline run is always `quick`, and a `deep` run with no approved plan
 * plans within `standard`'s limits. When a counter (tool calls, workers,
 * web or scholarly calls) crosses two thirds of its limit, and when it
 * reaches it, the ledger has a `budget` event to send (`takeBudget`).
 */
import type { AssistantEvent, DoneData, ReplyRecord } from '@/api/schema';
import { REGISTRY } from './assistantCatalog';

type Budget = NonNullable<DoneData['budget']>;
type Persistence = NonNullable<DoneData['persistence']>;
type Label = NonNullable<DoneData['labels']>[number];
/** What made a run answer: the first limit it reached. */
export type LimitReached = 'model_calls' | 'tool_calls' | 'cost' | 'events' | 'wall_clock';

type Effort = Budget['effort'];
type Tier = { model_calls: number; tool_calls: number; workers: number; cost: number | null; web_calls: number | null; scholarly_calls: number | null };

/** An effort tier's limits, as the catalog lists them (`effort_rows`). */
function tierOf(effort: Effort): Tier {
  const row = REGISTRY.efforts.find((item) => item.id === effort);
  if (!row) throw new Error(`No effort tier ${effort}`);
  const { budget } = row;
  return {
    model_calls: budget.model_calls, tool_calls: budget.tool_calls, workers: budget.workers, cost: budget.cost_limit,
    web_calls: budget.web_calls, scholarly_calls: budget.scholarly_calls,
  };
}

const toolById = new Map(REGISTRY.tools.map((tool) => [tool.id, tool]));

export class RunLedger {
  private readonly effort: Effort;
  private readonly limits: Tier;
  /** The crossings already announced: `<counter>:two_thirds`, `<counter>:reached`. */
  private readonly announced = new Set<string>();
  private pending = false;
  private toolCalls = 0;
  private readonly workers = new Set<string>();
  private readonly destinations = new Map<string, number>();
  private readonly labels = new Set<Label>();
  private readonly failedWrites = new Map<string, number>();
  private limitReached: LimitReached | null = null;
  private atModelLimit = false;

  constructor(profile: 'chat' | 'inline' | 'review', effort: Effort | null = null, planned = false) {
    this.effort = profile === 'inline' ? 'quick' : effort ?? 'standard';
    this.limits = tierOf(this.effort === 'deep' && !planned ? 'standard' : this.effort);
  }

  /** The counters with a limit, as they stand. */
  private counted(): Record<string, { used: number; limit: number | null }> {
    return {
      tool_calls: { used: this.toolCalls, limit: this.limits.tool_calls },
      workers: { used: this.workers.size, limit: this.limits.workers },
      web_calls: { used: this.destinations.get('web_calls') ?? 0, limit: this.limits.web_calls },
      scholarly_calls: { used: this.destinations.get('scholarly_calls') ?? 0, limit: this.limits.scholarly_calls },
    };
  }

  /** Note a counter that crossed two thirds of its limit, or reached it, once each. */
  private checkCrossings(): void {
    for (const [name, { used, limit }] of Object.entries(this.counted())) {
      if (!limit) continue;
      for (const [mark, share] of [['two_thirds', 2 / 3], ['reached', 1]] as const) {
        if (used / limit >= share && !this.announced.has(`${name}:${mark}`)) {
          this.announced.add(`${name}:${mark}`);
          this.pending = true;
        }
      }
    }
  }

  /** The `budget` event to send now, once per crossing, or `null`. */
  takeBudget(): Budget | null {
    if (!this.pending) return null;
    this.pending = false;
    return this.budgetOf(null, null);
  }

  private budgetOf(modelCalls: number | null, cost: number | null): Budget {
    const { web_calls: web, scholarly_calls: scholarly, ...counters } = this.counted();
    return {
      effort: this.effort,
      counters: {
        model_calls: { used: this.atModelLimit ? this.limits.model_calls : modelCalls ?? 0, limit: this.limits.model_calls },
        ...counters,
        ...Object.fromEntries(Object.entries({ web_calls: web, scholarly_calls: scholarly })
          .filter(([, counter]) => counter && (counter.used > 0 || counter.limit !== null))
          .sort(([a], [b]) => a.localeCompare(b))),
      } as Budget['counters'],
      cost,
      cost_limit: this.limits.cost,
      limit_reached: this.limitReached,
    };
  }

  observe(item: AssistantEvent): void {
    if (item.event === 'subagent') this.workers.add(item.data.id);
    // The run's own calls; a worker's are its own (`<worker id>:<call id>`).
    if (item.event === 'tool_call_start' && !item.data.tool_call_id.includes(':')) this.toolCalls += 1;
    // The outside parties a call reaches, by its arguments (`destinations_for`):
    // a search of the page's PDFs reaches the embedding provider only by meaning.
    if (item.event === 'tool_call_args' && !item.data.tool_call_id.includes(':')) {
      const args = item.data.arguments ?? {};
      for (const destination of toolById.get(item.data.tool)?.destinations ?? []) {
        if (Object.entries(destination.when ?? {}).some(([name, value]) => args[name] !== value)) continue;
        const name = `${destination.kind}_calls`;
        this.destinations.set(name, (this.destinations.get(name) ?? 0) + 1);
      }
    }
    this.checkCrossings();
    // A result carries its tool's trust labels.
    if (item.event === 'tool_call_end' && !item.data.is_error) {
      for (const label of toolById.get(item.data.tool)?.labels ?? []) {
        if (label === 'untrusted' || label === 'private') this.labels.add(label);
      }
    }
  }

  /** The first limit the run reached, after which its next model call was its answer. */
  reach(counter: LimitReached): void {
    this.limitReached ??= counter;
    if (counter === 'model_calls') this.atModelLimit = true;
    if (!this.announced.has(`${counter}:reached`)) {
      this.announced.add(`${counter}:reached`);
      this.pending = true;
    }
  }

  /** One write of the run's own records that failed and was dropped (`message`, `llm_call`, …). */
  failWrite(kind: string): void {
    this.failedWrites.set(kind, (this.failedWrites.get(kind) ?? 0) + 1);
  }

  /**
   * What the reply's record keeps of the ledger, whether or not the run
   * reached `done` (the API's `reply_record`): its cost ceiling and the
   * limit it answered at.
   */
  recorded(): Pick<ReplyRecord, 'cost_limit' | 'limit_reached'> {
    return { cost_limit: this.limits.cost, limit_reached: this.limitReached };
  }

  /** What `done` carries: the budget, the labels and the persistence, at the end. */
  report(done: Pick<DoneData, 'models' | 'cost'>): { budget: Budget; labels: Label[]; persistence: Persistence } {
    const modelCalls = done.models.filter((model) => model.tier === 'main').reduce((total, model) => total + model.calls, 0);
    return {
      budget: this.budgetOf(modelCalls, done.cost),
      labels: [...this.labels].sort(),
      persistence: {
        failed_writes: [...this.failedWrites.values()].reduce((total, count) => total + count, 0),
        kinds: [...this.failedWrites.keys()].sort(),
      },
    };
  }
}
