import { useEffect, useMemo, useRef, useState } from 'react';
import type { EquationChild } from '@/editor';
import type { InlineWidgetProps } from '../types';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useEditor } from '@/editor';
import { katexStatus, onKatexStatus, renderLatex, type KatexStatus } from '@/lib/katex';
import {
  InlinePill,
  InlinePopover,
  SettingsCheck,
  SettingsFooter,
  SettingsRow,
  stopEditorEvents,
  useInlineChild,
} from '../shared';
import { AlertCircle } from 'lucide-react';

/**
 * Type-guard wrapper. It declares no hooks, so returning early here is safe;
 * the guard used to sit above the content component's hooks, which meant a
 * child whose type changed in place rendered fewer hooks than the previous
 * pass and crashed React.
 */
export function EquationInline({ child, ...rest }: InlineWidgetProps) {
  if (child.type !== 'equation') return null;
  return <EquationInlineContent child={child} {...rest} />;
}

/** Symbols an author reaches for constantly and cannot type. */
const PALETTE: Array<{ label: string; insert: string; caret?: number }> = [
  { label: '𝑥ⁿ', insert: '^{}', caret: 2 },
  { label: '𝑥ₙ', insert: '_{}', caret: 2 },
  { label: 'a⁄b', insert: '\\frac{}{}', caret: 6 },
  { label: '√', insert: '\\sqrt{}', caret: 6 },
  { label: '∑', insert: '\\sum_{i=1}^{n} ' },
  { label: '∫', insert: '\\int_{a}^{b} ' },
  { label: '∂', insert: '\\partial ' },
  { label: '∞', insert: '\\infty ' },
  { label: 'α', insert: '\\alpha ' },
  { label: 'β', insert: '\\beta ' },
  { label: 'θ', insert: '\\theta ' },
  { label: 'λ', insert: '\\lambda ' },
  { label: 'μ', insert: '\\mu ' },
  { label: 'σ', insert: '\\sigma ' },
  { label: '≈', insert: '\\approx ' },
  { label: '≤', insert: '\\leq ' },
  { label: '≥', insert: '\\geq ' },
  { label: '×', insert: '\\times ' },
  { label: '→', insert: '\\to ' },
  { label: '𝐯', insert: '\\mathbf{}', caret: 8 },
];

/** Watch KaTeX so the widget re-renders the moment it becomes available. */
function useKatexStatus(): KatexStatus {
  const [status, setStatus] = useState<KatexStatus>(katexStatus);
  useEffect(() => onKatexStatus(setStatus), []);
  return status;
}

function EquationInlineContent(props: InlineWidgetProps<EquationChild>) {
  const { child } = props;
  const { patch, remove } = useInlineChild(props);
  const { blocks } = useEditor();
  const status = useKatexStatus();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const latex = child.latex ?? '';
  const display = child.display === true;

  const rendered = useMemo(
    // `status` is not read in the body but is what makes this recompute once
    // the script lands — without it the first render's failure would stick.
    () => (latex.trim() && status === 'ready' ? renderLatex(latex, display) : null),
    [latex, display, status],
  );
  const hasError = rendered != null && !rendered.ok && status === 'ready';

  /**
   * Equation number, counted across the whole document.
   *
   * The old citation and equation widgets both numbered within their own
   * paragraph, so a paper had several "(1)"s. Numbering is a document-level
   * property; anything else is wrong on the page.
   */
  const number = useMemo(() => {
    let count = 0;
    for (const block of blocks) {
      if (block.type !== 'paragraph') continue;
      for (const candidate of block.children ?? []) {
        if (candidate.type !== 'equation' || !candidate.numbered || !candidate.display) continue;
        count += 1;
        if (candidate.id === child.id) return count;
      }
    }
    return count || 1;
  }, [blocks, child.id]);

  const insert = (snippet: string, caretOffset?: number) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? latex.length;
    const end = el?.selectionEnd ?? latex.length;
    const next = latex.slice(0, start) + snippet + latex.slice(end);
    patch({ latex: next });
    requestAnimationFrame(() => {
      const position = start + (caretOffset ?? snippet.length);
      el?.focus();
      el?.setSelectionRange(position, position);
    });
  };

  const preview = (className?: string) => {
    if (!latex.trim()) {
      return <span className="text-sm text-muted-foreground">Empty equation</span>;
    }
    if (status === 'loading') {
      return <code className={cn('font-mono text-sm opacity-60', className)}>{latex}</code>;
    }
    if (rendered?.ok) {
      // KaTeX output is markup it generated from the author's own LaTeX, and
      // the source never leaves this editor — but it is still the one place
      // markup is injected, so it is confined to this branch.
      return <span className={className} dangerouslySetInnerHTML={{ __html: rendered.html }} />;
    }
    return <code className={cn('font-mono text-sm', className)}>{latex}</code>;
  };

  const editor = (close: () => void) => (
    <div className="w-[22rem] max-w-[80vw]">
      <SettingsRow
        label="LaTeX"
        htmlFor={`latex-${child.id}`}
        hint="Shift+Enter adds a line; Enter finishes."
      >
        <Textarea
          id={`latex-${child.id}`}
          ref={inputRef}
          rows={2}
          value={latex}
          placeholder="E = mc^2"
          onChange={(event) => patch({ latex: event.target.value })}
          onKeyDown={(event) => {
            // Plain Enter confirms — the pattern the table's cells and the
            // widget docs share. Shift+Enter is the escape hatch, because
            // multi-line LaTeX (aligned, cases) is ordinary maths, not an edge.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              close();
            }
          }}
          className="min-h-0 resize-y px-2 py-1.5 font-mono"
        />
      </SettingsRow>

      <div className="mb-2 flex flex-wrap gap-0.5">
        {PALETTE.map((symbol) => (
          <button
            key={symbol.label}
            type="button"
            title={symbol.insert.trim()}
            onClick={() => insert(symbol.insert, symbol.caret)}
            className="h-7 min-w-7 rounded-sm px-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {symbol.label}
          </button>
        ))}
      </div>

      <div className="mb-2 space-y-1.5">
        <SettingsCheck
          id={`display-${child.id}`}
          label="Display on its own line"
          checked={display}
          onChange={(checked) => patch({ display: checked })}
        />
        <SettingsCheck
          id={`numbered-${child.id}`}
          label="Numbered"
          checked={display && child.numbered === true}
          disabled={!display}
          hint={display ? undefined : 'Only display equations are numbered'}
          onChange={(checked) => patch({ numbered: checked })}
        />
      </div>

      {display && child.numbered && (
        <SettingsRow label="Label" htmlFor={`label-${child.id}`} hint="Used for cross-references.">
          <Input
            id={`label-${child.id}`}
            type="text"
            value={child.labelId ?? ''}
            placeholder="eq:mass-energy"
            onChange={(event) => patch({ labelId: event.target.value })}
            className="h-8 px-2"
          />
        </SettingsRow>
      )}

      <div className="min-h-[3rem] rounded-md bg-muted px-3 py-2 text-center">{preview()}</div>

      {hasError && (
        <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{rendered.error}</span>
        </p>
      )}
      {status === 'unavailable' && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Typesetting is unavailable offline — the LaTeX is saved and will render once the page can
          reach the maths library again.
        </p>
      )}

      <SettingsFooter onRemove={remove} onDone={close} />
    </div>
  );

  /* ----------------------------------------
     One popover, two triggers: inline maths sits in the run of text as a
     pill; display maths takes a centred line of its own with a right-aligned
     number, the way it appears in a paper.
     ---------------------------------------- */

  const trigger = display ? (
    <button
      type="button"
      aria-label={latex || 'Empty equation'}
      className="grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-card"
      title="Edit equation"
    >
      <span className="overflow-x-auto text-center">{preview('text-base')}</span>
      {child.numbered && (
        <span className="shrink-0 tabular-nums text-sm text-muted-foreground">({number})</span>
      )}
    </button>
  ) : (
    <InlinePill
      aria-label={latex || 'Empty equation'}
      tone={hasError ? 'error' : 'default'}
      title={hasError ? rendered.error : 'Edit equation'}
    >
      {preview('text-sm')}
    </InlinePill>
  );

  return (
    <span
      className={display ? 'equation-inline my-3 block' : 'equation-inline relative inline-block align-baseline'}
      role="group"
      aria-label={display ? 'Display equation' : 'Equation'}
      contentEditable={false}
      {...stopEditorEvents}
    >
      <InlinePopover align={display ? 'center' : 'start'} contentClassName="w-auto p-3" trigger={trigger}>
        {editor}
      </InlinePopover>
    </span>
  );
}
