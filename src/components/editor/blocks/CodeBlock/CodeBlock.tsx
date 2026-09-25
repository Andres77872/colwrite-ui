import { memo, useContext, useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, Shapes, Workflow } from 'lucide-react';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToastContext } from '@/components/ui/toastContext';
import { MERMAID_LANGUAGE } from '@/lib/mermaid';
import { FIGURE_LANGUAGE } from '@/lib/figure/constants';
import { CODE_LANGUAGES, codeLanguageLabel, findCodeLanguage } from './codeLanguages';
import { CodeEditable } from './CodeEditable';

/** The chrome row takes no clicks itself; its buttons do. */
const CHROME_BUTTON =
  'pointer-events-auto inline-flex h-6 items-center gap-1 rounded-sm px-1.5 transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60';

/**
 * A code block: plain text, whitespace preserved, edited in place.
 *
 * The text itself is `CodeEditable`; this adds the chrome — the language as a
 * quiet label that opens a picker, and Copy. A language the picker does not
 * list (the assistant or a pasted fence can store any identifier) is shown
 * as it is. Under "Draw as", "Mermaid diagram" makes the block a diagram
 * (`DiagramBlock`) and "Structured figure" a figure (`FigureBlock`), each
 * drawing the same text.
 */
export const CodeBlock = memo(function CodeBlock({ block }: { block: CodeBlockModel }) {
  const { setCodeLanguage } = useEditorActions();
  const toaster = useContext(ToastContext);
  const [copied, setCopied] = useState(false);
  const locked = block.locked === true;
  const current = findCodeLanguage(block.language);
  const label = codeLanguageLabel(block.language);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(block.text);
      setCopied(true);
    } catch {
      toaster?.toast({ title: 'Could not copy the code', variant: 'error' });
    }
  };

  return (
    <div className="code-block group/code relative w-full rounded-[10px] bg-code-bg">
      {/* Chrome floats over the block's top padding: the language as a quiet
          label on the left, Copy on the right once the block is hovered (and
          always on touch screens, which cannot hover). Clicks between the two
          go through to the text. */}
      <div
        contentEditable={false}
        className="pointer-events-none absolute inset-x-2 top-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground"
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={locked}
            className={CHROME_BUTTON}
            aria-label={`Code language: ${label}`}
          >
            {label}
            {!locked && <ChevronDown aria-hidden="true" className="h-3 w-3" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-48 overflow-y-auto">
            {!current && block.language && (
              <>
                <DropdownMenuItem>
                  <span className="truncate">{block.language}</span>
                  <Check aria-hidden="true" className="ml-auto" />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {CODE_LANGUAGES.map((language) => (
              <DropdownMenuItem
                key={language.id || 'plain'}
                onSelect={() => {
                  if (current?.id !== language.id) setCodeLanguage(block.id, language.id || null);
                }}
              >
                {language.label}
                {current?.id === language.id && <Check aria-hidden="true" className="ml-auto" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Draw as</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setCodeLanguage(block.id, MERMAID_LANGUAGE)}>
              <Workflow aria-hidden="true" />
              Mermaid diagram
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCodeLanguage(block.id, FIGURE_LANGUAGE)}>
              <Shapes aria-hidden="true" />
              Structured figure
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={() => void copy()}
          className={cn(
            CHROME_BUTTON,
            'bg-code-bg opacity-0 transition-[opacity,background-color] focus-visible:opacity-100 group-hover/code:opacity-100 [@media(hover:none)]:opacity-100',
            copied && 'opacity-100',
          )}
        >
          {copied ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Code copied' : ''}
        </span>
      </div>
      <CodeEditable
        block={block}
        ariaLabel={`Code block${block.language ? `, ${label}` : ''}`}
        className="max-h-[70vh] pb-5 pl-6 pr-4 pt-9"
      />
    </div>
  );
});
