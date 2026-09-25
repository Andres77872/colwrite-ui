import { memo, useState, type FocusEvent } from 'react';
import { BookOpen, Check, ChevronDown, Pencil, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useEditorActions,
  type CodeBlock as CodeBlockModel,
} from '@/editor';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { restoreCaretOffset } from '@/components/common/Editable/caret';
import { MermaidDiagram } from '@/components/common/MermaidDiagram';
import { CodeEditable } from '../CodeBlock/CodeEditable';
import { DIAGRAM_TEMPLATES } from './diagramTemplates';

const SYNTAX_URL = 'https://mermaid.js.org/intro/syntax-reference.html';

const CHROME_BUTTON =
  'inline-flex h-6 items-center gap-1 rounded-sm px-1.5 transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Whether focus moved into a menu this block opened (they portal out of it). */
function intoOwnMenu(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-radix-popper-content-wrapper]'));
}

/**
 * A Mermaid diagram as a document block.
 *
 * Stored as the canonical code block with `language: "mermaid"` — the source
 * is the content, and nothing about a drawing is persisted — so the API, the
 * assistant's `doc_edit` and every export already carry it. The editor draws
 * it; everywhere else the source is still readable as code.
 *
 * At rest the block is the drawing, with Edit / open larger / copy / download
 * on hover. Editing (Edit, double-click, or a new empty diagram) opens the
 * source above a live preview that redraws as the author pauses; Escape,
 * Mod+Enter, Done or moving focus elsewhere puts the drawing back. A locked
 * block only ever shows the drawing.
 */
export const DiagramBlock = memo(function DiagramBlock({ block }: { block: CodeBlockModel }) {
  const { refs, updateCodeText } = useEditorActions();
  const [editing, setEditing] = useState(false);
  const locked = block.locked === true;
  const empty = block.text.trim() === '';
  // An empty diagram has nothing to show at rest, so it opens on its source.
  // Focus inside turns that into editing (`onFocus` below), so the first
  // keystroke, which makes the text no longer empty, does not swap the source
  // for the drawing under the author's caret.
  const sourceOpen = !locked && (editing || empty);

  const openSource = () => {
    if (locked) return;
    setEditing(true);
    requestAnimationFrame(() => {
      const el = refs.current[block.id];
      if (!el) return;
      el.focus();
      restoreCaretOffset(el, Number.MAX_SAFE_INTEGER);
    });
  };

  const closeSource = () => setEditing(false);

  const applyTemplate = (source: string) => {
    updateCodeText(block.id, source);
    openSource();
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    if (intoOwnMenu(next)) return;
    closeSource();
  };

  const templates = (
    <DropdownMenu>
      <DropdownMenuTrigger className={CHROME_BUTTON} aria-label="Start from a template">
        Templates
        <ChevronDown aria-hidden="true" className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{empty ? 'Start from' : 'Replace with'}</DropdownMenuLabel>
        {DIAGRAM_TEMPLATES.map((template) => (
          <DropdownMenuItem key={template.id} onSelect={() => applyTemplate(template.source)}>
            {template.label}
            {block.text.trim() === template.source && <Check aria-hidden="true" className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (sourceOpen) {
    return (
      <div
        className="diagram-block w-full overflow-hidden rounded-[10px] bg-code-bg"
        onFocus={() => {
          if (!editing) setEditing(true);
        }}
        onBlur={onBlur}
      >
        <div
          contentEditable={false}
          className="flex items-center justify-between gap-2 px-2 pt-1.5 text-xs text-muted-foreground"
        >
          <span className="inline-flex h-6 items-center gap-1.5 px-1.5">
            <Workflow aria-hidden="true" className="h-3.5 w-3.5" />
            Mermaid diagram
          </span>
          <div className="flex items-center gap-0.5">
            {templates}
            <a
              href={SYNTAX_URL}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(CHROME_BUTTON, 'no-underline')}
            >
              <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
              Syntax
            </a>
            {!empty && (
              <button type="button" className={cn(CHROME_BUTTON, 'font-medium text-foreground')} onClick={closeSource}>
                Done
              </button>
            )}
          </div>
        </div>
        <CodeEditable
          block={block}
          ariaLabel="Diagram source, Mermaid"
          placeholder={'flowchart LR\n  A[Start] --> B[Finish]'}
          className="max-h-[50vh] pb-4 pl-6 pr-4 pt-2"
          onLeave={closeSource}
        />
        {empty ? (
          <div
            contentEditable={false}
            className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-3 text-xs text-muted-foreground"
          >
            <span className="mr-1">Start from</span>
            {DIAGRAM_TEMPLATES.slice(0, 5).map((template) => (
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
        ) : (
          <div contentEditable={false} className="border-t border-border bg-background px-4 py-4">
            <MermaidDiagram source={block.text} delay={300} label="Diagram preview" />
          </div>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="diagram-block w-full rounded-[10px] bg-code-bg px-4 py-6 text-center text-sm italic text-muted-foreground">
        Empty diagram
      </div>
    );
  }

  return (
    <div
      className="diagram-block group/diagram-block relative w-full rounded-[10px] px-2 py-3"
      onDoubleClick={openSource}
    >
      <MermaidDiagram source={block.text} actions label="Diagram" />
      {!locked && (
        <button
          type="button"
          onClick={openSource}
          className="absolute left-1 top-1 inline-flex h-7 items-center gap-1 rounded-md bg-card px-2 text-xs text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-[opacity,background-color] duration-120 hover:bg-hover hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/diagram-block:opacity-100"
        >
          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
          Edit
        </button>
      )}
    </div>
  );
});
