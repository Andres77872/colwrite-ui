import type { AgentSource } from '@/api/assistant/streamParser';
import { replaceSourceMarkers } from '@/lib/sourceHandles';
import type { AssistantOutput, ReferenceRecord } from './types';

/** Cross the run/document boundary once, before the run's evidence expires.
 * Only cited records are retained. Unknown handles remain visible as text. */
export function resolveAssistantOutput(text: string, sources: readonly AgentSource[]): AssistantOutput {
  const byHandle = new Map(sources.map((source) => [source.handle, source.record]));
  const retained = new Map<string, ReferenceRecord>();
  const rewritten = replaceSourceMarkers(text, (handles) => {
    const known = new Map<string, ReferenceRecord>();
    const unknown = new Set<string>();
    for (const handle of handles) {
      const record = byHandle.get(handle);
      if (!record) { unknown.add(handle); continue; }
      known.set(record.key, record);
      retained.set(record.key, record);
    }
    if (!known.size) return null;
    return [
      `[${[...known.keys()].map((key) => `@${key}`).join('; ')}]`,
      ...(unknown.size ? [`[${[...unknown].join(', ')}]`] : []),
    ].join(' ');
  });
  return { text: rewritten, sources: [...retained.values()] };
}
