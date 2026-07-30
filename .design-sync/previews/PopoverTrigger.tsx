import {
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'colwrite-ui';
import { GripVertical, Quote, Settings2, Trash2 } from 'lucide-react';

// Each cell is the whole Popover compound with `open` forced — the trigger is
// the varying part. The three shapes are the ones the app actually uses:
// `asChild` over a Button, `asChild` over a small icon Button in a widget
// header, and the bare trigger styled through `className` as an inline pill.

export function AsChildButton() {
  return (
    <Popover open>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Quote />
          Insert citation
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Cite from this document
        </span>
        <Input className="h-8 text-xs" defaultValue="Izacard" />
        <button
          type="button"
          className="mt-2 w-full rounded-sm bg-accent px-2 py-1.5 text-left"
        >
          <span className="block truncate text-xs font-medium text-foreground">
            Leveraging Passage Retrieval with Generative Models
          </span>
          <span className="mt-1 block text-2xs text-muted-foreground">
            Izacard &amp; Grave · EACL 2021
          </span>
        </button>
        <div className="mt-3 flex justify-end gap-2 border-t border-border/60 pt-2.5">
          <Button variant="ghost" size="sm">
            Cancel
          </Button>
          <Button variant="outline" size="sm">
            Insert
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AsChildIconButton() {
  return (
    <div className="w-64 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-1 border-b border-border/60 bg-muted/40 px-2 py-1">
        <GripVertical aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Table
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          <Popover open>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Table settings"
                className="text-muted-foreground"
              >
                <Settings2 />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-3">
              <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Table settings
              </span>
              <div className="space-y-2">
                <label
                  htmlFor="ds-ptrig-head"
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <Checkbox id="ds-ptrig-head" defaultChecked />
                  First row is a header
                </label>
                <label
                  htmlFor="ds-ptrig-span"
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <Checkbox id="ds-ptrig-span" />
                  Span the full column width
                </label>
              </div>
              <div className="mt-3 flex justify-end gap-2 border-t border-border/60 pt-2.5">
                <Button variant="ghost" size="sm" className="text-destructive">
                  Remove
                </Button>
                <Button variant="outline" size="sm">
                  Done
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Remove table"
            className="text-muted-foreground"
          >
            <Trash2 />
          </Button>
        </span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          <tr className="border-b border-border/50">
            <td className="px-2 py-1 font-medium text-foreground">Model</td>
            <td className="px-2 py-1 text-right font-medium text-foreground">EM</td>
          </tr>
          <tr className="border-b border-border/50">
            <td className="px-2 py-1 text-muted-foreground">FiD-base</td>
            <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">48.2</td>
          </tr>
          <tr>
            <td className="px-2 py-1 text-muted-foreground">FiD-large</td>
            <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">51.4</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function StyledTriggerElement() {
  return (
    <p className="max-w-md text-base leading-relaxed text-foreground">
      Fusion-in-Decoder encodes each retrieved passage independently before the decoder
      attends over the concatenation{' '}
      <Popover open>
        <PopoverTrigger className="rounded-sm bg-primary/10 px-1 py-0.5 text-sm text-primary hover:bg-primary/20">
          [Izacard &amp; Grave, 2021]
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-3">
          <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Citation
          </span>
          <span className="mt-1 block text-sm font-medium text-foreground">
            Leveraging Passage Retrieval with Generative Models for Open Domain QA
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Izacard &amp; Grave · EACL 2021 · arXiv:2007.01282
          </span>
          <label
            htmlFor="ds-ptrig-page"
            className="mt-3 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Locator
          </label>
          <Input id="ds-ptrig-page" className="mt-1 h-8 text-xs" defaultValue="§3.2, p. 876" />
          <div className="mt-3 flex justify-end gap-2 border-t border-border/60 pt-2.5">
            <Button variant="ghost" size="sm" className="text-destructive">
              Remove
            </Button>
            <Button variant="outline" size="sm">
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>, which keeps the cross-passage cost in the decoder rather than the
      encoder.
    </p>
  );
}
