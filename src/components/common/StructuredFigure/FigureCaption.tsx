import { cn } from '@/lib/utils';
import { renderLatex } from '@/lib/katex';
import { parseLabel } from '@/lib/figure/labels';

/**
 * "Figure 3. Caption text" — the way a printed paper labels a figure.
 *
 * Maths in the caption (`$…$`) is typeset like the rest of the document. The
 * caption box shrinks to its text and centres when it fits on one line, and
 * fills the column justified when it runs longer — LaTeX's own rule, done in
 * CSS with a table box so no measuring is needed.
 */
export function FigureCaption({
  caption,
  number,
  className,
}: {
  caption: string | null;
  /** Position among the document's captioned figures; omitted in previews. */
  number?: number;
  className?: string;
}) {
  if (!caption && number === undefined) return null;
  const label = parseLabel(caption ?? '');
  return (
    <figcaption
      className={cn(
        'figure-caption mx-auto mt-2.5 table max-w-full text-justify text-[0.8125rem] leading-relaxed text-foreground [hyphens:auto]',
        className,
      )}
    >
      {number !== undefined && (
        <span className="figure-caption-number font-semibold">
          Figure {number}.{caption ? ' ' : ''}
        </span>
      )}
      {label.lines.map((line, lineIndex) => (
        <span key={lineIndex}>
          {lineIndex > 0 && ' '}
          {line.map((segment, index) => {
            if (segment.kind === 'text') return <span key={index}>{segment.value}</span>;
            const rendered = renderLatex(segment.value, false, { lenient: true });
            return rendered.ok ? (
              <span key={index} className="math" dangerouslySetInnerHTML={{ __html: rendered.html }} />
            ) : (
              <code key={index} className="text-destructive">{`$${segment.value}$`}</code>
            );
          })}
        </span>
      ))}
    </figcaption>
  );
}
