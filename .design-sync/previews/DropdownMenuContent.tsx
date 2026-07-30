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
  BookMarked,
  ChevronDown,
  FileDown,
  FolderInput,
  Heading2,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Quote,
  Search,
  Trash2,
  Type,
} from 'lucide-react';

// The axis here is placement: `align`, `side`, `sideOffset` and the width
// override, which is the only sizing decision the content takes (it ships
// min-w-[8rem] and nothing else).

export function AlignEnd() {
  return (
    <div className="flex w-64 items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-2.5 py-2">
      <span className="min-w-0 truncate text-sm font-medium">Transformer surveys</span>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Actions for Transformer surveys">
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

export function SideRight() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="icon" size="icon-sm" aria-label="Insert a block after this heading">
          <Plus aria-hidden="true" />
        </Button>
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
        <DropdownMenuItem>
          <Minus aria-hidden="true" className="text-muted-foreground" /> Divider
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WideWithOffset() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Quote aria-hidden="true" />
          Citation
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={10} className="w-64">
        <DropdownMenuLabel>Vaswani et al., 2017</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <BookMarked aria-hidden="true" />
          <span className="flex min-w-0 flex-col">
            <span>Open in references</span>
            <span className="text-xs text-muted-foreground">Reference 12 of 34</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Search aria-hidden="true" />
          <span className="flex min-w-0 flex-col">
            <span>Find related work</span>
            <span className="text-xs text-muted-foreground">Searches Semantic Scholar</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <FileDown aria-hidden="true" />
          <span className="flex min-w-0 flex-col">
            <span>Copy BibTeX entry</span>
            <span className="text-xs text-muted-foreground">Includes the arXiv eprint field</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
