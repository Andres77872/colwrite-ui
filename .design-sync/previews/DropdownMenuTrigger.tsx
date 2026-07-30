import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'colwrite-ui';
import {
  ChevronDown,
  Copy,
  FileDown,
  FolderInput,
  Heading2,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Type,
} from 'lucide-react';

// Every story forces `open` + `modal={false}` so the trigger is shown in its
// open state (`data-state="open"`) with the portalled content it owns.

export function AsChildButton() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Plus aria-hidden="true" />
          Add a block
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem>
          <Type aria-hidden="true" className="text-muted-foreground" /> Paragraph
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Heading2 aria-hidden="true" className="text-muted-foreground" /> Heading
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Minus aria-hidden="true" className="text-muted-foreground" /> Divider
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function IconTrigger() {
  return (
    <div className="flex w-64 items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-2.5 py-2">
      <span className="min-w-0 truncate text-sm font-medium">Related work</span>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="icon" size="icon-sm" aria-label="Actions for Related work">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem>
            <Pencil aria-hidden="true" /> Rename or edit description
          </DropdownMenuItem>
          <DropdownMenuItem>
            <FolderInput aria-hidden="true" /> Move to another folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive">
            <Trash2 aria-hidden="true" /> Delete folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function CustomTrigger() {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Section 3 · Method</span>
      <DropdownMenu open modal={false}>
        {/* No `asChild`: DropdownMenuTrigger renders its own unstyled <button>,
            so the open-state surface (bg-accent) is passed as className — the
            same pair of classes the gutter control toggles on `open` in the
            app. */}
        <DropdownMenuTrigger
          className="flex size-6 items-center justify-center rounded-sm bg-accent text-foreground transition-colors"
          aria-label="Insert a block after this paragraph"
        >
          <Plus aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-44">
          <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Insert below
          </DropdownMenuLabel>
          <DropdownMenuItem>
            <Type aria-hidden="true" className="text-muted-foreground" /> Paragraph
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Heading2 aria-hidden="true" className="text-muted-foreground" /> Heading
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <Copy aria-hidden="true" className="text-muted-foreground" /> Duplicate paragraph
          </DropdownMenuItem>
          <DropdownMenuItem>
            <FileDown aria-hidden="true" className="text-muted-foreground" /> Export section
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
