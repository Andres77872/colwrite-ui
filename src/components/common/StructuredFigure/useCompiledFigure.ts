import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { compileFigure } from '@/lib/figure/compile';
import { getFigureMeasurer, loadFigureFont, onFigureFontsChange } from '@/lib/figure/measure';
import type { CompiledFigure } from '@/lib/figure/types';

let fontGeneration = 0;

function subscribeFonts(listener: () => void): () => void {
  return onFigureFontsChange(() => {
    fontGeneration += 1;
    listener();
  });
}

/**
 * A figure compiled for this page, redrawn when its fonts finish loading.
 *
 * Labels are measured with the real faces; a figure laid out before Inter (or
 * Source Serif) arrived would keep boxes sized for the fallback font, so a
 * font load re-measures every figure on the page.
 *
 * `delay` waits for the source to settle before compiling — live editing lays
 * a figure out when the author pauses, not on every keystroke. While a new
 * source does not compile, `shown` keeps the last result that drew, so the
 * figure never collapses under the author's cursor.
 */
export function useCompiledFigure(source: string, delay = 0): {
  compiled: CompiledFigure;
  shown: CompiledFigure | null;
  pending: boolean;
} {
  const generation = useSyncExternalStore(subscribeFonts, () => fontGeneration, () => 0);
  const [settled, setSettled] = useState(source);

  useEffect(() => {
    if (delay <= 0) return;
    const timer = window.setTimeout(() => setSettled(source), delay);
    return () => window.clearTimeout(timer);
  }, [source, delay]);

  const input = delay > 0 ? settled : source;
  const compiled = useMemo(
    () => compileFigure(input, getFigureMeasurer()),
    // The font generation invalidates measurements; the measurer's own key
    // changes with it, and compileFigure caches on that key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, generation],
  );

  const [lastGood, setLastGood] = useState<CompiledFigure | null>(compiled.ok ? compiled : null);
  if (compiled.ok && compiled !== lastGood) setLastGood(compiled);

  const font = (compiled.model ?? lastGood?.model)?.font;
  useEffect(() => {
    if (font) loadFigureFont(font);
  }, [font]);

  return {
    compiled,
    shown: compiled.ok ? compiled : lastGood,
    pending: delay > 0 && settled !== source,
  };
}
