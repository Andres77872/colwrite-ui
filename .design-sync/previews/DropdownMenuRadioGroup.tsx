import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from 'colwrite-ui';
import { Check, ChevronRight, FileDown, Heading2, Quote } from 'lucide-react';

// The DS exports the radio GROUP but not Radix's RadioItem, so the selected
// row is drawn with an inset DropdownMenuItem plus an absolutely positioned
// Check — the same left gutter `inset` reserves. The group still scopes the
// choice for assistive tech (role="group") and carries the current `value`.

export function CitationStyle() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Quote aria-hidden="true" />
          Citation style
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel inset>Citation style</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value="apa">
          <DropdownMenuItem inset>
            <span className="absolute left-2 flex items-center justify-center">
              <Check aria-hidden="true" />
            </span>
            APA 7th edition
          </DropdownMenuItem>
          <DropdownMenuItem inset>IEEE</DropdownMenuItem>
          <DropdownMenuItem inset>Chicago (author–date)</DropdownMenuItem>
          <DropdownMenuItem inset>Nature</DropdownMenuItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ExportFormat() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <FileDown aria-hidden="true" />
          Default export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Default export format
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value="latex">
          <DropdownMenuItem inset>
            <span className="absolute left-2 flex items-center justify-center">
              <Check aria-hidden="true" />
            </span>
            LaTeX source
            <span className="ml-auto text-2xs text-muted-foreground">.tex</span>
          </DropdownMenuItem>
          <DropdownMenuItem inset>
            Markdown
            <span className="ml-auto text-2xs text-muted-foreground">.md</span>
          </DropdownMenuItem>
          <DropdownMenuItem inset>
            BibTeX references
            <span className="ml-auto text-2xs text-muted-foreground">.bib</span>
          </DropdownMenuItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function InSubmenu() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="icon" size="icon-sm" aria-label="Heading options">
          <Heading2 aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Heading 2</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>
            <Heading2 aria-hidden="true" /> Level
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[12rem]">
            <DropdownMenuRadioGroup value="2">
              <DropdownMenuItem inset>Heading 1 · section</DropdownMenuItem>
              <DropdownMenuItem inset>
                <span className="absolute left-2 flex items-center justify-center">
                  <Check aria-hidden="true" />
                </span>
                Heading 2 · subsection
              </DropdownMenuItem>
              <DropdownMenuItem inset>Heading 3 · paragraph</DropdownMenuItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem>Collapse</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
