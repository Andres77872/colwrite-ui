/**
 * What a newer server may send that this client does not know: a frame
 * `type` or an event name. Either is skipped, never treated as a broken
 * connection, so a server can add one without breaking a deployed client
 * (`docs/tooling_set/13-frontend-and-ux.md` §10). Each name is logged once.
 */
const seen = new Set<string>();

export function noteUnknownInput(kind: 'frame type' | 'event', name: string): void {
  const key = `${kind}:${name}`;
  if (seen.has(key)) return;
  seen.add(key);
  console.warn(`[assistant] ignored an unknown ${kind}: ${name}`);
}
