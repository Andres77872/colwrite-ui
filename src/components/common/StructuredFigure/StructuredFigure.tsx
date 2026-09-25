import { memo, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, Check, Copy, Download, FileCode2, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import { describeFigure } from '@/lib/figure/compile';
import { figurePalette } from '@/lib/figure/palette';
import { figureToTikz } from '@/lib/figure/tikz';
import type { CompiledFigure, FigureDiagnostic, FigureSize } from '@/lib/figure/types';
import { downloadBlob, exportFilename } from '@/export/download';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FigureCaption } from './FigureCaption';
import { FigureSvg } from './FigureSvg';
import { figureSvgDownload } from './figureSvgFile';
import { useCompiledFigure } from './useCompiledFigure';

export type StructuredFigureProps = {
  /** The JSON spec, without a Markdown fence. */
  source: string;
  /** Position among the document's captioned figures. */
  number?: number;
  /** Wait this long (ms) after the source last changed before laying it out. */
  delay?: number;
  /** Hover actions: open larger, copy source, download SVG, copy TikZ. */
  actions?: boolean;
  /** Draw the caption under the figure (the editor block does; a chat card may not). */
  caption?: boolean;
  /** Accessible name when the spec has no title. */
  label?: string;
  className?: string;
  /** Pin the palette instead of following the app theme (print previews). */
  theme?: 'light' | 'dark';
  /** Edit mode: the highlighted item and a click handler that makes items selectable. */
  selectedId?: string | null;
  onSelectItem?: (id: string, kind: 'node' | 'group' | 'edge') => void;
  /** Every compile, successful or not — how a parent learns about problems. */
  onCompiled?: (compiled: CompiledFigure) => void;
};

/** Print width relative to the text column, like `width=0.5\linewidth`. */
const SIZE_WIDTH: Record<FigureSize, string | null> = {
  auto: null,
  small: '50%',
  medium: '70%',
  large: '85%',
  full: '100%',
};

const ACTION_BUTTON =
  'inline-flex h-7 w-7 items-center justify-center rounded-md bg-card text-muted-foreground shadow-sm ring-1 ring-border transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Figure-level diagnostics worth showing at rest: only what stops it drawing. */
function firstError(diagnostics: readonly FigureDiagnostic[]): FigureDiagnostic | null {
  return diagnostics.find((diagnostic) => diagnostic.severity === 'error') ?? null;
}

function position(diagnostic: FigureDiagnostic): string {
  return diagnostic.line !== undefined ? `Line ${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''} — ` : '';
}

function canvasStyle(size: FigureSize, width: number): CSSProperties {
  const share = SIZE_WIDTH[size];
  return share ? { width: share } : { width: Math.ceil(width), maxWidth: '100%' };
}

/**
 * A structured figure: the drawing, its numbered caption and its actions.
 *
 * The one renderer behind the editor's figure blocks, the review cards and
 * the assistant's replies. The spec is compiled on the client (see
 * `src/lib/figure`); nothing about the drawing is stored. When the current
 * source does not compile, the last drawing stays up, dimmed, under the
 * error, so live editing never collapses the figure.
 */
export const StructuredFigure = memo(function StructuredFigure({
  source,
  number,
  delay = 0,
  actions = false,
  caption = true,
  label,
  className,
  theme,
  selectedId,
  onSelectItem,
  onCompiled,
}: StructuredFigureProps) {
  const { resolved } = useTheme();
  const { compiled, shown } = useCompiledFigure(source, delay);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<'source' | 'tikz' | null>(null);
  const onCompiledRef = useRef(onCompiled);
  const rawId = useId();
  const idPrefix = `cwfig${rawId.replace(/[^A-Za-z0-9]/g, '')}`;

  useEffect(() => {
    onCompiledRef.current = onCompiled;
  });

  useEffect(() => {
    onCompiledRef.current?.(compiled);
  }, [compiled]);

  const error = firstError(compiled.diagnostics);
  const stale = Boolean(error && shown);
  const scene = shown?.scene ?? null;
  const model = shown?.model ?? null;
  const palette = figurePalette(theme ?? resolved, model?.palette ?? 'color');
  const name = model?.title || label?.trim() || 'Figure';
  const description = model ? describeFigure(model) : undefined;

  const flash = (what: 'source' | 'tikz') => {
    setCopied(what);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const copyText = async (text: string, what: 'source' | 'tikz') => {
    try {
      await navigator.clipboard.writeText(text);
      flash(what);
    } catch {
      /* clipboard unavailable: the unchanged icon is the answer */
    }
  };

  const download = async () => {
    if (!scene) return;
    // Downloads are for papers and slides: always the light print palette.
    const blob = await figureSvgDownload(scene, figurePalette('light', model?.palette ?? 'color'), {
      title: name,
      description,
    });
    downloadBlob(blob, exportFilename(model?.label?.replace(/^fig:/, '') || name, 'svg'));
  };

  return (
    <figure
      className={cn('structured-figure group/figure relative m-0 min-w-0', className)}
      data-figure-size={model?.size ?? 'auto'}
    >
      {error && (
        <div
          role="alert"
          className={cn('rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-left', scene && 'mb-3')}
        >
          <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            {stale ? 'Error — showing the last version that drew' : 'This figure has an error'}
          </p>
          <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
            {position(error)}
            {error.message}
          </p>
        </div>
      )}

      {scene ? (
        <div
          className={cn('figure-canvas mx-auto transition-opacity duration-150', stale && 'opacity-40')}
          style={canvasStyle(model?.size ?? 'auto', scene.width)}
        >
          <FigureSvg
            scene={scene}
            palette={palette}
            idPrefix={idPrefix}
            title={name}
            description={description}
            className="block h-auto w-full"
            selectedId={selectedId}
            onItemClick={onSelectItem}
          />
        </div>
      ) : null}

      {caption && model && (model.caption || number !== undefined) && (
        <FigureCaption caption={model.caption} number={model.caption ? number : undefined} />
      )}

      {actions && scene && !stale && (
        <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover/figure:opacity-100">
          <button
            type="button"
            className={ACTION_BUTTON}
            aria-label="Open figure larger"
            title="Open larger"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={ACTION_BUTTON}
            aria-label={copied === 'source' ? 'Figure source copied' : 'Copy figure source'}
            title={copied === 'source' ? 'Copied' : 'Copy source'}
            onClick={() => void copyText(source, 'source')}
          >
            {copied === 'source' ? (
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <Copy aria-hidden="true" className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            className={ACTION_BUTTON}
            aria-label={copied === 'tikz' ? 'TikZ copied' : 'Copy as TikZ for LaTeX'}
            title={copied === 'tikz' ? 'Copied' : 'Copy TikZ (LaTeX)'}
            onClick={() => model && void copyText(figureToTikz(scene, model), 'tikz')}
          >
            {copied === 'tikz' ? (
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <FileCode2 aria-hidden="true" className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            className={ACTION_BUTTON}
            aria-label="Download figure as SVG"
            title="Download SVG"
            onClick={() => void download()}
          >
            <Download aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {actions && scene && (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="max-w-6xl">
            <DialogHeader>
              <DialogTitle>{name}</DialogTitle>
              <DialogDescription className="sr-only">The figure at full size.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 max-h-[75vh] overflow-auto">
              <FigureSvg
                scene={scene}
                palette={palette}
                idPrefix={`${idPrefix}x`}
                title={name}
                description={description}
                className="mx-auto block h-auto"
                style={{ width: Math.max(scene.width, Math.min(scene.width * 1.6, 1000)) }}
              />
              {model?.caption && <FigureCaption caption={model.caption} number={number} className="mt-4" />}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </figure>
  );
});
