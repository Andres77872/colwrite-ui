import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'colwrite-ui';
import {
  ChevronRight,
  Copy,
  EyeOff,
  FileDown,
  FileText,
  FolderInput,
  GripVertical,
  LogOut,
  Lock,
  MoreHorizontal,
  Pencil,
  Trash2,
  User,
} from 'lucide-react';

// `open` is forced and `modal={false}` on every story: a closed Radix menu
// renders nothing, and modal mode locks body scroll + zeroes body pointer
// events, which can blank a static capture. The content portals to
// document.body, so this component is card-mode "single" in
// .design-sync/config.json.

export function DocumentActions() {
  return (
    <div className="flex w-64 items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2">
      <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">Attention Is All You Need, Revisited</span>
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
          <DropdownMenuItem className="text-destructive focus:text-destructive">
            <Trash2 aria-hidden="true" /> Delete document
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AccountMenu() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-2xs font-semibold text-secondary-foreground">
            RO
          </span>
          Rosa Okafor
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block text-xs font-normal text-muted-foreground">Signed in as</span>
          <span className="block truncate text-sm font-medium">r.okafor@lab.ic.ac.uk</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <User aria-hidden="true" /> Profile and usage
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive">
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BlockOptions() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Paragraph options — drag to reorder"
          className="flex size-6 items-center justify-center rounded-sm bg-accent text-foreground"
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-56">
        <DropdownMenuLabel>Paragraph</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <EyeOff aria-hidden="true" /> Hide from assistant
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Lock aria-hidden="true" /> Lock block
          </DropdownMenuItem>
          <DropdownMenuItem>
            <ChevronRight aria-hidden="true" /> Collapse
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive">
          <Trash2 aria-hidden="true" /> Delete block
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
