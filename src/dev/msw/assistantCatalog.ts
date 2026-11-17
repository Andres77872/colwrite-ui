/**
 * The assistant's catalog and the account's switches, computed the way the
 * API computes them (`ColWrite-api/src/agent/policy/catalog.py`,
 * `switches.py` and `src/agent/run/toolset.py`), from a copy of the API's
 * registry (`assistantRegistry.json`: each tool's display, effects, profiles,
 * needs, destinations and trust labels; the toolsets, presets, skills,
 * switches and paper sources; each engine's capability record).
 *
 * A tool's state is the strongest of the rules that take it away, in the
 * API's order: the server or the engine (`unavailable`), then the
 * workspace's policy or the caller's role (`blocked`), then the account's own
 * switches (`off`), each with the API's words. The mock server is configured
 * with web search, OpenAlex and Semantic Scholar, without the arXiv index,
 * semantic retrieval or image generation (`MOCK_DEPLOYMENT`).
 */
import type {
  AssistantCatalogResponse,
  AssistantSettingsResponse,
  AssistantSwitch,
  CatalogEffort,
  CatalogPreset,
  CatalogSkill,
  CatalogTool,
  CatalogToolset,
  CatalogWorker,
  UpdateAssistantSettingsRequest,
  WorkspacePolicyModel,
} from '@/api/schema';
import registry from './assistantRegistry.json';

export type CatalogState = CatalogTool['state'];
type Profile = CatalogTool['profiles'][number];
type SwitchId = AssistantSwitch['id'];
export type EngineId = AssistantCatalogResponse['engine'];
type Role = AssistantCatalogResponse['role'];
type DestinationKind = 'web' | 'scholarly' | 'embeddings' | 'images';

type RegistryTool = Omit<CatalogTool, 'state' | 'reason' | 'effects' | 'profiles'> & {
  effects: CatalogTool['effects'];
  profiles: Profile[];
  needs: { switch?: SwitchId; sources?: string[]; tools?: string[]; deployment?: string; engine?: string; run?: string; workers?: boolean };
  /** The outside parties its arguments reach; one with `when` only for a call whose arguments have those values. */
  destinations?: Array<{ kind: DestinationKind; optional?: boolean; when?: Record<string, string> }>;
  skill?: string;
  /** The trust labels its results carry (`untrusted`, `private`). */
  labels?: string[];
};
type Effort = CatalogEffort['id'];
type Registry = {
  profiles: Array<{ id: Profile; label: string; efforts: Effort[]; default_effort: Effort }>;
  /** The effort tiers, with what a run of each may spend under the default limits and what it does not get (`effort_rows`; `resume` is per engine). */
  efforts: Array<Omit<CatalogEffort, 'resume'>>;
  /** The worker profiles (`WORKER_PROFILES`): the tools each may use of the registry's, and those that make it useful. */
  workers: Array<Omit<CatalogWorker, 'state' | 'reason'> & { core_toolsets: string[] }>;
  toolsets: Array<{ id: string; label: string; description: string; switch: SwitchId | null }>;
  tools: RegistryTool[];
  presets: Array<Omit<CatalogPreset, 'state' | 'reason'> & { requires: string[] }>;
  skills: Array<Omit<CatalogSkill, 'state' | 'reason'>>;
  switches: Array<{ id: SwitchId; label: string; description: string; default: boolean; destination: DestinationKind | null; deployment: string | null }>;
  sources: Array<{ id: AssistantSwitch['sources'][number]['id']; label: string; description: string; default: boolean }>;
  engines: Record<EngineId, Record<string, unknown>>;
};

/** The API's registry, as `assistantRegistry.json` copies it. */
export const REGISTRY = registry as unknown as Registry;

/** What the mock server is configured with (`Deployment.from_env()`), and why a paper source it lacks is missing. */
export const MOCK_DEPLOYMENT = {
  capabilities: new Set(['web_search']),
  paperSources: new Set(['openalex', 'semantic_scholar']),
  paperSourceReasons: new Map([['arxiv_index', 'Not configured on this server.']]),
};

function paperSourceReason(id: string): string {
  return MOCK_DEPLOYMENT.paperSourceReasons.get(id) ?? NOT_CONFIGURED;
}

/** "A and B", "A, B and C" (`_listed`). */
function listed(labels: readonly string[], conjunction: string): string {
  if (labels.length < 3) return labels.join(` ${conjunction} `);
  return `${labels.slice(0, -1).join(', ')} ${conjunction} ${labels.at(-1)}`;
}

/** Why none of a tool's paper sources can be used (`_no_source`). */
function noSource(sources: readonly string[]): string {
  if (sources.length === 1) {
    const [source] = sources as [string];
    return `${sourceRecord(source).label}: ${paperSourceReason(source)}`;
  }
  return `Needs ${listed(sources.map((source) => sourceRecord(source).label), 'or')}; none is available on this server.`;
}

/** The account's switches, as `preferences.assistant` stores them: overrides of the defaults only. */
export type AccountSwitches = { switches: Partial<Record<SwitchId, boolean>>; sources: Partial<Record<string, boolean>> };

const NOT_CONFIGURED = 'Not configured on this server.';
const OFF_HERE = 'Switched off in this workspace.';
const OFF_FOR_YOU = 'Switched off in your settings.';
const DESTINATION_NAMES: Record<DestinationKind, string> = {
  web: 'Web search', scholarly: 'Outside research', embeddings: 'Semantic retrieval', images: 'Images',
};
const DESTINATION_SWITCHES: Partial<Record<DestinationKind, keyof WorkspacePolicyModel>> = {
  web: 'web_search', scholarly: 'outside_research', images: 'images',
};

const switchRecord = (id: SwitchId) => REGISTRY.switches.find((item) => item.id === id)!;
const sourceRecord = (id: string) => REGISTRY.sources.find((item) => item.id === id)!;

function switchOn(account: AccountSwitches, id: SwitchId): boolean {
  return account.switches[id] ?? switchRecord(id).default;
}
function sourceChosen(account: AccountSwitches, id: string): boolean {
  return account.sources[id] ?? sourceRecord(id).default;
}
/** The source is on, and so is Papers, which holds it. */
function sourceOn(account: AccountSwitches, id: string): boolean {
  return switchOn(account, 'papers') && sourceChosen(account, id);
}
function allows(policy: WorkspacePolicyModel, destination: DestinationKind): boolean {
  const name = DESTINATION_SWITCHES[destination];
  return name === undefined || policy[name];
}

type Status = { state: CatalogState; reason: string | null };
const ON: Status = { state: 'on', reason: null };
type CutReason = 'profile' | 'deployment' | 'engine' | 'account' | 'workspace' | 'role' | 'effort' | 'request' | 'needs';
type Cut = { tool: string; reason: CutReason; detail: string; because?: string };
const STATE_OF: Partial<Record<CutReason, CatalogState>> = {
  deployment: 'unavailable', engine: 'unavailable', workspace: 'blocked', role: 'blocked', account: 'off', effort: 'unavailable',
};

/** Each profile at the tier its requests run at by default; what another tier takes away is that tier's `cuts`. */
const defaultEffort = (profile: Profile): Effort => REGISTRY.profiles.find((item) => item.id === profile)!.default_effort;
const tierWorkers = (effort: Effort): number => REGISTRY.efforts.find((item) => item.id === effort)!.budget.workers;
const RANK: Record<CatalogState, number> = { unavailable: 0, blocked: 1, off: 2, on: 3 };
const strongest = (statuses: Status[]) => statuses.reduce((best, item) => (RANK[item.state] < RANK[best.state] ? item : best));

type Rules = { account: AccountSwitches; policy: WorkspacePolicyModel; canEdit: boolean; engine: EngineId };

const writes = (tool: RegistryTool) => tool.effects.some((effect) => effect === 'propose' || effect === 'create');

/** Every rule that takes `tool` away, in the API's order (`tool_cuts`). */
function toolCuts(tool: RegistryTool, profile: Profile, rules: Rules, effort: Effort, web: boolean): Cut[] {
  const { needs } = tool;
  if (!tool.profiles.includes(profile)) return [{ tool: tool.id, reason: 'profile', detail: `Not offered to an ${profile} run.` }];
  const cuts: Cut[] = [];
  if (needs.deployment && !MOCK_DEPLOYMENT.capabilities.has(needs.deployment)) {
    cuts.push({ tool: tool.id, reason: 'deployment', detail: NOT_CONFIGURED });
  }
  // A tool that queries paper sources needs one of them: configured and
  // usable on the server, and on for the account.
  const usable = (needs.sources ?? []).filter((source) => MOCK_DEPLOYMENT.paperSources.has(source));
  if (needs.sources?.length && usable.length === 0) {
    cuts.push({ tool: tool.id, reason: 'deployment', detail: noSource(needs.sources) });
  }
  if (needs.engine && !REGISTRY.engines[rules.engine][needs.engine]) {
    cuts.push({ tool: tool.id, reason: 'engine', detail: `The ${rules.engine} engine cannot run it.` });
  }
  if (needs.switch && !switchOn(rules.account, needs.switch)) {
    cuts.push({ tool: tool.id, reason: 'account', detail: `${switchRecord(needs.switch).label} is switched off in your settings.` });
  } else if (needs.switch && usable.length > 0 && !usable.some((source) => sourceOn(rules.account, source))) {
    const labels = usable.map((source) => sourceRecord(source).label);
    cuts.push({ tool: tool.id, reason: 'account', detail: `${listed(labels, 'and')} ${labels.length === 1 ? 'is' : 'are'} switched off in your settings.` });
  }
  for (const destination of tool.destinations ?? []) {
    if (!destination.optional && !allows(rules.policy, destination.kind)) {
      cuts.push({ tool: tool.id, reason: 'workspace', detail: `${DESTINATION_NAMES[destination.kind]} is switched off in this workspace.` });
    }
  }
  if (writes(tool) && !rules.canEdit) cuts.push({ tool: tool.id, reason: 'role', detail: 'Needs the editor role.' });
  // A tool that starts workers, in a tier that starts none (`effort_cut`).
  if (needs.workers && tierWorkers(effort) <= 0) cuts.push({ tool: tool.id, reason: 'effort', detail: `A ${effort} run starts no workers.` });
  if (tool.toolset === 'web' && !web) cuts.push({ tool: tool.id, reason: 'request', detail: 'Web is switched off for this turn.' });
  return cuts;
}

/** The skills a run of `profile` with these tools may load (`skills_for_run`). */
export function skillsForRun(profile: Profile, tools: ReadonlySet<string>): Set<string> {
  const brought = new Set(REGISTRY.tools.filter((tool) => tools.has(tool.id) && tool.skill).map((tool) => tool.skill as string));
  const served = new Set(REGISTRY.tools.flatMap((tool) => tool.skill ? [tool.skill] : []));
  const toolsets = new Set(REGISTRY.tools.filter((tool) => tools.has(tool.id)).map((tool) => tool.toolset));
  return new Set(
    REGISTRY.skills
      .filter((skill) => skill.profiles.includes(profile)
        && skill.needs.every((id) => toolsets.has(id))
        && (!served.has(skill.id) || brought.has(skill.id)))
      .map((skill) => skill.id),
  );
}

/** A run's tools and the cuts of the others (`resolve_toolset`), with attached PDFs held. */
export function resolveRunToolset(profile: Profile, rules: Rules, effort: Effort, web: boolean): { has: Set<string>; cuts: Map<string, Cut> } {
  const cuts = new Map<string, Cut>();
  const candidates: RegistryTool[] = [];
  for (const tool of REGISTRY.tools) {
    const cut = toolCuts(tool, profile, rules, effort, web)[0];
    if (cut) cuts.set(tool.id, cut);
    else candidates.push(tool);
  }
  const chosen = new Set<string>();
  for (const tool of candidates) {
    const missing = (tool.needs.tools ?? []).filter((id) => !chosen.has(id));
    if (missing.length) cuts.set(tool.id, { tool: tool.id, reason: 'needs', detail: `Needs ${missing.join(', ')}.`, because: missing[0] });
    else if (tool.needs.run === 'skills' && skillsForRun(profile, chosen).size === 0) {
      cuts.set(tool.id, { tool: tool.id, reason: 'needs', detail: "No skill serves this run's tools." });
    } else chosen.add(tool.id);
  }
  return { has: chosen, cuts };
}

/** The states of one account here, on one engine: every profile's toolset, as the catalog reads them. */
function resolution(rules: Rules) {
  // The capability catalog advertises what a turn could enable, before
  // the turn's default-off Web choice narrows it.
  const toolsets = new Map(REGISTRY.profiles.map((profile) => [profile.id, resolveRunToolset(profile.id, rules, profile.default_effort, true)]));
  const byId = new Map(REGISTRY.tools.map((tool) => [tool.id, tool]));
  const inProfile = (id: string, profile: Profile): Status => {
    const toolset = toolsets.get(profile)!;
    if (toolset.has.has(id)) return ON;
    const cut = toolset.cuts.get(id);
    if (!cut) return ON;
    if (cut.reason === 'needs') return cut.because ? inProfile(cut.because, profile) : { state: 'unavailable', reason: cut.detail };
    const statuses = [cut, ...toolCuts(byId.get(id)!, profile, rules, defaultEffort(profile), true)]
      .filter((item) => STATE_OF[item.reason] !== undefined)
      .map((item) => ({ state: STATE_OF[item.reason]!, reason: item.detail }));
    return statuses.length ? strongest(statuses) : { state: 'unavailable', reason: cut.detail };
  };
  const ofTool = (tool: RegistryTool): Status => {
    const statuses = tool.profiles.map((profile) => inProfile(tool.id, profile));
    return statuses.find((status) => status.state === 'on') ?? statuses[0]!;
  };
  const ofTools = (tools: RegistryTool[]): Status => {
    const statuses = tools.map(ofTool);
    return !statuses.length || statuses.some((status) => status.state === 'on') ? ON : strongest(statuses);
  };
  return { inProfile, ofTool, ofTools, runs: toolsets, chatTools: toolsets.get('chat')!.has };
}

/** `on` in a profile whose final toolsets serve it, else the strongest missing requirement (`_skill_status`). */
function skillStatus(skill: Registry['skills'][number], states: ReturnType<typeof resolution>): Status {
  const served = REGISTRY.tools.filter((tool) => tool.skill === skill.id);
  if (served.length) return states.ofTools(served);
  const statuses: Status[] = [];
  for (const profile of skill.profiles) {
    const run = states.runs.get(profile);
    if (!run) continue;
    if (skillsForRun(profile, run.has).has(skill.id)) return ON;
    const have = new Set(REGISTRY.tools.filter((tool) => run.has.has(tool.id)).map((tool) => tool.toolset));
    const missing = skill.needs.filter((id) => !have.has(id));
    for (const id of missing) {
      const members = REGISTRY.tools.filter((tool) => tool.toolset === id && tool.profiles.includes(profile));
      statuses.push(members.length
        ? strongest(members.map((tool) => states.inProfile(tool.id, profile)))
        : { state: 'unavailable', reason: `Needs ${REGISTRY.toolsets.find((row) => row.id === id)!.label}, which an ${profile} run does not have.` });
    }
    const loader = REGISTRY.tools.find((tool) => tool.needs.run === 'skills');
    if (!missing.length && loader) statuses.push(states.inProfile(loader.id, profile));
  }
  const cut = statuses.filter((status) => status.state !== 'on');
  return cut.length ? strongest(cut) : { state: 'unavailable', reason: NOT_CONFIGURED };
}

/**
 * Each worker profile: `on` when a chat run here could start it, else why
 * not (`_worker_rows`). It needs `delegate`, and a tool of its own (a web
 * researcher Papers or Web); the reason is the strongest of what takes them
 * away.
 */
function workerRows(states: ReturnType<typeof resolution>): CatalogWorker[] {
  const delegate = REGISTRY.tools.find((tool) => tool.needs.workers);
  const toolsetOf = new Map(REGISTRY.tools.map((tool) => [tool.id, tool.toolset]));
  return REGISTRY.workers.map(({ core_toolsets: core, ...worker }) => {
    let status: Status = delegate ? states.inProfile(delegate.id, 'chat') : { state: 'unavailable', reason: null };
    const usable = worker.tools.some((id) => states.chatTools.has(id) && core.includes(toolsetOf.get(id) ?? ''));
    if (status.state === 'on' && !usable) {
      const cut = REGISTRY.tools
        .filter((tool) => core.includes(tool.toolset) && worker.tools.includes(tool.id) && tool.profiles.includes('chat'))
        .map((tool) => states.inProfile(tool.id, 'chat'))
        .filter((item) => item.state !== 'on');
      status = cut.length ? strongest(cut) : { state: 'unavailable', reason: NOT_CONFIGURED };
    }
    return { ...worker, ...status };
  });
}

/** Whether a run of the tier, on the engine, can be resumed after an interruption (`_resume`). */
function resumeOf(effort: Effort, engine: EngineId, engineLabel: string): CatalogEffort['resume'] {
  if (effort !== 'deep') return { state: 'unavailable', reason: 'Only a deep run checkpoints and can be resumed.' };
  if (!REGISTRY.engines[engine].checkpoints) {
    return { state: 'unavailable', reason: `A deep run on ${engineLabel} does not checkpoint, so it cannot be resumed if it is interrupted.` };
  }
  return { state: 'on', reason: null };
}

function switchState(id: SwitchId, account: AccountSwitches, policy: WorkspacePolicyModel): Status {
  const record = switchRecord(id);
  if (record.deployment && !MOCK_DEPLOYMENT.capabilities.has(record.deployment)) return { state: 'unavailable', reason: NOT_CONFIGURED };
  if (id === 'papers' && MOCK_DEPLOYMENT.paperSources.size === 0) {
    return { state: 'unavailable', reason: 'No paper source is available on this server.' };
  }
  if (record.destination && !allows(policy, record.destination)) return { state: 'blocked', reason: OFF_HERE };
  return switchOn(account, id) ? ON : { state: 'off', reason: OFF_FOR_YOU };
}

function sourceState(id: string, account: AccountSwitches, policy: WorkspacePolicyModel): Status {
  if (!MOCK_DEPLOYMENT.paperSources.has(id)) return { state: 'unavailable', reason: paperSourceReason(id) };
  if (!allows(policy, 'scholarly')) return { state: 'blocked', reason: OFF_HERE };
  if (!switchOn(account, 'papers')) return { state: 'off', reason: 'Papers is switched off in your settings.' };
  return sourceOn(account, id) ? ON : { state: 'off', reason: OFF_FOR_YOU };
}

const UNRESTRICTED: WorkspacePolicyModel = { web_search: true, outside_research: true, auto: true, images: true };

/** Every switch, in order, with its sources (`switches_payload`). */
function switchesPayload(account: AccountSwitches, policy: WorkspacePolicyModel): AssistantSwitch[] {
  return REGISTRY.switches.map((record) => ({
    id: record.id,
    label: record.label,
    description: record.description,
    default: record.default,
    enabled: switchOn(account, record.id),
    ...switchState(record.id, account, policy),
    sources: record.id !== 'papers' ? [] : REGISTRY.sources.map((source) => ({
      id: source.id,
      label: source.label,
      description: source.description,
      default: source.default,
      enabled: sourceChosen(account, source.id),
      ...sourceState(source.id, account, policy),
    })),
  }));
}

/** `GET /users/me/assistant`: no workspace, so nothing is blocked. */
export function assistantSettingsOf(account: AccountSwitches): AssistantSettingsResponse {
  return { switches: switchesPayload(account, UNRESTRICTED) };
}

/**
 * `PUT /users/me/assistant`: the switches and sources named change, stored
 * as overrides of their defaults only (a value equal to its default removes
 * the override). The body is the contract's; the handler refuses others.
 */
export function updateAccountSwitches(account: AccountSwitches, body: UpdateAssistantSettingsRequest): AccountSwitches {
  const next: AccountSwitches = { switches: { ...account.switches }, sources: { ...account.sources } };
  for (const record of REGISTRY.switches) {
    const value = body[record.id];
    if (typeof value !== 'boolean') continue;
    if (value === record.default) delete next.switches[record.id];
    else next.switches[record.id] = value;
  }
  for (const [id, value] of Object.entries(body.sources ?? {})) {
    if (typeof value !== 'boolean') continue;
    if (value === sourceRecord(id).default) delete next.sources[id];
    else next.sources[id] = value;
  }
  return next;
}

/** One engine as a request sees it: its gate's state, and its capability record. */
export type EngineGate = { id: EngineId; label: string; available: boolean; message: string };

/** `GET /workspaces/{w}/assistant/catalog?engine=` (`assistant_catalog`). */
export function assistantCatalog(options: {
  account: AccountSwitches;
  policy: WorkspacePolicyModel;
  role: Role;
  engine: EngineId;
  engines: EngineGate[];
}): AssistantCatalogResponse {
  const { account, policy, role, engine } = options;
  const canEdit = role !== 'viewer';
  const states = resolution({ account, policy, canEdit, engine });
  const toolsets: CatalogToolset[] = REGISTRY.toolsets.flatMap((toolset) => {
    const members = REGISTRY.tools.filter((tool) => tool.toolset === toolset.id);
    return members.length ? [{ ...toolset, ...states.ofTools(members) }] : [];
  });
  const skills: CatalogSkill[] = REGISTRY.skills.map((skill) => ({ ...skill, ...skillStatus(skill, states) }));
  const presets: CatalogPreset[] = REGISTRY.presets.map(({ requires, ...preset }) => ({
    ...preset,
    ...(requires.map((tool) => states.inProfile(tool, preset.profile)).find((status) => status.state !== 'on') ?? ON),
  }));
  return {
    engine,
    role,
    profiles: REGISTRY.profiles.map((profile) => ({
      ...profile,
      toolsets: [...new Set(REGISTRY.tools.filter((tool) => tool.profiles.includes(profile.id)).map((tool) => tool.toolset))],
    })),
    efforts: REGISTRY.efforts.map((effort) => ({
      ...structuredClone(effort),
      resume: resumeOf(effort.id, engine, options.engines.find((gate) => gate.id === engine)?.label ?? engine),
    })),
    workers: workerRows(states),
    switches: switchesPayload(account, policy),
    toolsets,
    tools: REGISTRY.tools.map(({ needs: _needs, destinations: _destinations, skill: _skill, labels: _labels, ...tool }) => ({
      ...tool,
      ...states.ofTool(REGISTRY.tools.find((item) => item.id === tool.id)!),
    })),
    presets,
    skills,
    engines: options.engines.map((gate) => ({
      id: gate.id,
      label: gate.label,
      state: gate.available ? 'on' : 'unavailable',
      reason: gate.available ? null : gate.message,
      capabilities: REGISTRY.engines[gate.id],
    })),
    policy: { ...policy },
  };
}

/** A tool of the catalog, by id: the scripted turns name only these (and one the catalog lacks, on purpose). */
export function registryTool(id: string): RegistryTool {
  const tool = REGISTRY.tools.find((item) => item.id === id);
  if (!tool) throw new Error(`The mock's registry has no tool ${id}`);
  return tool;
}
