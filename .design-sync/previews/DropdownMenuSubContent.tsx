import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  Languages,
  MoreHorizontal,
  Sparkles,
} from 'lucide-react';

// The submenu panel: same popover surface as DropdownMenuContent but with
// shadow-lg, anchored to its sub trigger rather than to the root trigger.
// It ships min-w-[8rem] and nothing else, so width is yours to set.

export function CollectionList() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="icon" size="icon-sm" aria-label="Document actions">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
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
            <DropdownMenuItem>
              <Folder aria-hidden="true" /> Reading list 2024
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <FolderPlus aria-hidden="true" /> New collection…
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem>
          <FileDown aria-hidden="true" /> Export as LaTeX
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LanguageList() {
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
          Transform
        </DropdownMenuLabel>
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger className="gap-2">
            <Languages aria-hidden="true" /> Translate
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[12rem]">
            <DropdownMenuItem className="gap-2">English</DropdownMenuItem>
            <DropdownMenuItem className="gap-2">Spanish</DropdownMenuItem>
            <DropdownMenuItem className="gap-2">
              <span className="text-muted-foreground">Other…</span>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WideWithDescriptions() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <FileDown aria-hidden="true" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>
            <Braces aria-hidden="true" /> LaTeX
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              LaTeX flavour
            </DropdownMenuLabel>
            <DropdownMenuItem className="items-start">
              <FileText aria-hidden="true" className="mt-0.5 text-muted-foreground" />
              <span className="flex min-w-0 flex-col">
                <span>arXiv package</span>
                <span className="text-xs text-muted-foreground">.tex, .bbl and every figure</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem className="items-start">
              <Braces aria-hidden="true" className="mt-0.5 text-muted-foreground" />
              <span className="flex min-w-0 flex-col">
                <span>Plain .tex file</span>
                <span className="text-xs text-muted-foreground">Body only, no preamble</span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem>Markdown</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
