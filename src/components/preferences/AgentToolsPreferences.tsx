import { useMemo, useState, type ElementType } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { errorMessage } from '@/services/contracts';
import type {
  AgentPaperSource,
  AgentToolOption,
  AgentToolSettings,
  AgentToolSettingsUpdate,
} from '@/services/agentTools';
import { useAgentTools } from './agentToolsContextState';
import {
  BookOpen,
  FilePenLine,
  PenLine,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Wrench,
} from 'lucide-react';

const CATEGORY_ICONS: Record<string, ElementType> = {
  writing: PenLine,
  research: Search,
  library: BookOpen,
  document: FilePenLine,
};

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

function dependenciesEnabled(
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
export function AgentToolsPreferences() {
  const {
    settings,
    loading,
    error: loadError,
    refresh,
    updateSettings,
  } = useAgentTools();

  if (!settings && loading) {
    return (
      <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Loading agent preferences…
      </div>
    );
  }

  if (!settings) {
    return (
      <section className="rounded-xl border border-border/60 bg-card p-4">
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
      </section>
    );
  }

  // A new authoritative response intentionally remounts the draft. Ordinary
  // tab switches keep this component mounted (ProfileView uses forceMount),
  // so unsaved choices survive navigation between Overview and Agent tools.
  return (
    <AgentToolsPreferencesForm
      key={JSON.stringify(settings)}
      settings={settings}
      loadError={loadError}
      updateSettings={updateSettings}
    />
  );
}

function AgentToolsPreferencesForm({
  settings,
  loadError,
  updateSettings,
}: {
  settings: AgentToolSettings;
  loadError: string | null;
  updateSettings: (changes: AgentToolSettingsUpdate) => Promise<AgentToolSettings>;
}) {
  const { toast } = useToast();
  const [draftSources, setDraftSources] = useState<Record<string, boolean>>(() =>
    sourceSelections(settings.sources),
  );
  const [draftTools, setDraftTools] = useState<Record<string, boolean>>(() =>
    toolSelections(settings.categories),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const persisted = useMemo(
    () => ({
      sources: sourceSelections(settings.sources),
      tools: toolSelections(settings.categories),
    }),
    [settings],
  );
  const dirty =
    (JSON.stringify(draftSources) !== JSON.stringify(persisted.sources) ||
      JSON.stringify(draftTools) !== JSON.stringify(persisted.tools));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateSettings({ sources: draftSources, tools: draftTools });
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
    setSaveError(null);
  };

  return (
    <section aria-labelledby="agent-preferences-title" className="flex flex-col gap-4">
      <div className="rounded-xl border border-border/60 bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Settings2 aria-hidden="true" className="h-5 w-5 text-primary" />
              <h1 id="agent-preferences-title" className="text-lg font-semibold">
                Agent tools and paper sources
              </h1>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Choose what the assistant may call. Paper-source choices also control new
              searches in the citation picker and which research panels appear in the editor.
            </p>
          </div>
          <Badge variant="outline">Account-wide</Badge>
        </div>

        <div className="mt-4">
          <h2 className="text-sm font-semibold">Paper search sources</h2>
          <p className="text-xs text-muted-foreground">
            Semantic Scholar is opt-in and stays off for new and legacy accounts until enabled.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {settings.sources.map((source) => {
              const controlId = `paper-source-${source.id}`;
              const checked = draftSources[source.id] ?? false;
              return (
                <label
                  key={source.id}
                  htmlFor={controlId}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-accent/30"
                >
                  <Checkbox
                    id={controlId}
                    checked={checked}
                    disabled={saving || !source.available}
                    onCheckedChange={(next) =>
                      setDraftSources((previous) => ({
                        ...previous,
                        [source.id]: next === true,
                      }))
                    }
                    aria-describedby={`${controlId}-description`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {source.label}
                      {!source.default_enabled && <Badge variant="secondary">Opt-in</Badge>}
                      {!source.available && <Badge variant="destructive">Unavailable</Badge>}
                    </span>
                    <span
                      id={`${controlId}-description`}
                      className="mt-0.5 block text-xs text-muted-foreground"
                    >
                      {source.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {settings.categories.map((category) => {
        const Icon = CATEGORY_ICONS[category.id] ?? Wrench;
        return (
          <section
            key={category.id}
            aria-labelledby={`tool-category-${category.id}`}
            className="rounded-xl border border-border/60 bg-card p-4"
          >
            <div className="flex items-start gap-2">
              <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <h2 id={`tool-category-${category.id}`} className="text-sm font-semibold">
                  {category.label}
                </h2>
                <p className="text-xs text-muted-foreground">{category.description}</p>
              </div>
            </div>

            {category.id === 'document' && (
              <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                The current document’s visible snapshot is always supplied as conversation
                context. “Reload document snapshot” controls only the explicit re-read tool;
                it is not a document-privacy switch.
              </p>
            )}

            <div className="mt-3 divide-y divide-border/60 rounded-lg border border-border/70">
              {category.tools.map((tool) => {
                const controlId = `agent-tool-${tool.id}`;
                const checked = draftTools[tool.id] ?? false;
                const dependenciesReady = dependenciesEnabled(
                  tool,
                  draftSources,
                  settings.sources,
                );
                const effective = checked && tool.available && dependenciesReady;
                const requiredLabels = tool.requires_sources
                  .map(
                    (sourceId) =>
                      settings.sources.find((source) => source.id === sourceId)?.label ?? sourceId,
                  )
                  .join(tool.source_policy === 'any' ? ' or ' : ' and ');

                return (
                  <label
                    key={tool.id}
                    htmlFor={controlId}
                    className="flex cursor-pointer items-start gap-3 px-3 py-3 first:rounded-t-lg last:rounded-b-lg hover:bg-accent/20"
                  >
                    <Checkbox
                      id={controlId}
                      checked={checked}
                      disabled={saving || !tool.available}
                      onCheckedChange={(next) =>
                        setDraftTools((previous) => ({
                          ...previous,
                          [tool.id]: next === true,
                        }))
                      }
                      aria-describedby={`${controlId}-description`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{tool.label}</span>
                        {tool.modes.length === 1 && tool.modes[0] === 'assistant' && (
                          <Badge variant="outline">Assistant only</Badge>
                        )}
                        {!tool.available && (
                          <Badge variant="destructive">Unavailable</Badge>
                        )}
                        {effective && <Badge variant="secondary">Available to agent</Badge>}
                      </span>
                      <span
                        id={`${controlId}-description`}
                        className="mt-0.5 block text-xs text-muted-foreground"
                      >
                        {tool.description}
                        {!dependenciesReady && requiredLabels && (
                          <span className="mt-1 block text-amber-700 dark:text-amber-300">
                            Requires {requiredLabels} enabled and available in paper search
                            sources.
                          </span>
                        )}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}

      {(saveError || loadError) && (
        <Alert variant="destructive">{saveError ?? loadError}</Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card p-3">
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={saving}>
          <RotateCcw aria-hidden="true" />
          Reset to defaults
        </Button>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          <Button type="button" size="sm" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? <Spinner /> : <Save aria-hidden="true" />}
            {saving ? 'Saving…' : 'Save preferences'}
          </Button>
        </div>
      </div>
    </section>
  );
}
