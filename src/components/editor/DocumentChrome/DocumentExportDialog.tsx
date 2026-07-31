import { useState } from 'react';
import { useEditor } from '@/editor';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { downloadBlob, exportFilename } from '@/export/download';
import { printStandaloneHtml } from '@/export/print';
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
};

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring';

export function DocumentExportDialog({ open, onOpenChange }: Props) {
  const { getExportSnapshot } = useEditor();
  const { toast } = useToast();
  const [format, setFormat] = useState<'html' | 'pdf'>('pdf');
  const [profile, setProfile] = useState<ExportProfile>('paper');
  const [pageSize, setPageSize] = useState<ExportPageSize>('A4');
  const [orientation, setOrientation] = useState<ExportOrientation>('portrait');
  const [includeTitle, setIncludeTitle] = useState(false);
  const [aiBeat, setAiBeat] = useState<AiBeatExportMode>('omit');
  const [busy, setBusy] = useState(false);

  const onFormatChange = (next: 'html' | 'pdf') => {
    setFormat(next);
    setProfile(next === 'html' ? 'editor-faithful' : 'paper');
  };

  const runExport = async () => {
    setBusy(true);
    try {
      const snapshot = getExportSnapshot();
      const options: DocumentExportOptions = {
        profile,
        page_size: pageSize,
        orientation,
        include_title: includeTitle,
        ai_beat: aiBeat,
      };
      const exportSnapshot = {
        base_version: snapshot.baseVersion,
        local_revision: snapshot.localRevision,
        dirty: snapshot.dirty,
      };
      const { renderStandaloneHtml } = await import('@/export/renderStandaloneHtml');
      const html = renderStandaloneHtml(snapshot.document, options, exportSnapshot);

      if (format === 'html') {
        downloadBlob(
          new Blob([html], { type: 'text/html;charset=utf-8' }),
          exportFilename(snapshot.document.name, 'html'),
        );
      } else {
        await printStandaloneHtml(html);
      }
      toast({
        title: format === 'html' ? 'HTML exported' : 'Print dialog opened',
        variant: 'success',
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'The document could not be exported.',
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Export document</DialogTitle>
          <DialogDescription>
            Export the exact document currently visible in the editor, including edits still waiting for autosave.
            PDF opens your browser's print dialog; choose Save as PDF there.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Format</span>
            <select
              className={selectClass}
              value={format}
              onChange={(event) => onFormatChange(event.target.value as 'html' | 'pdf')}
              disabled={busy}
            >
              <option value="pdf">PDF</option>
              <option value="html">Standalone HTML</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Profile</span>
            <select
              className={selectClass}
              value={profile}
              onChange={(event) => setProfile(event.target.value as ExportProfile)}
              disabled={busy}
            >
              <option value="paper">Paper — light and reflowed</option>
              <option value="editor-faithful">Editor faithful — fixed measure</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Page size</span>
            <select
              className={selectClass}
              value={pageSize}
              onChange={(event) => setPageSize(event.target.value as ExportPageSize)}
              disabled={busy || format === 'html'}
            >
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Orientation</span>
            <select
              className={selectClass}
              value={orientation}
              onChange={(event) => setOrientation(event.target.value as ExportOrientation)}
              disabled={busy || format === 'html'}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm sm:col-span-2">
            <span className="font-medium">AI Beat drafts</span>
            <select
              className={selectClass}
              value={aiBeat}
              onChange={(event) => setAiBeat(event.target.value as AiBeatExportMode)}
              disabled={busy}
            >
              <option value="omit">Omit from document</option>
              <option value="draft-card">Include as labelled draft cards</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={includeTitle}
              onCheckedChange={(checked) => setIncludeTitle(checked === true)}
              disabled={busy}
            />
            Include the document name as a title in the body
          </label>
        </div>

        <DialogFooter className="mt-6">
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button onClick={runExport} disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Rendering…' : format === 'pdf' ? 'Print / Save PDF' : 'Export HTML'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
