import { useMemo, useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { errorMessage } from '@/services/contracts';
import type {
  AgentCapabilityOption,
  AgentPaperSource,
  AgentToolOption,
  AgentToolSettings,
  AgentToolSettingsUpdate,
} from '@/services/agentTools';
import { useAgentTools } from './agentToolsContextState';
import { RefreshCw, RotateCcw } from 'lucide-react';

/**
 * What each tool does, in the author's terms. The catalog's own descriptions
 * are written for the model ("return a rewritten version containing
 * <citation/> tags", "pass a cite_as id") and read as noise here; they stay
 * available in the row's tooltip.
 */
const TOOL_COPY: Record<string, string> = {
  add_details: 'Expand a passage with context and examples.',
  more_concise: 'Tighten a passage without losing its meaning.',
  aibeat: 'Run your own instruction on a passage.',
  search_citations: 'Find sources for a passage and cite them inline.',
  semantic_scholar_search: 'Search Semantic Scholar for papers.',
  semantic_scholar_paper: 'Look up a paper’s details by DOI, arXiv id or title.',
  semantic_scholar_graph: 'Follow a paper’s references and the papers citing it.',
  semantic_scholar_recommendations: 'Suggest papers related to one you know.',
  semantic_scholar_snippets: 'Quote passages from papers as evidence.',
  validate_claim: 'Check whether the literature supports a claim.',
  web_search: 'Search the public web.',
  web_read: 'Read a web page found by a search.',
  resource_ls: 'See which PDFs this document can use.',
  resource_read: 'Read one of those PDFs.',
  resource_retrieve: 'Find the passages in your PDFs most relevant to a question.',
  resource_search: 'Find exact words in your PDFs.',
  doc_read: 'Re-read the page during a longer task.',
  doc_edit: 'Suggest edits to this page for you to review.',
  doc_create: 'Create new documents.',
};

/** Short copy for a tool: the map above, else its catalog text's first sentence. */
function toolCopy(tool: AgentToolOption): string {
  const known = TOOL_COPY[tool.id];
  if (known) return known;
  const first = tool.description.split(/(?<=\.)\s/)[0] ?? tool.description;
  return first.replace(/`/g, '');
}

function sourceSelections(
  sources: NonNullable<ReturnType<typeof useAgentTools>['settings']>['sources'],
): Record<string, boolean> {
  return Object.fromEntries(sources.map((source) => [source.id, source.enabled]));
}

function toolSelections(
  categories: NonNullable<ReturnType<typeof useAgentTools>['settings']>['categories'],
): Record<string, boolean> {
  return Object.fromEntries(
    categories.flatMap((category) => category.tools.map((tool) => [tool.id, tool.enabled])),
  );
}

function capabilitySelections(options: AgentCapabilityOption[] = [], defaults = false): Record<string, boolean> {
  return Object.fromEntries(options.map((option) => [option.id, defaults ? option.default_enabled : option.enabled]));
}

function sourceDependenciesEnabled(
  tool: AgentToolOption,
  sources: Record<string, boolean>,
  catalogSources: AgentPaperSource[],
): boolean {
  if (tool.requires_sources.length === 0) return true;
  const states = tool.requires_sources.map(
    (sourceId) =>
      sources[sourceId] === true &&
      catalogSources.some(
        (source) => source.id === sourceId && source.available,
      ),
  );
  return tool.source_policy === 'any' ? states.some(Boolean) : states.every(Boolean);
}

/**
 * Account preferences for the exact capability catalog served by the API.
 *
 * The server remains authoritative: this view edits persisted selections,
 * while every agent request independently resolves and enforces them.
 */
export function AgentToolsPreferences({ leading }: { leading?: ReactNode } = {}) {
  const {
    settings,
    loading,
    error: loadError,
    refresh,
    updateSettings,
  } = useAgentTools();

  if (!settings && loading) {
    return (
      <>
        {leading}
        <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading agent preferences…
        </div>
      </>
    );
  }

  if (!settings) {
    return (
      <section className="flex flex-col gap-8">
        {leading}
        <div>
          <Alert variant="destructive">
            {loadError ?? 'Agent preferences are unavailable.'}
          </Alert>
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? <Spinner /> : <RefreshCw aria-hidden="true" />}
            {loading ? 'Trying again…' : 'Try again'}
          </Button>
        </div>
      </section>
    );
  }

  // A new authoritative response intentionally remounts the draft. Ordinary
  // tab switches keep this component mounted (ProfileView uses forceMount),
  // so unsaved choices survive navigation between the Settings panes.
  return (
    <AgentToolsPreferencesForm
      key={JSON.stringify(settings)}
      settings={settings}
      loadError={loadError}
      updateSettings={updateSettings}
      leading={leading}
    />
  );
}

function AgentToolsPreferencesForm({
  settings,
  loadError,
  updateSettings,
  leading,
}: {
  settings: AgentToolSettings;
  loadError: string | null;
  updateSettings: (changes: AgentToolSettingsUpdate) => Promise<AgentToolSettings>;
  leading?: ReactNode;
}) {
  const { toast } = useToast();
  const [draftSources, setDraftSources] = useState<Record<string, boolean>>(() =>
    sourceSelections(settings.sources),
  );
  const [draftTools, setDraftTools] = useState<Record<string, boolean>>(() =>
    toolSelections(settings.categories),
  );
  const [saving, setSaving] = useState(false);
  const [draftSkills, setDraftSkills] = useState(() => capabilitySelections(settings.skills));
  const [draftFeatures, setDraftFeatures] = useState(() => capabilitySelections(settings.features));
  const [saveError, setSaveError] = useState<string | null>(null);

  const persisted = useMemo(
    () => ({
      sources: sourceSelections(settings.sources),
      tools: toolSelections(settings.categories),
      skills: capabilitySelections(settings.skills),
      features: capabilitySelections(settings.features),
    }),
    [settings],
  );
  const dirty =
    (JSON.stringify(draftSources) !== JSON.stringify(persisted.sources) ||
      JSON.stringify(draftTools) !== JSON.stringify(persisted.tools) ||
      JSON.stringify(draftSkills) !== JSON.stringify(persisted.skills) ||
      JSON.stringify(draftFeatures) !== JSON.stringify(persisted.features));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        sources: draftSources,
        tools: draftTools,
        ...(settings.skills ? { skills: draftSkills } : {}),
        ...(settings.features ? { features: draftFeatures } : {}),
      });
      toast({
        title: 'Agent preferences saved',
        description: 'New agent runs and paper searches now use this selection.',
        variant: 'success',
      });
    } catch (caught) {
      setSaveError(errorMessage(caught, 'Could not save agent preferences'));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (!settings) return;
    setDraftSources(
      Object.fromEntries(settings.sources.map((source) => [source.id, source.default_enabled])),
    );
    setDraftTools(
      Object.fromEntries(
        settings.categories.flatMap((category) =>
          category.tools.map((tool) => [tool.id, tool.default_enabled]),
        ),
      ),
    );
    setDraftSkills(capabilitySelections(settings.skills, true));
    setDraftFeatures(capabilitySelections(settings.features, true));
    setSaveError(null);
  };

  const tools = settings.categories.flatMap((category) => category.tools);
  const toolReady = (id: string, visiting = new Set<string>()): boolean => {
    const tool = tools.find((candidate) => candidate.id === id);
    if (!tool || !draftTools[id] || !tool.available || visiting.has(id)) return false;
    const path = new Set(visiting).add(id);
    return sourceDependenciesEnabled(tool, draftSources, settings.sources) &&
      (tool.requires_tools ?? []).every((required) => toolReady(required, path));
  };
  const toolLabels = (ids: string[]) =>
    ids.map((id) => tools.find((tool) => tool.id === id)?.label ?? id).join(', ');

  const capabilityRows = (kind: 'skills' | 'features') => {
    const draft = kind === 'skills' ? draftSkills : draftFeatures;
    const setDraft = kind === 'skills' ? setDraftSkills : setDraftFeatures;
    return (settings[kind] ?? []).map((option) => {
      const missing = option.requires_tools.filter((id) => !toolReady(id));
      const missingLabels = toolLabels(missing);
      const statusDescription = !option.available
        ? option.unavailable_reason || 'This capability is unavailable on this server.'
        : draft[option.id] && missing.length > 0
          ? `Enable ${missingLabels} and their dependencies below to use this ${kind === 'skills' ? 'skill' : 'feature'}.`
          : undefined;
      return (
        <SettingSwitchRow
          key={option.id}
          id={`agent-${kind}-${option.id}`}
          label={option.label}
          description={option.description}
          statusDescription={statusDescription}
          checked={draft[option.id] ?? false}
          disabled={saving || !option.available}
          onCheckedChange={(enabled) => setDraft((previous) => ({ ...previous, [option.id]: enabled }))}
          badges={
            <>
              {!option.default_enabled && <Badge variant="secondary">Opt-in</Badge>}
              {option.modes.length === 1 && option.modes[0] === 'assistant' && <Badge variant="secondary">Assistant only</Badge>}
              {!option.available && <Badge variant="destructive">Unavailable</Badge>}
              {option.available && draft[option.id] && missing.length > 0 && (
                <Badge variant="warning">Needs {missingLabels}</Badge>
              )}
            </>
          }
        />
      );
    });
  };

  const toolRows = (category: AgentToolSettings['categories'][number]) =>
    category.tools.map((tool) => {
      const controlId = `agent-tool-${tool.id}`;
      const checked = draftTools[tool.id] ?? false;
      const sourcesReady = sourceDependenciesEnabled(tool, draftSources, settings.sources);
      const missingTools = (tool.requires_tools ?? []).filter((id) => !toolReady(id));
      const sourceLabels = tool.requires_sources
        .filter((sourceId) => tool.source_policy === 'any' || !draftSources[sourceId] ||
          !settings.sources.some((source) => source.id === sourceId && source.available))
        .map(
          (sourceId) =>
            settings.sources.find((source) => source.id === sourceId)?.label ?? sourceId,
        )
        .join(tool.source_policy === 'any' ? ' or ' : ' and ');
      const requiredLabels = [!sourcesReady && sourceLabels, toolLabels(missingTools)]
        .filter(Boolean).join(', ');
      const statusDescription = tool.available && checked && requiredLabels
        ? [
          !sourcesReady && `Enable ${sourceLabels} under Paper search sources.`,
          missingTools.length > 0 && `Enable ${toolLabels(missingTools)} and their dependencies below.`,
        ].filter(Boolean).join(' ')
        : undefined;

      return (
        <SettingSwitchRow
          key={tool.id}
          id={controlId}
          label={tool.label}
          description={toolCopy(tool)}
          fullDescription={tool.description}
          statusDescription={statusDescription}
          checked={checked}
          disabled={saving || !tool.available}
          onCheckedChange={(next) =>
            setDraftTools((previous) => ({ ...previous, [tool.id]: next }))
          }
          badges={
            <>
              {tool.modes.length === 1 && tool.modes[0] === 'assistant' && (
                <Badge variant="secondary">Assistant only</Badge>
              )}
              {!tool.available && <Badge variant="destructive">Unavailable</Badge>}
              {tool.available && checked && requiredLabels && (
                <Badge variant="warning">
                  Needs {requiredLabels}
                </Badge>
              )}
            </>
          }
        />
      );
    });

  return (
    <section aria-labelledby="agent-preferences-title" className="flex flex-col gap-8">
      <div>
        <h2 id="agent-preferences-title" className="flex min-h-8 items-center text-lg font-semibold">
          AI &amp; tools
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Choose what the assistant may use on your account. Paper sources also decide what the
          citation picker searches and which research sources appear in the editor.
        </p>
      </div>

      {leading}

      {!!settings.features?.length && (
        <SettingsGroup id="agent-features" title="Planning & delegation"
          description="Let the assistant track multi-step work and delegate focused research. Subagents can use additional model capacity.">
          {capabilityRows('features')}
        </SettingsGroup>
      )}

      {!!settings.skills?.length && (
        <SettingsGroup id="agent-skills" title="Skills"
          description="Guides the assistant loads when relevant to your task. Skills use only the tools you enable below.">
          {capabilityRows('skills')}
        </SettingsGroup>
      )}

      <SettingsGroup
        id="paper-sources"
        title="Paper search sources"
        description="Semantic Scholar is opt-in and stays off until you turn it on."
      >
        {settings.sources.map((source) => {
          const controlId = `paper-source-${source.id}`;
          return (
            <SettingSwitchRow
              key={source.id}
              id={controlId}
              label={source.label}
              description={source.description}
              checked={draftSources[source.id] ?? false}
              disabled={saving || !source.available}
              onCheckedChange={(next) =>
                setDraftSources((previous) => ({ ...previous, [source.id]: next }))
              }
              badges={
                <>
                  {!source.default_enabled && <Badge variant="secondary">Opt-in</Badge>}
                  {!source.available && <Badge variant="destructive">Unavailable</Badge>}
                </>
              }
            />
          );
        })}
      </SettingsGroup>

      {settings.categories.map((category) => (
        <SettingsGroup
          key={category.id}
          id={`tool-category-${category.id}`}
          title={category.label}
          description={category.description}
          note={
            category.id === 'document'
              ? 'The visible page is always sent with a question. “Reload document snapshot” only controls the explicit re-read tool; it is not a document-privacy switch.'
              : undefined
          }
        >
          {toolRows(category)}
        </SettingsGroup>
      ))}

      {(saveError || loadError) && (
        <Alert variant="destructive">{saveError ?? loadError}</Alert>
      )}

      {/* Full-bleed across the pane, on the pane's own fill, with a hairline
          above: rows scroll under it instead of being cut by a floating bar. */}
      <div className="sticky bottom-0 -mx-5 -mb-8 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-5 py-3 sm:-mx-10 sm:px-10">
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={saving}>
          <RotateCcw aria-hidden="true" />
          Reset to defaults
        </Button>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          <Button type="button" size="sm" onClick={() => void save()} disabled={!dirty || saving}>
            {saving && <Spinner />}
            {saving ? 'Saving…' : 'Save preferences'}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** A titled group of setting rows between hairlines, as in the Preferences pane. */
function SettingsGroup({
  id,
  title,
  description,
  note,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-sm font-semibold text-foreground">
        {title}
      </h2>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      {note && <p className="mt-1.5 max-w-2xl text-xs text-muted-foreground">{note}</p>}
      <div className="mt-2 flex flex-col divide-y divide-border border-y border-border">{children}</div>
    </section>
  );
}

/**
 * One setting: its name (with any exception badge inline) and a one-line
 * description on the left, the switch on the right.
 */
function SettingSwitchRow({
  id,
  label,
  description,
  fullDescription,
  statusDescription,
  badges,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  fullDescription?: string;
  statusDescription?: string;
  badges?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium text-foreground">
          {label}
          {badges}
        </span>
        <span
          id={`${id}-description`}
          className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground"
          title={fullDescription && fullDescription !== description ? fullDescription : undefined}
        >
          {description}
        </span>
        {statusDescription && (
          <span id={`${id}-status`} className="mt-1 block text-xs text-muted-foreground">
            {statusDescription}
          </span>
        )}
      </label>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-describedby={`${id}-description${statusDescription ? ` ${id}-status` : ''}`}
      />
    </div>
  );
}
