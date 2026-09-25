import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useConfirm } from '@/components/ui/confirmContext';
import { useToast } from '@/components/ui/toastContext';
import { useEditor, type Doc } from '@/editor';
import { usePageSettings } from '@/editor/pageSettings';
import { usePanels } from '@/components/panels/panelsContextState';
import { modifierLabel } from '@/components/layout/Shortcuts';
import { useNewDocument } from '@/components/layout/useNewDocument';
import { relativeTime } from '@/components/layout/relativeTime';
import { editedLabel } from '@/components/layout/editedLabel';
import { displayTitle } from '@/components/layout/displayTitle';
import { knownUpdatedAt, rememberDocumentSummaries } from '@/components/layout/documentSummaryCache';
import { useCompactMenus } from '@/components/layout/useCompactMenus';
import { DocumentExportDialog } from './DocumentExportDialog';
import { documentStats, plural } from './documentStats';
import { PAGE_TOOLS } from './pageTools';
import {
  CaseSensitive,
  Download,
  FileCode,
  History,
  Link2,
  MoreHorizontal,
  MoveHorizontal,
  Quote,
  Redo2,
  SquarePen,
  Trash2,
  Undo2,
} from 'lucide-react';

const CITATION_STYLES: ReadonlyArray<{ value: NonNullable<Doc['citationStyle']> | 'auto'; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'numeric', label: 'Numeric [1]' },
  { value: 'ieee', label: 'IEEE' },
  { value: 'author-year', label: 'Author–year' },
];

/**
 * The page's "…" menu: everything that acts on the page as a whole.
 *
 * Export, delete, undo and the rest used to be a row of buttons — among them
 * a filled Save button that was the loudest thing on screen for an action
 * autosave already performs. As in Notion they sit here, with the counts the
 * old status footer kept permanently on screen as the menu's footer.
 */
export function PageMenu() {
  const {
    blocks,
    doc,
    documentId,
    lastSavedAt,
    canUndo,
    canRedo,
    undo,
    redo,
    deleteRemote,
    setCitationStyle,
    listRemote,
  } = useEditor();
  const pageSettings = usePageSettings();
  const { setTool } = usePanels();
  const newDocument = useNewDocument();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Closing the menu hands focus back to its trigger, and a focused trigger
  // opens its tooltip: after choosing Document JSON the hint would sit over
  // the sidebar that just opened. The tooltip ignores that one focus.
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const menuClosedAt = useRef(0);
  // Export opens from a menu item that is gone by the time the dialog
  // closes; the dialog hands focus back to this button instead.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const onMenuOpenChange = (next: boolean) => {
    if (!next) menuClosedAt.current = Date.now();
    setTooltipOpen(false);
    setOpen(next);
  };
  const onTooltipOpenChange = (next: boolean) =>
    setTooltipOpen(next && !open && Date.now() - menuClosedAt.current > 400);
  const modifier = modifierLabel();

  // Only while the menu is open: counting words on every keystroke for a
  // footer nobody is looking at would be wasted work.
  const stats = useMemo(() => (open ? documentStats(blocks) : null), [blocks, open]);
  const title = displayTitle(doc.name);
  // A side flyout has no room on a phone: the styles go inline instead.
  const compact = useCompactMenus();
  // Before the first save of this session, the list's edit time stands in.
  const edited = lastSavedAt
    ? `Edited ${relativeTime(lastSavedAt)}`
    : open
      ? editedLabel(knownUpdatedAt(documentId))
      : '';
  // Nothing has listed this page yet (a phone, where the sidebar list is not
  // mounted): ask the list once, so the footer can say when it was edited.
  const [, setListed] = useState(0);
  useEffect(() => {
    if (!open || lastSavedAt || !documentId || knownUpdatedAt(documentId)) return;
    const controller = new AbortController();
    listRemote({ limit: 20, sortBy: 'updated_at', sortOrder: 'desc' }, { signal: controller.signal })
      .then((result) => {
        rememberDocumentSummaries(result.documents);
        setListed((count) => count + 1);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [documentId, lastSavedAt, listRemote, open]);
  const citationChoices = (
    <DropdownMenuRadioGroup
      value={doc.citationStyle ?? 'auto'}
      onValueChange={(value) =>
        setCitationStyle(value === 'auto' ? null : (value as NonNullable<Doc['citationStyle']>))
      }
    >
      {CITATION_STYLES.map((style) => (
        <DropdownMenuRadioItem
          key={style.value}
          value={style.value}
          indicator
          // Inline, the menu stays open so the choice is seen to take.
          onSelect={compact ? (event) => event.preventDefault() : undefined}
        >
          {style.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: 'Link copied', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy the link', variant: 'error' });
    }
  };

  const onDelete = async () => {
    if (!documentId) return;
    const ok = await confirm({
      title: `Delete “${title}”?`,
      description: 'This permanently removes the document and its chats. It cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteRemote(documentId);
      toast({ title: 'Document deleted', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onMenuOpenChange}>
        <Tooltip open={tooltipOpen} onOpenChange={onTooltipOpenChange}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button ref={triggerRef} variant="icon" size="icon-sm" aria-label="Page options">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Style, export and more</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-[260px]">
          <DropdownMenuLabel>Style</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            toggle
            checked={pageSettings.fullWidth}
            onCheckedChange={(checked) => pageSettings.set({ fullWidth: checked === true })}
            onSelect={(event) => event.preventDefault()}
          >
            <MoveHorizontal aria-hidden="true" />
            Full width
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            toggle
            checked={pageSettings.smallText}
            onCheckedChange={(checked) => pageSettings.set({ smallText: checked === true })}
            onSelect={(event) => event.preventDefault()}
          >
            <CaseSensitive aria-hidden="true" />
            Small text
          </DropdownMenuCheckboxItem>
          {compact ? (
            <>
              <DropdownMenuLabel className="flex items-center gap-2">
                <Quote aria-hidden="true" className="size-3.5" />
                Citation style
              </DropdownMenuLabel>
              {citationChoices}
            </>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Quote aria-hidden="true" />
                Citation style
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48" collisionPadding={8}>
                {citationChoices}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void copyLink()}>
            <Link2 aria-hidden="true" />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setExportOpen(true)}>
            <Download aria-hidden="true" />
            Export…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTool('history')}>
            <History aria-hidden="true" />
            Version history
          </DropdownMenuItem>
          {/* The topbar drops its tool buttons on a phone; they live here then. */}
          {PAGE_TOOLS.filter((tool) => tool.id !== 'history').map(({ id, label, icon: Icon }) => (
            <DropdownMenuItem key={id} className="sm:hidden" onSelect={() => setTool(id)}>
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setTool('json')}>
            <FileCode aria-hidden="true" />
            Document JSON
            <DropdownMenuShortcut>Developer</DropdownMenuShortcut>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!canUndo} onSelect={(event) => { event.preventDefault(); undo(); }}>
            <Undo2 aria-hidden="true" />
            Undo
            {!compact && <DropdownMenuShortcut>{modifier}+Z</DropdownMenuShortcut>}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canRedo} onSelect={(event) => { event.preventDefault(); redo(); }}>
            <Redo2 aria-hidden="true" />
            Redo
            {!compact && <DropdownMenuShortcut>{modifier}+Shift+Z</DropdownMenuShortcut>}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={newDocument.disabled}
            onSelect={() => void newDocument.createDocument()}
          >
            <SquarePen aria-hidden="true" />
            New page
          </DropdownMenuItem>
          <DropdownMenuItem destructive disabled={!documentId} onSelect={() => void onDelete()}>
            <Trash2 aria-hidden="true" />
            Delete document
          </DropdownMenuItem>

          {stats && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 pb-1 pt-0.5 text-xs leading-5 text-muted-foreground">
                <p>
                  {plural(stats.words, 'word')} · {plural(stats.characters, 'character')}
                </p>
                {edited && <p>{edited}</p>}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DocumentExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        returnFocus={() => triggerRef.current}
      />
    </>
  );
}
