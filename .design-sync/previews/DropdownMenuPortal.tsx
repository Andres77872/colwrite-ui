import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from 'colwrite-ui';
import {
  Braces,
  ChevronRight,
  FileDown,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';

// DropdownMenuContent already wraps itself in a Portal, so the explicit
// DropdownMenuPortal is for the SUB content — which the DS ships unwrapped —
// and for redirecting either one into a `container` of your own.

export function ImplicitContentPortal() {
  return (
    <div className="flex w-64 items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2">
      <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">vaswani-attention.pdf</span>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Actions for vaswani-attention.pdf">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        {/* No Portal written here — DropdownMenuContent supplies its own. */}
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem>
            <Upload aria-hidden="true" /> Open the PDF
          </DropdownMenuItem>
          <DropdownMenuItem>
            <RefreshCw aria-hidden="true" /> Re-run extraction
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive">
            <Trash2 aria-hidden="true" /> Remove from library
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function PortaledSubContent() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="icon" size="icon-sm" aria-label="Document actions">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem>
          <FileDown aria-hidden="true" /> Export as LaTeX
        </DropdownMenuItem>
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>
            <Folder aria-hidden="true" /> Move to collection
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </DropdownMenuSubTrigger>
          {/* Explicit Portal: the submenu panel leaves the parent menu's DOM
              and mounts on document.body instead. */}
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="min-w-[12rem]">
              <DropdownMenuItem>
                <Folder aria-hidden="true" /> Transformer surveys
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Folder aria-hidden="true" /> Sparse attention
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Folder aria-hidden="true" /> Reading list 2024
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <FolderPlus aria-hidden="true" /> New collection…
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NestedPortals() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <FileDown aria-hidden="true" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Attention Is All You Need, Revisited</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>
            <Braces aria-hidden="true" /> LaTeX
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="min-w-[12rem]">
              <DropdownMenuItem>Plain .tex file</DropdownMenuItem>
              <DropdownMenuSub open>
                <DropdownMenuSubTrigger>
                  arXiv package
                  <ChevronRight aria-hidden="true" className="ml-auto" />
                </DropdownMenuSubTrigger>
                {/* A second portal for the second level. */}
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="min-w-[12rem]">
                    <DropdownMenuItem>With figures</DropdownMenuItem>
                    <DropdownMenuItem>Source only</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuItem>Overleaf project</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuItem>
          <FileText aria-hidden="true" /> Markdown
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
