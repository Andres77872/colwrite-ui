import { Checkbox } from 'colwrite-ui';
import { AlertCircle } from 'lucide-react';

// Ported from InlineShell's settings toggles (htmlFor + id) and the Semantic
// Scholar filter row (wrapping label). `checked` / `defaultChecked` are what
// make a state visible in a static capture.

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-3">{children}</div>
  );
}

function Row({
  id,
  label,
  children,
  muted,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-2 text-sm ${muted ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      {children}
      {label}
    </label>
  );
}

export function States() {
  return (
    <Card>
      <div className="flex flex-col gap-2.5">
        <Row id="cb-unchecked" label="Unchecked">
          <Checkbox id="cb-unchecked" />
        </Row>
        <Row id="cb-checked" label="Checked">
          <Checkbox id="cb-checked" defaultChecked />
        </Row>
        <Row id="cb-mixed" label="Indeterminate (some sections selected)">
          <Checkbox id="cb-mixed" checked="indeterminate" />
        </Row>
        <Row id="cb-disabled" label="Disabled" muted>
          <Checkbox id="cb-disabled" disabled />
        </Row>
        <Row id="cb-disabled-checked" label="Disabled, checked" muted>
          <Checkbox id="cb-disabled-checked" disabled defaultChecked />
        </Row>
      </div>
    </Card>
  );
}

export function LabelledRows() {
  return (
    <Card>
      <div className="flex flex-col gap-2.5">
        <Row id="cb-caption" label="Show caption">
          <Checkbox id="cb-caption" defaultChecked />
        </Row>
        <Row id="cb-numbered" label="Number this equation">
          <Checkbox id="cb-numbered" />
        </Row>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox defaultChecked aria-label="Open-access papers only" />
          Open-access papers only
        </label>
      </div>
    </Card>
  );
}

export function IncludeInExport() {
  return (
    <Card>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Include in export</legend>
        <div className="flex flex-col gap-2.5">
          <Row id="cb-abstract" label="Abstract">
            <Checkbox id="cb-abstract" defaultChecked />
          </Row>
          <Row id="cb-method" label="3. Method">
            <Checkbox id="cb-method" defaultChecked />
          </Row>
          <Row id="cb-appendix" label="Appendix A — derivations">
            <Checkbox id="cb-appendix" />
          </Row>
          <Row id="cb-refs" label="References (always exported)" muted>
            <Checkbox id="cb-refs" disabled defaultChecked />
          </Row>
        </div>
      </fieldset>
    </Card>
  );
}

export function InvalidRequired() {
  return (
    <Card>
      <fieldset aria-describedby="cb-preview-error">
        <legend className="mb-2 text-sm font-medium">Include in export</legend>
        <div className="flex flex-col gap-2.5">
          <Row id="cb-invalid-abstract" label="Abstract">
            <Checkbox
              id="cb-invalid-abstract"
              className="border-destructive"
              aria-invalid
              aria-describedby="cb-preview-error"
              required
            />
          </Row>
          <Row id="cb-invalid-method" label="3. Method">
            <Checkbox
              id="cb-invalid-method"
              className="border-destructive"
              aria-invalid
              aria-describedby="cb-preview-error"
            />
          </Row>
        </div>
        <p
          id="cb-preview-error"
          role="alert"
          className="mt-2 flex items-start gap-1.5 text-xs text-destructive"
        >
          <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">Select at least one section to export.</span>
        </p>
      </fieldset>
    </Card>
  );
}
