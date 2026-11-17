/**
 * The CSS Custom Highlight API (`::highlight(name)`), where the browser has
 * it: marks a range in the page with no DOM changes, and survives focus
 * leaving the page. Ask AI marks its target with it, the chat its context.
 */
type HighlightRegistry = { set: (name: string, highlight: unknown) => void; delete: (name: string) => void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

function api(): { highlights: HighlightRegistry; Highlight: HighlightCtor } | null {
  const highlights = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const Highlight = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  return highlights && Highlight ? { highlights, Highlight } : null;
}

/** Whether the browser can highlight at all. */
export function canHighlight(): boolean {
  return api() !== null;
}

/** Mark `range` as the highlight `name`, replacing what it marked before. */
export function setHighlight(name: string, range: Range): void {
  const found = api();
  found?.highlights.set(name, new found.Highlight(range));
}

export function clearHighlight(name: string): void {
  api()?.highlights.delete(name);
}
