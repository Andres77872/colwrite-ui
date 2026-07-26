/**
 * KaTeX availability, as a state rather than a poll.
 *
 * The equation widget used to check `window.katex` forty times at 150ms
 * intervals and then give up silently — so an equation was blank for up to six
 * seconds on a slow connection, and permanently blank offline with no
 * explanation and no way to tell that apart from an empty equation.
 *
 * The script is a deferred `<script>` in index.html, so this only has to
 * observe it arriving, and report honestly when it does not.
 */

export type KatexStatus = 'loading' | 'ready' | 'unavailable';

type Katex = {
  renderToString: (input: string, options?: Record<string, unknown>) => string;
};

/** How long to wait before calling it: past this, the CDN is not coming. */
const GIVE_UP_AFTER_MS = 6000;
const POLL_INTERVAL_MS = 100;

function read(): Katex | null {
  const candidate = (globalThis as { katex?: Katex }).katex;
  return candidate && typeof candidate.renderToString === 'function' ? candidate : null;
}

let status: KatexStatus = read() ? 'ready' : 'loading';
const listeners = new Set<(status: KatexStatus) => void>();
let watching = false;

function settle(next: KatexStatus) {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener(status);
}

function watch() {
  if (watching || status !== 'loading') return;
  watching = true;

  const startedAt = Date.now();
  const tick = () => {
    if (read()) {
      settle('ready');
      return;
    }
    if (Date.now() - startedAt >= GIVE_UP_AFTER_MS) {
      settle('unavailable');
      return;
    }
    setTimeout(tick, POLL_INTERVAL_MS);
  };
  tick();
}

export function katexStatus(): KatexStatus {
  return status;
}

/** Subscribe to status changes. Returns an unsubscribe function. */
export function onKatexStatus(listener: (status: KatexStatus) => void): () => void {
  listeners.add(listener);
  watch();
  return () => listeners.delete(listener);
}

export type RenderResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

/**
 * Typeset LaTeX, reporting a syntax error instead of swallowing it.
 *
 * `throwOnError: false` was the old setting, which renders malformed input as
 * red gibberish inside the document with no indication of what is wrong. An
 * author writing `\frac{1}{` deserves to be told.
 */
export function renderLatex(latex: string, display: boolean): RenderResult {
  const katex = read();
  if (!katex) return { ok: false, error: 'KaTeX is not loaded' };

  try {
    return {
      ok: true,
      html: katex.renderToString(latex, {
        displayMode: display,
        throwOnError: true,
        strict: false,
        output: 'html',
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid LaTeX';
    // KaTeX prefixes its messages; the prefix is noise in a one-line hint.
    return { ok: false, error: message.replace(/^KaTeX parse error:\s*/, '') };
  }
}
