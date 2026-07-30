import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
} from 'colwrite-ui';
import {
  Check,
  Copy,
  FileDown,
  FileText,
  FolderInput,
  Languages,
  MoreHorizontal,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';

// The item is the only interactive row in the compound, so its states are the
// axis: leading icon, destructive, disabled, a trailing shortcut hint, `inset`
// alignment, and a two-line item.

export function States() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="icon" size="icon-sm" aria-label="Document actions">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem>
          <Pencil aria-hidden="true" /> Rename
          <Kbd className="ml-auto">F2</Kbd>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Copy aria-hidden="true" /> Duplicate
          <Kbd className="ml-auto">⌘D</Kbd>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <FileDown aria-hidden="true" /> Export as LaTeX
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <FolderInput aria-hidden="true" /> Move to collection
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive">
          <Trash2 aria-hidden="true" /> Delete document
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Inset() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Citation style
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel inset>Citation style</DropdownMenuLabel>
        <DropdownMenuItem inset>
          <span className="absolute left-2 flex items-center justify-center">
            <Check aria-hidden="true" />
          </span>
          APA 7th edition
        </DropdownMenuItem>
        <DropdownMenuItem inset>IEEE</DropdownMenuItem>
        <DropdownMenuItem inset>Chicago (author–date)</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem inset disabled>
          BibLaTeX (needs a .bib file)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TwoLine() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles aria-hidden="true" />
          Ask the assistant
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[15rem]">
        <DropdownMenuItem className="items-start">
          <Wand2 aria-hidden="true" className="mt-0.5 text-muted-foreground" />
          <span className="flex min-w-0 flex-col">
            <span>Improve writing</span>
            <span className="text-xs text-muted-foreground">
              Rewrites the selection for clarity
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem className="items-start">
          <Search aria-hidden="true" className="mt-0.5 text-muted-foreground" />
          <span className="flex min-w-0 flex-col">
            <span>Search references</span>
            <span className="text-xs text-muted-foreground">
              Finds citations for this claim
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem className="items-start">
          <Languages aria-hidden="true" className="mt-0.5 text-muted-foreground" />
          <span className="flex min-w-0 flex-col">
            <span>Translate</span>
            <span className="text-xs text-muted-foreground">English, Spanish or a custom language</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="items-start">
          <FileText aria-hidden="true" className="mt-0.5 text-muted-foreground" />
          <span className="flex min-w-0 flex-col">
            <span>Summarise section</span>
            <span className="text-xs text-muted-foreground">Select some text first</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
