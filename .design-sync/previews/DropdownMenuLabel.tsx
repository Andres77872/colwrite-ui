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
  Check,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Languages,
  Lock,
  LogOut,
  Search,
  Sparkles,
  Trash2,
  User,
  Wand2,
} from 'lucide-react';

// Three real label shapes from the app: the default semibold caption, the
// 2xs uppercase eyebrow the editor menus use for group headers, and the
// two-line account label from the topbar.

export function Caption() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="icon" size="icon-sm" aria-label="Paragraph options">
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
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

export function Eyebrow() {
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

export function AccountLabel() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-2xs font-semibold text-secondary-foreground">
            RO
          </span>
          Rosa Okafor
          <ChevronDown aria-hidden="true" />
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
