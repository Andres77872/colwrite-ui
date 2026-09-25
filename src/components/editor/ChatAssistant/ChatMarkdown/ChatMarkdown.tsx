import { Fragment, memo, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Code2, Shapes, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderLatex } from '@/lib/katex';
import { MERMAID_LANGUAGE } from '@/lib/mermaid';
import { FIGURE_LANGUAGE } from '@/lib/figure/constants';
import { MermaidDiagram } from '@/components/common/MermaidDiagram';
import { StructuredFigure } from '@/components/common/StructuredFigure';

/**
 * Minimal markdown renderer for assistant replies.
 *
 * The agent writes in markdown — headings, lists, `code`, **emphasis** — and
 * rendering that as literal asterisks made every structured answer harder to
 * read than the plain prose it replaced. It also writes maths (`$…$`,
 * `$$…$$`, `\(…\)`, `\[…\]`), Mermaid diagrams (```mermaid fences) and
 * structured figures (```figure fences), which are typeset and drawn rather
 * than shown as source.
 *
 * Deliberately builds React elements instead of HTML: model output is
 * untrusted text. The only markup injected is produced by a renderer from
 * that text, never the text itself — KaTeX with `trust: false` (no `\href`,
 * no raw HTML), and Mermaid in strict mode, whose SVG is DOMPurify-sanitised
 * (`src/lib/mermaid.ts`). The supported subset is small on purpose — anything
 * unrecognised, including maths KaTeX cannot parse, falls through as the
 * literal characters the model wrote, which is always safe and usually what
 * was meant.
 */

type InlineToken = {
  type: 'text' | 'code' | 'bold' | 'italic' | 'link' | 'sources' | 'math';
  value: string;
  href?: string;
  ids?: string[];
  /** Maths only: the source without its delimiters, and whether it is display maths. */
  latex?: string;
  display?: boolean;
};

/**
 * How the answer's `[S3]` markers resolve: the number the reader sees, what
 * the source is, and what clicking the marker does. Numbers follow the order
 * sources are first cited in the answer, the way a paper numbers them.
 */
export type SourceMarkers = {
  numberOf: (id: string) => number | undefined;
  describe: (id: string) => string | undefined;
  onActivate?: (id: string) => void;
  /** Dresses a marker — the assistant wraps each in a hover preview. */
  wrap?: (id: string, marker: ReactElement) => ReactNode;
};

/**
 * Inline maths, in the delimiters models actually write.
 *
 * `$…$` is the one that collides with prose, so it follows pandoc's rule: the
 * opening `$` is not followed by a space, the closing one is not preceded by
 * a space and not followed by a digit, and neither is escaped or glued to a
 * word. "$5 and $10", "US$5" and "costs 5$" all stay text. `$$…$$` on one line
 * is display maths inside a paragraph; `\(…\)` is inline. `\[…\]` is only
 * recognised on its own lines (see `mathBlockAt`) — inline, it is far more
 * often an escaped bracket than an equation.
 */
const MATH_INLINE = String.raw`(\$\$[^$\n]+?\$\$)|(\\\([^\n]+?\\\))|((?<![\\\w$])\$(?![\s$])(?:\\.|[^$\n\\])+?(?<![\s\\])\$(?![\d$]))`;

const INLINE_PATTERN = new RegExp(
  String.raw`(\`[^\`\n]+\`)|` +
    MATH_INLINE +
    String.raw`|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(\[S\d{1,5}(?:\s*[,;]\s*S\d{1,5})*\](?!\())|(\[[^\]\n]+\]\([^)\s]+\))`,
  'g',
);

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) tokens.push({ type: 'text', value: text.slice(lastIndex, index) });

    const raw = match[0];
    if (raw.startsWith('`')) {
      tokens.push({ type: 'code', value: raw.slice(1, -1) });
    } else if (raw.startsWith('$$')) {
      tokens.push({ type: 'math', value: raw, latex: raw.slice(2, -2), display: true });
    } else if (raw.startsWith('\\(')) {
      tokens.push({ type: 'math', value: raw, latex: raw.slice(2, -2), display: false });
    } else if (raw.startsWith('$')) {
      tokens.push({ type: 'math', value: raw, latex: raw.slice(1, -1), display: false });
    } else if (/^\[S\d/.test(raw)) {
      tokens.push({ type: 'sources', value: raw, ids: raw.slice(1, -1).split(/\s*[,;]\s*/) });
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ type: 'bold', value: raw.slice(2, -2) });
    } else if (raw.startsWith('[')) {
      const split = raw.indexOf('](');
      tokens.push({
        type: 'link',
        value: raw.slice(1, split),
        href: raw.slice(split + 2, -1),
      });
    } else {
      tokens.push({ type: 'italic', value: raw.slice(1, -1) });
    }
    lastIndex = index + raw.length;
  }

  if (lastIndex < text.length) tokens.push({ type: 'text', value: text.slice(lastIndex) });
  return tokens;
}

/** Whether any id in a marker names a source this answer received. */
function knownIds(ids: string[], markers?: SourceMarkers): { id: string; number: number }[] {
  return ids
    .map((id) => ({ id, number: markers?.numberOf(id) }))
    .filter((entry): entry is { id: string; number: number } => entry.number !== undefined);
}

function SourceMarker({ ids, markers }: { ids: string[]; markers?: SourceMarkers }) {
  const known = knownIds(ids, markers);
  // A marker naming no source this answer received is shown as written: an
  // id the assistant made up must not look like a real citation.
  if (known.length === 0) return <>{`[${ids.join(', ')}]`}</>;
  // Baseline pills rather than superscripts: a <sup> of a small font came
  // out at 7px, too small to read or to hit. Grey at rest like the page's own
  // [n] citations, the link colour only when pointed at — the tinted blue
  // pill read weakly in dark mode.
  return (
    <span className="ml-0.5 inline-flex gap-0.5 align-baseline">
      {known.map(({ id, number }) => {
        const marker = (
          <button
            type="button"
            onClick={() => markers?.onActivate?.(id)}
            title={markers?.wrap ? undefined : markers?.describe(id)}
            aria-label={`Source ${number}: ${markers?.describe(id) ?? id}`}
            className="relative -top-px inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-hover px-1 text-[12px] font-medium leading-none tabular-nums text-sidebar-foreground transition-colors duration-120 hover:bg-primary/10 hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {number}
          </button>
        );
        return <Fragment key={id}>{markers?.wrap ? markers.wrap(id, marker) : marker}</Fragment>;
      })}
    </span>
  );
}

/**
 * Maths, typeset. What KaTeX cannot parse is shown exactly as the model wrote
 * it, delimiters and all — a false positive on a dollar amount then reads as
 * the prose it was.
 */
const MathView = memo(function MathView({
  latex,
  display,
  raw,
}: {
  latex: string;
  display: boolean;
  raw: string;
}) {
  const result = useMemo(() => renderLatex(latex.trim(), display, { lenient: true }), [latex, display]);
  if (!result.ok || !latex.trim()) return <>{raw}</>;
  return (
    <span
      className={cn(
        'chat-math',
        display && 'block max-w-full overflow-x-auto overflow-y-hidden [&_.katex-display]:my-1',
      )}
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  );
});

/** Bold and italic runs keep their code and maths; citations stay top-level only. */
function renderNested(text: string, markers?: SourceMarkers): ReactNode {
  return tokenizeInline(text).map((token, index) =>
    token.type === 'sources' ? <Fragment key={index}>{token.value}</Fragment> : renderToken(token, index, markers),
  );
}

function renderToken(token: InlineToken, key: number, markers?: SourceMarkers): ReactNode {
  switch (token.type) {
    case 'sources':
      return <SourceMarker key={key} ids={token.ids ?? []} markers={markers} />;
    case 'code':
      return (
        <code key={key} className="rounded-xs bg-inline-code-bg px-1 py-0.5 font-mono text-[0.85em] text-inline-code-fg">
          {token.value}
        </code>
      );
    case 'math':
      return (
        <MathView key={key} latex={token.latex ?? ''} display={token.display === true} raw={token.value} />
      );
    case 'bold':
      return (
        <strong key={key} className="font-semibold">
          {renderNested(token.value, markers)}
        </strong>
      );
    case 'italic':
      return <em key={key}>{renderNested(token.value, markers)}</em>;
    case 'link':
      // Only http(s) survives: a `javascript:` href in model output would
      // otherwise become a one-click script execution.
      return /^https?:\/\//i.test(token.href ?? '') ? (
        <a
          key={key}
          href={token.href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
        >
          {token.value}
        </a>
      ) : (
        <Fragment key={key}>{token.value}</Fragment>
      );
    default:
      return <Fragment key={key}>{token.value}</Fragment>;
  }
}

/**
 * A citation belongs to the word before it and the punctuation after it: the
 * three are kept on one line, so a narrow column never starts a line with a
 * lone "1" or "2.". The space the model wrote before the marker is dropped —
 * with the pill's own margin it read as a double gap.
 */
function renderInline(text: string, markers?: SourceMarkers): ReactNode {
  const tokens = tokenizeInline(text);
  const out: ReactNode[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'sources' || knownIds(token.ids ?? [], markers).length === 0) {
      out.push(renderToken(token, index, markers));
      continue;
    }
    const glued: ReactNode[] = [];
    const previous = tokens[index - 1];
    if (previous?.type === 'text') {
      out.pop();
      const trimmed = previous.value.replace(/\s+$/, '');
      const split = trimmed.search(/\S+$/);
      const head = split > 0 ? trimmed.slice(0, split) : split === 0 ? '' : trimmed;
      const word = split >= 0 ? trimmed.slice(split) : '';
      if (head) out.push(<Fragment key={`${index}-head`}>{head}</Fragment>);
      if (word) glued.push(<Fragment key={`${index}-word`}>{word}</Fragment>);
    } else if (previous && !/\s$/.test(previous.value)) {
      // Bold, code or a link right before the marker: keep it with it.
      const last = out.pop();
      if (last !== undefined) glued.push(<Fragment key={`${index}-prev`}>{last}</Fragment>);
    }
    glued.push(renderToken(token, index, markers));
    const next = tokens[index + 1];
    if (next?.type === 'text') {
      const punctuation = next.value.match(/^[.,;:!?)\]»”’]+/)?.[0];
      if (punctuation) {
        glued.push(<Fragment key={`${index}-punct`}>{punctuation}</Fragment>);
        tokens[index + 1] = { ...next, value: next.value.slice(punctuation.length) };
      }
    }
    out.push(
      <span key={`${index}-glue`} className="whitespace-nowrap">
        {glued}
      </span>,
    );
  }
  return out;
}

type Block =
  | { type: 'p'; lines: string[] }
  | { type: 'h'; level: 1 | 2 | 3; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'quote'; lines: string[] }
  | { type: 'pre'; code: string; lang?: string; closed: boolean }
  | { type: 'math'; latex: string; open: string; closed: boolean }
  | { type: 'table'; header: string[]; rows: string[][] };

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

/**
 * A display-maths block starting at `lines[index]`: `$$` or `\[` opening a
 * line, closed on the same line or a later one. A line like `$$x$$ and more`
 * is not a block — it is a paragraph with inline display maths — so only a
 * closer with nothing after it (or no closer yet) makes one.
 *
 * Used by both the maths branch and the paragraph loop's stop test, so the
 * two always agree on which lines are maths: every line is consumed by
 * exactly one branch.
 */
function mathBlockAt(
  lines: string[],
  index: number,
): { block: Extract<Block, { type: 'math' }>; next: number; trailing: string } | null {
  const opener = /^\s*(\$\$|\\\[)(.*)$/.exec(lines[index] ?? '');
  if (!opener) return null;
  const open = opener[1];
  const close = open === '$$' ? '$$' : '\\]';
  const rest = opener[2];
  const sameLine = rest.indexOf(close);
  if (sameLine !== -1) {
    if (rest.slice(sameLine + close.length).trim() !== '') return null;
    return {
      block: { type: 'math', latex: rest.slice(0, sameLine), open, closed: true },
      next: index + 1,
      trailing: '',
    };
  }
  const body = [rest];
  let cursor = index + 1;
  while (cursor < lines.length) {
    const at = lines[cursor].indexOf(close);
    if (at !== -1) {
      body.push(lines[cursor].slice(0, at));
      return {
        block: { type: 'math', latex: body.join('\n'), open, closed: true },
        next: cursor + 1,
        trailing: lines[cursor].slice(at + close.length).trim(),
      };
    }
    body.push(lines[cursor]);
    cursor++;
  }
  // Unterminated: normal mid-stream. Shown as source until the closer arrives.
  return { block: { type: 'math', latex: body.join('\n'), open, closed: false }, next: cursor, trailing: '' };
}

function parseBlocks(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index++;
      continue;
    }

    // Fenced code. The opener is any line starting with ``` — info strings may
    // contain spaces (```js title="a.js"), a space before the language
    // (``` python), or be a mid-stream partial (```py t); only the leading word
    // is treated as the language. This must match every line the paragraph
    // branch below excludes: a line starting with ``` that neither branch
    // consumed used to spin this render loop forever. An unterminated fence is
    // normal mid-stream, so it renders as far as it has arrived rather than
    // waiting for a closing marker.
    const fence = line.match(/^```\s*(\w*)/);
    if (fence) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      const closed = index < lines.length;
      index++;
      const lang = fence[1] ? fence[1].toLowerCase() : undefined;
      if (lang === 'math') {
        blocks.push({ type: 'math', latex: code.join('\n'), open: '```math', closed });
      } else {
        blocks.push({ type: 'pre', code: code.join('\n'), lang, closed });
      }
      continue;
    }

    const math = mathBlockAt(lines, index);
    if (math) {
      blocks.push(math.block);
      if (math.trailing) blocks.push({ type: 'p', lines: [math.trailing] });
      index = math.next;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1])) {
      const header = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'h', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      index++;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''));
        index++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ''));
        index++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ''));
        index++;
      }
      blocks.push({ type: 'quote', lines: quoted });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^(#{1,3}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|\s*>)/.test(lines[index]) &&
      !mathBlockAt(lines, index) &&
      !(paragraph.length > 0 && lines[index].includes('|') && TABLE_SEPARATOR.test(lines[index + 1] ?? ''))
    ) {
      paragraph.push(lines[index]);
      index++;
    }
    if (paragraph.length === 0) {
      // Defensive: every line shape must be consumed by exactly one branch.
      // If none matched, emit the line as literal text and move on — never
      // loop without advancing.
      blocks.push({ type: 'p', lines: [lines[index]] });
      index++;
      continue;
    }
    blocks.push({ type: 'p', lines: paragraph });
  }

  return blocks;
}

function CodeView({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-code-bg px-3 py-2.5 font-mono text-[13px] leading-relaxed">
      <code>{code}</code>
    </pre>
  );
}

/**
 * A display equation. Until its closing delimiter has streamed in it is
 * shown as source — KaTeX on half an equation is an error on every token.
 */
function MathBlockView({ block }: { block: Extract<Block, { type: 'math' }> }) {
  if (!block.closed) {
    return <CodeView code={`${block.open}${block.latex}`} />;
  }
  const close = block.open === '$$' ? '$$' : block.open === '```math' ? '```' : '\\]';
  return (
    <div className="chat-math-block">
      <MathView latex={block.latex} display raw={`${block.open}${block.latex}${close}`} />
    </div>
  );
}

/**
 * A ```mermaid or ```figure fence, drawn.
 *
 * Only once the fence has closed: a diagram laid out on every streamed token
 * would flash errors until the last line arrived. The source stays one click
 * away, and a diagram that does not parse shows its error with the source.
 */
function ChatDiagram({
  source,
  complete,
  kind = 'mermaid',
}: {
  source: string;
  complete: boolean;
  kind?: 'mermaid' | 'figure';
}) {
  const [showSource, setShowSource] = useState(false);
  const Icon = kind === 'figure' ? Shapes : Workflow;
  if (!complete) {
    return (
      <div className="overflow-hidden rounded-lg bg-code-bg">
        <p className="flex items-center gap-1.5 px-3 pt-2 text-xs text-muted-foreground">
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          {kind === 'figure' ? 'Figure' : 'Diagram'} — drawn when the reply finishes it
        </p>
        <pre className="overflow-x-auto px-3 pb-2.5 pt-1 font-mono text-[13px] leading-relaxed">
          <code>{source}</code>
        </pre>
      </div>
    );
  }
  return (
    <div className="chat-diagram overflow-hidden rounded-lg border border-border bg-background">
      <div className="px-3 py-3">
        {kind === 'figure' ? (
          <StructuredFigure source={source} actions label="Figure from the assistant" />
        ) : (
          <MermaidDiagram source={source} actions label="Diagram from the assistant" />
        )}
      </div>
      <div className="flex items-center justify-end border-t border-border px-1.5 py-1">
        <button
          type="button"
          aria-expanded={showSource}
          onClick={() => setShowSource((open) => !open)}
          className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Code2 aria-hidden="true" className="h-3.5 w-3.5" />
          {showSource ? 'Hide source' : 'Show source'}
        </button>
      </div>
      {showSource && (
        <pre className="overflow-x-auto border-t border-border bg-code-bg px-3 py-2.5 font-mono text-[13px] leading-relaxed">
          <code>{source}</code>
        </pre>
      )}
    </div>
  );
}

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  className,
  sources,
}: {
  text: string;
  className?: string;
  /** Resolves `[S3]` source markers; without it they render as text. */
  sources?: SourceMarkers;
}) {
  const inline = (value: string) => renderInline(value, sources);
  const blocks = parseBlocks(text);

  return (
    <div className={cn('space-y-3 text-[14.5px] leading-[1.6] [&>*:first-child]:mt-0', className)}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'h': {
            const Tag = (['h3', 'h4', 'h5'] as const)[block.level - 1];
            return (
              <Tag
                key={index}
                className={cn(
                  'mt-5 font-semibold leading-snug tracking-[-0.005em] text-foreground',
                  block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-md' : 'text-[14.5px]',
                )}
              >
                {inline(block.text)}
              </Tag>
            );
          }
          case 'ul':
            return (
              <ul key={index} className="ml-5 list-disc space-y-1 marker:text-muted-foreground">
                {block.items.map((item, i) => (
                  <li key={i}>{inline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={index} className="ml-5 list-decimal space-y-1 marker:text-muted-foreground marker:tabular-nums">
                {block.items.map((item, i) => (
                  <li key={i}>{inline(item)}</li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote
                key={index}
                className="border-l-[3px] border-foreground pl-3.5"
              >
                {inline(block.lines.join('\n'))}
              </blockquote>
            );
          case 'table':
            return (
              <div key={index} className="overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-subtle">
                    <tr>
                      {block.header.map((cell, i) => (
                        <th key={i} className="border-b border-border px-2 py-1 text-left font-semibold">
                          {inline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border last:border-0">
                        {row.map((cell, i) => (
                          <td key={i} className="px-2 py-1 align-top">
                            {inline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'math':
            return <MathBlockView key={index} block={block} />;
          case 'pre':
            if (block.lang === MERMAID_LANGUAGE) {
              return <ChatDiagram key={index} source={block.code} complete={block.closed} />;
            }
            if (block.lang === FIGURE_LANGUAGE) {
              return <ChatDiagram key={index} source={block.code} complete={block.closed} kind="figure" />;
            }
            return <CodeView key={index} code={block.code} />;
          default:
            return (
              <p key={index} className="whitespace-pre-wrap">
                {inline(block.lines.join('\n'))}
              </p>
            );
        }
      })}
    </div>
  );
});
