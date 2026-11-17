import { useEffect, useSyncExternalStore } from 'react';
import { isCitationProcessorReady, requestCitationProcessor, subscribeCitationProcessor } from './processor';

/**
 * Whether the citation processor has loaded, asking for it when `needed`
 * (a page with citations, the style picker): the component renders again
 * when it arrives.
 */
export function useCitationProcessor(needed = true): boolean {
  const ready = useSyncExternalStore(subscribeCitationProcessor, isCitationProcessorReady, isCitationProcessorReady);
  useEffect(() => {
    if (needed && !ready) requestCitationProcessor();
  }, [needed, ready]);
  return ready;
}
