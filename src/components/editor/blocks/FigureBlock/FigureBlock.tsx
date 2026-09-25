import { memo, useCallback, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { BookOpen, Check, ChevronDown, Pencil, Shapes, Sparkles, WandSparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEditorActions, type CodeBlock as CodeBlockModel } from '@/editor';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { restoreCaretOffset } from '@/components/common/Editable/caret';
import { StructuredFigure } from '@/components/common/StructuredFigure';
import { figureMeta } from '@/lib/figure/compile';
import { formatFigureSource, setItemProperty } from '@/lib/figure/edit';
import { FIGURE_TEMPLATES, type FigureTemplate } from '@/lib/figure/templates';
import type { CompiledFigure, FigureDiagnostic } from '@/lib/figure/types';
import { openAskAi } from '../../AskAi/askAiEvents';
import { CodeEditable } from '../CodeBlock/CodeEditable';
import { FigureInspector, type FigureEdit, type FigureSelection } from './FigureInspector';
import { FigureProblems } from './FigureProblems';
import { FigureReference } from './FigureReference';
import { selectSourceRange } from './sourceSelection';

const CHROME_BUTTON =
  'inline-flex h-6 items-center gap-1 rounded-sm px-1.5 transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

const CATEGORY_LABELS: Record<FigureTemplate['category'], string> = {
  architecture: 'Architectures',
  mechanism: 'Mechanisms',
  pipeline: 'Pipelines',
  layout: 'Panels and tensors',
};

/** Whether focus moved into a menu or popover this block opened (they portal out of it). */
function intoOwnPopup(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-radix-popper-content-wrapper]'));
}

/** A spec with nothing to draw yet: empty text, or the caption a prose block was turned into. */
function isStarter(text: string): boolean {
  return !text.trim() || figureMeta(text).empty;
}

/**
 * A structured figure as a document block.
 *
 * Stored as the canonical code block with `language: "figure"`: the JSON spec
 * is the content and nothing about the drawing is persisted, so the API, the
 * assistant's `doc_edit` and every export carry it. The editor lays it out and
 * draws it (`StructuredFigure`); anywhere else the source is still readable.
 *
 * At rest the block is the figure with its numbered caption, and hover
 * actions to enlarge, copy, download SVG or copy TikZ. Editing (Edit,
 * double-click, or a new empty figure) opens the source above a live preview
 * that redraws as the author pauses, with the problems list between them.
 * Clicking an item in the preview selects its definition in the source and
 * opens quick edits for it. A locked block only ever shows the figure.
 */
export const FigureBlock = memo(function FigureBlock({
  block,
  number,
}: {
  block: CodeBlockModel;
  /** Position among the document's captioned figures. */
  number?: number;
}) {
  const { refs, updateCodeText } = useEditorActions();
  const [editing, setEditing] = useState(false);
  const [compiled, setCompiled] = useState<CompiledFigure | null>(null);
  const [selection, setSelection] = useState<FigureSelection | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const locked = block.locked === true;
  const empty = block.text.trim() === '';
  const starter = isStarter(block.text);
  // A starter has nothing to show at rest, so it opens on its source and the
  // ways to fill it, like an empty diagram does. Focus inside turns that into
  // editing (`onFocus` below), so the first keystroke, which usually makes the
  // text no starter and not yet a figure, does not close the source under it.
  const sourceOpen = !locked && (editing || starter);

  const focusSource = useCallback(
    (then?: (el: HTMLElement) => void) => {
      requestAnimationFrame(() => {
        const el = refs.current[block.id];
        if (!el) return;
        if (then) then(el);
        else {
          el.focus();
          restoreCaretOffset(el, Number.MAX_SAFE_INTEGER);
        }
      });
    },
    [block.id, refs],
  );

  const openSource = () => {
    if (locked) return;
    setEditing(true);
    focusSource();
  };

  const closeSource = () => {
    setEditing(false);
    setSelection(null);
  };

  const applyTemplate = (source: string) => {
    updateCodeText(block.id, source);
    setSelection(null);
    setEditing(true);
    focusSource((el) => {
      el.focus();
      el.scrollTop = 0;
    });
  };

  const format = () => {
    const formatted = formatFigureSource(block.text);
    if (formatted !== null && formatted !== block.text) updateCodeText(block.id, formatted);
  };

  const askAssistant = () => openAskAi({ blockId: block.id });

  const reveal = (range: [number, number] | undefined) => {
    if (!range) return;
    focusSource((el) => selectSourceRange(el, range[0], range[1]));
  };

  const revealDiagnostic = (diagnostic: FigureDiagnostic) => reveal(diagnostic.range);

  const selectItem = (id: string, kind: FigureSelection['kind']) => {
    setSelection((current) => (current?.id === id ? null : { id, kind }));
  };

  const itemRange = (target: FigureSelection | null): [number, number] | undefined => {
    if (!target || !compiled?.model) return undefined;
    if (target.kind === 'edge') return compiled.model.edges.find((edge) => edge.id === target.id)?.range;
    return compiled.model.items.get(target.id)?.range;
  };

  const edit = (id: string, changes: FigureEdit) => {
    let next: string | null = block.text;
    for (const [key, value] of changes) {
      if (next === null) break;
      next = setItemProperty(next, id, key, value) ?? next;
    }
    if (next !== null && next !== block.text) updateCodeText(block.id, next);
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    if (intoOwnPopup(next)) return;
    closeSource();
  };

  const closeInspector = () => {
    // The X unmounts with focus on it, and no blur follows: focus would drop
    // to the page and nothing inside would be left to close the source when
    // the author moves on. The preview holds it instead.
    previewRef.current?.focus({ preventScroll: true });
    setSelection(null);
  };

  const onRestDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    // React bubbles events out of portals: a double-click in the enlarged
    // view, or a quick one on a hover action, is not a request to edit.
    const target = event.target as Element;
    if (!event.currentTarget.contains(target) || target.closest('button')) return;
    openSource();
  };

  const templates = (
    <DropdownMenu>
      <DropdownMenuTrigger className={CHROME_BUTTON} aria-label="Start from a template">
        Templates
        <ChevronDown aria-hidden="true" className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[60vh] w-64 overflow-y-auto">
        {(Object.keys(CATEGORY_LABELS) as FigureTemplate['category'][]).map((category, index) => {
          const items = FIGURE_TEMPLATES.filter((template) => template.category === category);
          if (items.length === 0) return null;
          return (
            <div key={category}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{CATEGORY_LABELS[category]}</DropdownMenuLabel>
              {items.map((template) => (
                <DropdownMenuItem key={template.id} onSelect={() => applyTemplate(template.source)}>
                  <span className="flex min-w-0 flex-col">
                    <span>{template.label}</span>
                    <span className="truncate text-2xs text-muted-foreground">{template.description}</span>
                  </span>
                  {block.text.trim() === template.source.trim() && <Check aria-hidden="true" className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (sourceOpen) {
    const problems = compiled?.diagnostics ?? [];
    const errors = problems.filter((diagnostic) => diagnostic.severity === 'error').length;
    const warnings = problems.filter((diagnostic) => diagnostic.severity === 'warning').length;
    return (
      // Focusable, so a click on its chrome (labels, counts, gaps) keeps focus
      // in the block instead of handing it to the canvas and closing it.
      <div
        className="figure-block w-full overflow-hidden rounded-[10px] bg-code-bg outline-none"
        tabIndex={-1}
        onFocus={() => {
          if (!editing) setEditing(true);
        }}
        onBlur={onBlur}
      >
        <div
          contentEditable={false}
          className="flex flex-wrap items-center justify-between gap-2 px-2 pt-1.5 text-xs text-muted-foreground"
        >
          <span className="inline-flex h-6 items-center gap-1.5 px-1.5">
            <Shapes aria-hidden="true" className="h-3.5 w-3.5" />
            Figure
            {!starter && (errors > 0 || warnings > 0) && (
              <span className={cn('ml-1', errors > 0 ? 'text-destructive' : 'text-warning')}>
                {errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : `${warnings} warning${warnings === 1 ? '' : 's'}`}
              </span>
            )}
          </span>
          <div className="flex items-center gap-0.5">
            <button type="button" className={cn(CHROME_BUTTON, 'text-ai hover:text-ai')} onClick={askAssistant}>
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
              Ask AI
            </button>
            {templates}
            <Popover>
              <PopoverTrigger className={CHROME_BUTTON}>
                <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
                Reference
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[26rem] max-w-[90vw]">
                <FigureReference />
              </PopoverContent>
            </Popover>
            <button
              type="button"
              className={CHROME_BUTTON}
              onClick={format}
              // A starter's text always reads (that is how it is known), but no
              // preview compiles it.
              disabled={empty || (!starter && !compiled?.parse.ast)}
              title="Pretty-print the JSON (comments are kept)"
            >
              <WandSparkles aria-hidden="true" className="h-3.5 w-3.5" />
              Format
            </button>
            {!starter && (
              <button type="button" className={cn(CHROME_BUTTON, 'font-medium text-foreground')} onClick={closeSource}>
                Done
              </button>
            )}
          </div>
        </div>
        <CodeEditable
          block={block}
          ariaLabel="Figure source, JSON"
          placeholder={'{\n  "caption": "…",\n  "nodes": ["a", "b"],\n  "edges": ["a -> b"]\n}'}
          className="max-h-[45vh] pb-4 pl-6 pr-4 pt-2"
          onLeave={closeSource}
        />
        {/* A starter is a placeholder to fill: its missing nodes are not a problem to report. */}
        {!starter && compiled && <FigureProblems diagnostics={compiled.diagnostics} onSelect={revealDiagnostic} />}
        {starter ? (
          <div
            contentEditable={false}
            className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-3 text-xs text-muted-foreground"
          >
            <button
              type="button"
              onClick={askAssistant}
              className="mr-1 inline-flex items-center gap-1 rounded-full bg-ai/10 px-2.5 py-1 font-medium text-ai transition-colors hover:bg-ai/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
              Describe it to the assistant
            </button>
            <span className="mr-1">or start from</span>
            {FIGURE_TEMPLATES.slice(0, 6).map((template) => (
              <button
                key={template.id}
                type="button"
                className="rounded-full bg-background px-2.5 py-1 text-foreground ring-1 ring-border transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => applyTemplate(template.source)}
              >
                {template.label}
              </button>
            ))}
          </div>
        ) : null}
        {!starter && (
          // Focusable so a click on the drawing keeps focus on it, where closing
          // the item editor also puts it.
          <div
            ref={previewRef}
            contentEditable={false}
            tabIndex={-1}
            className="border-t border-border bg-background px-4 py-4 outline-none"
          >
            <StructuredFigure
              source={block.text}
              number={number}
              delay={250}
              label="Figure preview"
              selectedId={selection?.id ?? null}
              onSelectItem={selectItem}
              onCompiled={setCompiled}
            />
            {!selection && compiled?.ok && (
              <p className="mt-3 text-center text-2xs text-muted-foreground">
                Click any part of the figure to edit it or find it in the source.
              </p>
            )}
          </div>
        )}
        {!starter && selection && compiled && (
          <FigureInspector
            selection={selection}
            compiled={compiled}
            onEdit={edit}
            onReveal={() => reveal(itemRange(selection))}
            onClose={closeInspector}
          />
        )}
      </div>
    );
  }

  if (starter) {
    return (
      <div className="figure-block w-full rounded-[10px] bg-code-bg px-4 py-6 text-center text-sm italic text-muted-foreground">
        {empty ? 'Empty figure' : figureMeta(block.text).draft ?? 'Figure not drawn yet'}
      </div>
    );
  }

  return (
    <div className="figure-block group/figure-block relative w-full rounded-[10px] px-2 py-3" onDoubleClick={onRestDoubleClick}>
      <StructuredFigure source={block.text} number={number} actions label="Figure" onCompiled={setCompiled} />
      {!locked && (
        <button
          type="button"
          onClick={openSource}
          className="absolute left-1 top-1 inline-flex h-7 items-center gap-1 rounded-md bg-card px-2 text-xs text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-[opacity,background-color] duration-120 hover:bg-hover hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/figure-block:opacity-100"
        >
          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
          Edit
        </button>
      )}
    </div>
  );
});
