import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useEditor } from '@/editor';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/select';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { downloadBlob, exportFilename } from '@/export/download';
import { documentToMarkdown } from '@/export/markdown';
import { printStandaloneHtml } from '@/export/print';
import { ApiError } from '@/services/contracts';
import { describeLatexExportError, exportDocumentLatex } from '@/services/documentExport';
import type {
  AiBeatExportMode,
  DocumentExportOptions,
  ExportOrientation,
  ExportPageSize,
  ExportProfile,
} from '@/export/types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where focus goes when the dialog closes. Opened from a menu item, which
   * unmounts with its menu, it would otherwise fall to <body>.
   */
  returnFocus?: () => HTMLElement | null | undefined;
};

type ExportFormat = 'pdf' | 'html' | 'markdown' | 'latex';

const FORMAT_NOTES: Record<ExportFormat, string> = {
  pdf: 'Opens your browser’s print dialog; choose Save as PDF there.',
  html: 'One file with its styles and maths inside, readable offline.',
  markdown:
    'Citations are written as Pandoc keys, such as [@10.1145/3290605]. Export the .bib from Sources to go with them.',
  latex:
    'The server renders the saved document, so edits waiting for autosave are saved first. It always includes the title and the reference list.',
};

const BUTTON_LABELS: Record<ExportFormat, string> = {
  pdf: 'Print / Save PDF',
  html: 'Export HTML',
  markdown: 'Export Markdown',
  latex: 'Export LaTeX',
};

const DONE_TITLES: Record<ExportFormat, string> = {
  pdf: 'Print dialog opened',
  html: 'HTML exported',
  markdown: 'Markdown exported',
  latex: 'LaTeX exported',
};

/** Thrown when the edits could not be saved before a server-side export. */
class UnsavedEditsError extends Error {}

export function DocumentExportDialog({ open, onOpenChange, returnFocus }: Props) {
  const focusReturn = useReturnFocus(returnFocus);
  const { getExportSnapshot, documentId, saveRemote, ensureRemoteDocument } = useEditor();
  const { toast } = useToast();
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [profile, setProfile] = useState<ExportProfile>('paper');
  const [pageSize, setPageSize] = useState<ExportPageSize>('A4');
  const [orientation, setOrientation] = useState<ExportOrientation>('portrait');
  const [includeTitle, setIncludeTitle] = useState(false);
  const [includeReferences, setIncludeReferences] = useState(true);
  const [aiBeat, setAiBeat] = useState<AiBeatExportMode>('omit');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const onFormatChange = (next: ExportFormat) => {
    setFormat(next);
    setFailure(null);
    if (next === 'html') setProfile('editor-faithful');
    if (next === 'pdf') setProfile('paper');
  };

  /** LaTeX comes from the server, which renders what is saved: save first. */
  const exportLatex = async (dirty: boolean, name: string | undefined) => {
    if (dirty || !documentId) {
      setSaving(true);
      try {
        await saveRemote();
      } catch (error) {
        throw new UnsavedEditsError(
          error instanceof ApiError && error.message ? error.message : 'Check your connection and try again.',
        );
      } finally {
        setSaving(false);
      }
    }
    const id = await ensureRemoteDocument();
    if (!id) throw new UnsavedEditsError('Check your connection and try again.');
    const { source, filename } = await exportDocumentLatex(id);
    downloadBlob(
      new Blob([source], { type: 'application/x-tex;charset=utf-8' }),
      filename ?? exportFilename(name, 'tex'),
    );
  };

  const runExport = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const snapshot = getExportSnapshot();
      if (format === 'latex') {
        await exportLatex(snapshot.dirty, snapshot.document.name);
        finish();
        return;
      }
      if (format === 'markdown') {
        const markdown = documentToMarkdown(snapshot.document, {
          includeTitle,
          includeReferences,
          aiBeat,
        });
        downloadBlob(
          new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
          exportFilename(snapshot.document.name, 'md'),
        );
        finish();
        return;
      }
      const options: DocumentExportOptions = {
        profile,
        page_size: pageSize,
        orientation,
        include_title: includeTitle,
        ai_beat: aiBeat,
        include_references: includeReferences,
      };
      const exportSnapshot = {
        base_version: snapshot.baseVersion,
        local_revision: snapshot.localRevision,
        dirty: snapshot.dirty,
      };
      const [{ renderStandaloneHtml }, { renderDocumentDiagrams }] = await Promise.all([
        import('@/export/renderStandaloneHtml'),
        import('@/export/diagrams'),
      ]);
      const diagrams = await renderDocumentDiagrams(snapshot.document.blocks);
      const html = renderStandaloneHtml(snapshot.document, options, exportSnapshot, diagrams);

      if (format === 'html') {
        downloadBlob(
          new Blob([html], { type: 'text/html;charset=utf-8' }),
          exportFilename(snapshot.document.name, 'html'),
        );
      } else {
        await printStandaloneHtml(html);
      }
      finish();
    } catch (error) {
      // Said here, next to the button that failed, with a way to try again —
      // not in a toast that is gone before it can be read.
      setFailure(
        error instanceof UnsavedEditsError
          ? `Your latest edits could not be saved, so the server has no up-to-date copy to export. ${error.message}`
          : format === 'latex'
            ? describeLatexExportError(error)
            : error instanceof Error && error.message
              ? error.message
              : 'The document could not be exported.',
      );
    } finally {
      setBusy(false);
    }
  };

  function finish() {
    toast({ title: DONE_TITLES[format], variant: 'success' });
    onOpenChange(false);
  }

  const printable = format === 'pdf' || format === 'html';
  const local = format !== 'latex';

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        showCloseButton={!busy}
        onOpenAutoFocus={focusReturn.onOpenAutoFocus}
        onCloseAutoFocus={focusReturn.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Export document</DialogTitle>
          <DialogDescription>
            Export the document as it is in the editor, including edits still waiting for autosave.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Format</span>
            <NativeSelect
              value={format}
              onChange={(event) => onFormatChange(event.target.value as ExportFormat)}
              disabled={busy}
              aria-describedby="export-format-note"
            >
              <option value="pdf">PDF</option>
              <option value="html">Standalone HTML</option>
              <option value="markdown">Markdown (.md)</option>
              <option value="latex">LaTeX (.tex)</option>
            </NativeSelect>
          </label>
          {printable && (
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Profile</span>
              <NativeSelect
                value={profile}
                onChange={(event) => setProfile(event.target.value as ExportProfile)}
                disabled={busy}
              >
                <option value="paper">Paper — light and reflowed</option>
                <option value="editor-faithful">Editor faithful — fixed measure</option>
              </NativeSelect>
            </label>
          )}
          <div id="export-format-note" className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
            <p>{FORMAT_NOTES[format]}</p>
            {format === 'latex' && (
              <p>
                Structured figures are printed as their JSON source and diagrams as Mermaid code. To get a figure as
                TikZ, use the figure’s own Copy TikZ action.
              </p>
            )}
          </div>
          {printable && (
            <>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Page size</span>
                <NativeSelect
                  value={pageSize}
                  onChange={(event) => setPageSize(event.target.value as ExportPageSize)}
                  disabled={busy || format === 'html'}
                >
                  <option value="A4">A4</option>
                  <option value="Letter">Letter</option>
                </NativeSelect>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Orientation</span>
                <NativeSelect
                  value={orientation}
                  onChange={(event) => setOrientation(event.target.value as ExportOrientation)}
                  disabled={busy || format === 'html'}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </NativeSelect>
              </label>
            </>
          )}
          {local && (
            <>
              <label className="grid gap-1.5 text-sm sm:col-span-2">
                <span className="font-medium">AI Beat drafts</span>
                <NativeSelect
                  value={aiBeat}
                  onChange={(event) => setAiBeat(event.target.value as AiBeatExportMode)}
                  disabled={busy}
                >
                  <option value="omit">Omit from document</option>
                  <option value="draft-card">
                    {format === 'markdown' ? 'Include their text' : 'Include as labelled draft cards'}
                  </option>
                </NativeSelect>
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox
                  checked={includeTitle}
                  onCheckedChange={(checked) => setIncludeTitle(checked === true)}
                  disabled={busy}
                />
                Include the document name as a title in the body
              </label>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <Checkbox
                  className="mt-0.5"
                  checked={includeReferences}
                  onCheckedChange={(checked) => setIncludeReferences(checked === true)}
                  disabled={busy}
                />
                <span>
                  Append the reference list
                  <span className="block text-xs text-muted-foreground">
                    {format === 'markdown'
                      ? 'Listed at the end, each entry with the key its citations use.'
                      : 'Each citation links to its entry, and each entry links back to where it is cited.'}
                  </span>
                </span>
              </label>
            </>
          )}
        </div>

        {failure && (
          <Alert className="mt-5">
            <div className="flex min-w-0 items-start gap-2">
              <span className="min-w-0 flex-1">{failure}</span>
              <Button
                variant="outline"
                size="xs"
                className="shrink-0"
                onClick={() => void runExport()}
                disabled={busy}
              >
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
            </div>
          </Alert>
        )}

        <DialogFooter className="mt-6">
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button onClick={runExport} disabled={busy}>
            {busy && <Spinner />}
            {busy ? (saving ? 'Saving…' : format === 'latex' ? 'Exporting…' : 'Rendering…') : BUTTON_LABELS[format]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
