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
  Check,
  ChevronRight,
  FileDown,
  Folder,
  FolderPlus,
  Languages,
  MoreHorizontal,
  Sparkles,
} from 'lucide-react';

// The sub trigger is an item that opens a submenu instead of firing. It shares
// the item's row styling, so the trailing ChevronRight is the only affordance
// that says "there is more" — write it yourself, the DS does not inject one.

export function WithChevron() {
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
        <DropdownMenuSeparator />
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>
            <Languages aria-hidden="true" /> Translate
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[12rem]">
            <DropdownMenuItem>English</DropdownMenuItem>
            <DropdownMenuItem>Spanish</DropdownMenuItem>
            <DropdownMenuItem>
              <span className="text-muted-foreground">Other…</span>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
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
        <DropdownMenuSeparator />
        {/* `inset` keeps the sub trigger on the same text column as the inset
            items above it, instead of starting where their icons would. */}
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger inset>
            More styles
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[12rem]">
            <DropdownMenuItem>Chicago (author–date)</DropdownMenuItem>
            <DropdownMenuItem>Nature</DropdownMenuItem>
            <DropdownMenuItem>Vancouver</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Disabled() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="icon" size="icon-sm" aria-label="Document actions">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {/* Disabled: this account has no collections yet, so the submenu can
            never have contents. 50% opacity, pointer events off. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled>
            <Folder aria-hidden="true" /> Move to collection
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>
              <FolderPlus aria-hidden="true" /> New collection…
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>
            <FileDown aria-hidden="true" /> Export as
            <ChevronRight aria-hidden="true" className="ml-auto" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[12rem]">
            <DropdownMenuItem>
              <Braces aria-hidden="true" /> LaTeX source
            </DropdownMenuItem>
            <DropdownMenuItem>Markdown</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
