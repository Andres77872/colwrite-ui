import { useId, useState } from 'react';
import { useDocumentSession, useEditorActions, useEditorDoc, usePageReadOnly, type Doc } from '@/editor';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useReturnFocus } from '@/hooks/useReturnFocus';

const TYPES: Array<{ id: NonNullable<Doc['documentType']>; label: string }> = [
  { id: 'research-paper', label: 'Research paper' },
  { id: 'literature-review', label: 'Literature review' },
  { id: 'systematic-review', label: 'Systematic review' },
  { id: 'technical-report', label: 'Technical report' },
  { id: 'white-paper', label: 'White paper' },
];

export function InstructionsDialog({ open, onOpenChange, blockId, returnFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; blockId?: string;
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const focus = useReturnFocus(returnFocus);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent onOpenAutoFocus={focus.onOpenAutoFocus} onCloseAutoFocus={focus.onCloseAutoFocus}>
      <DialogHeader>
        <DialogTitle>Assistant instructions</DialogTitle>
        <DialogDescription>{blockId
          ? 'Apply to this section and its subsections, until the next heading at the same or higher level.'
          : 'Apply to this page. They are saved with its versions and never grant extra tools or access.'}</DialogDescription>
      </DialogHeader>
      {open && <InstructionsBody blockId={blockId} onClose={() => onOpenChange(false)} />}
    </DialogContent>
  </Dialog>;
}

function InstructionsBody({ blockId, onClose }: { blockId?: string; onClose: () => void }) {
  const { doc } = useEditorDoc();
  const { documentSessionId } = useDocumentSession();
  const readOnly = usePageReadOnly();
  const { setDocMeta, setHeadingInstructions } = useEditorActions();
  const heading = blockId ? doc.blocks.find((block) => block.id === blockId && block.type === 'heading') : undefined;
  const value = blockId ? (heading?.type === 'heading' ? heading.instructions : undefined) : doc.instructions;
  const [initial] = useState(() => ({ value, documentType: doc.documentType, documentSessionId }));
  const [text, setText] = useState(value ?? '');
  const [documentType, setDocumentType] = useState<Doc['documentType']>(doc.documentType);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const cap = blockId ? 2_000 : 4_000;
  const disabled = readOnly || initial.documentSessionId !== documentSessionId
    || (blockId !== undefined && (!heading || heading.locked === true));
  const save = () => {
    if (disabled) return;
    if (value !== initial.value || (!blockId && doc.documentType !== initial.documentType)) {
      setError('These instructions changed while this dialog was open. Your draft is kept here; copy it before reopening.');
      return;
    }
    const instructions = text.trim() ? text : undefined;
    if (blockId) setHeadingInstructions(blockId, instructions);
    else setDocMeta({ instructions, documentType });
    onClose();
  };
  return <>
    {!blockId && <label className="grid gap-1 text-sm">
      Page type
      <select value={documentType ?? ''} disabled={disabled}
        className="h-9 rounded-md border border-border bg-background px-2"
        onChange={(event) => setDocumentType(TYPES.find((type) => type.id === event.target.value)?.id)}>
        <option value="">No page type</option>
        {TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
      </select>
      <span className="text-xs text-muted-foreground">Loads this type’s writing skill before the assistant starts.</span>
    </label>}
    <label htmlFor={id} className="text-sm font-medium">{blockId ? 'Section instructions' : 'Page instructions'}</label>
    <textarea id={id} value={text} onChange={(event) => setText(event.target.value)} maxLength={cap}
      disabled={disabled} className="min-h-36 w-full resize-y rounded-md border border-border bg-background p-3 text-sm"
      placeholder={blockId ? 'Keep this section under 400 words…' : 'British spelling. Target audience, venue, style, sections to leave alone…'} />
    <p className="text-xs text-muted-foreground">{text.length.toLocaleString()} / {cap.toLocaleString()} characters</p>
    {heading?.aiHidden && <p className="text-sm text-muted-foreground">This heading is hidden from the assistant, so its instructions are not sent.</p>}
    {disabled && <p role="status" className="text-sm text-muted-foreground">These instructions cannot be changed while the page is view-only or the heading is locked.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button disabled={disabled} onClick={save}>Save instructions</Button>
    </DialogFooter>
  </>;
}
