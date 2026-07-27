import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useEditor } from '@/editor';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { AlertCircle, Check, Copy, RotateCcw, Save, Wand2 } from 'lucide-react';

/**
 * JsonPanel — inspect and replace the current document's structure.
 *
 * This panel used to carry a second, parallel document API: a free-text
 * "Document ID" field with its own Create / Save / Load / Delete / List
 * buttons, each reporting through `window.alert`. That duplicated the sidebar
 * document list and the header's save controls, and let the panel act on a
 * different document than the one on screen. It now operates on the open
 * document only, and persistence goes through the editor's normal save path.
 */
export function JsonPanel() {
  const { setFromJSON, doc, documentId, saveRemote } = useEditor();
  const { toast } = useToast();

  const currentJson = JSON.stringify(doc, null, 2);
  const [draft, setDraft] = useState(() => ({ base: currentJson, text: currentJson }));
  const dirty = draft.text !== draft.base;
  const text = dirty ? draft.text : currentJson;
  const [parseError, setParseError] = useState<string | null>(null);
  const parseErrorId = useId();
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const revert = () => {
    setDraft({ base: currentJson, text: currentJson });
    setParseError(null);
  };

  const format = () => {
    try {
      setDraft((current) => ({
        ...current,
        text: JSON.stringify(JSON.parse(text), null, 2),
      }));
      setParseError(null);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Invalid JSON');
    }
  };

  const apply = () => {
    try {
      setFromJSON(text);
      setDraft({ base: text, text });
      setParseError(null);
      toast({ title: 'Document structure replaced', variant: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON';
      setParseError(message);
      toast({ title: 'Could not apply JSON', description: message, variant: 'error' });
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ title: 'Could not copy to clipboard', variant: 'error' });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveRemote();
      toast({ title: 'Document saved', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Document</dt>
        <dd className="truncate font-medium">{doc.name || 'Untitled document'}</dd>
        <dt className="text-muted-foreground">ID</dt>
        <dd className="truncate font-mono text-2xs">
          {documentId ?? <span className="font-sans text-muted-foreground">Not saved yet</span>}
        </dd>
        <dt className="text-muted-foreground">Blocks</dt>
        <dd className="tabular-nums">{doc.blocks.length}</dd>
      </dl>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={revert} disabled={!dirty}>
          <RotateCcw className="h-3 w-3" />
          Revert
        </Button>
        <Button variant="ghost" size="sm" onClick={format}>
          <Wand2 className="h-3 w-3" />
          Format
        </Button>
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <Textarea
        className={cn(
          'min-h-[200px] flex-1 resize-none border-muted bg-muted/30 font-mono text-xs focus:bg-background',
          parseError && 'border-destructive/60',
        )}
        value={text}
        spellCheck={false}
        aria-label="Document JSON"
        aria-invalid={parseError !== null}
        // `aria-invalid` says the field is wrong; without this the reason sits
        // in an unassociated paragraph and is never read out with the field.
        aria-describedby={parseError ? parseErrorId : undefined}
        onChange={(event) => {
          setDraft((current) => ({
            base: current.text === current.base ? currentJson : current.base,
            text: event.target.value,
          }));
          if (parseError) setParseError(null);
        }}
        placeholder="Document JSON…"
      />

      {parseError && (
        <p
          id={parseErrorId}
          role="alert"
          className="flex items-start gap-1.5 text-xs text-destructive"
        >
          <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{parseError}</span>
        </p>
      )}

      <div className="flex flex-shrink-0 items-center gap-2">
        <Button className="flex-1" onClick={apply} disabled={!dirty}>
          Apply to document
        </Button>
        <Button variant="outline" onClick={save} disabled={saving}>
          {saving ? <Spinner /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}
