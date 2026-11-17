import { useId, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { gatewayModelsFor, type GatewayModelTier } from '@/data/agentEngines';
import { useAgentEngine } from './agentEngineContextState';

/** Gateway model choices are available on local and deployed servers alike. */
export function GatewayModelPreferences() {
  const { catalog, loading, error, refresh } = useAgentEngine();
  const titleId = useId();
  // Each tier on its own: a server with no lite chain still has a general
  // model to choose, and the picker for it is not hidden.
  const hasMain = gatewayModelsFor(catalog, 'main').length > 0;
  const hasLite = gatewayModelsFor(catalog, 'lite').length > 0;

  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="text-sm font-semibold text-foreground">Gateway models</h2>
      <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
        Choose the first model for general and lite work. Only this server’s configured models are
         offered; the others remain as fallbacks. Saved to your account for new requests.
        Local CLI engines keep their own model choices.
      </p>
      {loading && !catalog ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Loading configured models…
        </p>
      ) : !hasMain && !hasLite ? (
        <Alert variant="warning" className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              {error && !catalog ? error : 'Gateway models are not configured on this server.'}
            </span>
            <Button type="button" variant="ghost" size="xs" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw aria-hidden="true" /> Reload models
            </Button>
          </div>
        </Alert>
      ) : (
        <div className="mt-2 divide-y divide-border border-y border-border">
          {hasMain ? (
            <GatewayModelField tier="main" label="General model">
              Gateway chat and inline AI, and claim assessment.
            </GatewayModelField>
          ) : (
            <TierUnavailable label="General model" />
          )}
          {hasLite ? (
            <GatewayModelField tier="lite" label="Lite model">
              Helper calls and gateway research workers. Inline AI is not lite work.
            </GatewayModelField>
          ) : (
            <TierUnavailable label="Lite model" />
          )}
        </div>
      )}
    </section>
  );
}

/** A tier this server has no models for: said in its row, the other tier's picker stays. */
function TierUnavailable({ label }: { label: string }) {
  return (
    <div className="py-3">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Not configured on this server. The server default is used.</p>
    </div>
  );
}

function GatewayModelField({ tier, label, children }: {
  tier: GatewayModelTier;
  label: string;
  children: string;
}) {
  const { catalog, prefs, setGatewayModel, preferencesReady, savingPreferences } = useAgentEngine();
  const id = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const models = gatewayModelsFor(catalog, tier);
  const saved = ((tier === 'main' ? prefs.models.gateway : prefs.liteModel) ?? '').trim();
  const stale = Boolean(saved && !models.includes(saved));

  return (
    <div className="flex items-start justify-between gap-6 py-3 max-sm:flex-col max-sm:gap-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-muted-foreground">{children}</p>
        {stale && (
          <p className="mt-1 text-xs text-tint-yellow-fg">
            The saved model is no longer configured. Using the server default.
          </p>
        )}
        {problem && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-destructive">{problem}</p>}
      </div>
      <NativeSelect
        id={id}
        className="w-full shrink-0 sm:w-80"
        value={stale ? '' : saved}
        disabled={!preferencesReady || savingPreferences}
        aria-describedby={`${id}-hint${problem ? ` ${id}-error` : ''}`}
        aria-invalid={problem ? true : undefined}
        onChange={(event) => setProblem(setGatewayModel(tier, event.target.value))}
      >
        <option value="">Server default · {models[0]}</option>
        {models.map((model) => <option key={model} value={model}>{model}</option>)}
      </NativeSelect>
    </div>
  );
}
