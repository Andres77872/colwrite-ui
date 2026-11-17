import { useSyncExternalStore } from 'react';
import { registerModuleReset } from '@/lib/moduleState';
import type { SentenceCandidates } from './findCitations';

/**
 * The passage Find citations was asked about: a paragraph, and its
 * sentences as they read when the author asked (`planSentences`). Kept in
 * module state because the toolbar that asks unmounts as soon as the
 * selection goes; the dialog (`FindCitationsHost`) reads it.
 */
export type FindCitationsTarget = { blockId: string; sentences: SentenceCandidates[]; id: number };

let target: FindCitationsTarget | null = null;
let nextId = 0;
const listeners = new Set<() => void>();

function publish(next: FindCitationsTarget | null) {
  target = next;
  for (const listener of listeners) listener();
}

registerModuleReset(() => publish(null));

export function openFindCitations(blockId: string, sentences: SentenceCandidates[]): void {
  nextId += 1;
  publish({ blockId, sentences, id: nextId });
}

export function closeFindCitations(): void {
  publish(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFindCitationsTarget(): FindCitationsTarget | null {
  return useSyncExternalStore(subscribe, () => target, () => null);
}
