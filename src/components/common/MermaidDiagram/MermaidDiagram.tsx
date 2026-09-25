import { memo, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import {
  cachedMermaid,
  mermaidSvgFile,
  mermaidThemeFor,
  renderMermaid,
  type MermaidRenderResult,
} from '@/lib/mermaid';
import { downloadBlob, exportFilename } from '@/export/download';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type MermaidDiagramProps = {
  /** Mermaid source, without the ```mermaid fence. */
  source: string;
  /**
   * Wait this long (ms) after the source last changed before drawing. Live
   * editing uses it so a diagram is not laid out on every keystroke.
   */
  delay?: number;
  /** Accessible name for the drawing. Defaults to "Diagram". */
  label?: string;
  className?: string;
  /** Hover actions over the drawing: open larger, copy source, download SVG. */
  actions?: boolean;
  /** Base name of a downloaded SVG, without the extension. */
  filename?: string;
  /** Every finished draw, valid or not — how a parent learns the source parses. */
  onResult?: (result: MermaidRenderResult) => void;
};

type Drawn = {
  /** The theme + source this state was drawn for. */
  request: string;
  error: string | null;
  /** The last SVG that drew successfully — kept on screen through an error. */
  svg: string | null;
};

/**
 * A copy of the SVG under a different element id, for the enlarged view.
 * Mermaid scopes styles and arrow markers to the id; two elements with one
 * id would make the second's `url(#…)` markers depend on the first.
 */
function retargetSvg(svg: string, suffix: string): string {
  const id = /<svg\b[^>]*?\bid="([^"]+)"/.exec(svg)?.[1];
  return id ? svg.split(id).join(`${id}-${suffix}`) : svg;
}

/**
 * Smallest on-screen scale. Mermaid sizes an SVG to its container, so a wide
 * flowchart in a 600px column came out at half size with 7px labels. Below
 * this floor the drawing keeps its size and the figure scrolls sideways
 * instead. Screen only: the export must fit the page, so it is not applied
 * there.
 */
const MIN_SCALE = 0.75;

/** The SVG with a `min-width` that holds it at `MIN_SCALE` of its natural width. */
function legibleSvg(svg: string): string {
  return svg.replace(/^(<svg\b[^>]*?\sstyle=")max-width:\s*([\d.]+)px;?/, (whole, head: string, width: string) => {
    const natural = Number(width);
    if (!Number.isFinite(natural) || natural <= 0) return whole;
    return `${head}max-width: ${natural}px; min-width: ${Math.round(natural * MIN_SCALE)}px;`;
  });
}

const ACTION_BUTTON =
  'inline-flex h-7 w-7 items-center justify-center rounded-md bg-card text-muted-foreground shadow-sm ring-1 ring-border transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * A Mermaid diagram drawn in the design system's palette.
 *
 * The one renderer behind the editor's diagram blocks, the review cards and
 * the assistant's replies. Colours come from the tokens of the element it is
 * mounted in, so it follows the light/dark theme — and a `data-theme` island
 * — and redraws when the theme changes. The SVG is Mermaid's strict-mode,
 * DOMPurify-sanitised output (see `src/lib/mermaid.ts`).
 *
 * While a new source is being drawn the previous drawing stays up; when the
 * new source does not parse, the last good drawing is dimmed and the error is
 * shown under it, so live editing never collapses the figure.
 */
export const MermaidDiagram = memo(function MermaidDiagram({
  source,
  delay = 0,
  label,
  className,
  actions = false,
  filename = 'diagram',
  onResult,
}: MermaidDiagramProps) {
  const hostRef = useRef<HTMLElement | null>(null);
  const onResultRef = useRef(onResult);
  const { resolved } = useTheme();
  const request = `${resolved}\u0000${source}`;
  const [drawn, setDrawn] = useState<Drawn>(() => {
    // The page's palette is the usual answer before this element exists; if
    // it lives in a theme island, the effect below redraws it correctly.
    const hit =
      typeof document === 'undefined' ? null : cachedMermaid(source, mermaidThemeFor(document.documentElement));
    return hit?.ok ? { request, error: null, svg: hit.svg } : { request: '', error: null, svg: null };
  });
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      // Read at draw time, not render time: the palette is whatever the
      // host's tokens resolve to once it is on the page.
      const theme = mermaidThemeFor(hostRef.current);
      void renderMermaid(source, theme).then((result) => {
        if (cancelled) return;
        setDrawn((previous) => ({
          request,
          error: result.ok ? null : result.error,
          svg: result.ok ? result.svg : previous.svg,
        }));
        onResultRef.current?.(result);
      });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [request, source, delay]);

  const pending = drawn.request !== request;
  const { svg, error } = drawn;
  const stale = Boolean(svg && error);
  const name = label?.trim() || 'Diagram';

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the unchanged icon is the answer */
    }
  };

  return (
    <figure
      ref={hostRef}
      className={cn('mermaid-diagram group/diagram relative m-0 min-w-0', className)}
      aria-busy={pending || undefined}
    >
      {/* Above the drawing: while editing, the error belongs next to the
          source that caused it, not under a tall figure. */}
      {error && (
        <div
          className={cn(
            'rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-left',
            svg && 'mb-3',
          )}
        >
          <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            {stale ? 'Error — showing the last version that drew' : 'This diagram has an error'}
          </p>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
            {error}
          </pre>
        </div>
      )}

      {svg ? (
        <div
          role="img"
          aria-label={name}
          className={cn(
            // Block + auto margins rather than flex centring: a flex-centred
            // drawing wider than the figure overflows on the left too, where
            // the scrollbar cannot reach it.
            'mermaid-svg overflow-x-auto transition-opacity duration-150 [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto',
            stale && 'opacity-40',
          )}
          dangerouslySetInnerHTML={{ __html: legibleSvg(svg) }}
        />
      ) : !error ? (
        <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Drawing diagram…
        </div>
      ) : null}

      {actions && svg && !stale && (
        <div
          className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover/diagram:opacity-100"
        >
          <button
            type="button"
            className={ACTION_BUTTON}
            aria-label="Open diagram larger"
            title="Open larger"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={ACTION_BUTTON}
            aria-label={copied ? 'Diagram source copied' : 'Copy diagram source'}
            title={copied ? 'Copied' : 'Copy source'}
            onClick={() => void copySource()}
          >
            {copied ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            className={ACTION_BUTTON}
            aria-label="Download diagram as SVG"
            title="Download SVG"
            onClick={() => downloadBlob(mermaidSvgFile(svg), exportFilename(filename, 'svg'))}
          >
            <Download aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {actions && svg && (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="max-w-6xl">
            <DialogHeader>
              <DialogTitle>{name}</DialogTitle>
              <DialogDescription className="sr-only">The diagram at full size.</DialogDescription>
            </DialogHeader>
            <div
              role="img"
              aria-label={name}
              className="mt-4 flex max-h-[75vh] justify-center overflow-auto [&_svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: retargetSvg(svg, 'expanded') }}
            />
          </DialogContent>
        </Dialog>
      )}
    </figure>
  );
});
