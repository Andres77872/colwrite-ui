import { useContext, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { ApiError, errorMessage } from '@/api/errors';
import {
  assistantSettingsQuery,
  useUpdateAssistantSettings,
  type AssistantSettings,
  type AssistantSettingsUpdate,
  type CapabilityState,
  type CapabilitySwitch,
  type CapabilitySwitchId,
  type PaperSource,
  type PaperSourceId,
} from '@/data/assistant';
import { AssistantCatalogContext } from './assistantCatalogContextState';
import { AssistantDefaultsFields } from './AssistantDefaultsFields';
import { ToolingCatalog } from './ToolingCatalog';

/** A change on its way to the server: switches and paper sources by id. */
type Changes = { switches: Partial<Record<CapabilitySwitchId, boolean>>; sources: Partial<Record<PaperSourceId, boolean>> };
const NO_CHANGES: Changes = { switches: {}, sources: {} };

const merge = (base: Changes, changes: Changes): Changes => ({
  switches: { ...base.switches, ...changes.switches },
  sources: { ...base.sources, ...changes.sources },
});

/** `pending` without what `settled` sent, unless a newer change replaced it. */
function withoutSettled(pending: Changes, settled: Changes): Changes {
  const keep = <K extends string>(rows: Partial<Record<K, boolean>>, sent: Partial<Record<K, boolean>>) =>
    Object.fromEntries(Object.entries(rows).filter(([id, value]) => sent[id as K] !== value)) as Partial<Record<K, boolean>>;
  return { switches: keep(pending.switches, settled.switches), sources: keep(pending.sources, settled.sources) };
}

const asUpdate = (changes: Changes): AssistantSettingsUpdate => ({
  ...changes.switches,
  ...(Object.keys(changes.sources).length ? { sources: changes.sources } : {}),
});

function notSavedReason(error: unknown): string {
  return error instanceof ApiError && error.message ? error.message : 'Check your connection and try again.';
}

/**
 * Settings → AI & tools: the account's four capability switches (Papers
 * with its sources, Web, Research workers, Images), as `GET
 * /users/me/assistant` keeps them and the workspace's catalog says they apply
 * here. A row the workspace's policy, the server or the engine holds back
 * says so on its own line, in the server's words. The pane decides nothing:
 * what a switch reaches, and what holds it back, is the server's to say.
 */
export function AssistantPreferences({ leading }: { leading?: ReactNode } = {}) {
  const read = useQuery(assistantSettingsQuery());
  const settings = read.isError ? null : (read.data ?? null);

  if (!settings && read.isPending) {
    return (
      <>
        {leading}
        <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading what the assistant can use…
        </div>
      </>
    );
  }

  if (!settings) {
    return (
      <section className="flex flex-col gap-8">
        {leading}
        <div>
          <Alert variant="destructive">{errorMessage(read.error, 'Your assistant settings are unavailable.')}</Alert>
          <Button className="mt-3" variant="outline" size="sm" onClick={() => void read.refetch()} disabled={read.isFetching}>
            {read.isFetching ? <Spinner /> : <RefreshCw aria-hidden="true" />}
            {read.isFetching ? 'Trying again…' : 'Try again'}
          </Button>
        </div>
      </section>
    );
  }

  return <AssistantPreferencesForm settings={settings} leading={leading} />;
}

function AssistantPreferencesForm({ settings, leading }: { settings: AssistantSettings; leading?: ReactNode }) {
  const { toast } = useToast();
  const save = useUpdateAssistantSettings().mutateAsync;
  // In a workspace, the catalog says how each switch applies there.
  const catalog = useContext(AssistantCatalogContext)?.catalog ?? null;
  const here = new Map((catalog?.switches ?? []).map((row) => [row.id, row]));
  // Changes on their way to the server, shown at once and dropped when their
  // save settles: on success the settings carry them; on failure the switch
  // falls back to the saved value and the row says why.
  const [pending, setPending] = useState<Changes>(NO_CHANGES);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const apply = (changes: Changes): Promise<AssistantSettings> => {
    setPending((previous) => merge(previous, changes));
    setInFlight((count) => count + 1);
    const run = save(asUpdate(changes));
    void run.catch(() => undefined).finally(() => {
      setPending((previous) => withoutSettled(previous, changes));
      setInFlight((count) => count - 1);
    });
    return run;
  };

  const toggle = (key: string, changes: Changes) => {
    setRowErrors(({ [key]: _cleared, ...rest }) => rest);
    setBulkError(null);
    apply(changes).catch((caught: unknown) => {
      setRowErrors((previous) => ({ ...previous, [key]: `Not saved, so it is back to how it was. ${notSavedReason(caught)}` }));
    });
  };

  const switchOn = (row: CapabilitySwitch) => pending.switches[row.id] ?? row.enabled;
  const sourceOn = (row: PaperSource) => pending.sources[row.id] ?? row.enabled;

  // What a reset sends: every switch and source the server can serve, shown other than its default.
  const toDefaults: Changes = { switches: {}, sources: {} };
  for (const row of settings.switches) {
    if (row.state !== 'unavailable' && switchOn(row) !== row.default) toDefaults.switches[row.id] = row.default;
    for (const source of row.sources) {
      if (source.state !== 'unavailable' && sourceOn(source) !== source.default) toDefaults.sources[source.id] = source.default;
    }
  }
  const atDefaults = Object.keys(toDefaults.switches).length === 0 && Object.keys(toDefaults.sources).length === 0;

  const reset = () => {
    if (atDefaults) return;
    const shownNow = new Map<string, boolean>();
    for (const row of settings.switches) {
      shownNow.set(`switch:${row.id}`, switchOn(row));
      for (const source of row.sources) shownNow.set(`source:${source.id}`, sourceOn(source));
    }
    const undo: Changes = {
      switches: Object.fromEntries(Object.keys(toDefaults.switches).map((id) => [id, shownNow.get(`switch:${id}`)])),
      sources: Object.fromEntries(Object.keys(toDefaults.sources).map((id) => [id, shownNow.get(`source:${id}`)])),
    };
    setRowErrors({});
    setBulkError(null);
    apply(toDefaults).then(
      () => toast({
        title: 'Assistant capability switches reset to defaults',
        description: 'New assistant runs and paper searches use the defaults.',
        variant: 'success',
        action: {
          label: 'Undo',
          onSelect: () => {
            apply(undo).catch((caught: unknown) => setBulkError(`Could not restore your choices. ${notSavedReason(caught)}`));
          },
        },
      }),
      (caught: unknown) => setBulkError(`Could not reset to defaults. ${notSavedReason(caught)}`),
    );
  };

  return (
    <section aria-labelledby="agent-preferences-title" className="flex flex-col gap-8">
      <div>
        <h2 id="agent-preferences-title" className="flex min-h-8 items-center text-lg font-semibold">
          AI &amp; tools
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Choose what the assistant may use on your account. Papers also decides what the citation picker
          searches and which research sources appear in the editor. Each change is saved as you make it.
        </p>
      </div>

      {leading}
      <AssistantDefaultsFields />

      <section aria-labelledby="assistant-switches">
        <h2 id="assistant-switches" className="text-sm font-semibold text-foreground">
          What the assistant can use
        </h2>
        <div className="mt-2 flex flex-col divide-y divide-border border-y border-border">
          {settings.switches.map((row) => {
            const applied = here.get(row.id) ?? row;
            return (
              <div key={row.id}>
                <SwitchRow
                  id={`assistant-switch-${row.id}`}
                  label={row.label}
                  description={row.description}
                  checked={switchOn(row)}
                  state={applied.state}
                  reason={applied.reason}
                  error={rowErrors[`switch:${row.id}`]}
                  onCheckedChange={(enabled) => toggle(`switch:${row.id}`, { ...NO_CHANGES, switches: { [row.id]: enabled } })}
                />
                {row.sources.length > 0 && (
                  <div role="group" aria-label={`${row.label} sources`} className="mb-3 ml-4 border-l border-border pl-4">
                    {row.sources.map((source) => {
                      const sourceHere = applied.sources.find((item) => item.id === source.id) ?? source;
                      return (
                        <SwitchRow
                          key={source.id}
                          id={`paper-source-${source.id}`}
                          label={source.label}
                          description={source.description}
                          checked={sourceOn(source)}
                          state={sourceHere.state}
                          reason={sourceHere.reason}
                          badges={!source.default ? <Badge variant="secondary">Opt-in</Badge> : undefined}
                          error={rowErrors[`source:${source.id}`]}
                          onCheckedChange={(enabled) => toggle(`source:${source.id}`, { ...NO_CHANGES, sources: { [source.id]: enabled } })}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <ToolingCatalog permissions={settings.permissions} />

      {bulkError && <Alert variant="destructive">{bulkError}</Alert>}

      {/* Full-bleed across the pane, on the pane's own fill, with a hairline
          above: rows scroll under it instead of being cut by a floating bar. */}
      <div className="sticky bottom-0 -mx-5 -mb-8 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-5 py-3 sm:-mx-10 sm:px-10">
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={atDefaults}>
          <RotateCcw aria-hidden="true" />
          Reset capability switches
        </Button>
        <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {inFlight > 0 ? (
            <>
              <Spinner />
              Saving…
            </>
          ) : (
            'Changes are saved as you make them.'
          )}
        </span>
      </div>
    </section>
  );
}

/** How a row's state reads as a badge, when it is not the row's own switch that has it off. */
const STATE_BADGE: Partial<Record<CapabilityState, { text: string; variant: 'warning' | 'destructive' | 'secondary' }>> = {
  blocked: { text: 'Off here', variant: 'warning' },
  unavailable: { text: 'Unavailable', variant: 'destructive' },
};

/**
 * One switch: its name and description, the account's own choice, and, when
 * the server says it does not apply (the workspace's policy, the role, the
 * engine, the server), why, on the row itself. A row the server cannot serve
 * cannot be switched; one the workspace holds back stays the person's to
 * choose, for their other workspaces.
 */
function SwitchRow({
  id,
  label,
  description,
  checked,
  state,
  reason,
  badges,
  error,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  state: CapabilityState;
  reason: string | null;
  badges?: ReactNode;
  error?: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  // "Switched off in your settings" only repeats the switch beside it.
  const said = state !== 'on' && !(state === 'off' && !checked) ? reason : null;
  const badge = STATE_BADGE[state];
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium text-foreground">
          {label}
          {badges}
          {badge && <Badge variant={badge.variant}>{badge.text}</Badge>}
        </span>
        <span id={`${id}-description`} className="mt-0.5 block text-xs text-muted-foreground">
          {description}
        </span>
        {said && (
          <span id={`${id}-status`} className="mt-1 block text-xs text-muted-foreground">
            {said}
          </span>
        )}
        {error && (
          <span id={`${id}-error`} role="alert" className="mt-1 block text-xs text-destructive">
            {error}
          </span>
        )}
      </label>
      <Switch
        id={id}
        checked={checked}
        disabled={state === 'unavailable'}
        onCheckedChange={onCheckedChange}
        aria-describedby={[`${id}-description`, said ? `${id}-status` : null, error ? `${id}-error` : null].filter(Boolean).join(' ')}
      />
    </div>
  );
}
