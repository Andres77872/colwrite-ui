import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { StructuredFigure } from '@/components/common/StructuredFigure';
import { MermaidDiagram } from '@/components/common/MermaidDiagram';
import {
  FigureInspector,
  type FigureSelection,
} from '@/components/editor/blocks/FigureBlock/FigureInspector';
import { EquationInline } from '@/components/editor/blocks/ParagraphBlock/Inlines/EquationInline';
import { GraphInline } from '@/components/editor/blocks/ParagraphBlock/Inlines/GraphInline';
import { TableInline } from '@/components/editor/blocks/ParagraphBlock/Inlines/TableInline';
import { CitationStylePicker } from '@/components/editor/References/CitationStylePicker';
import { CslText } from '@/components/editor/References/CslText';
import { ReferenceStatus } from '@/components/editor/References/ReferenceStatus';
import { Textarea } from '@/components/ui/textarea';
import {
  buildBibliography,
  citationLabel,
  isParenthetical,
  useCitationProcessor,
  type CitationStyle,
  type Doc,
  type GraphChild,
  type ParagraphChild,
} from '@/editor';
import { createBlockActions } from '@/editor/blockActions';
import { EditorDocContext } from '@/editor/documentSessionState';
import { setItemProperties } from '@/lib/figure/edit';
import type { CompiledFigure } from '@/lib/figure/types';
import { figureSource, sampleManuscript } from './manuscript';

const PLACEHOLDER = /<span data-child-id="([^"]+)"[^>]*><\/span>/g;

/** A paragraph's text with each inline child drawn in its place. */
function paragraphParts(html: string, draw: (childId: string) => ReactNode) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of html.matchAll(PLACEHOLDER)) {
    parts.push(html.slice(last, match.index).replace(/<[^>]+>/g, ''));
    parts.push(<Fragment key={match[1]}>{draw(match[1]!)}</Fragment>);
    last = match.index + match[0].length;
  }
  parts.push(html.slice(last).replace(/<[^>]+>/g, ''));
  return parts;
}

/**
 * The sample paper as a live document: its paragraphs' inline widgets edit it
 * through the editor's own block actions, as they do in a page.
 */
function useSampleDoc(seed?: (doc: Doc) => Doc) {
  const [doc, setDoc] = useState(() => (seed ? seed(sampleManuscript()) : sampleManuscript()));
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const actions = useMemo(() => createBlockActions(setDoc, () => doc), [doc]);
  const widget = (blockId: string, child: ParagraphChild) => {
    const props = {
      refs,
      blockId,
      updateParagraphChild: actions.updateParagraphChild,
      // A specimen keeps every widget: removing one would leave nothing to try.
      removeParagraphChild: () => {},
      updateHtml: actions.updateHtml,
    };
    if (child.type === 'table') return <TableInline child={child} {...props} />;
    if (child.type === 'graph') return <GraphInline child={child} {...props} />;
    if (child.type === 'equation') return <EquationInline child={child} {...props} />;
    return null;
  };
  const paragraph = (blockId: string) => {
    const block = doc.blocks.find((item) => item.id === blockId);
    if (block?.type !== 'paragraph') return null;
    return paragraphParts(block.html, (childId) => {
      const child = block.children?.find((item) => item.id === childId);
      return child ? widget(blockId, child) : null;
    });
  };
  const frame = (children: ReactNode) => (
    <EditorDocContext.Provider value={{ doc, blocks: doc.blocks }}>
      <div className="text-[15px] leading-7">{children}</div>
    </EditorDocContext.Provider>
  );
  return { doc, paragraph, frame };
}

export function EquationExample() {
  const { paragraph, frame } = useSampleDoc();
  return frame(
    <>
      <p>{paragraph('p-2')}</p>
      <p className="mt-3">{paragraph('p-3')}</p>
    </>,
  );
}

export function TableExample() {
  const { paragraph, frame } = useSampleDoc();
  return frame(<div>{paragraph('p-4t')}</div>);
}

const CHART: GraphChild = {
  id: 'g-1',
  type: 'graph',
  kind: 'line',
  title: 'Validation loss by context length',
  data: { values: [2.41, 2.33, 2.27, 2.22, 2.19], labels: ['8k', '16k', '32k', '64k', '128k'] },
  xLabel: 'Context length (tokens)',
  yLabel: 'Validation loss',
  caption: 'Practice data.',
};

export function ChartExample() {
  const { paragraph, frame } = useSampleDoc((doc) => ({
    ...doc,
    blocks: doc.blocks.map((block) =>
      block.id === 'p-5' && block.type === 'paragraph'
        ? { ...block, html: `<span data-child-id="${CHART.id}" contenteditable="false"></span>`, children: [CHART] }
        : block,
    ),
  }));
  return frame(<div>{paragraph('p-5')}</div>);
}

function SourceEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <details className="example-disclosure">
      <summary>Edit the source</summary>
      <Textarea spellCheck={false} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </details>
  );
}

export function DiagramExample() {
  const [source, setSource] = useState(() => figureSource(sampleManuscript(), 'mermaid'));
  return (
    <>
      <MermaidDiagram source={source} actions delay={180} />
      <SourceEditor label="Mermaid source" value={source} onChange={setSource} />
    </>
  );
}

export function FigureExample() {
  const [source, setSource] = useState(() => figureSource(sampleManuscript(), 'figure'));
  const [compiled, setCompiled] = useState<CompiledFigure | null>(null);
  const [selection, setSelection] = useState<FigureSelection | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const reveal = () => {
    const details = editor.current?.querySelector('details');
    const field = editor.current?.querySelector('textarea');
    if (!selection || !compiled?.model || !details || !field) return;
    const { model } = compiled;
    const item = selection.kind === 'edge' ? model.edges.find((edge) => edge.id === selection.id) : model.items.get(selection.id);
    details.open = true;
    field.focus();
    if (item?.range) field.setSelectionRange(...item.range);
  };
  return (
    <>
      <StructuredFigure
        source={source}
        number={1}
        actions
        delay={180}
        label="Figure"
        selectedId={selection?.id}
        onCompiled={setCompiled}
        onSelectItem={(id, kind) => setSelection((current) => (current?.id === id ? null : { id, kind }))}
      />
      {selection && compiled && (
        <FigureInspector
          selection={selection}
          compiled={compiled}
          onEdit={(id, changes) => setSource((current) => setItemProperties(current, id, changes))}
          onReveal={reveal}
          onClose={() => setSelection(null)}
        />
      )}
      <div ref={editor}>
        <SourceEditor label="Figure source" value={source} onChange={setSource} />
      </div>
    </>
  );
}

export function CitationsExample() {
  const [doc] = useState(sampleManuscript);
  const [style, setStyle] = useState<CitationStyle | null>(doc.citationStyle ?? null);
  useCitationProcessor(true);
  const bibliography = buildBibliography(doc.blocks, { style, library: doc.sources });
  const cited = (blockId: string) => {
    const block = doc.blocks.find((item) => item.id === blockId);
    if (block?.type !== 'paragraph') return null;
    return paragraphParts(block.html, (childId) => {
      const child = block.children?.find((item) => item.id === childId);
      if (child?.type !== 'citation') return null;
      const label = citationLabel(child, bibliography);
      return (
        <>
          {isParenthetical(label) && ' '}
          <CslText markup={label} />
        </>
      );
    });
  };
  return (
    <div className="space-y-4">
      <CitationStylePicker value={style} onChange={setStyle} />
      <div className="space-y-3 text-[15px] leading-7">
        <p>{cited('p-1')}</p>
        <p>{cited('p-4')}</p>
      </div>
      <section aria-labelledby="example-references" className="border-t border-border pt-3">
        <h2 id="example-references" className="text-sm font-semibold">
          References
        </h2>
        <ol className={`mt-2 space-y-2 text-sm leading-6 ${bibliography.hangingIndent ? 'pl-6 -indent-6' : ''}`}>
          {bibliography.entries.map((entry) => (
            <li key={entry.key}>
              {entry.marker && <span className="mr-1.5 text-muted-foreground">{entry.marker}</span>}
              <CslText markup={entry.formatted} />
              <ReferenceStatus record={entry.record} inline />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
