import { useMemo, useRef, useState } from 'react';
import { StructuredFigure } from '@/components/common/StructuredFigure';
import {
  FigureInspector,
  type FigureSelection,
} from '@/components/editor/blocks/FigureBlock/FigureInspector';
import type { CompiledFigure } from '@/lib/figure/types';
import { setItemProperties } from '@/lib/figure/edit';
import { MermaidDiagram } from '@/components/common/MermaidDiagram';
import { newGraphChild } from '@/components/editor/SlashMenu/items/graph';
import { GraphInline } from '@/components/editor/blocks/ParagraphBlock/Inlines/GraphInline';
import { Button } from '@/components/ui/button';
import { uid } from '@/lib/uid';
import { downloadBlob, exportFilename } from '@/export/download';
import { TableInline } from '@/components/editor/blocks/ParagraphBlock/Inlines/TableInline';
import { EquationInline } from '@/components/editor/blocks/ParagraphBlock/Inlines/EquationInline';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { createBlockActions } from '@/editor/blockActions';
import { EditorDocContext } from '@/editor/documentSessionState';
import { figureSource, sampleManuscript } from './manuscript';

export function OverviewExample() {
  const [source] = useState(() => figureSource(sampleManuscript(), 'figure'));
  return <StructuredFigure source={source} number={1} actions label="Figure" />;
}

export function FigureExample() {
  const [doc] = useState(sampleManuscript);
  const [structured, setStructured] = useState(() => figureSource(doc, 'figure'));
  const [mermaid, setMermaid] = useState(() => figureSource(doc, 'mermaid'));
  const [compiled, setCompiled] = useState<CompiledFigure | null>(null);
  const [selection, setSelection] = useState<FigureSelection | null>(null);
  const sourceDetails = useRef<HTMLDetailsElement>(null);
  const sourceField = useRef<HTMLTextAreaElement>(null);
  const reveal = () => {
    if (!selection || !compiled?.model || !sourceDetails.current || !sourceField.current) return;
    const { model } = compiled;
    const item =
      selection.kind === 'edge'
        ? model.edges.find((edge) => edge.id === selection.id)
        : model.items.get(selection.id);
    sourceDetails.current.open = true;
    sourceField.current.focus();
    if (item?.range) sourceField.current.setSelectionRange(...item.range);
  };
  return (
    <Tabs defaultValue="figure">
      <TabsList aria-label="Drawing">
        <TabsTrigger value="figure">Figure 1</TabsTrigger>
        <TabsTrigger value="mermaid">Mermaid diagram</TabsTrigger>
      </TabsList>
      <TabsContent value="figure">
        <StructuredFigure
          source={structured}
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
            onEdit={(id, changes) => setStructured((source) => setItemProperties(source, id, changes))}
            onReveal={reveal}
            onClose={() => setSelection(null)}
          />
        )}
        <details ref={sourceDetails} className="example-disclosure">
          <summary>Edit figure source</summary>
          <Textarea
            spellCheck={false}
            ref={sourceField}
            aria-label="Figure source"
            value={structured}
            onChange={(e) => setStructured(e.target.value)}
          />
        </details>
      </TabsContent>
      <TabsContent value="mermaid">
        <MermaidDiagram source={mermaid} actions delay={180} />
        <details className="example-disclosure">
          <summary>Edit diagram source</summary>
          <Textarea
            spellCheck={false}
            aria-label="Mermaid source"
            value={mermaid}
            onChange={(e) => setMermaid(e.target.value)}
          />
        </details>
      </TabsContent>
    </Tabs>
  );
}

/** Use the same block mutations and inline widgets as ParagraphBlock. The
 * specimen owns a fresh document, so changing cells also changes its model. */
export function EditorExample() {
  const [doc, setDoc] = useState(sampleManuscript);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const actions = useMemo(() => createBlockActions(setDoc, () => doc), [doc]);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const removeParagraphChild = (blockId: string, childId: string) => {
    const parent = doc.blocks.find((block) => block.id === blockId);
    if (parent?.type !== 'paragraph') return;
    const content = document.createElement('template');
    content.innerHTML = parent.html;
    content.content.querySelector(`[data-child-id="${CSS.escape(childId)}"]`)?.remove();
    actions.removeParagraphChild(blockId, childId);
    actions.updateHtml(blockId, content.innerHTML);
  };
  const props = {
    refs,
    updateParagraphChild: actions.updateParagraphChild,
    removeParagraphChild,
    updateHtml: actions.updateHtml,
  };
  const insertChart = () => {
    const chart = newGraphChild(uid());
    actions.addParagraphChild('p-5', chart);
    actions.updateHtml('p-5', `<span data-child-id="${chart.id}" contenteditable="false"></span>`);
  };
  const download = async () => {
    setExporting(true);
    setNotice('');
    try {
      const { manuscriptHtml } = await import('./renderPaper');
      downloadBlob(
        new Blob([await manuscriptHtml(doc, true)], { type: 'text/html' }),
        exportFilename(doc.name, 'html'),
      );
      setNotice('Exported this copy of the paper.');
    } catch {
      setNotice('The paper could not be exported. Try again.');
    } finally {
      setExporting(false);
    }
  };
  const renderWidget = (id: string) => {
    const block = doc.blocks.find((item) => item.id === id);
    const child = block?.type === 'paragraph' ? block.children?.[0] : undefined;
    if (!child && id === 'p-5')
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Try the editor’s Chart command in the sample paper’s empty final paragraph.
          </p>
          <Button variant="outline" onClick={insertChart}>
            Insert chart
          </Button>
        </div>
      );
    if (!child) return <p className="text-sm text-muted-foreground">Removed from this example.</p>;
    if (child.type === 'graph') return <GraphInline child={child} blockId={id} {...props} />;
    if (child.type === 'table') return <TableInline child={child} blockId={id} {...props} />;
    return <EquationInline child={child} blockId={id} {...props} />;
  };
  return (
    <EditorDocContext.Provider value={{ doc, blocks: doc.blocks }}>
      <Tabs defaultValue="results">
        <TabsList aria-label="Manuscript excerpt">
          <TabsTrigger value="results">Results table</TabsTrigger>
          <TabsTrigger value="method">Method equation</TabsTrigger>
          <TabsTrigger value="chart">Chart</TabsTrigger>
        </TabsList>
        <TabsContent value="results">{renderWidget('p-4t')}</TabsContent>
        <TabsContent value="method">{renderWidget('p-3')}</TabsContent>
        <TabsContent value="chart">{renderWidget('p-5')}</TabsContent>
      </Tabs>
      <div className="mt-5 border-t border-border pt-3">
        <Button
          size="sm"
          variant="outline"
          className="h-auto min-h-8 max-w-full whitespace-normal"
          disabled={exporting}
          onClick={() => void download()}
        >
          {exporting ? 'Rendering…' : 'Download edited paper'}
        </Button>
        {notice && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {notice}
          </p>
        )}
      </div>
    </EditorDocContext.Provider>
  );
}
