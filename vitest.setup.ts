// Enable act() support for React concurrent rendering in jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// jsdom does not implement CSS.escape; the editor escapes tool-payload ids
// into attribute selectors with it. Native browsers provide the real thing.
if (typeof globalThis.CSS === 'undefined') {
  (globalThis as { CSS?: Record<string, unknown> }).CSS = {};
}
if (typeof CSS.escape !== 'function') {
  CSS.escape = (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
