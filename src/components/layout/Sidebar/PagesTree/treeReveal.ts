import { useEffect, useEffectEvent } from 'react';
import { registerModuleReset } from '@/lib/moduleState';

/**
 * Something the sidebar tree should show: a page or a collection, with the
 * collections it is inside opened, and focus put on its row when asked.
 *
 * Moves, the breadcrumb, a new collection and the palette ask for it from
 * outside the tree, which may not be mounted (the phone drawer is closed):
 * the last request waits for the tree to mount.
 */
export type RevealRequest =
  | { kind: 'page'; id: string; collectionId: number | null; focus?: boolean }
  | { kind: 'collection'; id: number; focus?: boolean; expand?: boolean };

let pending: RevealRequest | null = null;
const listeners = new Set<(request: RevealRequest) => void>();
registerModuleReset(() => {
  pending = null;
});

export function revealInTree(request: RevealRequest): void {
  if (listeners.size === 0) {
    pending = request;
    return;
  }
  pending = null;
  for (const listener of listeners) listener(request);
}

/** The tree takes reveal requests, the one left waiting first. */
export function useRevealRequests(handler: (request: RevealRequest) => void): void {
  const handle = useEffectEvent(handler);
  useEffect(() => {
    const listener = (request: RevealRequest) => handle(request);
    listeners.add(listener);
    if (pending) {
      const waiting = pending;
      pending = null;
      listener(waiting);
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);
}
