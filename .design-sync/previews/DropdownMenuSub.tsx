import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from 'colwrite-ui';
import {
  Braces,
  ChevronRight,
  Copy,
  FileDown,
  Folder,
  FolderPlus,
  Languages,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
} from 'lucide-react';

// Sub is the nesting root: it owns one submenu's open state, independently of
// the parent menu. The parent is forced open in every story; the sub's own
// `open` is what varies.

export function OpenSubmenu() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="icon" size="icon-sm" aria-label="Document actions">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem>
          <Pencil aria-hidden="true" /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Copy aria-hidden="true" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>
            <Folder aria-hidden="true" /> Move to collection
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[12rem]">
            <DropdownMenuItem>
              <Folder aria-hidden="true" /> Transformer surveys
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Folder aria-hidden="true" /> Sparse attention
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <FolderPlus aria-hidden="true" /> New collection…
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive">
          <Trash2 aria-hidden="true" /> Delete document
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ClosedSubmenu() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles aria-hidden="true" />
          AI actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[15rem]">
        <DropdownMenuItem>Improve writing</DropdownMenuItem>
        <DropdownMenuItem>Fix grammar</DropdownMenuItem>
        {/* No `open`: the sub trigger sits at rest and the panel is unmounted —
            the resting row is all the parent menu shows. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages aria-hidden="true" /> Translate
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[12rem]">
            <DropdownMenuItem>English</DropdownMenuItem>
            <DropdownMenuItem>Spanish</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem>Make shorter</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NestedSubmenus() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <FileDown aria-hidden="true" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>
            <Braces aria-hidden="true" /> LaTeX
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[12rem]">
            <DropdownMenuItem>Plain .tex file</DropdownMenuItem>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger>
                arXiv package
                <ChevronRight aria-hidden="true" className="ml-auto" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[12rem]">
                <DropdownMenuItem>With figures</DropdownMenuItem>
                <DropdownMenuItem>Source only</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem>Overleaf project</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem>Markdown</DropdownMenuItem>
        <DropdownMenuItem>BibTeX references</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
