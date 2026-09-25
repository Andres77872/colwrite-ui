/* eslint-disable react-refresh/only-export-components -- static export renderer, not an HMR module */

import { renderToStaticMarkup } from 'react-dom/server';
import katex from 'katex';
import type {
  Block,
  CitationChild,
  CodeBlock,
  Doc,
  EquationChild,
  GraphChild,
  ParagraphBlock,
  ParagraphChild,
  TableChild,
} from '@/editor/types';
import {
  buildBibliography,
  citationAnchorId,
  citationLabelParts,
  formatReference,
  referenceAnchorId,
  referenceMarker,
  type Bibliography,
} from '@/editor/citations';
import { ChartFigure } from '@/components/editor/blocks/ParagraphBlock/Inlines/GraphInline/ChartFigure';
import { cn } from '@/lib/utils';
import { exportStyles } from './styles';
import {
  materializedParts,
  safeChartColors,
  safeDiagramSvg,
  safeHttpUrl,
  sanitizeInlineFragment,
} from './sanitize';
import { figureNumbers, isDiagramBlock, isFigureBlock } from '@/editor/blockKinds';
import { StaticFigure } from '@/components/common/StructuredFigure/StaticFigure';
import { compileFigure, figureMeta } from '@/lib/figure/compile';
import { getFigureMeasurer } from '@/lib/figure/measure';
import type { RenderedDiagrams } from './diagrams';
import type {
  DocumentExportOptions,
  DocumentExportSnapshot,
} from './types';

export const DOCUMENT_RENDERER_VERSION = '1.0.0';

export class ExportValidationError extends Error {}

type Numbering = {
  bibliography: Bibliography;
  equations: Map<string, number>;
  /** Captioned structured figures, "Figure N", in document order. */
  figures: Map<string, number>;
};

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function numberingFor(doc: Doc): Numbering {
  const equations = new Map<string, number>();
  let equationNumber = 0;
  for (const block of doc.blocks) {
    if (block.type !== 'paragraph') continue;
    for (const child of block.children ?? []) {
      if (child.type === 'equation' && child.display && child.numbered) {
        equations.set(child.id, ++equationNumber);
      }
    }
  }
  return {
    bibliography: buildBibliography(doc.blocks, { library: doc.sources, style: doc.citationStyle ?? null }),
    equations,
    figures: figureNumbers(doc.blocks, (source) => figureMeta(source).caption),
  };
}

/**
 * A citation, with every number linked to the entry it stands for.
 *
 * It used to link the whole label to the publisher instead — the one
 * destination the reader can reach unaided, and the one that is unreachable
 * offline or on paper. `[1, 4]` now resolves inside the document as two
 * separate links, and the reference entry carries the outbound link, which is
 * the direction every published paper uses.
 */
function CitationView({
  child,
  bibliography,
  hasReferences,
}: {
  child: CitationChild;
  bibliography: Bibliography;
  hasReferences: boolean;
}) {
  const parts = citationLabelParts(child, bibliography);
  if (!hasReferences || !parts.some((part) => part.entry)) {
    return <span className="citation">{parts.map((part) => part.text).join('')}</span>;
  }
  return (
    // The anchor sits on the wrapper: one id per citation, whatever it links to.
    <span className="citation" id={citationAnchorId(child.id)}>
      {parts.map((part, index) =>
        part.entry ? (
          <a href={`#${referenceAnchorId(part.entry)}`} key={index}>
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}

function ReferencesView({
  bibliography,
  options,
}: {
  bibliography: Bibliography;
  options: DocumentExportOptions;
}) {
  const { entries, style } = bibliography;
  if (!options.include_references || entries.length === 0) return null;

  return (
    <section className="references" aria-labelledby="references-heading">
      <h2 className="export-heading level-2" id="references-heading">
        References
      </h2>
      <ol className="reference-list">
        {entries.map((entry) => {
          const parts = formatReference(entry, style);
          const href = safeHttpUrl(parts.href);
          return (
            <li className="reference-item" id={referenceAnchorId(entry)} key={entry.key}>
              <span className="reference-marker">{referenceMarker(entry, style)}</span>
              <span className="reference-body">
                {parts.text}
                {href && (
                  <>
                    {' '}
                    <a className="reference-link" href={href} rel="noopener noreferrer">
                      {parts.linkLabel}
                    </a>
                  </>
                )}
                {/* Back-links, the way a printed index reads: one target per
                    place the source is used, so a reader can walk from the
                    bibliography into the argument. */}
                <span className="reference-backlinks">
                  {entry.usages.map((usage) => (
                    <a
                      className="reference-backlink"
                      href={`#${citationAnchorId(usage.childId)}`}
                      key={usage.childId}
                    >
                      ↑{entry.usages.length > 1 ? usage.ordinal : ''}
                    </a>
                  ))}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function katexMarkup(child: EquationChild): { html?: string; error?: string } {
  try {
    return {
      html: katex.renderToString(child.latex ?? '', {
        displayMode: child.display === true,
        throwOnError: true,
        strict: 'error',
        trust: false,
        output: 'htmlAndMathml',
        maxExpand: 1000,
      }),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid equation' };
  }
}

function InlineEquationView({ child }: { child: EquationChild }) {
  const rendered = katexMarkup(child);
  if (!rendered.html) return <code className="equation-error">{child.latex}</code>;
  return <span className="math" dangerouslySetInnerHTML={{ __html: rendered.html }} />;
}

function DisplayEquationView({ child, number }: { child: EquationChild; number?: number }) {
  const rendered = katexMarkup(child);
  const anchor = child.labelId?.trim().replace(/[^A-Za-z0-9_.:-]/g, '-');
  return (
    <figure className="display-equation" id={anchor || undefined}>
      {rendered.html ? (
        <span className="math" dangerouslySetInnerHTML={{ __html: rendered.html }} />
      ) : <code className="math equation-error">{child.latex}</code>}
      {number !== undefined && <span className="equation-number">({number})</span>}
    </figure>
  );
}

function TableView({ child }: { child: TableChild }) {
  const cols = Math.max(1, Math.min(200, child.cols || 1));
  const rows = Math.max(1, Math.min(200, child.rows || 1));
  const data = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => String(child.data?.[row]?.[col] ?? '')),
  );
  const header = child.header !== false;
  const bodyStart = header ? 1 : 0;
  const cellStyle = (index: number) => ({ textAlign: child.align?.[index] ?? 'left' } as const);
  return (
    <figure className="export-table-figure">
      <table className="export-table">
        {child.caption && <caption>{child.caption}</caption>}
        {header && (
          <thead>
            <tr>{data[0]?.map((cell, index) => <th key={index} style={cellStyle(index)}>{cell}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {data.slice(bodyStart).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => <td key={index} style={cellStyle(index)}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function GraphView({ child }: { child: GraphChild }) {
  const values = (child.data?.values ?? []).filter(Number.isFinite).slice(0, 2000);
  const labels = (child.data?.labels ?? []).slice(0, values.length);
  return (
    <figure className="export-graph">
      {child.title && <p className="graph-title">{child.title}</p>}
      <ChartFigure
        kind={child.kind}
        values={values}
        labels={labels}
        colors={safeChartColors(child.data?.colors)}
        xLabel={child.xLabel}
        yLabel={child.yLabel}
        interactive={false}
      />
      {child.caption && <figcaption>{child.caption}</figcaption>}
    </figure>
  );
}

function AiBeatView({ child }: { child: Extract<ParagraphChild, { type: 'aiBeat' }> }) {
  return (
    <aside className="ai-beat-card">
      <div className="ai-beat-label">AI Beat draft</div>
      {child.message && <p className="ai-beat-message">{child.message}</p>}
      {child.output && <p>{child.output}</p>}
    </aside>
  );
}

function isBlockChild(child: ParagraphChild): boolean {
  return child.type === 'table'
    || child.type === 'graph'
    || child.type === 'aiBeat'
    || (child.type === 'equation' && child.display === true);
}

function BlockChildView({
  child,
  numbering,
  options,
}: {
  child: ParagraphChild;
  numbering: Numbering;
  options: DocumentExportOptions;
}) {
  if (child.type === 'table') return <TableView child={child} />;
  if (child.type === 'graph') return <GraphView child={child} />;
  if (child.type === 'equation') {
    return <DisplayEquationView child={child} number={numbering.equations.get(child.id)} />;
  }
  if (child.type === 'aiBeat' && options.ai_beat === 'draft-card') {
    return <AiBeatView child={child} />;
  }
  return null;
}

function InlineChildView({
  child,
  numbering,
  options,
}: {
  child: ParagraphChild;
  numbering: Numbering;
  options: DocumentExportOptions;
}) {
  if (child.type === 'citation') {
    return (
      <CitationView
        child={child}
        bibliography={numbering.bibliography}
        hasReferences={options.include_references}
      />
    );
  }
  if (child.type === 'equation') return <InlineEquationView child={child} />;
  return null;
}

/**
 * Characters an author–year citation may sit flush against — the same rule
 * the editor's CitationInline applies, so "lengths (Vaswani, 2017)" exports
 * the way it reads on the page instead of "lengths(Vaswani, 2017)".
 */
const OPENS_OR_SPACE = /[\s([{\u2018\u201C"'/\u2013\u2014-]/;

/** The last character a reader would see in an inline HTML fragment. */
function lastVisibleCharacter(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, 'x')
    .slice(-1);
}

/** A paragraph's runs of prose and its block-level widgets, in order. */
function paragraphOutput(
  block: ParagraphBlock,
  numbering: Numbering,
  options: DocumentExportOptions,
): React.ReactNode[] {
  const children = block.children ?? [];
  const byId = new Map<string, ParagraphChild>();
  for (const child of children) {
    if (byId.has(child.id)) {
      throw new ExportValidationError(`Duplicate child ID in paragraph ${block.id}: ${child.id}`);
    }
    byId.set(child.id, child);
  }

  const sanitized = sanitizeInlineFragment(block.html);
  const placeholderCounts = new Map<string, number>();
  for (const id of sanitized.placeholderIds) {
    placeholderCounts.set(id, (placeholderCounts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of placeholderCounts) {
    if (count !== 1) {
      throw new ExportValidationError(`Child placeholder ${id} occurs ${count} times`);
    }
  }
  if (placeholderCounts.size !== byId.size || [...byId.keys()].some((id) => !placeholderCounts.has(id))) {
    throw new ExportValidationError(`Paragraph ${block.id} children do not match its placeholders`);
  }

  const output: React.ReactNode[] = [];
  let run: React.ReactNode[] = [];
  let sequence = 0;
  const flush = () => {
    if (run.length === 0) return;
    output.push(<p className="paragraph-run" key={`run-${sequence++}`}>{run}</p>);
    run = [];
  };

  let previousCharacter = '';
  for (const part of materializedParts(sanitized)) {
    if (part.kind === 'html') {
      if (part.html) {
        run.push(<span key={`html-${sequence++}`} dangerouslySetInnerHTML={{ __html: part.html }} />);
        previousCharacter = lastVisibleCharacter(part.html) || previousCharacter;
      }
      continue;
    }
    const child = byId.get(part.childId);
    if (!child) throw new ExportValidationError(`Missing child ${part.childId}`);
    if (child.type === 'aiBeat' && options.ai_beat === 'omit') continue;
    if (isBlockChild(child)) {
      flush();
      output.push(
        <BlockChildView
          key={`child-${child.id}`}
          child={child}
          numbering={numbering}
          options={options}
        />,
      );
    } else {
      const style = numbering.bibliography.documentStyle ?? (child.type === 'citation' ? child.style : undefined);
      if (
        child.type === 'citation'
        && style === 'author-year'
        && previousCharacter
        && !OPENS_OR_SPACE.test(previousCharacter)
      ) {
        run.push(' ');
      }
      previousCharacter = child.type === 'citation' ? ')' : 'x';
      run.push(
        <InlineChildView
          key={`child-${child.id}`}
          child={child}
          numbering={numbering}
          options={options}
        />,
      );
    }
  }
  flush();
  return output;
}

function ParagraphView({
  block,
  numbering,
  options,
}: {
  block: ParagraphBlock;
  numbering: Numbering;
  options: DocumentExportOptions;
}) {
  const output = paragraphOutput(block, numbering, options);
  if (block.variant === 'quote') {
    return <blockquote className="export-block export-quote">{output}</blockquote>;
  }
  if (block.variant === 'callout') {
    return <aside className="export-block export-callout">{output}</aside>;
  }
  return (
    <section
      className="export-block paragraph-block"
      style={{ columnCount: Math.max(1, Math.min(6, block.columns ?? 1)) }}
    >
      {output}
    </section>
  );
}

/**
 * A code block — or, for a Mermaid diagram that was drawn ahead of the export
 * (`renderDocumentDiagrams`), the drawing. A diagram that was not drawn keeps
 * its source, so nothing the author wrote goes missing from the page.
 */
function CodeView({
  block,
  diagrams,
  figureNumber,
  options,
}: {
  block: CodeBlock;
  diagrams?: RenderedDiagrams;
  figureNumber?: number;
  options: DocumentExportOptions;
}) {
  if (isFigureBlock(block)) {
    // Structured figures lay out synchronously, so they are drawn right here
    // rather than ahead of time like Mermaid. The SVG is built from React
    // elements — labels are text nodes, maths is KaTeX with `trust: false` —
    // so no markup from the spec reaches the page.
    const compiled = compileFigure(block.text, getFigureMeasurer());
    if (compiled.ok) {
      return (
        <StaticFigure
          compiled={compiled}
          number={figureNumber}
          theme={options.profile === 'editor-faithful' ? 'dark' : 'light'}
          idPrefix={`cwfig-${block.id.replace(/[^A-Za-z0-9_-]/g, '')}`}
          className="export-block export-figure"
        />
      );
    }
  }
  const svg = isDiagramBlock(block) ? safeDiagramSvg(diagrams?.get(block.id)) : null;
  if (svg) {
    return (
      <figure
        className="export-block export-diagram"
        role="img"
        aria-label="Diagram"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  return (
    <pre className="export-block export-code" data-language={block.language || undefined}>
      <code>{block.text}</code>
    </pre>
  );
}

type ListTag = 'ul' | 'ol' | 'todo';

function listTag(block: ParagraphBlock): ListTag {
  return block.variant === 'numbered' ? 'ol' : block.variant === 'todo' ? 'todo' : 'ul';
}

/**
 * A run of consecutive list items as nested html lists.
 *
 * Storage is flat — each item is a block with an `indent` — while html nests
 * a sub-list inside the item above it. An item deeper than its predecessor
 * therefore goes inside the previous `<li>`; a run that starts indented gets
 * an empty parent item, as the LaTeX export does.
 */
function ListRun({
  items,
  depth,
  numbering,
  options,
}: {
  items: ParagraphBlock[];
  depth: number;
  numbering: Numbering;
  options: DocumentExportOptions;
}) {
  const lists: React.ReactNode[] = [];
  let index = 0;
  while (index < items.length) {
    const tag = listTag(items[index]);
    const entries: React.ReactNode[] = [];
    while (index < items.length) {
      const item = items[index];
      const itemDepth = item.indent ?? 0;
      let end = index + 1;
      if (itemDepth === depth) {
        if (listTag(item) !== tag) break;
        while (end < items.length && (items[end].indent ?? 0) > depth) end += 1;
        const nested = items.slice(index + 1, end);
        entries.push(
          <li
            key={item.id}
            className={cn(tag === 'todo' && 'todo-item', item.checked && 'is-checked')}
          >
            {tag === 'todo' && (
              <span className="todo-box" aria-hidden="true">{item.checked ? '☑' : '☐'}</span>
            )}
            {paragraphOutput(item, numbering, options)}
            {nested.length > 0 && (
              <ListRun items={nested} depth={depth + 1} numbering={numbering} options={options} />
            )}
          </li>,
        );
      } else {
        end = index;
        while (end < items.length && (items[end].indent ?? 0) > depth) end += 1;
        entries.push(
          <li key={`spacer-${item.id}`} className="list-spacer">
            <ListRun items={items.slice(index, end)} depth={depth + 1} numbering={numbering} options={options} />
          </li>,
        );
      }
      index = end;
    }
    const key = `list-${lists.length}-${items[0].id}`;
    if (tag === 'ol') lists.push(<ol key={key} className="export-list">{entries}</ol>);
    else lists.push(<ul key={key} className={cn('export-list', tag === 'todo' && 'todo-list')}>{entries}</ul>);
  }
  return <>{lists}</>;
}

// A plain boolean, not a type predicate: a predicate's false branch would
// narrow every paragraph out of the caller's union, list item or not.
function isListBlock(block: Block | undefined): boolean {
  return (
    block?.type === 'paragraph' &&
    (block.variant === 'bullet' || block.variant === 'numbered' || block.variant === 'todo')
  );
}

function DocumentView({
  doc,
  options,
  diagrams,
}: {
  doc: Doc;
  options: DocumentExportOptions;
  diagrams?: RenderedDiagrams;
}) {
  const numbering = numberingFor(doc);
  const blockIds = new Set<string>();
  return (
    <main className={`document-export profile-${options.profile}`}>
      {options.include_title && <h1 className="document-title">{doc.name?.trim() || 'Untitled document'}</h1>}
      {doc.blocks.map((block, index) => {
        if (blockIds.has(block.id)) throw new ExportValidationError(`Duplicate block ID: ${block.id}`);
        blockIds.add(block.id);
        if (isListBlock(block)) {
          // The first item of a run renders the whole run; the rest are
          // already inside it.
          const previous = doc.blocks[index - 1];
          if (previous && isListBlock(previous)) return null;
          let end = index + 1;
          while (end < doc.blocks.length && isListBlock(doc.blocks[end])) end += 1;
          return (
            <ListRun
              key={block.id}
              items={doc.blocks.slice(index, end) as ParagraphBlock[]}
              depth={0}
              numbering={numbering}
              options={options}
            />
          );
        }
        if (block.type === 'divider') return <hr className="export-divider" key={block.id} />;
        if (block.type === 'code') {
          return (
            <CodeView
              key={block.id}
              block={block}
              diagrams={diagrams}
              figureNumber={numbering.figures.get(block.id)}
              options={options}
            />
          );
        }
        if (block.type === 'heading') {
          const Heading = `h${block.level}` as 'h1' | 'h2' | 'h3';
          const sanitized = sanitizeInlineFragment(block.html);
          if (sanitized.placeholderIds.length) {
            throw new ExportValidationError(`Heading ${block.id} cannot contain child placeholders`);
          }
          return (
            <Heading
              className={`export-block export-heading level-${block.level}`}
              key={block.id}
              dangerouslySetInnerHTML={{ __html: sanitized.html }}
            />
          );
        }
        return <ParagraphView key={block.id} block={block} numbering={numbering} options={options} />;
      })}
      <ReferencesView bibliography={numbering.bibliography} options={options} />
    </main>
  );
}

export function renderStandaloneHtml(
  doc: Doc,
  options: DocumentExportOptions,
  snapshot: DocumentExportSnapshot,
  /** Diagram blocks already drawn to SVG, by block id (`renderDocumentDiagrams`). */
  diagrams?: RenderedDiagrams,
): string {
  if (!Number.isInteger(doc.version) || doc.version < 1) {
    throw new ExportValidationError('Document version must be a positive integer');
  }
  if (!Array.isArray(doc.blocks) || doc.blocks.length > 2000) {
    throw new ExportValidationError('Document contains too many blocks');
  }
  const body = renderToStaticMarkup(<DocumentView doc={doc} options={options} diagrams={diagrams} />);
  const title = escapeAttribute(doc.name?.trim() || 'Untitled document');
  const styles = exportStyles(options);
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="generator" content="ColWrite document-renderer/${DOCUMENT_RENDERER_VERSION}">
<meta name="colwrite-document-version" content="${doc.version}">
<meta name="colwrite-local-revision" content="${snapshot.local_revision}">
<meta name="colwrite-export-profile" content="${options.profile}">
<title>${title}</title>
<style>${styles}</style>
</head>
<body>${body}</body>
</html>`;
}
