import { Textarea } from 'colwrite-ui';
import { AlertCircle } from 'lucide-react';

// Ported from ProfileHeader's About field, CollectionDialogs' Description,
// AiBeatInline's prompt box and JsonPanel's editor — the four shapes this
// takes in the app: prose with a counter, an optional field, a mono editor,
// and the invalid state JsonPanel writes with aria-invalid.

function Form({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-3">{children}</div>
  );
}

const ABSTRACT =
  'We revisit the original transformer formulation under modern training budgets and show that the reported scaling behaviour holds only once the learning-rate schedule is decoupled from the batch size.';

const DOC_JSON = `{
  "name": "Transformers, revisited",
  "version": 7,
  "blocks": [
    { "id": "b1", "type": "heading", "level": 1 },
    { "id": "b2", "type": "paragraph" }
  ]
}`;

export function LabelledWithCounter() {
  return (
    <Form>
      <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-2 text-sm font-medium">
          Abstract
          <span className="text-2xs font-normal tabular-nums text-muted-foreground">
            {`${ABSTRACT.length}/1000`}
          </span>
        </span>
        <Textarea rows={5} maxLength={1000} defaultValue={ABSTRACT} />
      </label>
    </Form>
  );
}

export function PlaceholderOnly() {
  return (
    <Form>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Folder description</span>
          <Textarea placeholder="Optional" maxLength={500} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Prompt</span>
          <Textarea rows={2} placeholder="What do you want to generate?" />
        </label>
      </div>
    </Form>
  );
}

export function MonospaceEditor() {
  return (
    <Form>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Document JSON</span>
        <Textarea
          className="min-h-32 resize-none border-muted bg-muted/30 font-mono text-xs"
          aria-label="Document JSON"
          spellCheck={false}
          defaultValue={DOC_JSON}
        />
      </label>
    </Form>
  );
}

export function Invalid() {
  return (
    <Form>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Document JSON</span>
        <Textarea
          className="min-h-24 resize-none border-muted bg-muted/30 font-mono text-xs border-destructive/60"
          aria-label="Document JSON"
          aria-invalid
          aria-describedby="textarea-preview-error"
          spellCheck={false}
          defaultValue={'{\n  "name": "Transformers, revisited",\n  "blocks": [ { "id": "b1", }\n}'}
        />
        <p
          id="textarea-preview-error"
          role="alert"
          className="flex items-start gap-1.5 text-xs text-destructive"
        >
          <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            {'Unexpected token } in JSON at position 64'}
          </span>
        </p>
      </label>
    </Form>
  );
}

export function Disabled() {
  return (
    <Form>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Abstract</span>
          <Textarea rows={3} defaultValue={ABSTRACT} disabled />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Folder description</span>
          <Textarea rows={2} placeholder="Optional" disabled />
        </label>
      </div>
    </Form>
  );
}
