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
  Braces,
  Check,
  ChevronRight,
  Copy,
  EyeOff,
  FileDown,
  FileText,
  Languages,
  Link2,
  Lock,
  MoreHorizontal,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';

// Group is a role="group" wrapper: no styling of its own, so the axis is what
// it buys — a labelled section, and a set of related items kept together while
// a lone destructive action stays outside it.

export function LabelledGroups() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles aria-hidden="true" />
          AI actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[15rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Edit
          </DropdownMenuLabel>
          <DropdownMenuItem>
            <Wand2 aria-hidden="true" className="text-muted-foreground" /> Improve writing
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Check aria-hidden="true" className="text-muted-foreground" /> Fix grammar
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Reference
          </DropdownMenuLabel>
          <DropdownMenuItem>
            <Search aria-hidden="true" className="text-muted-foreground" /> Search references
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Transform
          </DropdownMenuLabel>
          <DropdownMenuItem>
            <Languages aria-hidden="true" className="text-muted-foreground" /> Translate
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BlockToggles() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="icon" size="icon-sm" aria-label="Heading options">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Heading 2</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* The three block toggles are one group; Delete deliberately sits
            outside it, behind a rule. */}
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

export function ExportTargets() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <FileDown aria-hidden="true" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Formats
          </DropdownMenuLabel>
          <DropdownMenuItem>
            <Braces aria-hidden="true" className="text-muted-foreground" /> LaTeX source
          </DropdownMenuItem>
          <DropdownMenuItem>
            <FileText aria-hidden="true" className="text-muted-foreground" /> Markdown
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Copy aria-hidden="true" className="text-muted-foreground" /> BibTeX references
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Share
          </DropdownMenuLabel>
          <DropdownMenuItem>
            <Link2 aria-hidden="true" className="text-muted-foreground" /> Copy read-only link
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Share2 aria-hidden="true" className="text-muted-foreground" /> Invite a co-author
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
