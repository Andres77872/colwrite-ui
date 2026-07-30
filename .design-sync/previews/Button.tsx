import { Button } from 'colwrite-ui';
import { ArrowRight, Check, Plus, Trash2, X } from 'lucide-react';

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Save draft</Button>
      <Button variant="secondary">Preview</Button>
      <Button variant="outline">Import BibTeX</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="destructive">Delete document</Button>
      <Button variant="link">View on arXiv</Button>
      <Button variant="icon" aria-label="Add block">
        <Plus />
      </Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="lg">Large</Button>
      <Button size="default">Default</Button>
      <Button size="sm">Small</Button>
      <Button size="xs">Extra small</Button>
      <Button size="icon" variant="icon" aria-label="Confirm">
        <Check />
      </Button>
      <Button size="icon-sm" variant="icon" aria-label="Dismiss">
        <X />
      </Button>
      <Button size="icon-xs" variant="icon" aria-label="Remove">
        <Trash2 />
      </Button>
    </div>
  );
}

export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Plus />
        New section
      </Button>
      <Button variant="secondary">
        Continue
        <ArrowRight />
      </Button>
      <Button variant="outline" size="sm">
        <Check />
        Accept all changes
      </Button>
      <Button variant="destructive" size="sm">
        <Trash2 />
        Discard
      </Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled>Save draft</Button>
      <Button variant="secondary" disabled>
        Preview
      </Button>
      <Button variant="outline" disabled>
        Import BibTeX
      </Button>
      <Button variant="destructive" disabled>
        Delete document
      </Button>
    </div>
  );
}

export function AsChild() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button asChild>
        <a href="#preview">Anchor styled as a button</a>
      </Button>
      <Button asChild variant="link">
        <a href="#preview">Link variant</a>
      </Button>
    </div>
  );
}
