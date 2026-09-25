import katex from 'katex';

export type KatexStatus = 'loading' | 'ready' | 'unavailable';

export function katexStatus(): KatexStatus {
  return 'ready';
}

export function onKatexStatus(listener: (status: KatexStatus) => void): () => void {
  queueMicrotask(() => listener('ready'));
  return () => undefined;
}

export type RenderResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

/**
 * The editor and exporter intentionally use the same pinned KaTeX package and
 * option set. MathML is emitted beside visual HTML for accessible artifacts.
 *
 * `lenient` is for maths someone else wrote — the assistant's replies, text
 * extracted from a PDF. KaTeX's strict mode rejects input that renders fine
 * (Unicode letters in math mode, a trailing `%` comment), which is right for
 * the author's own equations, where the error is actionable, and wrong for a
 * reply the reader cannot edit. `trust` stays off either way: no `\href`,
 * `\url`, `\includegraphics` or raw HTML reaches the page.
 */
export function renderLatex(
  latex: string,
  display: boolean,
  options?: { lenient?: boolean },
): RenderResult {
  try {
    return {
      ok: true,
      html: katex.renderToString(latex, {
        displayMode: display,
        throwOnError: true,
        strict: options?.lenient ? 'ignore' : 'error',
        trust: false,
        output: 'htmlAndMathml',
        maxExpand: 1000,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid LaTeX';
    return { ok: false, error: message.replace(/^KaTeX parse error:\s*/, '') };
  }
}
