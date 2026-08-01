/* eslint-disable react-refresh/only-export-components -- static export renderer, not an HMR module */

import { renderToStaticMarkup } from 'react-dom/server';
import katex from 'katex';
import type {
  CitationChild,
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
import { exportStyles } from './styles';
import {
  materializedParts,
  safeChartColors,
  safeHttpUrl,
  sanitizeInlineFragment,
} from './sanitize';
import type {
  DocumentExportOptions,
  DocumentExportSnapshot,
} from './types';

export const DOCUMENT_RENDERER_VERSION = '1.0.0';

export class ExportValidationError extends Error {}

type Numbering = {
  bibliography: Bibliography;
  equations: Map<string, number>;
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
  return { bibliography: buildBibliography(doc.blocks), equations };
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

function ParagraphView({
  block,
  numbering,
  options,
}: {
  block: ParagraphBlock;
  numbering: Numbering;
  options: DocumentExportOptions;
}) {
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

  for (const part of materializedParts(sanitized)) {
    if (part.kind === 'html') {
      if (part.html) {
        run.push(<span key={`html-${sequence++}`} dangerouslySetInnerHTML={{ __html: part.html }} />);
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

  return (
    <section
      className="export-block paragraph-block"
      style={{ columnCount: Math.max(1, Math.min(6, block.columns ?? 1)) }}
    >
      {output}
    </section>
  );
}

function DocumentView({ doc, options }: { doc: Doc; options: DocumentExportOptions }) {
  const numbering = numberingFor(doc);
  const blockIds = new Set<string>();
  return (
    <main className={`document-export profile-${options.profile}`}>
      {options.include_title && <h1 className="document-title">{doc.name?.trim() || 'Untitled document'}</h1>}
      {doc.blocks.map((block) => {
        if (blockIds.has(block.id)) throw new ExportValidationError(`Duplicate block ID: ${block.id}`);
        blockIds.add(block.id);
        if (block.type === 'divider') return <hr className="export-divider" key={block.id} />;
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
): string {
  if (!Number.isInteger(doc.version) || doc.version < 1) {
    throw new ExportValidationError('Document version must be a positive integer');
  }
  if (!Array.isArray(doc.blocks) || doc.blocks.length > 2000) {
    throw new ExportValidationError('Document contains too many blocks');
  }
  const body = renderToStaticMarkup(<DocumentView doc={doc} options={options} />);
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
