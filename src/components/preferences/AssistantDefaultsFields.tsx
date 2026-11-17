import { useId } from 'react';
import { NativeSelect } from '@/components/ui/select';
import { REVIEW_LABELS, type ReviewKind } from '@/data/reviews';
import { useAgentEngine } from './agentEngineContextState';

export function AssistantDefaultsFields() {
  const id = useId();
  const { prefs, savingPreferences, preferencesReady, saveDefaults } = useAgentEngine();
  const disabled = savingPreferences || !preferencesReady;

  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-sm font-semibold text-foreground">My defaults</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Saved to your account. You can still choose a different effort in a conversation or a different review for a page.
      </p>
      <div className="mt-2 divide-y divide-border border-y border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 py-3">
          <label htmlFor={`${id}-effort`} className="text-sm font-medium">Starting chat effort</label>
          <NativeSelect id={`${id}-effort`} className="w-full sm:w-48" disabled={disabled} value={prefs.chatEffort ?? ''}
            onChange={(event) => saveDefaults({ chat_effort: (event.target.value || null) as 'quick' | 'standard' | null })}>
            <option value="">Product default</option>
            <option value="quick">Quick</option>
            <option value="standard">Standard</option>
          </NativeSelect>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 py-3">
          <label htmlFor={`${id}-review`} className="text-sm font-medium">Starting review type</label>
          <NativeSelect id={`${id}-review`} className="w-full sm:w-48" disabled={disabled} value={prefs.reviewKind ?? ''}
            onChange={(event) => saveDefaults({ review_kind: (event.target.value || null) as ReviewKind | null })}>
            <option value="">Product default</option>
            {(Object.entries(REVIEW_LABELS)).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
          </NativeSelect>
        </div>
      </div>
    </section>
  );
}
