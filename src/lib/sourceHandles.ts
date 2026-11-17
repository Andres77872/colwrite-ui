/**
 * Source handles, in one place: the ids the conversation's evidence store
 * gives the works its tools return (`S1` to `S99999`, once each for the
 * whole conversation), and the markers an answer cites them by in its prose
 * (`[S3]`, `[S1, S4]`, `[S1; S4]`). Parsing, rendering, copying and
 * inserting a reply all read them here.
 */

/** A handle as the evidence store issues it. */
export const SOURCE_HANDLE = /^S[1-9]\d{0,4}$/;

/**
 * A marker, as a pattern to embed in a larger tokenizer: never a markdown
 * link (`[S1](…)`), which is a link that happens to say S1.
 */
export const SOURCE_MARKER_PATTERN = String.raw`\[S\d{1,5}(?:\s*[,;]\s*S\d{1,5})*\](?!\()`;

const MARKER = new RegExp(String.raw`\[(S\d{1,5}(?:\s*[,;]\s*S\d{1,5})*)\](?!\()`, 'g');

/** The handles a marker names, in order: `[S1, S4]` → `['S1', 'S4']`. */
export function markerHandles(marker: string): string[] {
  const body = marker.startsWith('[') ? marker.slice(1, -1) : marker;
  return body.split(/\s*[,;]\s*/);
}

/** Every marker in a text, in order, with the handles it names. */
export function sourceMarkers(text: string): string[][] {
  return Array.from(text.matchAll(MARKER), (match) => markerHandles(match[1] ?? ''));
}

/**
 * Each marker replaced by what `replace` makes of its handles; `null` keeps
 * the marker as written (a handle the reply never received stays text).
 */
export function replaceSourceMarkers(text: string, replace: (handles: string[]) => string | null): string {
  return text.replace(MARKER, (marker, body: string) => replace(markerHandles(body)) ?? marker);
}
