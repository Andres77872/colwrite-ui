import { describeFigure } from '@/lib/figure/compile';
import { figurePalette } from '@/lib/figure/palette';
import type { CompiledFigure } from '@/lib/figure/types';
import { FigureCaption } from './FigureCaption';
import { FigureSvg } from './FigureSvg';

const SIZE_WIDTH = { auto: null, small: '50%', medium: '70%', large: '85%', full: '100%' } as const;

/**
 * A compiled figure as static markup — no hooks, no state — for the
 * standalone HTML export, which renders with `renderToStaticMarkup`.
 *
 * Returns null when the figure did not compile; the caller then prints the
 * source as code, so nothing the author wrote goes missing from the page.
 */
export function StaticFigure({
  compiled,
  number,
  theme = 'light',
  idPrefix,
  className,
}: {
  compiled: CompiledFigure;
  number?: number;
  theme?: 'light' | 'dark';
  /** Unique per figure on the page: pattern ids live in one document. */
  idPrefix: string;
  className?: string;
}) {
  const { scene, model } = compiled;
  if (!compiled.ok || !scene || !model) return null;
  const share = SIZE_WIDTH[model.size];
  const name = model.title || 'Figure';
  return (
    <figure className={className} data-figure-size={model.size}>
      <div
        className="figure-canvas"
        style={share ? { width: share } : { width: Math.ceil(scene.width), maxWidth: '100%' }}
      >
        <FigureSvg
          scene={scene}
          palette={figurePalette(theme, model.palette)}
          idPrefix={idPrefix}
          title={name}
          description={describeFigure(model)}
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
      </div>
      {model.caption && <FigureCaption caption={model.caption} number={number} />}
    </figure>
  );
}
