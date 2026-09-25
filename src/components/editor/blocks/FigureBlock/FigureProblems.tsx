import { useState } from 'react';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FigureDiagnostic } from '@/lib/figure/types';

const VISIBLE = 6;

const ICON = {
  error: { icon: AlertCircle, className: 'text-destructive', label: 'Error' },
  warning: { icon: AlertTriangle, className: 'text-warning', label: 'Warning' },
  info: { icon: Info, className: 'text-muted-foreground', label: 'Note' },
} as const;

/**
 * The figure's problems, as a list the author can act on.
 *
 * Errors stop the figure from drawing; warnings mean part of the spec was
 * ignored (an unknown key, an edge to a missing node); notes record what the
 * reader forgave (LaTeX escapes it repaired). Each row with a position jumps
 * to the offending text.
 */
export function FigureProblems({
  diagnostics,
  onSelect,
}: {
  diagnostics: readonly FigureDiagnostic[];
  onSelect: (diagnostic: FigureDiagnostic) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const problems = diagnostics.filter((diagnostic) => diagnostic.severity !== 'info');
  const notes = diagnostics.filter((diagnostic) => diagnostic.severity === 'info');
  const listed = [...problems, ...(showNotes ? notes : [])];
  if (listed.length === 0 && notes.length === 0) return null;
  const visible = showAll ? listed : listed.slice(0, VISIBLE);

  return (
    <div contentEditable={false} className="border-t border-border px-2 py-1.5 text-xs">
      <ul className="space-y-0.5" aria-label="Figure problems">
        {visible.map((diagnostic, index) => {
          const meta = ICON[diagnostic.severity];
          const Icon = meta.icon;
          const where =
            diagnostic.line !== undefined ? `${diagnostic.line}:${diagnostic.column ?? 1}` : diagnostic.path ?? '';
          return (
            <li key={`${diagnostic.code}-${index}`}>
              <button
                type="button"
                disabled={!diagnostic.range}
                onClick={() => onSelect(diagnostic)}
                className="flex w-full items-start gap-2 rounded-sm px-1.5 py-1 text-left transition-colors enabled:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              >
                <Icon aria-label={meta.label} className={cn('mt-px h-3.5 w-3.5 shrink-0', meta.className)} />
                <span className="min-w-0 flex-1 leading-relaxed text-foreground">{diagnostic.message}</span>
                {where && <span className="shrink-0 font-mono text-2xs text-muted-foreground">{where}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-3 px-1.5 pt-0.5 text-muted-foreground">
        {listed.length > VISIBLE && (
          <button type="button" className="hover:text-foreground" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Show fewer' : `Show all ${listed.length}`}
          </button>
        )}
        {notes.length > 0 && (
          <button type="button" className="hover:text-foreground" onClick={() => setShowNotes((value) => !value)}>
            {showNotes ? 'Hide notes' : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
    </div>
  );
}
