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
  Check,
  Copy,
  EyeOff,
  FileDown,
  FolderInput,
  Languages,
  Lock,
  MoreHorizontal,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';

// The separator is a 1px `bg-border` rule with `-mx-1` so it bleeds to the
// content's padding edge. The axis: several sections, a single rule fencing a
// destructive action off, and a rule bracketing a non-item control.

export function ThreeSections() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles aria-hidden="true" />
          AI actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[15rem]">
        <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Edit
        </DropdownMenuLabel>
        <DropdownMenuItem>
          <Wand2 aria-hidden="true" className="text-muted-foreground" /> Improve writing
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Check aria-hidden="true" className="text-muted-foreground" /> Fix grammar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Reference
        </DropdownMenuLabel>
        <DropdownMenuItem>
          <Search aria-hidden="true" className="text-muted-foreground" /> Search references
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Transform
        </DropdownMenuLabel>
        <DropdownMenuItem>
          <Languages aria-hidden="true" className="text-muted-foreground" /> Translate
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BeforeDestructive() {
  return (
    <div className="flex w-64 items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-2">
      <span className="min-w-0 truncate text-sm">Scaling Laws for Sparse Attention</span>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Document actions">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem>
            <Pencil aria-hidden="true" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Copy aria-hidden="true" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem>
            <FileDown aria-hidden="true" /> Export as LaTeX
          </DropdownMenuItem>
          <DropdownMenuItem>
            <FolderInput aria-hidden="true" /> Move to collection
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive">
            <Trash2 aria-hidden="true" /> Delete document
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AroundControl() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="icon" size="icon-sm" aria-label="Paragraph options">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Paragraph</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* A non-item control between two rules — the block options menu puts
            its column picker here. Radix only manages focus for items, so a
            plain control needs its own group label. */}
        <div className="px-2 py-1.5">
          <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Columns
          </div>
          <div role="group" aria-label="Columns" className="flex gap-1">
            <span className="flex h-7 flex-1 items-center justify-center rounded-sm border border-primary bg-primary text-xs font-medium text-primary-foreground">
              1
            </span>
            <span className="flex h-7 flex-1 items-center justify-center rounded-sm border border-border text-xs font-medium">
              2
            </span>
            <span className="flex h-7 flex-1 items-center justify-center rounded-sm border border-border text-xs font-medium">
              3
            </span>
            <span className="flex h-7 flex-1 items-center justify-center rounded-sm border border-border text-xs font-medium">
              4
            </span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <EyeOff aria-hidden="true" /> Hide from assistant
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Lock aria-hidden="true" /> Lock block
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
