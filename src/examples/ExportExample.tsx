import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/select';
import { downloadBlob, exportFilename } from '@/export/download';
import { documentToMarkdown } from '@/export/markdown';
import { toBibtex } from '@/editor/bibtex';
import { loadCitationProcessor } from '@/editor/csl/processor';
import { manuscriptHtml } from './renderPaper';
import { sampleManuscript } from './manuscript';

export function SamplePaper() {
  const [html, setHtml] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void manuscriptHtml(sampleManuscript(), true).then(
      (value) => {
        if (current) setHtml(value);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, []);
  if (failed) return <p role="alert">The sample paper could not be rendered. Reload to try again.</p>;
  if (!html) return <p role="status">Rendering the sample manuscript…</p>;
  return (
    <iframe className="sample-paper" srcDoc={html} title="Sparse Routing for Long-Context Pretraining" />
  );
}

export function ExportExample() {
  const [format, setFormat] = useState('html');
  const [references, setReferences] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const run = async () => {
    setBusy(true);
    setStatus('');
    try {
      const doc = sampleManuscript();
      let content: string;
      let ext: 'html' | 'md' | 'bib';
      let mime: string;
      if (format === 'html') {
        ext = 'html';
        mime = 'text/html';
        content = await manuscriptHtml(doc, references);
      } else if (format === 'markdown') {
        await loadCitationProcessor();
        ext = 'md';
        mime = 'text/markdown';
        content = documentToMarkdown(doc, {
          includeTitle: true,
          includeReferences: references,
          aiBeat: 'omit',
        });
      } else {
        ext = 'bib';
        mime = 'text/plain';
        content = toBibtex(doc.sources ?? []);
      }
      const filename = exportFilename(doc.name, ext);
      downloadBlob(new Blob([content], { type: mime }), filename);
      setStatus(`Exported ${filename}`);
    } catch {
      setStatus('The export could not be generated. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Sparse Routing for Long-Context Pretraining</h2>
      <label className="example-label">
        Format
        <NativeSelect
          value={format}
          onChange={(e) => {
            setFormat(e.target.value);
            setStatus('');
          }}
        >
          <option value="html">Standalone HTML</option>
          <option value="markdown">Markdown (.md)</option>
          <option value="bibtex">BibTeX (.bib)</option>
        </NativeSelect>
      </label>
      {format !== 'bibtex' && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={references} onCheckedChange={(value) => setReferences(value === true)} />
          Append the reference list
        </label>
      )}
      <Button onClick={() => void run()} disabled={busy}>
        {busy ? 'Rendering…' : 'Download sample'}
      </Button>
      {status && (
        <p role="status" className="break-words text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  );
}
