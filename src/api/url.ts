import type { paths } from './schema';

const PRODUCTION_API_BASE = 'https://colwrite-api.novus.chat';

/**
 * Where the API is. Production builds call it directly; the dev server and
 * the tests go through the Vite `/api` proxy, which strips that prefix.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? '/api' : PRODUCTION_API_BASE)).replace(/\/$/, '');

/**
 * The URL of a schema path. The API serves its agent routes at `/api/agent/*`
 * itself, so behind the `/api` proxy (which forwards those unchanged) that
 * prefix is not doubled.
 */
export function resolveApiPath(path: string): string {
  if (API_BASE.endsWith('/api') && path.startsWith('/api/')) return `${API_BASE.slice(0, -4)}${path}`;
  return `${API_BASE}${path}`;
}

type GetPaths = { [P in keyof paths]: paths[P] extends { get: object } ? P : never }[keyof paths];
type GetParameters<P extends GetPaths> = paths[P] extends { get: { parameters: infer T } } ? T : never;
type PathParameters<P extends GetPaths> = GetParameters<P> extends { path: infer T } ? T : never;
type QueryParameters<P extends GetPaths> = GetParameters<P> extends { query?: infer T } ? T : never;

/**
 * A link to a GET route, for what cannot go through `fetch`: an `<a href>`
 * to a PDF, an `<img src>` for a chat image. The path and its parameters are
 * checked against the contract.
 */
export function apiUrl<P extends GetPaths>(
  path: P,
  ...params: PathParameters<P> extends never
    ? [options?: { query?: QueryParameters<P> }]
    : [options: { path: PathParameters<P>; query?: QueryParameters<P> }]
): string {
  const options = params[0] as { path?: Record<string, string | number>; query?: Record<string, unknown> } | undefined;
  let resolved: string = path;
  for (const [name, value] of Object.entries(options?.path ?? {})) {
    resolved = resolved.replace(`{${name}}`, encodeURIComponent(String(value)));
  }
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(options?.query ?? {})) {
    if (value !== undefined && value !== null) search.set(name, String(value));
  }
  const query = search.toString();
  return `${resolveApiPath(resolved)}${query ? `?${query}` : ''}`;
}
