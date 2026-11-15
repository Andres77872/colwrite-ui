import { QueryClient } from '@tanstack/react-query';
import createQueryClient from 'openapi-react-query';
import { api } from './client';

/**
 * Typed queries and mutations over the one client
 * (`docs/workspace_collection/15-contract-and-codegen.md` §6.3):
 * `$api.useQuery('get', '/workspaces/{workspace_id}/usage', { params })`. Their keys are
 * `[method, path, init]`.
 *
 * The reads that combine requests or reshape a response are the domain hooks
 * in `src/data/*`, keyed by their workspace and domain (`['ws', id, 'documents', …]`). A path
 * is read through one of the two, never both, so a key always holds one shape.
 */
export const $api = createQueryClient(api);

/**
 * The account's one query cache. `App` makes one per signed-in account, so
 * nothing read for one account is shown to the next.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The client already refreshes a spent session and replays what the
        // server calls retryable after its `Retry-After`; a second retry
        // ladder here would only multiply the requests.
        retry: false,
        // The lists refresh after the author's own changes (invalidation) and
        // when they are shown again, not every time the window takes focus.
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
