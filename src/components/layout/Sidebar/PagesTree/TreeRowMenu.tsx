import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  Copy,
  ExternalLink,
  FilePlus2,
  FileText,
  FolderInput,
  FolderPlus,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCompactMenus } from '@/components/layout/useCompactMenus';
import { pageLink } from '@/lib/pageLink';
import type { SortMode } from '@/data/workspaces';
import { sidebarHoverAction } from '../sidebarStyles';

/** The three orders a home can be in, as the menus name them. */
const SORT_MODES: ReadonlyArray<{ value: SortMode; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'custom', label: 'Custom' },
  { value: 'updated', label: 'Last edited' },
];

/** The keys that move a row among its siblings, as the shortcut reference shows them. */
const MOVE_UP_KEYS = 'Alt+Shift+↑';
const MOVE_DOWN_KEYS = 'Alt+Shift+↓';

/** The row's "…": out of the tab order (the row is the tab stop), opened by Shift+F10 too. */
function RowMenuTrigger({ label }: { label: string }) {
  return (
    <DropdownMenuTrigger
      tabIndex={-1}
      className={sidebarHoverAction}
      aria-label={`Actions for ${label}`}
      onClick={(event) => event.stopPropagation()}
    >
      <MoreHorizontal aria-hidden="true" />
    </DropdownMenuTrigger>
  );
}

/** A sort-mode choice: a flyout, or inline on a phone where a flyout has no room. */
export function SortChoices({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SortMode | null;
  onChange: (mode: SortMode) => void;
}) {
  const compact = useCompactMenus();
  const choices = (
    <DropdownMenuRadioGroup value={value ?? ''} onValueChange={(next) => onChange(next as SortMode)}>
      {SORT_MODES.map((mode) => (
        <DropdownMenuRadioItem key={mode.value} value={mode.value} indicator>
          {mode.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
  if (compact) {
    return (
      <>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {choices}
      </>
    );
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ArrowUpDown aria-hidden="true" />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-44" collisionPadding={8}>
        {choices}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

type MenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes when the menu closes without opening anything: the row. */
  onCloseFocus: (event: Event) => void;
  label: string;
};

/** Move up and Move down, offered in a home ordered by hand (D9). */
function MoveUpDown({
  custom,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  custom: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  if (!custom) return null;
  return (
    <>
      <DropdownMenuItem disabled={!canMoveUp} onSelect={onMoveUp}>
        <ArrowUp aria-hidden="true" />
        Move up
        <DropdownMenuShortcut>{MOVE_UP_KEYS}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canMoveDown} onSelect={onMoveDown}>
        <ArrowDown aria-hidden="true" />
        Move down
        <DropdownMenuShortcut>{MOVE_DOWN_KEYS}</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}

/**
 * A collection row's menu (08 §6.1): New page here · New collection inside ·
 * Rename · Sort contents · Move to… · Move up / Move down (custom order) ·
 * Show PDFs in Library · "Pages here can use these PDFs" · Move to Trash….
 */
export function CollectionRowMenu({
  canEdit = true,
  open,
  onOpenChange,
  onCloseFocus,
  label,
  sortMode,
  grantNewPages,
  pdfCount,
  custom,
  canMoveUp,
  canMoveDown,
  onNewPage,
  onNewCollection,
  onRename,
  onSort,
  onMoveTo,
  onMoveUp,
  onMoveDown,
  onShowPdfs,
  onGrantNewPages,
  onTrash,
}: MenuProps & {
  /** A viewer's menu shows the PDFs and nothing that changes the tree (D6). */
  canEdit?: boolean;
  sortMode: SortMode;
  grantNewPages: boolean;
  pdfCount: number;
  /** The collection's own parent is ordered by hand. */
  custom: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onNewPage: () => void;
  onNewCollection: () => void;
  onRename: () => void;
  onSort: (mode: SortMode) => void;
  onMoveTo: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onShowPdfs: () => void;
  onGrantNewPages: (on: boolean) => void;
  onTrash: () => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <RowMenuTrigger label={label} />
      <DropdownMenuContent align="start" side="right" className="w-64" onCloseAutoFocus={onCloseFocus}>
        {!canEdit ? (
          <DropdownMenuItem onSelect={onShowPdfs}>
            <BookOpen aria-hidden="true" />
            {pdfCount > 0 ? 'Show PDFs in Library' : 'Open in Library'}
          </DropdownMenuItem>
        ) : (
        <>
        <DropdownMenuItem onSelect={onNewPage}>
          <FilePlus2 aria-hidden="true" />
          New page here
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onNewCollection}>
          <FolderPlus aria-hidden="true" />
          New collection inside
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onRename}>
          <Pencil aria-hidden="true" />
          Rename
          <DropdownMenuShortcut>F2</DropdownMenuShortcut>
        </DropdownMenuItem>
        <SortChoices label="Sort contents" value={sortMode} onChange={onSort} />
        <DropdownMenuItem onSelect={onMoveTo}>
          <FolderInput aria-hidden="true" />
          Move to…
        </DropdownMenuItem>
        <MoveUpDown custom={custom} canMoveUp={canMoveUp} canMoveDown={canMoveDown} onMoveUp={onMoveUp} onMoveDown={onMoveDown} />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onShowPdfs}>
          <BookOpen aria-hidden="true" />
          {pdfCount > 0 ? 'Show PDFs in Library' : 'Open in Library'}
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          toggle
          checked={grantNewPages}
          onCheckedChange={(checked) => onGrantNewPages(checked === true)}
          title="A page created in or moved into this collection can use its PDFs, and stops when it leaves."
        >
          Pages here can use these PDFs
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={onTrash}>
          <Trash2 aria-hidden="true" />
          Move to Trash…
          <DropdownMenuShortcut>Del</DropdownMenuShortcut>
        </DropdownMenuItem>
        </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A page row's menu (08 §6.1): Open · Open in new tab · Copy link · Rename ·
 * Move to… · Move up / Move down (custom order) · Move to Trash, with when it was
 * last edited below.
 */
export function PageRowMenu({
  canEdit = true,
  open,
  onOpenChange,
  onCloseFocus,
  label,
  pageId,
  isOpenPage,
  busy,
  custom,
  canMoveUp,
  canMoveDown,
  edited,
  onOpen,
  onCopyLink,
  onRename,
  onMoveTo,
  onCopyToWorkspace,
  onMoveUp,
  onMoveDown,
  onTrash,
}: MenuProps & {
  /** A viewer's menu opens and links, and changes nothing (D6). */
  canEdit?: boolean;
  pageId: string;
  isOpenPage: boolean;
  busy: boolean;
  custom: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  edited: ReactNode;
  onOpen: () => void;
  onCopyLink: () => void;
  onRename: () => void;
  onMoveTo: () => void;
  onCopyToWorkspace: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onTrash: () => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <RowMenuTrigger label={label} />
      <DropdownMenuContent align="start" side="right" className="w-60" onCloseAutoFocus={onCloseFocus}>
        <DropdownMenuItem disabled={isOpenPage} onSelect={onOpen}>
          <FileText aria-hidden="true" />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={pageLink(pageId)} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" />
            Open in new tab
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopyLink}>
          <Link2 aria-hidden="true" />
          Copy link
        </DropdownMenuItem>
        {canEdit && (
        <>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onRename}>
          <Pencil aria-hidden="true" />
          Rename
          <DropdownMenuShortcut>F2</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onMoveTo}>
          <FolderInput aria-hidden="true" />
          Move to…
        </DropdownMenuItem>
        <MoveUpDown custom={custom} canMoveUp={canMoveUp} canMoveDown={canMoveDown} onMoveUp={onMoveUp} onMoveDown={onMoveDown} />
        <DropdownMenuItem onSelect={onCopyToWorkspace}>
          <Copy aria-hidden="true" />
          Copy to workspace…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive disabled={busy} onSelect={onTrash}>
          <Trash2 aria-hidden="true" />
          Move to Trash
          <DropdownMenuShortcut>Del</DropdownMenuShortcut>
        </DropdownMenuItem>
        </>
        )}
        {edited && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1 text-xs text-muted-foreground">{edited}</p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
