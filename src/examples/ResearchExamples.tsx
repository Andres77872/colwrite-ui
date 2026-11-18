import { useState } from 'react';
import { PaperRow } from '@/components/panels/shared/PaperRow';
import { CitationStylePicker } from '@/components/editor/References/CitationStylePicker';
import { CslText } from '@/components/editor/References/CslText';
import { ResourceRow } from '@/components/panels/Library/LibraryResources';
import { Highlighted } from '@/components/panels/Library/Highlighted';
import { matchesName } from '@/components/panels/Library/libraryGroups';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { buildBibliography, useCitationProcessor, type CitationStyle } from '@/editor';
import { paperOf } from '@/data/papers';
import type { ResourceItem } from '@/data/resources';
import { paperSearch, pdfsIn, pdfItem, PERSONAL_WORKSPACE_ID } from '@/dev/msw/fixtures';
import { samplePdfText } from '@/dev/samplePdfText';
import { sampleManuscript } from './manuscript';

function CitationExample() {
  const [doc] = useState(sampleManuscript);
  const [style, setStyle] = useState<CitationStyle | null>(doc.citationStyle ?? null);
  useCitationProcessor();
  const bibliography = buildBibliography(doc.blocks, { style, library: doc.sources });
  return (
    <>
      <CitationStylePicker value={style} onChange={setStyle} />
      <ol
        className="mt-4 space-y-3 border-t border-border pt-3 text-sm"
        aria-label="References in the selected style"
      >
        {bibliography.entries.map((entry) => (
          <li key={entry.key}>
            {entry.marker} <CslText markup={entry.formatted} />
          </li>
        ))}
      </ol>
    </>
  );
}

export function ResearchExample() {
  const [query, setQuery] = useState('sparse routing');
  const results = paperSearch(query, { limit: 5, cursor: null });
  return (
    <Tabs defaultValue="papers">
      <TabsList aria-label="Research example">
        <TabsTrigger value="papers">Papers</TabsTrigger>
        <TabsTrigger value="citations">Citation style</TabsTrigger>
      </TabsList>
      <TabsContent value="papers">
        <label className="example-label">
          Filter sample papers
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {results.items.map((paper) => (
          <PaperRow key={paper.record.key} paper={paperOf(paper)} />
        ))}
        {!results.items.length && <p role="status">No matching sample papers.</p>}
        {results.attribution.map((line) => (
          <p key={line} className="text-xs text-muted-foreground">
            {line}
          </p>
        ))}
      </TabsContent>
      <TabsContent value="citations">
        <CitationExample />
      </TabsContent>
    </Tabs>
  );
}

export function LibraryExample() {
  const [files] = useState(() =>
    pdfsIn(PERSONAL_WORKSPACE_ID)
      .filter((pdf) => pdf.document_id === null && pdf.collection_id === null)
      .map(pdfItem),
  );
  const [open, setOpen] = useState<ResourceItem | null>(null);
  const [query, setQuery] = useState('');
  const [needle, setNeedle] = useState('');
  if (open)
    return (
      <div className="space-y-3">
        <Button variant="outline" onClick={() => setOpen(null)}>
          Back to PDFs
        </Button>
        <h2 className="font-semibold">{open.title}</h2>
        <label className="example-label">
          Find in extracted text
          <Input type="search" value={needle} onChange={(e) => setNeedle(e.target.value)} />
        </label>
        <pre className="whitespace-pre-wrap break-words rounded-md bg-subtle p-3 text-sm">
          <Highlighted text={samplePdfText(open.title)} needle={needle} />
        </pre>
      </div>
    );
  const matches = files.filter((pdf) => matchesName(pdf, query));
  return (
    <div className="space-y-3">
      <label className="example-label">
        Filter PDFs by name
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <h2 className="text-sm font-semibold">Unfiled</h2>
      <ul className="space-y-1">
        {matches.map((pdf) => (
          <li key={pdf.id}>
            <ResourceRow
              resource={pdf}
              onOpen={() => {
                setNeedle('');
                setOpen(pdf);
              }}
              draggable={false}
            />
          </li>
        ))}
      </ul>
      {!matches.length && <p role="status">No matches.</p>}
    </div>
  );
}
