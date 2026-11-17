import { useId } from 'react';
import { cn } from '@/lib/utils';
import { CITATION_CREDITS, CITATION_STYLES, useCitationProcessor, type CitationStyle } from '@/editor';

/**
 * The page's citation style: the short list of CSL styles, by name, with
 * how a citation reads in each (09 §9). The processor and the styles are
 * credited here, as their licences ask: citeproc-js's CPAL attribution
 * notice, and the Citation Style Language project with a link.
 *
 * `null` is "Auto": the style most of the page's citations name.
 */
export function CitationStylePicker({
  value,
  onChange,
  disabled = false,
  allowAuto = true,
  className,
}: {
  value: CitationStyle | null;
  onChange: (style: CitationStyle | null) => void;
  disabled?: boolean;
  allowAuto?: boolean;
  className?: string;
}) {
  const creditId = useId();
  // Choosing a style is about to render one: load the processor now.
  useCitationProcessor();
  const options: Array<{ id: CitationStyle | null; name: string; example: string; title?: string }> = [
    ...(allowAuto ? [{ id: null, name: 'Auto', example: 'As the citations are' }] : []),
    ...CITATION_STYLES.map((style) => ({ id: style.id, name: style.name, example: style.example, title: style.cslTitle })),
  ];
  return (
    <div className={cn('space-y-2', className)}>
      <div role="radiogroup" aria-label="Citation style" aria-describedby={creditId} className="grid grid-cols-2 gap-0.5">
        {options.map((option) => {
          const active = value === option.id;
          return (
            <button
              key={option.id ?? 'auto'}
              type="button"
              role="radio"
              aria-checked={active}
              title={option.title}
              disabled={disabled && !active}
              onClick={() => !disabled && onChange(option.id)}
              className={cn(
                'flex min-w-0 flex-col items-start rounded-md px-2 py-1 text-left text-xs transition-colors duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
                active ? 'bg-active font-medium text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
              )}
            >
              <span className="w-full truncate">{option.name}</span>
              <span className={cn('w-full truncate font-normal', active ? 'text-foreground/70' : 'text-muted-foreground')}>{option.example}</span>
            </button>
          );
        })}
      </div>
      <CitationCredits id={creditId} />
    </div>
  );
}

/** The processor's CPAL attribution notice and the CSL project's credit. */
export function CitationCredits({ id, className }: { id?: string; className?: string }) {
  const { citeproc, csl } = CITATION_CREDITS;
  return (
    <p id={id} className={cn('text-2xs leading-relaxed text-muted-foreground', className)}>
      {citeproc.notice}{' '}
      <a href={citeproc.source} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-foreground">
        Source
      </a>
      {' · '}
      <a href={citeproc.license} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-foreground">
        CPAL-1.0
      </a>
. Styles from the{' '}
      <a href={csl.link} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-foreground">
        Citation Style Language project
      </a>
      , unmodified, under{' '}
      <a href={csl.license} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-foreground">
        CC BY-SA 3.0
      </a>
      .
    </p>
  );
}
